// ================= WEDGE1 / M2-α.2 + M2-γ — CREDIT SUB-AGENT PROVIDER =================
//
// Implements CreditProvider from src/shared/provider-types.ts.
//
// Note on naming: this provider does counterparty default-risk assessment
// (GLEIF + EDGAR composite + commodity overlay), not consumer credit
// scoring. The internal naming kept "Credit" for WEDGE1 consistency with
// the env var (CREDIT_MODE) and the M1 seller-response-mode-resolver
// assertions. A post-WEDGE1 rename to CounterPartyRisk is tracked in BACKLOG.md.
//
// Mode resolution (frozen at construction):
//   - CREDIT_MODE=demo (default) — reads DEMO-DATA/credit/<fixture>.json
//                                  directly from disk. Backward-compatible
//                                  with the M2-α.2 era — no HTTP needed,
//                                  the 314/314 test suite passes unchanged.
//   - CREDIT_MODE=real            — HTTP POST to CREDIT_URL/consult
//                                  (default http://localhost:7071/consult,
//                                  served by src/agents/credit-agent/index.ts).
//                                  Network errors / timeouts return a failed
//                                  ConsultationRecord; never throws.
//
// Path discipline:
//   - Fixture path resolved at runtime via path.resolve(__dirname, ...).
//   - No hardcoded absolute paths anywhere.

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type {
  CreditProvider,
  CreditConsultation,
  CreditConsultationInput,
  ConsultationRecord,
  ConsultationMetadata,
} from "./provider-types.js";

import { resolveProviderModes } from "./negotiation-mode.js";
import type { ProviderMode }    from "./negotiation-mode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DEFAULT_CREDIT_URL = "http://localhost:7071/consult";
const DEFAULT_TIMEOUT_MS = 5000;

function demoDataDir(subdir: string): string {
  return path.resolve(__dirname, "..", "..", "DEMO-DATA", subdir);
}

function resolveCreditUrl(): string {
  const raw = (process.env.CREDIT_URL ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_CREDIT_URL;
}

// ─── Implementation ───────────────────────────────────────────────────────

class CreditProviderImpl implements CreditProvider {
  readonly subAgent = "credit" as const;
  readonly mode: ProviderMode;
  private readonly url: string;

  constructor() {
    this.mode = resolveProviderModes().credit;
    this.url  = resolveCreditUrl();
  }

  async consult(
    input: CreditConsultationInput,
  ): Promise<ConsultationRecord<CreditConsultation>> {
    const performedAt = new Date().toISOString();
    const start       = Date.now();

    if (this.mode === "real") {
      return this.consultViaHttp(input, performedAt, start);
    }

    return this.consultFromFixture(input, performedAt, start);
  }

  // ── Demo-mode fixture reader (M2-α.2 — unchanged) ─────────────────────

  private consultFromFixture(
    input: CreditConsultationInput,
    performedAt: string,
    start: number,
  ): ConsultationRecord<CreditConsultation> {
    // M2-α.2: single hardcoded fixture. M2-β will route by LEI.
    const fixtureFile = "edgar-companyfacts-PHILLIPS-VAN-HEUSEN.json";
    const fixturePath = path.join(demoDataDir("credit"), fixtureFile);
    const relativeRef = `DEMO-DATA/credit/${fixtureFile}`;

    let parsed: { __source?: Partial<ConsultationMetadata>; result?: CreditConsultation };
    try {
      const raw = fs.readFileSync(fixturePath, "utf8");
      parsed = JSON.parse(raw);
    } catch (err: any) {
      const detail = err?.code === "ENOENT"
        ? `fixture not found at ${relativeRef} (cwd-relative)`
        : `fixture read/parse failed: ${err?.message ?? err}`;
      return this.failRecord(performedAt, Date.now() - start, detail, relativeRef);
    }

    if (!parsed || typeof parsed !== "object" || !parsed.result || !parsed.__source) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `fixture missing __source or result block: ${relativeRef}`,
        relativeRef,
      );
    }

    // Sanity check on the financial fields — these are the ones the L2
    // executive will reason over, so a malformed fixture should fail loudly
    // rather than propagate NaN into the advisor math aggregator.
    const r = parsed.result;
    if (
      typeof r.financialHealthScore !== "number" ||
      typeof r.pd1y                 !== "number" ||
      typeof r.lgd                  !== "number"
    ) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `fixture has non-numeric financialHealthScore / pd1y / lgd: ${relativeRef}`,
        relativeRef,
      );
    }

    const metadata: ConsultationMetadata = {
      subAgent:       "credit",
      dataMode:       "demo",
      performedAt,                                        // live
      dataSource:     parsed.__source.dataSource     ?? relativeRef,
      demoSourceKind: parsed.__source.demoSourceKind ?? "fixture",
      demoSourceRef:  parsed.__source.demoSourceRef  ?? relativeRef,
      latencyMs:      Date.now() - start,                  // live
    };

    return {
      metadata,
      success: true,
      result:  parsed.result,
    };
  }

  // ── Real-mode HTTP adapter (M2-γ) — calls the credit-agent on port 7071 ─

  private async consultViaHttp(
    input: CreditConsultationInput,
    performedAt: string,
    start: number,
  ): Promise<ConsultationRecord<CreditConsultation>> {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(input),
        signal:  controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      const detail = err?.name === "AbortError"
        ? `credit HTTP request timed out after ${DEFAULT_TIMEOUT_MS}ms at ${this.url}`
        : `credit HTTP request failed at ${this.url}: ${err?.message ?? err}`;
      return this.failRecord(performedAt, Date.now() - start, detail, `${this.url} (real-mode unreachable)`);
    }
    clearTimeout(timeout);

    if (!response.ok) {
      // The agent itself may have returned a structured failure record in
      // the body (4xx/5xx with a JSON ConsultationRecord). Try to surface
      // that verbatim rather than overwriting with a generic message.
      try {
        const body = (await response.json()) as ConsultationRecord<CreditConsultation>;
        if (body && body.metadata && typeof body.success === "boolean") {
          return body;
        }
      } catch { /* fall through to generic */ }
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `credit agent responded HTTP ${response.status} at ${this.url}`,
        this.url,
      );
    }

    let body: ConsultationRecord<CreditConsultation>;
    try {
      body = (await response.json()) as ConsultationRecord<CreditConsultation>;
    } catch (err: any) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `credit agent response was not valid JSON: ${err?.message ?? err}`,
        this.url,
      );
    }

    // Agent must return a well-formed ConsultationRecord. If shape is wrong,
    // surface a defensive failure rather than passing undefined downstream.
    if (!body || !body.metadata || typeof body.success !== "boolean") {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `credit agent returned malformed ConsultationRecord at ${this.url}`,
        this.url,
      );
    }

    // Overwrite client-side latency so the audit reflects total round-trip
    // (the agent's latency stays in its own logs); everything else from the
    // agent passes through verbatim — same fixture data, just over HTTP.
    body.metadata.latencyMs = Date.now() - start;
    return body;
  }

  // ── Failure record helper ──────────────────────────────────────────────

  private failRecord(
    performedAt: string,
    latencyMs:   number,
    error:       string,
    dataSource:  string,
  ): ConsultationRecord<CreditConsultation> {
    return {
      metadata: {
        subAgent:   "credit",
        dataMode:   this.mode,
        performedAt,
        dataSource,
        latencyMs,
      },
      success: false,
      error,
    };
  }
}

// ─── Public factory ───────────────────────────────────────────────────────

let _singleton: CreditProviderImpl | null = null;

export function getCreditProvider(): CreditProvider {
  if (_singleton === null) _singleton = new CreditProviderImpl();
  return _singleton;
}

export function resetCreditProviderForTest(): void {
  _singleton = null;
}
