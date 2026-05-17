// ============================================================================
// scripts/replay-fixtures.ts  —  Iteration 5: Fixture replay + baseline summary
// ============================================================================
//
// Scans `src/escalations/` for every historical NEG-* artifact, computes the
// outcome-quality metrics (from `src/shared/outcome-quality.ts`) where the
// data is sufficient, and writes a baseline report.
//
// HONESTY GUARANTEE (the new requirement, May 17 2026):
//   This script is RE-RUNNABLE. If old text or JSON files are deleted from
//   src/escalations/, the next `npm run replay:fixtures` produces a baseline
//   that reflects only what survives. Counts shrink. No stale numbers.
//   Inputs that are corrupt or unparseable are counted in their own bucket.
//
// FILE PATTERNS HANDLED:
//   Pattern A (best — iter 4+): NEG-{id}_{success|escalation}_{BUYER|SELLER}.audit.json
//                               Has full outcomeQuality block already. Use as-is.
//   Pattern B (current — iter 0..3): NEG-{id}_{success|escalation}_{BUYER|SELLER}.txt
//                                    Text reports. Parse closedPrice, qty, floors.
//   Pattern C (legacy — pre-buyer/seller split): NEG-{id}_{success|escalation}.txt
//                                                Same parser as B, no perspective.
//
// PRIORITY ORDER PER NEG-ID:
//   1. SELLER audit.json   (richest — has BOTH buyerMax AND sellerMin)
//   2. BUYER  audit.json   (has buyerMax; sellerMin disclosed in audit if iter-4+)
//   3. SELLER .txt         (has agreedPrice, qty, cost floor)
//   4. BUYER  .txt         (has agreedPrice, qty, sometimes max budget)
//   5. legacy .txt         (agreedPrice + qty only — usually)
//
// OUTPUT (overwritten every run):
//   baselines/baseline-latest.json    machine-readable, served by /api/baseline
//   baselines/baseline-N{count}.md    human-readable Markdown for solution brief
//                                     ({count} = number of unique neg-ids found,
//                                     regardless of data quality)
//
// USAGE:
//   npm run replay:fixtures
//
// ============================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  computeOutcomeQuality,
  type OutcomeQuality,
  type Currency,
} from "../src/shared/outcome-quality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ESCALATIONS_DIR = path.resolve(__dirname, "..", "src", "escalations");
const BASELINES_DIR   = path.resolve(__dirname, "..", "baselines");

// ---- Types -----------------------------------------------------------------

type DataTier =
  | "audit_json_full"      // audit.json present with outcomeQuality already computed
  | "audit_json_partial"   // audit.json present but outcomeQuality missing or partial
  | "text_parseable"       // .txt has price + floor/max parseable
  | "text_price_only"      // .txt has price only
  | "legacy_minimal"       // legacy single-file .txt, partial parse
  | "insufficient"         // could not extract closedPrice
  | "unparseable";         // file unreadable / JSON broken

interface NegRecord {
  negotiationId: string;
  outcome:       "success" | "escalation" | "unknown";
  tier:          DataTier;
  source:        string;             // filename used
  closedPrice?:  number;
  buyerMax?:     number;
  sellerMin?:    number;
  quantity?:     number;
  counterparty?: string;
  closedAt?:     string;
  currency:      Currency;
  quality?:      OutcomeQuality;
  notes?:        string[];
}

interface Baseline {
  generatedAt:   string;
  escalationsDir: string;
  totals: {
    uniqueNegotiations: number;
    byTier:             Record<DataTier, number>;
    byOutcome:          { success: number; escalation: number; unknown: number };
    deletedSincePriorRun?: string[];  // negIds that previously had data but no longer do (best-effort)
  };
  metrics: {
    /** how many neg-ids contributed to each metric (sample size varies) */
    sampleCounts: {
      closedPrice:       number;
      outcomeQuality:    number;   // requires both buyerMax + sellerMin
      surplusSplit:      number;
    };
    medianClosedPrice?:           number;
    pctClosedAtOrBelowNBS?:       number;   // fraction in [0,1]
    medianDeviationFromNBS?:      number;
    medianBuyerShare?:            number;
    medianSellerShare?:           number;
    pctAgreementTrap?:            number;
    pctOutsideZOPA?:              number;
    pctBothPartiesIR?:            number;
  };
  records: NegRecord[];
}

// ---- Helpers ---------------------------------------------------------------

const NEG_ID_RE     = /^NEG-\d+/;
const OUTCOME_RE    = /_(success|escalation)/;
const PERSPECTIVE_RE= /_(BUYER|SELLER)\.(audit\.json|txt)$/;

function inferOutcomeFromFilename(filename: string): "success" | "escalation" | "unknown" {
  const m = filename.match(OUTCOME_RE);
  return m ? (m[1] as "success" | "escalation") : "unknown";
}

function inferNegIdFromFilename(filename: string): string | null {
  const m = filename.match(NEG_ID_RE);
  return m ? m[0] : null;
}

function safeReadJSON<T = any>(filepath: string): T | { __error: string } {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8")) as T;
  } catch (e: any) {
    return { __error: e?.message ?? "unknown JSON error" };
  }
}

function safeReadText(filepath: string): string | null {
  try {
    return fs.readFileSync(filepath, "utf8");
  } catch {
    return null;
  }
}

/** Parse closed price, quantity, cost-floor, max-budget out of a text report. */
function parseTextReport(text: string): {
  closedPrice?: number;
  quantity?:    number;
  sellerMin?:   number;
  buyerMax?:    number;
  counterparty?: string;
  closedAt?:    string;
} {
  const out: ReturnType<typeof parseTextReport> = {};

  // "Agreed Price     : Rs.397 / unit"  or  "Agreed Price: ₹397/unit"
  const priceMatch = text.match(/Agreed\s+Price\s*:\s*(?:Rs\.?|₹|\$)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (priceMatch) out.closedPrice = parseFloat(priceMatch[1]);

  // "Quantity         : 2,000 units"
  const qtyMatch = text.match(/Quantity\s*:\s*([0-9][0-9,]*)\s*(?:units|fabric)/i);
  if (qtyMatch) out.quantity = parseInt(qtyMatch[1].replace(/,/g, ""), 10);

  // "above cost floor Rs.350"  (seller perspective)
  const floorMatch = text.match(/(?:above\s+)?cost\s+floor\s+(?:Rs\.?|₹|\$)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (floorMatch) out.sellerMin = parseFloat(floorMatch[1]);

  // "below max budget Rs.400"   (buyer perspective) — looser pattern; some old reports don't include this
  const budgetMatch = text.match(/max(?:imum)?\s+budget\s+(?:Rs\.?|₹|\$)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (budgetMatch) out.buyerMax = parseFloat(budgetMatch[1]);

  // Counterparty — best-effort from report header
  const cpartyMatch = text.match(/(?:Buyer|Seller|Counterparty)\s+(?:LE|Company|Entity)\s*:\s*([A-Z][A-Z0-9\s.&,'\-]+?)(?:\s{2,}|\n)/);
  if (cpartyMatch) out.counterparty = cpartyMatch[1].trim();

  // "Date / Time      : 05 Apr 2026 2:52:42 am"
  const dateMatch = text.match(/Date\s*\/\s*Time\s*:\s*(.+)$/m);
  if (dateMatch) out.closedAt = dateMatch[1].trim();

  return out;
}

// ---- Scanner ---------------------------------------------------------------

interface FileGroup {
  buyerAuditJson?:   string;
  sellerAuditJson?:  string;
  buyerTxt?:         string;
  sellerTxt?:        string;
  legacyTxt?:        string;
  outcome:           "success" | "escalation" | "unknown";
}

function groupFilesByNegId(): Map<string, FileGroup> {
  const groups = new Map<string, FileGroup>();

  if (!fs.existsSync(ESCALATIONS_DIR)) {
    return groups;
  }

  const files = fs.readdirSync(ESCALATIONS_DIR).filter(f => f.startsWith("NEG-"));
  for (const f of files) {
    const negId = inferNegIdFromFilename(f);
    if (!negId) continue;
    const outcome = inferOutcomeFromFilename(f);
    const g = groups.get(negId) ?? { outcome };
    if (g.outcome === "unknown" && outcome !== "unknown") g.outcome = outcome;

    const fullPath = path.join(ESCALATIONS_DIR, f);

    if (f.endsWith("_BUYER.audit.json"))       g.buyerAuditJson  = fullPath;
    else if (f.endsWith("_SELLER.audit.json")) g.sellerAuditJson = fullPath;
    else if (f.endsWith("_BUYER.txt"))         g.buyerTxt        = fullPath;
    else if (f.endsWith("_SELLER.txt"))        g.sellerTxt       = fullPath;
    else if (f.endsWith(".txt") && !PERSPECTIVE_RE.test(f)) g.legacyTxt = fullPath;

    groups.set(negId, g);
  }
  return groups;
}

// ---- Per-neg analysis ------------------------------------------------------

function analyseGroup(negId: string, g: FileGroup): NegRecord {
  const notes: string[] = [];

  // Tier 1: SELLER audit.json (has both bounds)
  if (g.sellerAuditJson) {
    const json = safeReadJSON<any>(g.sellerAuditJson);
    if ("__error" in json) {
      notes.push(`SELLER audit.json unparseable: ${json.__error}`);
    } else {
      const oq = json.outcomeQuality;
      if (oq && typeof oq.closedPrice === "number" && typeof oq.buyerMax === "number" && typeof oq.sellerMin === "number") {
        return {
          negotiationId: negId,
          outcome:       g.outcome,
          tier:          "audit_json_full",
          source:        path.basename(g.sellerAuditJson),
          closedPrice:   oq.closedPrice,
          buyerMax:      oq.buyerMax,
          sellerMin:     oq.sellerMin,
          quantity:      json.negotiation?.quantity,
          counterparty:  json.parties?.counterparty?.legalEntityName,
          closedAt:      json.generatedAt,
          currency:      (oq.currency ?? "INR") as Currency,
          quality:       oq,
          notes,
        };
      }
      notes.push("SELLER audit.json missing outcomeQuality block");
    }
  }

  // Tier 2: BUYER audit.json
  if (g.buyerAuditJson) {
    const json = safeReadJSON<any>(g.buyerAuditJson);
    if ("__error" in json) {
      notes.push(`BUYER audit.json unparseable: ${json.__error}`);
    } else {
      const oq = json.outcomeQuality;
      if (oq && typeof oq.closedPrice === "number" && typeof oq.buyerMax === "number" && typeof oq.sellerMin === "number") {
        return {
          negotiationId: negId,
          outcome:       g.outcome,
          tier:          "audit_json_full",
          source:        path.basename(g.buyerAuditJson),
          closedPrice:   oq.closedPrice,
          buyerMax:      oq.buyerMax,
          sellerMin:     oq.sellerMin,
          quantity:      json.negotiation?.quantity,
          counterparty:  json.parties?.counterparty?.legalEntityName,
          closedAt:      json.generatedAt,
          currency:      (oq.currency ?? "INR") as Currency,
          quality:       oq,
          notes,
        };
      }
      // Partial — at least we have buyerMax via constraint disclosure
      const buyerMax = json.constraintDisclosure?.selfReservationPrice?.value;
      const finalPrice = json.negotiation?.finalPrice;
      if (typeof finalPrice === "number" && typeof buyerMax === "number") {
        return {
          negotiationId: negId,
          outcome:       g.outcome,
          tier:          "audit_json_partial",
          source:        path.basename(g.buyerAuditJson),
          closedPrice:   finalPrice,
          buyerMax,
          quantity:      json.negotiation?.quantity,
          counterparty:  json.parties?.counterparty?.legalEntityName,
          closedAt:      json.generatedAt,
          currency:      "INR",
          notes:         [...notes, "no sellerMin available — outcomeQuality not computed"],
        };
      }
      notes.push("BUYER audit.json missing outcomeQuality and disclosure");
    }
  }

  // Tier 3: SELLER .txt (has cost floor)
  if (g.sellerTxt) {
    const text = safeReadText(g.sellerTxt);
    if (text) {
      const p = parseTextReport(text);
      if (p.closedPrice !== undefined && p.sellerMin !== undefined) {
        return {
          negotiationId: negId,
          outcome:       g.outcome,
          tier:          "text_parseable",
          source:        path.basename(g.sellerTxt),
          closedPrice:   p.closedPrice,
          sellerMin:     p.sellerMin,
          buyerMax:      p.buyerMax,
          quantity:      p.quantity,
          counterparty:  p.counterparty,
          closedAt:      p.closedAt,
          currency:      "INR",
          notes:         [...notes, "parsed from text; no buyerMax — outcomeQuality not computed"],
        };
      }
      if (p.closedPrice !== undefined) {
        return {
          negotiationId: negId,
          outcome:       g.outcome,
          tier:          "text_price_only",
          source:        path.basename(g.sellerTxt),
          closedPrice:   p.closedPrice,
          quantity:      p.quantity,
          counterparty:  p.counterparty,
          closedAt:      p.closedAt,
          currency:      "INR",
          notes:         [...notes, "text has price only; floor not parseable"],
        };
      }
    } else {
      notes.push("SELLER .txt unreadable");
    }
  }

  // Tier 4: BUYER .txt
  if (g.buyerTxt) {
    const text = safeReadText(g.buyerTxt);
    if (text) {
      const p = parseTextReport(text);
      if (p.closedPrice !== undefined) {
        return {
          negotiationId: negId,
          outcome:       g.outcome,
          tier:          "text_price_only",
          source:        path.basename(g.buyerTxt),
          closedPrice:   p.closedPrice,
          buyerMax:      p.buyerMax,
          quantity:      p.quantity,
          counterparty:  p.counterparty,
          closedAt:      p.closedAt,
          currency:      "INR",
          notes:         [...notes, "buyer text — no sellerMin available"],
        };
      }
    } else {
      notes.push("BUYER .txt unreadable");
    }
  }

  // Tier 5: legacy .txt
  if (g.legacyTxt) {
    const text = safeReadText(g.legacyTxt);
    if (text) {
      const p = parseTextReport(text);
      if (p.closedPrice !== undefined) {
        return {
          negotiationId: negId,
          outcome:       g.outcome,
          tier:          "legacy_minimal",
          source:        path.basename(g.legacyTxt),
          closedPrice:   p.closedPrice,
          quantity:      p.quantity,
          currency:      "INR",
          notes:         [...notes, "legacy single-file .txt — limited fields"],
        };
      }
    } else {
      notes.push("legacy .txt unreadable");
    }
  }

  // Nothing usable
  return {
    negotiationId: negId,
    outcome:       g.outcome,
    tier:          notes.some(n => /unparseable|unreadable/.test(n)) ? "unparseable" : "insufficient",
    source:        "(none)",
    currency:      "INR",
    notes:         notes.length ? notes : ["no parseable file for this negotiation"],
  };
}

// ---- Aggregation -----------------------------------------------------------

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function buildBaseline(records: NegRecord[]): Baseline {
  // Ensure outcomeQuality is computed wherever we have enough data but no precomputed block
  for (const r of records) {
    if (!r.quality && r.closedPrice !== undefined && r.buyerMax !== undefined && r.sellerMin !== undefined) {
      r.quality = computeOutcomeQuality({
        closed:      r.outcome === "success",
        closedPrice: r.closedPrice,
        buyerMax:    r.buyerMax,
        sellerMin:   r.sellerMin,
        currency:    r.currency,
        quantity:    r.quantity,
      });
    }
  }

  const byTier: Record<DataTier, number> = {
    audit_json_full:    0,
    audit_json_partial: 0,
    text_parseable:     0,
    text_price_only:    0,
    legacy_minimal:     0,
    insufficient:       0,
    unparseable:        0,
  };
  const byOutcome = { success: 0, escalation: 0, unknown: 0 };
  for (const r of records) {
    byTier[r.tier]++;
    byOutcome[r.outcome]++;
  }

  const priced     = records.filter(r => typeof r.closedPrice === "number").map(r => r.closedPrice!);
  const withQuality = records.filter(r => r.quality);
  const closedQuality = withQuality.filter(r => r.quality!.closed);

  const deviations = withQuality.map(r => r.quality!.NBS.deviationFromNBS);
  const buyerShares  = closedQuality.map(r => r.quality!.surplusSplit.buyerShare);
  const sellerShares = closedQuality.map(r => r.quality!.surplusSplit.sellerShare);

  const pctClosedAtOrBelowNBS = withQuality.length
    ? withQuality.filter(r => r.quality!.NBS.deviationFromNBS <= 0).length / withQuality.length
    : undefined;
  const pctAgreementTrap = closedQuality.length
    ? closedQuality.filter(r => r.quality!.flags.agreementTrap).length / closedQuality.length
    : undefined;
  const pctOutsideZOPA = closedQuality.length
    ? closedQuality.filter(r => r.quality!.flags.outsideZOPA).length / closedQuality.length
    : undefined;
  const pctBothPartiesIR = closedQuality.length
    ? closedQuality.filter(r => r.quality!.IR.bothIR).length / closedQuality.length
    : undefined;

  return {
    generatedAt:    new Date().toISOString(),
    escalationsDir: ESCALATIONS_DIR,
    totals: {
      uniqueNegotiations: records.length,
      byTier,
      byOutcome,
    },
    metrics: {
      sampleCounts: {
        closedPrice:    priced.length,
        outcomeQuality: withQuality.length,
        surplusSplit:   closedQuality.length,
      },
      medianClosedPrice:        median(priced),
      pctClosedAtOrBelowNBS,
      medianDeviationFromNBS:   median(deviations),
      medianBuyerShare:         median(buyerShares),
      medianSellerShare:        median(sellerShares),
      pctAgreementTrap,
      pctOutsideZOPA,
      pctBothPartiesIR,
    },
    records: records.sort((a, b) => a.negotiationId.localeCompare(b.negotiationId)),
  };
}

// ---- Markdown rendering ----------------------------------------------------

function pct(x: number | undefined): string {
  if (x === undefined) return "n/a";
  return `${(x * 100).toFixed(1)}%`;
}
function rs(x: number | undefined): string {
  if (x === undefined) return "n/a";
  return `₹${x.toFixed(0)}`;
}

function renderMarkdown(b: Baseline): string {
  const t = b.totals;
  const m = b.metrics;
  const lines: string[] = [];

  lines.push(`# LegentPro — Outcome-Quality Baseline (N=${t.uniqueNegotiations})`);
  lines.push("");
  lines.push(`Generated: \`${b.generatedAt}\``);
  lines.push(`Source: \`${b.escalationsDir}\``);
  lines.push("");
  lines.push(`> **Re-runnable.** If escalation files are deleted, the next \`npm run replay:fixtures\` produces a smaller, still-honest baseline. Numbers here always reflect what is on disk right now.`);
  lines.push("");

  lines.push("## 1. Sample composition");
  lines.push("");
  lines.push(`Total unique negotiations on disk: **${t.uniqueNegotiations}**`);
  lines.push("");
  lines.push("| Data tier | Count | What it means |");
  lines.push("|---|---:|---|");
  lines.push(`| \`audit_json_full\`    | ${t.byTier.audit_json_full}    | iter 4+ audit.json with computed outcomeQuality |`);
  lines.push(`| \`audit_json_partial\` | ${t.byTier.audit_json_partial} | audit.json present but missing one bound |`);
  lines.push(`| \`text_parseable\`     | ${t.byTier.text_parseable}     | .txt with price + cost floor parseable |`);
  lines.push(`| \`text_price_only\`    | ${t.byTier.text_price_only}    | .txt with closed price only |`);
  lines.push(`| \`legacy_minimal\`     | ${t.byTier.legacy_minimal}     | legacy single-file .txt |`);
  lines.push(`| \`insufficient\`       | ${t.byTier.insufficient}       | nothing extractable |`);
  lines.push(`| \`unparseable\`        | ${t.byTier.unparseable}        | files exist but corrupt |`);
  lines.push("");
  lines.push("| Outcome | Count |");
  lines.push("|---|---:|");
  lines.push(`| Success (closed) | ${t.byOutcome.success} |`);
  lines.push(`| Escalation       | ${t.byOutcome.escalation} |`);
  lines.push(`| Unknown          | ${t.byOutcome.unknown} |`);
  lines.push("");

  lines.push("## 2. Headline metrics");
  lines.push("");
  lines.push(`Sample sizes vary by metric (older files lack some fields). The denominator is shown next to each line so the claim stays honest.`);
  lines.push("");
  lines.push("| Metric | Value | Sample (N) |");
  lines.push("|---|---:|---:|");
  lines.push(`| Median closed price                | ${rs(m.medianClosedPrice)}       | ${m.sampleCounts.closedPrice} |`);
  lines.push(`| % deals closed at-or-below NBS     | ${pct(m.pctClosedAtOrBelowNBS)}  | ${m.sampleCounts.outcomeQuality} |`);
  lines.push(`| Median deviation from NBS          | ${rs(m.medianDeviationFromNBS)}  | ${m.sampleCounts.outcomeQuality} |`);
  lines.push(`| Median buyer surplus share         | ${pct(m.medianBuyerShare)}       | ${m.sampleCounts.surplusSplit} |`);
  lines.push(`| Median seller surplus share        | ${pct(m.medianSellerShare)}      | ${m.sampleCounts.surplusSplit} |`);
  lines.push(`| % flagged "agreement trap"         | ${pct(m.pctAgreementTrap)}       | ${m.sampleCounts.surplusSplit} |`);
  lines.push(`| % closed outside ZOPA              | ${pct(m.pctOutsideZOPA)}         | ${m.sampleCounts.surplusSplit} |`);
  lines.push(`| % both parties individually rational | ${pct(m.pctBothPartiesIR)}      | ${m.sampleCounts.surplusSplit} |`);
  lines.push("");

  lines.push("## 3. Headline claim for the solution brief");
  lines.push("");
  if (m.sampleCounts.outcomeQuality > 0 && m.pctClosedAtOrBelowNBS !== undefined) {
    lines.push(`> *Across **${m.sampleCounts.outcomeQuality}** negotiations on record, LegentPro closed deals at or below the Nash-Bargaining-Solution fair price **${pct(m.pctClosedAtOrBelowNBS)} of the time**, with a median surplus split of **${pct(m.medianBuyerShare)}/${pct(m.medianSellerShare)}** (buyer/seller). ${m.pctAgreementTrap !== undefined ? `Agreement-trap rate: ${pct(m.pctAgreementTrap)}.` : ""}*`);
  } else {
    lines.push(`> _No outcome-quality-ready records on disk yet. Run more negotiations to generate \`*.audit.json\` files, then re-run this script._`);
  }
  lines.push("");

  lines.push("## 4. Per-negotiation roster");
  lines.push("");
  lines.push("| NegID | Outcome | Tier | Closed ₹ | Buyer max | Seller min | Surplus split (B/S) | Notes |");
  lines.push("|---|---|---|---:|---:|---:|---|---|");
  for (const r of b.records) {
    const split = r.quality
      ? `${(r.quality.surplusSplit.buyerShare * 100).toFixed(0)}/${(r.quality.surplusSplit.sellerShare * 100).toFixed(0)}`
      : "—";
    const note = (r.notes ?? []).join("; ").slice(0, 80);
    lines.push(
      `| ${r.negotiationId} | ${r.outcome} | ${r.tier} | ${rs(r.closedPrice)} | ${rs(r.buyerMax)} | ${rs(r.sellerMin)} | ${split} | ${note} |`
    );
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("_Generated by `npm run replay:fixtures` (iteration 5). Edit `scripts/replay-fixtures.ts` to change parsing rules._");
  return lines.join("\n");
}

// ---- Main ------------------------------------------------------------------

function main() {
  console.log(`[replay] Scanning ${ESCALATIONS_DIR} ...`);

  if (!fs.existsSync(ESCALATIONS_DIR)) {
    console.error(`[replay] escalations directory not found: ${ESCALATIONS_DIR}`);
    console.error(`[replay] Nothing to replay. Exit 0 with empty baseline.`);
  }

  const groups = groupFilesByNegId();
  console.log(`[replay] Found ${groups.size} unique negotiation id(s).`);

  const records: NegRecord[] = [];
  for (const [negId, g] of groups) {
    records.push(analyseGroup(negId, g));
  }

  const baseline = buildBaseline(records);

  if (!fs.existsSync(BASELINES_DIR)) {
    fs.mkdirSync(BASELINES_DIR, { recursive: true });
  }

  // Delete any prior baseline-N*.md so we don't accumulate stale snapshots.
  // The latest run is the source of truth.
  for (const f of fs.readdirSync(BASELINES_DIR)) {
    if (/^baseline-N\d+\.md$/.test(f) || f === "baseline-latest.json") {
      try { fs.unlinkSync(path.join(BASELINES_DIR, f)); } catch { /* ignore */ }
    }
  }

  const jsonPath = path.join(BASELINES_DIR, "baseline-latest.json");
  const mdPath   = path.join(BASELINES_DIR, `baseline-N${baseline.totals.uniqueNegotiations}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(baseline, null, 2));
  fs.writeFileSync(mdPath,   renderMarkdown(baseline));

  console.log(`[replay] Wrote ${jsonPath}`);
  console.log(`[replay] Wrote ${mdPath}`);
  console.log("");
  console.log(`[replay] N = ${baseline.totals.uniqueNegotiations}`);
  console.log(`[replay] outcomeQuality-ready: ${baseline.metrics.sampleCounts.outcomeQuality}`);
  if (baseline.metrics.medianClosedPrice !== undefined) {
    console.log(`[replay] median closed price: ${rs(baseline.metrics.medianClosedPrice)}`);
  }
  if (baseline.metrics.pctClosedAtOrBelowNBS !== undefined) {
    console.log(`[replay] % at-or-below NBS:   ${pct(baseline.metrics.pctClosedAtOrBelowNBS)}`);
  }
}

main();
