// ================= WEDGE1 / M2-β.1 — ADVISOR MATH AGGREGATOR =================
//
// Pure math module. Takes the consultation bundle produced by the router
// (M2-β.1) and computes derived quantities the L2 executive (M2-β.3) needs:
//
//   - effectiveFloor:    seller's true per-unit minimum given inventory
//                        expediting cost + logistics per-unit + credit risk
//                        premium on top of the marginPrice + minProfitMargin.
//   - nbsMidpoint:       Nash Bargaining Solution price assuming linear,
//                        symmetric utility. For asymmetric power dynamics
//                        the call site can post-weight; symmetric is the
//                        WEDGE1 default.
//   - alphaWeightedUtility:  scalarization for combining price, speed, and
//                        counterparty-safety into one [0, 1] score.
//   - deltaDiscount:     classify a candidate price against a market
//                        reference price (premium / fair / discounted / below-market).
//
// Why "advisor math aggregator" (renamed from "tactics engine" in M2-δ):
// the four functions are not tactics in the negotiation-theory sense —
// they're the math layer that aggregates inputs from the four advisor
// sub-agents (treasury, inventory, logistics, credit) into the quantities
// the L2 executive needs to validate the LLM's proposal. The new name
// reflects what the module actually does, in keeping with the v2 design
// vocabulary (see DESIGN/revamp-2026-05-18-framework/FRAMEWORK-V2.md §5).
//
// No I/O, no env reads, no globals. Every function is a pure transformation.
// Easy to test deterministically; the verification script exercises corner
// cases below.
//
// All functions accept ConsultationRecord wrappers (not bare result types)
// so the L2 executive doesn't need to unwrap and check `success` itself.
// When a record is absent or success=false, the corresponding adjustment is
// skipped and the rationale records that the sub-agent was unavailable.

import type {
  ConsultationRecord,
  InventoryConsultation,
  LogisticsConsultation,
  CreditConsultation,
} from "./provider-types.js";

// ─── Currency conversion default ──────────────────────────────────────────
//
// Logistics quotes come in USD; the deal currency is INR. The default
// conversion is intentionally a constant (not a live FX call) to keep the
// advisor math aggregator pure and the test deterministic. Callers can
// override per-deal via `usdInrRate` if needed.
const DEFAULT_USD_INR = 85;

// ─── effectiveFloor ───────────────────────────────────────────────────────

export interface EffectiveFloorInput {
  /** Seller's cost floor (per unit, INR). */
  marginPrice: number;
  /** Required profit buffer above margin (per unit, INR). */
  minProfitMargin: number;
  /** Total quantity in the deal — used to amortize logistics cost. */
  quantity: number;
  inventoryRecord?: ConsultationRecord<InventoryConsultation>;
  logisticsRecord?: ConsultationRecord<LogisticsConsultation>;
  creditRecord?:    ConsultationRecord<CreditConsultation>;
  /** Optional override for USD→INR conversion (default 85). */
  usdInrRate?: number;
}

export interface EffectiveFloorResult {
  /** marginPrice + minProfitMargin, before any sub-agent adjustments. */
  baseFloor: number;
  /** Premium added when inventory cannot fulfil immediately (e.g. expediting cost). */
  inventoryAdjustment: number;
  /** Per-unit logistics cost (USD rate / quantity × USD-INR). */
  logisticsAdjustment: number;
  /** Expected loss premium (pd1y × lgd × baseFloor). */
  creditAdjustment: number;
  /** Sum of base + all adjustments — the per-unit floor the L2 executive must respect. */
  total: number;
  /** Human-readable breakdown for audit + drill-down panel. */
  rationale: string;
  /** Which sub-agents were unavailable (success=false or no record). */
  missingSubAgents: ("inventory" | "logistics" | "credit")[];
}

/**
 * Compute the seller's effective per-unit price floor given sub-agent
 * consultations. When a sub-agent failed or wasn't consulted, its
 * adjustment is 0 and the sub-agent is listed in `missingSubAgents`.
 */
export function effectiveFloor(input: EffectiveFloorInput): EffectiveFloorResult {
  const baseFloor = input.marginPrice + input.minProfitMargin;
  const missing: ("inventory" | "logistics" | "credit")[] = [];

  // ── Inventory adjustment ────────────────────────────────────────────────
  // If canFulfill is false and leadTime > 0, charge a 2% expediting premium
  // on the base floor. Captures the cost of running an extra production
  // shift / paying overtime to hit the buyer's date.
  let inventoryAdjustment = 0;
  const inv = unwrap(input.inventoryRecord);
  if (inv === undefined && input.inventoryRecord) {
    missing.push("inventory");
  } else if (inv && !inv.canFulfill && inv.leadTimeDays > 0) {
    inventoryAdjustment = baseFloor * 0.02;
  }

  // ── Logistics adjustment ────────────────────────────────────────────────
  // bestRateUsd is the total shipment cost for the lane; amortize across
  // the deal's quantity, then convert USD→INR.
  let logisticsAdjustment = 0;
  const log = unwrap(input.logisticsRecord);
  const usdInr = input.usdInrRate ?? DEFAULT_USD_INR;
  if (log === undefined && input.logisticsRecord) {
    missing.push("logistics");
  } else if (log && input.quantity > 0) {
    logisticsAdjustment = (log.bestRateUsd * usdInr) / input.quantity;
  }

  // ── Credit-risk adjustment ──────────────────────────────────────────────
  // Expected loss = pd1y × lgd × per-unit exposure. Using baseFloor as the
  // exposure proxy keeps the calculation independent of the candidate
  // price (which the L2 executive is still deciding).
  let creditAdjustment = 0;
  const cre = unwrap(input.creditRecord);
  if (cre === undefined && input.creditRecord) {
    missing.push("credit");
  } else if (cre) {
    creditAdjustment = baseFloor * cre.pd1y * cre.lgd;
  }

  const total = baseFloor + inventoryAdjustment + logisticsAdjustment + creditAdjustment;

  // Rationale lines (suppressed when adjustment is 0, except baseFloor).
  const lines: string[] = [`base floor (margin ₹${input.marginPrice} + buffer ₹${input.minProfitMargin}): ₹${baseFloor.toFixed(2)}`];
  if (inventoryAdjustment > 0)  lines.push(`inventory expediting premium (2%): +₹${inventoryAdjustment.toFixed(2)}`);
  if (logisticsAdjustment > 0)  lines.push(`logistics per-unit (USD ${log!.bestRateUsd} × ${usdInr} ÷ ${input.quantity} units): +₹${logisticsAdjustment.toFixed(2)}`);
  if (creditAdjustment > 0)     lines.push(`credit-risk premium (pd1y ${(cre!.pd1y * 100).toFixed(2)}% × lgd ${(cre!.lgd * 100).toFixed(0)}%): +₹${creditAdjustment.toFixed(2)}`);
  for (const m of missing)      lines.push(`${m} sub-agent unavailable — adjustment skipped`);
  lines.push(`total effective floor: ₹${total.toFixed(2)}`);

  return {
    baseFloor,
    inventoryAdjustment,
    logisticsAdjustment,
    creditAdjustment,
    total,
    rationale: lines.join("; "),
    missingSubAgents: missing,
  };
}

// ─── nbsMidpoint ──────────────────────────────────────────────────────────

export interface NbsInput {
  /** Buyer's reservation price (maximum they'd pay). */
  buyerMax: number;
  /** Seller's reservation price (minimum they'd accept — typically effectiveFloor.total). */
  sellerMin: number;
}

export interface NbsResult {
  /** Midpoint price; NaN when ZOPA is empty (sellerMin > buyerMax). */
  midpoint: number;
  /** True when buyerMax > sellerMin — agreement is theoretically possible. */
  zopaPositive: boolean;
  /** Width of the bargaining zone (negative when zopa empty). */
  zopaWidth: number;
}

/**
 * Nash Bargaining Solution under symmetric linear utility: the midpoint of
 * the bargaining zone. For asymmetric power dynamics the caller can
 * post-weight (e.g. shift toward the side with better BATNA).
 */
export function nbsMidpoint(input: NbsInput): NbsResult {
  const zopaWidth = input.buyerMax - input.sellerMin;
  if (zopaWidth <= 0) {
    return { midpoint: NaN, zopaPositive: false, zopaWidth };
  }
  return {
    midpoint:     (input.buyerMax + input.sellerMin) / 2,
    zopaPositive: true,
    zopaWidth,
  };
}

// ─── alphaWeightedUtility ─────────────────────────────────────────────────

export interface AlphaWeightedUtilityInput {
  /** Candidate price the L2 executive is evaluating. */
  pricePerUnit: number;
  /** The seller's effective floor — denominator for price utility. */
  effectiveFloor: number;
  /** Logistics transit days; omit to use the neutral default. */
  estimatedTransitDays?: number;
  /** Credit pd1y (1-year probability of default); omit to use neutral default. */
  pd1y?: number;
  /** Optional weight overrides (must sum to 1). Defaults: 0.6 / 0.2 / 0.2. */
  alphaPrice?:         number;
  alphaSpeed?:         number;
  alphaCreditSafety?:  number;
}

export interface AlphaWeightedUtilityResult {
  utility: number;          // [0, 1]
  components: {
    price:        number;
    speed:        number;
    creditSafety: number;
  };
  weights: {
    alphaPrice:        number;
    alphaSpeed:        number;
    alphaCreditSafety: number;
  };
}

/**
 * α-weighted utility: convex combination of three normalized utilities.
 *
 *   price utility    — how much margin above the effective floor (capped
 *                      at +50% above floor = utility 1).
 *   speed utility    — inverse of transit days (90d=0, 0d=1). Neutral 0.5
 *                      when no logistics data.
 *   credit safety    — 1 - pd1y. Neutral 0.5 when no credit data.
 *
 * Default weights skew toward price (0.6) since that's the primary
 * negotiation variable. Speed + credit at 0.2 each give risk-aware nudges
 * without dominating the decision.
 */
export function alphaWeightedUtility(input: AlphaWeightedUtilityInput): AlphaWeightedUtilityResult {
  const alphaPrice        = input.alphaPrice        ?? 0.6;
  const alphaSpeed        = input.alphaSpeed        ?? 0.2;
  const alphaCreditSafety = input.alphaCreditSafety ?? 0.2;

  // Price utility — margin above floor, capped at 50% premium = 1.0
  const priceMargin = input.effectiveFloor > 0
    ? (input.pricePerUnit - input.effectiveFloor) / input.effectiveFloor
    : 0;
  const priceUtility = clamp01(priceMargin / 0.5);

  // Speed utility — neutral when no data, otherwise 1 - days/90 (capped)
  const speedUtility = input.estimatedTransitDays !== undefined
    ? clamp01(1 - input.estimatedTransitDays / 90)
    : 0.5;

  // Credit safety — neutral when no data, otherwise 1 - pd1y
  const creditSafetyUtility = input.pd1y !== undefined
    ? clamp01(1 - input.pd1y)
    : 0.5;

  const utility = alphaPrice * priceUtility
                + alphaSpeed * speedUtility
                + alphaCreditSafety * creditSafetyUtility;

  return {
    utility: clamp01(utility),
    components: {
      price:        priceUtility,
      speed:        speedUtility,
      creditSafety: creditSafetyUtility,
    },
    weights: { alphaPrice, alphaSpeed, alphaCreditSafety },
  };
}

// ─── deltaDiscount ────────────────────────────────────────────────────────

export interface DeltaDiscountInput {
  /** Candidate price the L2 executive is evaluating. */
  candidatePrice: number;
  /** Market reference price (e.g. last comparable trade, or a published index). */
  marketReferencePrice: number;
}

export type DeltaClassification = "premium" | "fair" | "discounted" | "below-market";

export interface DeltaDiscountResult {
  /** Positive = discount below market; negative = premium above market. */
  discountPercent: number;
  classification:  DeltaClassification;
}

/**
 * Classify a candidate price against a market reference. Bands:
 *   discount < −5%  → premium       (candidate > market by 5%+)
 *   −5% ≤ d ≤ 5%    → fair          (within 5% either side)
 *   5% < d ≤ 15%    → discounted    (5–15% below market)
 *   d > 15%         → below-market  (>15% below — sanity-check trigger)
 */
export function deltaDiscount(input: DeltaDiscountInput): DeltaDiscountResult {
  const discountPercent = input.marketReferencePrice > 0
    ? ((input.marketReferencePrice - input.candidatePrice) / input.marketReferencePrice) * 100
    : 0;

  let classification: DeltaClassification;
  if (discountPercent < -5)        classification = "premium";
  else if (discountPercent <= 5)   classification = "fair";
  else if (discountPercent <= 15)  classification = "discounted";
  else                              classification = "below-market";

  return { discountPercent, classification };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function unwrap<T>(record: ConsultationRecord<T> | undefined): T | undefined {
  if (!record) return undefined;
  if (record.success && record.result !== undefined) return record.result;
  return undefined;
}
