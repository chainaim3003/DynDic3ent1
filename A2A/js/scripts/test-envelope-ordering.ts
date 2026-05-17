// ================= WEDGE1 / GUARANTEE C — MESSAGE-ORDERING REGRESSION TEST =================
// Asserts that BUYER's and SELLER's audit JSONs for the same negotiation produce
// a consistent message-ordering view.
//
// Phase 1 (today): the test uses (timestamp, direction) as the proxy ordering key
// because `envelopeCounter` is not yet populated by the agents. It catches the
// pre-existing class of bugs where one side's logs[] omits or reorders events
// the other side recorded. When envelope-instrumentation lands in Phase 2,
// the test automatically switches to the canonical (direction, envelopeCounter)
// ordering and becomes strictly stronger.
//
// The test is non-destructive: it only reads existing audit JSONs from
// src/escalations/ — it does NOT run a fresh negotiation. Run after any
// negotiation completes to verify the audits agree.
//
// Usage:
//   npx tsx scripts/test-envelope-ordering.ts                  # latest pair
//   npx tsx scripts/test-envelope-ordering.ts NEG-1779035441619 # specific neg
//
// Exit codes:
//   0 = invariant holds (or no audits to test — informational)
//   1 = invariant violated
//   2 = audit pair not found / unreadable
//
// This script is exercised by the WEDGE1 demo dry-runs and (post-Phase-2)
// becomes a CI gate. See DESIGN/TEST-PLAN-WEDGE1.md for the test procedure.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ESCALATIONS_DIR = path.resolve(__dirname, "..", "src", "escalations");

// ── ANSI colors ─────────────────────────────────────────────────────────────
const C = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  cyan:    "\x1b[36m",
};

// ── Log entry shape we care about (subset of NegotiationLog) ────────────────
interface LogEntry {
  round:           number;
  messageType:     string;
  from:            "BUYER" | "SELLER";
  timestamp:       string;
  decision:        string;
  offeredPrice?:   number;
  reasoning?:      string;     // used to detect internal bilateral-accept echoes
  envelopeCounter?: number;    // populated after Phase 2
  envelopeHash?:    string;    // populated after Phase 2
}

interface AuditFile {
  negotiationId: string;
  perspective:   "BUYER" | "SELLER";
  outcome:       string;
  logs:          LogEntry[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findLatestNegotiation(): string | null {
  if (!fs.existsSync(ESCALATIONS_DIR)) return null;
  const files = fs.readdirSync(ESCALATIONS_DIR)
    .filter(f => f.endsWith(".audit.json"));
  if (files.length === 0) return null;

  // Group by negotiation ID
  const negotiationIds = new Set<string>();
  for (const f of files) {
    const match = f.match(/^(NEG-\d+)_/);
    if (match) negotiationIds.add(match[1]);
  }

  // Find the latest one that has BOTH _BUYER and _SELLER audit files
  const sorted = [...negotiationIds].sort().reverse();
  for (const id of sorted) {
    const buyerPath  = findAuditFile(id, "BUYER");
    const sellerPath = findAuditFile(id, "SELLER");
    if (buyerPath && sellerPath) return id;
  }
  return null;
}

function findAuditFile(negotiationId: string, role: "BUYER" | "SELLER"): string | null {
  const candidates = [
    `${negotiationId}_success_${role}.audit.json`,
    `${negotiationId}_escalation_${role}.audit.json`,
  ];
  for (const c of candidates) {
    const p = path.join(ESCALATIONS_DIR, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadAudit(filePath: string): AuditFile {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as AuditFile;
}

// ── The invariant assertion ─────────────────────────────────────────────────
//
// Given BUYER's logs[] and SELLER's logs[] for the same negotiation:
//
// Definition: an "externally-visible event" is a log entry corresponding to a
// message sent over the wire (OFFER, COUNTER_OFFER, ACCEPT_OFFER, REJECT_OFFER).
// Internal entries are agent-internal and excluded from cross-agent comparison:
//   - TREASURY_OVERRIDE (seller's pre-decision treasury check — never sent)
//   - SELLER's bilateral-accept echo, detected via reasoning containing
//     "bilateral" — the seller logs an internal ACCEPT entry when the buyer's
//     ACCEPT closes the deal, but no message is actually sent because the deal
//     is already closed. The logger.ts code uses the same heuristic
//     (decision === "ACCEPT" AND reasoning includes "bilateral") to suppress
//     this echo from terminal output.
//
// Invariant: when both audits' externally-visible events are projected to
// (from, messageType, offeredPrice) tuples and sorted by ordering-key, the
// resulting sequences MUST be element-wise equal.
//
// Ordering-key:
//   Phase 2 (preferred): (envelopeCounter, from) — canonical per envelope
//   Phase 1 (fallback):  (timestamp, from) — what we have today
//
// The test reports which key it used and whether envelope-instrumentation is
// in place yet.

const EXTERNAL_TYPES = new Set([
  "OFFER",
  "COUNTER_OFFER",
  "ACCEPT_OFFER",
  "ACCEPT",          // some audits use the short form
  "REJECT_OFFER",
  "REJECT",
]);

/**
 * Returns true if this log entry corresponds to an actual sealed message that
 * was sent over the wire — i.e. something that BOTH sides should see and record.
 *
 * Excludes:
 *   - Internal message types not in EXTERNAL_TYPES (e.g. TREASURY_OVERRIDE)
 *   - Bilateral-accept echo: the seller's internal log when the buyer's ACCEPT
 *     closes the deal. No outgoing message is sent (deal is already closed),
 *     so this entry exists only in the seller's audit, not the buyer's.
 *     Matches the suppression heuristic in src/shared/logger.ts:printLog().
 */
function isExternal(log: LogEntry): boolean {
  if (!EXTERNAL_TYPES.has(log.messageType)) return false;
  const isBilateralEcho =
    log.decision === "ACCEPT" &&
    log.reasoning?.toLowerCase().includes("bilateral");
  if (isBilateralEcho) return false;
  return true;
}

function projectToTuple(log: LogEntry): string {
  // Canonical tuple: who sent what, with what offered price.
  // We deliberately exclude `round` because round-labeling diverges (the bug we
  // know about) and `reasoning` because each side may record it differently.
  return `${log.from}:${log.messageType}:${log.offeredPrice ?? "—"}`;
}

interface InvariantResult {
  ok:                 boolean;
  orderingKeyUsed:    "envelopeCounter" | "timestamp";
  envelopeFieldsPresent: { buyer: number; seller: number; total: number };
  internalExcluded:   { buyer: number; seller: number };
  buyerSeq:           string[];
  sellerSeq:          string[];
  divergenceIndex?:   number;
  divergenceDetail?:  string;
}

function checkInvariant(buyer: AuditFile, seller: AuditFile): InvariantResult {
  const buyerExt  = buyer.logs.filter(isExternal);
  const sellerExt = seller.logs.filter(isExternal);

  const internalExcluded = {
    buyer:  buyer.logs.length  - buyerExt.length,
    seller: seller.logs.length - sellerExt.length,
  };

  // Check if envelope counters are populated (Phase 2 instrumentation).
  // We need them on BOTH sides for the canonical ordering to be meaningful.
  const buyerWithEnv  = buyerExt.filter(l => typeof l.envelopeCounter === "number").length;
  const sellerWithEnv = sellerExt.filter(l => typeof l.envelopeCounter === "number").length;
  const allBuyerHaveEnv  = buyerWithEnv  === buyerExt.length  && buyerExt.length  > 0;
  const allSellerHaveEnv = sellerWithEnv === sellerExt.length && sellerExt.length > 0;
  const useEnvelopeKey   = allBuyerHaveEnv && allSellerHaveEnv;

  // Sort using the chosen ordering key.
  const sortFn = useEnvelopeKey
    ? (a: LogEntry, b: LogEntry) => {
        // Sort by (from, envelopeCounter) — each direction has its own monotonic
        // counter, so we interleave them via the timestamp tie-breaker.
        if (a.from !== b.from) {
          // Different directions: fall back to timestamp ordering for interleave
          return Date.parse(a.timestamp) - Date.parse(b.timestamp);
        }
        return (a.envelopeCounter ?? 0) - (b.envelopeCounter ?? 0);
      }
    : (a: LogEntry, b: LogEntry) => Date.parse(a.timestamp) - Date.parse(b.timestamp);

  const buyerSorted  = [...buyerExt].sort(sortFn);
  const sellerSorted = [...sellerExt].sort(sortFn);

  const buyerSeq  = buyerSorted.map(projectToTuple);
  const sellerSeq = sellerSorted.map(projectToTuple);

  // Find divergence
  const maxLen = Math.max(buyerSeq.length, sellerSeq.length);
  for (let i = 0; i < maxLen; i++) {
    if (buyerSeq[i] !== sellerSeq[i]) {
      return {
        ok: false,
        orderingKeyUsed: useEnvelopeKey ? "envelopeCounter" : "timestamp",
        envelopeFieldsPresent: {
          buyer:  buyerWithEnv,
          seller: sellerWithEnv,
          total:  buyerExt.length + sellerExt.length,
        },
        internalExcluded,
        buyerSeq,
        sellerSeq,
        divergenceIndex: i,
        divergenceDetail: `position ${i}: BUYER says "${buyerSeq[i] ?? "<missing>"}", SELLER says "${sellerSeq[i] ?? "<missing>"}"`,
      };
    }
  }

  return {
    ok: true,
    orderingKeyUsed: useEnvelopeKey ? "envelopeCounter" : "timestamp",
    envelopeFieldsPresent: {
      buyer:  buyerWithEnv,
      seller: sellerWithEnv,
      total:  buyerExt.length + sellerExt.length,
    },
    internalExcluded,
    buyerSeq,
    sellerSeq,
  };
}

// ── Output formatting ───────────────────────────────────────────────────────

function printHeader() {
  console.log("");
  console.log(`${C.bold}══════════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  WEDGE1 / Guarantee C — Message-Ordering Invariant Test${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════════════════${C.reset}`);
  console.log("");
}

function printSequencePair(buyerSeq: string[], sellerSeq: string[], divergeAt?: number) {
  console.log(`  ${C.dim}Externally-visible event sequence (projected to BUYER/SELLER:type:price):${C.reset}`);
  console.log("");
  const maxLen = Math.max(buyerSeq.length, sellerSeq.length);
  console.log(`  ${C.bold}${"pos".padEnd(5)}${"BUYER's view".padEnd(35)}${"SELLER's view".padEnd(35)}${C.reset}`);
  console.log(`  ${C.dim}${"─".repeat(75)}${C.reset}`);
  for (let i = 0; i < maxLen; i++) {
    const b      = buyerSeq[i]  ?? "<missing>";
    const s      = sellerSeq[i] ?? "<missing>";
    const match  = b === s;
    const marker = match ? C.green + "  ✓" : C.red + "  ✗";
    const color  = match ? C.reset : (i === divergeAt ? C.red : C.yellow);
    console.log(`  ${marker}${C.reset}${color} ${String(i).padEnd(3)} ${b.padEnd(35)}${s.padEnd(35)}${C.reset}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  printHeader();

  const argId = process.argv[2];
  const negotiationId = argId ?? findLatestNegotiation();

  if (!negotiationId) {
    console.log(`  ${C.yellow}⚠  No audit pair found in ${ESCALATIONS_DIR}${C.reset}`);
    console.log(`  ${C.dim}Run a negotiation first (\`start negotiation 300\` from the CLI),${C.reset}`);
    console.log(`  ${C.dim}then re-run this test.${C.reset}`);
    console.log("");
    process.exit(0);  // informational, not a failure
  }

  console.log(`  ${C.cyan}Testing: ${negotiationId}${C.reset}`);
  console.log("");

  const buyerPath  = findAuditFile(negotiationId, "BUYER");
  const sellerPath = findAuditFile(negotiationId, "SELLER");

  if (!buyerPath || !sellerPath) {
    console.log(`  ${C.red}✗ Audit pair incomplete for ${negotiationId}${C.reset}`);
    console.log(`    BUYER audit:  ${buyerPath  ?? "<missing>"}`);
    console.log(`    SELLER audit: ${sellerPath ?? "<missing>"}`);
    console.log("");
    process.exit(2);
  }

  console.log(`  ${C.dim}BUYER audit:  ${path.basename(buyerPath)}${C.reset}`);
  console.log(`  ${C.dim}SELLER audit: ${path.basename(sellerPath)}${C.reset}`);
  console.log("");

  const buyer  = loadAudit(buyerPath);
  const seller = loadAudit(sellerPath);

  const result = checkInvariant(buyer, seller);

  // Report instrumentation status
  const { buyer: buyerWithEnv, seller: sellerWithEnv } = result.envelopeFieldsPresent;
  if (result.orderingKeyUsed === "envelopeCounter") {
    console.log(`  ${C.green}✓ Phase 2 instrumentation present${C.reset} — using canonical (direction, envelopeCounter) ordering`);
  } else {
    console.log(`  ${C.yellow}⚠ Phase 2 instrumentation not yet present${C.reset}`);
    console.log(`  ${C.dim}  envelopeCounter populated: BUYER ${buyerWithEnv}/${result.buyerSeq.length}, SELLER ${sellerWithEnv}/${result.sellerSeq.length}${C.reset}`);
    console.log(`  ${C.dim}  Falling back to (timestamp, direction) ordering. This catches the${C.reset}`);
    console.log(`  ${C.dim}  same bug class but is slightly weaker than envelopeCounter ordering.${C.reset}`);
  }

  // Report internal exclusions so the operator can see what was filtered out
  if (result.internalExcluded.buyer > 0 || result.internalExcluded.seller > 0) {
    console.log(`  ${C.dim}  Internal entries excluded from comparison: BUYER ${result.internalExcluded.buyer}, SELLER ${result.internalExcluded.seller}${C.reset}`);
    console.log(`  ${C.dim}    (TREASURY_OVERRIDE, bilateral-accept echo, etc. — see test source)${C.reset}`);
  }
  console.log("");

  // Print the sequence pair
  printSequencePair(result.buyerSeq, result.sellerSeq, result.divergenceIndex);
  console.log("");

  // Print verdict
  if (result.ok) {
    console.log(`  ${C.green + C.bold}✓ INVARIANT HOLDS${C.reset}`);
    console.log(`  ${C.dim}  BUYER and SELLER agree on the externally-visible event sequence.${C.reset}`);
    console.log(`  ${C.dim}  ${result.buyerSeq.length} events checked.${C.reset}`);
    console.log("");
    process.exit(0);
  } else {
    console.log(`  ${C.red + C.bold}✗ INVARIANT VIOLATED${C.reset}`);
    console.log(`  ${C.red}  ${result.divergenceDetail}${C.reset}`);
    console.log("");
    console.log(`  ${C.dim}This indicates BUYER and SELLER have inconsistent views of the same${C.reset}`);
    console.log(`  ${C.dim}negotiation. Guarantee C requires byte-identical event sequences (modulo${C.reset}`);
    console.log(`  ${C.dim}internal-only entries). Investigate the agent code at the divergence point.${C.reset}`);
    console.log("");
    process.exit(1);
  }
}

main();
