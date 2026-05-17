// ================= SIGNED MESSAGE TYPES =================
// Shared shape between PlainHashSigner (today) and VleiSignifySigner (future,
// Phase-2 iteration 14). The seller / buyer code is provider-agnostic.

export type SigningMode = "plain" | "vlei";

/**
 * Envelope wrapping a single A2A message payload.
 *
 * The protections this envelope offers depend on the SigningMode:
 *   - "plain":  tamper-evidence + replay protection + staleness protection.
 *               Does NOT prove identity (anyone with the agent's source could
 *               mint a valid envelope).
 *   - "vlei":   all of the above PLUS cryptographic identity proof via the
 *               agent's KERI private key. Phase-2 only.
 */
export interface SignedEnvelope {
  /** Signing mode that produced this envelope. */
  mode:             SigningMode;
  /** Logical sender agent name (e.g. "jupiterSellerAgent"). */
  senderAgentId:    string;
  /** Logical receiver agent name. */
  receiverAgentId:  string;
  /** Monotonic counter per (sender, receiver) pair. Replay protection. */
  counter:          number;
  /** ISO 8601 timestamp. Staleness protection (default 5 min window). */
  timestamp:        string;
  /** sha256(JSON.stringify(payload)) — tamper-evidence on the payload. */
  payloadHash:      string;
  /** sha256(senderAgentId|receiverAgentId|counter|timestamp|payloadHash) */
  envelopeHash:     string;
  /**
   * VLEI mode only: KERI signature over the envelopeHash.
   * Always empty in plain mode (NOT a fallback — explicit honesty).
   */
  signature?:       string;
}

/**
 * Sealed message — what gets sent over the A2A wire.
 * Carries the original payload AND the envelope. Receivers verify the envelope
 * against the payload before processing.
 */
export interface SealedMessage<T = unknown> {
  envelope: SignedEnvelope;
  payload:  T;
}

/**
 * Honest failure modes a receiver reports when verification fails.
 * Each appears in the audit so the customer sees exactly why a message was
 * rejected.
 */
export type VerificationFailureReason =
  | "PAYLOAD_HASH_MISMATCH"      // payload was altered in flight
  | "ENVELOPE_HASH_MISMATCH"     // envelope itself was altered
  | "COUNTER_REPLAY"              // counter <= last seen for this pair
  | "COUNTER_GAP"                 // counter skipped (out-of-order)
  | "TIMESTAMP_STALE"             // older than MAX_MESSAGE_AGE_MS
  | "TIMESTAMP_FUTURE"            // far in the future (>30s skew)
  | "MISSING_ENVELOPE"            // sender didn't seal at all
  | "MODE_MISMATCH"               // envelope claims vlei but we're in plain
  | "VLEI_SIGNATURE_INVALID";     // (Phase 2) signature failed verification

export interface VerificationResult {
  valid:    boolean;
  reason?:  VerificationFailureReason;
  detail?:  string;
  /** The envelope that was verified, for inclusion in the audit. */
  envelope?: SignedEnvelope;
}

/** Configuration honored by all MessageSigner implementations. */
export interface SignerConfig {
  /** Maximum allowed message age before TIMESTAMP_STALE. Default 300000 ms (5 min). */
  maxMessageAgeMs?: number;
  /** Maximum allowed clock skew into the future. Default 30000 ms (30s). */
  maxFutureSkewMs?: number;
}
