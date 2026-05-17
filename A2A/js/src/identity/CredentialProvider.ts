// ================= CREDENTIAL PROVIDER =================
// Abstraction over identity verification. Two implementations:
//   - PlainJsonProvider: agent card on disk + real GLEIF check.
//                        Does NOT verify cryptographic delegation chain.
//   - VleiProvider:       all of the above PLUS KERI delegation chain check
//                         via the legentvLEI api-server (port 4000).
//
// Selected at startup via env var:
//   CREDENTIAL_MODE=plain  (default)
//   CREDENTIAL_MODE=vlei
//
// No silent fallback. If vlei is selected and KERIA is unreachable, the agent
// refuses to negotiate. Customer must explicitly switch modes.

import { LeiRecord } from "../utils/compliance/gleif-types.js";

/** Mode tag — appears in every audit record. */
export type CredentialMode = "plain" | "vlei";

/** Agent identity loaded at startup from agent card + GLEIF. */
export interface AgentIdentity {
  agentName:       string;
  agentRole:       "seller" | "buyer";
  legalEntityName: string;
  lei:             string;
  oorOfficer:      string;
  // KERI-derived fields — present only in vLEI mode. Empty string in plain.
  agentAID:        string;
  oorHolderAID:    string;
  legalEntityAID:  string;
  qviAID:          string;
  publicKey?:      string;
  // GLEIF snapshot at load time
  gleifRecord?:    LeiRecord;
  // The honest verification path. In plain mode this is just GLEIF lookup
  // metadata; in vLEI mode it's the full GLEIF_ROOT → QVI → LE → OOR → agent chain.
  verificationPath: string[];
}

/** Result of a per-negotiation counterparty verification. */
export interface VerificationResult {
  verified:          boolean;
  mode:              CredentialMode;
  counterparty:      AgentIdentity;
  checksPerformed:   string[];
  warnings:          string[];
  errors:            string[];
  verifiedAt:        string;
}

/**
 * The contract every provider must satisfy.
 *
 * Lifecycle:
 *   1. constructor() — config-only, no network calls
 *   2. loadOwnIdentity()   — called once at agent startup
 *   3. verifyCounterparty() — called before each negotiation
 */
export interface CredentialProvider {
  mode():                 CredentialMode;
  loadOwnIdentity(role: "seller" | "buyer", agentName: string): Promise<AgentIdentity>;
  verifyCounterparty(callerRole: "seller" | "buyer", counterpartyAgentName: string): Promise<VerificationResult>;
}
