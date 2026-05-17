// ================= WEDGE1 / M2-α.2 — LOGISTICS SUB-AGENT PROVIDER =================
//
// Implements LogisticsProvider from src/shared/provider-types.ts.
//
// Mode resolution (frozen at construction):
//   - LOGISTICS_MODE=demo  (default) — reads DEMO-DATA/logistics/<fixture>.json
//   - LOGISTICS_MODE=real             — STUB in M2-α.2; full DCSA T&T call
//                                       lands in M2-β.
//
// Path discipline:
//   - Fixture path resolved at runtime via path.resolve(__dirname, ...).
//   - No hardcoded absolute paths anywhere.
//
// Single-fixture routing (M2-α.2):
//   - Currently returns DEMO-DATA/logistics/dcsa-MAA-LAX-50000units.json
//     regardless of input.originPort / destinationPort / quantity.
//     M2-β will route fixtures by lane + quantity bracket.

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

function demoDataDir(subdir: string): string {
  return path.resolve(__dirname, "..", "..", "DEMO-DATA", subdir);
}

// ─── Implementation ───────────────────────────────────────────────────────

class LogisticsProviderImpl implements LogisticsProvider {
  readonly subAgent = "logistics" as const;
  readonly mode: ProviderMode;

  constructor() {
    this.mode = resolveProviderModes().logistics;
  }

  async consult(
    input: LogisticsConsultationInput,
  ): Promise<ConsultationRecord<LogisticsConsultation>> {
    const performedAt = new Date().toISOString();
    const start       = Date.now();

    if (this.mode === "real") {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        "real-mode not yet implemented — set LOGISTICS_MODE=demo for now (lands in M2-β)",
        "(unavailable — real-mode stubbed)",
      );
    }

    return this.consultFromFixture(input, performedAt, start);
  }

  // ── Demo-mode fixture reader ───────────────────────────────────────────

  private consultFromFixture(
    input: LogisticsConsultationInput,
    performedAt: string,
    start: number,
  ): ConsultationRecord<LogisticsConsultation> {
    // M2-α.2: single hardcoded fixture. M2-β will route by lane + qty bracket.
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

    // Quick sanity check on carrier list (signals corrupted fixture early
    // rather than silently returning an empty carrier list).
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
