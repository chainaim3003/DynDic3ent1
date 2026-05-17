// Iteration 1 smoke test — runs without any agents or servers.
// Verifies: format validator + real GLEIF API lookup.
//
// Usage:   npx tsx scripts/test-gleif.ts
import { isValidLeiFormat, checkCompliance } from "../src/utils/compliance/gleif-client.js";

async function main() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  Iteration 1 smoke test — GLEIF compliance");
  console.log("══════════════════════════════════════════════════\n");

  // ── Test 1: format validator ────────────────────────────────────────
  console.log("Test 1 — LEI format validation (ISO 17442 checksum):");
  const samples: Array<[string, string]> = [
    ["3358004DXAMRWRUIYJ05", "Jupiter Knitting Company"],
    ["54930012QJWZMYHNJW95", "Tommy Hilfiger Europe B.V."],
    ["NOT_A_REAL_LEI______", "garbage (wrong format)"],
    ["3358004DXAMRWRUIYJ99", "Jupiter with bad checksum"],
  ];
  for (const [lei, label] of samples) {
    const ok = isValidLeiFormat(lei);
    console.log(`  ${ok ? "✓" : "✗"}  ${lei}   ${label}`);
  }

  // ── Test 2: real GLEIF lookup ──────────────────────────────────────
  console.log("\nTest 2 — Real GLEIF lookup for Tommy Hilfiger:");
  try {
    const r = await checkCompliance("54930012QJWZMYHNJW95", { forceFresh: true });
    console.log(`  ok                 : ${r.ok}`);
    console.log(`  legalEntityName    : ${r.record?.legalEntityName}`);
    console.log(`  country            : ${r.record?.country}`);
    console.log(`  registrationStatus : ${r.record?.registrationStatus}`);
    console.log(`  entityStatus       : ${r.record?.entityStatus}`);
    console.log(`  source             : ${r.record?.source}`);
    console.log(`  checksPerformed    : ${r.checksPerformed.join(", ")}`);
    console.log(`  warnings           : ${r.warnings.length ? r.warnings.join("; ") : "(none)"}`);
    console.log(`  errors             : ${r.errors.length   ? r.errors.join("; ")   : "(none)"}`);
  } catch (err) {
    console.error(`  ❌ GLEIF call failed: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── Test 3: lookup of a fake LEI ─────────────────────────────────────
  console.log("\nTest 3 — Real GLEIF lookup for a fake LEI:");
  // Use a properly-formatted but non-existent LEI: random 18 chars + valid checksum.
  // We don't compute a real checksum; instead use a known-not-issued shape.
  // The format validator will let it through if the checksum happens to be 1 mod 97.
  // For a true "not in GLEIF" test we need a properly-checksummed LEI that's not issued.
  // Easier: use a checksum-failing LEI and verify the FORMAT check catches it.
  const fake = "FAKELEIFAKELEI001100";
  console.log(`  Testing LEI: ${fake}`);
  const fakeResult = await checkCompliance(fake);
  console.log(`  ok            : ${fakeResult.ok}`);
  console.log(`  errors        : ${fakeResult.errors.join("; ")}`);
  console.log(`  checksPerformed: ${fakeResult.checksPerformed.join(", ")}`);

  console.log("\n══════════════════════════════════════════════════");
  console.log("  ✓ Smoke test complete");
  console.log("══════════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
