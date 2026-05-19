// ================= WEDGE1 / M1 — SELLER RESPONSE MODE FRAMEWORK =================
//
// One-stop module for resolving the seller's response-mode from the agent's
// env at runtime, validating it, and producing the audit-JSON
// `sellerResponseMode` block that every saved audit must carry.
//
// Five orthogonal config axes per the master design (§1 of
// AGENTIC-PROCUREMENT-ARCHITECTURE.md, refined in
// revamp-2026-05-18-framework/FRAMEWORK-V2.md):
//
//   1. SELLER_RESPONSE_MODE   reasoning tier (BASIC_SALES_QUOTING_1 .. L4_LEARNED_PROFILES_AND_PD)
//   2. SELLER_STYLE           TKI 5-style (post-WEDGE1, ignored today)
//   3. SELLER_AUTONOMY_LEVEL  L0..L5 (post-WEDGE1, ignored today)
//   4. EVALUATION_CONTEXT     live | paper-trade | benchmark | replay
//   5. INVENTORY_MODE / LOGISTICS_MODE / CREDIT_MODE  real | demo per sub-agent
//
// All reads happen lazily on first call (NOT at import time) because agents
// invoke `dotenv.config()` AFTER their imports. Reading env at module load
// would see pre-dotenv values.
//
// Guarantee A invariant: if no env vars are set, the resolved mode is
// BASIC_SALES_QUOTING_1, provider modes are all "demo", evaluation context
// is "live". That's byte-equivalent to the prior product's effective state.
//
// CLEAN CUT — the old env name NEGOTIATION_MODE and old tier names
// (BASIC1 / ADVANCED1..4) are no longer accepted. If the old env name is
// present in process.env, resolveSellerResponseMode() throws a fail-fast
// error with a translation hint. This is NOT a silent fallback.

// --- Types ----------------------------------------------------------------

export type SellerResponseMode =
  | "BASIC_SALES_QUOTING_1"        // SKU floor only, no advisors
  | "L1_DELEGATED_ADVISORS"        // + 4 advisors consulted, math floor
  | "L2_EXECUTIVE_REASONER"        // + LLM-as-executive with 3 guardrail layers
  | "L3_STYLE_AND_AUTONOMY"        // + TKI style framework + opponent inference + autonomy gates (post-WEDGE1)
  | "L4_LEARNED_PROFILES_AND_PD";  // + per-counterparty profiles + commodity PD (post-WEDGE1)

export type ProviderMode = "real" | "demo";

export type EvaluationContext = "live" | "paper-trade" | "benchmark" | "replay";

/** Per-sub-agent provider mode. Read independently from env. */
export interface ProviderModes {
  inventory: ProviderMode;
  logistics: ProviderMode;
  credit:    ProviderMode;
}

/**
 * Boolean feature-flag matrix derived from the mode. Sub-agents and the
 * advisor-math-aggregator consult this to decide which behaviors are
 * allowed. WEDGE1 ships through L2; L3/L4 features land post-WEDGE1.
 */
export interface ResolvedCapabilities {
  /** Treasury sub-agent consulted on pre-quote and major counters. */
  treasuryConsultation:        boolean;
  /** Inventory + Logistics sub-agents wired and consulted. */
  inventoryLogisticsSubAgents: boolean;
  /** Credit sub-agent (GLEIF live + EDGAR composite) consulted. */
  creditSubAgent:              boolean;
  /** Advisor math aggregator (effective floor, δ, NBS, α-weighted utility). */
  advisorMathAggregator:       boolean;
  /** L2+ executive judgment (LLM-as-executive with 3 guardrail layers). */
  llmExecutiveJudgment:        boolean;
  /** TKI 5-style framework (post-WEDGE1, L3+). */
  styleFramework:              boolean;
  /** Opponent style inference (post-WEDGE1, L3+). */
  opponentStyleInference:      boolean;
  /** SAE J3016 autonomy levels (post-WEDGE1, L3+). */
  autonomyLevels:              boolean;
  /** Per-counterparty α/δ profiles (post-WEDGE1, L4+). */
  perCounterpartyProfiles:     boolean;
  /** Per-commodity PD models + ACTUS cashflow sim (post-WEDGE1, L4+). */
  customCommodityPdModels:     boolean;
}

/** The block embedded into every saved audit JSON. */
export interface SellerResponseModeBlock {
  mode:                  SellerResponseMode;
  resolvedCapabilities:  ResolvedCapabilities;
  providerModes:         ProviderModes;
  evaluationContext:     EvaluationContext;
  resolvedFromEnv: {
    SELLER_RESPONSE_MODE: string | null;
    INVENTORY_MODE:       string | null;
    LOGISTICS_MODE:       string | null;
    CREDIT_MODE:          string | null;
    EVALUATION_CONTEXT:   string | null;
  };
}

// --- Resolution -----------------------------------------------------------

/** All valid mode strings. */
const VALID_MODES: ReadonlySet<SellerResponseMode> = new Set<SellerResponseMode>([
  "BASIC_SALES_QUOTING_1",
  "L1_DELEGATED_ADVISORS",
  "L2_EXECUTIVE_REASONER",
  "L3_STYLE_AND_AUTONOMY",
  "L4_LEARNED_PROFILES_AND_PD",
]);

/** Modes that WEDGE1 ships. Anything else throws on validateSellerResponseMode(). */
const SHIPPABLE_MODES: ReadonlySet<SellerResponseMode> = new Set<SellerResponseMode>([
  "BASIC_SALES_QUOTING_1",
  "L1_DELEGATED_ADVISORS",
  "L2_EXECUTIVE_REASONER",
]);

const VALID_PROVIDER_MODES: ReadonlySet<ProviderMode> = new Set(["real", "demo"]);

const VALID_EVALUATION_CONTEXTS: ReadonlySet<EvaluationContext> = new Set([
  "live", "paper-trade", "benchmark", "replay",
]);

/** Source env to use. Indirection makes the unit test pass a synthetic env. */
function getEnv(envOverride?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return envOverride ?? process.env;
}

/**
 * Resolve the seller-response mode from env. Defaults to BASIC_SALES_QUOTING_1
 * if unset.
 *
 * CLEAN-CUT: rejects the old NEGOTIATION_MODE env var with a translation hint.
 * This is fail-fast, NOT silent fallback.
 *
 * @throws if SELLER_RESPONSE_MODE is set to a non-empty value that doesn't
 *         match any known mode, or if the deprecated NEGOTIATION_MODE env
 *         var is set.
 */
export function resolveSellerResponseMode(envOverride?: NodeJS.ProcessEnv): SellerResponseMode {
  const env = getEnv(envOverride);

  // Fail-fast on the old env name. Not a fallback — refuse to start with a
  // helpful translation table so the operator knows what to change.
  if ((env.NEGOTIATION_MODE ?? "").trim() !== "") {
    throw new Error(
      `NEGOTIATION_MODE is no longer recognized. ` +
      `Use SELLER_RESPONSE_MODE instead. ` +
      `Translation table: ` +
      `BASIC1 → BASIC_SALES_QUOTING_1, ` +
      `ADVANCED1 → L1_DELEGATED_ADVISORS, ` +
      `ADVANCED2 → L2_EXECUTIVE_REASONER, ` +
      `ADVANCED3 → L3_STYLE_AND_AUTONOMY, ` +
      `ADVANCED4 → L4_LEARNED_PROFILES_AND_PD. ` +
      `See DESIGN/revamp-2026-05-18-framework/FRAMEWORK-V2.md §5.1.`,
    );
  }

  const raw = (env.SELLER_RESPONSE_MODE ?? "").trim();
  if (raw === "") return "BASIC_SALES_QUOTING_1";  // default = today's BASIC product
  if (!VALID_MODES.has(raw as SellerResponseMode)) {
    throw new Error(
      `Invalid SELLER_RESPONSE_MODE="${env.SELLER_RESPONSE_MODE}". ` +
      `Must be one of: ${[...VALID_MODES].join(", ")}. ` +
      `Default (unset) is BASIC_SALES_QUOTING_1.`,
    );
  }
  return raw as SellerResponseMode;
}

/**
 * Validate that the resolved mode is shippable in WEDGE1
 * (BASIC_SALES_QUOTING_1 / L1_DELEGATED_ADVISORS / L2_EXECUTIVE_REASONER).
 *
 * @throws if the resolved mode is L3_STYLE_AND_AUTONOMY or L4_LEARNED_PROFILES_AND_PD
 *         — these are post-WEDGE1 and would produce ambiguous audit artifacts
 *         if run today.
 */
export function validateSellerResponseMode(envOverride?: NodeJS.ProcessEnv): SellerResponseMode {
  const mode = resolveSellerResponseMode(envOverride);
  if (!SHIPPABLE_MODES.has(mode)) {
    throw new Error(
      `SELLER_RESPONSE_MODE=${mode} is not yet supported in v1.0; use L2_EXECUTIVE_REASONER. ` +
      `${mode} features (style framework, opponent inference, autonomy levels, ` +
      `per-counterparty profiles, custom PD models) are part of post-WEDGE1 roadmap.`,
    );
  }
  return mode;
}

/** Capability matrix for a given mode. Pure function — no env reads. */
export function getResolvedCapabilities(mode: SellerResponseMode): ResolvedCapabilities {
  // BASIC_SALES_QUOTING_1: today's product. Treasury only (pre-existing).
  if (mode === "BASIC_SALES_QUOTING_1") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: false,
      creditSubAgent:              false,
      advisorMathAggregator:       false,
      llmExecutiveJudgment:        false,
      styleFramework:              false,
      opponentStyleInference:      false,
      autonomyLevels:              false,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // L1_DELEGATED_ADVISORS: + inventory + logistics
  if (mode === "L1_DELEGATED_ADVISORS") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: true,
      creditSubAgent:              false,
      advisorMathAggregator:       false,
      llmExecutiveJudgment:        false,
      styleFramework:              false,
      opponentStyleInference:      false,
      autonomyLevels:              false,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // L2_EXECUTIVE_REASONER: + credit + advisor math aggregator + L2 executive
  if (mode === "L2_EXECUTIVE_REASONER") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: true,
      creditSubAgent:              true,
      advisorMathAggregator:       true,
      llmExecutiveJudgment:        true,
      styleFramework:              false,
      opponentStyleInference:      false,
      autonomyLevels:              false,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // L3_STYLE_AND_AUTONOMY: + style framework + opponent inference + autonomy levels
  if (mode === "L3_STYLE_AND_AUTONOMY") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: true,
      creditSubAgent:              true,
      advisorMathAggregator:       true,
      llmExecutiveJudgment:        true,
      styleFramework:              true,
      opponentStyleInference:      true,
      autonomyLevels:              true,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // L4_LEARNED_PROFILES_AND_PD: everything
  return {
    treasuryConsultation:        true,
    inventoryLogisticsSubAgents: true,
    creditSubAgent:              true,
    advisorMathAggregator:       true,
    llmExecutiveJudgment:        true,
    styleFramework:              true,
    opponentStyleInference:      true,
    autonomyLevels:              true,
    perCounterpartyProfiles:     true,
    customCommodityPdModels:     true,
  };
}

/**
 * Resolve the per-sub-agent provider modes. Each defaults to "demo".
 * Throws if any provided value is not "real" or "demo".
 */
export function resolveProviderModes(envOverride?: NodeJS.ProcessEnv): ProviderModes {
  const env = getEnv(envOverride);
  const one = (raw: string | undefined, key: string): ProviderMode => {
    const v = (raw ?? "").trim().toLowerCase();
    if (v === "") return "demo";
    if (!VALID_PROVIDER_MODES.has(v as ProviderMode)) {
      throw new Error(`Invalid ${key}="${raw}". Must be "real" or "demo".`);
    }
    return v as ProviderMode;
  };
  return {
    inventory: one(env.INVENTORY_MODE, "INVENTORY_MODE"),
    logistics: one(env.LOGISTICS_MODE, "LOGISTICS_MODE"),
    credit:    one(env.CREDIT_MODE,    "CREDIT_MODE"),
  };
}

/**
 * Resolve the evaluation context. Defaults to "live".
 * Throws if set to a non-recognized value.
 */
export function resolveEvaluationContext(envOverride?: NodeJS.ProcessEnv): EvaluationContext {
  const env = getEnv(envOverride);
  const raw = (env.EVALUATION_CONTEXT ?? "").trim().toLowerCase();
  if (raw === "") return "live";
  if (!VALID_EVALUATION_CONTEXTS.has(raw as EvaluationContext)) {
    throw new Error(
      `Invalid EVALUATION_CONTEXT="${env.EVALUATION_CONTEXT}". ` +
      `Must be one of: ${[...VALID_EVALUATION_CONTEXTS].join(", ")}.`,
    );
  }
  return raw as EvaluationContext;
}

/**
 * Produce the complete audit-JSON block. Called from logger.saveAuditJson()
 * so every audit carries an unambiguous record of the mode under which
 * the deal ran. Reads env on every call (cheap, runs only at deal close).
 */
export function buildSellerResponseModeBlock(envOverride?: NodeJS.ProcessEnv): SellerResponseModeBlock {
  const env  = getEnv(envOverride);
  const mode = resolveSellerResponseMode(envOverride);
  return {
    mode,
    resolvedCapabilities: getResolvedCapabilities(mode),
    providerModes:        resolveProviderModes(envOverride),
    evaluationContext:    resolveEvaluationContext(envOverride),
    resolvedFromEnv: {
      SELLER_RESPONSE_MODE: env.SELLER_RESPONSE_MODE ?? null,
      INVENTORY_MODE:       env.INVENTORY_MODE       ?? null,
      LOGISTICS_MODE:       env.LOGISTICS_MODE       ?? null,
      CREDIT_MODE:          env.CREDIT_MODE          ?? null,
      EVALUATION_CONTEXT:   env.EVALUATION_CONTEXT   ?? null,
    },
  };
}

/**
 * Format the resolved mode as a multi-line string for agent startup logs.
 * Honest about whether each axis came from env or default.
 */
export function formatStartupBanner(block: SellerResponseModeBlock): string {
  const lines: string[] = [];
  lines.push(`Seller response mode : ${block.mode}${block.resolvedFromEnv.SELLER_RESPONSE_MODE === null ? "  (default — env unset)" : ""}`);
  lines.push(`Evaluation context   : ${block.evaluationContext}${block.resolvedFromEnv.EVALUATION_CONTEXT === null ? "  (default)" : ""}`);
  lines.push(`Provider modes       : inventory=${block.providerModes.inventory}, logistics=${block.providerModes.logistics}, credit=${block.providerModes.credit}`);
  const enabledCaps = Object.entries(block.resolvedCapabilities)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  lines.push(`Capabilities         : ${enabledCaps.length === 0 ? "(none)" : enabledCaps.join(", ")}`);
  return lines.join("\n");
}
