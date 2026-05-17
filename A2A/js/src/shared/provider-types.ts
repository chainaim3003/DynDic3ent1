// ================= WEDGE1 / M2-α.1 + M2-α.3 — PROVIDER INTERFACES =================
//
// Type contract that every sub-agent's data provider must implement. The
// interfaces here are PURE TYPING — no runtime code, no implementations.
// Sub-agents (Inventory, Logistics, Credit, Treasury) and the M2
// ConsultationRouter consume these types; implementations live alongside
// in src/shared/*-provider.ts.
//
// Design goals:
//  1. Provenance is non-negotiable. Every consultation carries a metadata
//     block recording subAgent, dataMode (real|demo), data source, and
//     latency. The audit JSON's `consultations[]` block is built directly
//     from `ConsultationRecord` values.
//  2. Defensive branches are first-class. When a real provider fails
//     (network error, missing data, schema mismatch), the record carries
//     `success: false` and an `error` string — the consumer decides what
//     defensive action to take (e.g. switch to demo fallback, refuse the
//     deal, demand pre-payment).
//  3. real/demo symmetry. The same interface backs both real-API providers
//     and demo-fixture providers, with only the metadata distinguishing
//     them.
//
// Provider mode resolution (frozen at construction; switching at runtime is
// a deliberate non-feature — audit would otherwise be ambiguous):
//   - Inventory / Logistics / Credit:  read from resolveProviderModes() in
//                                       negotiation-mode.ts (tier-framework
//                                       integrated, defaults to demo)
//   - Treasury:                          read directly from TREASURY_URL +
//                                       TREASURY_MODE env (defaults to real,
//                                       since treasury is always-on in BASIC1+)

import type { ProviderMode } from "./negotiation-mode.js";

// ─── Provenance metadata ──────────────────────────────────────────────────

/** Which sub-agent produced a consultation. */
export type SubAgentName = "treasury" | "inventory" | "logistics" | "credit";

/**
 * Where a demo consultation's underlying data came from. Always populated
 * when dataMode === "demo". `fixture` = read from a static JSON file under
 * DEMO-DATA/. `synthetic-defensive` = generated on-the-fly when the demo
 * scenario simulates an upstream outage (used for T8 in M2-γ).
 */
export type DemoSourceKind = "fixture" | "synthetic-defensive";

export interface ConsultationMetadata {
  /** Sub-agent that produced this consultation. */
  subAgent: SubAgentName;
  /** real|demo — propagated from env at agent boot, recorded in audit. */
  dataMode: ProviderMode;
  /** When the consultation was performed (ISO timestamp). */
  performedAt: string;
  /**
   * Human-readable description of the data source. Examples:
   *   - real:  "ERPNext Bin endpoint @ erpnext.example.com/api/method/erpnext.stock.get_item_details"
   *   - real:  "GLEIF v1 /lei-records/{lei} @ api.gleif.org"
   *   - real:  "JupiterTreasuryAgent /consult @ http://localhost:7070"
   *   - demo:  "DEMO-DATA/inventory/erpnext-bin-FAB-COTTON-180GSM.json"
   *   - demo:  "DEMO-DATA/credit/edgar-companyfacts-PHILLIPS-VAN-HEUSEN.json"
   */
  dataSource: string;
  /** Demo only: which kind of demo source produced this. */
  demoSourceKind?: DemoSourceKind;
  /** Demo only: path or filename of the fixture used. */
  demoSourceRef?: string;
  /** Round-trip latency in ms — useful for demo theater + real-provider health. */
  latencyMs?: number;
}

/**
 * Wrapper that every provider returns. `success === false` means the
 * defensive branch was triggered; result is undefined and `error` carries
 * the diagnostic. The audit JSON's `consultations[]` block embeds these
 * records verbatim.
 */
export interface ConsultationRecord<T> {
  metadata: ConsultationMetadata;
  /** false ⇒ defensive branch; result undefined, see `error`. */
  success: boolean;
  /** Populated only when success === true. */
  result?: T;
  /** Populated only when success === false. */
  error?: string;
}

// ─── Inventory sub-agent ──────────────────────────────────────────────────

export interface InventoryConsultationInput {
  /** Product SKU/code from the buyer's PO line. */
  productCode: string;
  /** Quantity the buyer wants. */
  quantity: number;
}

export interface InventoryConsultation {
  productCode: string;
  /** Currently free quantity (not reserved). */
  availableQty: number;
  /** Quantity already committed to other orders. */
  reservedQty: number;
  /** Days to manufacture if availableQty < requested. */
  leadTimeDays: number;
  /** Earliest realistic ship date (ISO yyyy-mm-dd). */
  earliestShipDate: string;
  /** Sufficient to fulfill the buyer's `quantity`? Derived from availableQty + lead time fit. */
  canFulfill: boolean;
  /** Optional warehouse / branch source for traceability. */
  warehouseRef?: string;
}

/**
 * Inventory data provider. Real implementation calls ERPNext Bin endpoint;
 * demo implementation reads from DEMO-DATA/inventory/*.json.
 */
export interface InventoryProvider {
  readonly subAgent: "inventory";
  readonly mode: ProviderMode;
  consult(input: InventoryConsultationInput): Promise<ConsultationRecord<InventoryConsultation>>;
}

// ─── Logistics sub-agent ──────────────────────────────────────────────────

export interface LogisticsConsultationInput {
  /** Origin port / inland point (UN/LOCODE preferred). */
  originPort: string;
  /** Destination port / inland point. */
  destinationPort: string;
  /** Total quantity (drives container count + weight bracket). */
  quantity: number;
  /** Service mode the carrier should quote. */
  serviceMode?: "OCEAN_FCL" | "OCEAN_LCL" | "AIR" | "ROAD";
}

export interface CarrierQuote {
  /** Standard Carrier Alpha Code. */
  scac: string;
  /** Carrier display name. */
  name: string;
  transitDays: number;
  rateUsd: number;
  /** Cut-off for booking against this quote. */
  validUntil: string;
}

export interface LogisticsConsultation {
  originPort: string;
  destinationPort: string;
  /** Lowest-quote transit estimate across all carriers returned. */
  estimatedTransitDays: number;
  /** Lowest USD rate across carriers (FCL all-in or per-unit, scope inferred from input). */
  bestRateUsd: number;
  /** Per-carrier quotes from DCSA/T&T or fixture. */
  carriers: CarrierQuote[];
  /** True if any carrier can hit the buyer's requested delivery date. */
  canMeetDeliveryDate: boolean;
}

/**
 * Logistics data provider. Real implementation calls a DCSA-conformant
 * Track & Trace endpoint; demo implementation reads from
 * DEMO-DATA/logistics/*.json.
 */
export interface LogisticsProvider {
  readonly subAgent: "logistics";
  readonly mode: ProviderMode;
  consult(input: LogisticsConsultationInput): Promise<ConsultationRecord<LogisticsConsultation>>;
}

// ─── Credit sub-agent ─────────────────────────────────────────────────────

export interface CreditConsultationInput {
  /** Counterparty Legal Entity Identifier (20 chars, ISO 17442). */
  lei: string;
  /** Optional name for cross-check / logging. */
  legalEntityName?: string;
  /** Deal size — informs credit limit recommendation. */
  dealSizeUsd?: number;
}

/** GLEIF registration status — direct from the LEI record. */
export type GleifStatus = "ACTIVE" | "LAPSED" | "RETIRED" | "MERGED" | "PENDING" | "DUPLICATE";

/** Recommended payment terms output by the credit sub-agent. */
export type RecommendedTerms = "PRE_PAID" | "COD" | "NET_15" | "NET_30" | "NET_45" | "NET_60" | "NET_90";

export interface CreditConsultation {
  lei: string;
  legalEntityName: string;
  /** Status of the LEI registration at GLEIF (live or last-known when demo). */
  gleifStatus: GleifStatus;
  /** Composite 0-100 score derived from GLEIF + EDGAR + commodity exposure. */
  financialHealthScore: number;
  /**
   * 1-year probability of default, [0, 1]. Derived from EDGAR composite when
   * real; preset from fixture when demo.
   */
  pd1y: number;
  /** Loss given default, [0, 1]. */
  lgd: number;
  /** Recommended payment terms given pd1y × lgd × dealSize. */
  recommendedTerms: RecommendedTerms;
  /**
   * Audit-visible justification — short sentence the L2 executive shows
   * the user in the drill-down panel. Never empty.
   */
  rationale: string;
}

/**
 * Credit data provider. Real implementation queries GLEIF + EDGAR + cotton
 * commodity index; demo implementation reads from DEMO-DATA/credit/*.json.
 */
export interface CreditProvider {
  readonly subAgent: "credit";
  readonly mode: ProviderMode;
  consult(input: CreditConsultationInput): Promise<ConsultationRecord<CreditConsultation>>;
}

// ─── Treasury sub-agent (M2-α.3) ──────────────────────────────────────────

export interface TreasuryConsultationInput {
  /** Negotiation this consultation belongs to (passed through to /consult). */
  negotiationId: string;
  /** Price per unit being evaluated (the value the buyer offered or the seller is about to accept). */
  pricePerUnit: number;
  /** Total quantity in the deal. */
  quantity: number;
  /** Payment terms in days (e.g. 30 for Net 30). Optional; defaults to caller policy. */
  paymentTermsDays?: number;
  /** Negotiation round number (1-indexed). */
  round?: number;
}

/**
 * The Treasury sub-agent's verdict on a candidate price. The fields are a
 * subset/projection of the existing TreasuryResult that the treasury agent
 * already returns at POST http://localhost:7070/consult. The adapter
 * (treasury-provider.ts) maps the existing TreasuryResult onto this shape;
 * if the treasury agent is later extended with new fields, the adapter is
 * the only place that needs updating.
 *
 * NOTE: this type intentionally mirrors what the seller-agent currently
 * stores in `state.lastTreasuryResult` and embeds into the audit JSON.
 * Keeping the field names identical avoids a translation layer in M2-β.
 */
export interface TreasuryConsultation {
  /** Did the ACTUS PAM simulation approve the deal at this price? */
  approved: boolean;
  /** Net present value of the deal at the candidate price. */
  npvOfDeal: number;
  /** Net profit (revenue − cost) at the candidate price. */
  netProfit: number;
  /** Projected minimum cash balance over the deal horizon. */
  projectedMinBalance: number;
  /** Safety threshold the projected balance must stay above. */
  safetyThreshold: number;
  /** Cost of working capital for the deal duration. */
  workingCapitalCost: number;
  /**
   * Treasury's recommended minimum viable price — what to counter at when
   * the candidate price is rejected. Optional because some failure modes
   * don't produce a numeric floor (e.g. malformed input).
   */
  minViablePrice?: number;
  /** Human-readable reasons the simulation rejected the price (empty when approved). */
  failReasons: string[];
  /** Echoes input.pricePerUnit so the audit can be read without joining inputs. */
  pricePerUnit: number;
  /** Echoes input.round if provided. */
  round?: number;
}

/**
 * Treasury data provider. Real implementation calls the existing treasury
 * agent's POST /consult endpoint (http://localhost:7070 by default,
 * overridable via TREASURY_URL env). Demo implementation reads from
 * DEMO-DATA/treasury/*.json (lands in M2-β; stubbed in M2-α.3).
 *
 * Unlike the optional sub-agents, treasury defaults to `real` since it is
 * always-on in BASIC1+ tiers — turning it off means turning off the
 * cash/NPV guardrail that the existing seller agent already depends on.
 */
export interface TreasuryProvider {
  readonly subAgent: "treasury";
  readonly mode: ProviderMode;
  consult(input: TreasuryConsultationInput): Promise<ConsultationRecord<TreasuryConsultation>>;
}

// ─── Defensive-action vocabulary ──────────────────────────────────────────

/**
 * When a real provider fails, the L2 executive picks one of these defensive
 * actions and records it in the audit's `defensiveAction` field. The
 * vocabulary is closed so the audit is machine-grep-able.
 */
export type DefensiveAction =
  | "no-action"                              // success — no defensive branch triggered
  | "fallback-to-demo-fixture"               // M2 default: swap to fixture, flag in audit
  | "refused-deferred-terms"                 // refuse Net 30/60/90, demand COD or pre-pay
  | "abandoned-negotiation"                  // refuse to continue; escalate to human
  | "downgraded-tier"                        // run the rest of the deal at a lower tier
  | "asked-for-collateral"                   // require additional collateral / guarantee
  ;

/**
 * Compact audit record describing why a defensive action fired. Embedded
 * under `extras.defensive` in the audit JSON (and surfaced in the drill-down
 * panel in M3).
 */
export interface DefensiveActionRecord {
  action: DefensiveAction;
  triggeredAt: string;
  /** Which sub-agent's failure triggered this action. */
  triggeredBy: SubAgentName;
  /** Verbatim error from the failing consultation. */
  upstreamError: string;
  /** Operator-facing rationale (one sentence). */
  rationale: string;
}
