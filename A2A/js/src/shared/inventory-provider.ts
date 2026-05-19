// ================= WEDGE1 / M2-α.2 + M2-γ — INVENTORY SUB-AGENT PROVIDER =================
//
// Implements InventoryProvider from src/shared/provider-types.ts.
//
// Mode resolution (frozen at construction; not switchable at runtime):
//   - INVENTORY_MODE=demo (default) — reads DEMO-DATA/inventory/<fixture>.json
//                                     directly from disk. Backward-compatible
//                                     with the M2-α.2 era — no HTTP needed,
//                                     314/314 test suite passes unchanged.
//   - INVENTORY_MODE=real            — HTTP POST to INVENTORY_URL/consult
//                                     (default http://localhost:7072/consult,
//                                     served by src/agents/inventory-agent/index.ts).
//                                     Network errors / timeouts return a failed
//                                     ConsultationRecord; never throws.
//
// Path discipline: fixture path resolved at runtime via path.resolve.

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type {
  InventoryProvider,
  InventoryConsultation,
  InventoryConsultationInput,
  ConsultationRecord,
  ConsultationMetadata,
} from "./provider-types.js";

import { resolveProviderModes } from "./negotiation-mode.js";
import type { ProviderMode }    from "./negotiation-mode.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const DEFAULT_INVENTORY_URL = "http://localhost:7072/consult";
const DEFAULT_TIMEOUT_MS    = 5000;

function demoDataDir(subdir: string): string {
  return path.resolve(__dirname, "..", "..", "DEMO-DATA", subdir);
}

function resolveInventoryUrl(): string {
  const raw = (process.env.INVENTORY_URL ?? "").trim();
  return raw.length > 0 ? raw : DEFAULT_INVENTORY_URL;
}

// ─── Implementation ───────────────────────────────────────────────────────

class InventoryProviderImpl implements InventoryProvider {
  readonly subAgent = "inventory" as const;
  readonly mode: ProviderMode;
  private readonly url: string;

  constructor() {
    this.mode = resolveProviderModes().inventory;
    this.url  = resolveInventoryUrl();
  }

  async consult(
    input: InventoryConsultationInput,
  ): Promise<ConsultationRecord<InventoryConsultation>> {
    const performedAt = new Date().toISOString();
    const start       = Date.now();

    if (this.mode === "real") {
      return this.consultViaHttp(input, performedAt, start);
    }

    return this.consultFromFixture(input, performedAt, start);
  }

  // ── Demo-mode fixture reader (M2-α.2 — unchanged) ─────────────────────

  private consultFromFixture(
    input: InventoryConsultationInput,
    performedAt: string,
    start: number,
  ): ConsultationRecord<InventoryConsultation> {
    const fixtureFile = "erpnext-bin-FAB-COTTON-180GSM.json";
    const fixturePath = path.join(demoDataDir("inventory"), fixtureFile);
    const relativeRef = `DEMO-DATA/inventory/${fixtureFile}`;

    let parsed: { __source?: Partial<ConsultationMetadata>; result?: InventoryConsultation };
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

    const metadata: ConsultationMetadata = {
      subAgent:       "inventory",
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

  // ── Real-mode HTTP adapter (M2-γ) — calls inventory-agent on port 7072 ─

  private async consultViaHttp(
    input: InventoryConsultationInput,
    performedAt: string,
    start: number,
  ): Promise<ConsultationRecord<InventoryConsultation>> {
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
        ? `inventory HTTP request timed out after ${DEFAULT_TIMEOUT_MS}ms at ${this.url}`
        : `inventory HTTP request failed at ${this.url}: ${err?.message ?? err}`;
      return this.failRecord(performedAt, Date.now() - start, detail, `${this.url} (real-mode unreachable)`);
    }
    clearTimeout(timeout);

    if (!response.ok) {
      try {
        const body = (await response.json()) as ConsultationRecord<InventoryConsultation>;
        if (body && body.metadata && typeof body.success === "boolean") {
          return body;
        }
      } catch { /* fall through */ }
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `inventory agent responded HTTP ${response.status} at ${this.url}`,
        this.url,
      );
    }

    let body: ConsultationRecord<InventoryConsultation>;
    try {
      body = (await response.json()) as ConsultationRecord<InventoryConsultation>;
    } catch (err: any) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `inventory agent response was not valid JSON: ${err?.message ?? err}`,
        this.url,
      );
    }

    if (!body || !body.metadata || typeof body.success !== "boolean") {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `inventory agent returned malformed ConsultationRecord at ${this.url}`,
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
  ): ConsultationRecord<InventoryConsultation> {
    return {
      metadata: {
        subAgent:   "inventory",
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

let _singleton: InventoryProviderImpl | null = null;

export function getInventoryProvider(): InventoryProvider {
  if (_singleton === null) _singleton = new InventoryProviderImpl();
  return _singleton;
}

export function resetInventoryProviderForTest(): void {
  _singleton = null;
}
