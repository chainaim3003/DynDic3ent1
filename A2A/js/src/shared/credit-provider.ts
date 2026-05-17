// ================= WEDGE1 / M2-α.2 — CREDIT SUB-AGENT PROVIDER =================
//
// Implements CreditProvider from src/shared/provider-types.ts.
//
// Note on naming: this provider does counterparty default-risk assessment
// (GLEIF + EDGAR composite + commodity overlay), not consumer credit
// scoring. The internal naming kept "Credit" for WEDGE1 consistency with
// the env var (CREDIT_MODE) and the M1 tier-resolver assertions. A
// post-WEDGE1 rename to CounterPartyRisk is tracked in BACKLOG.md.
//
// Mode resolution (frozen at construction):
//   - CREDIT_MODE=demo  (default) — reads DEMO-DATA/credit/<fixture>.json
//   - CREDIT_MODE=real             — STUB in M2-α.2; full GLEIF + EDGAR
//                                    composite + cotton-index overlay lands
//                                    in M2-β.
//
// Path discipline:
//   - Fixture path resolved at runtime via path.resolve(__dirname, ...).
//   - No hardcoded absolute paths anywhere.
//
// Single-fixture routing (M2-α.2):
//   - Currently returns DEMO-DATA/credit/edgar-companyfacts-PHILLIPS-VAN-HEUSEN.json
//     regardless of input.lei. M2-β will route by LEI lookup.

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

function demoDataDir(subdir: string): string {
  return path.resolve(__dirname, "..", "..", "DEMO-DATA", subdir);
}

// ─── Implementation ───────────────────────────────────────────────────────

class CreditProviderImpl implements CreditProvider {
  readonly subAgent = "credit" as const;
  readonly mode: ProviderMode;

  constructor() {
    this.mode = resolveProviderModes().credit;
  }

  async consult(
    input: CreditConsultationInput,
  ): Promise<ConsultationRecord<CreditConsultation>> {
    const performedAt = new Date().toISOString();
    const start       = Date.now();

    if (this.mode === "real") {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        "real-mode not yet implemented — set CREDIT_MODE=demo for now (lands in M2-β)",
        "(unavailable — real-mode stubbed)",
      );
    }

    return this.consultFromFixture(input, performedAt, start);
  }

  // ── Demo-mode fixture reader ───────────────────────────────────────────

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
    // rather than propagate NaN into the tactics engine.
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
