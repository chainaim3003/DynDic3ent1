// ================= WEDGE1 / GUARANTEE A — CLI PARSER UNIT TEST =================
//
// Verifies that parseNegotiationCommand() correctly handles every form of
// "start negotiation" the user might type - most importantly the legacy
// bare-number form, which MUST continue to behave identically.
//
// This test runs in isolation: no agents need to be started, no network
// calls, no filesystem state. Just imports the parser function and asserts.
//
// Usage:
//   npx tsx scripts/test-cli-parser.ts
//
// Exit codes:
//   0 = all assertions hold
//   1 = at least one assertion failed
//
// Guarantee A invariant under test:
//   parseNegotiationCommand("start negotiation 300") returns { form: "legacy", price: 300 }
//   This is the byte-identical legacy behavior. If this test ever fails,
//   WEDGE1 does not ship.

import {
  parseNegotiationCommand,
  type ParsedNegotiationCommand,
} from "../src/shared/cli-parser.js";

// --- ANSI ------------------------------------------------------------------
const C = {
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
  dim:   "\x1b[2m",
  red:   "\x1b[31m",
  green: "\x1b[32m",
  cyan:  "\x1b[36m",
};

// --- Test harness ----------------------------------------------------------
let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ${C.green}\u2713${C.reset} ${label}`);
    pass++;
  } else {
    console.log(`  ${C.red}\u2717${C.reset} ${label}   ${C.dim}${detail}${C.reset}`);
    fail++;
    failures.push(`${label}: ${detail}`);
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- Tests -----------------------------------------------------------------
function main() {
  console.log("");
  console.log(`${C.bold}==============================================================${C.reset}`);
  console.log(`${C.bold}  WEDGE1 / Guarantee A - CLI Parser Unit Test${C.reset}`);
  console.log(`${C.bold}==============================================================${C.reset}`);
  console.log("");

  // --- Section 1: Legacy bare-number form (Guarantee A core) -------------
  console.log(`${C.cyan}\u00a71 Legacy bare-number form - Guarantee A invariant${C.reset}`);

  {
    const r = parseNegotiationCommand("start negotiation 300");
    check(
      `"start negotiation 300" -> legacy with price 300`,
      deepEqual(r, { form: "legacy", price: 300 }),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand("start negotiation 250");
    check(
      `"start negotiation 250" -> legacy with price 250`,
      deepEqual(r, { form: "legacy", price: 250 }),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand("start negotiation");
    check(
      `"start negotiation" (no price) -> legacy with no price`,
      deepEqual(r, { form: "legacy" }),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand("  start negotiation 300  ");
    check(
      `"  start negotiation 300  " (extra whitespace) -> legacy with price 300`,
      deepEqual(r, { form: "legacy", price: 300 }),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand("start negotiation    300");
    check(
      `"start negotiation    300" (multiple spaces) -> legacy with price 300`,
      deepEqual(r, { form: "legacy", price: 300 }),
      `got ${JSON.stringify(r)}`,
    );
  }

  // --- Section 2: Non-negotiation input (parser returns null) ------------
  console.log("");
  console.log(`${C.cyan}\u00a72 Non-negotiation input - parser returns null${C.reset}`);

  {
    const r = parseNegotiationCommand("hello");
    check(`"hello" -> null`, r === null, `got ${JSON.stringify(r)}`);
  }
  {
    const r = parseNegotiationCommand("");
    check(`"" (empty) -> null`, r === null, `got ${JSON.stringify(r)}`);
  }
  {
    const r = parseNegotiationCommand("how do i start negotiation");
    check(
      `"how do i start negotiation" (start negotiation not at beginning) -> null`,
      r === null,
      `got ${JSON.stringify(r)}`,
    );
  }

  // --- Section 3: Flagged multi-dimensional form -------------------------
  console.log("");
  console.log(`${C.cyan}\u00a73 Flagged multi-dimensional form${C.reset}`);

  {
    const r = parseNegotiationCommand(
      "start negotiation --product cotton-180gsm --qty 50000 --buyer-budget 400 --buyer-style aggressive --buyer-deadline 2026-06-15",
    );
    check(
      `full flagged form -> flagged with all fields`,
      deepEqual(r, {
        form:          "flagged",
        product:       "cotton-180gsm",
        quantity:      50000,
        buyerBudget:   400,
        buyerStyle:    "aggressive",
        buyerDeadline: "2026-06-15",
      }),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand(
      "start negotiation --product cotton --qty 30000 --buyer-budget 380 --buyer-style cooperative --buyer-deadline 2026-07-01",
    );
    check(
      `flagged with cooperative style -> flagged with style "cooperative"`,
      r !== null && r.form === "flagged" && r.buyerStyle === "cooperative",
      `got ${JSON.stringify(r)}`,
    );
  }

  // --- Section 4: Invalid forms ------------------------------------------
  console.log("");
  console.log(`${C.cyan}\u00a74 Invalid forms - parser returns { form: "invalid", error: ... }${C.reset}`);

  {
    const r = parseNegotiationCommand("start negotiation foo");
    check(
      `"start negotiation foo" -> invalid`,
      r !== null && r.form === "invalid",
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand("start negotiation --product cotton");
    check(
      `flagged missing required flags -> invalid`,
      r !== null && r.form === "invalid" && r.error.includes("missing required flag"),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand(
      "start negotiation --product cotton --qty -50 --buyer-budget 400 --buyer-style aggressive --buyer-deadline 2026-06-15",
    );
    check(
      `flagged with --qty -50 (negative) -> invalid`,
      r !== null && r.form === "invalid" && r.error.includes("qty"),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand(
      "start negotiation --product cotton --qty 50000 --buyer-budget 0 --buyer-style aggressive --buyer-deadline 2026-06-15",
    );
    check(
      `flagged with --buyer-budget 0 -> invalid`,
      r !== null && r.form === "invalid" && r.error.includes("buyer-budget"),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand(
      "start negotiation --product cotton --qty 50000 --buyer-budget 400 --buyer-style chaotic --buyer-deadline 2026-06-15",
    );
    check(
      `flagged with unknown --buyer-style "chaotic" -> invalid`,
      r !== null && r.form === "invalid" && r.error.includes("buyer-style"),
      `got ${JSON.stringify(r)}`,
    );
  }
  {
    const r = parseNegotiationCommand(
      "start negotiation --product cotton --qty 50000 --buyer-budget 400 --buyer-style aggressive --buyer-deadline not-a-date",
    );
    check(
      `flagged with bad --buyer-deadline -> invalid`,
      r !== null && r.form === "invalid" && r.error.includes("buyer-deadline"),
      `got ${JSON.stringify(r)}`,
    );
  }

  // --- Section 5: Result is type-discriminated ---------------------------
  console.log("");
  console.log(`${C.cyan}\u00a75 TypeScript discriminated-union ergonomics${C.reset}`);

  {
    const r: ParsedNegotiationCommand | null = parseNegotiationCommand("start negotiation 300");
    let routed = "";
    if (r === null) {
      routed = "null";
    } else if (r.form === "legacy") {
      routed = `legacy:${r.price ?? "none"}`;
    } else if (r.form === "flagged") {
      routed = `flagged:${r.product}`;
    } else {
      // r.form === "invalid"
      routed = `invalid:${r.error}`;
    }
    check(
      `discriminated-union routing for legacy -> "legacy:300"`,
      routed === "legacy:300",
      `got "${routed}"`,
    );
  }

  // --- Summary -----------------------------------------------------------
  console.log("");
  console.log(`${C.bold}==============================================================${C.reset}`);
  if (fail === 0) {
    console.log(`  ${C.green + C.bold}\u2713 ${pass} passed, 0 failed${C.reset}`);
    console.log(`  ${C.dim}Guarantee A invariant holds: legacy bare-number form is byte-identical.${C.reset}`);
  } else {
    console.log(`  ${C.red + C.bold}\u2717 ${pass} passed, ${fail} failed${C.reset}`);
    console.log("");
    console.log(`  ${C.red}Failures:${C.reset}`);
    for (const f of failures) console.log(`    ${C.red}\u2022 ${f}${C.reset}`);
  }
  console.log(`${C.bold}==============================================================${C.reset}`);
  console.log("");

  if (fail > 0) process.exit(1);
}

main();
