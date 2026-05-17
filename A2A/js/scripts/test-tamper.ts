// ================= ITERATION 2 — TAMPER TEST =================
// Exercises every failure mode of PlainHashSigner.verify():
//   1. Happy path                  → valid: true
//   2. Payload tampering (price)   → PAYLOAD_HASH_MISMATCH
//   3. Replay (same envelope x2)   → COUNTER_REPLAY
//   4. Stale message (>5 min old)  → TIMESTAMP_STALE
//   5. Future message (>30s ahead) → TIMESTAMP_FUTURE
//   6. Wrong receiver              → ENVELOPE_HASH_MISMATCH
//   7. Missing envelope            → MISSING_ENVELOPE
//
// Usage:   npx tsx scripts/test-tamper.ts
//
// No agents need to be running. This exercises the signer in-process.

import { PlainHashSigner } from "../src/messaging/PlainHashSigner.js";
import type { SealedMessage, SignedEnvelope } from "../src/messaging/signed-message.js";

interface DemoPayload {
  type: "OFFER";
  negotiationId: string;
  pricePerUnit: number;
  quantity: number;
}

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

function buildPayload(price = 365): DemoPayload {
  return { type: "OFFER", negotiationId: "NEG-TAMPER-TEST", pricePerUnit: price, quantity: 2000 };
}

async function main() {
  console.log("\n══════════════════════════════════════════════════");
  console.log("  Iteration 2 — Tamper detection smoke test");
  console.log("══════════════════════════════════════════════════\n");

  // ── Test 1: Happy path ───────────────────────────────────────────────
  console.log("Test 1 — Happy path (seal → verify):");
  {
    const signer = new PlainHashSigner();
    const sealed = signer.seal(buildPayload(365), "tommyBuyerAgent", "jupiterSellerAgent");
    const result = signer.verify(sealed, "jupiterSellerAgent");
    check("seal then verify returns valid=true", result.valid, `reason=${result.reason}`);
    check("envelope counter is 1",                sealed.envelope.counter === 1);
    check("envelope mode is plain",                sealed.envelope.mode === "plain");
    check("payloadHash is 64-hex sha256",          /^[0-9a-f]{64}$/.test(sealed.envelope.payloadHash));
    check("envelopeHash is 64-hex sha256",         /^[0-9a-f]{64}$/.test(sealed.envelope.envelopeHash));
    check("plain mode has NO signature",           sealed.envelope.signature === undefined);
  }

  // ── Test 2: Payload tampering ────────────────────────────────────────
  console.log("\nTest 2 — Alter pricePerUnit in flight:");
  {
    const signer = new PlainHashSigner();
    const sealed = signer.seal(buildPayload(365), "tommyBuyerAgent", "jupiterSellerAgent");
    // Tamper: man-in-the-middle changes the price from ₹365 to ₹300
    const tampered: SealedMessage<DemoPayload> = {
      envelope: sealed.envelope,
      payload:  { ...sealed.payload, pricePerUnit: 300 },
    };
    const result = signer.verify(tampered, "jupiterSellerAgent");
    check("verify rejects altered payload",        !result.valid);
    check("reason is PAYLOAD_HASH_MISMATCH",       result.reason === "PAYLOAD_HASH_MISMATCH", `got: ${result.reason}`);
    check("detail mentions hash mismatch",         (result.detail ?? "").includes("altered in flight"));
  }

  // ── Test 3: Replay ───────────────────────────────────────────────────
  console.log("\nTest 3 — Replay the same envelope twice:");
  {
    const signer = new PlainHashSigner();
    const sealed = signer.seal(buildPayload(365), "tommyBuyerAgent", "jupiterSellerAgent");
    const first  = signer.verify(sealed, "jupiterSellerAgent");
    const second = signer.verify(sealed, "jupiterSellerAgent");
    check("first verification valid",              first.valid);
    check("second verification rejected",          !second.valid);
    check("reason is COUNTER_REPLAY",              second.reason === "COUNTER_REPLAY", `got: ${second.reason}`);
  }

  // ── Test 4: Stale message ────────────────────────────────────────────
  console.log("\nTest 4 — Backdated timestamp (10 minutes old):");
  {
    const signer = new PlainHashSigner();
    const sealed = signer.seal(buildPayload(365), "tommyBuyerAgent", "jupiterSellerAgent");
    // Forge an old timestamp into the envelope, then re-derive envelopeHash so
    // the envelope itself is internally consistent (mimics an attacker who
    // knows the hash recipe but cannot beat the freshness window).
    const oldEnv: SignedEnvelope = {
      ...sealed.envelope,
      timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),  // 10 min old
    };
    const crypto = await import("node:crypto");
    oldEnv.envelopeHash = crypto.createHash("sha256")
      .update([oldEnv.senderAgentId, oldEnv.receiverAgentId, String(oldEnv.counter), oldEnv.timestamp, oldEnv.payloadHash].join("|"))
      .digest("hex");
    const result = signer.verify({ envelope: oldEnv, payload: sealed.payload }, "jupiterSellerAgent");
    check("verify rejects stale message",          !result.valid);
    check("reason is TIMESTAMP_STALE",             result.reason === "TIMESTAMP_STALE", `got: ${result.reason}`);
  }

  // ── Test 5: Future-dated message ─────────────────────────────────────
  console.log("\nTest 5 — Forged future timestamp (5 minutes ahead):");
  {
    const signer = new PlainHashSigner();
    const sealed = signer.seal(buildPayload(365), "tommyBuyerAgent", "jupiterSellerAgent");
    const futureEnv: SignedEnvelope = {
      ...sealed.envelope,
      timestamp: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };
    const crypto = await import("node:crypto");
    futureEnv.envelopeHash = crypto.createHash("sha256")
      .update([futureEnv.senderAgentId, futureEnv.receiverAgentId, String(futureEnv.counter), futureEnv.timestamp, futureEnv.payloadHash].join("|"))
      .digest("hex");
    const result = signer.verify({ envelope: futureEnv, payload: sealed.payload }, "jupiterSellerAgent");
    check("verify rejects future-dated message",   !result.valid);
    check("reason is TIMESTAMP_FUTURE",             result.reason === "TIMESTAMP_FUTURE", `got: ${result.reason}`);
  }

  // ── Test 6: Wrong receiver ───────────────────────────────────────────
  console.log("\nTest 6 — Message addressed to wrong receiver:");
  {
    const signer = new PlainHashSigner();
    const sealed = signer.seal(buildPayload(365), "tommyBuyerAgent", "jupiterSellerAgent");
    // Verifier identifies as a different agent
    const result = signer.verify(sealed, "someOtherAgent");
    check("verify rejects wrong-receiver",         !result.valid);
    check("reason is ENVELOPE_HASH_MISMATCH",      result.reason === "ENVELOPE_HASH_MISMATCH", `got: ${result.reason}`);
  }

  // ── Test 7: Missing envelope ─────────────────────────────────────────
  console.log("\nTest 7 — Message with no envelope at all:");
  {
    const signer = new PlainHashSigner();
    const result = signer.verify({ payload: buildPayload(365) } as any, "jupiterSellerAgent");
    check("verify rejects unsealed",               !result.valid);
    check("reason is MISSING_ENVELOPE",            result.reason === "MISSING_ENVELOPE", `got: ${result.reason}`);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("\n══════════════════════════════════════════════════");
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("══════════════════════════════════════════════════\n");
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
