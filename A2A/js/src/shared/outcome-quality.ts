// ================= OUTCOME-QUALITY METRICS =================
// Economic-fairness scoring for a closed negotiation. Pure functions, no I/O.
//
// All metrics are computed from three numbers:
//   - closedPrice  the unit price the deal settled at
//   - buyerMax     the buyer's maximum acceptable unit price (reservation)
//   - sellerMin    the seller's minimum acceptable unit price (margin floor)
//
// We DO NOT compute "fair" weighted by relative bargaining power. The Nash
// Bargaining Solution implemented here is the symmetric NBS (equal weights),
// which gives a single canonical "midpoint" reference. Asymmetric NBS would
// require empirically estimating discount/patience factors per party — that's
// iteration 11 territory.
//
// Inputs come from the negotiation:
//   buyerMax  ← BUYER_CONFIG.maxBudget    (set in buyer-agent/index.ts)
//   sellerMin ← SELLER_CONFIG.marginPrice (set in seller-agent/index.ts)
// The buyer agent only knows buyerMax; the seller agent only knows sellerMin.
// To compute the full metric block, an audit writer needs BOTH numbers. The
// seller adds them when writing the seller-side audit (since seller knows
// both: its own margin AND the buyer's max if the buyer disclosed it via
// the PO total). The buyer side records its own buyerMax + outcome only.
//
// For deals that did NOT close (escalation), the metric block still computes
// what WOULD have been the IR/ZOPA/NBS, plus marks `closed: false`.

export type Currency = "INR" | "USD";

/** Input shape every metric takes. */
export interface QualityInputs {
  /** Did the deal close (PO sent) or escalate? */
  closed:           boolean;
  /** Settled unit price if closed; for escalations use the midpoint of the final two offers. */
  closedPrice:      number;
  /** Buyer's max reservation price (per-unit). */
  buyerMax:         number;
  /** Seller's min margin floor (per-unit). */
  sellerMin:        number;
  /** Currency tag (display only, all math is unit-agnostic). */
  currency?:        Currency;
  /** Quantity for total surplus computation. Optional. */
  quantity?:        number;
}

/** Individual Rationality — both sides preferred the deal to walking away. */
export interface IRBlock {
  /** Buyer surplus per unit: buyerMax - closedPrice. Negative = buyer overpaid vs their cap. */
  buyerIR:          number;
  /** Seller surplus per unit: closedPrice - sellerMin. Negative = seller closed below floor. */
  sellerIR:         number;
  /** True iff both sides have non-negative surplus. */
  bothIR:           boolean;
}

/** Zone Of Possible Agreement. */
export interface ZOPABlock {
  /** Low end of the bargaining zone (= sellerMin). */
  low:              number;
  /** High end of the bargaining zone (= buyerMax). */
  high:             number;
  /** Width of the zone (= buyerMax - sellerMin). Negative if no ZOPA. */
  width:            number;
  /** True iff sellerMin <= buyerMax (i.e., a deal was possible). */
  wasFeasible:      boolean;
}

/** Nash Bargaining Solution (symmetric). */
export interface NBSBlock {
  /** The symmetric NBS fair midpoint: (buyerMax + sellerMin) / 2. */
  fairPrice:        number;
  /** Positive = seller-favored deal; negative = buyer-favored deal. */
  deviationFromNBS: number;
  /** Same as deviationFromNBS but as a fraction of the ZOPA half-width. Useful for cross-deal comparison. */
  deviationPercent: number;
}

/** Surplus split between parties (in percent of total possible surplus). */
export interface SurplusBlock {
  /** Buyer's share of surplus: (buyerMax - closedPrice) / ZOPA.width. 0..1 */
  buyerShare:       number;
  /** Seller's share: (closedPrice - sellerMin) / ZOPA.width. 0..1 (sums with buyer to 1). */
  sellerShare:      number;
  /** Total economic surplus in currency: ZOPA.width * quantity. Only set if quantity provided. */
  totalSurplus?:    number;
}

/** Boolean flags surfaced as chips in the UI. */
export interface QualityFlags {
  /** Seller closed within 2% of its margin floor — red flag for "agent gave away too much". */
  agreementTrap:    boolean;
  /** Seller captured >70% of the available surplus. */
  sellerCapturedMost: boolean;
  /** Buyer captured >70% of the available surplus. */
  buyerCapturedMost:  boolean;
  /** Deal closed outside ZOPA (only possible if computed price is wrong or one side compromised below floor). */
  outsideZOPA:      boolean;
}

/** Top-level outcome-quality result that goes into the audit JSON. */
export interface OutcomeQuality {
  closed:           boolean;
  closedPrice:      number;
  buyerMax:         number;
  sellerMin:        number;
  currency:         Currency;
  IR:               IRBlock;
  ZOPA:             ZOPABlock;
  NBS:              NBSBlock;
  surplusSplit:     SurplusBlock;
  flags:            QualityFlags;
  /** Plain-English one-line summary suitable for an audit row. */
  summary:          string;
  /** ISO timestamp when this block was computed. */
  computedAt:       string;
}

/**
 * Compute the outcome-quality block. Pure — no side effects.
 *
 * Edge cases:
 *  - sellerMin > buyerMax (no ZOPA): IR can still be computed; ZOPA.wasFeasible = false;
 *    surplusShares are set to 0 since denominator is non-positive.
 *  - closedPrice exactly equal to buyerMax or sellerMin: shares clamp to 0 or 1.
 *  - quantity not provided: totalSurplus is omitted.
 */
export function computeOutcomeQuality(inputs: QualityInputs): OutcomeQuality {
  const { closed, closedPrice, buyerMax, sellerMin, currency = "INR", quantity } = inputs;

  // ── IR ──
  const buyerIRVal  = buyerMax  - closedPrice;
  const sellerIRVal = closedPrice - sellerMin;
  const IR: IRBlock = {
    buyerIR:   buyerIRVal,
    sellerIR:  sellerIRVal,
    bothIR:    buyerIRVal >= 0 && sellerIRVal >= 0,
  };

  // ── ZOPA ──
  const ZOPA: ZOPABlock = {
    low:         sellerMin,
    high:        buyerMax,
    width:       buyerMax - sellerMin,
    wasFeasible: sellerMin <= buyerMax,
  };

  // ── NBS ──
  const fairPrice = (buyerMax + sellerMin) / 2;
  const deviationFromNBS = closedPrice - fairPrice;
  const halfWidth = ZOPA.width / 2;
  const deviationPercent = halfWidth > 0
    ? (deviationFromNBS / halfWidth) * 100
    : 0;
  const NBS: NBSBlock = {
    fairPrice,
    deviationFromNBS,
    deviationPercent,
  };

  // ── Surplus split ──
  let buyerShare = 0;
  let sellerShare = 0;
  if (ZOPA.width > 0) {
    buyerShare  = clamp01(buyerIRVal  / ZOPA.width);
    sellerShare = clamp01(sellerIRVal / ZOPA.width);
  }
  const surplusSplit: SurplusBlock = {
    buyerShare,
    sellerShare,
    totalSurplus: quantity !== undefined && ZOPA.width > 0
      ? ZOPA.width * quantity
      : undefined,
  };

  // ── Flags ──
  // agreementTrap only makes sense for CLOSED deals — it flags a deal that
  // the seller agent gave away by closing at/near its floor. For escalations
  // the closedPrice is a synthetic midpoint and "trap" is misleading.
  const agreementTrap = closed
    && ZOPA.wasFeasible
    && sellerMin > 0
    && closedPrice <= sellerMin * 1.02;
  const flags: QualityFlags = {
    agreementTrap,
    sellerCapturedMost: sellerShare > 0.70,
    buyerCapturedMost:  buyerShare  > 0.70,
    outsideZOPA:        ZOPA.wasFeasible && (closedPrice < sellerMin || closedPrice > buyerMax),
  };

  // ── Summary ──
  const summary = buildSummary(closed, closedPrice, fairPrice, deviationFromNBS,
                                buyerShare, sellerShare, flags, currency);

  return {
    closed,
    closedPrice,
    buyerMax,
    sellerMin,
    currency,
    IR,
    ZOPA,
    NBS,
    surplusSplit,
    flags,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function buildSummary(
  closed:            boolean,
  closedPrice:       number,
  fairPrice:         number,
  deviation:         number,
  buyerShare:        number,
  sellerShare:       number,
  flags:             QualityFlags,
  currency:          Currency,
): string {
  const sym = currency === "INR" ? "₹" : "$";
  const action = closed ? "closed" : "escalated";
  if (flags.agreementTrap) {
    return `Deal ${action} at ${sym}${closedPrice} — agreement trap (seller within 2% of floor). Buyer captured ${Math.round(buyerShare * 100)}% of surplus.`;
  }
  if (!flags.outsideZOPA && Math.abs(deviation) < 1) {
    return `Deal ${action} at ${sym}${closedPrice} — essentially at NBS fair price (${sym}${fairPrice.toFixed(0)}). Surplus split ${Math.round(buyerShare * 100)}/${Math.round(sellerShare * 100)}.`;
  }
  const dir = deviation > 0 ? "above" : "below";
  return `Deal ${action} at ${sym}${closedPrice}, ${sym}${Math.abs(deviation).toFixed(0)} ${dir} NBS fair price of ${sym}${fairPrice.toFixed(0)}. ${deviation < 0 ? "Buyer" : "Seller"} captured ${Math.round(deviation < 0 ? buyerShare * 100 : sellerShare * 100)}% of surplus.`;
}
