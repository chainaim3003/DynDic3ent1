// ============================================================================
// scripts/test-l2-executive.ts — WEDGE1 / M2-β.3: L2 executive verification
// ============================================================================
//
// Verifies the L2 executive's decision logic across all hard-rule and
// math-override branches. The LLM is stubbed via L2LLMCall injection so the
// test is deterministic, requires no GEMINI_API_KEY, and runs in <1s.
//
// What this guards:
//   1. Hard defensive: treasury absent or success=false → REJECT + defensive
//      action "abandoned-negotiation", no LLM call (no llmAudit).
//   2. Hard clamp: treasury approved=false with minViablePrice → counter at
//      max(effectiveFloor.total, minViablePrice).
//   3. LLM-ACCEPT below floor → math override to COUNTER at floor.
//   4. LLM-COUNTER below floor → clamp up to floor.
//   5. LLM-COUNTER above 1.5×target → clamp down to sanity ceiling.
//   6. LLM-COUNTER with no price → backfill from floor.
//   7. LLM-REJECT pass-through when math doesn't contradict.
//   8. Credit failed at ADV2 → defensiveAction "refused-deferred-terms".
//   9. Logistics / inventory failed → defensiveAction "fallback-to-demo-fixture".
//  10. Tactics trace fully populated (effectiveFloor + NBS + α-utility,
//      deltaDiscount present iff marketReferencePrice supplied).
//  11. mathOverride records both llmProposed and clampedTo verbatim — the
//      Decision Trail viewer surfaces both, so neither can be silently dropped.
//  12. executiveLatencyMs > 0.
//  13. Pure-math mode (no llmCall) produces sensible defaults without throwing.
//
// What this does NOT guard:
//   - Live Gemini calls (production LLM client wraps this; live integration
//     is verified by the existing seller-agent end-to-end tests).
//   - β.4 wire-in into the negotiation loop (lands in β.4).
//
// Run from A2A/js/:
//   npx tsx scripts/test-l2-executive.ts
// ============================================================================

import { decide } from "../src/shared/l2-executive.js";
import type { L2LLMCall, L2LLMPromptContext } from "../src/shared/l2-executive.js";

import type { ConsultationBundle } from "../src/shared/consultation-router.js";

import type {
  ConsultationRecord,
  TreasuryConsultation,
  InventoryConsultation,
  LogisticsConsultation,
  CreditConsultation,
} from "../src/shared/provider-types.js";

import type { LLMResponseWithAudit } from "../src/shared/llm-client.js";

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

function section(name: string): void {
  console.log("");
  console.log(name);
}

function approxEq(a: number, b: number, eps = 0.01): boolean {
  return Math.abs(a - b) < eps;
}

// ─── Sub-agent record factories ───────────────────────────────────────────

function treasuryOK(opts: {
  approved?:      boolean;
  minViable?:     number;
  failReasons?:   string[];
  pricePerUnit?:  number;
  round?:         number;
} = {}): ConsultationRecord<TreasuryConsultation> {
  return {
    metadata: {
      subAgent:    "treasury",
      dataMode:    "demo",
      performedAt: new Date().toISOString(),
      dataSource:  "DEMO-DATA/treasury/jupiter-treasury-pricepoint-370-net30.json",
      latencyMs:   8,
    },
    success: true,
    result:  {
      approved:            opts.approved ?? true,
      npvOfDeal:           5086851,
      netProfit:           1806932,
      projectedMinBalance: -15430000,
      safetyThreshold:     300000,
      workingCapitalCost:  163068,
      minViablePrice:      opts.minViable,
      failReasons:         opts.failReasons ?? [],
      pricePerUnit:        opts.pricePerUnit ?? 370,
      round:               opts.round ?? 1,
    },
  };
}

function treasuryFailed(error = "treasury HTTP request failed at http://localhost:7070/consult: ECONNREFUSED"): ConsultationRecord<TreasuryConsultation> {
  return {
    metadata: {
      subAgent:    "treasury",
      dataMode:    "real",
      performedAt: new Date().toISOString(),
      dataSource:  "http://localhost:7070/consult (real-mode unreachable)",
      latencyMs:   12,
    },
    success: false,
    error,
  };
}

function inventoryOK(canFulfill = true): ConsultationRecord<InventoryConsultation> {
  return {
    metadata: {
      subAgent:       "inventory",
      dataMode:       "demo",
      performedAt:    new Date().toISOString(),
      dataSource:     "DEMO-DATA/inventory/erpnext-bin-FAB-COTTON-180GSM.json",
      demoSourceKind: "fixture",
      demoSourceRef:  "DEMO-DATA/inventory/erpnext-bin-FAB-COTTON-180GSM.json",
      latencyMs:      6,
    },
    success: true,
    result:  {
      productCode:      "FAB-COTTON-180GSM",
      availableQty:     canFulfill ? 60000 : 35000,
      reservedQty:      8000,
      leadTimeDays:     canFulfill ? 0 : 30,
      earliestShipDate: "2026-06-14",
      canFulfill,
    },
  };
}

function logisticsOK(): ConsultationRecord<LogisticsConsultation> {
  return {
    metadata: {
      subAgent:       "logistics",
      dataMode:       "demo",
      performedAt:    new Date().toISOString(),
      dataSource:     "DEMO-DATA/logistics/dcsa-MAA-LAX-50000units.json",
      demoSourceKind: "fixture",
      demoSourceRef:  "DEMO-DATA/logistics/dcsa-MAA-LAX-50000units.json",
      latencyMs:      9,
    },
    success: true,
    result:  {
      originPort:           "INMAA",
      destinationPort:      "USLAX",
      estimatedTransitDays: 24,
      bestRateUsd:          8400,
      carriers:             [{ scac: "MSCU", name: "MSC", transitDays: 27, rateUsd: 8400, validUntil: "2026-06-01" }],
      canMeetDeliveryDate:  true,
    },
  };
}

function logisticsFailed(): ConsultationRecord<LogisticsConsultation> {
  return {
    metadata: {
      subAgent:    "logistics",
      dataMode:    "real",
      performedAt: new Date().toISOString(),
      dataSource:  "DCSA T&T endpoint unreachable",
      latencyMs:   5,
    },
    success: false,
    error:   "logistics real-mode unreachable",
  };
}

function creditOK(): ConsultationRecord<CreditConsultation> {
  return {
    metadata: {
      subAgent:       "credit",
      dataMode:       "demo",
      performedAt:    new Date().toISOString(),
      dataSource:     "DEMO-DATA/credit/edgar-companyfacts-PHILLIPS-VAN-HEUSEN.json",
      demoSourceKind: "fixture",
      demoSourceRef:  "DEMO-DATA/credit/edgar-companyfacts-PHILLIPS-VAN-HEUSEN.json",
      latencyMs:      11,
    },
    success: true,
    result:  {
      lei:                  "54930012QJWZMYHNJW95",
      legalEntityName:      "TOMMY HILFIGER EUROPE B.V.",
      gleifStatus:          "ACTIVE",
      financialHealthScore: 72,
      pd1y:                 0.018,
      lgd:                  0.45,
      recommendedTerms:     "NET_30",
      rationale:            "Investment-grade-equivalent parent. NET_30 acceptable.",
    },
  };
}

function creditFailed(): ConsultationRecord<CreditConsultation> {
  return {
    metadata: {
      subAgent:    "credit",
      dataMode:    "real",
      performedAt: new Date().toISOString(),
      dataSource:  "GLEIF API unreachable",
      latencyMs:   4,
    },
    success: false,
    error:   "GLEIF real-mode unreachable",
  };
}

function bundleAdv2Full(treasuryOpts: Parameters<typeof treasuryOK>[0] = {}): ConsultationBundle {
  return {
    tier:            "ADVANCED2",
    routerLatencyMs: 12,
    treasury:        treasuryOK(treasuryOpts),
    inventory:       inventoryOK(true),
    logistics:       logisticsOK(),
    credit:          creditOK(),
  };
}

// ─── Stub LLM ─────────────────────────────────────────────────────────────

function stubLLM(response: {
  action:    "ACCEPT" | "COUNTER" | "REJECT";
  price?:    number;
  reasoning: string;
}): L2LLMCall {
  return async (_ctx: L2LLMPromptContext): Promise<LLMResponseWithAudit> => ({
    action:     response.action,
    price:      response.price,
    reasoning:  response.reasoning,
    confidence: 0.9,
    audit: {
      modelRequested:   "stub",
      modelUsed:        "stub",
      promptTokens:     0,
      completionTokens: 0,
      totalTokens:      0,
      estimatedCostUSD: 0,
      latencyMs:        1,
      decisionPath:     "GEMINI_OK",
      retries:          0,
    },
  });
}

// ─── Common test inputs ───────────────────────────────────────────────────

const COMMON = {
  marginPrice:     330,
  minProfitMargin: 25,
  quantity:        50000,
  round:           2,
  maxRounds:       5,
  history:         [],
  targetPrice:     400,
};

// Expected effective floor with full ADV2 bundle and canFulfill=true inventory:
//   baseFloor          = 330 + 25 = 355
//   inventoryAdjustment = 0     (canFulfill=true)
//   logisticsAdjustment = (8400 × 85) / 50000 = 14.28
//   creditAdjustment    = 355 × 0.018 × 0.45 = 2.8755
//   total              ≈ 372.1555
const EXPECTED_EFFECTIVE_FLOOR_FULL = 355 + 0 + (8400 * 85) / 50000 + 355 * 0.018 * 0.45;

// ─── Tests ────────────────────────────────────────────────────────────────

async function testTreasuryAbsent(): Promise<void> {
  section("§1 Hard defensive — treasury absent from bundle → REJECT");

  const bundle: ConsultationBundle = {
    tier:            "BASIC1",
    routerLatencyMs: 1,
    // treasury intentionally omitted
  };

  let llmCalled = false;
  const llmCall = stubLLM({ action: "ACCEPT", reasoning: "should not be called" });
  const wrappedLlm: L2LLMCall = async (ctx) => { llmCalled = true; return llmCall(ctx); };

  const d = await decide({
    bundle,
    buyerOffer: 380,
    ...COMMON,
    llmCall: wrappedLlm,
  });

  assert(d.action === "REJECT",                              `action is REJECT`);
  assert(d.counterPrice === undefined,                       `counterPrice is undefined`);
  assert(d.defensiveActions.length >= 1,                     `at least one defensive action recorded`);
  assert(d.defensiveActions[0].action === "abandoned-negotiation", `defensive action is "abandoned-negotiation"`);
  assert(d.defensiveActions[0].triggeredBy === "treasury",   `defensive action triggered by "treasury"`);
  assert(llmCalled === false,                                 `LLM was NOT called (hard defensive short-circuit)`);
  assert(d.llmAudit === undefined,                            `llmAudit absent`);
  assert(d.tacticsTrace.effectiveFloor.baseFloor === 355,    `tactics trace still computed (baseFloor=355)`);
  assert(typeof d.executiveLatencyMs === "number" && d.executiveLatencyMs >= 0, `executiveLatencyMs recorded`);
}

async function testTreasuryFailed(): Promise<void> {
  section("§2 Hard defensive — treasury success=false → REJECT");

  const bundle: ConsultationBundle = {
    tier:            "ADVANCED2",
    routerLatencyMs: 12,
    treasury:        treasuryFailed("ECONNREFUSED at port 7070"),
    inventory:       inventoryOK(true),
    logistics:       logisticsOK(),
    credit:          creditOK(),
  };

  let llmCalled = false;
  const d = await decide({
    bundle,
    buyerOffer: 380,
    ...COMMON,
    llmCall: async () => { llmCalled = true; throw new Error("should not be called"); },
  });

  assert(d.action === "REJECT",                              `action is REJECT`);
  assert(d.counterPrice === undefined,                       `counterPrice is undefined`);
  assert(d.defensiveActions.length >= 1,                     `defensive action recorded`);
  assert(d.defensiveActions[0].action === "abandoned-negotiation", `defensive action is "abandoned-negotiation"`);
  assert(d.defensiveActions[0].upstreamError.includes("ECONNREFUSED"), `upstreamError surfaces treasury error verbatim`);
  assert(llmCalled === false,                                 `LLM was NOT called`);
  assert(d.reasoning.includes("Treasury consultation failed"), `reasoning explains treasury failure`);
}

async function testHardClampToMinViable(): Promise<void> {
  section("§3 Hard clamp — treasury approved=false with minViablePrice → counter at floor");

  const bundle = bundleAdv2Full({
    approved:     false,
    minViable:    410,
    failReasons:  ["Gap cash too low for this price"],
  });

  // LLM tries to accept at the buyer's low offer — math must override.
  const d = await decide({
    bundle,
    buyerOffer: 365,
    ...COMMON,
    llmCall: stubLLM({ action: "ACCEPT", reasoning: "Looks fine at ₹365." }),
  });

  // hardFloor = max(effectiveFloor.total ≈ 372.16, treasury.minViable 410) = 410
  assert(d.action === "COUNTER",                                          `action overridden to COUNTER`);
  assert(d.counterPrice === 410,                                          `counterPrice clamped to treasury minViablePrice (410)`);
  assert(d.mathOverride !== undefined,                                    `mathOverride recorded`);
  assert(d.mathOverride!.llmProposed.action === "ACCEPT",                 `mathOverride.llmProposed.action === ACCEPT`);
  assert(d.mathOverride!.clampedTo.action === "COUNTER",                  `mathOverride.clampedTo.action === COUNTER`);
  assert(d.mathOverride!.clampedTo.price === 410,                         `mathOverride.clampedTo.price === 410`);
  assert(d.tacticsTrace.hardFloor === 410,                                `tacticsTrace.hardFloor === 410 (treasury min wins)`);

  // Defensive action: treasury rejection surfaces as "asked-for-collateral".
  const treasuryDefensive = d.defensiveActions.find(a => a.triggeredBy === "treasury");
  assert(treasuryDefensive !== undefined,                                 `treasury defensive action recorded`);
  assert(treasuryDefensive!.action === "asked-for-collateral",            `treasury defensive action is "asked-for-collateral"`);
}

async function testLLMAcceptAtFloor(): Promise<void> {
  section("§4 LLM ACCEPT at-or-above hard floor → pass through");

  const bundle = bundleAdv2Full({ approved: true });
  const d = await decide({
    bundle,
    buyerOffer: 390, // well above effective floor ≈ 372
    ...COMMON,
    llmCall: stubLLM({ action: "ACCEPT", reasoning: "₹390 is a good landing for round 2." }),
  });

  assert(d.action === "ACCEPT",                              `action is ACCEPT`);
  assert(d.counterPrice === undefined,                       `counterPrice undefined for ACCEPT`);
  assert(d.mathOverride === undefined,                       `no math override`);
  assert(d.reasoning === "₹390 is a good landing for round 2.", `LLM reasoning preserved verbatim`);
  assert(approxEq(d.tacticsTrace.effectiveFloor.total, EXPECTED_EFFECTIVE_FLOOR_FULL),
                                                              `tactics trace effectiveFloor.total matches math`);
  assert(d.llmAudit !== undefined,                            `llmAudit populated`);
  assert(d.llmAudit!.decisionPath === "GEMINI_OK",            `llmAudit.decisionPath === GEMINI_OK`);
}

async function testLLMAcceptBelowFloor(): Promise<void> {
  section("§5 LLM ACCEPT below effective floor → math override to COUNTER at floor");

  const bundle = bundleAdv2Full({ approved: true });
  const d = await decide({
    bundle,
    buyerOffer: 360, // BELOW effective floor ≈ 372
    ...COMMON,
    llmCall: stubLLM({ action: "ACCEPT", reasoning: "It seems okay." }),
  });

  assert(d.action === "COUNTER",                                          `action overridden to COUNTER`);
  assert(typeof d.counterPrice === "number",                              `counterPrice is a number`);
  assert(d.counterPrice === Math.ceil(EXPECTED_EFFECTIVE_FLOOR_FULL),    `counterPrice === ceil(effectiveFloor.total)`);
  assert(d.mathOverride !== undefined,                                    `mathOverride recorded`);
  assert(d.mathOverride!.llmProposed.action === "ACCEPT",                 `mathOverride.llmProposed.action === ACCEPT`);
  assert(d.mathOverride!.reason.includes("hard floor"),                   `mathOverride.reason mentions hard floor`);
}

async function testLLMCounterBelowFloor(): Promise<void> {
  section("§6 LLM COUNTER below hard floor → clamp up");

  const bundle = bundleAdv2Full({ approved: true });
  const d = await decide({
    bundle,
    buyerOffer: 350,
    ...COMMON,
    llmCall: stubLLM({ action: "COUNTER", price: 355, reasoning: "Try ₹355." }),
  });

  // hardFloor ≈ 372.16 > 355 → clamp up
  assert(d.action === "COUNTER",                                          `action is COUNTER`);
  assert(d.counterPrice === Math.ceil(EXPECTED_EFFECTIVE_FLOOR_FULL),     `counterPrice clamped up to ceil(floor)`);
  assert(d.mathOverride !== undefined,                                    `mathOverride recorded`);
  assert(d.mathOverride!.llmProposed.price === 355,                       `mathOverride.llmProposed.price === 355 (original)`);
  assert(d.mathOverride!.reason.includes("below hard floor"),             `mathOverride.reason mentions below hard floor`);
}

async function testLLMCounterAboveCeiling(): Promise<void> {
  section("§7 LLM COUNTER above 1.5×target → sanity clamp down");

  const bundle = bundleAdv2Full({ approved: true });
  const d = await decide({
    bundle,
    buyerOffer: 380,
    ...COMMON,
    llmCall: stubLLM({ action: "COUNTER", price: 999, reasoning: "Sky-high counter." }),
  });

  // sanity ceiling = 400 × 1.5 = 600. 999 > 600 → clamp to 600.
  const expectedCeiling = Math.floor(COMMON.targetPrice * 1.5);
  assert(d.action === "COUNTER",                                          `action is COUNTER`);
  assert(d.counterPrice === expectedCeiling,                              `counterPrice clamped to floor(1.5×target) = 600`);
  assert(d.mathOverride !== undefined,                                    `mathOverride recorded`);
  assert(d.mathOverride!.llmProposed.price === 999,                       `mathOverride.llmProposed.price === 999`);
  assert(d.mathOverride!.reason.includes("sanity ceiling"),               `mathOverride.reason mentions sanity ceiling`);
}

async function testLLMCounterNoPrice(): Promise<void> {
  section("§8 LLM COUNTER with no price → backfill from hard floor");

  const bundle = bundleAdv2Full({ approved: true });
  const d = await decide({
    bundle,
    buyerOffer: 360,
    ...COMMON,
    llmCall: stubLLM({ action: "COUNTER", reasoning: "Counter but I forgot the number." }),
  });

  assert(d.action === "COUNTER",                                          `action is COUNTER`);
  assert(d.counterPrice === Math.ceil(EXPECTED_EFFECTIVE_FLOOR_FULL),     `counterPrice backfilled from ceil(floor)`);
  assert(d.mathOverride !== undefined,                                    `mathOverride recorded`);
  assert(d.mathOverride!.llmProposed.price === undefined,                 `mathOverride.llmProposed.price === undefined`);
  assert(d.mathOverride!.reason.includes("omitted price"),                `mathOverride.reason mentions omitted price`);
}

async function testLLMRejectPassThrough(): Promise<void> {
  section("§9 LLM REJECT pass-through when math doesn't contradict");

  const bundle = bundleAdv2Full({ approved: true });
  const d = await decide({
    bundle,
    buyerOffer: 360,
    ...COMMON,
    round:    5,
    maxRounds: 5,
    llmCall: stubLLM({ action: "REJECT", reasoning: "Final round, gap too wide, walking away." }),
  });

  assert(d.action === "REJECT",                              `action is REJECT (LLM pass-through)`);
  assert(d.counterPrice === undefined,                       `counterPrice undefined`);
  assert(d.mathOverride === undefined,                       `no math override`);
  assert(d.reasoning === "Final round, gap too wide, walking away.", `LLM reasoning preserved verbatim`);
}

async function testCreditFailedAtAdv2(): Promise<void> {
  section("§10 Credit failed at ADV2 → defensive action \"refused-deferred-terms\"");

  const bundle: ConsultationBundle = {
    tier:            "ADVANCED2",
    routerLatencyMs: 12,
    treasury:        treasuryOK({ approved: true }),
    inventory:       inventoryOK(true),
    logistics:       logisticsOK(),
    credit:          creditFailed(),
  };

  const d = await decide({
    bundle,
    buyerOffer: 385,
    ...COMMON,
    llmCall: stubLLM({ action: "ACCEPT", reasoning: "₹385 looks fine." }),
  });

  const creditDefensive = d.defensiveActions.find(a => a.triggeredBy === "credit");
  assert(creditDefensive !== undefined,                                   `credit defensive action recorded`);
  assert(creditDefensive!.action === "refused-deferred-terms",            `credit defensive action is "refused-deferred-terms"`);
  assert(creditDefensive!.upstreamError.includes("GLEIF"),                `credit defensive upstreamError mentions GLEIF`);

  // Decision should still proceed (defensive is recorded, not blocking).
  assert(d.action === "ACCEPT",                                           `action still ACCEPT (defensive is non-blocking)`);
}

async function testCreditFailedAtAdv1(): Promise<void> {
  section("§11 Credit absent at ADV1 (tier-gated off) → NO credit defensive action");

  const bundle: ConsultationBundle = {
    tier:            "ADVANCED1",
    routerLatencyMs: 8,
    treasury:        treasuryOK({ approved: true }),
    inventory:       inventoryOK(true),
    logistics:       logisticsOK(),
    // credit not present (ADV1 doesn't consult credit)
  };

  const d = await decide({
    bundle,
    buyerOffer: 385,
    ...COMMON,
    llmCall: stubLLM({ action: "ACCEPT", reasoning: "₹385 looks fine." }),
  });

  const creditDefensive = d.defensiveActions.find(a => a.triggeredBy === "credit");
  assert(creditDefensive === undefined,                                   `no credit defensive action at ADV1 (tier-gated off)`);
}

async function testLogisticsFailed(): Promise<void> {
  section("§12 Logistics failed → defensive action \"fallback-to-demo-fixture\"");

  const bundle: ConsultationBundle = {
    tier:            "ADVANCED2",
    routerLatencyMs: 12,
    treasury:        treasuryOK({ approved: true }),
    inventory:       inventoryOK(true),
    logistics:       logisticsFailed(),
    credit:          creditOK(),
  };

  const d = await decide({
    bundle,
    buyerOffer: 385,
    ...COMMON,
    llmCall: stubLLM({ action: "ACCEPT", reasoning: "Looks good." }),
  });

  const logisticsDefensive = d.defensiveActions.find(a => a.triggeredBy === "logistics");
  assert(logisticsDefensive !== undefined,                                `logistics defensive action recorded`);
  assert(logisticsDefensive!.action === "fallback-to-demo-fixture",       `logistics defensive action is "fallback-to-demo-fixture"`);

  // missingSubAgents in the tactics rationale should list logistics
  assert(d.tacticsTrace.effectiveFloor.missingSubAgents.includes("logistics"), `missingSubAgents lists logistics`);
}

async function testPureMathMode(): Promise<void> {
  section("§13 Pure-math mode — no llmCall provided");

  const bundle = bundleAdv2Full({ approved: true });

  // Sub-test 13a: buyer offer above floor → ACCEPT
  const dAccept = await decide({
    bundle,
    buyerOffer: 390,
    ...COMMON,
    // llmCall intentionally omitted
  });
  assert(dAccept.action === "ACCEPT",                                     `pure-math: offer above floor → ACCEPT`);
  assert(dAccept.llmAudit === undefined,                                  `pure-math: llmAudit absent`);
  assert(dAccept.reasoning.startsWith("(pure-math)"),                     `pure-math: reasoning tagged "(pure-math)"`);

  // Sub-test 13b: buyer offer below floor → COUNTER at floor
  const dCounter = await decide({
    bundle,
    buyerOffer: 350,
    ...COMMON,
  });
  assert(dCounter.action === "COUNTER",                                   `pure-math: offer below floor → COUNTER`);
  assert(dCounter.counterPrice === Math.ceil(EXPECTED_EFFECTIVE_FLOOR_FULL), `pure-math: counterPrice === ceil(floor)`);
  assert(dCounter.mathOverride === undefined,                             `pure-math: no mathOverride (synthetic proposal is already at-or-above floor)`);
}

async function testTacticsTraceShape(): Promise<void> {
  section("§14 Tactics trace shape — math fields populated, deltaDiscount only when ref provided");

  const bundle = bundleAdv2Full({ approved: true });

  // Without marketReferencePrice → no deltaDiscount.
  const dNoRef = await decide({
    bundle,
    buyerOffer: 380,
    ...COMMON,
    llmCall: stubLLM({ action: "COUNTER", price: 390, reasoning: "x" }),
  });
  assert(dNoRef.tacticsTrace.effectiveFloor !== undefined,                `effectiveFloor present`);
  assert(dNoRef.tacticsTrace.nbsMidpoint !== undefined,                   `nbsMidpoint present`);
  assert(dNoRef.tacticsTrace.alphaWeightedUtility !== undefined,          `alphaWeightedUtility present`);
  assert(dNoRef.tacticsTrace.deltaDiscount === undefined,                 `deltaDiscount absent when no marketReferencePrice`);

  // With marketReferencePrice → deltaDiscount populated.
  const dWithRef = await decide({
    bundle,
    buyerOffer: 380,
    ...COMMON,
    marketReferencePrice: 400,
    llmCall: stubLLM({ action: "COUNTER", price: 390, reasoning: "x" }),
  });
  assert(dWithRef.tacticsTrace.deltaDiscount !== undefined,               `deltaDiscount present when marketReferencePrice supplied`);
  assert(approxEq(dWithRef.tacticsTrace.deltaDiscount!.discountPercent, 5), `deltaDiscount.discountPercent === 5 (380 vs 400)`);
  assert(dWithRef.tacticsTrace.deltaDiscount!.classification === "fair", `deltaDiscount.classification === "fair"`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("==============================================================");
  console.log("  WEDGE1 / M2-β.3 — L2 Executive Verification");
  console.log("==============================================================");

  await testTreasuryAbsent();
  await testTreasuryFailed();
  await testHardClampToMinViable();
  await testLLMAcceptAtFloor();
  await testLLMAcceptBelowFloor();
  await testLLMCounterBelowFloor();
  await testLLMCounterAboveCeiling();
  await testLLMCounterNoPrice();
  await testLLMRejectPassThrough();
  await testCreditFailedAtAdv2();
  await testCreditFailedAtAdv1();
  await testLogisticsFailed();
  await testPureMathMode();
  await testTacticsTraceShape();

  console.log("");
  console.log("==============================================================");
  if (failed === 0) {
    console.log(`  ✓ ${passed} passed, 0 failed`);
    console.log("  L2 executive hard rules + math overrides verified.");
    console.log("  M2-β.3 ready. Next: M2-β.4 (wire-in to negotiation loop).");
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
  console.error("[test-l2-executive] fatal:", err);
  process.exit(2);
});
