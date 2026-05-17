// ============================================================================
// scripts/test-l2-wire.ts — WEDGE1 / M2-β.4: L2 wire orchestrator verification
// ============================================================================
//
// Verifies that decideRoundViaL2() — the orchestrator the seller-agent calls
// when tier permits the L2 executive — correctly composes:
//   - ConsultationRouter (M2-β.1)
//   - L2 executive       (M2-β.3)
//   - Translation to legacy NegotiationDecision shape
//   - TreasuryConsultationSummary in the legacy shape the seller already stores
//
// Tests use the REAL demo-mode providers (they read DEMO-DATA/ fixtures,
// deterministic) and a STUB LLM (via llmCallOverride). No GEMINI_API_KEY
// required; the production-only LLMNegotiationClient instance is never
// constructed.
//
// Run from A2A/js/:
//   npx tsx scripts/test-l2-wire.ts
// ============================================================================

import { decideRoundViaL2 } from "../src/shared/l2-wire.js";
import type { DecideRoundViaL2Input } from "../src/shared/l2-wire.js";
import type { L2LLMCall, L2LLMPromptContext } from "../src/shared/l2-executive.js";
import type { LLMNegotiationClient, LLMResponseWithAudit } from "../src/shared/llm-client.js";
import {
  getResolvedCapabilities,
} from "../src/shared/negotiation-mode.js";

import { resetTreasuryProviderForTest }  from "../src/shared/treasury-provider.js";
import { resetInventoryProviderForTest } from "../src/shared/inventory-provider.js";
import { resetLogisticsProviderForTest } from "../src/shared/logistics-provider.js";
import { resetCreditProviderForTest }    from "../src/shared/credit-provider.js";

// ─── Tiny harness ─────────────────────────────────────────────────────────

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

// ─── Env helpers ──────────────────────────────────────────────────────────

/**
 * Snapshot env, force all 4 provider modes to "demo", reset singletons,
 * run body, restore env + singletons. Mirrors the pattern used in
 * test-fixtures-parse.ts.
 */
async function withDemoEnv(body: () => Promise<void>): Promise<void> {
  const snapshot = {
    INVENTORY_MODE: process.env.INVENTORY_MODE,
    LOGISTICS_MODE: process.env.LOGISTICS_MODE,
    CREDIT_MODE:    process.env.CREDIT_MODE,
    TREASURY_MODE:  process.env.TREASURY_MODE,
    TREASURY_URL:   process.env.TREASURY_URL,
  };
  process.env.INVENTORY_MODE = "demo";
  process.env.LOGISTICS_MODE = "demo";
  process.env.CREDIT_MODE    = "demo";
  process.env.TREASURY_MODE  = "demo";
  delete process.env.TREASURY_URL;

  resetTreasuryProviderForTest();
  resetInventoryProviderForTest();
  resetLogisticsProviderForTest();
  resetCreditProviderForTest();

  try {
    await body();
  } finally {
    for (const key of Object.keys(snapshot) as (keyof typeof snapshot)[]) {
      const v = snapshot[key];
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
    resetTreasuryProviderForTest();
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();
  }
}

// ─── Stubs ────────────────────────────────────────────────────────────────

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

// Fake LLM client — never actually invoked because every test passes
// llmCallOverride. Avoids constructing the real client (which would demand
// GEMINI_API_KEY).
const fakeLLMClient = null as any as LLMNegotiationClient;

// ─── Common inputs ────────────────────────────────────────────────────────

const COMMON: Omit<DecideRoundViaL2Input,
  "tier" | "capabilities" | "buyerOffer" | "round" | "llmCallOverride"
> = {
  negotiationId:   "NEG-WIRE-TEST",
  maxRounds:       3,
  quantity:        50000,
  history:         [],
  marginPrice:     330,
  minProfitMargin: 25,
  targetPrice:     400,
  paymentTermsDays: 30,
  productCode:     "FAB-COTTON-180GSM",
  originPort:      "INMAA",
  destinationPort: "USLAX",
  buyerLei:        "54930012QJWZMYHNJW95",
  buyerEntityName: "TOMMY HILFIGER EUROPE B.V.",
  llmClient:       fakeLLMClient,
};

// ─── Tests ────────────────────────────────────────────────────────────────

async function testAdv2BundleShape(): Promise<void> {
  section("§1 ADV2 — bundle has all 4 sub-agents from real demo providers");

  await withDemoEnv(async () => {
    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED2",
      capabilities: getResolvedCapabilities("ADVANCED2"),
      round:        1,
      buyerOffer:   370,
      llmCallOverride: stubLLM({ action: "COUNTER", price: 400, reasoning: "Try ₹400." }),
    });

    assert(out.bundle.tier === "ADVANCED2",                                 `bundle.tier === ADVANCED2`);
    assert(out.bundle.treasury !== undefined,                               `bundle.treasury present`);
    assert(out.bundle.inventory !== undefined,                              `bundle.inventory present`);
    assert(out.bundle.logistics !== undefined,                              `bundle.logistics present`);
    assert(out.bundle.credit !== undefined,                                 `bundle.credit present`);
    assert(out.bundle.treasury!.success === true,                           `bundle.treasury.success === true (demo fixture)`);
    assert(out.bundle.inventory!.success === true,                          `bundle.inventory.success === true`);
    assert(out.bundle.logistics!.success === true,                          `bundle.logistics.success === true`);
    assert(out.bundle.credit!.success === true,                             `bundle.credit.success === true`);
    assert(typeof out.bundle.routerLatencyMs === "number",                  `routerLatencyMs recorded`);
  });
}

async function testAdv1BundleShape(): Promise<void> {
  section("§2 ADV1 — bundle has treasury + inventory + logistics, NOT credit");

  await withDemoEnv(async () => {
    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED1",
      capabilities: getResolvedCapabilities("ADVANCED1"),
      round:        1,
      buyerOffer:   370,
      llmCallOverride: stubLLM({ action: "COUNTER", price: 400, reasoning: "x" }),
    });

    assert(out.bundle.tier === "ADVANCED1",                                 `bundle.tier === ADVANCED1`);
    assert(out.bundle.treasury !== undefined,                               `bundle.treasury present`);
    assert(out.bundle.inventory !== undefined,                              `bundle.inventory present`);
    assert(out.bundle.logistics !== undefined,                              `bundle.logistics present`);
    assert(out.bundle.credit === undefined,                                 `bundle.credit ABSENT (tier-gated off at ADV1)`);
  });
}

async function testBasic1BundleShape(): Promise<void> {
  section("§3 BASIC1 — bundle has treasury ONLY");

  await withDemoEnv(async () => {
    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "BASIC1",
      capabilities: getResolvedCapabilities("BASIC1"),
      round:        1,
      buyerOffer:   370,
      llmCallOverride: stubLLM({ action: "COUNTER", price: 400, reasoning: "x" }),
    });

    assert(out.bundle.tier === "BASIC1",                                    `bundle.tier === BASIC1`);
    assert(out.bundle.treasury !== undefined,                               `bundle.treasury present (always-on)`);
    assert(out.bundle.inventory === undefined,                              `bundle.inventory ABSENT at BASIC1`);
    assert(out.bundle.logistics === undefined,                              `bundle.logistics ABSENT at BASIC1`);
    assert(out.bundle.credit === undefined,                                 `bundle.credit ABSENT at BASIC1`);
  });
}

async function testTreasuryRejectionTriggersOverride(): Promise<void> {
  section("§4 ADV2 + treasury fixture rejects (approved=false, minViable=335) + LLM ACCEPT → math override");

  await withDemoEnv(async () => {
    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED2",
      capabilities: getResolvedCapabilities("ADVANCED2"),
      round:        1,
      buyerOffer:   320,                          // below treasury minViable 335
      llmCallOverride: stubLLM({ action: "ACCEPT", reasoning: "Looks fine to me." }),
    });

    // Treasury fixture has approved=false, minViable=335
    assert(out.bundle.treasury!.result!.approved === false,                 `treasury.approved === false (fixture)`);
    assert(out.bundle.treasury!.result!.minViablePrice === 335,             `treasury.minViablePrice === 335 (fixture)`);

    // L2 executive should override LLM-ACCEPT → COUNTER at hardFloor
    // hardFloor = max(effectiveFloor.total ≈ 372.16, 335) = 372.16; ceil = 373
    assert(out.l2Decision.action === "COUNTER",                             `l2Decision.action overridden to COUNTER`);
    assert(out.l2Decision.mathOverride !== undefined,                       `l2Decision.mathOverride recorded`);
    assert(out.l2Decision.mathOverride!.llmProposed.action === "ACCEPT",    `mathOverride.llmProposed.action === ACCEPT (original LLM)`);

    // NegotiationDecision (legacy shape) reflects the override
    assert(out.decision.action === "COUNTER",                               `decision.action === COUNTER`);
    assert(out.decision.price === out.l2Decision.counterPrice,              `decision.price === l2Decision.counterPrice`);
    assert(typeof out.decision.reasoning === "string"
           && out.decision.reasoning.includes("[math-override:"),           `decision.reasoning includes [math-override:]`);
  });
}

async function testTreasurySummaryShape(): Promise<void> {
  section("§5 TreasuryConsultationSummary — legacy shape, overrideApplied flag");

  await withDemoEnv(async () => {
    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED2",
      capabilities: getResolvedCapabilities("ADVANCED2"),
      round:        2,
      buyerOffer:   320,
      llmCallOverride: stubLLM({ action: "ACCEPT", reasoning: "Looks fine." }),
    });

    const ts = out.treasurySummary;
    assert(ts !== null,                                                     `treasurySummary populated (not null)`);
    if (ts) {
      assert(ts.round === 2,                                                `treasurySummary.round === 2 (passed-through)`);
      assert(ts.priceQueried === 320,                                       `treasurySummary.priceQueried === 320`);
      assert(ts.approved === false,                                         `treasurySummary.approved === false`);
      assert(ts.minViablePrice === 335,                                     `treasurySummary.minViablePrice === 335`);
      assert(typeof ts.npvOfDeal === "number",                              `treasurySummary.npvOfDeal is number`);
      assert(typeof ts.netProfit === "number",                              `treasurySummary.netProfit is number`);
      assert(typeof ts.projectedMinBalance === "number",                    `treasurySummary.projectedMinBalance is number`);
      assert(typeof ts.safetyThreshold === "number",                        `treasurySummary.safetyThreshold is number`);
      assert(typeof ts.workingCapitalCost === "number",                     `treasurySummary.workingCapitalCost is number`);
      assert(ts.overrideApplied === true,                                   `treasurySummary.overrideApplied === true (treasury-driven override fired)`);
    }
  });
}

async function testLLMCounterAboveFloorPassesThrough(): Promise<void> {
  section("§6 ADV2 + LLM COUNTER at acceptable price → no math override");

  await withDemoEnv(async () => {
    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED2",
      capabilities: getResolvedCapabilities("ADVANCED2"),
      round:        2,
      buyerOffer:   320,
      // 400 is above hardFloor (max of effFloor ≈ 372 and treasury minViable 335)
      // and below sanity ceiling 600. Passes validation unchanged.
      llmCallOverride: stubLLM({ action: "COUNTER", price: 400, reasoning: "Counter at ₹400." }),
    });

    assert(out.decision.action === "COUNTER",                               `decision.action === COUNTER (pass-through)`);
    assert(out.decision.price === 400,                                      `decision.price === 400 (LLM value preserved)`);
    assert(out.l2Decision.mathOverride === undefined,                       `no math override`);
    assert(!out.decision.reasoning.includes("[math-override:"),             `reasoning has no [math-override:] tag`);
  });
}

async function testDefensiveActionInReasoning(): Promise<void> {
  section("§7 Hard defensive (treasury unreachable) → REJECT, reasoning surfaces defensive tag");

  await withDemoEnv(async () => {
    // Force treasury into real mode pointing at an unreachable URL so it
    // returns success=false. The L2 executive will hard-reject.
    process.env.TREASURY_MODE = "real";
    process.env.TREASURY_URL  = "http://127.0.0.1:1/consult";
    resetTreasuryProviderForTest();

    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED2",
      capabilities: getResolvedCapabilities("ADVANCED2"),
      round:        1,
      buyerOffer:   370,
      llmCallOverride: stubLLM({ action: "ACCEPT", reasoning: "should not be invoked" }),
    });

    assert(out.bundle.treasury !== undefined,                               `bundle.treasury record present`);
    assert(out.bundle.treasury!.success === false,                          `bundle.treasury.success === false (unreachable)`);
    assert(out.decision.action === "REJECT",                                `decision.action === REJECT (hard defensive)`);
    assert(out.l2Decision.defensiveActions.length >= 1,                    `at least one defensive action recorded`);
    assert(out.l2Decision.defensiveActions[0].action === "abandoned-negotiation",
                                                                            `defensive action is "abandoned-negotiation"`);
    assert(out.decision.reasoning.includes("[defensive:"),                  `decision.reasoning includes [defensive:] tag`);
    assert(out.treasurySummary === null,                                    `treasurySummary === null (treasury failed before result)`);
  });
}

async function testCreditOnlyAtAdv2(): Promise<void> {
  section("§8 Credit consultation absent at ADV1, present at ADV2");

  await withDemoEnv(async () => {
    const adv1 = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED1",
      capabilities: getResolvedCapabilities("ADVANCED1"),
      round:        1,
      buyerOffer:   400,
      llmCallOverride: stubLLM({ action: "ACCEPT", reasoning: "x" }),
    });
    assert(adv1.bundle.credit === undefined,                                `ADV1: credit absent`);

    const adv2 = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED2",
      capabilities: getResolvedCapabilities("ADVANCED2"),
      round:        1,
      buyerOffer:   400,
      llmCallOverride: stubLLM({ action: "ACCEPT", reasoning: "x" }),
    });
    assert(adv2.bundle.credit !== undefined,                                `ADV2: credit present`);
    assert(adv2.bundle.credit!.success === true,                            `ADV2: credit.success === true (demo fixture)`);
  });
}

async function testProgrammerErrorGuard(): Promise<void> {
  section("§9 Programmer-error guard — throws when capabilities.treasuryConsultation = false");

  // Build a capability set with treasury off. Not a real tier — simulates a
  // bug where the caller bypasses validateTier.
  const brokenCap = {
    ...getResolvedCapabilities("BASIC1"),
    treasuryConsultation: false,
  };

  let threw = false;
  let msg   = "";
  try {
    await decideRoundViaL2({
      ...COMMON,
      tier:         "BASIC1",
      capabilities: brokenCap,
      round:        1,
      buyerOffer:   370,
      llmCallOverride: stubLLM({ action: "ACCEPT", reasoning: "x" }),
    });
  } catch (err: any) {
    threw = true;
    msg   = err?.message ?? String(err);
  }

  assert(threw,                                                              `decideRoundViaL2 throws on missing treasuryConsultation capability`);
  assert(msg.includes("treasuryConsultation"),                               `error message mentions treasuryConsultation`);
  assert(msg.includes("programmer error"),                                   `error message flags this as a programmer error`);
}

async function testCounterPriceRoundedInteger(): Promise<void> {
  section("§10 Translation — counter price is integer (no fractional rupees)");

  await withDemoEnv(async () => {
    const out = await decideRoundViaL2({
      ...COMMON,
      tier:         "ADVANCED2",
      capabilities: getResolvedCapabilities("ADVANCED2"),
      round:        1,
      buyerOffer:   320,
      llmCallOverride: stubLLM({ action: "ACCEPT", reasoning: "x" }),
    });

    assert(out.decision.action === "COUNTER",                               `clamped to COUNTER`);
    assert(typeof out.decision.price === "number",                          `price is number`);
    assert(Number.isInteger(out.decision.price!),                           `price is INTEGER (no fractional rupees)`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("==============================================================");
  console.log("  WEDGE1 / M2-β.4 — L2 Wire Orchestrator Verification");
  console.log("==============================================================");

  await testAdv2BundleShape();
  await testAdv1BundleShape();
  await testBasic1BundleShape();
  await testTreasuryRejectionTriggersOverride();
  await testTreasurySummaryShape();
  await testLLMCounterAboveFloorPassesThrough();
  await testDefensiveActionInReasoning();
  await testCreditOnlyAtAdv2();
  await testProgrammerErrorGuard();
  await testCounterPriceRoundedInteger();

  console.log("");
  console.log("==============================================================");
  if (failed === 0) {
    console.log(`  ✓ ${passed} passed, 0 failed`);
    console.log("  L2 wire orchestrator integration verified across BASIC1/ADV1/ADV2.");
    console.log("  M2-β.4 wire-function ready. Next: seller-agent integration.");
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
  console.error("[test-l2-wire] fatal:", err);
  process.exit(2);
});
