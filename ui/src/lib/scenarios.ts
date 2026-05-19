// =============================================================================
// PROJ1-DYN3-CONT8 / M2-ε — UI scenario loader
// =============================================================================
//
// Loads scenario JSON files at build time using Vite's import.meta.glob. This
// mirrors the agent-side src/shared/scenarios/ directory by relative path.
//
// Why glob-import vs runtime fetch:
// - The backend's /api/scenarios endpoint doesn't exist (and shouldn't — see
//   the /api/self/* convention; scenarios are content, not agent state).
// - Build-time bundling produces a static asset, faster than runtime fetch.
// - Vite's eager import means the scenario list is available synchronously
//   when the picker mounts, no loading-spinner state needed.
//
// CONT8 follow-up note: the shared types in
// A2A/js/src/shared/intent-types.ts are NOT importable from the UI because
// Vite/UI doesn't reach into A2A/js. The UI mirrors the type shape locally.
// If the agent-side intent-types.ts changes, mirror the change here too.

export type SellerResponseMode =
  | "BASIC_SALES_QUOTING_1"
  | "L1_DELEGATED_ADVISORS"
  | "L2_EXECUTIVE_REASONER"
  | "L3_STYLE_AND_AUTONOMY"
  | "L4_LEARNED_PROFILES_AND_PD";

export interface BuyerIntent {
  goal: "secure-supply" | "minimize-cost" | "test-market" | "build-relationship";
  hardConstraints: {
    maxBudgetPerUnit?: number;
    minQuantity?: number;
    requiredDeliveryDate?: string;
  };
  softPreferences: {
    targetPricePerUnit?: number;
    preferredPaymentTerms?: string;
    relationshipWeight?: number;
  };
  style: string;
  walkAwayBehavior: "escalate" | "accept-best-available" | "abandon";
}

export interface SellerIntent {
  goal: "fill-capacity" | "maximize-margin" | "build-relationship" | "clear-inventory";
  hardConstraints: {
    sellerResponseMode?: SellerResponseMode;
    minMarginPct?: number;
    floorPricePerUnit?: number;
  };
  softPreferences: {
    targetMarginPct?: number;
    preferredPaymentTerms?: string;
  };
  style: string;
  walkAwayBehavior: "escalate" | "accept-loss-leader" | "abandon";
}

export interface Situation {
  product:  string;
  quantity: number;
  market?:  "normal" | "tight" | "loose" | "shortage" | "outage";
}

export interface ExpectedOutcome {
  likely:       string;
  possible?:    string;
  failureMode?: string;
}

export interface Scenario {
  id:           string;
  title:        string;
  description:  string;
  buyerIntent:  BuyerIntent;
  sellerIntent: SellerIntent;
  situation:    Situation;
  expectedOutcome: ExpectedOutcome;
  honored: {
    today:               string[];
    declaredButDeferred: string[];
  };
}

// -----------------------------------------------------------------------------
// Vite glob-import. Resolves at build time. The path is relative to THIS file:
// ui/src/lib/scenarios.ts  ->  ../../../A2A/js/src/shared/scenarios/*.json
//
// import.meta.glob with `eager: true` and `import: 'default'` gives us the
// parsed JSON value directly. Keys are the matched file paths.
// -----------------------------------------------------------------------------
// @ts-ignore — vite-specific glob import; types provided by vite/client.d.ts
const modules = import.meta.glob('../../../A2A/js/src/shared/scenarios/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

interface ManifestEntry { id: string; file: string; }
interface Manifest      { version: number; scenarios: ManifestEntry[]; }

let _scenarios: Scenario[] | null = null;

function loadAll(): Scenario[] {
  if (_scenarios) return _scenarios;

  // Find the manifest first to honor declared order.
  const manifestEntry = Object.entries(modules).find(([k]) => k.endsWith('/scenarios-index.json'));
  if (!manifestEntry) {
    console.warn('[scenarios] manifest scenarios-index.json not found in glob import — falling back to filesystem order');
    _scenarios = Object.entries(modules)
      .filter(([k]) => !k.endsWith('/scenarios-index.json'))
      .map(([_, v]) => v as Scenario);
    return _scenarios;
  }
  const manifest = manifestEntry[1] as Manifest;

  const byFilename: Record<string, Scenario> = {};
  for (const [key, val] of Object.entries(modules)) {
    const filename = key.split('/').pop()!;
    if (filename === 'scenarios-index.json') continue;
    byFilename[filename] = val as Scenario;
  }

  _scenarios = manifest.scenarios
    .map(entry => byFilename[entry.file])
    .filter((s): s is Scenario => s !== undefined);

  return _scenarios;
}

export function listScenarios(): Scenario[] {
  return loadAll();
}

export function getScenario(id: string): Scenario | undefined {
  return loadAll().find(s => s.id === id);
}
