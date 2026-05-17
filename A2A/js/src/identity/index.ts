// ================= IDENTITY FACTORY =================
// Resolves which CredentialProvider to use based on CREDENTIAL_MODE env var.
// Called lazily (at first use) so dotenv.config() in the agent has run first.

import { CredentialProvider } from "./CredentialProvider.js";
import { PlainJsonProvider }  from "./PlainJsonProvider.js";
import { VleiProvider }       from "./VleiProvider.js";

let cached: CredentialProvider | null = null;

/**
 * Get the active credential provider for this process. Lazy and cached.
 *
 * CREDENTIAL_MODE values:
 *   - "plain" (default): PlainJsonProvider. No KERI required.
 *   - "vlei":             VleiProvider. KERIA must be reachable at startup.
 *
 * Any other value is treated as "plain" with a warning, so a typo doesn't
 * silently downgrade security; instead an honest warning surfaces.
 */
export function getCredentialProvider(): CredentialProvider {
  if (cached) return cached;

  const raw  = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase().trim();
  if (raw === "vlei") {
    cached = new VleiProvider();
  } else {
    if (raw !== "plain") {
      console.warn(
        `[identity] Unknown CREDENTIAL_MODE="${raw}" — defaulting to plain. ` +
        `Use "plain" or "vlei".`
      );
    }
    cached = new PlainJsonProvider();
  }
  console.log(`[identity] Provider initialized: mode=${cached.mode()}`);
  return cached;
}

/** Test helper — clear cached provider so tests can switch modes. */
export function _resetCredentialProvider(): void { cached = null; }

export * from "./CredentialProvider.js";
