// ================= LLM CLIENT FOR AGENTIC DECISION MAKING (Gemini) =================
// Iteration 0 + 0.5 — Gemini provider with tier selection, cost recording,
// rate-limit backoff, JSON parsing robustness, and honest fallback labeling.
//
// Env vars (set in agent .env, see .env.example):
//   GEMINI_API_KEY              required
//   GEMINI_PRO_MODEL            default "gemini-2.5-pro"
//   GEMINI_FLASH_MODEL          default "gemini-2.5-flash"
//   GEMINI_FORCE_MODEL          if set, overrides tier-based selection
//                               (dev cost-control: e.g. "gemini-2.5-flash-lite")
//   PER_NEGOTIATION_TOKEN_CEILING  default 20000
//   GEMINI_MAX_RETRIES          default 3 (for 429 backoff)
//
import { GoogleGenAI, GenerateContentConfig } from "@google/genai";
import { LLMResponse, AgentRole } from "./negotiation-types.js";

// ── Pricing table (USD per 1M tokens, as of May 2026) ─────────────────────────
// Used for audit cost estimation only — NOT for billing. Update when Google
// changes prices. Source: ai.google.dev/gemini-api/docs/pricing
const GEMINI_PRICING: Record<string, { in: number; out: number }> = {
  "gemini-2.5-pro":        { in: 1.25,  out: 10.00 },
  "gemini-2.5-flash":      { in: 0.30,  out: 2.50  },
  "gemini-2.5-flash-lite": { in: 0.10,  out: 0.40  },
};

export type ModelTier = "pro" | "flash";

export interface LLMPromptContext {
    role: AgentRole;
    round: number;
    maxRounds: number;
    lastOwnOffer?: number;
    lastTheirOffer?: number;
    history: any[];
    constraints: {
        marginPrice?: number; // Seller only
        maxBudget?: number;   // Buyer only
        quantity: number;
    };
    targetPrice?: number;
    // L4: live market data injected into prompt so the LLM can reason
    // about market conditions rather than just config at startup.
    marketContext?: {
        sofrRate:               number;
        cottonPricePerLb:       number;
        effectiveBorrowingRate: number;
        sofrSource:             string;
    };
}

/**
 * Extended LLM response with audit fields. The original LLMResponse shape is
 * preserved for backward compatibility with seller/buyer agents; the new
 * `audit` field is optional and populated when caller wants it.
 */
export interface LLMResponseWithAudit extends LLMResponse {
    audit?: {
        modelRequested:    string;     // tier resolved to this model name
        modelUsed:         string;     // actual model in the API call
        promptTokens?:     number;
        completionTokens?: number;
        totalTokens?:      number;
        estimatedCostUSD?: number;
        latencyMs:         number;
        decisionPath:      "GEMINI_OK"
                         | "GEMINI_RATE_LIMITED_RULES_FALLBACK"
                         | "GEMINI_INVALID_JSON_RULES_FALLBACK"
                         | "GEMINI_ERROR_RULES_FALLBACK"
                         | "GEMINI_TOKEN_CEILING_REACHED";
        retries:           number;
    };
}

/**
 * Per-negotiation token tracker. Reset at the start of each negotiation;
 * if a single negotiation accumulates more than PER_NEGOTIATION_TOKEN_CEILING
 * tokens across all calls, further LLM calls return immediately with
 * decisionPath: "GEMINI_TOKEN_CEILING_REACHED".
 *
 * NOTE: This is process-wide today (the seller is single-process and handles
 * one negotiation at a time per CLI session). Iteration 1+ will key it per
 * negotiationId.
 */
class TokenBudget {
    private tokensUsed = 0;
    private ceiling: number;

    constructor() {
        this.ceiling = Number(process.env.PER_NEGOTIATION_TOKEN_CEILING ?? 20000);
    }

    reset() { this.tokensUsed = 0; }
    add(tokens: number) { this.tokensUsed += tokens; }
    remaining(): number { return Math.max(0, this.ceiling - this.tokensUsed); }
    exceeded(): boolean { return this.tokensUsed >= this.ceiling; }
    used(): number { return this.tokensUsed; }
    cap(): number { return this.ceiling; }
}

export class LLMNegotiationClient {
    private client: GoogleGenAI;
    private proModel:   string;
    private flashModel: string;
    private forceModel: string | undefined;
    private maxRetries: number;
    public  budget: TokenBudget;

    constructor(apiKey?: string) {
        // ── Iteration 0.5: API key validation at startup, not on first call ──
        const key = apiKey || process.env.GEMINI_API_KEY;
        if (!key) {
            console.error("❌ GEMINI_API_KEY not set. Aborting.");
            throw new Error(
                "GEMINI_API_KEY is required. Set it in the agent .env file. " +
                "Get a key at https://aistudio.google.com/apikey"
            );
        }
        if (!key.startsWith("AIza") && key.length < 20) {
            console.error("❌ GEMINI_API_KEY looks malformed:", key.substring(0, 6) + "...");
            throw new Error("GEMINI_API_KEY format invalid (expected 'AIza...' or similar).");
        }

        this.proModel   = process.env.GEMINI_PRO_MODEL   || "gemini-2.5-pro";
        this.flashModel = process.env.GEMINI_FLASH_MODEL || "gemini-2.5-flash";
        this.forceModel = process.env.GEMINI_FORCE_MODEL || undefined;
        this.maxRetries = Number(process.env.GEMINI_MAX_RETRIES ?? 3);
        this.budget     = new TokenBudget();

        console.log(
            `✅ Initializing Gemini with API key: ${key.substring(0, 8)}...  ` +
            `pro=${this.proModel}  flash=${this.flashModel}` +
            (this.forceModel ? `  FORCE=${this.forceModel}` : "")
        );

        this.client = new GoogleGenAI({ apiKey: key });
    }

    /** Resolve which model name to actually call, honoring GEMINI_FORCE_MODEL. */
    private resolveModel(tier: ModelTier): string {
        if (this.forceModel) return this.forceModel;
        return tier === "pro" ? this.proModel : this.flashModel;
    }

    /** Estimate cost in USD from a Gemini response's token counts. */
    private estimateCostUSD(model: string, inTokens: number, outTokens: number): number {
        // Strip any version suffix (e.g. "gemini-2.5-pro-001" → "gemini-2.5-pro")
        const baseModel = Object.keys(GEMINI_PRICING).find(m => model.startsWith(m)) || model;
        const rate = GEMINI_PRICING[baseModel];
        if (!rate) return 0; // unknown model — no estimate
        return (inTokens / 1_000_000) * rate.in + (outTokens / 1_000_000) * rate.out;
    }

    /**
     * Iteration 0.5: Parse JSON tolerant of code-fence wrapping. Gemini
     * sometimes returns ```json\n{...}\n``` even with responseMimeType set.
     */
    private parseJsonForgiving(text: string): any {
        let cleaned = text.trim();
        // Strip code fences if present
        if (cleaned.startsWith("```")) {
            cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
        }
        return JSON.parse(cleaned);
    }

    /** Sleep helper for exponential backoff. */
    private sleep(ms: number): Promise<void> {
        return new Promise(r => setTimeout(r, ms));
    }

    /**
     * Main entry point. Returns LLMResponse for backward compatibility with
     * the seller/buyer agents, but the response also carries an `audit` field
     * with model + token + cost + latency metadata (iteration 4 will surface
     * this into the negotiation audit JSON).
     */
    async getNegotiationDecision(
        context: LLMPromptContext,
        modelTier: ModelTier = "pro"
    ): Promise<LLMResponseWithAudit> {
        const t0    = Date.now();
        const model = this.resolveModel(modelTier);

        // ── Token-ceiling check (iteration 0.5) ──────────────────────────────
        if (this.budget.exceeded()) {
            console.warn(
                `⚠ Token ceiling reached (${this.budget.used()}/${this.budget.cap()}). ` +
                `Skipping LLM call, using rules fallback.`
            );
            return this.fallbackResponse(context, model, t0, 0, "GEMINI_TOKEN_CEILING_REACHED");
        }

        const prompt       = this.buildPrompt(context);
        const systemPrompt =
            `You are an expert negotiation AI ${context.role === "BUYER" ? "buyer" : "seller"} agent. ` +
            `You must make strategic decisions to maximize your goals while being realistic about deal closure. ` +
            `Always respond with valid JSON only, no additional text, no code fences.`;

        const generationConfig: GenerateContentConfig = {
            temperature:       0.7,
            responseMimeType:  "application/json",
            // Schema gives Gemini a strong structural hint; combined with
            // forgiving parser, this handles 99% of formatting edge cases.
            responseSchema: {
                type: "OBJECT",
                properties: {
                    action:     { type: "STRING", enum: ["ACCEPT", "COUNTER", "REJECT"] },
                    price:      { type: "NUMBER", nullable: true },
                    reasoning:  { type: "STRING" },
                    confidence: { type: "NUMBER", nullable: true },
                },
                required: ["action", "reasoning"],
            } as any,
            systemInstruction: systemPrompt,
        };

        // ── Iteration 0.5: retry-with-backoff on 429s ────────────────────────
        let lastError: any = null;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await this.client.models.generateContent({
                    model,
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    config:   generationConfig,
                });

                const text     = response.text ?? "{}";
                const usage    = response.usageMetadata ?? {};
                const inTok    = (usage as any).promptTokenCount     ?? 0;
                const outTok   = (usage as any).candidatesTokenCount ?? 0;
                const totalTok = (usage as any).totalTokenCount      ?? (inTok + outTok);

                this.budget.add(totalTok);

                const parsed = this.parseJsonForgiving(text);

                return {
                    action:     parsed.action    || "COUNTER",
                    price:      parsed.price     ? Math.round(parsed.price) : undefined,
                    reasoning:  parsed.reasoning || "Strategic decision",
                    confidence: parsed.confidence ?? 0.7,
                    audit: {
                        modelRequested:   model,
                        modelUsed:        model,
                        promptTokens:     inTok,
                        completionTokens: outTok,
                        totalTokens:      totalTok,
                        estimatedCostUSD: this.estimateCostUSD(model, inTok, outTok),
                        latencyMs:        Date.now() - t0,
                        decisionPath:     "GEMINI_OK",
                        retries:          attempt,
                    },
                };

            } catch (err: any) {
                lastError = err;

                // 429 / quota → backoff and retry
                const errMsg  = (err?.message ?? "").toLowerCase();
                const is429   = err?.status === 429
                             || errMsg.includes("429")
                             || errMsg.includes("quota")
                             || errMsg.includes("rate");

                if (is429 && attempt < this.maxRetries) {
                    const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
                    console.warn(
                        `⚠ Gemini rate-limited (attempt ${attempt + 1}/${this.maxRetries + 1}), ` +
                        `backing off ${backoffMs}ms...`
                    );
                    await this.sleep(backoffMs);
                    continue;
                }

                // JSON parse error → log and fall through to fallback
                if (err instanceof SyntaxError) {
                    console.error(`❌ Gemini returned invalid JSON: ${err.message}`);
                    return this.fallbackResponse(
                        context, model, t0, attempt, "GEMINI_INVALID_JSON_RULES_FALLBACK"
                    );
                }

                // Other error → fail this attempt; no retry unless 429
                break;
            }
        }

        // All retries exhausted (or non-retryable error)
        console.error(`❌ Gemini call failed after ${this.maxRetries + 1} attempts:`, lastError);

        const rateLimited = ((lastError?.message ?? "").toLowerCase().includes("quota")
                          || (lastError?.message ?? "").toLowerCase().includes("rate")
                          || lastError?.status === 429);

        return this.fallbackResponse(
            context,
            model,
            t0,
            this.maxRetries,
            rateLimited ? "GEMINI_RATE_LIMITED_RULES_FALLBACK"
                        : "GEMINI_ERROR_RULES_FALLBACK"
        );
    }

    /**
     * Fallback shape — what gets returned when the LLM is unavailable.
     * Carries the honest decisionPath label so the audit (iteration 4) can
     * show why this decision was rules-based, not LLM-based.
     */
    private fallbackResponse(
        context:      LLMPromptContext,
        model:        string,
        t0:           number,
        retries:      number,
        decisionPath: NonNullable<LLMResponseWithAudit["audit"]>["decisionPath"],
    ): LLMResponseWithAudit {
        return {
            action:     "COUNTER",
            price:      context.lastTheirOffer,
            reasoning:  `LLM unavailable (${decisionPath}) — using rule-based fallback`,
            confidence: 0.3,
            audit: {
                modelRequested:   model,
                modelUsed:        model,
                promptTokens:     0,
                completionTokens: 0,
                totalTokens:      0,
                estimatedCostUSD: 0,
                latencyMs:        Date.now() - t0,
                decisionPath,
                retries,
            },
        };
    }

    // ────────────────────────────────────────────────────────────────────────
    // The buildPrompt + buildMarketSection methods below are UNCHANGED from
    // the Groq version. The prompt content is provider-agnostic; only the
    // wire protocol changes.
    // ────────────────────────────────────────────────────────────────────────

    private buildMarketSection(ctx: LLMPromptContext): string {
        if (!ctx.marketContext) return "";
        const m = ctx.marketContext;
        const impl = ctx.role === "SELLER"
            ? "Higher cotton → your real production cost is higher. Higher borrowing rate → Net-30 gap is expensive to finance. Price to protect actual margin."
            : "Higher borrowing rate → your capital is more expensive. Closing the deal quickly and efficiently matters more when rates are high.";
        return [
            "",
            "LIVE MARKET CONDITIONS (L4 — use these to reason about pricing):",
            `- SOFR rate        : ${(m.sofrRate * 100).toFixed(2)}%  (${m.sofrSource})`,
            `- Cotton price     : $${m.cottonPricePerLb.toFixed(2)}/lb  (affects production cost)`,
            `- Eff. borrow rate : ${(m.effectiveBorrowingRate * 100).toFixed(2)}%  (working capital cost)`,
            `- Implication      : ${impl}`,
        ].join("\n");
    }

    private buildPrompt(context: LLMPromptContext): string {
        const isBuyer = context.role === "BUYER";
        const mkt     = this.buildMarketSection(context);

        const historyBlock = context.history.length > 0
            ? `\nNEGOTIATION HISTORY:\n${context.history
                .map(h => `  Round ${h.round}: Buyer ₹${h.buyerOffer || "?"} → Seller ₹${h.sellerOffer || "?"}`)
                .join("\n")}\n`
            : "";

        const constraintsBlock = isBuyer
            ? `- Maximum Budget: ₹${context.constraints.maxBudget}/unit (NEVER exceed this)\n` +
              `- Target Price: ₹${context.targetPrice}/unit (ideal outcome)\n` +
              `- Goal: Minimize total cost while securing the deal`
            : `- Margin Price: ₹${context.constraints.marginPrice}/unit (NEVER go below this - you lose money)\n` +
              `- Target Price: ₹${context.targetPrice}/unit (ideal outcome with good profit)\n` +
              `- Goal: Maximize profit while closing the deal`;

        const roundSection = (() => {
            if (context.round === 1) {
                return `- First impressions matter - set the tone\n` +
                    (isBuyer
                        ? "- Start lower to create negotiation room"
                        : "- Start higher to anchor expectations") +
                    "\n- Don't be too extreme or you'll lose credibility";
            }
            if (context.round === context.maxRounds) {
                const finalSeller = `- If their offer is STRICTLY ABOVE ₹${context.constraints.marginPrice} (your minimum floor), you may accept\n` +
                    `- NEVER accept at exactly ₹${context.constraints.marginPrice} — that is zero profit\n` +
                    `- Any deal with at least ₹1 profit is worth taking in the final round`;
                return `- THIS IS THE FINAL ROUND - deal will fail if not accepted\n` +
                    `- Consider: Is this the best offer you'll get?\n` +
                    `- Accepting a "good enough" deal is better than no deal\n` +
                    (isBuyer ? `- If their offer is within budget, seriously consider accepting` : finalSeller);
            }
            return `- Middle rounds are for convergence\n` +
                `- Show flexibility but don't concede too quickly\n` +
                `- Analyze their pattern: Are they moving toward you?\n` +
                `- Calculate: Will we reach agreement by round ${context.maxRounds}?`;
        })();

        const decisionAnalysis = context.lastTheirOffer
            ? (() => {
                const buyerAnalysis =
                    `   - ${context.lastTheirOffer <= context.constraints.maxBudget! ? "✓ Within budget" : "✗ Exceeds budget"}\n` +
                    `   - ${context.lastTheirOffer <= context.targetPrice! ? "✓ Below target (EXCELLENT)" : `${((context.lastTheirOffer - context.targetPrice!) / context.targetPrice! * 100).toFixed(1)}% above target`}`;
                const sellerAnalysis =
                    `   - ${context.lastTheirOffer > context.constraints.marginPrice! ? "✓ Above minimum (ACCEPTABLE)" : "✗ At or below minimum floor (MUST REJECT or COUNTER)"}\n` +
                    `   - Profit: ₹${context.lastTheirOffer - context.constraints.marginPrice!}/unit (${(((context.lastTheirOffer - context.constraints.marginPrice!) / context.constraints.marginPrice!) * 100).toFixed(1)}%)\n` +
                    `   - NOTE: ₹${context.constraints.marginPrice}/unit is your MINIMUM — any offer at or below this has zero or negative profit`;
                const gapLine = context.lastOwnOffer
                    ? `\n   - Current gap: ₹${Math.abs(context.lastTheirOffer - context.lastOwnOffer)}\n` +
                      `   - You need to ${isBuyer ? "increase" : "decrease"} by ${Math.abs(context.lastTheirOffer - context.lastOwnOffer)} to meet their price`
                    : "";
                const counterHints = isBuyer
                    ? `     * Moves toward their offer (show willingness)\n     * Stays within budget\n     * Increases pressure on them to accept`
                    : `     * Moves toward their offer (show flexibility)\n     * Stays above margin\n     * Signals you're serious about closing`;
                return `\n1. Their offer (₹${context.lastTheirOffer}) vs your constraints:\n` +
                    (isBuyer ? buyerAnalysis : sellerAnalysis) + gapLine +
                    `\n\n2. Gap analysis:${gapLine || " (no prior offer)"}` +
                    `\n\n3. Should you ACCEPT or make a COUNTER-OFFER?\n` +
                    `   - If ACCEPT: Explain why this is the right price\n` +
                    `   - If COUNTER: Calculate a strategic new price that:\n${counterHints}`;
            })()
            : `\nThis is the ${isBuyer ? "initial offer" : "first counter-offer"}.\nCalculate a strong opening position that gives you negotiation room.`;

        return `You are negotiating a trade deal as the ${context.role}.

CURRENT SITUATION:
- Round: ${context.round} of ${context.maxRounds} ${context.round === context.maxRounds ? "(FINAL ROUND)" : ""}
- Quantity: ${context.constraints.quantity} units
${context.lastOwnOffer   ? `- Your last offer  : ₹${context.lastOwnOffer}/unit`   : ""}
${context.lastTheirOffer ? `- Their last offer : ₹${context.lastTheirOffer}/unit` : ""}
${mkt}

${historyBlock}
YOUR CONSTRAINTS:
${constraintsBlock}

STRATEGIC CONSIDERATIONS:
${roundSection}

DECISION ANALYSIS:
${decisionAnalysis}

RESPOND WITH JSON ONLY (no other text):
{
  "action": "ACCEPT" or "COUNTER" or "REJECT",
  "price": <number if COUNTER, omit if ACCEPT/REJECT>,
  "reasoning": "<1-2 sentence explanation of your strategic thinking>",
  "confidence": <0.0 to 1.0 how confident you are in this decision>
}

Example responses:
{"action": "ACCEPT", "reasoning": "Their offer of ₹360 is within budget and further negotiation risks deal failure in final round", "confidence": 0.85}
{"action": "COUNTER", "price": 340, "reasoning": "Moving up from ₹320 to ₹340 shows flexibility while staying well below budget, testing their price sensitivity", "confidence": 0.75}
{"action": "REJECT", "reasoning": "Their offer of ₹330 is below our margin of ₹350, accepting would result in a loss", "confidence": 1.0}`;
    }
}
