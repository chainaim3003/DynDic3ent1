// ================= MESSAGE SIGNER FACTORY =================
// Selects the active MessageSigner based on SIGNING_MODE env var.
// Singleton — one signer per process so counters stay consistent.

import { MessageSigner } from "./MessageSigner.js";
import { PlainHashSigner } from "./PlainHashSigner.js";

let cached: MessageSigner | null = null;

/**
 * Get the active message signer. Lazy and cached.
 *
 * SIGNING_MODE values:
 *   - "plain" (default): PlainHashSigner. No KERI required.
 *   - "vlei":             VleiSignifySigner. Phase 2 only — throws today.
 *
 * Any unrecognized value defaults to "plain" with an honest warning.
 */
export function getMessageSigner(): MessageSigner {
  if (cached) return cached;

  const raw = (process.env.SIGNING_MODE ?? "plain").toLowerCase().trim();

  if (raw === "vlei") {
    throw new Error(
      "[messaging] SIGNING_MODE=vlei requested but VleiSignifySigner is not yet implemented " +
      "(Phase 2 / iteration 14). Use SIGNING_MODE=plain for May 19 MVP."
    );
  }

  if (raw !== "plain") {
    console.warn(
      `[messaging] Unknown SIGNING_MODE="${raw}" — defaulting to plain. ` +
      `Use "plain" or "vlei".`
    );
  }

  cached = new PlainHashSigner();
  console.log(
    `[messaging] Signer initialized: mode=${cached.mode()} (kind=HASH_ENVELOPE — sha256+counter+freshness, NOT a KERI seal)`
  );
  return cached;
}

/** Test helper — drop the cached signer (e.g. between test runs). */
export function _resetMessageSigner(): void { cached = null; }

export * from "./MessageSigner.js";
