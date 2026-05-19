// ================= WEDGE1 / M2-β.1 — CONSULTATION ROUTER =================
//
// Dispatcher that, given the active seller-response mode, decides which
// sub-agents to consult and gathers their ConsultationRecord values into a
// single bundle. The L2 executive (M2-β.3) calls this once per think-cycle;
// the audit (M2-γ) embeds the resulting `consultations[]` block verbatim.
//
// Routing rules (mode → advisors):
//   BASIC_SALES_QUOTING_1   → treasury only
//   L1_DELEGATED_ADVISORS   → treasury + inventory + logistics
//   L2_EXECUTIVE_REASONER   → treasury + inventory + logistics + credit
//   L3_STYLE_AND_AUTONOMY   → forbidden by validateSellerResponseMode at boot;
//                              router treats them as if L2 (defensive — should
//   L4_LEARNED_PROFILES_AND_PD → never reach this branch at runtime).
//
// Concurrency: all consultations run in parallel via Promise.all. Each
// provider already returns a well-formed ConsultationRecord on failure
// (never throws), so the bundle is always complete in shape even when
// individual sub-agents fail. The L2 executive's defensive branches then
// inspect each record's `success` flag.
//
// No file I/O here. No fixture paths. Pure dispatch + Promise.all.

import type { SellerResponseMode } from "./negotiation-mode.js";

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
 * when (a) the mode permits it and (b) the corresponding input is supplied.
 * A caller can skip a sub-agent by omitting its input.
 */
export interface ConsultationRouterInput {
  mode: SellerResponseMode;
  treasury?:  TreasuryConsultationInput;
  inventory?: InventoryConsultationInput;
  logistics?: LogisticsConsultationInput;
  credit?:    CreditConsultationInput;
}

/**
 * Bundle returned by the router. Each field is populated only if the
 * corresponding sub-agent was both mode-permitted AND given an input.
 * Failed consultations still appear (with `success: false`) — the field is
 * absent only when the sub-agent wasn't consulted at all.
 */
export interface ConsultationBundle {
  treasury?:  ConsultationRecord<TreasuryConsultation>;
  inventory?: ConsultationRecord<InventoryConsultation>;
  logistics?: ConsultationRecord<LogisticsConsultation>;
  credit?:    ConsultationRecord<CreditConsultation>;
  /** Echoes the mode the router was called with, for audit traceability. */
  mode: SellerResponseMode;
  /** Per-bundle wall-clock — total time the router spent (max of parallel branches). */
  routerLatencyMs: number;
}

// ─── Mode ordering ────────────────────────────────────────────────────────

const MODE_RANK: Record<SellerResponseMode, number> = {
  BASIC_SALES_QUOTING_1:       0,
  L1_DELEGATED_ADVISORS:       1,
  L2_EXECUTIVE_REASONER:       2,
  L3_STYLE_AND_AUTONOMY:       3,
  L4_LEARNED_PROFILES_AND_PD:  4,
};

function modeAtLeast(actual: SellerResponseMode, threshold: SellerResponseMode): boolean {
  return (MODE_RANK[actual] ?? -1) >= (MODE_RANK[threshold] ?? Infinity);
}

// ─── Mode-permission predicates (single source of truth) ──────────────────
//
// Exported so unit tests + the L2 executive can ask the same question
// without duplicating the rule. Keeps the matrix in one place.

export function shouldConsultTreasury(mode: SellerResponseMode): boolean {
  // Treasury is always-on in every shippable mode.
  return modeAtLeast(mode, "BASIC_SALES_QUOTING_1");
}

export function shouldConsultInventory(mode: SellerResponseMode): boolean {
  return modeAtLeast(mode, "L1_DELEGATED_ADVISORS");
}

export function shouldConsultLogistics(mode: SellerResponseMode): boolean {
  return modeAtLeast(mode, "L1_DELEGATED_ADVISORS");
}

export function shouldConsultCredit(mode: SellerResponseMode): boolean {
  return modeAtLeast(mode, "L2_EXECUTIVE_REASONER");
}

// ─── The router ───────────────────────────────────────────────────────────

/**
 * Consult all mode-permitted sub-agents for which an input was supplied.
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
 *    bundle's `mode` field to know what should have been there.
 */
export async function consultAll(
  input: ConsultationRouterInput,
): Promise<ConsultationBundle> {
  const start  = Date.now();
  const bundle: ConsultationBundle = {
    mode:            input.mode,
    routerLatencyMs: 0, // filled in after Promise.all
  };

  const tasks: Array<Promise<void>> = [];

  if (input.treasury && shouldConsultTreasury(input.mode)) {
    tasks.push(
      getTreasuryProvider()
        .consult(input.treasury)
        .then((r) => { bundle.treasury = r; })
        .catch(() => { /* provider promised not to throw; defensive no-op */ }),
    );
  }

  if (input.inventory && shouldConsultInventory(input.mode)) {
    tasks.push(
      getInventoryProvider()
        .consult(input.inventory)
        .then((r) => { bundle.inventory = r; })
        .catch(() => { /* defensive no-op */ }),
    );
  }

  if (input.logistics && shouldConsultLogistics(input.mode)) {
    tasks.push(
      getLogisticsProvider()
        .consult(input.logistics)
        .then((r) => { bundle.logistics = r; })
        .catch(() => { /* defensive no-op */ }),
    );
  }

  if (input.credit && shouldConsultCredit(input.mode)) {
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
