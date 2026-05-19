// =============================================================================
// PROJ1-DYN3-CONT8 / M2-ε — Scenario loader
// =============================================================================
//
// Loads scenario JSON files from src/shared/scenarios/. Used by:
//   - cli-parser.ts (when --scenario <id> is passed)
//   - test-cli-parser.ts (regression tests for form 3)
//
// The UI does NOT use this loader directly — it uses Vite's import.meta.glob
// to bundle scenarios at build time (see ui/src/lib/scenarios.ts).
//
// Design notes:
// 1. Manifest-driven, not directory-scan, so the load order is explicit and
//    additions are visible in diffs.
// 2. Synchronous reads (small files, run-once at parse time) — keeps the
//    cli-parser API synchronous and simple.
// 3. Validates the loaded JSON against the Scenario type. Throws on malformed
//    scenarios with a clear error so the user knows which file is broken.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import type { Scenario } from "./intent-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const SCENARIOS_DIR = path.join(__dirname, "scenarios");
const MANIFEST_PATH = path.join(SCENARIOS_DIR, "scenarios-index.json");

interface ManifestEntry {
  id:   string;
  file: string;
}

interface Manifest {
  version:   number;
  comment?:  string;
  scenarios: ManifestEntry[];
}

let cachedManifest: Manifest | null = null;

function loadManifest(): Manifest {
  if (cachedManifest) return cachedManifest;
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Scenario manifest not found at ${MANIFEST_PATH}`);
  }
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  const parsed: Manifest = JSON.parse(raw);
  if (!parsed.scenarios || !Array.isArray(parsed.scenarios)) {
    throw new Error(`Scenario manifest at ${MANIFEST_PATH} missing 'scenarios' array`);
  }
  cachedManifest = parsed;
  return parsed;
}

/** Returns the list of known scenario ids in manifest order.
 *  Used by cli-parser's --scenario validation. */
export function listScenarioIds(): string[] {
  return loadManifest().scenarios.map(s => s.id);
}

/** Loads one scenario by id. Throws with a clear message if id is unknown
 *  or the scenario file is missing / malformed. */
export function loadScenario(id: string): Scenario {
  const manifest = loadManifest();
  const entry = manifest.scenarios.find(s => s.id === id);
  if (!entry) {
    throw new Error(
      `Unknown scenario id "${id}". Known ids: ${manifest.scenarios.map(s => s.id).join(", ")}`,
    );
  }
  const filePath = path.join(SCENARIOS_DIR, entry.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Scenario file not found: ${filePath}`);
  }
  let scenario: Scenario;
  try {
    scenario = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e: any) {
    throw new Error(`Scenario file ${entry.file} is not valid JSON: ${e?.message ?? e}`);
  }
  // Minimal shape validation — catches obvious malformed files at load time.
  if (!scenario.id || scenario.id !== id) {
    throw new Error(`Scenario file ${entry.file} has missing or mismatched id (manifest says "${id}", file says "${scenario.id ?? "(missing)"}")`);
  }
  if (!scenario.buyerIntent || !scenario.sellerIntent || !scenario.situation) {
    throw new Error(`Scenario "${id}" missing required block(s): buyerIntent / sellerIntent / situation`);
  }
  if (!scenario.situation.product || !scenario.situation.quantity) {
    throw new Error(`Scenario "${id}".situation must have product and quantity`);
  }
  if (!scenario.buyerIntent.hardConstraints?.maxBudgetPerUnit) {
    throw new Error(`Scenario "${id}".buyerIntent.hardConstraints.maxBudgetPerUnit is required for CLI flow (today's parser maps it to --buyer-budget)`);
  }
  return scenario;
}

/** Loads all scenarios in manifest order. Used by UI fallback path and by
 *  tests. */
export function loadAllScenarios(): Scenario[] {
  return loadManifest().scenarios.map(s => loadScenario(s.id));
}
