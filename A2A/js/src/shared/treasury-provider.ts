// ================= WEDGE1 / M2-α.3 + M2-β.2 — TREASURY SUB-AGENT PROVIDER =================
//
// Implements TreasuryProvider from src/shared/provider-types.ts.
//
// Architectural note:
// The treasury agent itself (src/agents/treasury-agent/index.ts) is NOT
// modified by M2-α.3 or M2-β.2. It continues to serve POST /consult exactly
// as before — same body shape, same TreasuryResult response — so the existing
// seller-agent's treasury-consultation path (relied on by T1) is unchanged.
//
// This file is the ADAPTER that wraps that existing HTTP call and reshapes
// the response into a ConsultationRecord<TreasuryConsultation> so M2-β's
// ConsultationRouter can route treasury calls through the same Provider
// pattern as Inventory/Logistics/Credit. Zero risk to T1.
//
// Mode resolution (frozen at construction):
//   - TREASURY_MODE=real (DEFAULT) — HTTP POST to TREASURY_URL/consult
//                                    (default http://localhost:7070/consult).
//                                    Network errors / timeouts return a
//                                    failed ConsultationRecord; never throws.
//   - TREASURY_MODE=demo            — Reads DEMO-DATA/treasury/<fixture>.json
//                                    (single-fixture routing in M2-β.2;
//                                    M2-β.3+ may route by pricePerUnit band).
//
// Why treasury defaults to `real` while the other three default to `demo`:
// treasury is always-on in BASIC_SALES_QUOTING_1+ (it provides the cash/NPV
// guardrail the existing seller agent already depends on). Turning it off in
// BASIC_SALES_QUOTING_1 would be a behavior regression.
//
// Path discipline: zero hardcoded paths. TREASURY_URL is the only configurable
// endpoint and falls back to a localhost default. The demo-mode fixture path
// is resolved at runtime via path.resolve(__dirname, ...) — same convention
// as inventory/logistics/credit providers. No absolute paths anywhere.

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type {
  TreasuryProvider,
  TreasuryConsultation,
  TreasuryConsultationInput,
  ConsultationRecord,
  ConsultationMetadata,
} from "./provider-types.js";

import type { ProviderMode } from "./negotiation-mode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DEFAULT_TREASURY_URL = "http://localhost:7070/consult";
const DEFAULT_TIMEOUT_MS   = 5000;

/**
 * Resolves the DEMO-DATA subdirectory at runtime from this file's actual
 * location. Same pattern as inventory-provider.ts — `__dirname` for a built
 * file in src/shared/ resolves to that directory; `../../` walks up to
 * A2A/js/.
 */
function demoDataDir(subdir: string): string {
  return path.resolve(__dirname, "..", "..", "DEMO-DATA", subdir);
}

/**
 * Reads TREASURY_MODE lazily (after dotenv has run). Accepts "real" or
 * "demo" case-insensitively; anything else is treated as "real" with a
 * warning — keeps the default safe even when someone fat-fingers env vars.
 */
function resolveTreasuryMode(): ProviderMode {
  const raw = (process.env.TREASURY_MODE ?? "").trim().toLowerCase();
  if (raw === "demo") return "demo";
  if (raw === "real" || raw === "") return "real";
  // unknown value — log once and fall back to real (the safe default)
  // eslint-disable-next-line no-console
  console.warn(`[treasury-provider] TREASURY_MODE="${process.env.TREASURY_MODE}" not recognized; defaulting to "real"`);
  return "real";
}

function resolveTreasuryUrl(): string {
  const raw = (process.env.TREASURY_URL ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_TREASURY_URL;
}

/**
 * Shape the existing treasury agent returns at POST /consult. Defined
 * locally instead of imported from ../agents/treasury-agent/index.ts to
 * avoid pulling the entire treasury executable code path into anyone who
 * imports the provider. Field names match the existing response.
 */
interface TreasuryResultLite {
  approved?: boolean;
  npvOfDeal?: number;
  netProfit?: number;
  projectedMinBalance?: number;
  safetyThreshold?: number;
  workingCapitalCost?: number;
  minViablePrice?: number;
  failReasons?: string[];
}

// ─── Implementation ───────────────────────────────────────────────────────

class TreasuryProviderImpl implements TreasuryProvider {
  readonly subAgent = "treasury" as const;
  readonly mode: ProviderMode;
  private readonly url: string;

  constructor() {
    this.mode = resolveTreasuryMode();
    this.url  = resolveTreasuryUrl();
  }

  async consult(
    input: TreasuryConsultationInput,
  ): Promise<ConsultationRecord<TreasuryConsultation>> {
    const performedAt = new Date().toISOString();
    const start       = Date.now();

    if (this.mode === "demo") {
      return this.consultFromFixture(input, performedAt, start);
    }

    // real mode: HTTP POST to the existing treasury /consult endpoint
    return this.consultViaHttp(input, performedAt, start);
  }

  // ── Demo-mode fixture reader (M2-β.2) ──────────────────────────────────

  private consultFromFixture(
    input: TreasuryConsultationInput,
    performedAt: string,
    start: number,
  ): ConsultationRecord<TreasuryConsultation> {
    // M2-β.2: single hardcoded fixture. M2-β.3+ may route by pricePerUnit
    // band (e.g. one fixture for ≤floor, one for mid-range, one for ≥ceiling)
    // once the L2 executive's call pattern is understood. For now, one verdict.
    const fixtureFile = "jupiter-treasury-pricepoint-370-net30.json";
    const fixturePath = path.join(demoDataDir("treasury"), fixtureFile);
    const relativeRef = `DEMO-DATA/treasury/${fixtureFile}`;

    let parsed: { __source?: Partial<ConsultationMetadata>; result?: TreasuryConsultation };
    try {
      const raw = fs.readFileSync(fixturePath, "utf8");
      parsed    = JSON.parse(raw);
    } catch (err: any) {
      const detail = err?.code === "ENOENT"
        ? `fixture not found at ${relativeRef} (cwd-relative)`
        : `fixture read/parse failed: ${err?.message ?? err}`;
      return this.failRecord(performedAt, Date.now() - start, detail, relativeRef);
    }

    // Shape sanity — the fixture must have a __source block and a result block.
    if (!parsed || typeof parsed !== "object" || !parsed.result || !parsed.__source) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `fixture missing __source or result block: ${relativeRef}`,
        relativeRef,
      );
    }

    // Merge fixture provenance with live runtime values. The fixture's static
    // performedAt is a demo-time stamp; the audit needs the actual consultation
    // time. Same merge pattern as the other 3 demo providers.
    const metadata: ConsultationMetadata = {
      subAgent:       "treasury",
      dataMode:       "demo",
      performedAt,                                          // live
      dataSource:     parsed.__source.dataSource     ?? relativeRef,
      demoSourceKind: parsed.__source.demoSourceKind ?? "fixture",
      demoSourceRef:  parsed.__source.demoSourceRef  ?? relativeRef,
      latencyMs:      Date.now() - start,                    // live
    };

    // Overwrite the fixture's pricePerUnit + round with live input values so
    // the audit accurately reflects the negotiation context (round number,
    // candidate price) rather than the static fixture values. The verdict
    // (approved, npvOfDeal, etc.) still comes from fixture — that's the
    // single-fixture-routing semantic.
    const result: TreasuryConsultation = {
      ...parsed.result,
      pricePerUnit: input.pricePerUnit,
      round:        input.round,
    };

    return {
      metadata,
      success: true,
      result,
    };
  }

  // ── Real-mode HTTP adapter ─────────────────────────────────────────────

  private async consultViaHttp(
    input: TreasuryConsultationInput,
    performedAt: string,
    start: number,
  ): Promise<ConsultationRecord<TreasuryConsultation>> {
    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(this.url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          negotiationId: input.negotiationId,
          pricePerUnit:  input.pricePerUnit,
          quantity:      input.quantity,
          paymentTerms:  input.paymentTermsDays,
          round:         input.round,
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      clearTimeout(timeout);
      const detail = err?.name === "AbortError"
        ? `treasury HTTP request timed out after ${DEFAULT_TIMEOUT_MS}ms at ${this.url}`
        : `treasury HTTP request failed at ${this.url}: ${err?.message ?? err}`;
      return this.failRecord(performedAt, Date.now() - start, detail, `${this.url} (real-mode unreachable)`);
    }
    clearTimeout(timeout);

    if (!response.ok) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `treasury responded HTTP ${response.status} at ${this.url}`,
        this.url,
      );
    }

    let body: TreasuryResultLite;
    try {
      body = (await response.json()) as TreasuryResultLite;
    } catch (err: any) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `treasury response was not valid JSON: ${err?.message ?? err}`,
        this.url,
      );
    }

    // Shape sanity — `approved` is the one field every TreasuryResult must
    // carry. If it's missing, the response shape changed; surface that as a
    // defensive failure rather than silently passing undefined downstream.
    if (typeof body.approved !== "boolean") {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `treasury response missing required field "approved" (got ${typeof body.approved})`,
        this.url,
      );
    }

    // Translate TreasuryResultLite → TreasuryConsultation. Numeric fields
    // that the existing treasury agent may not return are coerced to 0
    // rather than NaN to keep the downstream advisor math aggregator math sane.
    const consultation: TreasuryConsultation = {
      approved:            body.approved,
      npvOfDeal:           num(body.npvOfDeal,           0),
      netProfit:           num(body.netProfit,           0),
      projectedMinBalance: num(body.projectedMinBalance, 0),
      safetyThreshold:     num(body.safetyThreshold,     0),
      workingCapitalCost:  num(body.workingCapitalCost,  0),
      minViablePrice:      typeof body.minViablePrice === "number" ? body.minViablePrice : undefined,
      failReasons:         Array.isArray(body.failReasons) ? body.failReasons : [],
      pricePerUnit:        input.pricePerUnit,
      round:               input.round,
    };

    const metadata: ConsultationMetadata = {
      subAgent:    "treasury",
      dataMode:    "real",
      performedAt,
      dataSource:  `JupiterTreasuryAgent /consult @ ${this.url}`,
      latencyMs:   Date.now() - start,
    };

    return {
      metadata,
      success: true,
      result:  consultation,
    };
  }

  // ── Failure record helper ──────────────────────────────────────────────

  private failRecord(
    performedAt: string,
    latencyMs:   number,
    error:       string,
    dataSource:  string,
  ): ConsultationRecord<TreasuryConsultation> {
    return {
      metadata: {
        subAgent:   "treasury",
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

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ─── Public factory ───────────────────────────────────────────────────────

let _singleton: TreasuryProviderImpl | null = null;

/**
 * Returns the process-wide Treasury provider instance. Singleton so the
 * mode + URL are resolved once at first call and stay consistent for the
 * lifetime of the process. Tests use resetTreasuryProviderForTest() to
 * drop the cache between env permutations.
 */
export function getTreasuryProvider(): TreasuryProvider {
  if (_singleton === null) _singleton = new TreasuryProviderImpl();
  return _singleton;
}

/** Test-only — drop the cached singleton so the next call re-reads env. */
export function resetTreasuryProviderForTest(): void {
  _singleton = null;
}
