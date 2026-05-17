// ================= WEDGE1 / M2-α.2 — INVENTORY SUB-AGENT PROVIDER =================
//
// Implements InventoryProvider from src/shared/provider-types.ts.
//
// Mode resolution (frozen at construction; not switchable at runtime):
//   - INVENTORY_MODE=demo  (default) — reads DEMO-DATA/inventory/<fixture>.json
//   - INVENTORY_MODE=real             — STUB in M2-α.2; full ERPNext Bin call
//                                       lands in M2-β. Currently returns a
//                                       failed ConsultationRecord with
//                                       error="real-mode not yet implemented".
//
// Path discipline:
//   - Fixture path resolved at runtime via path.resolve(__dirname, ...).
//   - No hardcoded absolute paths anywhere. Works on any machine regardless
//     of where the repo is cloned (same convention as seller-agent's
//     resolveCardPath()).
//
// Single-fixture routing (M2-α.2):
//   - Currently returns DEMO-DATA/inventory/erpnext-bin-FAB-COTTON-180GSM.json
//     regardless of input.productCode. M2-β will route fixtures by SKU.

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

/**
 * Resolves the DEMO-DATA subdirectory at runtime from this file's actual
 * location. `__dirname` for a built file in src/shared/ resolves to that
 * directory; `../../` walks up to A2A/js/. This is the same pattern the
 * existing seller-agent uses for agent-cards.
 */
function demoDataDir(subdir: string): string {
  return path.resolve(__dirname, "..", "..", "DEMO-DATA", subdir);
}

// ─── Implementation ───────────────────────────────────────────────────────

class InventoryProviderImpl implements InventoryProvider {
  readonly subAgent = "inventory" as const;
  readonly mode: ProviderMode;

  constructor() {
    // Frozen at construction. Read from env via the same lazy resolver the
    // tier framework uses, so we never see pre-dotenv values.
    this.mode = resolveProviderModes().inventory;
  }

  async consult(
    input: InventoryConsultationInput,
  ): Promise<ConsultationRecord<InventoryConsultation>> {
    const performedAt = new Date().toISOString();
    const start       = Date.now();

    if (this.mode === "real") {
      // M2-α.2 stub: real-mode ERPNext Bin call lands in M2-β.
      return this.failRecord(
        performedAt,
        Date.now() - start,
        "real-mode not yet implemented — set INVENTORY_MODE=demo for now (lands in M2-β)",
        "(unavailable — real-mode stubbed)",
      );
    }

    return this.consultFromFixture(input, performedAt, start);
  }

  // ── Demo-mode fixture reader ───────────────────────────────────────────

  private consultFromFixture(
    input: InventoryConsultationInput,
    performedAt: string,
    start: number,
  ): ConsultationRecord<InventoryConsultation> {
    // M2-α.2: single hardcoded fixture per sub-agent. M2-β will route by SKU.
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

    // Shape sanity — the fixture must have a __source block and a result block.
    if (!parsed || typeof parsed !== "object" || !parsed.result || !parsed.__source) {
      return this.failRecord(
        performedAt,
        Date.now() - start,
        `fixture missing __source or result block: ${relativeRef}`,
        relativeRef,
      );
    }

    // Merge the fixture's __source provenance with live runtime values
    // (performedAt + latencyMs). The fixture's static performedAt is a
    // demo-time stamp; the audit needs the actual consultation time.
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

/**
 * Returns the process-wide Inventory provider instance. Singleton so the
 * mode (real|demo) is resolved once at first call and stays consistent for
 * the lifetime of the process. Tests that want a fresh resolution can use
 * resetInventoryProviderForTest().
 */
export function getInventoryProvider(): InventoryProvider {
  if (_singleton === null) _singleton = new InventoryProviderImpl();
  return _singleton;
}

/** Test-only — drop the cached singleton so the next call re-reads env. */
export function resetInventoryProviderForTest(): void {
  _singleton = null;
}
