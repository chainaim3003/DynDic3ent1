// ================= WEDGE1 / M2-α.2 + M2-γ — LOGISTICS SUB-AGENT PROVIDER =================
//
// Implements LogisticsProvider from src/shared/provider-types.ts.
//
// Mode resolution (frozen at construction):
//   - LOGISTICS_MODE=demo (default) — reads DEMO-DATA/logistics/<fixture>.json
//                                    directly from disk. Backward-compatible
//                                    with the M2-α.2 era — no HTTP needed,
//                                    314/314 test suite passes unchanged.
//   - LOGISTICS_MODE=real            — HTTP POST to LOGISTICS_URL/consult
//                                    (default http://localhost:7073/consult,
//                                    served by src/agents/logistics-agent/index.ts).
//                                    Network errors / timeouts return a failed
//                                    ConsultationRecord; never throws.

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type {
  LogisticsProvider,
  LogisticsConsultation,
  LogisticsConsultationInput,
  ConsultationRecord,
  ConsultationMetadata,
} from "./provider-types.js";

import { resolveProviderModes } from "./negotiation-mode.js";
import type { ProviderMode }    from "./negotiation-mode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DEFAULT_LOGISTICS_URL = "http://localhost:7073/consult";
const DEFAULT_TIMEOUT_MS    = 5000;

function demoDataDir(subdir: string): string {
  return path.resolve(__dirname, "..", "..", "DEMO-DATA", subdir);
}

function resolveLogisticsUrl(): string {
  const raw = (process.env.LOGISTICS_URL ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_LOGISTICS_URL;
}

// ─── Implementation ───────────────────────────────────────────────────────

class LogisticsProviderImpl implements LogisticsProvider {
  readonly subAgent = "logistics" as const;
  readonly mode: ProviderMode;
  private readonly url: string;

  constructor() {
    this.mode = resolveProviderModes().logistics;
    this.url  = resolveLogisticsUrl();
  }

  async consult(
    input: LogisticsConsultationInput,
  ): Promise<ConsultationRecord<LogisticsConsultation>> {
    const performedAt = new Date().toISOString();
    const start       = Date.now();

    if (this.mode === "real") {
      return this.consultViaHttp(input, performedAt, start);
    }

    return this.consultFromFixture(input, performedAt, start);
  }

  // ── Demo-mode fixture reader (M2-α.2 — unchanged) ─────────────────────

  private consultFromFixture(
    input: LogisticsConsultationInput,
    performedAt: string,
    start: number,
  ): ConsultationRecord<LogisticsConsultation> {
    const fixtureFile = "dcsa-MAA-LAX-50000units.json";
    const fixturePath = path.join(demoDataDir("logistics"), fixtureFile);
    const relativeRef = `DEMO-DATA/logistics/${fixtureFile}`;

    let parsed: { __source?: Partial<ConsultationMetadata>; result?: LogisticsConsultation };
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

    if (!Array.isArray(parsed.result.carriers) || parsed.result.carriers.length === 0) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `fixture has empty carriers array: ${relativeRef}`,
        relativeRef,
      );
    }

    const metadata: ConsultationMetadata = {
      subAgent:       "logistics",
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

  // ── Real-mode HTTP adapter (M2-γ) — calls logistics-agent on port 7073 ─

  private async consultViaHttp(
    input: LogisticsConsultationInput,
    performedAt: string,
    start: number,
  ): Promise<ConsultationRecord<LogisticsConsultation>> {
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
        ? `logistics HTTP request timed out after ${DEFAULT_TIMEOUT_MS}ms at ${this.url}`
        : `logistics HTTP request failed at ${this.url}: ${err?.message ?? err}`;
      return this.failRecord(performedAt, Date.now() - start, detail, `${this.url} (real-mode unreachable)`);
    }
    clearTimeout(timeout);

    if (!response.ok) {
      try {
        const body = (await response.json()) as ConsultationRecord<LogisticsConsultation>;
        if (body && body.metadata && typeof body.success === "boolean") {
          return body;
        }
      } catch { /* fall through */ }
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `logistics agent responded HTTP ${response.status} at ${this.url}`,
        this.url,
      );
    }

    let body: ConsultationRecord<LogisticsConsultation>;
    try {
      body = (await response.json()) as ConsultationRecord<LogisticsConsultation>;
    } catch (err: any) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `logistics agent response was not valid JSON: ${err?.message ?? err}`,
        this.url,
      );
    }

    if (!body || !body.metadata || typeof body.success !== "boolean") {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `logistics agent returned malformed ConsultationRecord at ${this.url}`,
        this.url,
      );
    }

    body.metadata.latencyMs = Date.now() - start;
    return body;
  }

  // ── Failure record helper ──────────────────────────────────────────────

  private failRecord(
    performedAt: string,
    latencyMs:   number,
    error:       string,
    dataSource:  string,
  ): ConsultationRecord<LogisticsConsultation> {
    return {
      metadata: {
        subAgent:   "logistics",
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

let _singleton: LogisticsProviderImpl | null = null;

export function getLogisticsProvider(): LogisticsProvider {
  if (_singleton === null) _singleton = new LogisticsProviderImpl();
  return _singleton;
}

export function resetLogisticsProviderForTest(): void {
  _singleton = null;
}
