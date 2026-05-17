// ================= WEDGE1 / M1 — TIER FRAMEWORK =================
//
// One-stop module for resolving the negotiation tier from the agent's env
// at runtime, validating it, and producing the audit-JSON `negotiationMode`
// block that every saved audit must carry.
//
// Five orthogonal config axes per the master design (§1 of
// AGENTIC-PROCUREMENT-ARCHITECTURE.md):
//
//   1. NEGOTIATION_MODE       capability tier (BASIC1..ADVANCED4)
//   2. SELLER_STYLE           TKI 5-style (post-WEDGE1, ignored today)
//   3. SELLER_AUTONOMY_LEVEL  L0..L5 (post-WEDGE1, ignored today)
//   4. EVALUATION_CONTEXT     live | paper-trade | benchmark | replay
//   5. INVENTORY_MODE / LOGISTICS_MODE / CREDIT_MODE  real | demo per sub-agent
//
// All reads happen lazily on first call (NOT at import time) because agents
// invoke `dotenv.config()` AFTER their imports. Reading env at module load
// would see pre-dotenv values.
//
// Guarantee A invariant: if no env vars are set, the resolved tier is
// BASIC1, provider modes are all "demo", evaluation context is "live".
// That's byte-equivalent to the prior product's effective state. The
// regression test scripts/test-tier-resolver.ts enforces this.

// --- Types ----------------------------------------------------------------

export type NegotiationTier =
  | "BASIC1"
  | "ADVANCED1"
  | "ADVANCED2"
  | "ADVANCED3"
  | "ADVANCED4";

export type ProviderMode = "real" | "demo";

export type EvaluationContext = "live" | "paper-trade" | "benchmark" | "replay";

/** Per-sub-agent provider mode. Read independently from env. */
export interface ProviderModes {
  inventory: ProviderMode;
  logistics: ProviderMode;
  credit:    ProviderMode;
}

/**
 * Boolean feature-flag matrix derived from the tier. Sub-agents and the
 * tactics engine consult this to decide which behaviors are allowed at
 * the current tier. WEDGE1 ships through ADV2; ADV3/ADV4 features land
 * post-WEDGE1.
 */
export interface ResolvedCapabilities {
  /** Treasury sub-agent consulted on pre-quote and major counters. */
  treasuryConsultation:        boolean;
  /** Inventory + Logistics sub-agents wired and consulted. */
  inventoryLogisticsSubAgents: boolean;
  /** Credit sub-agent (GLEIF live + EDGAR composite) consulted. */
  creditSubAgent:              boolean;
  /** Tactics engine (effective floor, δ, NBS, α-weighted utility). */
  tacticsEngine:               boolean;
  /** L2+ executive judgment (LLM-as-executive with 3 guardrail layers). */
  llmExecutiveJudgment:        boolean;
  /** TKI 5-style framework (post-WEDGE1). */
  styleFramework:              boolean;
  /** Opponent style inference (post-WEDGE1, ADV3+). */
  opponentStyleInference:      boolean;
  /** SAE J3016 autonomy levels (post-WEDGE1, ADV3+). */
  autonomyLevels:              boolean;
  /** Per-counterparty α/δ profiles (post-WEDGE1, ADV4+). */
  perCounterpartyProfiles:     boolean;
  /** Per-commodity PD models + ACTUS cashflow sim (post-WEDGE1, ADV4+). */
  customCommodityPdModels:     boolean;
}

/** The block embedded into every saved audit JSON. */
export interface NegotiationModeBlock {
  tier:                  NegotiationTier;
  resolvedCapabilities:  ResolvedCapabilities;
  providerModes:         ProviderModes;
  evaluationContext:     EvaluationContext;
  resolvedFromEnv: {
    NEGOTIATION_MODE:     string | null;
    INVENTORY_MODE:       string | null;
    LOGISTICS_MODE:       string | null;
    CREDIT_MODE:          string | null;
    EVALUATION_CONTEXT:   string | null;
  };
}

// --- Resolution -----------------------------------------------------------

/** All valid tier strings, including pre-WEDGE1 alias normalization. */
const VALID_TIERS: ReadonlySet<NegotiationTier> = new Set<NegotiationTier>([
  "BASIC1", "ADVANCED1", "ADVANCED2", "ADVANCED3", "ADVANCED4",
]);

/** Tiers that WEDGE1 ships. Anything else throws on validateTier(). */
const SHIPPABLE_TIERS: ReadonlySet<NegotiationTier> = new Set<NegotiationTier>([
  "BASIC1", "ADVANCED1", "ADVANCED2",
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
 * Resolve the negotiation tier from env. Defaults to BASIC1 if unset.
 *
 * @throws if NEGOTIATION_MODE is set to a non-empty value that doesn't match
 *         any known tier. Returns `BASIC1` for unset / empty values.
 */
export function resolveTier(envOverride?: NodeJS.ProcessEnv): NegotiationTier {
  const env = getEnv(envOverride);
  const raw = (env.NEGOTIATION_MODE ?? "").trim().toUpperCase();
  if (raw === "") return "BASIC1";  // backward compat: no env -> today's product
  if (!VALID_TIERS.has(raw as NegotiationTier)) {
    throw new Error(
      `Invalid NEGOTIATION_MODE="${env.NEGOTIATION_MODE}". ` +
      `Must be one of: ${[...VALID_TIERS].join(", ")}. ` +
      `Default (unset) is BASIC1.`,
    );
  }
  return raw as NegotiationTier;
}

/**
 * Validate that the resolved tier is shippable in WEDGE1 (BASIC1 / ADV1 / ADV2).
 *
 * @throws if the resolved tier is ADVANCED3 or ADVANCED4 — these are post-WEDGE1
 *         and would produce ambiguous audit artifacts if run today.
 */
export function validateTier(envOverride?: NodeJS.ProcessEnv): NegotiationTier {
  const tier = resolveTier(envOverride);
  if (!SHIPPABLE_TIERS.has(tier)) {
    throw new Error(
      `NEGOTIATION_MODE=${tier} is not yet supported in v1.0; use ADVANCED2. ` +
      `${tier} features (style framework, opponent inference, autonomy levels, ` +
      `per-counterparty profiles, custom PD models) are part of post-WEDGE1 roadmap.`,
    );
  }
  return tier;
}

/** Capability matrix for a given tier. Pure function — no env reads. */
export function getResolvedCapabilities(tier: NegotiationTier): ResolvedCapabilities {
  // BASIC1: today's product. Treasury only (pre-existing).
  if (tier === "BASIC1") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: false,
      creditSubAgent:              false,
      tacticsEngine:               false,
      llmExecutiveJudgment:        false,
      styleFramework:              false,
      opponentStyleInference:      false,
      autonomyLevels:              false,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // ADVANCED1: + inventory + logistics
  if (tier === "ADVANCED1") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: true,
      creditSubAgent:              false,
      tacticsEngine:               false,
      llmExecutiveJudgment:        false,
      styleFramework:              false,
      opponentStyleInference:      false,
      autonomyLevels:              false,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // ADVANCED2: + credit + tactics + L2 executive
  if (tier === "ADVANCED2") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: true,
      creditSubAgent:              true,
      tacticsEngine:               true,
      llmExecutiveJudgment:        true,
      styleFramework:              false,
      opponentStyleInference:      false,
      autonomyLevels:              false,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // ADVANCED3: + style framework + opponent inference + autonomy levels
  if (tier === "ADVANCED3") {
    return {
      treasuryConsultation:        true,
      inventoryLogisticsSubAgents: true,
      creditSubAgent:              true,
      tacticsEngine:               true,
      llmExecutiveJudgment:        true,
      styleFramework:              true,
      opponentStyleInference:      true,
      autonomyLevels:              true,
      perCounterpartyProfiles:     false,
      customCommodityPdModels:     false,
    };
  }
  // ADVANCED4: everything
  return {
    treasuryConsultation:        true,
    inventoryLogisticsSubAgents: true,
    creditSubAgent:              true,
    tacticsEngine:               true,
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
export function buildNegotiationModeBlock(envOverride?: NodeJS.ProcessEnv): NegotiationModeBlock {
  const env  = getEnv(envOverride);
  const tier = resolveTier(envOverride);  // never throws for unset env; defaults BASIC1
  return {
    tier,
    resolvedCapabilities: getResolvedCapabilities(tier),
    providerModes:        resolveProviderModes(envOverride),
    evaluationContext:    resolveEvaluationContext(envOverride),
    resolvedFromEnv: {
      NEGOTIATION_MODE:   env.NEGOTIATION_MODE ?? null,
      INVENTORY_MODE:     env.INVENTORY_MODE   ?? null,
      LOGISTICS_MODE:     env.LOGISTICS_MODE   ?? null,
      CREDIT_MODE:        env.CREDIT_MODE      ?? null,
      EVALUATION_CONTEXT: env.EVALUATION_CONTEXT ?? null,
    },
  };
}

/**
 * Format the resolved mode as a multi-line string for agent startup logs.
 * Honest about whether each axis came from env or default.
 */
export function formatStartupBanner(block: NegotiationModeBlock): string {
  const lines: string[] = [];
  lines.push(`Negotiation tier   : ${block.tier}${block.resolvedFromEnv.NEGOTIATION_MODE === null ? "  (default — env unset)" : ""}`);
  lines.push(`Evaluation context : ${block.evaluationContext}${block.resolvedFromEnv.EVALUATION_CONTEXT === null ? "  (default)" : ""}`);
  lines.push(`Provider modes     : inventory=${block.providerModes.inventory}, logistics=${block.providerModes.logistics}, credit=${block.providerModes.credit}`);
  // Show enabled caps inline so the operator sees what this tier actually does.
  const enabledCaps = Object.entries(block.resolvedCapabilities)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
  lines.push(`Capabilities       : ${enabledCaps.length === 0 ? "(none)" : enabledCaps.join(", ")}`);
  return lines.join("\n");
}
