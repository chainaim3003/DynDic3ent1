// ================= ITERATION 3 — OUTCOME-QUALITY SMOKE TEST =================
// Six scenarios that hit the major flag combinations.
//
// Usage:   npx tsx scripts/test-outcome-quality.ts
// No agents needed.

import { computeOutcomeQuality } from "../src/shared/outcome-quality.js";

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.log(`  ✗ ${label}   ${detail}`);
    fail++;
  }
}

console.log("\n══════════════════════════════════════════════════");
console.log("  Iteration 3 — Outcome-quality smoke test");
console.log("══════════════════════════════════════════════════\n");

// ── Scenario 1: balanced deal at the NBS midpoint ──────────────────
console.log("Scenario 1 — Balanced deal at NBS midpoint:");
{
  const r = computeOutcomeQuality({
    closed: true, closedPrice: 375,
    buyerMax: 400, sellerMin: 350, quantity: 2000,
  });
  check("bothIR is true",                r.IR.bothIR);
  check("ZOPA wasFeasible",              r.ZOPA.wasFeasible);
  check("fairPrice equals midpoint 375", r.NBS.fairPrice === 375);
  check("deviationFromNBS is 0",         r.NBS.deviationFromNBS === 0);
  check("buyerShare ≈ sellerShare ≈ 0.5", Math.abs(r.surplusSplit.buyerShare - 0.5) < 0.01 && Math.abs(r.surplusSplit.sellerShare - 0.5) < 0.01);
  check("agreementTrap false",           !r.flags.agreementTrap);
  check("totalSurplus = 50 × 2000 = 100000", r.surplusSplit.totalSurplus === 100000);
}

// ── Scenario 2: buyer-favored close exactly on threshold (iter-1 ₹365 deal) ──
console.log("\nScenario 2 — Buyer-favored deal at the 70/30 boundary (₹365 below NBS):");
{
  const r = computeOutcomeQuality({
    closed: true, closedPrice: 365,
    buyerMax: 400, sellerMin: 350, quantity: 2000,
  });
  check("bothIR is true",                r.IR.bothIR);
  check("buyerIR = 35",                  r.IR.buyerIR === 35);
  check("sellerIR = 15",                 r.IR.sellerIR === 15);
  check("deviationFromNBS = -10",        r.NBS.deviationFromNBS === -10);
  check("buyerShare = 0.70",             Math.abs(r.surplusSplit.buyerShare - 0.70) < 0.01);
  // Threshold semantics: flags fire on STRICT > 70%, not >=. 70/30 is the
  // boundary and reads as balanced, so neither captured-most flag should
  // trigger. A more lopsided deal (Scenario 2b below) is needed to fire it.
  check("buyerCapturedMost false at the 70% boundary", !r.flags.buyerCapturedMost);
  check("sellerCapturedMost false",      !r.flags.sellerCapturedMost);
  check("agreementTrap false",           !r.flags.agreementTrap);
  console.log(`     summary: ${r.summary}`);
}

// ── Scenario 2b: clearly lopsided deal beyond the 70% threshold ─────────
console.log("\nScenario 2b — Lopsided buyer-favored deal (₹360 — buyer captures 80%):");
{
  const r = computeOutcomeQuality({
    closed: true, closedPrice: 360,
    buyerMax: 400, sellerMin: 350, quantity: 2000,
  });
  check("buyerShare = 0.80",             Math.abs(r.surplusSplit.buyerShare - 0.80) < 0.01);
  check("buyerCapturedMost TRUE",        r.flags.buyerCapturedMost);
  check("sellerCapturedMost false",      !r.flags.sellerCapturedMost);
  console.log(`     summary: ${r.summary}`);
}

// ── Scenario 3: agreement trap (seller close to floor) ───────────────
console.log("\nScenario 3 — Agreement trap (seller closes at ₹352):");
{
  const r = computeOutcomeQuality({
    closed: true, closedPrice: 352,
    buyerMax: 400, sellerMin: 350, quantity: 2000,
  });
  check("bothIR is true",                r.IR.bothIR);
  check("sellerIR = 2",                  r.IR.sellerIR === 2);
  check("buyerCapturedMost true",        r.flags.buyerCapturedMost);
  check("agreementTrap TRUE",            r.flags.agreementTrap);
  console.log(`     summary: ${r.summary}`);
}

// ── Scenario 4: seller-favored close ────────────────────────────────
console.log("\nScenario 4 — Seller-favored deal (₹390 above NBS):");
{
  const r = computeOutcomeQuality({
    closed: true, closedPrice: 390,
    buyerMax: 400, sellerMin: 350, quantity: 2000,
  });
  check("bothIR is true",                r.IR.bothIR);
  check("deviationFromNBS = +15",        r.NBS.deviationFromNBS === 15);
  check("sellerShare = 0.80",            Math.abs(r.surplusSplit.sellerShare - 0.80) < 0.01);
  check("sellerCapturedMost true",       r.flags.sellerCapturedMost);
  check("agreementTrap false",           !r.flags.agreementTrap);
  console.log(`     summary: ${r.summary}`);
}

// ── Scenario 5: no ZOPA (impossible deal) ───────────────────────────
console.log("\nScenario 5 — No ZOPA (sellerMin > buyerMax):");
{
  const r = computeOutcomeQuality({
    closed: false, closedPrice: 365,
    buyerMax: 340, sellerMin: 350, quantity: 2000,
  });
  check("closed is false",               !r.closed);
  check("ZOPA wasFeasible false",        !r.ZOPA.wasFeasible);
  check("ZOPA width is negative",        r.ZOPA.width === -10);
  check("buyerShare = 0",                r.surplusSplit.buyerShare === 0);
  check("sellerShare = 0",               r.surplusSplit.sellerShare === 0);
  check("totalSurplus undefined",        r.surplusSplit.totalSurplus === undefined);
  console.log(`     summary: ${r.summary}`);
}

// ── Scenario 6: escalation when ZOPA exists (gap remained) ──────────
console.log("\nScenario 6 — Escalation with ZOPA (₹15 gap from your iter-2 run):");
{
  // Buyer last offer ₹340, seller last offer ₹355 → midpoint ₹347.5
  // Buyer max 400, seller min 350
  const r = computeOutcomeQuality({
    closed: false, closedPrice: 347.5,
    buyerMax: 400, sellerMin: 350, quantity: 2000,
  });
  check("closed is false",               !r.closed);
  check("ZOPA wasFeasible true",         r.ZOPA.wasFeasible);
  check("sellerIR = -2.5 (below floor)", r.IR.sellerIR === -2.5);
  check("bothIR is false",               !r.IR.bothIR);
  check("outsideZOPA TRUE",              r.flags.outsideZOPA);
  console.log(`     summary: ${r.summary}`);
}

console.log("\n══════════════════════════════════════════════════");
console.log(`  ${pass} passed, ${fail} failed`);
console.log("══════════════════════════════════════════════════\n");
if (fail > 0) process.exit(1);
