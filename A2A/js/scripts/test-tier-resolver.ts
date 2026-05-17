// ================= WEDGE1 / M1 — TIER RESOLVER UNIT TEST (T6) =================
//
// Verifies the tier framework's resolver behaves correctly across every
// supported env permutation. Runs in isolation — no agents needed.
//
// Test bands:
//   §1  Default env (everything unset) — backward-compat invariant
//   §2  Each shippable tier value resolves correctly
//   §3  Post-WEDGE1 tiers (ADV3/ADV4) are rejected by validateTier()
//   §4  Invalid NEGOTIATION_MODE values throw with helpful messages
//   §5  Provider modes default to "demo", reject unknown values
//   §6  Evaluation context defaults to "live", rejects unknown values
//   §7  buildNegotiationModeBlock end-to-end shape
//
// Usage: npx tsx scripts/test-tier-resolver.ts
//
// Exit code: 0 if all pass, 1 otherwise.

import {
  resolveTier,
  validateTier,
  getResolvedCapabilities,
  resolveProviderModes,
  resolveEvaluationContext,
  buildNegotiationModeBlock,
  formatStartupBanner,
  type NegotiationTier,
} from "../src/shared/negotiation-mode.js";

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}`); }
}

function throws(name: string, fn: () => unknown, matcher: RegExp | string) {
  try {
    fn();
    failed++;
    console.log(`  ✗ ${name}  (expected throw, got none)`);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const matched = typeof matcher === "string" ? msg.includes(matcher) : matcher.test(msg);
    if (matched) { passed++; console.log(`  ✓ ${name}`); }
    else {
      failed++;
      console.log(`  ✗ ${name}  (threw but message didn't match: "${msg}")`);
    }
  }
}

/** Synthetic env builder so tests don't mutate process.env. */
function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

console.log("");
console.log("==============================================================");
console.log("  WEDGE1 / M1 — Tier Resolver Unit Test (T6)");
console.log("==============================================================");

// ─── §1: Default env (everything unset) ────────────────────────────────────
console.log("\n§1 Default env (Guarantee A: backward compat with today's product)");
{
  const e = env({});
  ok('resolveTier({}) → "BASIC1"',                resolveTier(e) === "BASIC1");
  ok('validateTier({}) → "BASIC1"',               validateTier(e) === "BASIC1");
  const caps = getResolvedCapabilities(resolveTier(e));
  ok("BASIC1 has treasuryConsultation",            caps.treasuryConsultation === true);
  ok("BASIC1 has NO inventoryLogisticsSubAgents",  caps.inventoryLogisticsSubAgents === false);
  ok("BASIC1 has NO creditSubAgent",               caps.creditSubAgent === false);
  ok("BASIC1 has NO tacticsEngine",                caps.tacticsEngine === false);
  ok("BASIC1 has NO llmExecutiveJudgment",         caps.llmExecutiveJudgment === false);
  ok("BASIC1 has NO styleFramework",               caps.styleFramework === false);
  const modes = resolveProviderModes(e);
  ok('default INVENTORY_MODE → "demo"',            modes.inventory === "demo");
  ok('default LOGISTICS_MODE → "demo"',            modes.logistics === "demo");
  ok('default CREDIT_MODE → "demo"',               modes.credit === "demo");
  ok('default EVALUATION_CONTEXT → "live"',        resolveEvaluationContext(e) === "live");
}

// ─── §2: Each shippable tier value resolves correctly ──────────────────────
console.log("\n§2 Shippable tiers (BASIC1, ADVANCED1, ADVANCED2)");
{
  const cases: Array<{ envVal: string; expected: NegotiationTier }> = [
    { envVal: "BASIC1",    expected: "BASIC1" },
    { envVal: "ADVANCED1", expected: "ADVANCED1" },
    { envVal: "ADVANCED2", expected: "ADVANCED2" },
    // Case-insensitive: trimmed + uppercased
    { envVal: "advanced2", expected: "ADVANCED2" },
    { envVal: "  ADVANCED1  ", expected: "ADVANCED1" },
  ];
  for (const c of cases) {
    ok(`NEGOTIATION_MODE="${c.envVal}" → ${c.expected}`,
       resolveTier(env({ NEGOTIATION_MODE: c.envVal })) === c.expected);
    ok(`validateTier accepts "${c.envVal}"`,
       validateTier(env({ NEGOTIATION_MODE: c.envVal })) === c.expected);
  }
  // ADV1 capability matrix sanity
  const adv1 = getResolvedCapabilities("ADVANCED1");
  ok("ADV1 has inventoryLogisticsSubAgents",       adv1.inventoryLogisticsSubAgents === true);
  ok("ADV1 has NO creditSubAgent",                 adv1.creditSubAgent === false);
  ok("ADV1 has NO tacticsEngine",                  adv1.tacticsEngine === false);
  // ADV2 capability matrix — the WEDGE1 ceiling
  const adv2 = getResolvedCapabilities("ADVANCED2");
  ok("ADV2 has creditSubAgent",                    adv2.creditSubAgent === true);
  ok("ADV2 has tacticsEngine",                     adv2.tacticsEngine === true);
  ok("ADV2 has llmExecutiveJudgment",              adv2.llmExecutiveJudgment === true);
  ok("ADV2 still has NO styleFramework",           adv2.styleFramework === false);
  ok("ADV2 still has NO opponentStyleInference",   adv2.opponentStyleInference === false);
}

// ─── §3: Post-WEDGE1 tiers (ADV3/ADV4) rejected by validateTier ────────────
console.log("\n§3 Post-WEDGE1 tiers (ADV3, ADV4) rejected by validateTier");
{
  throws('NEGOTIATION_MODE="ADVANCED3" → validateTier throws',
         () => validateTier(env({ NEGOTIATION_MODE: "ADVANCED3" })),
         /not yet supported/i);
  throws('NEGOTIATION_MODE="ADVANCED4" → validateTier throws',
         () => validateTier(env({ NEGOTIATION_MODE: "ADVANCED4" })),
         /not yet supported/i);
  // resolveTier (without validation) still returns the value — it's only
  // validateTier that gates shippability. The audit must be able to record
  // the raw resolved tier even if it's not shippable.
  ok('resolveTier("ADVANCED3") still returns the value (no throw)',
     resolveTier(env({ NEGOTIATION_MODE: "ADVANCED3" })) === "ADVANCED3");
  ok('resolveTier("ADVANCED4") still returns the value (no throw)',
     resolveTier(env({ NEGOTIATION_MODE: "ADVANCED4" })) === "ADVANCED4");
  // Capability matrix for ADV3 / ADV4 still works — used by post-WEDGE1 code.
  const adv3 = getResolvedCapabilities("ADVANCED3");
  ok("ADV3 has styleFramework",                    adv3.styleFramework === true);
  ok("ADV3 has opponentStyleInference",            adv3.opponentStyleInference === true);
  ok("ADV3 has autonomyLevels",                    adv3.autonomyLevels === true);
  ok("ADV3 still NO perCounterpartyProfiles",      adv3.perCounterpartyProfiles === false);
  const adv4 = getResolvedCapabilities("ADVANCED4");
  ok("ADV4 has perCounterpartyProfiles",           adv4.perCounterpartyProfiles === true);
  ok("ADV4 has customCommodityPdModels",           adv4.customCommodityPdModels === true);
}

// ─── §4: Invalid NEGOTIATION_MODE values throw with helpful messages ───────
console.log("\n§4 Invalid NEGOTIATION_MODE rejected with helpful error");
{
  throws('NEGOTIATION_MODE="ENTERPRISE" → throws',
         () => resolveTier(env({ NEGOTIATION_MODE: "ENTERPRISE" })),
         /Invalid NEGOTIATION_MODE/);
  throws('NEGOTIATION_MODE="basic" (typo) → throws',
         () => resolveTier(env({ NEGOTIATION_MODE: "basic" })),
         /Invalid NEGOTIATION_MODE/);
  throws('NEGOTIATION_MODE error mentions BASIC1',
         () => resolveTier(env({ NEGOTIATION_MODE: "foo" })),
         /BASIC1/);
}

// ─── §5: Provider modes default to "demo", reject unknown ──────────────────
console.log("\n§5 Provider modes (per-sub-agent: real | demo, default demo)");
{
  const m1 = resolveProviderModes(env({}));
  ok('all default to "demo"',
     m1.inventory === "demo" && m1.logistics === "demo" && m1.credit === "demo");

  const m2 = resolveProviderModes(env({
    INVENTORY_MODE: "real", LOGISTICS_MODE: "demo", CREDIT_MODE: "real",
  }));
  ok('mixed: inventory=real, logistics=demo, credit=real resolves',
     m2.inventory === "real" && m2.logistics === "demo" && m2.credit === "real");

  ok('"REAL" (uppercase) accepted via lowercase normalization',
     resolveProviderModes(env({ INVENTORY_MODE: "REAL" })).inventory === "real");

  throws('INVENTORY_MODE="mock" → throws',
         () => resolveProviderModes(env({ INVENTORY_MODE: "mock" })),
         /Invalid INVENTORY_MODE/);
  throws('CREDIT_MODE="sandbox" → throws',
         () => resolveProviderModes(env({ CREDIT_MODE: "sandbox" })),
         /Invalid CREDIT_MODE/);
}

// ─── §6: Evaluation context defaults to "live", rejects unknown ────────────
console.log("\n§6 Evaluation context (live | paper-trade | benchmark | replay)");
{
  ok('default → "live"',
     resolveEvaluationContext(env({})) === "live");
  ok('EVALUATION_CONTEXT="paper-trade" → "paper-trade"',
     resolveEvaluationContext(env({ EVALUATION_CONTEXT: "paper-trade" })) === "paper-trade");
  ok('EVALUATION_CONTEXT="REPLAY" (uppercase) → "replay"',
     resolveEvaluationContext(env({ EVALUATION_CONTEXT: "REPLAY" })) === "replay");
  throws('EVALUATION_CONTEXT="prod" → throws',
         () => resolveEvaluationContext(env({ EVALUATION_CONTEXT: "prod" })),
         /Invalid EVALUATION_CONTEXT/);
}

// ─── §7: buildNegotiationModeBlock end-to-end ──────────────────────────────
console.log("\n§7 buildNegotiationModeBlock — audit JSON shape");
{
  // Default env: BASIC1, all demo, live context, audit records env=null for all
  const b1 = buildNegotiationModeBlock(env({}));
  ok("default block.tier === BASIC1",              b1.tier === "BASIC1");
  ok("default block.evaluationContext === live",   b1.evaluationContext === "live");
  ok("default providerModes all demo",
     b1.providerModes.inventory === "demo" && b1.providerModes.logistics === "demo" && b1.providerModes.credit === "demo");
  ok("default resolvedFromEnv.NEGOTIATION_MODE === null",
     b1.resolvedFromEnv.NEGOTIATION_MODE === null);
  ok("default resolvedCapabilities.treasuryConsultation === true",
     b1.resolvedCapabilities.treasuryConsultation === true);

  // ADV2 env: explicit values are echoed back in resolvedFromEnv
  const b2 = buildNegotiationModeBlock(env({
    NEGOTIATION_MODE: "ADVANCED2",
    INVENTORY_MODE:   "demo",
    CREDIT_MODE:      "real",
    EVALUATION_CONTEXT: "paper-trade",
  }));
  ok("ADV2 block.tier === ADVANCED2",              b2.tier === "ADVANCED2");
  ok("ADV2 evaluationContext === paper-trade",     b2.evaluationContext === "paper-trade");
  ok("ADV2 providerModes.credit === real",         b2.providerModes.credit === "real");
  ok("ADV2 resolvedFromEnv preserves raw values",
     b2.resolvedFromEnv.NEGOTIATION_MODE === "ADVANCED2"
     && b2.resolvedFromEnv.CREDIT_MODE === "real");

  // formatStartupBanner — string contains the tier name
  const banner = formatStartupBanner(b2);
  ok("startup banner contains tier name",          banner.includes("ADVANCED2"));
  ok("startup banner contains 'paper-trade'",      banner.includes("paper-trade"));
  ok("startup banner mentions provider modes",     banner.includes("credit=real"));
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log("");
console.log("==============================================================");
if (failed === 0) {
  console.log(`  ✓ ${passed} passed, 0 failed`);
  console.log("  Tier resolver invariants hold. M1 foundation green.");
  console.log("==============================================================");
  process.exit(0);
} else {
  console.log(`  ✗ ${passed} passed, ${failed} failed`);
  console.log("==============================================================");
  process.exit(1);
}
