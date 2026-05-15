// ================= vLEI VERIFICATION CLIENT =================
// Calls the vLEI api-server (port 4000) to verify agent delegation
// before negotiation begins. Also reads agent card metadata for UI display.
//
// API Server endpoints used:
//   POST /api/buyer/verify/seller         — buyer verifies seller delegation (DEEP)
//   POST /api/seller/verify/buyer         — seller verifies buyer delegation (DEEP)
//   POST /api/buyer/verify/ext/seller     — buyer verifies seller (DEEP-EXT, cross-org)
//   POST /api/seller/verify/ext/buyer     — seller verifies buyer (DEEP-EXT, cross-org)
//   POST /api/buyer/verify/sellerInvoice  — buyer verifies seller invoice credential
//   GET  /health                          — api-server health check
//
// The api-server runs at legentvLEI/api-server/server.js (port 4000).
// It calls Docker-based verification scripts internally.

import fs from "fs";
import path from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VLEIConfig {
  verificationServiceUrl: string;   // e.g. "http://localhost:4000"
  enabled:                boolean;  // false → skip verification entirely
  timeoutMs:              number;   // verification can take 10-30s through Docker
}

/** Result from the api-server verification endpoint */
export interface VerificationResult {
  verified:            boolean;
  agentName:           string;
  oorHolderName:       string;
  verificationType:    string;      // "STANDARD" | "EXTERNAL" | "INVOICE_CREDENTIAL"
  verificationScript:  string;      // "DEEP" | "DEEP-EXT" | "DEEP-EXT-CREDENTIAL"
  caller:              string;      // "buyer" | "seller"
  target:              string;      // "seller" | "buyer" | "sellerInvoice"
  timestamp:           string;
  error?:              string;
  rawOutput?:          string;      // full verification script output (for debugging)
}

/** Metadata extracted from an agent card for UI display */
export interface AgentVerificationMetadata {
  // Agent identity
  agentName:           string;
  agentAID:            string;

  // Delegator (OOR holder for regular agents, parent agent for sub-agents)
  oorHolderName:       string;
  oorHolderAID:        string;

  // Organization
  legalEntityName:     string;
  lei:                 string;
  legalEntityAID:      string;

  // Trust chain
  qviAID:              string;
  verificationPath:    string[];

  // Sub-delegation (if applicable)
  isSubDelegation:     boolean;
  parentAgentName?:    string;
  parentAgentAID?:     string;
  scope?:              string;

  // Public key (if available)
  publicKey?:          string;
}

// ── Default config ───────────────────────────────────────────────────────────

const DEFAULT_CONFIG: VLEIConfig = {
  verificationServiceUrl: "http://localhost:4000",
  enabled:                true,
  timeoutMs:              30000,   // 30 seconds — DEEP scripts run through Docker
};

// ── Health check ─────────────────────────────────────────────────────────────

/**
 * Check if the vLEI api-server is reachable.
 * Returns true if the server responds to /health, false otherwise.
 */
export async function isVerificationServiceAvailable(
  config: Partial<VLEIConfig> = {}
): Promise<boolean> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${cfg.verificationServiceUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    return resp.ok;
  } catch {
    return false;
  }
}

// ── Core verification ────────────────────────────────────────────────────────

/**
 * Verify the counterparty's delegation via the vLEI api-server.
 *
 * @param callerRole  "seller" or "buyer" — who is calling the verification
 * @param mode        "DEEP" (standard, default) or "DEEP-EXT" (cross-org)
 * @param config      optional config overrides
 *
 * When callerRole is "seller", this calls POST /api/seller/verify/buyer
 *   → verifies tommyBuyerAgent delegation chain
 *
 * When callerRole is "buyer", this calls POST /api/buyer/verify/seller
 *   → verifies jupiterSellerAgent delegation chain
 */
export async function verifyCounterparty(
  callerRole: "seller" | "buyer",
  mode:       "DEEP" | "DEEP-EXT" = "DEEP",
  config:     Partial<VLEIConfig> = {}
): Promise<VerificationResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) {
    return {
      verified:           true,
      agentName:          callerRole === "seller" ? "tommyBuyerAgent" : "jupiterSellerAgent",
      oorHolderName:      callerRole === "seller" ? "Tommy_Chief_Procurement_Officer" : "Jupiter_Chief_Sales_Officer",
      verificationType:   "DISABLED",
      verificationScript: "NONE",
      caller:             callerRole,
      target:             callerRole === "seller" ? "buyer" : "seller",
      timestamp:          new Date().toISOString(),
    };
  }

  // Build the endpoint URL
  const target     = callerRole === "seller" ? "buyer" : "seller";
  const extSegment = mode === "DEEP-EXT" ? "/ext" : "";
  const endpoint   = `${cfg.verificationServiceUrl}/api/${callerRole}/verify${extSegment}/${target}`;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), cfg.timeoutMs);

    const resp = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({}),   // api-server endpoints don't require a body
      signal:  controller.signal,
    });
    clearTimeout(tid);

    const data = await resp.json() as Record<string, unknown>;

    return {
      verified:           data.success === true,
      agentName:          (data.agent as string)              ?? (callerRole === "seller" ? "tommyBuyerAgent" : "jupiterSellerAgent"),
      oorHolderName:      (data.oorHolder as string)          ?? "",
      verificationType:   (data.verificationType as string)   ?? (mode === "DEEP-EXT" ? "EXTERNAL" : "STANDARD"),
      verificationScript: (data.verificationScript as string) ?? mode,
      caller:             (data.caller as string)             ?? callerRole,
      target:             (data.target as string)             ?? target,
      timestamp:          (data.timestamp as string)          ?? new Date().toISOString(),
      error:              (data.error as string)              ?? undefined,
      rawOutput:          (data.output as string)             ?? undefined,
    };

  } catch (err: unknown) {
    const error    = err as { name?: string; message?: string; cause?: { code?: string } };
    const isTimeout = error.name === "AbortError";
    const isRefused = error.cause?.code === "ECONNREFUSED" || (error.message ?? "").includes("ECONNREFUSED");

    let errorMsg: string;
    if (isTimeout) {
      errorMsg = `Verification timed out after ${cfg.timeoutMs}ms — Docker scripts may be slow`;
    } else if (isRefused) {
      errorMsg = `Verification service unreachable at ${cfg.verificationServiceUrl} — is the api-server running?`;
    } else {
      errorMsg = `Verification failed: ${error.message ?? String(err)}`;
    }

    return {
      verified:           false,
      agentName:          callerRole === "seller" ? "tommyBuyerAgent" : "jupiterSellerAgent",
      oorHolderName:      "",
      verificationType:   "FAILED",
      verificationScript: mode,
      caller:             callerRole,
      target:             callerRole === "seller" ? "buyer" : "seller",
      timestamp:          new Date().toISOString(),
      error:              errorMsg,
    };
  }
}

// ── Invoice credential verification ──────────────────────────────────────────

/**
 * Buyer verifies seller's invoice credential via DEEP-EXT-CREDENTIAL.
 * Called after the seller sends an invoice that has been IPEX-granted.
 */
export async function verifyInvoiceCredential(
  config: Partial<VLEIConfig> = {}
): Promise<VerificationResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) {
    return {
      verified:           true,
      agentName:          "jupiterSellerAgent",
      oorHolderName:      "Jupiter_Chief_Sales_Officer",
      verificationType:   "DISABLED",
      verificationScript: "NONE",
      caller:             "buyer",
      target:             "sellerInvoice",
      timestamp:          new Date().toISOString(),
    };
  }

  const endpoint = `${cfg.verificationServiceUrl}/api/buyer/verify/sellerInvoice`;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), cfg.timeoutMs);

    const resp = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({}),
      signal:  controller.signal,
    });
    clearTimeout(tid);

    const data = await resp.json() as Record<string, unknown>;

    return {
      verified:           data.success === true,
      agentName:          (data.agent as string)              ?? "jupiterSellerAgent",
      oorHolderName:      (data.oorHolder as string)          ?? "Jupiter_Chief_Sales_Officer",
      verificationType:   (data.verificationType as string)   ?? "INVOICE_CREDENTIAL",
      verificationScript: (data.verificationScript as string) ?? "DEEP-EXT-CREDENTIAL",
      caller:             "buyer",
      target:             "sellerInvoice",
      timestamp:          (data.timestamp as string)          ?? new Date().toISOString(),
      error:              (data.error as string)              ?? undefined,
      rawOutput:          (data.output as string)             ?? undefined,
    };

  } catch (err: unknown) {
    const error = err as { message?: string };
    return {
      verified:           false,
      agentName:          "jupiterSellerAgent",
      oorHolderName:      "Jupiter_Chief_Sales_Officer",
      verificationType:   "FAILED",
      verificationScript: "DEEP-EXT-CREDENTIAL",
      caller:             "buyer",
      target:             "sellerInvoice",
      timestamp:          new Date().toISOString(),
      error:              `Invoice credential verification failed: ${error.message ?? String(err)}`,
    };
  }
}

// ── Agent card metadata extraction ───────────────────────────────────────────

/**
 * Read an agent card from disk and extract the vLEI metadata fields
 * relevant for UI display and verification proof.
 *
 * @param agentAlias  e.g. "jupiterSellerAgent", "tommyBuyerAgent", "jupiterTreasuryAgent"
 *
 * Reads from: agent-cards/<agentAlias>-card.json
 * (resolved relative to process.cwd() which is A2A/js/ when agents run)
 */
export function readAgentCardMetadata(agentAlias: string): AgentVerificationMetadata | null {
  const cardPath = path.join(process.cwd(), "agent-cards", `${agentAlias}-card.json`);

  try {
    const raw  = fs.readFileSync(cardPath, "utf8");
    const card = JSON.parse(raw) as Record<string, unknown>;

    const ext   = (card.extensions ?? {}) as Record<string, unknown>;
    const keri  = (ext.keriIdentifiers ?? {}) as Record<string, unknown>;
    const meta  = (ext.vLEImetadata ?? {}) as Record<string, unknown>;
    const gleif = (ext.gleifIdentity ?? {}) as Record<string, unknown>;

    return {
      agentName:        (meta.agentName as string)        ?? agentAlias,
      agentAID:         (keri.agentAID as string)          ?? "",
      oorHolderName:    (meta.oorHolderName as string)     ?? "",
      oorHolderAID:     (keri.oorHolderAID as string)      ?? "",
      legalEntityName:  (gleif.legalEntityName as string)  ?? "",
      lei:              (gleif.lei as string)               ?? "",
      legalEntityAID:   (keri.legalEntityAID as string)    ?? "",
      qviAID:           (keri.qviAID as string)            ?? "",
      verificationPath: (meta.verificationPath as string[]) ?? [],
      isSubDelegation:  meta.isSubDelegation === true,
      parentAgentName:  (meta.parentAgentName as string)   ?? undefined,
      parentAgentAID:   (keri.parentAgentAID as string)    ?? undefined,
      scope:            (meta.scope as string)             ?? undefined,
      publicKey:        (keri.publicKey as string)          ?? undefined,
    };
  } catch (err: unknown) {
    const error = err as { message?: string };
    console.error(`Failed to read agent card for ${agentAlias}: ${error.message}`);
    return null;
  }
}

// ── Console printer ──────────────────────────────────────────────────────────

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m",
};

/**
 * Print verification result to the agent's terminal.
 */
export function printVerificationResult(result: VerificationResult, metadata: AgentVerificationMetadata | null): void {
  console.log("");
  if (result.verified) {
    console.log(`  ${C.green}${C.bold}  [vLEI] ✅ Counterparty delegation VERIFIED${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}  [vLEI] ❌ Counterparty delegation FAILED${C.reset}`);
    console.log(`  ${C.red}  Reason: ${result.error}${C.reset}`);
  }

  if (metadata) {
    console.log(`  ${C.dim}  Agent        : ${metadata.agentName}${C.reset}`);
    console.log(`  ${C.dim}  Agent AID    : ${metadata.agentAID}${C.reset}`);
    console.log(`  ${C.dim}  OOR Holder   : ${metadata.oorHolderName}${C.reset}`);
    console.log(`  ${C.dim}  Organization : ${metadata.legalEntityName}${C.reset}`);
    console.log(`  ${C.dim}  LEI          : ${metadata.lei}${C.reset}`);
    if (metadata.verificationPath.length > 0) {
      console.log(`  ${C.dim}  Trust chain  : ${metadata.verificationPath.join(" → ")}${C.reset}`);
    }
    if (metadata.isSubDelegation) {
      console.log(`  ${C.dim}  Sub-delegated: ${metadata.parentAgentName} → ${metadata.agentName} (scope: ${metadata.scope})${C.reset}`);
    }
    if (metadata.publicKey) {
      console.log(`  ${C.dim}  Public key   : ${metadata.publicKey}${C.reset}`);
    }
  }

  console.log(`  ${C.dim}  Verified at  : ${result.timestamp}${C.reset}`);
  console.log(`  ${C.dim}  Script       : ${result.verificationScript} (${result.verificationType})${C.reset}`);
  console.log("");
}
