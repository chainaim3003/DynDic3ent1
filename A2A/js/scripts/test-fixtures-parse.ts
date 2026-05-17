// ============================================================================
// scripts/test-fixtures-parse.ts  —  WEDGE1 / M2-α.2 + M2-α.3: provider verification
// ============================================================================
//
// Verifies that the four sub-agent providers behave correctly across modes.
// For Inventory / Logistics / Credit (M2-α.2): demo-mode reads fixtures
// cleanly, real-mode stubs fail gracefully. For Treasury (M2-α.3): demo-mode
// is stubbed (lands in M2-β), real-mode handles a missing treasury endpoint
// cleanly via timeout/refused without throwing.
//
// What this guards:
//   1. The 3 fixture JSON files exist on disk at the expected relative paths.
//   2. They parse as JSON without error.
//   3. They have the __source + result shape every fixture must carry.
//   4. Every provider's metadata-merge produces a ConsultationMetadata with
//      all required fields populated (and live performedAt + latencyMs).
//   5. The result block has the per-sub-agent required fields with sensible
//      types (numbers are numbers, arrays are arrays, booleans are booleans).
//   6. Real-mode failures produce well-formed failed ConsultationRecord
//      values — they NEVER throw, so M2-β defensive-branch logic always has
//      a record to inspect.
//   7. No dataSource / demoSourceRef contains an absolute filesystem path —
//      enforces the project's path-portability invariant.
//
// What this does NOT guard:
//   - Real-mode HAPPY paths for any provider (those branches are stubbed in
//     M2-α.2; Treasury's real-mode is exercised only via its failure path
//     because it would otherwise need the treasury agent running).
//   - Tactics-engine math, audit JSON shape, defensive routing —
//     those land in M2-β / M2-γ with their own tests (T7, T8).
//
// Run from A2A/js/:
//   npx tsx scripts/test-fixtures-parse.ts
//
// Exit 0 on all pass; exit 1 on any failure.
// ============================================================================

import {
  getInventoryProvider,
  resetInventoryProviderForTest,
} from "../src/shared/inventory-provider.js";

import {
  getLogisticsProvider,
  resetLogisticsProviderForTest,
} from "../src/shared/logistics-provider.js";

import {
  getCreditProvider,
  resetCreditProviderForTest,
} from "../src/shared/credit-provider.js";

import {
  getTreasuryProvider,
  resetTreasuryProviderForTest,
} from "../src/shared/treasury-provider.js";

// ─── Tiny test harness (zero deps) ────────────────────────────────────────

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

/**
 * Snapshot env, force fresh provider modes by clearing all provider mode
 * env vars, run the body, restore env. Ensures every section starts from a
 * known clean state regardless of what the dev had set externally.
 */
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

  // Drop cached singletons so the next factory call re-reads env fresh.
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

// ─── Common metadata assertions ───────────────────────────────────────────

function assertMetadataShape(meta: any, subAgent: string, dataMode: string): void {
  assert(meta != null,                                                       `${subAgent}: metadata present`);
  assert(meta.subAgent === subAgent,                                          `${subAgent}: metadata.subAgent === "${subAgent}"`);
  assert(meta.dataMode === dataMode,                                          `${subAgent}: metadata.dataMode === "${dataMode}"`);
  assert(typeof meta.performedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(meta.performedAt),
                                                                              `${subAgent}: metadata.performedAt is ISO string`);
  assert(typeof meta.dataSource === "string" && meta.dataSource.length > 0,  `${subAgent}: metadata.dataSource non-empty`);
  assert(typeof meta.latencyMs === "number" && meta.latencyMs >= 0,          `${subAgent}: metadata.latencyMs is non-negative number`);

  // For demo mode the provider must propagate the fixture's source kind/ref.
  if (dataMode === "demo") {
    assert(meta.demoSourceKind === "fixture",                                 `${subAgent}: metadata.demoSourceKind === "fixture"`);
    assert(typeof meta.demoSourceRef === "string" && meta.demoSourceRef.includes("DEMO-DATA/"),
                                                                              `${subAgent}: metadata.demoSourceRef points into DEMO-DATA/`);
  }

  // Path-discipline guard: no absolute paths or user-specific paths anywhere
  // in metadata strings. If this fires, someone slipped a hardcoded path in.
  const stringFields = [meta.dataSource, meta.demoSourceRef].filter((s: unknown) => typeof s === "string") as string[];
  for (const s of stringFields) {
    assert(!/^[A-Za-z]:[\\/]/.test(s),                                        `${subAgent}: dataSource/demoSourceRef has no Windows absolute path`);
    assert(!s.startsWith("/home/") && !s.startsWith("/Users/") && !s.startsWith("/c/"),
                                                                              `${subAgent}: dataSource/demoSourceRef has no Unix absolute path`);
  }
}

// ─── Per-sub-agent verification ───────────────────────────────────────────

async function checkInventory(): Promise<void> {
  section("§1 Inventory provider — demo mode loads fixture");

  await withCleanEnv(async () => {
    process.env.INVENTORY_MODE = "demo";
    resetInventoryProviderForTest();

    const provider = getInventoryProvider();
    assert(provider.subAgent === "inventory",         `provider.subAgent === "inventory"`);
    assert(provider.mode     === "demo",              `provider.mode === "demo"`);

    const record = await provider.consult({
      productCode: "FAB-COTTON-180GSM",
      quantity:    50000,
    });

    assert(record.success === true,                   `consult returned success=true`);
    assert(record.error == null,                      `consult returned no error`);

    assertMetadataShape(record.metadata, "inventory", "demo");

    const r = record.result;
    assert(r != null,                                                          `result present`);
    if (r) {
      assert(r.productCode === "FAB-COTTON-180GSM",                            `result.productCode matches fixture`);
      assert(typeof r.availableQty === "number" && r.availableQty >= 0,        `result.availableQty is non-negative number`);
      assert(typeof r.reservedQty  === "number" && r.reservedQty  >= 0,        `result.reservedQty is non-negative number`);
      assert(typeof r.leadTimeDays === "number" && r.leadTimeDays >= 0,        `result.leadTimeDays is non-negative number`);
      assert(typeof r.earliestShipDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.earliestShipDate),
                                                                                `result.earliestShipDate is yyyy-mm-dd`);
      assert(typeof r.canFulfill === "boolean",                                `result.canFulfill is boolean`);
    }
  });
}

async function checkLogistics(): Promise<void> {
  section("§2 Logistics provider — demo mode loads fixture");

  await withCleanEnv(async () => {
    process.env.LOGISTICS_MODE = "demo";
    resetLogisticsProviderForTest();

    const provider = getLogisticsProvider();
    assert(provider.subAgent === "logistics",         `provider.subAgent === "logistics"`);
    assert(provider.mode     === "demo",              `provider.mode === "demo"`);

    const record = await provider.consult({
      originPort:      "INMAA",
      destinationPort: "USLAX",
      quantity:        50000,
    });

    assert(record.success === true,                   `consult returned success=true`);
    assert(record.error == null,                      `consult returned no error`);

    assertMetadataShape(record.metadata, "logistics", "demo");

    const r = record.result;
    assert(r != null,                                                          `result present`);
    if (r) {
      assert(typeof r.originPort      === "string" && r.originPort.length > 0,    `result.originPort non-empty`);
      assert(typeof r.destinationPort === "string" && r.destinationPort.length > 0, `result.destinationPort non-empty`);
      assert(typeof r.estimatedTransitDays === "number" && r.estimatedTransitDays > 0,
                                                                                `result.estimatedTransitDays > 0`);
      assert(typeof r.bestRateUsd === "number" && r.bestRateUsd > 0,            `result.bestRateUsd > 0`);
      assert(Array.isArray(r.carriers) && r.carriers.length >= 1,              `result.carriers is non-empty array`);
      assert(typeof r.canMeetDeliveryDate === "boolean",                       `result.canMeetDeliveryDate is boolean`);

      if (Array.isArray(r.carriers)) {
        for (let i = 0; i < r.carriers.length; i++) {
          const c = r.carriers[i];
          assert(typeof c.scac === "string" && c.scac.length === 4,            `carriers[${i}].scac is 4-char string`);
          assert(typeof c.name === "string" && c.name.length > 0,              `carriers[${i}].name non-empty`);
          assert(typeof c.transitDays === "number" && c.transitDays > 0,       `carriers[${i}].transitDays > 0`);
          assert(typeof c.rateUsd === "number" && c.rateUsd > 0,               `carriers[${i}].rateUsd > 0`);
          assert(typeof c.validUntil === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.validUntil),
                                                                                `carriers[${i}].validUntil is yyyy-mm-dd`);
        }
      }
    }
  });
}

async function checkCredit(): Promise<void> {
  section("§3 Credit provider — demo mode loads fixture");

  await withCleanEnv(async () => {
    process.env.CREDIT_MODE = "demo";
    resetCreditProviderForTest();

    const provider = getCreditProvider();
    assert(provider.subAgent === "credit",            `provider.subAgent === "credit"`);
    assert(provider.mode     === "demo",              `provider.mode === "demo"`);

    const record = await provider.consult({
      lei:             "54930012QJWZMYHNJW95",
      legalEntityName: "TOMMY HILFIGER EUROPE B.V.",
    });

    assert(record.success === true,                   `consult returned success=true`);
    assert(record.error == null,                      `consult returned no error`);

    assertMetadataShape(record.metadata, "credit", "demo");

    const r = record.result;
    assert(r != null,                                                          `result present`);
    if (r) {
      assert(typeof r.lei === "string" && r.lei.length === 20,                  `result.lei is 20-char LEI`);
      assert(typeof r.legalEntityName === "string" && r.legalEntityName.length > 0,
                                                                                `result.legalEntityName non-empty`);
      assert(["ACTIVE","LAPSED","RETIRED","MERGED","PENDING","DUPLICATE"].includes(r.gleifStatus),
                                                                                `result.gleifStatus in vocab`);
      assert(typeof r.financialHealthScore === "number" && r.financialHealthScore >= 0 && r.financialHealthScore <= 100,
                                                                                `result.financialHealthScore in [0,100]`);
      assert(typeof r.pd1y === "number" && r.pd1y >= 0 && r.pd1y <= 1,         `result.pd1y in [0,1]`);
      assert(typeof r.lgd  === "number" && r.lgd  >= 0 && r.lgd  <= 1,         `result.lgd in [0,1]`);
      assert(["PRE_PAID","COD","NET_15","NET_30","NET_45","NET_60","NET_90"].includes(r.recommendedTerms),
                                                                                `result.recommendedTerms in vocab`);
      assert(typeof r.rationale === "string" && r.rationale.length > 0,        `result.rationale non-empty`);
    }
  });
}

// ─── Real-mode stub behavior (Inventory / Logistics / Credit) ─────────────

async function checkRealModeStubs(): Promise<void> {
  section("§4 Real-mode stubs (Inventory/Logistics/Credit) — clean failure path");

  await withCleanEnv(async () => {
    process.env.INVENTORY_MODE = "real";
    process.env.LOGISTICS_MODE = "real";
    process.env.CREDIT_MODE    = "real";
    resetInventoryProviderForTest();
    resetLogisticsProviderForTest();
    resetCreditProviderForTest();

    const inv = await getInventoryProvider().consult({ productCode: "FAB-COTTON-180GSM", quantity: 50000 });
    assert(inv.success === false,                                              `inventory real-mode: success=false`);
    assert(typeof inv.error === "string" && /real-mode/.test(inv.error),       `inventory real-mode: error mentions real-mode`);
    assert(inv.metadata.dataMode === "real",                                   `inventory real-mode: metadata.dataMode === "real"`);

    const log = await getLogisticsProvider().consult({ originPort: "INMAA", destinationPort: "USLAX", quantity: 50000 });
    assert(log.success === false,                                              `logistics real-mode: success=false`);
    assert(typeof log.error === "string" && /real-mode/.test(log.error),       `logistics real-mode: error mentions real-mode`);
    assert(log.metadata.dataMode === "real",                                   `logistics real-mode: metadata.dataMode === "real"`);

    const cre = await getCreditProvider().consult({ lei: "54930012QJWZMYHNJW95" });
    assert(cre.success === false,                                              `credit real-mode: success=false`);
    assert(typeof cre.error === "string" && /real-mode/.test(cre.error),       `credit real-mode: error mentions real-mode`);
    assert(cre.metadata.dataMode === "real",                                   `credit real-mode: metadata.dataMode === "real"`);
  });
}

// ─── Treasury provider (M2-α.3) ───────────────────────────────────────────

async function checkTreasury(): Promise<void> {
  section("§5 Treasury provider — interface + mode resolution");

  // §5a: default mode is REAL (unlike the other 3 which default to demo)
  await withCleanEnv(async () => {
    // Force a non-routable URL so the real-mode path can run without
    // requiring the treasury agent to be up. Port 1 is reserved/blocked
    // everywhere — connection refused is immediate, no timeout wait.
    process.env.TREASURY_URL = "http://127.0.0.1:1/consult";
    resetTreasuryProviderForTest();

    const provider = getTreasuryProvider();
    assert(provider.subAgent === "treasury",          `provider.subAgent === "treasury"`);
    assert(provider.mode     === "real",              `provider.mode defaults to "real" (treasury is always-on)`);
  });

  // §5b: demo mode reads fixture cleanly (M2-β.2; was stubbed in M2-α.3)
  section("§6 Treasury provider — demo-mode loads fixture");

  await withCleanEnv(async () => {
    process.env.TREASURY_MODE = "demo";
    resetTreasuryProviderForTest();

    const provider = getTreasuryProvider();
    assert(provider.subAgent === "treasury",          `provider.subAgent === "treasury"`);
    assert(provider.mode     === "demo",              `provider.mode === "demo"`);

    const record = await provider.consult({
      negotiationId: "NEG-TEST-001",
      pricePerUnit:  370,
      quantity:      50000,
      round:         1,
    });

    assert(record.success === true,                   `consult returned success=true`);
    assert(record.error == null,                      `consult returned no error`);

    assertMetadataShape(record.metadata, "treasury", "demo");

    const r = record.result;
    assert(r != null,                                                          `result present`);
    if (r) {
      assert(typeof r.approved === "boolean",                                  `result.approved is boolean`);
      assert(typeof r.npvOfDeal === "number" && Number.isFinite(r.npvOfDeal),  `result.npvOfDeal is finite number`);
      assert(typeof r.netProfit === "number" && Number.isFinite(r.netProfit),  `result.netProfit is finite number`);
      assert(typeof r.projectedMinBalance === "number" && Number.isFinite(r.projectedMinBalance),
                                                                                `result.projectedMinBalance is finite number`);
      assert(typeof r.safetyThreshold === "number" && r.safetyThreshold >= 0, `result.safetyThreshold is non-negative number`);
      assert(typeof r.workingCapitalCost === "number" && r.workingCapitalCost >= 0,
                                                                                `result.workingCapitalCost is non-negative number`);
      assert(Array.isArray(r.failReasons),                                     `result.failReasons is array`);

      // minViablePrice is optional, but when present must be a positive number.
      if (r.minViablePrice !== undefined) {
        assert(typeof r.minViablePrice === "number" && r.minViablePrice > 0,    `result.minViablePrice is positive number when present`);
      }

      // Echo discipline: the provider must overwrite pricePerUnit + round from
      // the live consult() input, NOT serve the fixture's static values. This
      // is what keeps the audit's negotiation context accurate across rounds.
      assert(r.pricePerUnit === 370,                                           `result.pricePerUnit echoes input (370)`);
      assert(r.round === 1,                                                    `result.round echoes input (1)`);

      // Approval consistency: when approved=false the provider must surface a
      // reason. When approved=true failReasons may be empty.
      if (r.approved === false) {
        assert(r.failReasons.length > 0,                                       `approved=false implies failReasons non-empty`);
      }
    }
  });

  // §5c: real mode with unreachable treasury → clean failure (no throw, valid record)
  section("§7 Treasury provider — real mode degrades gracefully when endpoint unreachable");

  await withCleanEnv(async () => {
    // Force a non-routable URL — port 1 returns ECONNREFUSED immediately on
    // most platforms so the test doesn't hang waiting for the 5s timeout.
    process.env.TREASURY_MODE = "real";
    process.env.TREASURY_URL  = "http://127.0.0.1:1/consult";
    resetTreasuryProviderForTest();

    const provider = getTreasuryProvider();
    assert(provider.mode === "real",                                           `treasury real-mode: provider.mode === "real"`);

    let record;
    try {
      record = await provider.consult({
        negotiationId: "NEG-TEST-002",
        pricePerUnit:  370,
        quantity:      50000,
        round:         1,
      });
    } catch (err: any) {
      assert(false, `treasury real-mode: consult threw instead of returning a failed record (${err?.message ?? err})`);
      return;
    }

    assert(record.success === false,                                           `treasury real-mode unreachable: success=false`);
    assert(typeof record.error === "string" && record.error.length > 0,        `treasury real-mode unreachable: error message present`);
    assert(typeof record.error === "string" && /treasury HTTP/.test(record.error!),
                                                                                `treasury real-mode unreachable: error mentions "treasury HTTP"`);
    assert(record.metadata.subAgent === "treasury",                            `treasury real-mode unreachable: metadata.subAgent === "treasury"`);
    assert(record.metadata.dataMode === "real",                                `treasury real-mode unreachable: metadata.dataMode === "real"`);
    assert(typeof record.metadata.latencyMs === "number" && record.metadata.latencyMs >= 0,
                                                                                `treasury real-mode unreachable: latencyMs recorded`);

    // Path discipline — error/dataSource paths must remain portable
    assert(!/^[A-Za-z]:[\\/]/.test(record.metadata.dataSource),                `treasury real-mode: dataSource has no Windows absolute path`);
    assert(!record.metadata.dataSource.startsWith("/home/") &&
           !record.metadata.dataSource.startsWith("/Users/") &&
           !record.metadata.dataSource.startsWith("/c/"),                       `treasury real-mode: dataSource has no Unix absolute path`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("==============================================================");
  console.log("  WEDGE1 / M2-α.2 + M2-α.3 — Provider Verification");
  console.log("==============================================================");

  await checkInventory();
  await checkLogistics();
  await checkCredit();
  await checkRealModeStubs();
  await checkTreasury();

  console.log("");
  console.log("==============================================================");
  if (failed === 0) {
    console.log(`  ✓ ${passed} passed, 0 failed`);
    console.log("  All providers behave correctly across modes.");
    console.log("  M2-α.2 (Inventory/Logistics/Credit) + M2-α.3 (Treasury)");
    console.log("  sub-agents ready for M2-β ConsultationRouter wiring.");
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
  console.error("[test-fixtures-parse] fatal:", err);
  process.exit(2);
});
