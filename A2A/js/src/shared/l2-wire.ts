// ================= WEDGE1 / M2-β.4 — L2 WIRE (orchestrator) =================
//
// Top-level orchestrator that the seller-agent calls when the active
// seller-response mode permits the L2 executive
// (capabilities.advisorMathAggregator + .llmExecutiveJudgment).
//
// What it does (in one call):
//   1. Build the ConsultationRouter input from the negotiation context +
//      mode-permitted sub-agents.
//   2. Run consultAll() to get a ConsultationBundle (parallel sub-agent
//      consultations).
//   3. Construct an L2LLMCall adapter that wraps LLMNegotiationClient.
//   4. Run decide() (the L2 executive) which produces an L2ExecutiveDecision.
//   5. Translate the L2 decision into the legacy NegotiationDecision shape
//      so the seller-agent's existing ACCEPT/COUNTER/REJECT handlers don't
//      have to change.
//   6. Build a TreasuryConsultationSummary (same shape the seller already
//      stores on state.lastTreasuryResult) so success-report code paths
//      keep working unchanged.
//
// This module is the ONLY place where seller code intersects with the M2-β
// router + L2 executive + advisor math aggregator. Keeping the seam thin means:
//   - The seller-agent's diff for β.4 is small and auditable.
//   - β.5+ can extend the audit shape without touching seller code.
//   - The L2 path is independently testable (scripts/test-l2-wire.ts) with
//     stubbed providers, no live agents required.
//
// TODO(β.4-cleanup): The MarketContext parameter is currently unused by the
// L2 executive (the advisor math aggregator is market-agnostic in WEDGE1).
// Threaded through anyway so the LLM adapter can pass it into the seller's
// existing LLM prompt — keeps Gemini's market reasoning consistent across
// modes. β.5+ may bring market into the aggregator's effective-floor math.

import type { LLMNegotiationClient, LLMPromptContext } from "./llm-client.js";

import type {
  SellerResponseMode,
  ResolvedCapabilities,
} from "./negotiation-mode.js";

import type {
  ConsultationBundle,
  ConsultationRouterInput,
} from "./consultation-router.js";

import { consultAll } from "./consultation-router.js";

import type {
  L2ExecutiveDecision,
  L2LLMCall,
  L2LLMPromptContext,
} from "./l2-executive.js";

import { decide as l2Decide } from "./l2-executive.js";

import type {
  NegotiationDecision,
  TreasuryConsultationSummary,
} from "./negotiation-types.js";

// ─── Inputs / outputs ─────────────────────────────────────────────────────

export interface MarketContext {
  sofrRate:               number;
  cottonPricePerLb:       number;
  effectiveBorrowingRate: number;
  sofrSource:             string;
}

/**
 * Everything the L2 wire needs to make one round's decision. The seller
 * agent already has all of this on hand — this interface just makes the
 * dependencies explicit so the function is testable in isolation.
 */
export interface DecideRoundViaL2Input {
  // Negotiation context
  negotiationId:    string;
  round:            number;
  maxRounds:        number;
  buyerOffer:       number;
  quantity:         number;
  /** Last own offer; used by the LLM adapter for its prompt's `lastOwnOffer`. */
  lastSellerOffer?: number;
  history:          any[];

  // Seller constraints
  marginPrice:      number;
  minProfitMargin:  number;
  targetPrice:      number;

  // Mode resolution (already computed by caller; passed in for explicitness)
  mode:             SellerResponseMode;
  capabilities:     ResolvedCapabilities;

  // Treasury config
  paymentTermsDays: number;

  // Sub-agent inputs (only used when corresponding capability is enabled
  // AND the value is supplied). Sensible demo defaults are documented in
  // the seller-agent integration.
  productCode?:        string;
  originPort?:         string;
  destinationPort?:    string;
  buyerLei?:           string;
  buyerEntityName?:    string;

  // Optional advanced tactics inputs
  buyerMax?:               number;
  marketReferencePrice?:   number;
  usdInrRate?:             number;

  // Dependencies (injectable so tests can stub)
  llmClient:        LLMNegotiationClient;
  marketContext?:   MarketContext;

  /**
   * Optional override for the L2's LLM call. Tests inject a deterministic
   * stub here; production code leaves this undefined and the wire builds
   * an adapter from `llmClient`.
   */
  llmCallOverride?: L2LLMCall;
}

export interface DecideRoundViaL2Output {
  /**
   * The decision in the legacy NegotiationDecision shape — the seller's
   * existing ACCEPT/COUNTER/REJECT branches consume this unchanged.
   */
  decision: NegotiationDecision;

  /** The full router bundle — for audit JSON's consultations[] block. */
  bundle: ConsultationBundle;

  /** The full L2 executive decision — for audit's tacticsTrace + mathOverride. */
  l2Decision: L2ExecutiveDecision;

  /**
   * Treasury summary shaped exactly like the legacy state.lastTreasuryResult
   * so the success-report code path keeps working with no changes.
   * Null when treasury wasn't consulted or failed before producing a result.
   */
  treasurySummary: TreasuryConsultationSummary | null;
}

// ─── The orchestrator ─────────────────────────────────────────────────────

/**
 * Run one round's decision through the M2-β router + L2 executive pipeline.
 * Throws only on programmer error (e.g. tier without treasuryConsultation
 * capability); upstream provider failures are surfaced via L2's defensive
 * actions, never as exceptions.
 */
export async function decideRoundViaL2(
  input: DecideRoundViaL2Input,
): Promise<DecideRoundViaL2Output> {
  // Defensive: treasury must be on at every shippable mode. If a caller
  // somehow invokes this with a mode that has treasuryConsultation=false,
  // surface the misconfig loudly (the L2 executive would otherwise hard-
  // reject every round with abandoned-negotiation, which is correct but
  // confusing for the operator).
  if (!input.capabilities.treasuryConsultation) {
    throw new Error(
      `[l2-wire] decideRoundViaL2 called with mode=${input.mode} which lacks ` +
      `treasuryConsultation capability. L2 executive requires treasury verdict. ` +
      `This is a programmer error — only call this wire when capabilities.llmExecutiveJudgment is true.`,
    );
  }

  // ── 1. Build router input ───────────────────────────────────────────────
  const routerInput: ConsultationRouterInput = {
    mode: input.mode,
    treasury: {
      negotiationId:    input.negotiationId,
      pricePerUnit:     input.buyerOffer,
      quantity:         input.quantity,
      paymentTermsDays: input.paymentTermsDays,
      round:            input.round,
    },
  };

  // Inventory + logistics: enabled at L1_DELEGATED_ADVISORS+. The router
  // itself mode-gates again defensively, so passing inputs at a sub-permitted
  // mode is a no-op — but we skip the assignment to keep the bundle clean.
  if (input.capabilities.inventoryLogisticsSubAgents) {
    if (input.productCode) {
      routerInput.inventory = {
        productCode: input.productCode,
        quantity:    input.quantity,
      };
    }
    if (input.originPort && input.destinationPort) {
      routerInput.logistics = {
        originPort:      input.originPort,
        destinationPort: input.destinationPort,
        quantity:        input.quantity,
      };
    }
  }

  // Credit: enabled at L2_EXECUTIVE_REASONER+.
  if (input.capabilities.creditSubAgent && input.buyerLei) {
    routerInput.credit = {
      lei:             input.buyerLei,
      legalEntityName: input.buyerEntityName,
    };
  }

  // ── 2. Consult all mode-permitted sub-agents in parallel ────────────────
  const bundle = await consultAll(routerInput);

  // ── 3. Build the L2 LLM adapter ─────────────────────────────────────────
  // Reuses the seller's existing LLMNegotiationClient so token budget and
  // GEMINI_API_KEY are shared with the rest of the agent. Tests pass an
  // override directly.
  const llmCall: L2LLMCall = input.llmCallOverride ?? buildLLMAdapter(input);

  // ── 4. Run the L2 executive ─────────────────────────────────────────────
  const l2Decision = await l2Decide({
    bundle,
    buyerOffer:           input.buyerOffer,
    targetPrice:          input.targetPrice,
    marginPrice:          input.marginPrice,
    minProfitMargin:      input.minProfitMargin,
    quantity:             input.quantity,
    round:                input.round,
    maxRounds:            input.maxRounds,
    history:              input.history,
    buyerMax:             input.buyerMax,
    marketReferencePrice: input.marketReferencePrice,
    usdInrRate:           input.usdInrRate,
    llmCall,
  });

  // ── 5. Translate L2 → NegotiationDecision (legacy shape) ────────────────
  const decision: NegotiationDecision = translateL2ToNegotiation(l2Decision);

  // ── 6. Build TreasuryConsultationSummary (legacy shape) ─────────────────
  const treasurySummary = buildTreasurySummary(
    bundle,
    input.round,
    input.buyerOffer,
    // overrideApplied is true when the treasury verdict drove a math override
    // (i.e. l2Decision.mathOverride exists AND the bundle's treasury verdict
    // is approved=false). The buyer-side report cares about whether the deal
    // landed at a price the seller was "forced" to counter at by treasury.
    l2Decision.mathOverride !== undefined &&
      bundle.treasury?.success === true &&
      bundle.treasury.result?.approved === false,
  );

  return {
    decision,
    bundle,
    l2Decision,
    treasurySummary,
  };
}

// ─── Translations ─────────────────────────────────────────────────────────

/**
 * L2ExecutiveDecision → NegotiationDecision. Action passes through; counter
 * price comes from L2's counterPrice; reasoning concatenates the LLM
 * narrative with a tag noting any math override that fired.
 */
function translateL2ToNegotiation(l2: L2ExecutiveDecision): NegotiationDecision {
  const reasoningParts: string[] = [l2.reasoning];

  if (l2.mathOverride) {
    reasoningParts.push(`[math-override: ${l2.mathOverride.reason}]`);
  }

  // Surface any HARD defensive action (abandoned-negotiation, refused-deferred-terms)
  // in the reasoning so it shows up in the audit/log even before the audit
  // JSON's defensiveActions[] block is wired in.
  for (const action of l2.defensiveActions) {
    if (action.action === "abandoned-negotiation" || action.action === "refused-deferred-terms") {
      reasoningParts.push(`[defensive: ${action.action} (${action.triggeredBy}) — ${action.rationale}]`);
    }
  }

  return {
    action:    l2.action,
    price:     l2.counterPrice,
    reasoning: reasoningParts.join(" "),
  };
}

/**
 * Build a TreasuryConsultationSummary in the legacy shape from the bundle.
 * Returns null when treasury wasn't consulted or failed before producing
 * a result — the caller decides how to handle that (typically: don't
 * record on state.lastTreasuryResult).
 */
function buildTreasurySummary(
  bundle: ConsultationBundle,
  round: number,
  priceQueried: number,
  overrideApplied: boolean,
): TreasuryConsultationSummary | null {
  const rec = bundle.treasury;
  if (!rec || !rec.success || !rec.result) return null;

  const t = rec.result;
  return {
    round,
    priceQueried,
    approved:            t.approved,
    npvOfDeal:           t.npvOfDeal,
    netProfit:           t.netProfit,
    projectedMinBalance: t.projectedMinBalance,
    safetyThreshold:     t.safetyThreshold,
    workingCapitalCost:  t.workingCapitalCost,
    minViablePrice:      t.minViablePrice,
    overrideApplied,
  };
}

/**
 * Adapter that bridges L2's compact prompt context to the seller's existing
 * LLM client. The seller's LLMNegotiationClient is configured with role-
 * specific prompts (SELLER vs BUYER) — we pass role="SELLER" since the L2
 * executive is always called from the seller side in WEDGE1.
 */
function buildLLMAdapter(input: DecideRoundViaL2Input): L2LLMCall {
  return async (_ctx: L2LLMPromptContext) => {
    const llmPromptContext: LLMPromptContext = {
      role:           "SELLER",
      round:          input.round,
      maxRounds:      input.maxRounds,
      lastOwnOffer:   input.lastSellerOffer,
      lastTheirOffer: input.buyerOffer,
      history:        input.history,
      constraints: {
        // marginPrice in the LLM context is the floor the LLM is told to
        // respect. We pass the L2's hardFloor here so the LLM's own internal
        // bound matches the executive's enforcement bound. The L2 executive
        // will still re-validate and override if the LLM strays.
        marginPrice: _ctx.hardFloor,
        quantity:    input.quantity,
      },
      targetPrice:   input.targetPrice,
      marketContext: input.marketContext,
    };

    return input.llmClient.getNegotiationDecision(llmPromptContext);
  };
}
