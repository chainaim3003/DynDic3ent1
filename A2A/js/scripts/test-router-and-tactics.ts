// ============================================================================
// scripts/test-router-and-tactics.ts  —  WEDGE1 / M2-β.1: router + tactics verification
// ============================================================================
//
// Verifies the two new helper modules landed in M2-β.1:
//   - src/shared/consultation-router.ts   (tier-aware dispatch + Promise.all bundling)
//   - src/shared/tactics-engine.ts        (pure math: effectiveFloor, nbsMidpoint,
//                                          alphaWeightedUtility, deltaDiscount)
//
// What this guards:
//   1. Router tier matrix is correct: BASIC1 routes only treasury;
//      ADVANCED1 adds inventory+logistics; ADVANCED2 adds credit.
//   2. Router predicates (shouldConsultTreasury / Inventory / Logistics / Credit)
//      match the matrix.
//   3. Router never throws even when a downstream provider can't reach its
//      endpoint — partial bundles are returned with failed ConsultationRecord
//      values inside.
//   4. Tactics engine math is correct for every adjustment:
//        - effectiveFloor with no sub-agents → baseFloor only
//        - effectiveFloor with inventory canFulfill=false → +2% premium
//        - effectiveFloor with logistics → +(usd × rate / qty)
//        - effectiveFloor with credit → +baseFloor × pd1y × lgd
//        - effectiveFloor when sub-agent record has success=false → adjustment 0,
//          sub-agent listed in missingSubAgents
//   5. nbsMidpoint handles positive ZOPA, empty ZOPA, and degenerate zero-width.
//   6. alphaWeightedUtility components are [0,1]-clamped; missing data yields
//      the neutral 0.5 default; custom weights flow through.
//   7. deltaDiscount classification bands fire at the right thresholds.
//
// Run from A2A/js/:
//   npx tsx scripts/test-router-and-tactics.ts
// Exit 0 on all pass; exit 1 on any failure.
// ============================================================================

import {
  consultAll,
  shouldConsultTreasury,
  shouldConsultInventory,
  shouldConsultLogistics,
  shouldConsultCredit,
} from "../src/shared/consultation-router.js";

import {
  effectiveFloor,
  nbsMidpoint,
  alphaWeightedUtility,
  deltaDiscount,
} from "../src/shared/tactics-engine.js";

import { resetInventoryProviderForTest } from "../src/shared/inventory-provider.js";
import { resetLogisticsProviderForTest } from "../src/shared/logistics-provider.js";
import { resetCreditProviderForTest    } from "../src/shared/credit-provider.js";
import { resetTreasuryProviderForTest  } from "../src/shared/treasury-provider.js";

import type {
  ConsultationRecord,
  InventoryConsultation,
  LogisticsConsultation,
  CreditConsultation,
} from "../src/shared/provider-types.js";

// ─── Tiny test harness ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  ✗ ${label}`);
  }
}

function approxEqual(actual: number, expected: number, tolerance = 0.01): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return Math.abs(actual - expected) <= tolerance;
}

function section(name: string): void {
  console.log("");
  console.log(name);
}

function withCleanEnv(body: () => Promise<void>): Promise<void> {
  const snapshot = {
    INVENTORY_MODE: process.env.INVENTORY_MODE,
    LOGISTICS_MODE: process.env.LOGISTICS_MODE,
    CREDIT_MODE:    process.env.CREDIT_MODE,
    TREASURY_MODE:  process.env.TREASURY_MODE,
    TREASURY_URL:   process.env.TREASURY_URL,
  };
  delete process.env.INVENTORY_MODE;
  delete process.env.LOGISTICS_MODE;
  delete process.env.CREDIT_MODE;
  delete process.env.TREASURY_MODE;
  delete process.env.TREASURY_URL;
  resetInventoryProviderForTest();
  resetLogisticsProviderForTest();
  resetCreditProviderForTest();
  resetTreasuryProviderForTest();

  return body().finally(() => {
    function restore(key: keyof typeof snapshot): void {
      const v = snapshot[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
    restore("INVENTORY_MODE");
    restore("LOGISTICS_MODE");
    restore("CREDIT_MODE");
    restore("TREASURY_MODE");
    restore("TREASURY_URL");
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();
    resetTreasuryProviderForTest();
  });
}

// ─── §1 — Router predicate matrix (single source of truth) ────────────────

function checkRouterPredicates(): void {
  section("§1 Router predicates — tier matrix");

  // BASIC1: treasury only
  assert(shouldConsultTreasury("BASIC1") === true,   `BASIC1 → treasury`);
  assert(shouldConsultInventory("BASIC1") === false, `BASIC1 → NOT inventory`);
  assert(shouldConsultLogistics("BASIC1") === false, `BASIC1 → NOT logistics`);
  assert(shouldConsultCredit("BASIC1") === false,    `BASIC1 → NOT credit`);

  // ADVANCED1: + inventory + logistics
  assert(shouldConsultTreasury("ADVANCED1") === true,   `ADVANCED1 → treasury`);
  assert(shouldConsultInventory("ADVANCED1") === true,  `ADVANCED1 → inventory`);
  assert(shouldConsultLogistics("ADVANCED1") === true,  `ADVANCED1 → logistics`);
  assert(shouldConsultCredit("ADVANCED1") === false,    `ADVANCED1 → NOT credit`);

  // ADVANCED2: + credit
  assert(shouldConsultTreasury("ADVANCED2") === true,  `ADVANCED2 → treasury`);
  assert(shouldConsultInventory("ADVANCED2") === true, `ADVANCED2 → inventory`);
  assert(shouldConsultLogistics("ADVANCED2") === true, `ADVANCED2 → logistics`);
  assert(shouldConsultCredit("ADVANCED2") === true,    `ADVANCED2 → credit`);
}

// ─── §2 — Router runtime: BASIC1 only consults treasury ────────────────────

async function checkRouterBasic1(): Promise<void> {
  section("§2 Router runtime — BASIC1 with all inputs supplied → only treasury called");

  await withCleanEnv(async () => {
    // Treasury in demo mode is stubbed (returns success=false); that's fine
    // for this test — we only care WHICH sub-agents the router consulted.
    process.env.TREASURY_MODE  = "demo";
    process.env.INVENTORY_MODE = "demo";
    process.env.LOGISTICS_MODE = "demo";
    process.env.CREDIT_MODE    = "demo";
    resetTreasuryProviderForTest();
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();

    const bundle = await consultAll({
      tier:      "BASIC1",
      treasury:  { negotiationId: "T1", pricePerUnit: 370, quantity: 50000, round: 1 },
      inventory: { productCode: "FAB-COTTON-180GSM", quantity: 50000 },
      logistics: { originPort: "INMAA", destinationPort: "USLAX", quantity: 50000 },
      credit:    { lei: "54930012QJWZMYHNJW95" },
    });

    assert(bundle.tier === "BASIC1",          `bundle.tier echoed`);
    assert(bundle.treasury !== undefined,     `BASIC1: treasury consulted`);
    assert(bundle.inventory === undefined,    `BASIC1: inventory NOT consulted (tier-gated)`);
    assert(bundle.logistics === undefined,    `BASIC1: logistics NOT consulted (tier-gated)`);
    assert(bundle.credit === undefined,       `BASIC1: credit NOT consulted (tier-gated)`);
    assert(typeof bundle.routerLatencyMs === "number" && bundle.routerLatencyMs >= 0,
                                               `routerLatencyMs recorded`);
  });
}

// ─── §3 — Router runtime: ADVANCED1 consults treasury + inventory + logistics ──

async function checkRouterAdv1(): Promise<void> {
  section("§3 Router runtime — ADVANCED1 → treasury + inventory + logistics, NOT credit");

  await withCleanEnv(async () => {
    process.env.TREASURY_MODE  = "demo";
    process.env.INVENTORY_MODE = "demo";
    process.env.LOGISTICS_MODE = "demo";
    process.env.CREDIT_MODE    = "demo";
    resetTreasuryProviderForTest();
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();

    const bundle = await consultAll({
      tier:      "ADVANCED1",
      treasury:  { negotiationId: "T1", pricePerUnit: 370, quantity: 50000, round: 1 },
      inventory: { productCode: "FAB-COTTON-180GSM", quantity: 50000 },
      logistics: { originPort: "INMAA", destinationPort: "USLAX", quantity: 50000 },
      credit:    { lei: "54930012QJWZMYHNJW95" },
    });

    assert(bundle.tier === "ADVANCED1",       `bundle.tier echoed`);
    assert(bundle.treasury  !== undefined,    `ADV1: treasury consulted`);
    assert(bundle.inventory !== undefined,    `ADV1: inventory consulted`);
    assert(bundle.logistics !== undefined,    `ADV1: logistics consulted`);
    assert(bundle.credit    === undefined,    `ADV1: credit NOT consulted (tier-gated)`);

    // Inventory/logistics returned success=true (demo fixtures load cleanly).
    assert(bundle.inventory?.success === true, `ADV1: inventory consultation success`);
    assert(bundle.logistics?.success === true, `ADV1: logistics consultation success`);
  });
}

// ─── §4 — Router runtime: ADVANCED2 consults all 4 ────────────────────────

async function checkRouterAdv2(): Promise<void> {
  section("§4 Router runtime — ADVANCED2 → all four sub-agents called");

  await withCleanEnv(async () => {
    process.env.TREASURY_MODE  = "demo";
    process.env.INVENTORY_MODE = "demo";
    process.env.LOGISTICS_MODE = "demo";
    process.env.CREDIT_MODE    = "demo";
    resetTreasuryProviderForTest();
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();

    const bundle = await consultAll({
      tier:      "ADVANCED2",
      treasury:  { negotiationId: "T1", pricePerUnit: 370, quantity: 50000, round: 1 },
      inventory: { productCode: "FAB-COTTON-180GSM", quantity: 50000 },
      logistics: { originPort: "INMAA", destinationPort: "USLAX", quantity: 50000 },
      credit:    { lei: "54930012QJWZMYHNJW95" },
    });

    assert(bundle.tier === "ADVANCED2",        `bundle.tier echoed`);
    assert(bundle.treasury  !== undefined,     `ADV2: treasury consulted`);
    assert(bundle.inventory !== undefined,     `ADV2: inventory consulted`);
    assert(bundle.logistics !== undefined,     `ADV2: logistics consulted`);
    assert(bundle.credit    !== undefined,     `ADV2: credit consulted`);

    assert(bundle.inventory?.success === true, `ADV2: inventory success`);
    assert(bundle.logistics?.success === true, `ADV2: logistics success`);
    assert(bundle.credit?.success    === true, `ADV2: credit success`);
  });
}

// ─── §5 — Router: omitted inputs are not consulted ────────────────────────

async function checkRouterMissingInputs(): Promise<void> {
  section("§5 Router runtime — ADV2 with only treasury input → other 3 not called");

  await withCleanEnv(async () => {
    process.env.TREASURY_MODE  = "demo";
    process.env.INVENTORY_MODE = "demo";
    process.env.LOGISTICS_MODE = "demo";
    process.env.CREDIT_MODE    = "demo";
    resetTreasuryProviderForTest();
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();

    const bundle = await consultAll({
      tier:     "ADVANCED2",
      treasury: { negotiationId: "T1", pricePerUnit: 370, quantity: 50000, round: 1 },
    });

    assert(bundle.treasury  !== undefined,     `treasury consulted (input given)`);
    assert(bundle.inventory === undefined,     `inventory NOT consulted (no input)`);
    assert(bundle.logistics === undefined,     `logistics NOT consulted (no input)`);
    assert(bundle.credit    === undefined,     `credit NOT consulted (no input)`);
  });
}

// ─── §6 — Router: partial bundle when one provider is unreachable ─────────

async function checkRouterPartialBundle(): Promise<void> {
  section("§6 Router runtime — ADV2 with treasury unreachable → partial bundle, no throw");

  await withCleanEnv(async () => {
    // Treasury in real mode but pointed at a refused port → fails fast,
    // returns success=false. Other 3 in demo mode succeed normally.
    process.env.TREASURY_MODE  = "real";
    process.env.TREASURY_URL   = "http://127.0.0.1:1/consult";
    process.env.INVENTORY_MODE = "demo";
    process.env.LOGISTICS_MODE = "demo";
    process.env.CREDIT_MODE    = "demo";
    resetTreasuryProviderForTest();
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();

    let bundle;
    try {
      bundle = await consultAll({
        tier:      "ADVANCED2",
        treasury:  { negotiationId: "T1", pricePerUnit: 370, quantity: 50000, round: 1 },
        inventory: { productCode: "FAB-COTTON-180GSM", quantity: 50000 },
        logistics: { originPort: "INMAA", destinationPort: "USLAX", quantity: 50000 },
        credit:    { lei: "54930012QJWZMYHNJW95" },
      });
    } catch (err: any) {
      assert(false, `router threw instead of returning partial bundle (${err?.message ?? err})`);
      return;
    }

    assert(bundle.treasury !== undefined,           `treasury record present (even on failure)`);
    assert(bundle.treasury?.success === false,      `treasury success=false (unreachable)`);
    assert(typeof bundle.treasury?.error === "string" && bundle.treasury.error.length > 0,
                                                     `treasury error message present`);
    assert(bundle.inventory?.success === true,      `inventory still succeeded`);
    assert(bundle.logistics?.success === true,      `logistics still succeeded`);
    assert(bundle.credit?.success    === true,      `credit still succeeded`);
  });
}

// ─── §7 — effectiveFloor: baseFloor with no sub-agents ────────────────────

function checkEffectiveFloorBase(): void {
  section("§7 Tactics — effectiveFloor with no sub-agent data");

  const r = effectiveFloor({
    marginPrice:     350,
    minProfitMargin: 5,
    quantity:        50000,
  });

  assert(r.baseFloor === 355,                        `baseFloor = margin + buffer = 355`);
  assert(r.inventoryAdjustment === 0,                `no inventory → adjustment 0`);
  assert(r.logisticsAdjustment === 0,                `no logistics → adjustment 0`);
  assert(r.creditAdjustment === 0,                   `no credit → adjustment 0`);
  assert(r.total === 355,                            `total = baseFloor`);
  assert(r.missingSubAgents.length === 0,            `no records passed → no missing flagged`);
  assert(r.rationale.includes("base floor"),         `rationale mentions base floor`);
}

// ─── §8 — effectiveFloor: each adjustment in isolation ────────────────────

function checkEffectiveFloorAdjustments(): void {
  section("§8 Tactics — effectiveFloor individual adjustments");

  // Inventory: canFulfill=false + leadTime > 0 → 2% premium on baseFloor
  const invRec: ConsultationRecord<InventoryConsultation> = {
    metadata: { subAgent: "inventory", dataMode: "demo", performedAt: new Date().toISOString(),
                dataSource: "DEMO-DATA/inventory/test.json" },
    success: true,
    result: {
      productCode: "FAB-COTTON-180GSM",
      availableQty: 35000, reservedQty: 8000,
      leadTimeDays: 30, earliestShipDate: "2026-06-14",
      canFulfill: false,
      warehouseRef: "TEST",
    },
  };
  const rInv = effectiveFloor({
    marginPrice: 350, minProfitMargin: 5, quantity: 50000,
    inventoryRecord: invRec,
  });
  assert(approxEqual(rInv.inventoryAdjustment, 355 * 0.02), `inventory canFulfill=false → 2% × 355 = 7.10`);
  assert(approxEqual(rInv.total, 355 + 355 * 0.02),         `total = baseFloor + inventoryAdjustment`);

  // Inventory: canFulfill=true → no adjustment
  const invOkRec: ConsultationRecord<InventoryConsultation> = {
    ...invRec,
    result: { ...invRec.result!, canFulfill: true },
  };
  const rInvOk = effectiveFloor({
    marginPrice: 350, minProfitMargin: 5, quantity: 50000,
    inventoryRecord: invOkRec,
  });
  assert(rInvOk.inventoryAdjustment === 0, `inventory canFulfill=true → no adjustment`);

  // Logistics: (bestRateUsd × usdInr) / quantity
  const logRec: ConsultationRecord<LogisticsConsultation> = {
    metadata: { subAgent: "logistics", dataMode: "demo", performedAt: new Date().toISOString(),
                dataSource: "DEMO-DATA/logistics/test.json" },
    success: true,
    result: {
      originPort: "INMAA", destinationPort: "USLAX",
      estimatedTransitDays: 24, bestRateUsd: 8400,
      carriers: [{ scac: "MSCU", name: "MSC", transitDays: 27, rateUsd: 8400, validUntil: "2026-06-01" }],
      canMeetDeliveryDate: true,
    },
  };
  const rLog = effectiveFloor({
    marginPrice: 350, minProfitMargin: 5, quantity: 50000,
    logisticsRecord: logRec,
  });
  // 8400 × 85 / 50000 = 14.28
  assert(approxEqual(rLog.logisticsAdjustment, (8400 * 85) / 50000),
                                                              `logistics: (8400 × 85) / 50000 ≈ 14.28`);
  assert(approxEqual(rLog.total, 355 + (8400 * 85) / 50000),  `total includes logistics`);

  // Logistics with custom usdInrRate
  const rLogCustom = effectiveFloor({
    marginPrice: 350, minProfitMargin: 5, quantity: 50000,
    logisticsRecord: logRec,
    usdInrRate: 90,
  });
  assert(approxEqual(rLogCustom.logisticsAdjustment, (8400 * 90) / 50000),
                                                              `logistics with custom usdInrRate=90`);

  // Credit: baseFloor × pd1y × lgd
  const creRec: ConsultationRecord<CreditConsultation> = {
    metadata: { subAgent: "credit", dataMode: "demo", performedAt: new Date().toISOString(),
                dataSource: "DEMO-DATA/credit/test.json" },
    success: true,
    result: {
      lei: "54930012QJWZMYHNJW95",
      legalEntityName: "TOMMY HILFIGER EUROPE B.V.",
      gleifStatus: "ACTIVE",
      financialHealthScore: 72,
      pd1y: 0.018, lgd: 0.45,
      recommendedTerms: "NET_30",
      rationale: "test",
    },
  };
  const rCre = effectiveFloor({
    marginPrice: 350, minProfitMargin: 5, quantity: 50000,
    creditRecord: creRec,
  });
  // 355 × 0.018 × 0.45 = 2.876
  assert(approxEqual(rCre.creditAdjustment, 355 * 0.018 * 0.45), `credit: 355 × 0.018 × 0.45 ≈ 2.876`);
  assert(approxEqual(rCre.total, 355 + 355 * 0.018 * 0.45),     `total includes credit-risk premium`);
}

// ─── §9 — effectiveFloor: failed sub-agent records flagged as missing ─────

function checkEffectiveFloorMissing(): void {
  section("§9 Tactics — effectiveFloor with failed sub-agent records");

  const failedInv: ConsultationRecord<InventoryConsultation> = {
    metadata: { subAgent: "inventory", dataMode: "real", performedAt: new Date().toISOString(),
                dataSource: "(unavailable)" },
    success: false,
    error: "real-mode not yet implemented",
  };
  const failedLog: ConsultationRecord<LogisticsConsultation> = {
    metadata: { subAgent: "logistics", dataMode: "real", performedAt: new Date().toISOString(),
                dataSource: "(unavailable)" },
    success: false,
    error: "endpoint unreachable",
  };
  const failedCre: ConsultationRecord<CreditConsultation> = {
    metadata: { subAgent: "credit", dataMode: "real", performedAt: new Date().toISOString(),
                dataSource: "(unavailable)" },
    success: false,
    error: "GLEIF down",
  };

  const r = effectiveFloor({
    marginPrice: 350, minProfitMargin: 5, quantity: 50000,
    inventoryRecord: failedInv,
    logisticsRecord: failedLog,
    creditRecord:    failedCre,
  });

  assert(r.inventoryAdjustment === 0,                          `failed inventory → 0 adjustment`);
  assert(r.logisticsAdjustment === 0,                          `failed logistics → 0 adjustment`);
  assert(r.creditAdjustment    === 0,                          `failed credit → 0 adjustment`);
  assert(r.total === 355,                                       `total = baseFloor only`);
  assert(r.missingSubAgents.includes("inventory"),              `inventory flagged missing`);
  assert(r.missingSubAgents.includes("logistics"),              `logistics flagged missing`);
  assert(r.missingSubAgents.includes("credit"),                 `credit flagged missing`);
  assert(r.rationale.includes("inventory sub-agent unavailable"), `rationale notes inventory unavailable`);
}

// ─── §10 — nbsMidpoint: ZOPA semantics ────────────────────────────────────

function checkNbsMidpoint(): void {
  section("§10 Tactics — nbsMidpoint ZOPA semantics");

  const positive = nbsMidpoint({ buyerMax: 400, sellerMin: 350 });
  assert(positive.zopaPositive === true,                       `positive ZOPA: zopaPositive=true`);
  assert(positive.midpoint === 375,                             `positive ZOPA: midpoint = 375`);
  assert(positive.zopaWidth === 50,                             `positive ZOPA: width = 50`);

  const empty = nbsMidpoint({ buyerMax: 300, sellerMin: 350 });
  assert(empty.zopaPositive === false,                          `empty ZOPA: zopaPositive=false`);
  assert(Number.isNaN(empty.midpoint),                          `empty ZOPA: midpoint=NaN`);
  assert(empty.zopaWidth === -50,                               `empty ZOPA: negative width preserved`);

  const degenerate = nbsMidpoint({ buyerMax: 350, sellerMin: 350 });
  assert(degenerate.zopaPositive === false,                     `degenerate (width=0): zopaPositive=false`);
  assert(Number.isNaN(degenerate.midpoint),                     `degenerate: midpoint=NaN`);
}

// ─── §11 — alphaWeightedUtility: components + clamping + custom weights ───

function checkAlphaUtility(): void {
  section("§11 Tactics — alphaWeightedUtility components and weights");

  // Price at floor → priceUtility 0
  const atFloor = alphaWeightedUtility({ pricePerUnit: 355, effectiveFloor: 355 });
  assert(atFloor.components.price === 0,                       `price = floor → priceUtility 0`);
  assert(atFloor.components.speed === 0.5,                     `no speed data → neutral 0.5`);
  assert(atFloor.components.creditSafety === 0.5,              `no credit data → neutral 0.5`);
  // utility = 0.6×0 + 0.2×0.5 + 0.2×0.5 = 0.2
  assert(approxEqual(atFloor.utility, 0.2),                    `utility = 0.2 at floor with neutral defaults`);

  // Price 50% above floor → priceUtility 1
  const high = alphaWeightedUtility({ pricePerUnit: 355 * 1.5, effectiveFloor: 355 });
  assert(high.components.price === 1,                          `price = 1.5× floor → priceUtility 1 (capped)`);

  // Price 25% above floor → priceUtility 0.5
  const mid = alphaWeightedUtility({ pricePerUnit: 355 * 1.25, effectiveFloor: 355 });
  assert(approxEqual(mid.components.price, 0.5),               `price = 1.25× floor → priceUtility 0.5`);

  // Speed: 0 days → 1
  const fast = alphaWeightedUtility({ pricePerUnit: 355, effectiveFloor: 355, estimatedTransitDays: 0 });
  assert(fast.components.speed === 1,                          `transit 0 days → speed 1`);

  // Speed: 90 days → 0
  const slow = alphaWeightedUtility({ pricePerUnit: 355, effectiveFloor: 355, estimatedTransitDays: 90 });
  assert(slow.components.speed === 0,                          `transit 90 days → speed 0`);

  // Credit safety: pd1y=0 → 1
  const safe = alphaWeightedUtility({ pricePerUnit: 355, effectiveFloor: 355, pd1y: 0 });
  assert(safe.components.creditSafety === 1,                   `pd1y=0 → creditSafety 1`);

  // Credit safety: pd1y=1 → 0
  const risky = alphaWeightedUtility({ pricePerUnit: 355, effectiveFloor: 355, pd1y: 1 });
  assert(risky.components.creditSafety === 0,                  `pd1y=1 → creditSafety 0`);

  // Custom weights flow through
  const custom = alphaWeightedUtility({
    pricePerUnit: 355, effectiveFloor: 355,
    alphaPrice: 1.0, alphaSpeed: 0, alphaCreditSafety: 0,
  });
  assert(custom.weights.alphaPrice === 1,                      `custom alphaPrice=1 echoed`);
  assert(custom.weights.alphaSpeed === 0,                      `custom alphaSpeed=0 echoed`);
  assert(custom.utility === 0,                                  `with weight 1 on price-at-floor (0) → utility 0`);

  // Utility is clamped to [0,1]
  const veryHigh = alphaWeightedUtility({ pricePerUnit: 1000, effectiveFloor: 100 });
  assert(veryHigh.utility >= 0 && veryHigh.utility <= 1,       `utility clamped to [0,1]`);
}

// ─── §12 — deltaDiscount: classification bands ────────────────────────────

function checkDeltaDiscount(): void {
  section("§12 Tactics — deltaDiscount classification bands");

  // Premium: candidate > market by >5% → discountPercent < -5
  const premium = deltaDiscount({ candidatePrice: 110, marketReferencePrice: 100 });
  assert(premium.discountPercent === -10,                      `+10% above market → discountPercent=-10`);
  assert(premium.classification === "premium",                  `> +5% above market → premium`);

  // Fair: within ±5%
  const fairEq = deltaDiscount({ candidatePrice: 100, marketReferencePrice: 100 });
  assert(fairEq.discountPercent === 0,                          `equal → 0%`);
  assert(fairEq.classification === "fair",                      `equal → fair`);

  const fairLow = deltaDiscount({ candidatePrice: 96, marketReferencePrice: 100 });
  assert(fairLow.classification === "fair",                     `4% discount → fair`);

  const fairHigh = deltaDiscount({ candidatePrice: 105, marketReferencePrice: 100 });
  assert(fairHigh.classification === "fair",                    `5% premium (-5 discount) → fair`);

  // Discounted: 5-15% below market
  const discounted10 = deltaDiscount({ candidatePrice: 90, marketReferencePrice: 100 });
  assert(discounted10.discountPercent === 10,                   `10% discount → 10%`);
  assert(discounted10.classification === "discounted",          `10% below → discounted`);

  const discounted15 = deltaDiscount({ candidatePrice: 85, marketReferencePrice: 100 });
  assert(discounted15.classification === "discounted",          `15% below → discounted (boundary)`);

  // Below-market: >15% discount
  const below = deltaDiscount({ candidatePrice: 80, marketReferencePrice: 100 });
  assert(below.discountPercent === 20,                          `20% discount → 20%`);
  assert(below.classification === "below-market",               `>15% below → below-market`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("==============================================================");
  console.log("  WEDGE1 / M2-β.1 — Router + Tactics Engine Verification");
  console.log("==============================================================");

  checkRouterPredicates();
  await checkRouterBasic1();
  await checkRouterAdv1();
  await checkRouterAdv2();
  await checkRouterMissingInputs();
  await checkRouterPartialBundle();
  checkEffectiveFloorBase();
  checkEffectiveFloorAdjustments();
  checkEffectiveFloorMissing();
  checkNbsMidpoint();
  checkAlphaUtility();
  checkDeltaDiscount();

  console.log("");
  console.log("==============================================================");
  if (failed === 0) {
    console.log(`  ✓ ${passed} passed, 0 failed`);
    console.log("  Router tier matrix correct; tactics engine math verified.");
    console.log("  M2-β.1 ready. Next: M2-β.2 (treasury fixture) → β.3 (L2 executive) → β.4 (wire-in).");
    console.log("==============================================================");
    process.exit(0);
  } else {
    console.log(`  ✗ ${passed} passed, ${failed} failed`);
    console.log("  Failures:");
    for (const f of failures) console.log(`    - ${f}`);
    console.log("==============================================================");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[test-router-and-tactics] fatal:", err);
  process.exit(2);
});
