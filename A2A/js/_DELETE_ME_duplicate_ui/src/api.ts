// ─── Typed API client for the buyer agent endpoints ────────────────────────
// /api/recent-deals  → list of summary cards
// /api/quality/:neg  → full audit JSON for one negotiation

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
    roundsUsed:   number;
    maxRounds:    number;
    finalPrice?:  number;
    quantity:     number;
    deliveryDate?: string;
    paymentTerms?: string;
    priceTrail:   { round: number; buyer?: number; seller?: number; gap?: number }[];
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
    flags:       {
      agreementTrap:      boolean;
      sellerCapturedMost: boolean;
      buyerCapturedMost:  boolean;
      outsideZOPA:        boolean;
    };
    summary:     string;
    computedAt:  string;
  };
  treasury?:  Record<string, unknown>;
  extras?:    Record<string, unknown>;
  logs?:      unknown[];
}

export async function fetchRecentDeals(): Promise<DealSummary[]> {
  const resp = await fetch("/api/recent-deals");
  if (!resp.ok) throw new Error(`/api/recent-deals → HTTP ${resp.status}`);
  const data = await resp.json();
  return data.deals ?? [];
}

export async function fetchQuality(negotiationId: string): Promise<AuditDoc> {
  const resp = await fetch(`/api/quality/${encodeURIComponent(negotiationId)}`);
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error ?? `/api/quality → HTTP ${resp.status}`);
  }
  return resp.json();
}
