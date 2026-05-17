// ================= MESSAGE SIGNER INTERFACE =================
// Contract every signing implementation must satisfy.
//
// Two implementations:
//   - PlainHashSigner: sha256 envelope hash, no crypto identity (today)
//   - VleiSignifySigner: KERI signatures via signify-ts (Phase 2)
//
// Selection happens via getMessageSigner() in ./index.ts based on
// SIGNING_MODE env var. No silent fallback — if SIGNING_MODE=vlei and
// signify can't init, startup fails.

import {
  SealedMessage,
  SignedEnvelope,
  VerificationResult,
  SigningMode,
} from "./signed-message.js";

export interface MessageSigner {
  /** Mode tag — appears in every envelope and audit record. */
  mode(): SigningMode;

  /**
   * Wrap a payload in a signed envelope. The signer maintains its own
   * monotonic counter per (sender, receiver) pair internally.
   *
   * @param payload          The original A2A message data (offer, counter, etc.)
   * @param senderAgentId    Logical sender (e.g. "jupiterSellerAgent")
   * @param receiverAgentId  Logical receiver (e.g. "tommyBuyerAgent")
   */
  seal<T>(payload: T, senderAgentId: string, receiverAgentId: string): SealedMessage<T>;

  /**
   * Verify a received sealed message. Returns valid=false with an honest
   * failure reason if any check fails. Does NOT throw — receivers decide how
   * to react (reject + log, escalate, etc.).
   *
   * @param sealed   The received {envelope, payload}
   * @param expectedReceiver  Our own agent ID — verifies the message was
   *                          intended for us.
   */
  verify<T>(sealed: SealedMessage<T>, expectedReceiver: string): VerificationResult;

  /**
   * Reset per-pair counters. Used by tests to start fresh between negotiations.
   * NOT used in production — production runs single-process and counters
   * monotonically increase forever.
   */
  resetCounters?(): void;
}

/** Re-exports so consumers can import from "../messaging/MessageSigner.js". */
export type { SealedMessage, SignedEnvelope, VerificationResult, SigningMode };
export type { VerificationFailureReason, SignerConfig } from "./signed-message.js";
