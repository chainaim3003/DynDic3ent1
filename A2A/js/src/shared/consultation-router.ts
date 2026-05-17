// ================= WEDGE1 / M2-β.1 — CONSULTATION ROUTER =================
//
// Dispatcher that, given the active tier, decides which sub-agents to
// consult and gathers their ConsultationRecord values into a single bundle.
// The L2 executive (M2-β.3) calls this once per decision point; the audit
// (M2-γ) embeds the resulting `consultations[]` block verbatim.
//
// Routing rules (matches the BACKLOG tier matrix exactly):
//   BASIC1   → treasury only
//   ADVANCED1 → treasury + inventory + logistics
//   ADVANCED2 → treasury + inventory + logistics + credit
//   ADVANCED3 / ADVANCED4 → forbidden by validateTier; router treats them
//                            as if ADVANCED2 (defensive — should never reach
//                            this branch at runtime because validateTier
//                            fails-fast at agent boot).
//
// Concurrency: all consultations run in parallel via Promise.all. Each
// provider already returns a well-formed ConsultationRecord on failure
// (never throws), so the bundle is always complete in shape even when
// individual sub-agents fail. The L2 executive's defensive branches then
// inspect each record's `success` flag.
//
// No file I/O here. No fixture paths. Pure dispatch + Promise.all.

import type { NegotiationTier } from "./negotiation-mode.js";

import type {
  ConsultationRecord,
  InventoryConsultation, InventoryConsultationInput,
  LogisticsConsultation, LogisticsConsultationInput,
  CreditConsultation,    CreditConsultationInput,
  TreasuryConsultation,  TreasuryConsultationInput,
} from "./provider-types.js";

import { getTreasuryProvider }  from "./treasury-provider.js";
import { getInventoryProvider } from "./inventory-provider.js";
import { getLogisticsProvider } from "./logistics-provider.js";
import { getCreditProvider }    from "./credit-provider.js";

// ─── Inputs / outputs ─────────────────────────────────────────────────────

/**
 * Optional inputs for each sub-agent. The router consults a sub-agent only
 * when (a) the tier permits it and (b) the corresponding input is supplied.
 * A caller can skip a sub-agent by omitting its input.
 */
export interface ConsultationRouterInput {
  tier: NegotiationTier;
  treasury?:  TreasuryConsultationInput;
  inventory?: InventoryConsultationInput;
  logistics?: LogisticsConsultationInput;
  credit?:    CreditConsultationInput;
}

/**
 * Bundle returned by the router. Each field is populated only if the
 * corresponding sub-agent was both tier-permitted AND given an input.
 * Failed consultations still appear (with `success: false`) — the field is
 * absent only when the sub-agent wasn't consulted at all.
 */
export interface ConsultationBundle {
  treasury?:  ConsultationRecord<TreasuryConsultation>;
  inventory?: ConsultationRecord<InventoryConsultation>;
  logistics?: ConsultationRecord<LogisticsConsultation>;
  credit?:    ConsultationRecord<CreditConsultation>;
  /** Echoes the tier the router was called with, for audit traceability. */
  tier: NegotiationTier;
  /** Per-bundle wall-clock — total time the router spent (max of parallel branches). */
  routerLatencyMs: number;
}

// ─── Tier ordering ────────────────────────────────────────────────────────

const TIER_RANK: Record<NegotiationTier, number> = {
  BASIC1:    0,
  ADVANCED1: 1,
  ADVANCED2: 2,
  ADVANCED3: 3,
  ADVANCED4: 4,
};

function tierAtLeast(actual: NegotiationTier, threshold: NegotiationTier): boolean {
  return (TIER_RANK[actual] ?? -1) >= (TIER_RANK[threshold] ?? Infinity);
}

// ─── Tier-permission predicates (single source of truth) ──────────────────
//
// Exported so unit tests + the L2 executive can ask the same question
// without duplicating the rule. Keeps the matrix in one place.

export function shouldConsultTreasury(tier: NegotiationTier): boolean {
  // Treasury is always-on in BASIC1+ — every shippable tier.
  return tierAtLeast(tier, "BASIC1");
}

export function shouldConsultInventory(tier: NegotiationTier): boolean {
  return tierAtLeast(tier, "ADVANCED1");
}

export function shouldConsultLogistics(tier: NegotiationTier): boolean {
  return tierAtLeast(tier, "ADVANCED1");
}

export function shouldConsultCredit(tier: NegotiationTier): boolean {
  return tierAtLeast(tier, "ADVANCED2");
}

// ─── The router ───────────────────────────────────────────────────────────

/**
 * Consult all tier-permitted sub-agents for which an input was supplied.
 * Returns a ConsultationBundle.
 *
 * Notes:
 *  - Concurrent: all consultations run via Promise.all. The bundle's
 *    `routerLatencyMs` is the wall-clock duration of the slowest branch
 *    (not the sum) — useful for SLO tracking.
 *  - Failures are surfaced, not hidden: each ConsultationRecord carries its
 *    own success flag and error string. The router does NOT short-circuit
 *    on a single failure; if treasury fails but credit succeeds, both end
 *    up in the bundle.
 *  - Never throws. If a provider somehow throws (shouldn't happen — they
 *    catch internally), the router still returns a partial bundle and the
 *    error is surfaced via the affected field being absent. Inspect the
 *    bundle's `tier` field to know what should have been there.
 */
export async function consultAll(
  input: ConsultationRouterInput,
): Promise<ConsultationBundle> {
  const start  = Date.now();
  const bundle: ConsultationBundle = {
    tier:            input.tier,
    routerLatencyMs: 0, // filled in after Promise.all
  };

  const tasks: Array<Promise<void>> = [];

  if (input.treasury && shouldConsultTreasury(input.tier)) {
    tasks.push(
      getTreasuryProvider()
        .consult(input.treasury)
        .then((r) => { bundle.treasury = r; })
        .catch(() => { /* provider promised not to throw; defensive no-op */ }),
    );
  }

  if (input.inventory && shouldConsultInventory(input.tier)) {
    tasks.push(
      getInventoryProvider()
        .consult(input.inventory)
        .then((r) => { bundle.inventory = r; })
        .catch(() => { /* defensive no-op */ }),
    );
  }

  if (input.logistics && shouldConsultLogistics(input.tier)) {
    tasks.push(
      getLogisticsProvider()
        .consult(input.logistics)
        .then((r) => { bundle.logistics = r; })
        .catch(() => { /* defensive no-op */ }),
    );
  }

  if (input.credit && shouldConsultCredit(input.tier)) {
    tasks.push(
      getCreditProvider()
        .consult(input.credit)
        .then((r) => { bundle.credit = r; })
        .catch(() => { /* defensive no-op */ }),
    );
  }

  await Promise.all(tasks);

  bundle.routerLatencyMs = Date.now() - start;
  return bundle;
}
