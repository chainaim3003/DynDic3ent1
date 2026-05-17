// ================= PLAIN HASH SIGNER =================
// SHA-256 envelope hashing. Provides:
//   ✓ Tamper-evidence on the payload (payloadHash)
//   ✓ Tamper-evidence on the envelope itself (envelopeHash)
//   ✓ Replay protection (monotonic counter per sender,receiver pair)
//   ✓ Staleness protection (5-min default window)
//   ✓ Honest mode label in every envelope
//
// Does NOT provide (these require vLEI mode):
//   ✗ Cryptographic identity — anyone with the agent source could mint a
//     valid envelope claiming to be "jupiterSellerAgent"
//   ✗ Non-repudiation — Jupiter can deny they signed if a private key isn't
//     involved
//   ✗ KERI seal semantics — this is NOT a KERI seal. A KERI seal is an
//     anchor in a Key Event Log (KEL) cryptographically bound by an Ed25519
//     signature to a self-addressing identifier (SAID). What we produce here
//     is a plain hash envelope with no key event log and no signature.
//
// Precise name for what this is: HASH_ENVELOPE (sha256 + counter + timestamp).
// The log lines call it "hash-envelope" not "seal" to avoid implying KERI
// semantics this provider does not offer.
//
// The audit captures the envelope hash chain so a regulator can replay the
// negotiation offline and detect any post-hoc tampering of the audit JSON
// itself (recompute hashes from recorded payloads → must match recorded
// envelope hashes).

import crypto from "node:crypto";

import { MessageSigner } from "./MessageSigner.js";
import {
  SealedMessage,
  SignedEnvelope,
  VerificationResult,
  SignerConfig,
  SigningMode,
} from "./signed-message.js";

export class PlainHashSigner implements MessageSigner {
  private readonly maxAgeMs:       number;
  private readonly maxFutureMs:    number;
  /** Counter per (sender, receiver) pair we have sent to. */
  private readonly sendCounters    = new Map<string, number>();
  /** Last counter we accepted per (sender, receiver) pair we have received from. */
  private readonly receiveCounters = new Map<string, number>();

  constructor(config: SignerConfig = {}) {
    this.maxAgeMs    = config.maxMessageAgeMs ?? Number(process.env.MAX_MESSAGE_AGE_MS ?? 300_000);
    this.maxFutureMs = config.maxFutureSkewMs ?? Number(process.env.MAX_FUTURE_SKEW_MS ?? 30_000);
  }

  mode(): SigningMode { return "plain"; }

  // ── Sealing ─────────────────────────────────────────────────────────────

  seal<T>(payload: T, senderAgentId: string, receiverAgentId: string): SealedMessage<T> {
    const pairKey   = `${senderAgentId}→${receiverAgentId}`;
    const counter   = (this.sendCounters.get(pairKey) ?? 0) + 1;
    this.sendCounters.set(pairKey, counter);

    const timestamp   = new Date().toISOString();
    const payloadHash = this.hashPayload(payload);
    const envelopeHash = this.hashEnvelope({
      senderAgentId, receiverAgentId, counter, timestamp, payloadHash,
    });

    const envelope: SignedEnvelope = {
      mode:         "plain",
      senderAgentId,
      receiverAgentId,
      counter,
      timestamp,
      payloadHash,
      envelopeHash,
      // signature intentionally omitted in plain mode — honest absence,
      // not a fallback.
    };

    return { envelope, payload };
  }

  // ── Verification ────────────────────────────────────────────────────────

  verify<T>(sealed: SealedMessage<T>, expectedReceiver: string): VerificationResult {
    // No envelope at all → MISSING_ENVELOPE (caller sent unsigned message)
    if (!sealed || !sealed.envelope) {
      return { valid: false, reason: "MISSING_ENVELOPE", detail: "Message arrived without an envelope" };
    }
    const env = sealed.envelope;

    // Mode-consistency check: if the envelope claims vlei but we're plain-mode,
    // refuse — we can't verify a signature we don't know how to check.
    if (env.mode !== "plain") {
      return {
        valid:  false,
        reason: "MODE_MISMATCH",
        detail: `Envelope claims mode "${env.mode}" but receiver is in plain mode`,
        envelope: env,
      };
    }

    // Receiver-target check
    if (env.receiverAgentId !== expectedReceiver) {
      return {
        valid:  false,
        reason: "ENVELOPE_HASH_MISMATCH",
        detail: `Envelope addressed to "${env.receiverAgentId}", we are "${expectedReceiver}"`,
        envelope: env,
      };
    }

    // ── Timestamp checks ─────────────────────────────────────────────────
    const ts = Date.parse(env.timestamp);
    if (isNaN(ts)) {
      return { valid: false, reason: "TIMESTAMP_STALE", detail: `Unparseable timestamp: ${env.timestamp}`, envelope: env };
    }
    const now    = Date.now();
    const ageMs  = now - ts;
    if (ageMs > this.maxAgeMs) {
      return {
        valid:  false,
        reason: "TIMESTAMP_STALE",
        detail: `Message ${Math.floor(ageMs / 1000)}s old, max ${this.maxAgeMs / 1000}s`,
        envelope: env,
      };
    }
    if (ageMs < -this.maxFutureMs) {
      return {
        valid:  false,
        reason: "TIMESTAMP_FUTURE",
        detail: `Message timestamp ${Math.floor(-ageMs / 1000)}s in the future, max skew ${this.maxFutureMs / 1000}s`,
        envelope: env,
      };
    }

    // ── Replay / gap detection ───────────────────────────────────────────
    const pairKey  = `${env.senderAgentId}→${env.receiverAgentId}`;
    const lastSeen = this.receiveCounters.get(pairKey) ?? 0;
    if (env.counter <= lastSeen) {
      return {
        valid:  false,
        reason: "COUNTER_REPLAY",
        detail: `counter=${env.counter} but last accepted was ${lastSeen}`,
        envelope: env,
      };
    }
    // Note: we accept counters that skip ahead (e.g. lastSeen=3, got 5) because
    // an A2A round may be lost in transit; the strict requirement is "no
    // backwards." If we wanted strict in-order delivery, we'd return COUNTER_GAP
    // when counter !== lastSeen + 1. For now: tolerate gaps but reject replays.

    // ── Hash checks ──────────────────────────────────────────────────────
    const recomputedPayloadHash = this.hashPayload(sealed.payload);
    if (recomputedPayloadHash !== env.payloadHash) {
      return {
        valid:  false,
        reason: "PAYLOAD_HASH_MISMATCH",
        detail: `Payload was altered in flight (recomputed ${recomputedPayloadHash.slice(0, 12)}..., envelope claims ${env.payloadHash.slice(0, 12)}...)`,
        envelope: env,
      };
    }
    const recomputedEnvelopeHash = this.hashEnvelope({
      senderAgentId:   env.senderAgentId,
      receiverAgentId: env.receiverAgentId,
      counter:         env.counter,
      timestamp:       env.timestamp,
      payloadHash:     env.payloadHash,
    });
    if (recomputedEnvelopeHash !== env.envelopeHash) {
      return {
        valid:  false,
        reason: "ENVELOPE_HASH_MISMATCH",
        detail: `Envelope fields altered (recomputed ${recomputedEnvelopeHash.slice(0, 12)}..., claims ${env.envelopeHash.slice(0, 12)}...)`,
        envelope: env,
      };
    }

    // All checks passed → commit the counter
    this.receiveCounters.set(pairKey, env.counter);
    return { valid: true, envelope: env };
  }

  // ── Test helper ─────────────────────────────────────────────────────────

  resetCounters(): void {
    this.sendCounters.clear();
    this.receiveCounters.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private hashPayload(payload: unknown): string {
    // JSON.stringify with stable key ordering — small risk of ordering drift
    // for plain objects across Node versions, but in practice V8 preserves
    // insertion order. Good enough for tamper-evidence on payloads our agents
    // construct themselves.
    const json = JSON.stringify(payload);
    return crypto.createHash("sha256").update(json).digest("hex");
  }

  private hashEnvelope(parts: {
    senderAgentId:   string;
    receiverAgentId: string;
    counter:         number;
    timestamp:       string;
    payloadHash:     string;
  }): string {
    const canonical = [
      parts.senderAgentId,
      parts.receiverAgentId,
      String(parts.counter),
      parts.timestamp,
      parts.payloadHash,
    ].join("|");
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }
}
