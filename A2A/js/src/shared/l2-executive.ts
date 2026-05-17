// ================= WEDGE1 / M2-β.3 — L2 EXECUTIVE =================
//
// LLM-as-executive layer. Consumes the ConsultationBundle produced by the
// router (M2-β.1), runs the tactics-engine math (M2-β.1), optionally calls
// the LLM for narrative reasoning, then VALIDATES the LLM's decision against
// the math floor — clamping or overriding when the LLM's proposal would
// violate a hard constraint (cash floor, treasury rejection, sanity bound).
//
// Trust model
// ───────────
// Math is authoritative for hard limits:
//   - Treasury rejection (success=false in bundle)       → REJECT, no LLM call
//   - Treasury verdict approved=false + minViablePrice   → hard clamp
//   - effectiveFloor.total                                → hard clamp
//   - targetPrice × 1.5                                   → sanity clamp (down)
//
// LLM is authoritative for soft choices:
//   - ACCEPT vs COUNTER vs REJECT (when math doesn't force the answer)
//   - Specific counter price within the [hardFloor, 1.5×target] band
//   - The reasoning string verbatim (audit + Decision Trail viewer surface it)
//
// Every override is recorded in `mathOverride` so the audit shows what the
// LLM proposed and what the executive clamped it to. The Decision Trail
// viewer surfaces both verbatim. No silent overrides.
//
// Defensive vocab matches DefensiveAction from provider-types.ts so the
// audit JSON's defensiveAction field is grep-able.
//
// LLM seam
// ────────
// This module does NOT import the Gemini client directly. The caller passes
// an L2LLMCall function. Production wraps LLMNegotiationClient; the unit
// test injects a stub. This keeps the L2 executive testable without a
// GEMINI_API_KEY and without a network round-trip.

import type {
  ConsultationBundle,
} from "./consultation-router.js";

import type {
  ConsultationRecord,
  TreasuryConsultation,
  InventoryConsultation,
  LogisticsConsultation,
  CreditConsultation,
  DefensiveAction,
  DefensiveActionRecord,
  SubAgentName,
} from "./provider-types.js";

import type { NegotiationTier } from "./negotiation-mode.js";
import { shouldConsultCredit } from "./consultation-router.js";

import {
  effectiveFloor,
  nbsMidpoint,
  alphaWeightedUtility,
  deltaDiscount,
  type EffectiveFloorResult,
  type NbsResult,
  type AlphaWeightedUtilityResult,
  type DeltaDiscountResult,
} from "./tactics-engine.js";

import type { LLMResponseWithAudit } from "./llm-client.js";

// ─── L2 LLM seam ──────────────────────────────────────────────────────────

/**
 * Compact prompt context the L2 executive passes to the LLM. The shape is
 * narrower than LLMPromptContext (which is the seller/buyer-side decision
 * shape) because the executive has already done the math — the LLM just
 * needs the math results and the negotiation state to produce narrative.
 */
export interface L2LLMPromptContext {
  /** Tier the deal is running at; informs which capabilities the LLM can lean on. */
  tier: NegotiationTier;
  /** Round + maxRounds, for final-round urgency tuning. */
  round:     number;
  maxRounds: number;
  /** Current buyer offer the executive is evaluating. */
  buyerOffer:  number;
  /** Seller's targetPrice (the ideal landing point). */
  targetPrice: number;
  /** Hard floor — max(effectiveFloor.total, treasury.minViablePrice). LLM must respect this. */
  hardFloor: number;
  /** Tactics-engine outputs, already computed by the executive. */
  tactics: {
    effectiveFloor:       EffectiveFloorResult;
    nbsMidpoint:          NbsResult;
    alphaWeightedUtility: AlphaWeightedUtilityResult;
    deltaDiscount?:       DeltaDiscountResult;
  };
  /** Sub-agent records (verbatim from bundle) so the LLM can reference provenance. */
  bundle: ConsultationBundle;
  /** Prior round history. */
  history: any[];
  /** Optional defensive-action context to weave into the reasoning. */
  defensiveActions: DefensiveActionRecord[];
}

/**
 * Function that calls the LLM. Production wraps LLMNegotiationClient; tests
 * inject a stub. The return shape matches LLMResponseWithAudit so the
 * audit field flows straight into the L2 decision's llmAudit.
 */
export type L2LLMCall =
  (ctx: L2LLMPromptContext) => Promise<LLMResponseWithAudit>;

// ─── Inputs / outputs ─────────────────────────────────────────────────────

export interface L2ExecutiveInput {
  bundle: ConsultationBundle;
  /** Buyer's current offer (per unit, INR). */
  buyerOffer: number;
  /** Seller's ideal landing price (per unit, INR). Used as upper sanity bound + LLM context. */
  targetPrice: number;
  /** Seller's per-unit cost floor (margin price). */
  marginPrice: number;
  /** Required profit buffer above marginPrice. */
  minProfitMargin: number;
  /** Total quantity in the deal. */
  quantity: number;

  round:     number;
  maxRounds: number;
  history:   any[];

  /** Optional buyerMax — when known (e.g. from disclosed reservation), used for NBS midpoint. */
  buyerMax?: number;
  /** Optional market reference for deltaDiscount classification. */
  marketReferencePrice?: number;
  /** Optional USD→INR override for logistics math. */
  usdInrRate?: number;

  /** LLM caller. When omitted the executive runs pure-math (deterministic) and skips narrative. */
  llmCall?: L2LLMCall;
}

export interface L2ExecutiveDecision {
  action:        "ACCEPT" | "COUNTER" | "REJECT";
  /** Set only when action === "COUNTER". */
  counterPrice?: number;
  /** Narrative — LLM-produced when llmCall provided, else a math-derived stub. */
  reasoning: string;

  /** Full tactics trace — audit JSON's tacticsTrace block. */
  tacticsTrace: {
    effectiveFloor:       EffectiveFloorResult;
    nbsMidpoint:          NbsResult;
    alphaWeightedUtility: AlphaWeightedUtilityResult;
    deltaDiscount?:       DeltaDiscountResult;
    hardFloor:            number;
  };

  /** Defensive actions triggered by this decision (zero or more). */
  defensiveActions: DefensiveActionRecord[];

  /** Populated only when the executive overrode the LLM's proposal. */
  mathOverride?: {
    llmProposed: {
      action: "ACCEPT" | "COUNTER" | "REJECT";
      price?: number;
    };
    clampedTo: {
      action: "ACCEPT" | "COUNTER" | "REJECT";
      price?: number;
    };
    reason: string;
  };

  /** Echo of the LLM call's audit metadata (cost + latency + decisionPath). */
  llmAudit?: LLMResponseWithAudit["audit"];

  /** Wall-clock duration of decide(), including LLM call. */
  executiveLatencyMs: number;
}

// ─── Defensive-action helpers ─────────────────────────────────────────────

function defensiveRecord(
  action:       DefensiveAction,
  triggeredBy:  SubAgentName,
  upstreamError: string,
  rationale:    string,
): DefensiveActionRecord {
  return {
    action,
    triggeredAt: new Date().toISOString(),
    triggeredBy,
    upstreamError,
    rationale,
  };
}

// ─── The executive ────────────────────────────────────────────────────────

/**
 * Run the L2 executive over a consultation bundle and a buyer offer.
 * Returns a complete L2ExecutiveDecision with action, optional counterPrice,
 * tactics trace, defensive actions, and any math overrides applied to the
 * LLM's proposal.
 */
export async function decide(input: L2ExecutiveInput): Promise<L2ExecutiveDecision> {
  const t0 = Date.now();

  // ── 1. Hard defensive: treasury absent / failed ─────────────────────────
  // Treasury is always-on in BASIC1+. If we don't have a verdict, we cannot
  // safely accept any price — REJECT and surface the defensive action.
  if (!input.bundle.treasury) {
    const tactics = computeTactics(input, Number.POSITIVE_INFINITY);
    const action = defensiveRecord(
      "abandoned-negotiation",
      "treasury",
      "treasury record absent from bundle (treasury input not supplied or tier-gated off)",
      "Cannot evaluate cash impact without a treasury verdict. Refusing to commit; escalating to human.",
    );
    return {
      action: "REJECT",
      reasoning: "Treasury consultation absent from the bundle. The cash/NPV guardrail is mandatory at every tier; refusing to commit without it.",
      tacticsTrace: { ...tactics, hardFloor: tactics.effectiveFloor.total },
      defensiveActions: [action],
      executiveLatencyMs: Date.now() - t0,
    };
  }

  if (input.bundle.treasury.success === false) {
    const tactics = computeTactics(input, Number.POSITIVE_INFINITY);
    const action = defensiveRecord(
      "abandoned-negotiation",
      "treasury",
      input.bundle.treasury.error ?? "treasury consultation failed",
      "Treasury consultation failed; refusing to commit without a cash/NPV verdict.",
    );
    return {
      action: "REJECT",
      reasoning: `Treasury consultation failed: ${input.bundle.treasury.error ?? "unknown error"}. Cannot evaluate cash impact; escalating.`,
      tacticsTrace: { ...tactics, hardFloor: tactics.effectiveFloor.total },
      defensiveActions: [action],
      executiveLatencyMs: Date.now() - t0,
    };
  }

  // ── 2. Tactics math ─────────────────────────────────────────────────────
  // Treasury succeeded — extract minViablePrice (defined when approved=false).
  const treasuryResult     = input.bundle.treasury.result!;
  const treasuryMinFloor   = (treasuryResult.minViablePrice !== undefined && treasuryResult.minViablePrice > 0)
                             ? treasuryResult.minViablePrice
                             : 0;
  const tactics            = computeTactics(input, treasuryMinFloor);
  const hardFloor          = Math.max(tactics.effectiveFloor.total, treasuryMinFloor);
  const sanityCeilingPrice = input.targetPrice * 1.5;

  // ── 3. Soft defensive actions ───────────────────────────────────────────
  const defensiveActions: DefensiveActionRecord[] = [];

  // Treasury approved=false is NOT a hard reject — it just means the deal
  // can't close at the current price. We counter at minViablePrice. Surface
  // a defensive action so the audit shows treasury pushed back.
  if (treasuryResult.approved === false) {
    defensiveActions.push(defensiveRecord(
      "asked-for-collateral", // treasury rejection is the cash analog of a collateral demand
      "treasury",
      `treasury verdict approved=false; reasons: ${(treasuryResult.failReasons ?? []).join("; ")}`,
      `Cash/NPV check failed at buyer's offer. Counter floor raised to treasury minViablePrice ₹${treasuryMinFloor}.`,
    ));
  }

  // Credit sub-agent failed at a tier that uses credit → must refuse deferred terms.
  if (shouldConsultCredit(input.bundle.tier)) {
    const cre = input.bundle.credit;
    if (!cre || cre.success === false) {
      defensiveActions.push(defensiveRecord(
        "refused-deferred-terms",
        "credit",
        cre?.error ?? "credit consultation absent",
        "Credit verdict unavailable; refusing Net 30/60/90, demanding COD or pre-payment.",
      ));
    }
  }

  // Logistics / inventory: record but don't block — the tactics rationale
  // already surfaces them as missingSubAgents. We add an explicit defensive
  // record so the audit's defensiveAction field is non-empty.
  for (const missing of tactics.effectiveFloor.missingSubAgents) {
    if (missing === "credit") continue; // already handled above (with stronger action)
    defensiveActions.push(defensiveRecord(
      "fallback-to-demo-fixture",
      missing,
      `${missing} sub-agent record missing or success=false`,
      `${missing} sub-agent unavailable; effective-floor adjustment skipped, deal proceeds at base floor.`,
    ));
  }

  // ── 4. LLM proposal (skip when no llmCall provided) ─────────────────────
  let llmProposal: { action: "ACCEPT" | "COUNTER" | "REJECT"; price?: number; reasoning: string };
  let llmAudit:    LLMResponseWithAudit["audit"];

  if (input.llmCall) {
    const llmCtx: L2LLMPromptContext = {
      tier:        input.bundle.tier,
      round:       input.round,
      maxRounds:   input.maxRounds,
      buyerOffer:  input.buyerOffer,
      targetPrice: input.targetPrice,
      hardFloor,
      tactics:     {
        effectiveFloor:       tactics.effectiveFloor,
        nbsMidpoint:          tactics.nbsMidpoint,
        alphaWeightedUtility: tactics.alphaWeightedUtility,
        deltaDiscount:        tactics.deltaDiscount,
      },
      bundle:       input.bundle,
      history:      input.history,
      defensiveActions,
    };

    const llmRes = await input.llmCall(llmCtx);
    llmProposal  = {
      action:    llmRes.action,
      price:     llmRes.price,
      reasoning: llmRes.reasoning,
    };
    llmAudit = llmRes.audit;
  } else {
    // Pure-math mode (used by deterministic tests). Pick the obvious decision
    // from math: ACCEPT if buyerOffer ≥ hardFloor AND ≥ effectiveFloor base,
    // else COUNTER at hardFloor. Use Math.ceil so the synthetic counter is
    // always at-or-above the fractional floor (Math.round would round 372.16
    // down to 372 and then be flagged as below-floor by the validator).
    if (input.buyerOffer >= hardFloor) {
      llmProposal = {
        action:    "ACCEPT",
        reasoning: `(pure-math) buyer offer ₹${input.buyerOffer} meets hard floor ₹${hardFloor.toFixed(2)}.`,
      };
    } else {
      llmProposal = {
        action:    "COUNTER",
        price:     Math.ceil(hardFloor),
        reasoning: `(pure-math) buyer offer ₹${input.buyerOffer} below hard floor ₹${hardFloor.toFixed(2)}; counter at floor.`,
      };
    }
    llmAudit = undefined;
  }

  // ── 5. Validate LLM proposal against math (clamp + override) ────────────
  let finalAction:        L2ExecutiveDecision["action"] = llmProposal.action;
  let finalCounterPrice:  number | undefined            = llmProposal.price;
  let mathOverride:       L2ExecutiveDecision["mathOverride"];

  // Override 5a: LLM says ACCEPT but buyer offer is below hard floor
  if (llmProposal.action === "ACCEPT" && input.buyerOffer < hardFloor) {
    const clampPrice = Math.ceil(hardFloor); // round UP so clamp is always ≥ floor
    mathOverride = {
      llmProposed: { action: "ACCEPT" },
      clampedTo:   { action: "COUNTER", price: clampPrice },
      reason:      `LLM proposed ACCEPT at ₹${input.buyerOffer}, but hard floor is ₹${hardFloor.toFixed(2)} (max of effective floor ₹${tactics.effectiveFloor.total.toFixed(2)} and treasury minViablePrice ₹${treasuryMinFloor}). Counter at floor.`,
    };
    finalAction       = "COUNTER";
    finalCounterPrice = clampPrice;
  }

  // Override 5b: LLM says COUNTER below hard floor → clamp up
  else if (llmProposal.action === "COUNTER"
           && llmProposal.price !== undefined
           && llmProposal.price < hardFloor) {
    const clampPrice = Math.ceil(hardFloor); // round UP
    mathOverride = {
      llmProposed: { action: "COUNTER", price: llmProposal.price },
      clampedTo:   { action: "COUNTER", price: clampPrice },
      reason:      `LLM proposed counter at ₹${llmProposal.price}, below hard floor ₹${hardFloor.toFixed(2)}. Clamped up to floor.`,
    };
    finalAction       = "COUNTER";
    finalCounterPrice = clampPrice;
  }

  // Override 5c: LLM says COUNTER above sanity ceiling → clamp down
  else if (llmProposal.action === "COUNTER"
           && llmProposal.price !== undefined
           && llmProposal.price > sanityCeilingPrice) {
    const clampPrice = Math.floor(sanityCeilingPrice); // round DOWN so clamp is always ≤ ceiling
    mathOverride = {
      llmProposed: { action: "COUNTER", price: llmProposal.price },
      clampedTo:   { action: "COUNTER", price: clampPrice },
      reason:      `LLM proposed counter at ₹${llmProposal.price}, above sanity ceiling ₹${sanityCeilingPrice.toFixed(2)} (1.5 × target ₹${input.targetPrice}). Clamped down.`,
    };
    finalAction       = "COUNTER";
    finalCounterPrice = clampPrice;
  }

  // Override 5d: LLM says COUNTER with no price → backfill from hard floor
  else if (llmProposal.action === "COUNTER" && llmProposal.price === undefined) {
    const clampPrice = Math.ceil(hardFloor);
    mathOverride = {
      llmProposed: { action: "COUNTER" },
      clampedTo:   { action: "COUNTER", price: clampPrice },
      reason:      `LLM proposed COUNTER but omitted price; defaulting to hard floor ₹${hardFloor.toFixed(2)}.`,
    };
    finalAction       = "COUNTER";
    finalCounterPrice = clampPrice;
  }

  // Pass-through: ACCEPT at-or-above floor, COUNTER in band, REJECT.
  // Note: when finalAction is ACCEPT or REJECT we explicitly clear counterPrice.
  if (finalAction !== "COUNTER") {
    finalCounterPrice = undefined;
  }

  return {
    action:             finalAction,
    counterPrice:       finalCounterPrice,
    reasoning:          llmProposal.reasoning,
    tacticsTrace:       { ...tactics, hardFloor },
    defensiveActions,
    mathOverride,
    llmAudit,
    executiveLatencyMs: Date.now() - t0,
  };
}

// ─── Pure-math computation (shared between hard-reject and normal paths) ──

interface TacticsBundle {
  effectiveFloor:       EffectiveFloorResult;
  nbsMidpoint:          NbsResult;
  alphaWeightedUtility: AlphaWeightedUtilityResult;
  deltaDiscount?:       DeltaDiscountResult;
}

function computeTactics(input: L2ExecutiveInput, treasuryMinFloor: number): TacticsBundle {
  const inv = input.bundle.inventory;
  const log = input.bundle.logistics;
  const cre = input.bundle.credit;

  const effFloor = effectiveFloor({
    marginPrice:     input.marginPrice,
    minProfitMargin: input.minProfitMargin,
    quantity:        input.quantity,
    inventoryRecord: inv,
    logisticsRecord: log,
    creditRecord:    cre,
    usdInrRate:      input.usdInrRate,
  });

  // NBS midpoint — only computable when buyerMax provided. The seller doesn't
  // know the buyer's reservation in WEDGE1, so this is usually skipped. When
  // present, it gives the LLM an anchor for a fair-split counter offer.
  const sellerMin = Math.max(effFloor.total, Number.isFinite(treasuryMinFloor) ? treasuryMinFloor : 0);
  const nbs       = nbsMidpoint({
    buyerMax:  input.buyerMax ?? input.targetPrice, // use targetPrice as conservative proxy
    sellerMin,
  });

  // α-weighted utility at the buyer's current offer
  const transitDays = (log && log.success && log.result) ? log.result.estimatedTransitDays : undefined;
  const pd1y        = (cre && cre.success && cre.result) ? cre.result.pd1y                  : undefined;
  const aw          = alphaWeightedUtility({
    pricePerUnit:   input.buyerOffer,
    effectiveFloor: sellerMin > 0 ? sellerMin : effFloor.total,
    estimatedTransitDays: transitDays,
    pd1y,
  });

  // δ discount — only when a market reference is supplied
  let delta: DeltaDiscountResult | undefined;
  if (typeof input.marketReferencePrice === "number" && input.marketReferencePrice > 0) {
    delta = deltaDiscount({
      candidatePrice:       input.buyerOffer,
      marketReferencePrice: input.marketReferencePrice,
    });
  }

  return {
    effectiveFloor:       effFloor,
    nbsMidpoint:          nbs,
    alphaWeightedUtility: aw,
    deltaDiscount:        delta,
  };
}
