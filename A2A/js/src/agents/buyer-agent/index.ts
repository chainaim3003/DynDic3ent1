// ================= BUYER AGENT — AUTONOMOUS DD DECISION =================
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

import {
  AgentCard,
  TaskStatusUpdateEvent,
  Message,
  MessageSendParams,
} from "@a2a-js/sdk";

import {
  InMemoryTaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";

import { A2AExpressApp } from "@a2a-js/sdk/server/express";
import { A2AClient } from "@a2a-js/sdk/client";

import {
  BuyerNegotiationState,
  NegotiationDecision,
  OfferData,
  CounterOfferData,
  AcceptanceData,
  EscalationNoticeData,
  PurchaseOrderData,
  NegotiationData,
  DDOfferData,
  DDAcceptData,
  DDInvoiceData,
} from "../../shared/negotiation-types.js";

import { computeLinearDiscount } from "../../shared/dd-calculator.js";
import { LLMNegotiationClient, LLMPromptContext } from "../../shared/llm-client.js";
import { NegotiationLogger, logInternal, suppressSDKNoise } from "../../shared/logger.js";
import { SSEBroadcaster } from "../../shared/sse-broadcaster.js";

// Module-level SSE broadcaster — shared across all requests
const sseBroadcaster = new SSEBroadcaster("buyer");
import {
  getMarketSnapshot,
  computeAdjustedSafetyFactor,
} from "../../shared/market-data-client.js";
import {
  verifyCounterparty,
  printVerificationResult,
  readAgentCardMetadata,
} from "../../shared/vlei-verification-client.js";

import { getMessageSigner } from "../../messaging/index.js";
import type { SealedMessage } from "../../messaging/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
suppressSDKNoise();

// ================= BUYER AGENT CONFIGURATION =================
const BUYER_CONFIG = {
  maxBudget:    400,
  targetQuantity: 2000,
  maxRounds:    3,
  initialOfferRange: { min: 250, max: 320 },
  targetPrice:  330,
  strategyParams: { aggressiveness: 0.6, riskTolerance: 0.7 },
};

// ================= AUTONOMOUS DD CONFIGURATION =================
const BUYER_DD_CONFIG = {
  // Tommy Buyer's internal cost of capital / hurdle rate for early payment
  costOfCapital:  0.08,   // 8 % p.a.
  // If annualized discount is within ±1% of costOfCapital → escalate to CPO
  escalationBand: 0.01,   // 1 %
};

// ================= BUYER AGENT EXECUTOR =================
class BuyerAgentExecutor implements AgentExecutor {
  private negotiations = new Map<string, BuyerNegotiationState>();
  private loggers      = new Map<string, NegotiationLogger>();
  private llmClient:     LLMNegotiationClient;

  constructor() {
    this.llmClient = new LLMNegotiationClient();
  }

  async cancelTask(taskId: string): Promise<void> {
    logInternal(`Task cancellation requested: ${taskId}`);
  }

  // ================= MAIN EXECUTION =================
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const taskId    = ctx.task?.id        || uuidv4();
    const contextId = ctx.task?.contextId || uuidv4();

    const textInput = ctx.userMessage.parts
      .filter((p) => p.kind === "text")
      .map((p) => (p as any).text)
      .join(" ")
      .toLowerCase();

    const dataParts = ctx.userMessage.parts.filter((p) => p.kind === "data");

    if (textInput.includes("start negotiation")) {
      const match     = textInput.match(/start negotiation\s+(\d+)/);
      const userPrice = match ? parseInt(match[1], 10) : undefined;
      await this.startNegotiation(contextId, bus, taskId, userPrice);
      return;
    }

    if (dataParts.length > 0) {
      const rawData = (dataParts[0] as any).data as NegotiationData | SealedMessage<NegotiationData>;

      // Iteration 2: verify the envelope before dispatching. Same backward-
      // compatibility behavior as the seller — sealed messages take the path,
      // unsealed messages log a warning and pass through.
      let actual: NegotiationData;
      if (rawData && (rawData as any).envelope && (rawData as any).payload) {
        const sealed = rawData as SealedMessage<NegotiationData>;
        const signer = getMessageSigner();
        const result = signer.verify(sealed, "tommyBuyerAgent");
        if (!result.valid) {
          logInternal(
            `[envelope] ❌ REJECTED message from ${sealed.envelope?.senderAgentId ?? "?"} ` +
            `reason=${result.reason} detail=${result.detail}`
          );
          this.respond(bus, taskId, contextId,
            `❌ Message rejected: ${result.reason} — ${result.detail}`
          );
          return;
        }
        logInternal(
          `[envelope] ✓ verified hash-envelope from ${sealed.envelope.senderAgentId} counter=${sealed.envelope.counter} ` +
          `payloadHash=${sealed.envelope.payloadHash.slice(0,12)}... type=${sealed.payload.type} ` +
          `(plain mode — NOT a KERI signature check)`
        );
        actual = sealed.payload;
      } else {
        logInternal(`[envelope] ⚠ received UNSEALED message type=${(rawData as any)?.type} — chain has a gap`);
        actual = rawData as NegotiationData;
      }

      await this.handleSellerMessage(actual, contextId, bus, taskId);
      return;
    }

    this.respond(bus, taskId, contextId, "🛒 Buyer Agent Ready. Send 'start negotiation' to begin.");
  }

  // ================= START NEGOTIATION =================
  private async startNegotiation(
    contextId: string,
    bus:       ExecutionEventBus,
    taskId:    string,
    userPrice?: number
  ) {
    const negotiationId = `NEG-${Date.now()}`;
    const logger        = new NegotiationLogger(negotiationId, "BUYER");
    this.loggers.set(negotiationId, logger);
    logger.printSessionHeader(contextId);

    // ── Identity verification BEFORE negotiation starts ──────────────────────
    // Honest message: in plain mode we are doing a GLEIF-only check, NOT vLEI.
    const mode = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase();
    const verifyingMsg = mode === "vlei"
      ? "🔐 Verifying seller's vLEI delegation chain (CREDENTIAL_MODE=vlei) — please wait..."
      : "🔎 Identity check on seller (CREDENTIAL_MODE=plain — GLEIF only, no KERI/vLEI delegation) — please wait...";
    logInternal(`[identity] mode=${mode} — verifying jupiterSellerAgent`);
    this.respond(bus, taskId, contextId, verifyingMsg);
    const vLEIResult   = await verifyCounterparty("buyer", "DEEP-EXT");
    const sellerMeta   = readAgentCardMetadata("jupiterSellerAgent");
    printVerificationResult(vLEIResult, sellerMeta);

    if (!vLEIResult.verified) {
      this.respond(
        bus, taskId, contextId,
        `❌ Identity verification FAILED — cannot proceed with negotiation.\nReason: ${vLEIResult.error ?? "Seller delegation could not be verified"}`
      );
      return;
    }
    const verifiedMsg = vLEIResult.verificationType === "DISABLED"
      ? `✓ Seller plain-mode identity check passed (NOT vLEI — GLEIF + agent card only) — proceeding`
      : `✅ Seller vLEI delegation chain verified (${vLEIResult.verificationScript}) — proceeding`;
    this.respond(bus, taskId, contextId, verifiedMsg);
    // ─────────────────────────────────────────────────────────────────────────

    const initialOffer = userPrice ?? this.generateInitialOffer();
    logInternal(userPrice
      ? `Using user-specified price: ₹${initialOffer}`
      : `Generated random initial price: ₹${initialOffer}`);

    const state: BuyerNegotiationState = {
      negotiationId,
      contextId,
      status:         "INITIATED",
      targetQuantity: BUYER_CONFIG.targetQuantity,
      maxBudget:      BUYER_CONFIG.maxBudget,
      deliveryDate:   this.getDeliveryDate(),
      currentRound:   1,
      maxRounds:      BUYER_CONFIG.maxRounds,
      history:        [],
      lastBuyerOffer: initialOffer,
      strategyParams: {
        ...BUYER_CONFIG.strategyParams,
        initialOfferRange: BUYER_CONFIG.initialOfferRange,
      },
    };

    this.negotiations.set(negotiationId, state);
    logger.printRoundHeader(1, BUYER_CONFIG.maxRounds);

    const offerData: OfferData = {
      type: "OFFER", negotiationId,
      round: 1, timestamp: new Date().toISOString(),
      pricePerUnit: initialOffer, quantity: BUYER_CONFIG.targetQuantity,
      from: "BUYER", deliveryDate: state.deliveryDate,
    };

    logger.log({ round: 1, messageType: "OFFER", from: "BUYER",
      offeredPrice: initialOffer, decision: "OFFER",
      reasoning: `Opening at ₹${initialOffer}, leaving negotiation room` });

    state.history.push({ round: 1, buyerOffer: initialOffer,
      buyerAction: "OFFER", timestamp: new Date().toISOString() });

    await this.sendToSeller(offerData, contextId);
    this.respond(bus, taskId, contextId,
      `✓ Negotiation started\nInitial offer: ₹${initialOffer}/fabric unit  |  Qty: ${BUYER_CONFIG.targetQuantity} fabric units\nWaiting for seller response...`);
  }

  // ================= HANDLE SELLER MESSAGES =================
  private async handleSellerMessage(
    data: NegotiationData, contextId: string,
    bus: ExecutionEventBus, taskId: string
  ) {
    const negotiationId = data.negotiationId || (data as any).negotiationId;
    const state  = this.negotiations.get(negotiationId);
    const logger = this.loggers.get(negotiationId);

    if (data.type === "DD_OFFER") {
      await this.handleDDOffer(data as DDOfferData, state, logger, bus, taskId, contextId);
      return;
    }
    if (data.type === "DD_INVOICE") {
      await this.handleDDInvoice(data as DDInvoiceData, state, logger, bus, taskId, contextId);
      return;
    }
    if (data.type === "INVOICE") {
      // ── IPEX: admit the invoice credential the seller granted ──
      try {
        logInternal(`[IPEX] Admitting invoice credential from seller (${(data as any).invoiceId})...`);
        const admitResp = await fetch("http://localhost:4000/api/buyer/ipex/admit", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            senderAgent: "jupiterSellerAgent",
            invoiceId:   (data as any).invoiceId,
          }),
        });
        const admitData = await admitResp.json() as any;
        if (admitData.success) logInternal(`[IPEX] ✅ Invoice credential admitted — SAID: ${admitData.admitSAID}`);
        else                   logInternal(`[IPEX] ⚠ Invoice credential admit failed: ${admitData.error ?? "unknown"}`);
      } catch (ipexErr: any) {
        logInternal(`[IPEX] ⚠ Invoice IPEX admit error: ${ipexErr?.message ?? ipexErr}`);
      }
      return;
    }
    if (!state || !logger) { logInternal(`Negotiation state not found: ${negotiationId}`); return; }

    if (data.type === "ACCEPT_OFFER")
      return this.handleSellerAcceptance(data as AcceptanceData, state, logger, bus, taskId, contextId);
    if (data.type === "COUNTER_OFFER")
      return this.handleSellerCounterOffer(data as CounterOfferData, state, logger, bus, taskId, contextId);
    if (data.type === "REJECT_OFFER") {
      logger.log({ round: state.currentRound, messageType: "REJECT", from: "SELLER",
        decision: "REJECT", reasoning: (data as any).reason });
      state.status = "REJECTED";
      logger.printNegotiationSummary("FAILED",
        { roundsUsed: state.currentRound, maxRounds: state.maxRounds, quantity: state.targetQuantity });
      this.respond(bus, taskId, contextId, "✗ Negotiation failed — Seller rejected offer");
    }
  }

  // ================= HANDLE SELLER ACCEPTANCE =================
  private async handleSellerAcceptance(
    data: AcceptanceData, state: BuyerNegotiationState,
    logger: NegotiationLogger, bus: ExecutionEventBus, taskId: string, contextId: string
  ) {
    if (state.status === "COMPLETED" || state.status === "ACCEPTED") {
      logInternal(`Bilateral acceptance received — deal already closed at ₹${state.agreedPrice}`);
      return;
    }

    logger.log({ round: state.currentRound, messageType: "ACCEPT", from: "SELLER",
      offeredPrice: data.acceptedPrice, decision: "ACCEPT", reasoning: "Seller accepted our offer" });

    state.agreedPrice = data.acceptedPrice;
    state.totalCost   = data.acceptedPrice * state.targetQuantity;
    state.status      = "ACCEPTED";

    await this.sendToSeller({
      type: "ACCEPT_OFFER", negotiationId: state.negotiationId,
      round: state.currentRound, timestamp: new Date().toISOString(),
      acceptedPrice: data.acceptedPrice, from: "BUYER",
      finalTerms: { pricePerUnit: data.acceptedPrice, quantity: state.targetQuantity,
        totalAmount: state.totalCost, deliveryDate: state.deliveryDate },
    } as AcceptanceData, contextId);

    await this.sendPurchaseOrder(state, logger, contextId);

    const buyerStart  = state.history[0]?.buyerOffer;
    const sellerStart = state.history[0]?.sellerOffer;

    logger.printNegotiationSummary("COMPLETED", {
      roundsUsed: state.currentRound, maxRounds: state.maxRounds,
      finalPrice: data.acceptedPrice, buyerStartPrice: buyerStart,
      sellerStartPrice: sellerStart, totalCost: state.totalCost, quantity: state.targetQuantity,
    });

    state.status = "COMPLETED";

    const reportPath = logger.saveSuccessReport({
      finalPrice: data.acceptedPrice, quantity: state.targetQuantity,
      totalDealValue: state.totalCost!, deliveryDate: state.deliveryDate,
      paymentTerms: "Net 30", roundsUsed: state.currentRound, maxRounds: state.maxRounds,
      logs: logger.getLogs(), buyerStartPrice: buyerStart, sellerStartPrice: sellerStart,
    });
    logger.printSuccessNotice(data.acceptedPrice, state.totalCost!, reportPath);

    // Iteration 3: parallel JSON audit + outcome-quality metrics.
    const sellerMetaForAudit = readAgentCardMetadata("jupiterSellerAgent");
    const buyerMetaForAudit  = readAgentCardMetadata("tommyBuyerAgent");
    const auditPath = logger.saveAuditJson({
      outcome:         "success",
      finalPrice:      data.acceptedPrice,
      quantity:        state.targetQuantity,
      deliveryDate:    state.deliveryDate,
      paymentTerms:    "Net 30",
      roundsUsed:      state.currentRound,
      maxRounds:       state.maxRounds,
      logs:            logger.getLogs(),
      counterpartyLEI:        sellerMetaForAudit?.lei,
      counterpartyEntityName: sellerMetaForAudit?.legalEntityName,
      ownLEI:                 buyerMetaForAudit?.lei,
      ownEntityName:          buyerMetaForAudit?.legalEntityName,
      credentialMode:         (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain",
      outcomeQualityInputs: {
        closed:        true,
        closedPrice:   data.acceptedPrice,
        buyerMax:      BUYER_CONFIG.maxBudget,
        sellerMin:     350,  // buyer knows seller floor from previous bilateral demo; iter-4 fixes this via PO disclosure
        quantity:      state.targetQuantity,
        currency:      "INR",
      },
    });
    logInternal(`[audit] JSON written: ${auditPath}`);

    this.respond(bus, taskId, contextId,
      `✓✓ Deal Closed!\n\nFinal Price : ₹${data.acceptedPrice}/fabric unit\nTotal       : ₹${state.totalCost?.toLocaleString()}\nPurchase Order sent to seller.`);
  }

  // ================= HANDLE SELLER COUNTER OFFER =================
  private async handleSellerCounterOffer(
    data: CounterOfferData, state: BuyerNegotiationState,
    logger: NegotiationLogger, bus: ExecutionEventBus, taskId: string, contextId: string
  ) {
    state.lastSellerOffer = data.pricePerUnit;
    const priceMovement        = data.pricePerUnit - data.previousPrice;
    const priceMovementPercent = (priceMovement / data.previousPrice) * 100;

    logger.log({ round: state.currentRound, messageType: "COUNTER_OFFER", from: "SELLER",
      offeredPrice: data.pricePerUnit, previousPrice: data.previousPrice,
      priceMovement, priceMovementPercent, decision: "COUNTER_OFFER", reasoning: data.reasoning });

    const h = state.history.find((r) => r.round === state.currentRound);
    if (h) { h.sellerOffer = data.pricePerUnit; h.sellerAction = "COUNTER_OFFER"; }

    state.currentRound += 1;

    if (state.currentRound > state.maxRounds) {
      await this.escalateToHuman(state, logger, bus, taskId, contextId);
      return;
    }

    logger.printRoundHeader(state.currentRound, state.maxRounds);
    const decision = await this.makeNegotiationDecision(state);

    if (decision.action === "ACCEPT") {
      await this.sendAcceptance(state, logger, contextId);
      await this.sendPurchaseOrder(state, logger, contextId);

      const buyerStart  = state.history[0]?.buyerOffer;
      const sellerStart = state.history[0]?.sellerOffer;

      logger.printNegotiationSummary("COMPLETED", {
        roundsUsed: state.currentRound, maxRounds: state.maxRounds,
        finalPrice: data.pricePerUnit, buyerStartPrice: buyerStart,
        sellerStartPrice: sellerStart, totalCost: data.pricePerUnit * state.targetQuantity,
        quantity: state.targetQuantity,
      });

      state.status = "COMPLETED";

      const reportPath = logger.saveSuccessReport({
        finalPrice: data.pricePerUnit, quantity: state.targetQuantity,
        totalDealValue: data.pricePerUnit * state.targetQuantity,
        deliveryDate: state.deliveryDate, paymentTerms: "Net 30",
        roundsUsed: state.currentRound, maxRounds: state.maxRounds,
        logs: logger.getLogs(), buyerStartPrice: buyerStart, sellerStartPrice: sellerStart,
      });
      logger.printSuccessNotice(data.pricePerUnit, data.pricePerUnit * state.targetQuantity, reportPath);

      // Iteration 3: parallel JSON audit + outcome-quality metrics.
      const sellerMetaForAudit2 = readAgentCardMetadata("jupiterSellerAgent");
      const buyerMetaForAudit2  = readAgentCardMetadata("tommyBuyerAgent");
      const auditPath2 = logger.saveAuditJson({
        outcome:         "success",
        finalPrice:      data.pricePerUnit,
        quantity:        state.targetQuantity,
        deliveryDate:    state.deliveryDate,
        paymentTerms:    "Net 30",
        roundsUsed:      state.currentRound,
        maxRounds:       state.maxRounds,
        logs:            logger.getLogs(),
        counterpartyLEI:        sellerMetaForAudit2?.lei,
        counterpartyEntityName: sellerMetaForAudit2?.legalEntityName,
        ownLEI:                 buyerMetaForAudit2?.lei,
        ownEntityName:          buyerMetaForAudit2?.legalEntityName,
        credentialMode:         (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain",
        outcomeQualityInputs: {
          closed:        true,
          closedPrice:   data.pricePerUnit,
          buyerMax:      BUYER_CONFIG.maxBudget,
          sellerMin:     350,
          quantity:      state.targetQuantity,
          currency:      "INR",
        },
      });
      logInternal(`[audit] JSON written: ${auditPath2}`);

      this.respond(bus, taskId, contextId,
        `✓✓ Deal Closed!\n\nFinal Price : ₹${data.pricePerUnit}/fabric unit\nTotal       : ₹${(data.pricePerUnit * state.targetQuantity).toLocaleString()}\nPurchase Order sent to seller.`);

    } else if (decision.action === "COUNTER") {
      await this.sendCounterOffer(state, decision.price!, decision.reasoning, logger, contextId);
      this.respond(bus, taskId, contextId,
        `↑ Counter-offer sent: ₹${decision.price}/fabric unit\nWaiting for seller response...`);
    } else {
      state.status = "REJECTED";
      this.respond(bus, taskId, contextId, "✗ Offer rejected — exceeds budget");
    }
  }

  // ================= AUTONOMOUS DD DECISION =================
  /**
   * Receives a DD_OFFER and decides autonomously — no human input required.
   *
   * Decision logic:
   *   annualizedDiscount = maxDiscountRate × (365 / totalDays)
   *   (For linear DD, this is constant regardless of which day buyer pays — so
   *    the comparison to costOfCapital is done once, not per date.)
   *
   *   diff = annualizedDiscount − costOfCapital
   *   diff > +escalationBand  →  AUTO-ACCEPT  at optimal date (invoiceDate = max saving)
   *   diff < −escalationBand  →  AUTO-REJECT  (pay full amount on due date)
   *   |diff| ≤ escalationBand →  ESCALATE TO CPO (borderline, human call)
   */
  private async handleDDOffer(
    data:    DDOfferData,
    state:   BuyerNegotiationState | undefined,
    logger:  NegotiationLogger | undefined,
    bus:     ExecutionEventBus,
    taskId:  string,
    contextId: string
  ) {
    const MS_PER_DAY = 86_400_000;
    const totalDays  = Math.max(1, Math.round(
      (new Date(data.dueDate).getTime() - new Date(data.invoiceDate).getTime()) / MS_PER_DAY
    ));

    // L4: use live effectiveBorrowingRate (SOFR + spread) instead of static 8%
    const market = await getMarketSnapshot();
    const coc    = market.effectiveBorrowingRate;  // live, not BUYER_DD_CONFIG.costOfCapital
    const annualizedDiscount = data.maxDiscountRate * (365 / totalDays);
    const diff   = annualizedDiscount - coc;

    const annPct = (annualizedDiscount * 100).toFixed(2);
    const cocPct = (coc * 100).toFixed(2);
    const maxPct = (data.maxDiscountRate * 100).toFixed(3);

    // ── Broadcast DD offer to UI so buyer chat shows it ──────────────────────
    sseBroadcaster.broadcast(
      [
        `💰 Dynamic Discount Offer`,
        ``,
        `Invoice          : ${data.invoiceId}`,
        `Invoice date     : ${data.invoiceDate}`,
        `Due date         : ${data.dueDate}`,
        `Full amount      : ₹${data.originalTotal.toLocaleString()}`,
        `Max DD rate      : ${maxPct}%`,
        `Pay by ${data.proposedSettlementDate}  (${data.discountAtProposedDate.daysEarly} days early)`,
        `→ ₹${data.discountAtProposedDate.discountedAmount.toLocaleString()}  (save ₹${data.discountAtProposedDate.savingAmount.toLocaleString()} @ ${(data.discountAtProposedDate.appliedRate * 100).toFixed(3)}%)`,
        `DD OFFER RECEIVED`,
      ].join("\n")
    );

    console.log("");
    console.log(`  \x1b[36m\x1b[1m  🤖  AUTONOMOUS DD DECISION ENGINE\x1b[0m`);
    console.log(`  \x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m`);
    console.log(`  \x1b[2m  Invoice      : ${data.invoiceId}\x1b[0m`);
    console.log(`  \x1b[2m  Invoice date : ${data.invoiceDate}   Due date: ${data.dueDate}  (${totalDays} days)\x1b[0m`);
    console.log(`  \x1b[2m  Max DD rate  : ${maxPct}%  (linear)\x1b[0m`);
    console.log(`  \x1b[1m  Annualized discount : ${annPct}%  (= ${maxPct}% × 365/${totalDays})\x1b[0m`);
    console.log(`  \x1b[1m  Cost of capital     : ${cocPct}%\x1b[0m`);
    console.log(`  \x1b[2m  Difference          : ${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(2)}%\x1b[0m`);

    if (Math.abs(diff) <= BUYER_DD_CONFIG.escalationBand) {
      console.log(`  \x1b[33m\x1b[1m  ⚠  Within ±1% band → ESCALATING TO CPO\x1b[0m`);
      await this.escalateDDToCPO(data, annualizedDiscount, totalDays, state, contextId, bus, taskId);
    } else if (diff > BUYER_DD_CONFIG.escalationBand) {
      console.log(`  \x1b[32m\x1b[1m  ✓  Annualized discount (${annPct}%) > CoC (${cocPct}%) → AUTO-ACCEPT\x1b[0m`);
      await this.autoAcceptDD(data, annualizedDiscount, totalDays, state, contextId, bus, taskId);
    } else {
      console.log(`  \x1b[31m\x1b[1m  ✗  Annualized discount (${annPct}%) < CoC (${cocPct}%) → AUTO-REJECT\x1b[0m`);
      await this.autoRejectDD(data, annualizedDiscount, state, contextId, bus, taskId);
    }

    console.log(`  \x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m`);
    console.log("");
  }

  // ── AUTO-ACCEPT: choose optimal settlement date (invoiceDate = max saving) ──
  private async autoAcceptDD(
    data:              DDOfferData,
    annualizedDiscount: number,
    totalDays:         number,
    state:             BuyerNegotiationState | undefined,
    contextId:         string,
    bus:               ExecutionEventBus,
    taskId:            string
  ) {
    // Optimal settlement = invoiceDate (earliest = maximum daysEarly = maximum saving)
    const optimalDate = data.invoiceDate;
    const optResult   = computeLinearDiscount(
      data.originalTotal, data.maxDiscountRate,
      data.invoiceDate, data.dueDate, optimalDate
    );

    const annPct  = (annualizedDiscount * 100).toFixed(2);
    const ratePct = (optResult.appliedRate * 100).toFixed(3);

    console.log(`  \x1b[2m  Optimal date  : ${optimalDate}  (${optResult.daysEarly}/${totalDays} days early — maximum saving)\x1b[0m`);
    console.log(`  \x1b[2m  Applied rate  : ${ratePct}%\x1b[0m`);
    console.log(`  \x1b[32m\x1b[1m  Payable       : ₹${optResult.discountedAmount.toLocaleString()}  (save ₹${optResult.savingAmount.toLocaleString()})\x1b[0m`);

    if (state) state.status = "DD_COMPLETED";

    const ddAccept: DDAcceptData = {
      type:                 "DD_ACCEPT",
      invoiceId:            data.invoiceId,
      negotiationId:        data.negotiationId,
      chosenSettlementDate: optimalDate,
      from:                 "BUYER",
    };

    logInternal(`Auto-accepted DD — invoiceId: ${data.invoiceId}  settlement: ${optimalDate}  saving: ₹${optResult.savingAmount.toLocaleString()}`);

    // ── Broadcast DD AUTO-ACCEPTED to UI *before* the blocking sendToSeller so
    //    the SSE timestamp is earlier than the DD Invoice the seller will emit.
    const ddAcceptedText = [
      `🤖 DD AUTO-ACCEPTED`,
      ``,
      `  Decision basis   : Annualized discount ${annPct}% > CoC ${(BUYER_DD_CONFIG.costOfCapital * 100).toFixed(2)}%`,
      `  Optimal date     : ${optimalDate}  (${optResult.daysEarly} days early — max saving)`,
      `  Applied rate     : ${ratePct}%`,
      `  Original amount  : ₹${data.originalTotal.toLocaleString()}`,
      `  Payable          : ₹${optResult.discountedAmount.toLocaleString()}`,
      `  Saving           : ₹${optResult.savingAmount.toLocaleString()}`,
      ``,
    ].join("\n");
    sseBroadcaster.broadcast(ddAcceptedText);        // ← timestamp recorded HERE (before ACTUS)

    await this.sendToSeller(ddAccept, contextId);   // seller runs ACTUS here (5-15 s)

    this.respond(bus, taskId, contextId, ddAcceptedText, true); // bus-only (SSE already sent)
  }

  // ── AUTO-REJECT: annualized discount below cost of capital ──────────────────
  private async autoRejectDD(
    data:              DDOfferData,
    annualizedDiscount: number,
    state:             BuyerNegotiationState | undefined,
    contextId:         string,
    bus:               ExecutionEventBus,
    taskId:            string
  ) {
    const annPct = (annualizedDiscount * 100).toFixed(2);
    const cocPct = (BUYER_DD_CONFIG.costOfCapital * 100).toFixed(2);

    if (state) state.status = "COMPLETED";

    logInternal(`Auto-rejected DD — annualized ${annPct}% < CoC ${cocPct}% — full payment on ${data.dueDate}`);

    this.respond(bus, taskId, contextId,
      [
        `🤖 DD AUTO-REJECTED`,
        ``,
        `  Decision basis   : Annualized discount ${annPct}% < CoC ${cocPct}%`,
        `  Early payment does not justify the opportunity cost.`,
        `  Full payment of ₹${data.originalTotal.toLocaleString()} due on ${data.dueDate}.`,
        ``,
        `Workflow complete.`,
      ].join("\n"));
  }

  // ── ESCALATE TO CPO: borderline — within ±1% of cost of capital ─────────────
  private async escalateDDToCPO(
    data:              DDOfferData,
    annualizedDiscount: number,
    totalDays:         number,
    state:             BuyerNegotiationState | undefined,
    contextId:         string,
    bus:               ExecutionEventBus,
    taskId:            string
  ) {
    const annPct  = (annualizedDiscount * 100).toFixed(2);
    const cocPct  = (BUYER_DD_CONFIG.costOfCapital * 100).toFixed(2);
    const bandPct = (BUYER_DD_CONFIG.escalationBand * 100).toFixed(0);
    const maxPct  = (data.maxDiscountRate * 100).toFixed(3);
    const now     = new Date();

    if (state) state.status = "ESCALATED";

    // ── Write CPO escalation report (.txt) ────────────────────────────────────
    const escalationsDir = path.resolve(__dirname, "..", "..", "escalations");
    if (!fs.existsSync(escalationsDir)) fs.mkdirSync(escalationsDir, { recursive: true });

    const reportFile = path.join(escalationsDir, `${data.negotiationId}_DD_CPO_escalation.txt`);
    const hr = "─".repeat(60);
    const lines: string[] = [];

    lines.push("╔══════════════════════════════════════════════════════════════╗");
    lines.push("║        DD ESCALATION REPORT — CHIEF PROCUREMENT OFFICER     ║");
    lines.push("╚══════════════════════════════════════════════════════════════╝");
    lines.push("");
    lines.push(`Negotiation ID   : ${data.negotiationId}`);
    lines.push(`Invoice ID       : ${data.invoiceId}`);
    lines.push(`Date / Time      : ${now.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} ${now.toLocaleTimeString()}`);
    lines.push(`Status           : BORDERLINE — autonomous decision withheld`);
    lines.push("");
    lines.push(hr);
    lines.push("INVOICE DETAILS");
    lines.push(hr);
    lines.push(`Invoice date     : ${data.invoiceDate}`);
    lines.push(`Due date         : ${data.dueDate}  (${totalDays} days)`);
    lines.push(`Full amount      : Rs.${data.originalTotal.toLocaleString()}`);
    lines.push(`Max DD rate      : ${maxPct}%  (linear discount)`);
    lines.push("");
    lines.push(hr);
    lines.push("DECISION ANALYSIS");
    lines.push(hr);
    lines.push(`Annualized discount  : ${annPct}%   (= ${maxPct}% × 365/${totalDays})`);
    lines.push(`Cost of capital      : ${cocPct}%`);
    lines.push(`Difference           : ${((annualizedDiscount - BUYER_DD_CONFIG.costOfCapital) * 100).toFixed(2)}%`);
    lines.push(`Escalation band      : ±${bandPct}%`);
    lines.push(`Reason               : Annualized discount within ±${bandPct}% of CoC — borderline`);
    lines.push("");
    lines.push(hr);
    lines.push("SELLER'S PROPOSAL");
    lines.push(hr);
    lines.push(`Proposed settlement  : ${data.proposedSettlementDate}  (${data.discountAtProposedDate.daysEarly} days early)`);
    lines.push(`Applied rate         : ${(data.discountAtProposedDate.appliedRate * 100).toFixed(3)}%`);
    lines.push(`Discounted amount    : Rs.${data.discountAtProposedDate.discountedAmount.toLocaleString()}`);
    lines.push(`Saving               : Rs.${data.discountAtProposedDate.savingAmount.toLocaleString()}`);
    lines.push("");
    lines.push(hr);
    lines.push("CPO ACTION REQUIRED");
    lines.push(hr);
    lines.push("Annualized discount is within 1% of cost of capital.");
    lines.push("Autonomous agent deferred. Please choose:");
    lines.push("");
    lines.push(`  A)  ACCEPT at seller's proposed date (${data.proposedSettlementDate})`);
    lines.push(`      → Pay Rs.${data.discountAtProposedDate.discountedAmount.toLocaleString()}  (save Rs.${data.discountAtProposedDate.savingAmount.toLocaleString()})`);
    lines.push(`  B)  ACCEPT at invoice date (${data.invoiceDate})  — maximum saving`);

    // Compute max saving option
    const maxResult = computeLinearDiscount(
      data.originalTotal, data.maxDiscountRate,
      data.invoiceDate, data.dueDate, data.invoiceDate
    );
    lines.push(`      → Pay Rs.${maxResult.discountedAmount.toLocaleString()}  (save Rs.${maxResult.savingAmount.toLocaleString()})`);
    lines.push(`  C)  REJECT — pay full Rs.${data.originalTotal.toLocaleString()} on ${data.dueDate}`);
    lines.push("");
    lines.push(hr);
    lines.push(`Generated : ${now.toISOString()}`);
    lines.push(hr);

    fs.writeFileSync(reportFile, lines.join("\n"), "utf8");

    logInternal(`DD escalated to CPO — annualized ${annPct}% within ±${bandPct}% of CoC ${cocPct}%`);
    logInternal(`CPO report saved → ${reportFile}`);

    this.respond(bus, taskId, contextId,
      [
        `🤖 DD ESCALATED TO CHIEF PROCUREMENT OFFICER`,
        ``,
        `  Annualized discount : ${annPct}%`,
        `  Cost of capital     : ${cocPct}%`,
        `  Difference          : ${((annualizedDiscount - BUYER_DD_CONFIG.costOfCapital) * 100).toFixed(2)}%  (within ±${bandPct}% band)`,
        ``,
        `  Too close to call autonomously.`,
        `  CPO report saved → ${reportFile}`,
      ].join("\n"));
  }

  // ================= HANDLE DD_INVOICE =================
  private async handleDDInvoice(
    data:    DDInvoiceData,
    state:   BuyerNegotiationState | undefined,
    logger:  NegotiationLogger | undefined,
    bus:     ExecutionEventBus,
    taskId:  string,
    contextId: string
  ) {
    // ── IPEX: admit the DD invoice credential the seller granted ──
    try {
      logInternal(`[IPEX] Admitting DD invoice credential from seller (${data.invoiceId})...`);
      const admitResp = await fetch("http://localhost:4000/api/buyer/ipex/admit", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderAgent: "jupiterSellerAgent",
          invoiceId:   data.invoiceId,
        }),
      });
      const admitData = await admitResp.json() as any;
      if (admitData.success) logInternal(`[IPEX] ✅ DD Invoice credential admitted — SAID: ${admitData.admitSAID}`);
      else                   logInternal(`[IPEX] ⚠ DD Invoice credential admit failed: ${admitData.error ?? "unknown"}`);
    } catch (ipexErr: any) {
      logInternal(`[IPEX] ⚠ DD Invoice IPEX admit error: ${ipexErr?.message ?? ipexErr}`);
    }

    const pct         = (data.appliedRate * 100).toFixed(3);
    const actusStatus = data.actusSimulationStatus === "SUCCESS" ? "✓" : "⚠";

    console.log("");
    console.log(`  \x1b[35m\x1b[1m  📄  DD INVOICE RECEIVED — FINAL\x1b[0m`);
    console.log(`  \x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m`);
    console.log(`  \x1b[2m  Invoice ID   : ${data.invoiceId}\x1b[0m`);
    console.log(`  \x1b[2m  Original     : ₹${data.originalTotal.toLocaleString()}\x1b[0m`);
    console.log(`  \x1b[1m  Applied Rate →  ${pct}%\x1b[0m`);
    console.log(`  \x1b[32m\x1b[1m  PAYABLE      →  ₹${data.discountedTotal.toLocaleString()}  (saved ₹${data.savingAmount.toLocaleString()})\x1b[0m`);
    console.log(`  \x1b[1m  Settle by   →  ${data.settlementDate}\x1b[0m`);
    console.log(`  \x1b[2m  ACTUS ID     : ${data.actusContractId}\x1b[0m`);
    console.log(`  \x1b[2m  ACTUS Status : ${actusStatus} ${data.actusSimulationStatus}${data.actusError ? " — " + data.actusError : ""}\x1b[0m`);
    console.log(`  \x1b[2m  ─────────────────────────────────────────────────────────\x1b[0m`);
    console.log("");
    console.log(`  \x1b[32m\x1b[1m  ✅  END-TO-END WORKFLOW COMPLETE\x1b[0m`);
    console.log(`  \x1b[2m  Negotiation → Invoice → Dynamic Discounting → ACTUS\x1b[0m`);
    console.log("");

    if (state) state.status = "DD_COMPLETED";

    // Small delay so seller's "DD Invoice dispatched" SSE arrives before this "received" broadcast
    await new Promise(resolve => setTimeout(resolve, 300));

    this.respond(bus, taskId, contextId,
      `✅ DD Invoice received!\n\nOriginal   : ₹${data.originalTotal.toLocaleString()}\nDiscounted : ₹${data.discountedTotal.toLocaleString()}  (${pct}% off)\nSaving     : ₹${data.savingAmount.toLocaleString()}\nSettle by  : ${data.settlementDate}\nACTUS      : ${actusStatus} ${data.actusSimulationStatus}\n\n🎉 End-to-end workflow complete!`);
  }

  // ================= ESCALATE NEGOTIATION TO HUMAN =================
  private async escalateToHuman(
    state: BuyerNegotiationState, logger: NegotiationLogger,
    bus: ExecutionEventBus, taskId: string, contextId: string
  ) {
    state.status = "ESCALATED";
    const buyerFinalOffer  = state.lastBuyerOffer!;
    const sellerFinalOffer = state.lastSellerOffer!;
    const gap              = sellerFinalOffer - buyerFinalOffer;

    const reportPath = logger.saveEscalationReport({
      buyerFinalOffer, sellerFinalOffer, gap,
      rounds: state.maxRounds, maxRounds: state.maxRounds,
      quantity: state.targetQuantity, deliveryDate: state.deliveryDate,
      logs: logger.getLogs(),
    });

    logger.printEscalationNotice(buyerFinalOffer, sellerFinalOffer, gap, reportPath);

    // Iteration 3: parallel JSON audit for escalations too. closedPrice is
    // midpoint of the two final offers, since the gap was not bridged.
    const sellerMetaEsc = readAgentCardMetadata("jupiterSellerAgent");
    const buyerMetaEsc  = readAgentCardMetadata("tommyBuyerAgent");
    const auditPathEsc  = logger.saveAuditJson({
      outcome:         "escalation",
      finalPrice:      Math.round((buyerFinalOffer + sellerFinalOffer) / 2),
      quantity:        state.targetQuantity,
      deliveryDate:    state.deliveryDate,
      paymentTerms:    "Net 30",
      roundsUsed:      state.maxRounds,
      maxRounds:       state.maxRounds,
      logs:            logger.getLogs(),
      counterpartyLEI:        sellerMetaEsc?.lei,
      counterpartyEntityName: sellerMetaEsc?.legalEntityName,
      ownLEI:                 buyerMetaEsc?.lei,
      ownEntityName:          buyerMetaEsc?.legalEntityName,
      credentialMode:         (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain",
      outcomeQualityInputs: {
        closed:        false,
        closedPrice:   Math.round((buyerFinalOffer + sellerFinalOffer) / 2),
        buyerMax:      BUYER_CONFIG.maxBudget,
        sellerMin:     350,
        quantity:      state.targetQuantity,
        currency:      "INR",
      },
      extras: {
        buyerFinalOffer, sellerFinalOffer, gap,
      },
    });
    logInternal(`[audit] JSON written (escalation): ${auditPathEsc}`);

    await this.sendToSeller({
      type: "ESCALATION_NOTICE", negotiationId: state.negotiationId,
      round: state.maxRounds, timestamp: new Date().toISOString(),
      from: "BUYER", buyerFinalOffer, sellerFinalOffer, gap, reportPath,
    } as EscalationNoticeData, contextId);

    this.respond(bus, taskId, contextId,
      `⚠ Negotiation escalated to human review.\nGap of ₹${gap} remains after ${state.maxRounds} round(s).\nReport saved → ${reportPath}`);
  }

  // ================= HYBRID DECISION MAKING =================
  private async makeNegotiationDecision(state: BuyerNegotiationState): Promise<NegotiationDecision> {
    const llmDecision       = await this.getLLMDecision(state);
    const validatedDecision = this.applyBuyerConstraints(llmDecision, state);
    if (!validatedDecision) {
      logInternal("LLM decision invalid — using rule-based fallback");
      return this.ruleBasedDecision(state);
    }
    return validatedDecision;
  }

  private async getLLMDecision(state: BuyerNegotiationState): Promise<NegotiationDecision> {
    // L4: fetch live market data so LLM can reason about SOFR and borrowing cost
    const market = await getMarketSnapshot();
    const context: LLMPromptContext = {
      role: "BUYER", round: state.currentRound, maxRounds: state.maxRounds,
      lastOwnOffer: state.lastBuyerOffer, lastTheirOffer: state.lastSellerOffer,
      history: state.history,
      constraints: { maxBudget: state.maxBudget, quantity: state.targetQuantity },
      targetPrice: BUYER_CONFIG.targetPrice,
      marketContext: {
        sofrRate:               market.sofrRate,
        cottonPricePerLb:       market.cottonPricePerLb,
        effectiveBorrowingRate: market.effectiveBorrowingRate,
        sofrSource:             market.sofrSource,
      },
    };
    const r = await this.llmClient.getNegotiationDecision(context);
    return { action: r.action, price: r.price, reasoning: r.reasoning };
  }

  private applyBuyerConstraints(
    decision: NegotiationDecision, state: BuyerNegotiationState
  ): NegotiationDecision | null {
    if (decision.action === "ACCEPT" && state.lastSellerOffer && state.lastSellerOffer > state.maxBudget) {
      logInternal(`Cannot accept ₹${state.lastSellerOffer} — exceeds budget ₹${state.maxBudget}`);
      if (state.currentRound < state.maxRounds) {
        decision.action    = "COUNTER";
        decision.price     = Math.min(state.maxBudget, state.lastSellerOffer! - 10);
        decision.reasoning = "Seller price exceeds budget, making counter-offer";
      } else {
        decision.action    = "REJECT";
        decision.reasoning = "Price exceeds budget in final round";
      }
    }
    if (decision.action === "COUNTER") {
      if (!decision.price) { logInternal("Counter-offer missing price — falling back"); return null; }
      if (decision.price > state.maxBudget) {
        decision.price     = state.maxBudget;
        decision.reasoning += " (capped at budget)";
      }
      if (state.lastBuyerOffer && decision.price < state.lastBuyerOffer) {
        decision.price     = state.lastBuyerOffer + 5;
        decision.reasoning += " (increased from last offer)";
      }
      decision.price = Math.round(decision.price);
    }
    return decision;
  }

  private ruleBasedDecision(state: BuyerNegotiationState): NegotiationDecision {
    const sellerOffer = state.lastSellerOffer!;
    const lastBuyerOffer = state.lastBuyerOffer!;
    const thresholds: Record<number, number> = { 1: 340, 2: 360, 3: 380 };
    const threshold = thresholds[state.currentRound] ?? 380;

    if (sellerOffer <= threshold && sellerOffer <= state.maxBudget)
      return { action: "ACCEPT", reasoning: `Seller ₹${sellerOffer} meets round ${state.currentRound} threshold` };
    if (state.currentRound === state.maxRounds && sellerOffer <= state.maxBudget + 10)
      return { action: "ACCEPT", reasoning: "Final round — accepting near-budget offer" };

    const gap            = sellerOffer - lastBuyerOffer;
    const concessionRate = state.currentRound === 3 ? 0.6 : 0.4;
    const newOffer       = Math.min(Math.round(lastBuyerOffer + gap * concessionRate), state.maxBudget);
    return { action: "COUNTER", price: newOffer, reasoning: `Closing ${(concessionRate * 100).toFixed(0)}% of gap` };
  }

  // ================= SEND COUNTER OFFER =================
  private async sendCounterOffer(
    state: BuyerNegotiationState, price: number,
    reasoning: string, logger: NegotiationLogger, contextId: string
  ) {
    const priceMovement        = price - state.lastBuyerOffer!;
    const priceMovementPercent = (priceMovement / state.lastBuyerOffer!) * 100;
    const gap                  = state.lastSellerOffer! - price;
    const gapClosed            = gap > 0 ? (priceMovement / (state.lastSellerOffer! - state.lastBuyerOffer!)) * 100 : 0;

    logger.log({ round: state.currentRound, messageType: "COUNTER_OFFER", from: "BUYER",
      offeredPrice: price, previousPrice: state.lastBuyerOffer,
      priceMovement, priceMovementPercent, gap, gapClosed, decision: "COUNTER_OFFER", reasoning });

    state.lastBuyerOffer = price;
    state.history.push({ round: state.currentRound, buyerOffer: price,
      buyerAction: "COUNTER_OFFER", timestamp: new Date().toISOString(), reasoning });

    await this.sendToSeller({
      type: "COUNTER_OFFER", negotiationId: state.negotiationId,
      round: state.currentRound, timestamp: new Date().toISOString(),
      pricePerUnit: price, previousPrice: state.lastBuyerOffer!,
      from: "BUYER", reasoning,
    } as CounterOfferData, contextId);
  }

  // ================= SEND ACCEPTANCE =================
  private async sendAcceptance(
    state: BuyerNegotiationState, logger: NegotiationLogger, contextId: string
  ) {
    const acceptedPrice = state.lastSellerOffer!;
    const totalAmount   = acceptedPrice * state.targetQuantity;

    logger.log({ round: state.currentRound, messageType: "ACCEPT", from: "BUYER",
      offeredPrice: acceptedPrice, decision: "ACCEPT",
      reasoning: "Accepting seller's offer based on strategic analysis" });

    state.agreedPrice = acceptedPrice;
    state.totalCost   = totalAmount;
    state.status      = "ACCEPTED";

    await this.sendToSeller({
      type: "ACCEPT_OFFER", negotiationId: state.negotiationId,
      round: state.currentRound, timestamp: new Date().toISOString(),
      acceptedPrice, from: "BUYER",
      finalTerms: { pricePerUnit: acceptedPrice, quantity: state.targetQuantity,
        totalAmount, deliveryDate: state.deliveryDate },
    } as AcceptanceData, contextId);
  }

  // ================= SEND PURCHASE ORDER =================
  private async sendPurchaseOrder(
    state: BuyerNegotiationState, logger: NegotiationLogger, contextId: string
  ) {
    const poData: PurchaseOrderData = {
      type: "PURCHASE_ORDER", poId: `PO-${Date.now()}`,
      negotiationId: state.negotiationId, orderDate: new Date().toISOString(),
      terms: { pricePerUnit: state.agreedPrice!, quantity: state.targetQuantity, total: state.totalCost! },
      deliveryDate: state.deliveryDate,
    };
    logger.printPurchaseOrder(poData);

    // Broadcast structured PO details to UI via SSE
    sseBroadcaster.broadcast(
      `📝 PURCHASE ORDER\nPO ID    : ${poData.poId}\nNeg ID   : ${poData.negotiationId}\nDate     : ${poData.orderDate.split('T')[0]}\nPrice    : ₹${poData.terms.pricePerUnit}/fabric unit\nQty      : ${poData.terms.quantity} fabric units\nTotal    : ₹${poData.terms.total.toLocaleString()}\nDelivery : ${poData.deliveryDate}\nPurchase Order sent`
    );

    await this.sendToSeller(poData, contextId);
  }

  // ================= HELPERS =================
  private generateInitialOffer(): number {
    const { min, max } = BUYER_CONFIG.initialOfferRange;
    return Math.round(Math.random() * (max - min) + min);
  }

  private getDeliveryDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().split("T")[0];
  }

  private async sendToSeller(data: any, contextId: string): Promise<void> {
    try {
      const client = await A2AClient.fromCardUrl("http://localhost:8080/.well-known/agent-card.json");

      // Iteration 2: wrap before sending. HASH ENVELOPE not KERI seal.
      // Plain mode = sha256 + monotonic counter + freshness window.
      // Tamper-evidence + replay protection, NOT cryptographic identity.
      const signer = getMessageSigner();
      const sealed: SealedMessage<any> = signer.seal(
        data,
        "tommyBuyerAgent",       // logical sender
        "jupiterSellerAgent",    // logical receiver
      );
      logInternal(
        `[envelope] wrap kind=hash-envelope mode=${sealed.envelope.mode} counter=${sealed.envelope.counter} ` +
        `payloadHash=${sealed.envelope.payloadHash.slice(0,12)}... type=${data.type} ` +
        `(NOT a KERI seal)`
      );

      const message: Message = {
        messageId: uuidv4(), kind: "message", role: "agent", contextId,
        parts: [
          { kind: "data", data: sealed },
          { kind: "text", text: `Negotiation ${data.type} - Round ${data.round || "N/A"}` },
        ],
      };
      const stream = client.sendMessageStream({ message } as MessageSendParams);
      await Promise.race([
        (async () => { for await (const _ of stream) {} })(),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
    } catch (error: any) {
      if (error.code !== "UND_ERR_BODY_TIMEOUT" && error.message !== "terminated")
        logInternal(`Send-to-seller error: ${error.message || error}`);
    }
  }

  private respond(bus: ExecutionEventBus, taskId: string, contextId: string, text: string, skipSse = false) {
    if (!skipSse) sseBroadcaster.broadcast(text);
    bus.publish({
      kind: "status-update", taskId, contextId,
      status: {
        state: "completed", timestamp: new Date().toISOString(),
        message: { kind: "message", role: "agent", messageId: uuidv4(),
          parts: [{ kind: "text", text }], taskId, contextId },
      },
      final: true,
    } as TaskStatusUpdateEvent);
  }
}

// ================= SERVER SETUP =================
// Iteration 1: try live-agent-cards/ first (customer onboarded), fall back to
// demo-agent-cards/ (source-controlled), and finally legacy agent-cards/.
function resolveCardPath(agentName: string): string {
  const root = path.resolve(__dirname, "../../..");
  const candidates = [
    path.join(root, "live-agent-cards", `${agentName}-card.json`),
    path.join(root, "demo-agent-cards", `${agentName}-card.json`),
    path.join(root, "agent-cards",      `${agentName}-card.json`),  // legacy
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    `Agent card for ${agentName} not found in live/demo/legacy dirs. ` +
    `Run "npm run bootstrap:demo" to onboard the demo counterparties.`
  );
}

const buyerCard: AgentCard = JSON.parse(
  fs.readFileSync(resolveCardPath("tommyBuyerAgent"), "utf8")
);

const app = express();
app.use(cors());

const executor = new BuyerAgentExecutor();
const handler  = new DefaultRequestHandler(buyerCard, new InMemoryTaskStore(), executor);
new A2AExpressApp(handler).setupRoutes(app);

// SSE endpoint — UI subscribes here to receive live agent messages
app.get('/negotiate-events', (req, res) => sseBroadcaster.addClient(req, res));

// ── Iteration 3: Dashboard API endpoints ──────────────────────────────────
// The React dashboard at http://localhost:5173 (Vite dev server) fetches
// from these endpoints. Vite proxies /api/* to http://localhost:9090, so
// the dashboard never has to hardcode the buyer URL.
//
// Endpoints:
//   GET  /api/recent-deals            list of last 20 audit JSONs
//   GET  /api/quality/:negotiationId  full audit JSON for one negotiation
//   GET  /api/identity-mode           reports buyer's CREDENTIAL_MODE (plain|vlei)
//   POST /api/verify/seller           runs the same verifyCounterparty() the
//                                     agent uses internally — mode-aware:
//                                       plain → returns DISABLED result (no
//                                              KERI/vLEI script ran; agent
//                                              card was source of truth)
//                                       vlei  → calls localhost:4000 api-server
//                                              DEEP-EXT verification script
//                                     UI gates negotiation on success of this.
//
// Both audit endpoints read from src/escalations/*.audit.json which is written
// by NegotiationLogger.saveAuditJson() on every deal-close and escalation.
const escalationsDir = path.resolve(__dirname, "..", "..", "escalations");

// ── Mode endpoint ───────────────────────────────────────────────────────────
app.get('/api/identity-mode', (_req, res) => {
  const raw  = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase();
  const mode = raw === "vlei" ? "vlei" : "plain";
  res.json({
    mode,
    envFile:       ".env",
    envVar:        "CREDENTIAL_MODE",
    rawValue:      process.env.CREDENTIAL_MODE ?? "(unset → defaults to plain)",
    description:   mode === "vlei"
      ? "Cryptographic vLEI verification via api-server on :4000"
      : "GLEIF-only identity check; KERI/vLEI delegation chain NOT verified",
    vleiApiServerUrl: mode === "vlei" ? "http://localhost:4000" : null,
  });
});

// ── Verify-seller endpoint (mode-aware) ─────────────────────────────────────
// The UI chat at /agents calls this to gate the "start negotiation" command.
// We run the same verifyCounterparty() the agent runs internally, so the UI
// gate and the agent's own pre-negotiation check honor the same env config.
app.post('/api/verify/seller', async (_req, res) => {
  try {
    const result = await verifyCounterparty("buyer", "DEEP-EXT");
    const sellerMeta = readAgentCardMetadata("jupiterSellerAgent");

    // Build a step-by-step result shape the GleifPipeline component can render.
    // For plain mode, the "steps" reflect what plain mode actually does:
    //   - load seller's agent card from disk
    //   - check GLEIF identity fields present
    //   - confirm LEI is non-empty
    // For vlei mode, we forward the api-server's verification.* booleans.
    const mode = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain";

    if (result.verified && result.verificationType === "DISABLED") {
      // Plain mode — synthesize step result from agent card data
      const hasLei  = !!sellerMeta?.lei;
      const hasName = !!sellerMeta?.legalEntityName;
      const hasPath = (sellerMeta?.verificationPath?.length ?? 0) > 0;
      return res.json({
        success: hasLei && hasName,
        mode,
        verificationType:   "PLAIN_GLEIF",
        verificationScript: "NONE",
        agent:              sellerMeta?.agentName ?? "jupiterSellerAgent",
        oorHolder:          sellerMeta?.oorHolderName ?? "Jupiter_Chief_Sales_Officer",
        legalEntityName:    sellerMeta?.legalEntityName ?? "",
        lei:                sellerMeta?.lei ?? "",
        timestamp:          result.timestamp,
        verification: {
          step1_info_loaded:           hasName,
          step2_di_verified:           hasLei,
          step3_seal_found:            hasPath,
          step4_digest_verified:       false,  // honest: not run in plain mode
          step5_public_key_available:  !!sellerMeta?.publicKey,
        },
        plainModeNote: "GLEIF-only check; KERI/vLEI delegation chain NOT verified (CREDENTIAL_MODE=plain)",
      });
    }

    // vLEI mode — forward the verifyCounterparty() result as-is.
    return res.json({
      success: result.verified,
      mode,
      verificationType:   result.verificationType,
      verificationScript: result.verificationScript,
      agent:              result.agentName,
      oorHolder:          result.oorHolderName,
      legalEntityName:    sellerMeta?.legalEntityName ?? "",
      lei:                sellerMeta?.lei ?? "",
      timestamp:          result.timestamp,
      error:              result.error,
      // Heuristic step parsing from the api-server's raw output, same logic
      // the GleifPipeline component already uses on the UI side.
      verification: {
        step1_info_loaded:           (result.rawOutput ?? "").includes("Step 1"),
        step2_di_verified:           (result.rawOutput ?? "").includes("Step 2"),
        step3_seal_found:            (result.rawOutput ?? "").includes("Step 3"),
        step4_digest_verified:       (result.rawOutput ?? "").includes("CRYPTOGRAPHIC VERIFICATION PASSED"),
        step5_public_key_available:  (result.rawOutput ?? "").includes("Public key"),
      },
      rawOutput: result.rawOutput,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error:   err?.message ?? "verification endpoint error",
    });
  }
});

app.get('/api/recent-deals', (_req, res) => {
  try {
    if (!fs.existsSync(escalationsDir)) {
      return res.json({ deals: [] });
    }
    const files = fs.readdirSync(escalationsDir)
      .filter(f => f.endsWith("_BUYER.audit.json"))
      .map(f => ({
        name: f,
        path: path.join(escalationsDir, f),
        mtime: fs.statSync(path.join(escalationsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 20);

    const deals = files.map(({ name, path: fp }) => {
      try {
        const audit = JSON.parse(fs.readFileSync(fp, "utf8"));
        return {
          negotiationId: audit.negotiationId,
          outcome:       audit.outcome,
          finalPrice:    audit.negotiation?.finalPrice,
          quantity:      audit.negotiation?.quantity,
          roundsUsed:    audit.negotiation?.roundsUsed,
          closedAt:      audit.generatedAt,
          counterparty:  audit.parties?.counterparty?.legalEntityName,
          summary:       audit.outcomeQuality?.summary,
        };
      } catch {
        return { negotiationId: name.replace("_BUYER.audit.json", ""), error: "unparseable" };
      }
    });
    res.json({ deals });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "unknown" });
  }
});

app.get('/api/quality/:negotiationId', (req, res) => {
  const { negotiationId } = req.params;
  if (!/^NEG-\d+$/.test(negotiationId)) {
    return res.status(400).json({ error: "Invalid negotiationId format" });
  }
  try {
    const candidates = [
      path.join(escalationsDir, `${negotiationId}_success_BUYER.audit.json`),
      path.join(escalationsDir, `${negotiationId}_escalation_BUYER.audit.json`),
    ];
    for (const fp of candidates) {
      if (fs.existsSync(fp)) {
        const audit = JSON.parse(fs.readFileSync(fp, "utf8"));
        return res.json(audit);
      }
    }
    return res.status(404).json({ error: `No audit JSON for ${negotiationId}` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "unknown" });
  }
});

const PORT = process.env.PORT || 9090;
app.listen(PORT, () => {
  console.log(`\n🛒  Buyer Agent  →  http://localhost:${PORT}`);
  console.log(`    Max Budget    : ₹${BUYER_CONFIG.maxBudget}/unit`);
  console.log(`    Target Price  : ₹${BUYER_CONFIG.targetPrice}/unit`);
  console.log(`    Quantity      : ${BUYER_CONFIG.targetQuantity} units`);
  console.log(`    Max Rounds    : ${BUYER_CONFIG.maxRounds}`);
  console.log(`    DD Mode       : AUTONOMOUS (cost of capital ${(BUYER_DD_CONFIG.costOfCapital * 100).toFixed(0)}%  |  escalation band ±${(BUYER_DD_CONFIG.escalationBand * 100).toFixed(0)}%)\n`);
});
