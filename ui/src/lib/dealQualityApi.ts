// ─── Typed API client for the buyer agent's deal-quality endpoints ────────
// Buyer agent (port 9090) exposes:
//   GET /api/recent-deals             list of recent audit summaries
//   GET /api/quality/:negotiationId   full audit JSON for one negotiation
//
// We hit the buyer agent directly via its absolute URL. The treasury polling
// already in Dashboard.tsx uses the same pattern (http://localhost:7070/...).

const BUYER_URL = (import.meta.env.VITE_BUYER_URL as string | undefined) ?? "http://localhost:9090";

export interface DealSummary {
  negotiationId: string;
  outcome:       "success" | "escalation" | string;
  finalPrice?:   number;
  quantity?:     number;
  roundsUsed?:   number;
  closedAt?:     string;
  counterparty?: string;
  summary?:      string;
  error?:        string;
}

export interface AuditDoc {
  negotiationId: string;
  perspective:   "BUYER" | "SELLER";
  outcome:       "success" | "escalation";
  startedAt:     string;
  generatedAt:   string;
  parties: {
    self:         { role: string; lei?: string; legalEntityName?: string };
    counterparty: { role: string; lei?: string; legalEntityName?: string };
  };
  identity: { credentialMode: "plain" | "vlei" };
  negotiation: {
    roundsUsed:    number;
    maxRounds:     number;
    finalPrice?:   number;
    quantity:      number;
    deliveryDate?: string;
    paymentTerms?: string;
    priceTrail:    { round: number; buyer?: number; seller?: number; gap?: number }[];
  };
  outcomeQuality?: {
    closed:      boolean;
    closedPrice: number;
    buyerMax:    number;
    sellerMin:   number;
    currency:    "INR" | "USD";
    IR:          { buyerIR: number; sellerIR: number; bothIR: boolean };
    ZOPA:        { low: number; high: number; width: number; wasFeasible: boolean };
    NBS:         { fairPrice: number; deviationFromNBS: number; deviationPercent: number };
    surplusSplit:{ buyerShare: number; sellerShare: number; totalSurplus?: number };
    flags: {
      agreementTrap:      boolean;
      sellerCapturedMost: boolean;
      buyerCapturedMost:  boolean;
      outsideZOPA:        boolean;
    };
    summary:    string;
    computedAt: string;
  };
  treasury?:  Record<string, unknown>;
  extras?:    Record<string, unknown>;
  logs?:      unknown[];

  // ITERATION 4 — decision trail and constraint disclosure
  decisions?:            DecisionTrailEntry[];
  constraintDisclosure?: ConstraintDisclosureRecord;

  // WEDGE1 / M1 — seller-response-mode block (added by saveAuditJson at deal-close).
  // Optional because pre-M1 audits don't have it.
  sellerResponseMode?: SellerResponseModeBlock;
}

// Mirror of the TypeScript interface in A2A/js/src/shared/negotiation-types.ts.
// Kept in sync manually; if the backend changes shape, update here too.
export interface DecisionTrailEntry {
  round:         number;
  timestamp:     string;
  perspective:   "BUYER" | "SELLER";
  incomingOffer?: number;
  llmProposal: {
    action:    "ACCEPT" | "COUNTER" | "REJECT";
    price?:    number;
    reasoning: string;
    usedFallback?: boolean;
  };
  constraintAdjustment?: {
    action:    "ACCEPT" | "COUNTER" | "REJECT";
    price?:    number;
    reasoning: string;
  };
  treasuryOverride?: {
    approved:        boolean;
    minViablePrice?: number;
    failReasons?:    string[];
    npvOfDeal?:      number;
    netProfit?:      number;
  };
  finalDecision: {
    action: "ACCEPT" | "COUNTER" | "REJECT";
    price?: number;
  };
  marketContext?: {
    sofrRate:               number;
    sofrSource:             string;
    effectiveBorrowingRate: number;
    cottonPricePerLb?:      number;
    capturedAt:             string;
  };
}

export interface ConstraintDisclosureRecord {
  selfReservationPrice: {
    value:    number;
    source:   "own-config";
    currency: "INR" | "USD";
  };
  disclosedByCounterparty?: {
    value:      number;
    source:     "disclosed-in-ACCEPT_OFFER" | "disclosed-in-PURCHASE_ORDER" | "not-disclosed";
    currency:   "INR" | "USD";
    receivedAt: string;
    note?:      string;
  };
  fallbackUsed?: {
    value:  number;
    source: "demo-constant";
    reason: string;
  };
}

export async function fetchRecentDeals(): Promise<DealSummary[]> {
  const resp = await fetch(`${BUYER_URL}/api/recent-deals`);
  if (!resp.ok) throw new Error(`/api/recent-deals → HTTP ${resp.status}`);
  const data = await resp.json();
  return data.deals ?? [];
}

export async function fetchQuality(negotiationId: string): Promise<AuditDoc> {
  const resp = await fetch(`${BUYER_URL}/api/quality/${encodeURIComponent(negotiationId)}`);
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error ?? `/api/quality → HTTP ${resp.status}`);
  }
  return resp.json();
}

// Note: to START a negotiation, use sendToBuyerAgent() from a2aService.ts —
// the existing chat interface on /agents already does this. Don't duplicate.

// =============================================================================
// ITERATION 5–7 — baseline, mode matrix, PDF, filtered deal listing
// =============================================================================

export interface BaselineMetrics {
  generatedAt:    string;
  escalationsDir: string;
  totals: {
    uniqueNegotiations: number;
    byTier:    Record<string, number>;
    byOutcome: { success: number; escalation: number; unknown: number };
  };
  metrics: {
    sampleCounts: { closedPrice: number; outcomeQuality: number; surplusSplit: number };
    medianClosedPrice?:           number;
    pctClosedAtOrBelowNBS?:       number;
    medianDeviationFromNBS?:      number;
    medianBuyerShare?:            number;
    medianSellerShare?:           number;
    pctAgreementTrap?:            number;
    pctOutsideZOPA?:              number;
    pctBothPartiesIR?:            number;
  };
  records: unknown[];
  _meta: {
    baselineFileMtimeMs:  number;
    baselineFilePath:     string;
    escalationsMtimeMs:   number | null;
    stale:                boolean;
  };
}

export interface ModeMatrixCell {
  credential: "plain" | "vlei";
  signing:    "plain" | "vlei";
  supported:  boolean;
  label:      string;
  envHint:    string;
}

export interface ModeMatrix {
  current: { credential: "plain" | "vlei"; signing: "plain" | "vlei" };
  cells:   ModeMatrixCell[];
  note:    string;
}

export interface DealFilter {
  limit?:        number;
  outcome?:      "success" | "escalation";
  counterparty?: string;
  from?:         string;  // ISO date
  to?:           string;  // ISO date
}

export async function fetchBaseline(): Promise<BaselineMetrics | { notGenerated: true; hint: string }> {
  const resp = await fetch(`${BUYER_URL}/api/baseline`);
  if (resp.status === 404) {
    const body = await resp.json().catch(() => ({}));
    return { notGenerated: true, hint: body?.hint ?? "Run npm run replay:fixtures" };
  }
  if (!resp.ok) throw new Error(`/api/baseline → HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchModeMatrix(): Promise<ModeMatrix> {
  const resp = await fetch(`${BUYER_URL}/api/mode-matrix`);
  if (!resp.ok) throw new Error(`/api/mode-matrix → HTTP ${resp.status}`);
  return resp.json();
}

export async function fetchFilteredDeals(f: DealFilter): Promise<DealSummary[]> {
  const qs = new URLSearchParams();
  if (f.limit        !== undefined) qs.set("limit",        String(f.limit));
  if (f.outcome      !== undefined) qs.set("outcome",      f.outcome);
  if (f.counterparty !== undefined && f.counterparty !== "") qs.set("counterparty", f.counterparty);
  if (f.from         !== undefined && f.from !== "")         qs.set("from",         f.from);
  if (f.to           !== undefined && f.to   !== "")         qs.set("to",           f.to);
  const url = qs.toString() ? `${BUYER_URL}/api/recent-deals?${qs}` : `${BUYER_URL}/api/recent-deals`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`/api/recent-deals → HTTP ${resp.status}`);
  const data = await resp.json();
  return data.deals ?? [];
}

/** Trigger a download of the audit PDF for a negotiation. Opens a new tab. */
export function downloadAuditPdf(negotiationId: string): void {
  const url = `${BUYER_URL}/api/quality/${encodeURIComponent(negotiationId)}/pdf`;
  // Use a temporary anchor so the browser handles Content-Disposition properly.
  const a = document.createElement("a");
  a.href = url;
  a.download = `${negotiationId}-audit.pdf`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// =============================================================================
// WEDGE1 / M1 — Seller response mode framework
// =============================================================================
// CONT8 / M2-ε: This endpoint moved to the SELLER agent at
// /api/self/mode-status (port 8080). Before CONT8 it lived on the buyer agent
// at /api/mode-status, but the buyer's view was always sourced from the
// BUYER's process env — which by design never sets SELLER_RESPONSE_MODE.
// That made the Settings card report the wrong mode (always defaulting to
// BASIC_SALES_QUOTING_1) regardless of what the seller was actually running.
//
// Per the /api/self/* convention: an agent's /api/self/* endpoints report
// about THAT agent only. The seller is the authoritative source for its
// own SELLER_RESPONSE_MODE.
//
// Type shapes mirror src/shared/negotiation-mode.ts on the backend. Keep them
// in sync manually — if you add a capability or change the mode list there,
// reflect it here too.

const SELLER_URL = (import.meta.env.VITE_SELLER_URL as string | undefined) ?? "http://localhost:8080";

export type SellerResponseMode =
  | "BASIC_SALES_QUOTING_1"
  | "L1_DELEGATED_ADVISORS"
  | "L2_EXECUTIVE_REASONER"
  | "L3_STYLE_AND_AUTONOMY"
  | "L4_LEARNED_PROFILES_AND_PD";

export type ProviderMode = "real" | "demo";

export type EvaluationContext = "live" | "paper-trade" | "benchmark" | "replay";

export interface ProviderModes {
  inventory: ProviderMode;
  logistics: ProviderMode;
  credit:    ProviderMode;
}

export interface ResolvedCapabilities {
  treasuryConsultation:        boolean;
  inventoryLogisticsSubAgents: boolean;
  creditSubAgent:              boolean;
  advisorMathAggregator:       boolean;
  llmExecutiveJudgment:        boolean;
  styleFramework:              boolean;
  opponentStyleInference:      boolean;
  autonomyLevels:              boolean;
  perCounterpartyProfiles:     boolean;
  customCommodityPdModels:     boolean;
}

export interface SellerResponseModeBlock {
  mode:                  SellerResponseMode;
  resolvedCapabilities:  ResolvedCapabilities;
  providerModes:         ProviderModes;
  evaluationContext:     EvaluationContext;
  resolvedFromEnv: {
    SELLER_RESPONSE_MODE: string | null;
    INVENTORY_MODE:       string | null;
    LOGISTICS_MODE:       string | null;
    CREDIT_MODE:          string | null;
    EVALUATION_CONTEXT:   string | null;
  };
}

/** Response shape from GET /api/self/mode-status (SELLER agent, port 8080). */
export interface ModeStatus extends SellerResponseModeBlock {
  modeDescriptions:     Record<string, string>;
  changeInstructions:   string;
  /** Identifies which process served this response, e.g. "seller-agent@port-8080".
   *  Always present from the seller's /api/self/mode-status endpoint. */
  servedBy?:            string;
}

export async function fetchModeStatus(): Promise<ModeStatus> {
  const resp = await fetch(`${SELLER_URL}/api/self/mode-status`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body?.error ?? `/api/self/mode-status (seller) → HTTP ${resp.status}`);
  }
  return resp.json();
}
