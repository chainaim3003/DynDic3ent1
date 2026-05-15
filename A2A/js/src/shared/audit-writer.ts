// ================= AUDIT JSON WRITER =================
// Saves a machine-readable JSON audit file per negotiation.
// Called after saveSuccessReport() — same trigger, different format.
// Each agent saves its own perspective (same pattern as .txt reports).
// A UI can load these JSON files to display the full audit trail.

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  NegotiationAudit,
  AgentRole,
  SellerNegotiationState,
  BuyerNegotiationState,
  VLEIAuditRecord,
  IPEXAuditRecord,
  MarketAuditRecord,
  TreasuryConsultationSummary,
  RoundHistory,
} from "./negotiation-types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ESCALATIONS_DIR = path.resolve(__dirname, "..", "escalations");

/**
 * Save a seller-perspective audit JSON file.
 * Contains: seller's vLEI verification of buyer, IPEX issue/grant data,
 * treasury results, market data, and full negotiation trail.
 */
export function saveSellerAuditJSON(
  state: SellerNegotiationState,
  opts: {
    invoiceId?:     string;
    invoiceTotal?:  number;
    invoiceSubtotal?: number;
    invoiceTax?:    number;
    ddOffered:      boolean;
    ddDecision?:    "AUTO_ACCEPT" | "AUTO_REJECT" | "ESCALATED_TO_CPO";
    ddOriginalTotal?:   number;
    ddDiscountedTotal?: number;
    ddSavingAmount?:    number;
    ddAppliedRate?:     number;
    ddSettlementDate?:  string;
    ddDueDate?:         string;
    ddActusContractId?: string;
    ddActusStatus?:     "SUCCESS" | "FAILED";
    ddActusError?:      string;
    paymentTerms:       string;
  }
): string {
  if (!fs.existsSync(ESCALATIONS_DIR)) fs.mkdirSync(ESCALATIONS_DIR, { recursive: true });

  const audit: NegotiationAudit = {
    negotiationId: state.negotiationId,
    timestamp:     new Date().toISOString(),
    outcome:       state.status,
    perspective:   "SELLER",

    parties: {
      seller: {
        agentName:       "jupiterSellerAgent",
        agentAID:        state.vleiVerification?.agentAID,   // from the card we read during verification
        legalEntityName: "JUPITER KNITTING COMPANY",
        lei:             "3358004DXAMRWRUIYJ05",
      },
      buyer: {
        agentName:       "tommyBuyerAgent",
        agentAID:        state.vleiVerification?.agentAID,   // buyer's AID from verification
        oorHolderName:   state.vleiVerification?.oorHolderName,
        legalEntityName: state.vleiVerification?.legalEntityName ?? "TOMMY HILFIGER EUROPE B.V.",
        lei:             state.vleiVerification?.lei ?? "54930012QJWZMYHNJW95",
      },
    },

    vleiVerification: state.vleiVerification ? {
      sellerVerifiedBuyer: state.vleiVerification,
    } : undefined,

    negotiation: {
      rounds:         state.history,
      roundsUsed:     state.currentRound,
      maxRounds:      state.maxRounds,
      finalPrice:     state.agreedPrice,
      quantity:       state.quantity,
      totalDealValue: state.totalRevenue,
      deliveryDate:   state.deliveryDate,
      paymentTerms:   opts.paymentTerms,
    },

    invoice: opts.invoiceId ? {
      invoiceId: opts.invoiceId,
      subtotal:  opts.invoiceSubtotal ?? 0,
      tax:       opts.invoiceTax ?? 0,
      total:     opts.invoiceTotal ?? 0,
      ipex:      state.ipexInvoice,
    } : undefined,

    dynamicDiscounting: opts.ddOffered ? {
      offered:         true,
      decision:        opts.ddDecision,
      originalTotal:   opts.ddOriginalTotal,
      discountedTotal: opts.ddDiscountedTotal,
      savingAmount:    opts.ddSavingAmount,
      appliedRate:     opts.ddAppliedRate,
      settlementDate:  opts.ddSettlementDate,
      dueDate:         opts.ddDueDate,
      ipex:            state.ipexDDInvoice,
      actus: opts.ddActusContractId ? {
        contractId: opts.ddActusContractId,
        status:     opts.ddActusStatus ?? "FAILED",
        error:      opts.ddActusError,
      } : undefined,
    } : { offered: false },

    treasury:   state.lastTreasuryResult,
    marketData: state.marketSnapshot,
  };

  const filePath = path.join(ESCALATIONS_DIR, `${state.negotiationId}_audit_SELLER.json`);
  fs.writeFileSync(filePath, JSON.stringify(audit, null, 2), "utf8");
  return filePath;
}

/**
 * Save a buyer-perspective audit JSON file.
 * Contains: buyer's vLEI verification of seller, IPEX admit data,
 * DD decision analysis, and full negotiation trail.
 */
export function saveBuyerAuditJSON(
  state: BuyerNegotiationState,
  opts: {
    ddOffered:      boolean;
    ddDecision?:    "AUTO_ACCEPT" | "AUTO_REJECT" | "ESCALATED_TO_CPO";
    ddOriginalTotal?:   number;
    ddDiscountedTotal?: number;
    ddSavingAmount?:    number;
    ddAppliedRate?:     number;
    ddSettlementDate?:  string;
    ddDueDate?:         string;
    ddActusStatus?:     "SUCCESS" | "FAILED";
    paymentTerms:       string;
  }
): string {
  if (!fs.existsSync(ESCALATIONS_DIR)) fs.mkdirSync(ESCALATIONS_DIR, { recursive: true });

  const audit: NegotiationAudit = {
    negotiationId: state.negotiationId,
    timestamp:     new Date().toISOString(),
    outcome:       state.status,
    perspective:   "BUYER",

    parties: {
      seller: {
        agentName:       "jupiterSellerAgent",
        agentAID:        state.vleiVerification?.agentAID,
        oorHolderName:   state.vleiVerification?.oorHolderName,
        legalEntityName: state.vleiVerification?.legalEntityName ?? "JUPITER KNITTING COMPANY",
        lei:             state.vleiVerification?.lei ?? "3358004DXAMRWRUIYJ05",
      },
      buyer: {
        agentName:       "tommyBuyerAgent",
        legalEntityName: "TOMMY HILFIGER EUROPE B.V.",
        lei:             "54930012QJWZMYHNJW95",
      },
    },

    vleiVerification: state.vleiVerification ? {
      buyerVerifiedSeller: state.vleiVerification,
    } : undefined,

    negotiation: {
      rounds:         state.history,
      roundsUsed:     state.currentRound,
      maxRounds:      state.maxRounds,
      finalPrice:     state.agreedPrice,
      quantity:       state.targetQuantity,
      totalDealValue: state.totalCost,
      deliveryDate:   state.deliveryDate,
      paymentTerms:   opts.paymentTerms,
    },

    invoice: state.ipexInvoice ? {
      invoiceId: state.ipexInvoice.invoiceId,
      subtotal:  0,
      tax:       0,
      total:     0,
      ipex:      state.ipexInvoice,
    } : undefined,

    dynamicDiscounting: opts.ddOffered ? {
      offered:         true,
      decision:        opts.ddDecision,
      originalTotal:   opts.ddOriginalTotal,
      discountedTotal: opts.ddDiscountedTotal,
      savingAmount:    opts.ddSavingAmount,
      appliedRate:     opts.ddAppliedRate,
      settlementDate:  opts.ddSettlementDate,
      dueDate:         opts.ddDueDate,
      ipex:            state.ipexDDInvoice,
    } : { offered: false },

    marketData: state.marketSnapshot,
  };

  const filePath = path.join(ESCALATIONS_DIR, `${state.negotiationId}_audit_BUYER.json`);
  fs.writeFileSync(filePath, JSON.stringify(audit, null, 2), "utf8");
  return filePath;
}
