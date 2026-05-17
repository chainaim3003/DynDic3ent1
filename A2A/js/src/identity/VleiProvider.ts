// ================= VLEI PROVIDER =================
// Identity verification WITH cryptographic delegation (KERI/vLEI).
//
// What this provider checks (everything plain mode checks PLUS):
//   ✓ KERIA service is reachable
//   ✓ Counterparty's agent AID resolvable via KERI witness network
//   ✓ Delegation chain: GLEIF_ROOT → QVI → LE → OOR → agent
//   ✓ OOR officer credential signed by LE
//   ✓ Agent's public key matches AID derivation
//
// No silent fallback. If KERIA is unreachable at startup, loadOwnIdentity()
// throws and the agent fails fast. Customer must explicitly switch to
// CREDENTIAL_MODE=plain to proceed without KERIA.

import {
  CredentialProvider,
  CredentialMode,
  AgentIdentity,
  VerificationResult,
} from "./CredentialProvider.js";
import { loadAgentCard } from "./agent-card-loader.js";
import { checkCompliance } from "../utils/compliance/gleif-client.js";
import {
  verifyCounterparty as keriVerifyCounterparty,
  isVerificationServiceAvailable,
} from "../shared/vlei-verification-client.js";

export class VleiProvider implements CredentialProvider {
  mode(): CredentialMode { return "vlei"; }

  async loadOwnIdentity(role: "seller" | "buyer", agentName: string): Promise<AgentIdentity> {
    // Hard-check KERIA availability at startup — no silent fallback.
    const keriaUp = await isVerificationServiceAvailable();
    if (!keriaUp) {
      throw new Error(
        `[vlei-mode] KERIA api-server unreachable (default http://localhost:4000). ` +
        `Start the legentvLEI Docker stack OR set CREDENTIAL_MODE=plain in your .env.`
      );
    }

    const found = loadAgentCard(agentName);
    if (!found) {
      throw new Error(`[vlei-mode] Agent card not found for "${agentName}"`);
    }
    const ext   = found.card.extensions ?? {};
    const gleif = ext.gleifIdentity ?? {};
    const vlei  = ext.vLEImetadata ?? {};
    const keri  = ext.keriIdentifiers ?? {};

    if (!keri.agentAID || !keri.oorHolderAID || !keri.legalEntityAID || !keri.qviAID) {
      throw new Error(
        `[vlei-mode] Agent card "${agentName}" missing KERI identifiers. ` +
        `Plain-mode cards cannot be used in vLEI mode.`
      );
    }

    const lei = gleif.lei ?? "";
    const compliance = await checkCompliance(lei, { forceFresh: false });
    if (!compliance.ok) {
      throw new Error(
        `[vlei-mode] Own LEI ${lei} failed GLEIF compliance at startup: ` +
        (compliance.errors.join("; ") || compliance.warnings.join("; "))
      );
    }

    return {
      agentName,
      agentRole:       role,
      legalEntityName: compliance.record!.legalEntityName,
      lei,
      oorOfficer:      vlei.oorHolderName ?? "",
      agentAID:        keri.agentAID,
      oorHolderAID:    keri.oorHolderAID,
      legalEntityAID:  keri.legalEntityAID,
      qviAID:          keri.qviAID,
      publicKey:       keri.publicKey,
      gleifRecord:     compliance.record,
      verificationPath: vlei.verificationPath ?? [
        "GLEIF_ROOT",
        `QVI[${keri.qviAID}]`,
        `LE[${keri.legalEntityAID}]`,
        `OOR[${keri.oorHolderAID}]`,
        `agent[${keri.agentAID}]`,
      ],
    };
  }

  async verifyCounterparty(
    callerRole: "seller" | "buyer",
    counterpartyAgentName: string,
  ): Promise<VerificationResult> {
    const errors:   string[] = [];
    const warnings: string[] = [];
    const checksPerformed: string[] = ["vlei-mode-acknowledged"];
    const counterpartyRole = callerRole === "seller" ? "buyer" : "seller";

    // ── 1. Load card ────────────────────────────────────────────────────
    const found = loadAgentCard(counterpartyAgentName);
    if (!found) {
      return {
        verified:     false,
        mode:         "vlei",
        counterparty: emptyIdentity(counterpartyAgentName, counterpartyRole),
        checksPerformed: [...checksPerformed, "agent-card-load:NOT_FOUND"],
        warnings, errors: [`Agent card not found for "${counterpartyAgentName}"`],
        verifiedAt: new Date().toISOString(),
      };
    }
    checksPerformed.push(`agent-card-load:${found.origin}`);

    const ext   = found.card.extensions ?? {};
    const gleif = ext.gleifIdentity ?? {};
    const vlei  = ext.vLEImetadata ?? {};
    const keri  = ext.keriIdentifiers ?? {};
    const lei   = gleif.lei ?? "";

    // ── 2. GLEIF compliance ─────────────────────────────────────────────
    const recheck = (process.env.GLEIF_RECHECK_AT_NEGOTIATION ?? "true").toLowerCase() !== "false";
    const compliance = await checkCompliance(lei, { forceFresh: recheck });
    for (const c of compliance.checksPerformed) checksPerformed.push(c);
    for (const w of compliance.warnings)        warnings.push(w);
    for (const e of compliance.errors)          errors.push(e);

    // ── 3. KERI delegation chain via existing client ────────────────────
    checksPerformed.push("keri-delegation-chain-verify");
    const keriResult = await keriVerifyCounterparty(callerRole, "DEEP-EXT");
    if (!keriResult.verified) {
      errors.push(`KERI delegation chain verification failed: ${keriResult.error}`);
    } else {
      checksPerformed.push(`keri-script:${keriResult.verificationScript}`);
    }

    const identity: AgentIdentity = {
      agentName:       counterpartyAgentName,
      agentRole:       counterpartyRole,
      legalEntityName: compliance.record?.legalEntityName ?? gleif.legalEntityName ?? "",
      lei,
      oorOfficer:      vlei.oorHolderName ?? keriResult.oorHolderName ?? "",
      agentAID:        keri.agentAID ?? "",
      oorHolderAID:    keri.oorHolderAID ?? "",
      legalEntityAID:  keri.legalEntityAID ?? "",
      qviAID:          keri.qviAID ?? "",
      publicKey:       keri.publicKey,
      gleifRecord:     compliance.record,
      verificationPath: vlei.verificationPath ?? [],
    };

    const verified = compliance.ok && keriResult.verified;
    return {
      verified,
      mode:            "vlei",
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
