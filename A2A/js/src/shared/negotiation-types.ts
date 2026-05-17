// ================= SHARED NEGOTIATION TYPES =================

export type NegotiationStatus =
    | "INITIATED"
    | "NEGOTIATING"
    | "ACCEPTED"
    | "COMPLETED"
    | "FAILED"
    | "REJECTED"
    | "ESCALATED"
    | "DD_COMPLETED";   // negotiation + dynamic discounting fully settled

export type NegotiationAction = "OFFER" | "COUNTER_OFFER" | "ACCEPT" | "REJECT";

export type AgentRole = "BUYER" | "SELLER";

// ================= NEGOTIATION DATA SCHEMAS =================

export interface NegotiationDataBase {
    negotiationId: string;
    round: number;
    timestamp: string;
}

export interface OfferData extends NegotiationDataBase {
    type: "OFFER";
    pricePerUnit: number;
    quantity: number;
    from: AgentRole;
    deliveryDate: string;
}

export interface CounterOfferData extends NegotiationDataBase {
    type: "COUNTER_OFFER";
    pricePerUnit: number;
    previousPrice: number;
    from: AgentRole;
    reasoning?: string;
}

export interface AcceptanceData extends NegotiationDataBase {
    type: "ACCEPT_OFFER";
    acceptedPrice: number;
    from: AgentRole;
    finalTerms: {
        pricePerUnit: number;
        quantity: number;
        totalAmount: number;
        deliveryDate: string;
    };
    // Iteration 4: post-deal disclosure for audit purposes. The sender voluntarily
    // discloses their private reservation price (sellerMin if from SELLER,
    // buyerMax if from BUYER) so the counterparty's audit JSON can record what
    // was actually known about the bargaining zone. Not used in negotiation
    // logic — only recorded after the fact. Never echoed to the UI chat.
    disclosed?: {
        reservationPrice: number;   // sellerMin (if from=SELLER) or buyerMax (if from=BUYER)
        currency:         "INR" | "USD";
        note?:            string;   // free-form, e.g. "for audit only"
    };
}

export interface RejectionData extends NegotiationDataBase {
    type: "REJECT_OFFER";
    from: AgentRole;
    reason: string;
    finalRound: boolean;
}

export interface EscalationNoticeData extends NegotiationDataBase {
    type: "ESCALATION_NOTICE";
    from: AgentRole;
    buyerFinalOffer:  number;
    sellerFinalOffer: number;
    gap:              number;
    reportPath:       string;
}

export interface InvoiceData {
    type: "INVOICE";
    invoiceId: string;
    negotiationId: string;
    poId: string;
    invoiceDate: string;
    terms: {
        pricePerUnit: number;
        quantity: number;
        subtotal: number;
        tax: number;
        total: number;
    };
    paymentTerms: string;
    deliveryDate: string;
}

export interface PurchaseOrderData {
    type: "PURCHASE_ORDER";
    poId: string;
    negotiationId: string;
    orderDate: string;
    terms: {
        pricePerUnit: number;
        quantity: number;
        total: number;
    };
    deliveryDate: string;
    // Iteration 4: buyer's voluntary post-deal disclosure of its maxBudget so
    // the seller's audit JSON can record the bargaining zone the buyer was
    // operating in. Audit-only — NOT used for negotiation logic, NEVER shown
    // in the chat UI.
    disclosed?: {
        reservationPrice: number;   // buyerMax
        currency:         "INR" | "USD";
        note?:            string;
    };
}

// ================= DYNAMIC DISCOUNTING MESSAGE TYPES =================

export interface DDOfferData {
    type: "DD_OFFER";
    invoiceId: string;
    negotiationId: string;
    invoiceDate: string;
    dueDate: string;
    originalTotal: number;
    maxDiscountRate: number;
    paymentTermsDays: number;
    proposedSettlementDate: string;
    discountAtProposedDate: {
        daysEarly: number;
        totalDays: number;
        appliedRate: number;
        discountedAmount: number;
        savingAmount: number;
    };
}

export interface DDAcceptData {
    type: "DD_ACCEPT";
    invoiceId: string;
    negotiationId: string;
    chosenSettlementDate: string;
    from: "BUYER";
}

export interface DDInvoiceData {
    type: "DD_INVOICE";
    invoiceId: string;
    negotiationId: string;
    originalTotal: number;
    discountedTotal: number;
    savingAmount: number;
    appliedRate: number;
    settlementDate: string;
    dueDate: string;
    actusContractId: string;
    actusScenarioId: string;
    actusSimulationStatus: "SUCCESS" | "FAILED";
    actusError?: string;
}

export type NegotiationData =
    | OfferData
    | CounterOfferData
    | AcceptanceData
    | RejectionData
    | EscalationNoticeData
    | InvoiceData
    | PurchaseOrderData
    | DDOfferData
    | DDAcceptData
    | DDInvoiceData;

// ================= ITERATION 4 — DECISION TRAIL =================
// Each round, each agent records what the LLM proposed, what the constraint
// validator did to it, any treasury override, the market context, and the
// final outgoing decision. Stored in the audit JSON for full explainability.

export interface DecisionTrailEntry {
    round:              number;
    timestamp:          string;
    perspective:        AgentRole;
    incomingOffer?:     number;            // what the counterparty just offered (undefined for round 1 buyer-side)
    llmProposal: {
        action:         "ACCEPT" | "COUNTER" | "REJECT";
        price?:         number;
        reasoning:      string;
        usedFallback?:  boolean;            // true if rule-based fallback was used
    };
    constraintAdjustment?: {
        action:         "ACCEPT" | "COUNTER" | "REJECT";
        price?:         number;
        reasoning:      string;
    };
    treasuryOverride?: {                    // seller-side only
        approved:       boolean;
        minViablePrice?: number;
        failReasons?:   string[];
        npvOfDeal?:     number;
        netProfit?:     number;
    };
    finalDecision: {
        action:         "ACCEPT" | "COUNTER" | "REJECT";
        price?:         number;
    };
    marketContext?: {
        sofrRate:               number;
        sofrSource:             string;
        effectiveBorrowingRate: number;
        cottonPricePerLb?:      number;
        capturedAt:             string;
    };
}

// Constraint disclosure record — captures what each side disclosed about its
// private reservation price, and an integrity flag comparing to the
// known-true demo constant (will go away once the demo is replaced by real
// onboarded counterparty constraint records).
export interface ConstraintDisclosureRecord {
    selfReservationPrice: {
        value:    number;
        source:   "own-config";
        currency: "INR" | "USD";
    };
    disclosedByCounterparty?: {
        value:     number;
        source:    "disclosed-in-ACCEPT_OFFER" | "disclosed-in-PURCHASE_ORDER" | "not-disclosed";
        currency:  "INR" | "USD";
        receivedAt: string;
        note?:     string;
    };
    fallbackUsed?: {
        value:    number;
        source:   "demo-constant";
        reason:   string;
    };
}

// ================= vLEI / IPEX AUDIT RECORDS =================
// These are stored on the negotiation state and saved to the JSON audit file.

/** Record of a vLEI delegation verification event */
export interface VLEIAuditRecord {
    verified:            boolean;
    agentName:           string;
    agentAID:            string;
    oorHolderName:       string;
    legalEntityName:     string;
    lei:                 string;
    trustChain:          string[];
    verifiedAt:          string;
    verificationScript:  string;   // "DEEP" | "DEEP-EXT"
    verificationType:    string;   // "STANDARD" | "EXTERNAL"
    error?:              string;
}

/** Record of an IPEX credential exchange event */
export interface IPEXAuditRecord {
    invoiceId:           string;
    invoiceType:         "INVOICE" | "DD_INVOICE";
    credentialSAID?:     string;
    grantSAID?:          string;
    admitSAID?:          string;
    issued:              boolean;
    granted:             boolean;
    admitted:            boolean;
    timestamp:           string;
    error?:              string;
}

/** Market data snapshot captured during negotiation */
export interface MarketAuditRecord {
    sofrRate:               number;
    sofrSource:             string;   // "FRED" | "SIMULATED"
    cottonPricePerLb:       number;
    effectiveBorrowingRate: number;
    capturedAt:             string;
}

// ================= STATE MANAGEMENT =================

export interface RoundHistory {
    round: number;
    buyerOffer?: number;
    sellerOffer?: number;
    buyerAction?: NegotiationAction;
    sellerAction?: NegotiationAction;
    timestamp: string;
    reasoning?: string;
}

export interface BuyerNegotiationState {
    negotiationId: string;
    contextId: string;
    status: NegotiationStatus;

    // Parameters
    targetQuantity: number;
    maxBudget: number;
    deliveryDate: string;

    // Round tracking
    currentRound: number;
    maxRounds: number;

    // History
    history: RoundHistory[];

    // Current state
    lastBuyerOffer?: number;
    lastSellerOffer?: number;

    // Final agreement
    agreedPrice?: number;
    totalCost?: number;

    // Strategy
    strategyParams: {
        aggressiveness: number;
        riskTolerance: number;
        initialOfferRange: { min: number; max: number };
    };

    // ── Audit trail (Step 5) ──────────────────────────────────────────────────
    vleiVerification?:  VLEIAuditRecord;    // buyer verified seller
    ipexInvoice?:       IPEXAuditRecord;    // admitted invoice credential
    ipexDDInvoice?:     IPEXAuditRecord;    // admitted DD invoice credential
    marketSnapshot?:    MarketAuditRecord;  // market data at negotiation time
}

export interface SellerNegotiationState {
    negotiationId: string;
    contextId: string;
    status: NegotiationStatus;

    // Business constraints (PRIVATE)
    marginPrice: number;
    targetProfitPercentage: number;

    // Parameters
    quantity: number;
    deliveryDate: string;

    // Round tracking
    currentRound: number;
    maxRounds: number;

    // History
    history: RoundHistory[];

    // Current state
    lastBuyerOffer?: number;
    lastSellerOffer?: number;

    // Final agreement
    agreedPrice?: number;
    profitPerUnit?: number;
    totalRevenue?: number;

    // Strategy
    strategyParams: {
        flexibility: number;
        dealPriority: number;
        minProfitMargin: number;
    };

    // Treasury consultation results (most recent)
    lastTreasuryResult?: TreasuryConsultationSummary;

    // ── Audit trail (Step 5) ──────────────────────────────────────────────────
    vleiVerification?:  VLEIAuditRecord;    // seller verified buyer
    ipexInvoice?:       IPEXAuditRecord;    // issued/granted invoice credential
    ipexDDInvoice?:     IPEXAuditRecord;    // issued/granted DD invoice credential
    marketSnapshot?:    MarketAuditRecord;  // market data at negotiation time
}

// ================= DECISION MAKING =================

export interface NegotiationDecision {
    action: "ACCEPT" | "COUNTER" | "REJECT";
    price?: number;
    reasoning: string;
}

export interface LLMResponse {
    action: "ACCEPT" | "COUNTER" | "REJECT";
    price?: number;
    reasoning: string;
    confidence?: number;
}

// ================= TREASURY TYPES =================

export interface TreasuryConsultationQuery {
    negotiationId: string;
    pricePerUnit:  number;
    quantity:      number;
    paymentTerms:  number;
    round:         number;
}

export interface TreasuryConsultationSummary {
    round:               number;
    priceQueried:        number;
    approved:            boolean;
    npvOfDeal:           number;
    netProfit:           number;
    projectedMinBalance: number;
    safetyThreshold:     number;
    workingCapitalCost:  number;
    minViablePrice?:     number;
    overrideApplied:     boolean;
}

// ================= LOGGING =================

export interface NegotiationLog {
    timestamp: string;
    negotiationId: string;
    round: number;
    messageType: string;
    from: AgentRole;

    offeredPrice?: number;
    previousPrice?: number;
    priceMovement?: number;
    priceMovementPercent?: number;

    decision: NegotiationAction;
    reasoning?: string;

    gap?: number;
    gapClosed?: number;

    // ── WEDGE1 / Guarantee C — message-ordering audit invariant ────────
    // Populated when the log entry corresponds to a SEALED message (either
    // received-and-verified or sent-after-seal). Both agents' audits, when
    // filtered to entries with these fields populated and sorted by
    // (direction, envelopeCounter), MUST produce byte-identical sequences.
    // The regression test in scripts/test-envelope-ordering.ts enforces this.
    //
    // Fields are optional for backward compatibility:
    //   - Legacy unsealed messages (older clients) leave them undefined
    //   - Internal logger events (e.g. SELLER bilateral-accept echo) leave
    //     them undefined since no envelope was minted for them
    envelopeCounter?: number;     // from envelope.counter
    envelopeHash?:    string;     // from envelope.envelopeHash — canonical event ref
}

// ================= JSON AUDIT FILE =================
// Complete audit trail saved as NEG-xxx_audit.json for UI consumption.

export interface NegotiationAudit {
    // Header
    negotiationId:   string;
    timestamp:       string;
    outcome:         NegotiationStatus;
    perspective:     AgentRole;

    // Parties with vLEI identity
    parties: {
        seller: {
            agentName:       string;
            agentAID?:       string;
            oorHolderName?:  string;
            legalEntityName: string;
            lei:             string;
        };
        buyer: {
            agentName:       string;
            agentAID?:       string;
            oorHolderName?:  string;
            legalEntityName: string;
            lei:             string;
        };
    };

    // vLEI verification events
    vleiVerification?: {
        sellerVerifiedBuyer?: VLEIAuditRecord;
        buyerVerifiedSeller?: VLEIAuditRecord;
    };

    // Negotiation rounds
    negotiation: {
        rounds:          RoundHistory[];
        roundsUsed:      number;
        maxRounds:       number;
        finalPrice?:     number;
        quantity:        number;
        totalDealValue?: number;
        deliveryDate:    string;
        paymentTerms:    string;
    };

    // Invoice & IPEX
    invoice?: {
        invoiceId:     string;
        subtotal:      number;
        tax:           number;
        total:         number;
        ipex?:         IPEXAuditRecord;
    };

    // Dynamic Discounting
    dynamicDiscounting?: {
        offered:            boolean;
        decision?:          "AUTO_ACCEPT" | "AUTO_REJECT" | "ESCALATED_TO_CPO";
        maxDiscountRate?:   number;
        originalTotal?:     number;
        discountedTotal?:   number;
        savingAmount?:      number;
        appliedRate?:       number;
        settlementDate?:    string;
        dueDate?:           string;
        ipex?:              IPEXAuditRecord;
        actus?: {
            contractId:      string;
            status:          "SUCCESS" | "FAILED";
            error?:          string;
        };
    };

    // Treasury ACTUS validation
    treasury?: TreasuryConsultationSummary;

    // Market data
    marketData?: MarketAuditRecord;
}
