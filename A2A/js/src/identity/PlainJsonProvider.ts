// ================= PLAIN JSON PROVIDER =================
// Identity verification WITHOUT cryptographic delegation.
//
// What this provider CHECKS:
//   ✓ Counterparty's agent card exists on disk (live or demo)
//   ✓ LEI in the card is well-formed (ISO 17442 with checksum)
//   ✓ LEI exists in GLEIF database
//   ✓ LEI registration status is ISSUED
//   ✓ LE entity status is ACTIVE
//   ✓ Country not in sanctions watchlist (if SANCTIONED_COUNTRIES set)
//
// What this provider DOES NOT check (these require vLEI mode):
//   ✗ KERI delegation chain (QVI → LE → OOR → agent)
//   ✗ OOR officer credential cryptographically signed by LE
//   ✗ Agent's public key matches AID derivation
//   ✗ Per-message signatures
//
// The honest list of checks performed is preserved in
// VerificationResult.checksPerformed so the audit shows exactly what ran.
//
// GLEIF_RECHECK_AT_NEGOTIATION=true (default) forces a fresh GLEIF lookup
// on every negotiation (defense in depth — catches an LEI lapsing mid-quarter).
// Set =false to use cached lookups only.

import {
  CredentialProvider,
  CredentialMode,
  AgentIdentity,
  VerificationResult,
} from "./CredentialProvider.js";
import { loadAgentCard } from "./agent-card-loader.js";
import { checkCompliance } from "../utils/compliance/gleif-client.js";

export class PlainJsonProvider implements CredentialProvider {
  mode(): CredentialMode { return "plain"; }

  async loadOwnIdentity(role: "seller" | "buyer", agentName: string): Promise<AgentIdentity> {
    const found = loadAgentCard(agentName);
    if (!found) {
      throw new Error(
        `[plain-mode] Agent card not found for "${agentName}" in live-agent-cards/ or demo-agent-cards/`
      );
    }
    const ext   = found.card.extensions ?? {};
    const gleif = ext.gleifIdentity ?? {};
    const vlei  = ext.vLEImetadata ?? {};
    const keri  = ext.keriIdentifiers ?? {};

    const lei = gleif.lei ?? "";
    if (!lei) {
      throw new Error(`[plain-mode] Agent card "${agentName}" has no gleifIdentity.lei`);
    }

    // Real GLEIF lookup at startup. NO mock data.
    const compliance = await checkCompliance(lei, { forceFresh: false });
    if (!compliance.ok) {
      throw new Error(
        `[plain-mode] Own LEI ${lei} failed compliance at startup: ` +
        (compliance.errors.join("; ") || compliance.warnings.join("; "))
      );
    }

    return {
      agentName,
      agentRole:        role,
      legalEntityName:  compliance.record!.legalEntityName || gleif.legalEntityName || "",
      lei,
      oorOfficer:       vlei.oorHolderName ?? "",
      // Plain mode does NOT derive these. We preserve what's in the card for
      // display, but they have NOT been cryptographically verified.
      agentAID:         keri.agentAID ?? "",
      oorHolderAID:     keri.oorHolderAID ?? "",
      legalEntityAID:   keri.legalEntityAID ?? "",
      qviAID:           keri.qviAID ?? "",
      publicKey:        keri.publicKey,
      gleifRecord:      compliance.record,
      verificationPath: [
        `GLEIF[${compliance.record!.lei}]`,
        `legalEntity[${compliance.record!.legalEntityName}]`,
        `agent[${agentName}]  (NOT cryptographically delegated — plain mode)`,
      ],
    };
  }

  async verifyCounterparty(
    callerRole: "seller" | "buyer",
    counterpartyAgentName: string,
  ): Promise<VerificationResult> {
    const errors:   string[] = [];
    const warnings: string[] = [];
    const checksPerformed: string[] = ["plain-mode-acknowledged"];

    const found = loadAgentCard(counterpartyAgentName);
    if (!found) {
      return {
        verified:        false,
        mode:            "plain",
        counterparty:    emptyIdentity(counterpartyAgentName, callerRole === "seller" ? "buyer" : "seller"),
        checksPerformed: [...checksPerformed, "agent-card-load:NOT_FOUND"],
        warnings,
        errors:          [`Agent card not found for "${counterpartyAgentName}"`],
        verifiedAt:      new Date().toISOString(),
      };
    }
    checksPerformed.push(`agent-card-load:${found.origin}`);

    const ext   = found.card.extensions ?? {};
    const gleif = ext.gleifIdentity ?? {};
    const vlei  = ext.vLEImetadata ?? {};
    const keri  = ext.keriIdentifiers ?? {};
    const lei   = gleif.lei ?? "";

    if (!lei) {
      errors.push(`Agent card has no LEI`);
      return {
        verified:     false,
        mode:         "plain",
        counterparty: emptyIdentity(counterpartyAgentName, callerRole === "seller" ? "buyer" : "seller"),
        checksPerformed,
        warnings,
        errors,
        verifiedAt:   new Date().toISOString(),
      };
    }

    // GLEIF check — fresh fetch if GLEIF_RECHECK_AT_NEGOTIATION=true (default)
    const recheck = (process.env.GLEIF_RECHECK_AT_NEGOTIATION ?? "true").toLowerCase() !== "false";
    const compliance = await checkCompliance(lei, { forceFresh: recheck });
    for (const c of compliance.checksPerformed) checksPerformed.push(c);
    for (const w of compliance.warnings)        warnings.push(w);
    for (const e of compliance.errors)          errors.push(e);

    // Honest record of what plain mode does NOT do
    checksPerformed.push("delegation-chain:SKIPPED_IN_PLAIN_MODE");
    checksPerformed.push("oor-credential:SKIPPED_IN_PLAIN_MODE");
    checksPerformed.push("agent-key-derivation:SKIPPED_IN_PLAIN_MODE");

    const counterpartyRole = callerRole === "seller" ? "buyer" : "seller";

    const identity: AgentIdentity = {
      agentName:        counterpartyAgentName,
      agentRole:        counterpartyRole,
      legalEntityName:  compliance.record?.legalEntityName ?? gleif.legalEntityName ?? "",
      lei,
      oorOfficer:       vlei.oorHolderName ?? "",
      agentAID:         keri.agentAID ?? "",
      oorHolderAID:     keri.oorHolderAID ?? "",
      legalEntityAID:   keri.legalEntityAID ?? "",
      qviAID:           keri.qviAID ?? "",
      publicKey:        keri.publicKey,
      gleifRecord:      compliance.record,
      verificationPath: compliance.record ? [
        `GLEIF[${compliance.record.lei}/${compliance.record.registrationStatus}]`,
        `legalEntity[${compliance.record.legalEntityName}]`,
        `agent[${counterpartyAgentName}]  (NOT cryptographically delegated — plain mode)`,
      ] : [`agent[${counterpartyAgentName}]  (GLEIF lookup failed)`],
    };

    const verified = compliance.ok;
    return {
      verified,
      mode:            "plain",
      counterparty:    identity,
      checksPerformed,
      warnings,
      errors,
      verifiedAt:      new Date().toISOString(),
    };
  }
}

function emptyIdentity(agentName: string, role: "seller" | "buyer"): AgentIdentity {
  return {
    agentName,
    agentRole:        role,
    legalEntityName:  "",
    lei:              "",
    oorOfficer:       "",
    agentAID:         "",
    oorHolderAID:     "",
    legalEntityAID:   "",
    qviAID:           "",
    verificationPath: [],
  };
}
