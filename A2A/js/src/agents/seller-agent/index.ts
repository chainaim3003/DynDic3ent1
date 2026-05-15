// ================= SELLER AGENT WITH HYBRID LLM + RULE-BASED DECISION MAKING =================
// Enhanced: consults JupiterTreasuryAgent before accepting any price.
//           Saves a human-overview success report (.txt) when deal closes.
import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

import { A2AClient } from "@a2a-js/sdk/client";
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

import {
  SellerNegotiationState,
  NegotiationDecision,
  OfferData,
  CounterOfferData,
  AcceptanceData,
  EscalationNoticeData,
  InvoiceData,
  PurchaseOrderData,
  NegotiationData,
  DDOfferData,
  DDAcceptData,
  TreasuryConsultationSummary,
} from "../../shared/negotiation-types.js";

import { LLMNegotiationClient, LLMPromptContext } from "../../shared/llm-client.js";
import { NegotiationLogger, logInternal, suppressSDKNoise } from "../../shared/logger.js";
import { SSEBroadcaster } from "../../shared/sse-broadcaster.js";

// Module-level SSE broadcaster — shared across all requests
const sseBroadcaster = new SSEBroadcaster("seller");
import { computeSafeDDRate, computeLinearDiscount, addDays } from "../../shared/dd-calculator.js";
import { ActusClient } from "../../shared/actus-client.js";
import {
  getMarketSnapshot,
  computeAdjustedSafetyFactor,
  computeAdjustedMarginPrice,
  printMarketSnapshot,
} from "../../shared/market-data-client.js";
import {
  verifyCounterparty,
  printVerificationResult,
  readAgentCardMetadata,
} from "../../shared/vlei-verification-client.js";

// Import TreasuryResult type for the REST response
import type { TreasuryResult } from "../treasury-agent/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

// Suppress @a2a-js/sdk internal stdout noise (ResultManager logs etc.)
suppressSDKNoise();

// ================= SELLER AGENT CONFIGURATION =================
const SELLER_CONFIG = {
  marginPrice:            350,   // PRIVATE — never go below this
  targetProfitPercentage: 0.1,   // 10%
  maxRounds:              3,
  strategyParams: {
    flexibility:     0.5,
    dealPriority:    0.7,
    minProfitMargin: 5,
  },
  // Dynamic Discounting config
  dd: {
    paymentTermsDays:        30,   // Net 30
    proposedEarlyPayDays:    10,   // seller proposes buyer pays within 10 days
    safetyFactor:            0.5,  // give away at most 50% of profit as discount
    hurdleRateAnnualized:    0.075,
  },
  // Treasury agent
  treasury: {
    url: "http://localhost:7070/consult",
    enabled: true,                // set false to skip treasury consultation
    timeoutMs: 5000,              // if treasury is slow/down, degrade gracefully
  },
};

const TARGET_PRICE = Math.round(
  SELLER_CONFIG.marginPrice * (1 + SELLER_CONFIG.targetProfitPercentage)
);

// ================= SELLER AGENT EXECUTOR =================
class SellerAgentExecutor implements AgentExecutor {
  private negotiations = new Map<string, SellerNegotiationState>();
  private loggers      = new Map<string, NegotiationLogger>();
  private llmClient: LLMNegotiationClient;
  private actusClient: ActusClient;

  constructor() {
    this.llmClient   = new LLMNegotiationClient();
    this.actusClient = new ActusClient();
  }

  async cancelTask(taskId: string): Promise<void> {
    logInternal(`Task cancellation requested: ${taskId}`);
  }

  // ================= MAIN EXECUTION =================
  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const taskId    = ctx.task?.id        || uuidv4();
    const contextId = ctx.task?.contextId || uuidv4();

    const dataParts = ctx.userMessage.parts.filter((p) => p.kind === "data");

    if (dataParts.length === 0) {
      this.respond(bus, taskId, contextId, "🏪 Seller Agent Ready. Waiting for buyer...");
      return;
    }

    const data = (dataParts[0] as any).data as NegotiationData;

    switch (data.type) {
      case "OFFER":
        await this.handleBuyerOffer(data as OfferData, contextId, bus, taskId);
        break;
      case "COUNTER_OFFER":
        await this.handleBuyerCounterOffer(data as CounterOfferData, contextId, bus, taskId);
        break;
      case "ACCEPT_OFFER":
        await this.handleBuyerAcceptance(data as AcceptanceData, contextId, bus, taskId);
        break;
      case "PURCHASE_ORDER":
        await this.handlePurchaseOrder(data as PurchaseOrderData, contextId, bus, taskId);
        break;
      case "ESCALATION_NOTICE":
        await this.handleEscalationNotice(data as EscalationNoticeData, contextId, bus, taskId);
        break;
      case "DD_ACCEPT":
        await this.handleDDAccept(data as DDAcceptData, contextId, bus, taskId);
        break;
      default:
        logInternal(`Unknown message type: ${(data as any).type}`);
    }
  }

  // ================= TREASURY CONSULTATION =================
  /**
   * Calls JupiterTreasuryAgent synchronously via REST POST /consult.
   * Returns null on failure (treasury down / timeout) — seller proceeds normally.
   *
   * The treasury runs an ACTUS PAM simulation:
   *   IED: production outflow today
   *   MD:  invoice inflow after `paymentTermsDays`
   * and checks: cashPositive ∧ dealProfitable ∧ npvPositive
   */
  private async consultTreasury(
    negotiationId: string,
    pricePerUnit: number,
    quantity: number,
    round: number,
  ): Promise<TreasuryResult | null> {
    if (!SELLER_CONFIG.treasury.enabled) return null;

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), SELLER_CONFIG.treasury.timeoutMs);

      const response = await fetch(SELLER_CONFIG.treasury.url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          negotiationId,
          pricePerUnit,
          quantity,
          paymentTerms: SELLER_CONFIG.dd.paymentTermsDays,
          round,
        }),
        signal: controller.signal,
      });

      clearTimeout(tid);

      if (!response.ok) {
        logInternal(`Treasury returned HTTP ${response.status} — proceeding without validation`);
        return null;
      }
      return await response.json() as TreasuryResult;

    } catch (err: any) {
      if (err?.name === "AbortError") {
        logInternal(`Treasury timeout (${SELLER_CONFIG.treasury.timeoutMs}ms) — proceeding without validation`);
      } else {
        logInternal(`Treasury unreachable: ${err?.message ?? err} — proceeding without validation`);
      }
      return null;
    }
  }

  /**
   * Applies treasury verdict on top of the LLM/rule-based decision.
   *
   * Rules:
   *   - If treasury APPROVED  → decision passes through unchanged.
   *   - If treasury REJECTED and decision is ACCEPT  → override to COUNTER at minViablePrice.
   *   - If treasury REJECTED and decision is COUNTER → floor the counter price at minViablePrice.
   *   - If treasury REJECTED and we are at maxRounds → do NOT escalate (let normal flow handle it);
   *     just note the override for the report.
   *
   * Returns { decision, overrideApplied }.
   */
  private applyTreasuryConstraint(
    decision: NegotiationDecision,
    treasuryResult: TreasuryResult | null,
    state: SellerNegotiationState,
    logger: NegotiationLogger,
  ): { decision: NegotiationDecision; overrideApplied: boolean } {
    if (!treasuryResult || treasuryResult.approved) {
      return { decision, overrideApplied: false };
    }

    const minPrice = Math.max(
      treasuryResult.minViablePrice ?? SELLER_CONFIG.marginPrice,
      SELLER_CONFIG.marginPrice + state.strategyParams.minProfitMargin,
    );

    let overrideApplied = false;

    if (decision.action === "ACCEPT") {
      logInternal(`Treasury override: ACCEPT → COUNTER at ₹${minPrice} (treasury minViablePrice)`);
      logger.log({
        round:       state.currentRound,
        messageType: "TREASURY_OVERRIDE",
        from:        "SELLER",
        decision:    "COUNTER_OFFER",
        reasoning:   `Treasury ACTUS simulation rejected ₹${state.lastBuyerOffer} — ${treasuryResult.failReasons.join("; ")}. Countering at treasury minimum ₹${minPrice}`,
      } as any);
      decision = {
        action:    "COUNTER",
        price:     minPrice,
        reasoning: `Treasury ACTUS override: cash/NPV check failed at ₹${state.lastBuyerOffer}. Minimum viable price: ₹${minPrice}`,
      };
      overrideApplied = true;

    } else if (decision.action === "COUNTER" && decision.price !== undefined) {
      if (decision.price < minPrice) {
        logInternal(`Treasury override: counter price ₹${decision.price} → ₹${minPrice} (treasury floor)`);
        decision = {
          ...decision,
          price:     minPrice,
          reasoning: `${decision.reasoning} [treasury floor: ₹${minPrice}]`,
        };
        overrideApplied = true;
      }
    }

    return { decision, overrideApplied };
  }

  /**
   * Store treasury summary on the negotiation state so the success report can reference it.
   */
  private recordTreasurySummary(
    state: SellerNegotiationState,
    treasuryResult: TreasuryResult | null,
    round: number,
    priceQueried: number,
    overrideApplied: boolean,
  ) {
    if (!treasuryResult) return;

    const prev = state.lastTreasuryResult;
    state.lastTreasuryResult = {
      round,
      priceQueried,
      approved:            treasuryResult.approved,
      npvOfDeal:           treasuryResult.npvOfDeal,
      netProfit:           treasuryResult.netProfit,
      projectedMinBalance: treasuryResult.projectedMinBalance,
      safetyThreshold:     treasuryResult.safetyThreshold,
      workingCapitalCost:  treasuryResult.workingCapitalCost,
      minViablePrice:      treasuryResult.minViablePrice,
      overrideApplied:     overrideApplied || (prev?.overrideApplied ?? false),
    };
  }

  // ================= HANDLE BUYER INITIAL OFFER =================
  private async handleBuyerOffer(
    data: OfferData,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string
  ) {
    const { negotiationId, pricePerUnit, quantity, deliveryDate } = data;

    const logger = new NegotiationLogger(negotiationId, "SELLER");
    this.loggers.set(negotiationId, logger);

    logger.printSessionHeader(contextId);

    // ── vLEI: verify buyer delegation BEFORE responding ──────────────────────
    logInternal("[vLEI] Verifying tommyBuyerAgent delegation chain...");
    const vLEIResult = await verifyCounterparty("seller", "DEEP-EXT");
    const buyerMeta  = readAgentCardMetadata("tommyBuyerAgent");
    printVerificationResult(vLEIResult, buyerMeta);

    if (!vLEIResult.verified) {
      this.respond(
        bus, taskId, contextId,
        `❌ vLEI verification FAILED — cannot proceed with negotiation.\nReason: ${vLEIResult.error ?? "Buyer delegation could not be verified"}`
      );
      return;
    }
    logInternal(`[vLEI] Buyer verified (${vLEIResult.verificationScript}) — proceeding`);
    // ─────────────────────────────────────────────────────────────────────────
    logger.printRoundHeader(1, SELLER_CONFIG.maxRounds);

    logger.log({
      round:        1,
      messageType:  "OFFER",
      from:         "BUYER",
      offeredPrice: pricePerUnit,
      decision:     "OFFER",
    });

    const state: SellerNegotiationState = {
      negotiationId,
      contextId,
      status:                 "NEGOTIATING",
      marginPrice:            SELLER_CONFIG.marginPrice,
      targetProfitPercentage: SELLER_CONFIG.targetProfitPercentage,
      quantity,
      deliveryDate,
      currentRound:           1,
      maxRounds:              SELLER_CONFIG.maxRounds,
      history:                [],
      lastBuyerOffer:         pricePerUnit,
      strategyParams:         SELLER_CONFIG.strategyParams,
    };

    this.negotiations.set(negotiationId, state);

    // ── Treasury consultation BEFORE making decision ───────────────────────────
    logInternal(`Consulting JupiterTreasuryAgent for Round 1 — buyer offer ₹${pricePerUnit}...`);
    const treasuryResult = await this.consultTreasury(negotiationId, pricePerUnit, quantity, 1);

    let decision = await this.makeNegotiationDecision(state);
    const { decision: finalDecision, overrideApplied } =
      this.applyTreasuryConstraint(decision, treasuryResult, state, logger);
    decision = finalDecision;

    this.recordTreasurySummary(state, treasuryResult, 1, pricePerUnit, overrideApplied);

    if (decision.action === "ACCEPT") {
      await this.sendAcceptance(state, logger, contextId);
      this.respond(
        bus, taskId, contextId,
        `✓ Accepting buyer's offer: ₹${pricePerUnit}/fabric unit\nProfit: ₹${pricePerUnit - SELLER_CONFIG.marginPrice}/fabric unit\nWaiting for buyer confirmation...`
      );
    } else if (decision.action === "COUNTER") {
      await this.sendCounterOffer(state, decision.price!, decision.reasoning, logger, contextId);
      this.respond(
        bus, taskId, contextId,
        `↓ Counter-offer sent: ₹${decision.price}/fabric unit  (buyer offered ₹${pricePerUnit})${overrideApplied ? "  [treasury floor applied]" : ""}\nWaiting for buyer response...`
      );
    } else {
      state.status = "REJECTED";
      this.respond(bus, taskId, contextId, "✗ Offer rejected — below acceptable threshold");
    }
  }

  // ================= HANDLE BUYER COUNTER OFFER =================
  private async handleBuyerCounterOffer(
    data: CounterOfferData,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string
  ) {
    const state  = this.negotiations.get(data.negotiationId);
    const logger = this.loggers.get(data.negotiationId);

    if (!state || !logger) {
      logInternal(`Negotiation state not found: ${data.negotiationId}`);
      return;
    }

    state.lastBuyerOffer = data.pricePerUnit;

    // ── Use seller's own last offer as the baseline for delta display ─────────
    const sellerLastPrice      = state.lastSellerOffer;
    const priceMovement        = sellerLastPrice !== undefined
      ? data.pricePerUnit - sellerLastPrice
      : 0;
    const priceMovementPercent = sellerLastPrice !== undefined && sellerLastPrice !== 0
      ? (priceMovement / sellerLastPrice) * 100
      : 0;

    logger.log({
      round:                state.currentRound,
      messageType:          "COUNTER_OFFER",
      from:                 "BUYER",
      offeredPrice:         data.pricePerUnit,
      previousPrice:        sellerLastPrice,
      priceMovement,
      priceMovementPercent,
      decision:             "COUNTER_OFFER",
      reasoning:            data.reasoning,
    });

    const currentHistory = state.history.find((h) => h.round === state.currentRound);
    if (currentHistory) {
      currentHistory.buyerOffer  = data.pricePerUnit;
      currentHistory.buyerAction = "COUNTER_OFFER";
    }

    state.currentRound += 1;

    if (state.currentRound > state.maxRounds) {
      // Seller side just waits — buyer will send ESCALATION_NOTICE shortly
      state.status = "ESCALATED";
      logInternal(`Max rounds reached — awaiting escalation notice from buyer`);
      this.respond(bus, taskId, contextId, "⚠ Max rounds reached — awaiting escalation notice...");
      return;
    }

    logger.printRoundHeader(state.currentRound, state.maxRounds);

    // ── Treasury consultation BEFORE making decision ───────────────────────────
    logInternal(`Consulting JupiterTreasuryAgent for Round ${state.currentRound} — buyer counter ₹${data.pricePerUnit}...`);
    const treasuryResult = await this.consultTreasury(
      state.negotiationId,
      data.pricePerUnit,
      state.quantity,
      state.currentRound,
    );

    let decision = await this.makeNegotiationDecision(state);
    const { decision: finalDecision, overrideApplied } =
      this.applyTreasuryConstraint(decision, treasuryResult, state, logger);
    decision = finalDecision;

    this.recordTreasurySummary(state, treasuryResult, state.currentRound, data.pricePerUnit, overrideApplied);

    if (decision.action === "ACCEPT") {
      await this.sendAcceptance(state, logger, contextId);
      const profit = data.pricePerUnit - SELLER_CONFIG.marginPrice;
      this.respond(
        bus, taskId, contextId,
        `✓ Accepting buyer's offer: ₹${data.pricePerUnit}/fabric unit\nProfit: ₹${profit}/fabric unit (${((profit / SELLER_CONFIG.marginPrice) * 100).toFixed(1)}%)\nWaiting for buyer confirmation...`
      );
    } else if (decision.action === "COUNTER") {
      await this.sendCounterOffer(state, decision.price!, decision.reasoning, logger, contextId);
      this.respond(
        bus, taskId, contextId,
        `↓ Counter-offer sent: ₹${decision.price}/fabric unit${overrideApplied ? "  [treasury floor applied]" : ""}\nWaiting for buyer response...`
      );
    } else {
      state.status = "REJECTED";
      logger.printNegotiationSummary("FAILED", {
        roundsUsed: state.currentRound,
        maxRounds:  state.maxRounds,
        quantity:   state.quantity,
      });
      this.respond(bus, taskId, contextId, "✗ Offer rejected — below margin price");
    }
  }

  // ================= HANDLE ESCALATION NOTICE =================
  private async handleEscalationNotice(
    data: EscalationNoticeData,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string
  ) {
    const logger = this.loggers.get(data.negotiationId);
    const state  = this.negotiations.get(data.negotiationId);

    if (state)  state.status = "ESCALATED";

    if (logger) {
      logger.printEscalationReceived(data.gap, data.reportPath);

      // ── Save seller-side escalation report (.txt) ─────────────────────────
      const sellerReportPath = logger.saveEscalationReport({
        buyerFinalOffer:  data.buyerFinalOffer,
        sellerFinalOffer: data.sellerFinalOffer,
        gap:              data.gap,
        rounds:           data.round,
        maxRounds:        state?.maxRounds ?? data.round,
        quantity:         state?.quantity  ?? 0,
        deliveryDate:     state?.deliveryDate ?? "—",
        logs:             logger.getLogs(),
      });
      logger.printEscalationNotice(data.buyerFinalOffer, data.sellerFinalOffer, data.gap, sellerReportPath);

    } else {
      logInternal(`Escalation received for ${data.negotiationId} — gap ₹${data.gap} — report: ${data.reportPath}`);
    }

    this.respond(
      bus, taskId, contextId,
      `⚠ Negotiation escalated to human review.\nGap: ₹${data.gap}  |  Buyer report: ${data.reportPath}`
    );
  }

  // ================= HANDLE BUYER ACCEPTANCE =================
  private async handleBuyerAcceptance(
    data: AcceptanceData,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string
  ) {
    const state  = this.negotiations.get(data.negotiationId);
    const logger = this.loggers.get(data.negotiationId);

    if (!state || !logger) {
      logInternal(`Negotiation state not found: ${data.negotiationId}`);
      return;
    }

    if (state.status === "COMPLETED" || state.status === "ACCEPTED") {
      logInternal(`Ignoring duplicate acceptance — already ${state.status}`);
      return;
    }

    logger.log({
      round:        state.currentRound,
      messageType:  "ACCEPT",
      from:         "BUYER",
      offeredPrice: data.acceptedPrice,
      decision:     "ACCEPT",
      reasoning:    "Buyer accepted our offer",
    });

    state.agreedPrice   = data.acceptedPrice;
    state.profitPerUnit = data.acceptedPrice - SELLER_CONFIG.marginPrice;
    state.totalRevenue  = data.acceptedPrice * state.quantity;
    state.status        = "ACCEPTED";

    const acceptanceData: AcceptanceData = {
      type:          "ACCEPT_OFFER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      acceptedPrice: data.acceptedPrice,
      from:          "SELLER",
      finalTerms: {
        pricePerUnit: data.acceptedPrice,
        quantity:     state.quantity,
        totalAmount:  state.totalRevenue,
        deliveryDate: state.deliveryDate,
      },
    };

    logger.log({
      round:        state.currentRound,
      messageType:  "ACCEPT",
      from:         "SELLER",
      offeredPrice: data.acceptedPrice,
      decision:     "ACCEPT",
      reasoning:    "bilateral acceptance rule",
    });

    await this.sendToBuyer(acceptanceData, contextId);

    const buyerStart  = state.history[0]?.buyerOffer;
    const sellerStart = state.history[0]?.sellerOffer;

    logger.printNegotiationSummary("COMPLETED", {
      roundsUsed:       state.currentRound,
      maxRounds:        state.maxRounds,
      finalPrice:       data.acceptedPrice,
      buyerStartPrice:  buyerStart,
      sellerStartPrice: sellerStart,
      totalRevenue:     state.totalRevenue,
      profitMargin:     state.profitPerUnit,
      quantity:         state.quantity,
    });

    state.status = "COMPLETED";

    // ── Save success report for human overview ────────────────────────────────
    const tr = state.lastTreasuryResult;
    const reportPath = logger.saveSuccessReport({
      finalPrice:        data.acceptedPrice,
      quantity:          state.quantity,
      totalDealValue:    state.totalRevenue!,
      deliveryDate:      state.deliveryDate,
      paymentTerms:      `Net ${SELLER_CONFIG.dd.paymentTermsDays}`,
      roundsUsed:        state.currentRound,
      maxRounds:         state.maxRounds,
      logs:              logger.getLogs(),
      buyerStartPrice:   buyerStart,
      sellerStartPrice:  sellerStart,
      profitPerUnit:     state.profitPerUnit,
      totalRevenue:      state.totalRevenue,
      marginPrice:       SELLER_CONFIG.marginPrice,
      treasury: tr ? {
        consultedRounds:      [tr.round],
        allApproved:          tr.approved,
        overrideApplied:      tr.overrideApplied,
        finalNPV:             tr.npvOfDeal,
        finalNetProfit:       tr.netProfit,
        projectedMinBalance:  tr.projectedMinBalance,
        safetyThreshold:      tr.safetyThreshold,
        workingCapitalCost:   tr.workingCapitalCost,
      } : undefined,
    });

    logger.printSuccessNotice(data.acceptedPrice, state.totalRevenue!, reportPath);

    this.respond(
      bus, taskId, contextId,
      `✓✓ Deal Closed!\n\nFinal Price    : ₹${data.acceptedPrice}/fabric unit\nProfit         : ₹${state.profitPerUnit}/fabric unit\nTotal Revenue  : ₹${state.totalRevenue?.toLocaleString()}\nWaiting for Purchase Order...`
    );
  }

  // ================= HANDLE PURCHASE ORDER =================
  private async handlePurchaseOrder(
    data: PurchaseOrderData,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string
  ) {
    const state  = this.negotiations.get(data.negotiationId);
    const logger = this.loggers.get(data.negotiationId);

    if (!state || !logger) {
      logInternal(`Negotiation state not found: ${data.negotiationId}`);
      return;
    }

    logger.printPurchaseOrder(data);

    // ── Step 1: IPEX issue+grant FIRST so credential is pending in buyer's mailbox ──
    //         (must happen BEFORE sendInvoice, otherwise the buyer's admit
    //         fires before the grant exists and picks up stale credentials)
    const invoiceId = `INV-${Date.now()}`;
    try {
      const ipexSubtotal = state.agreedPrice! * state.quantity;
      const ipexTax      = Math.round(ipexSubtotal * 0.18);
      logInternal(`[IPEX] Issuing invoice credential and granting to buyer (${invoiceId})...`);
      const ipexResp = await fetch("http://localhost:4000/api/seller/ipex/issue-and-grant", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          totalAmount:   ipexSubtotal + ipexTax,
          currency:      "INR",
          pricePerUnit:  state.agreedPrice,
          quantity:      state.quantity,
          paymentTerms:  `Net ${SELLER_CONFIG.dd.paymentTermsDays} days`,
          negotiationId: state.negotiationId,
          type:          "INVOICE",
        }),
      });
      const ipexData = await ipexResp.json() as any;
      if (ipexData.success) logInternal(`[IPEX] ✅ Invoice credential issued & granted — SAID: ${ipexData.credentialSAID}`);
      else                  logInternal(`[IPEX] ⚠ Invoice credential failed: ${ipexData.error ?? "unknown"}`);
    } catch (ipexErr: any) {
      logInternal(`[IPEX] ⚠ Invoice IPEX error: ${ipexErr?.message ?? ipexErr}`);
    }

    // ── Step 2: Now send the A2A invoice message — buyer will admit the pending grant ──
    await this.sendInvoice(state, data.poId, invoiceId, logger, contextId);

    state.status = "COMPLETED";

    // ── Step 2: Compute safe DD rate from seller's margin ─────────────────────
    const agreedPrice = state.agreedPrice!;
    // L4: Fetch live SOFR + commodity data to compute market-informed DD rate
    const market = await getMarketSnapshot();
    printMarketSnapshot(market, "L4 DD Offer — Market-Informed Parameters");
    const adjustedSafetyFactor = computeAdjustedSafetyFactor(market.effectiveBorrowingRate);
    const adjustedMarginPrice  = computeAdjustedMarginPrice(SELLER_CONFIG.marginPrice, market.commodityIndex);
    logInternal(`[L4] margin ₹${SELLER_CONFIG.marginPrice}→₹${adjustedMarginPrice}  factor ${SELLER_CONFIG.dd.safetyFactor}→${adjustedSafetyFactor}  EBR ${(market.effectiveBorrowingRate * 100).toFixed(2)}%`);
    const safeDDRate = computeSafeDDRate(agreedPrice, SELLER_CONFIG.marginPrice, adjustedSafetyFactor);
    logInternal(`[L4] DD basis: margin \u20b9${SELLER_CONFIG.marginPrice} (static)  adjusted \u20b9${adjustedMarginPrice} (commodity info only)  factor ${adjustedSafetyFactor} (SOFR-driven)`);

    if (safeDDRate <= 0) {
      logInternal("DD rate is 0 (no profit margin) — skipping DD offer");
      this.respond(bus, taskId, contextId, "📄 Invoice sent to buyer\nNegotiation completed successfully!");
      return;
    }

    // ── Step 3: Build DD_OFFER payload ────────────────────────────────────────
    const invoiceDate            = new Date().toISOString().split("T")[0];
    const dueDate                = addDays(invoiceDate, SELLER_CONFIG.dd.paymentTermsDays);
    const proposedSettlementDate = addDays(invoiceDate, SELLER_CONFIG.dd.proposedEarlyPayDays);

    const subtotal    = agreedPrice * state.quantity;
    const tax         = Math.round(subtotal * 0.18);
    const totalAmount = subtotal + tax;

    const discountAtProposed = computeLinearDiscount(
      totalAmount,
      safeDDRate,
      invoiceDate,
      dueDate,
      proposedSettlementDate
    );

    const ddOfferData: DDOfferData = {
      type:                    "DD_OFFER",
      invoiceId,
      negotiationId:           state.negotiationId,
      invoiceDate,
      dueDate,
      originalTotal:           totalAmount,
      maxDiscountRate:         safeDDRate,
      paymentTermsDays:        SELLER_CONFIG.dd.paymentTermsDays,
      proposedSettlementDate,
      discountAtProposedDate:  discountAtProposed,
    };

    logger.printDDOffer(ddOfferData);

    this.respond(
      bus, taskId, contextId,
      `📄 Invoice sent\n💰 DD Offer sent — max ${(safeDDRate * 100).toFixed(3)}% discount\n   Pay by ${proposedSettlementDate} → ₹${discountAtProposed.discountedAmount.toLocaleString()} (save ₹${discountAtProposed.savingAmount.toLocaleString()})\nAwaiting buyer's DD acceptance...`
    );

    // 800ms delay — ensures "Invoice sent / DD Offer sent" SSE reaches UI before buyer processes DD offer
    await new Promise(resolve => setTimeout(resolve, 800));
    await this.sendToBuyer(ddOfferData, contextId);
  }

  // ================= HANDLE DD_ACCEPT =================
  private async handleDDAccept(
    data: DDAcceptData,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string
  ) {
    const state  = this.negotiations.get(data.negotiationId);
    const logger = this.loggers.get(data.negotiationId);

    if (!state || !logger) {
      logInternal(`DD_ACCEPT: negotiation state not found: ${data.negotiationId}`);
      return;
    }

    logger.printDDAccept(data);

    // ── Re-compute discount for the buyer's chosen settlement date ────────────
    const agreedPrice = state.agreedPrice!;
    const safeDDRate  = computeSafeDDRate(
      agreedPrice,
      SELLER_CONFIG.marginPrice,
      SELLER_CONFIG.dd.safetyFactor
    );

    const invoiceDate = new Date().toISOString().split("T")[0];
    const dueDate     = addDays(invoiceDate, SELLER_CONFIG.dd.paymentTermsDays);
    const subtotal    = agreedPrice * state.quantity;
    const tax         = Math.round(subtotal * 0.18);
    const totalAmount = subtotal + tax;

    const ddResult = computeLinearDiscount(
      totalAmount,
      safeDDRate,
      invoiceDate,
      dueDate,
      data.chosenSettlementDate
    );

    // ── Sub-delegate to JupiterTreasuryAgent: /dd-cashflow-schedule (L4) ─────
    // Treasury fetches live SOFR, builds SOFR-adjusted declining reference
    // series, sets hurdle = EBR+300bps, runs 4-step ACTUS PAM, and returns
    // the full cashflow schedule. Falls back to direct ACTUS on failure.
    logInternal(`Sub-delegating DD cashflow schedule to JupiterTreasuryAgent...`);

    let actusSuccess    = false;
    let actusContractId = data.invoiceId;
    let actusScenarioId = "";
    let actusError:     string | undefined;
    let marketCtx:      string = "";

    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch("http://localhost:7070/dd-cashflow-schedule", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          negotiationId:   data.negotiationId,
          invoiceId:       data.invoiceId,
          settlementDate:  data.chosenSettlementDate,
          notionalAmount:  totalAmount,
          maxDiscountRate: safeDDRate,
          invoiceDate,
          dueDate,
          sellerRevenue:   state.totalRevenue ?? subtotal,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(tid);

      if (resp.ok) {
        const tv      = await resp.json() as any;
        actusSuccess  = tv.success  ?? false;
        actusContractId = tv.contractId ?? data.invoiceId;
        actusScenarioId = tv.scenarioId ?? "";
        actusError    = tv.error;
        if (tv.market) {
          const m = tv.market;
          marketCtx = `  SOFR ${(m.sofrRate * 100).toFixed(2)}% (${m.sofrSource})  hurdle ${(m.adjustedHurdleRate * 100).toFixed(2)}%  EBR ${(m.effectiveBorrowingRate * 100).toFixed(2)}%`;
        }
        if (actusSuccess)
          logInternal(`Treasury cashflow schedule ✓ — ${(tv.events ?? []).length} events${marketCtx}`);
        else
          logInternal(`Treasury cashflow schedule failed: ${actusError}`);
      } else {
        throw new Error(`Treasury HTTP ${resp.status}`);
      }
    } catch (err: any) {
      logInternal(`Treasury sub-delegation failed: ${err?.message ?? err} — falling back to direct ACTUS (L3)`);
      const fallback = await this.actusClient.submitDDContract({
        contractId:           data.invoiceId,
        negotiationId:        data.negotiationId,
        invoiceDate, dueDate,
        settlementDate:       data.chosenSettlementDate,
        notionalAmount:       totalAmount,
        maxDiscountRate:      safeDDRate,
        hurdleRateAnnualized: SELLER_CONFIG.dd.hurdleRateAnnualized,
        sellerRevenue:        state.totalRevenue ?? totalAmount,
      });
      actusSuccess    = fallback.success;
      actusContractId = fallback.contractId;
      actusScenarioId = fallback.scenarioId;
      actusError      = fallback.error;
      if (fallback.success)
        logInternal(`Fallback ACTUS ✓ — contractId: ${fallback.contractId}`);
      else
        logInternal(`Fallback ACTUS failed — ${fallback.error}`);
    }

    // ── Build and send DD_INVOICE ─────────────────────────────────────────────
    const ddInvoice = {
      type:                  "DD_INVOICE",
      invoiceId:             data.invoiceId,
      negotiationId:         data.negotiationId,
      originalTotal:         totalAmount,
      discountedTotal:       ddResult.discountedAmount,
      savingAmount:          ddResult.savingAmount,
      appliedRate:           ddResult.appliedRate,
      settlementDate:        data.chosenSettlementDate,
      dueDate,
      actusContractId,
      actusScenarioId,
      actusSimulationStatus: actusSuccess ? "SUCCESS" : "FAILED",
      actusError,
    };

    logger.printDDInvoice(ddInvoice);
    state.status = "DD_COMPLETED";

    // ── IPEX: issue DD invoice credential and grant to buyer ──
    try {
      logInternal(`[IPEX] Issuing DD invoice credential and granting to buyer (${data.invoiceId})...`);
      const ipexResp = await fetch("http://localhost:4000/api/seller/ipex/issue-and-grant", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId:     data.invoiceId,
          totalAmount:   ddResult.discountedAmount,
          currency:      "INR",
          pricePerUnit:  state.agreedPrice,
          quantity:      state.quantity,
          paymentTerms:  `Early payment by ${data.chosenSettlementDate}`,
          negotiationId: state.negotiationId,
          type:          "DD_INVOICE",
        }),
      });
      const ipexData = await ipexResp.json() as any;
      if (ipexData.success) logInternal(`[IPEX] ✅ DD Invoice credential issued & granted — SAID: ${ipexData.credentialSAID}`);
      else                  logInternal(`[IPEX] ⚠ DD Invoice credential failed: ${ipexData.error ?? "unknown"}`);
    } catch (ipexErr: any) {
      logInternal(`[IPEX] ⚠ DD Invoice IPEX error: ${ipexErr?.message ?? ipexErr}`);
    }

    this.respond(
      bus, taskId, contextId,
      `✓ DD Invoice dispatched to buyer\nSettle by : ${data.chosenSettlementDate}\nACTUS      : ${actusSuccess ? "✓ SUCCESS" : "⚠ " + actusError}`
    );

    // 800ms delay — ensures "DD Invoice dispatched" SSE reaches UI before buyer's "DD Invoice received"
    await new Promise(resolve => setTimeout(resolve, 800));
    await this.sendToBuyer(ddInvoice, contextId);
  }

  // ================= HYBRID DECISION MAKING =================
  private async makeNegotiationDecision(state: SellerNegotiationState): Promise<NegotiationDecision> {
    const llmDecision       = await this.getLLMDecision(state);
    const validatedDecision = this.applySellerConstraints(llmDecision, state);

    if (!validatedDecision) {
      logInternal("LLM decision invalid — using rule-based fallback");
      return this.ruleBasedDecision(state);
    }
    return validatedDecision;
  }

  private async getLLMDecision(state: SellerNegotiationState): Promise<NegotiationDecision> {
    // L4: fetch market snapshot so LLM can reason about SOFR and cotton prices
    const market = await getMarketSnapshot();
    const context: LLMPromptContext = {
      role:           "SELLER",
      round:          state.currentRound,
      maxRounds:      state.maxRounds,
      lastOwnOffer:   state.lastSellerOffer,
      lastTheirOffer: state.lastBuyerOffer,
      history:        state.history,
      constraints:    { marginPrice: state.marginPrice + state.strategyParams.minProfitMargin, quantity: state.quantity },
      targetPrice:    TARGET_PRICE,
      marketContext: {
        sofrRate:               market.sofrRate,
        cottonPricePerLb:       market.cottonPricePerLb,
        effectiveBorrowingRate: market.effectiveBorrowingRate,
        sofrSource:             market.sofrSource,
      },
    };
    const llmResponse = await this.llmClient.getNegotiationDecision(context);
    return { action: llmResponse.action, price: llmResponse.price, reasoning: llmResponse.reasoning };
  }

  private applySellerConstraints(
    decision: NegotiationDecision,
    state: SellerNegotiationState
  ): NegotiationDecision | null {
    // The minimum we will ever accept — cost floor + required profit buffer.
    const minAcceptable = state.marginPrice + state.strategyParams.minProfitMargin;

    if (decision.action === "ACCEPT") {
      // Use strict < minAcceptable (not < marginPrice) so ₹350 is also rejected.
      if (state.lastBuyerOffer && state.lastBuyerOffer < minAcceptable) {
        logInternal(`Cannot accept ₹${state.lastBuyerOffer} — below min acceptable ₹${minAcceptable} (margin ₹${state.marginPrice} + buffer ₹${state.strategyParams.minProfitMargin})`);
        if (state.currentRound < state.maxRounds) {
          decision.action    = "COUNTER";
          decision.price     = minAcceptable;
          decision.reasoning = `Buyer offer below minimum acceptable ₹${minAcceptable}, countering at floor`;
        } else {
          decision.action    = "REJECT";
          decision.reasoning = `Buyer offer ₹${state.lastBuyerOffer} below minimum ₹${minAcceptable} in final round`;
        }
      }
    }

    if (decision.action === "COUNTER") {
      if (!decision.price) {
        logInternal("Counter-offer missing price — falling back to rule-based");
        return null;
      }
      if (decision.price < state.marginPrice) {
        logInternal(`Counter price ₹${decision.price} floored to margin+buffer`);
        decision.price     = state.marginPrice + state.strategyParams.minProfitMargin;
        decision.reasoning += " (protected margin floor)";
      }
      if (state.lastSellerOffer && decision.price > state.lastSellerOffer) {
        decision.price = Math.max(
          state.lastSellerOffer - 5,
          state.marginPrice + state.strategyParams.minProfitMargin
        );
        decision.reasoning += " (decreased from last offer)";
      }
      decision.price = Math.round(decision.price);
    }

    return decision;
  }

  private ruleBasedDecision(state: SellerNegotiationState): NegotiationDecision {
    const buyerOffer = state.lastBuyerOffer!;

    const profitTargets: Record<number, number> = {
      1: state.marginPrice + 30,
      2: state.marginPrice + 20,
      3: state.marginPrice + 10,
    };
    const targetProfit = profitTargets[state.currentRound] ?? state.marginPrice + 5;

    if (buyerOffer >= targetProfit) {
      return { action: "ACCEPT", reasoning: `Buyer ₹${buyerOffer} meets round ${state.currentRound} profit target` };
    }
    if (state.currentRound === state.maxRounds) {
      if (buyerOffer >= state.marginPrice + state.strategyParams.minProfitMargin) {
        return { action: "ACCEPT", reasoning: "Final round — accepting above-margin offer" };
      } else {
        return { action: "REJECT", reasoning: "Final round — buyer offer below margin" };
      }
    }

    let newOffer: number;
    if (!state.lastSellerOffer) {
      newOffer = Math.max(state.marginPrice * 1.25, buyerOffer * 1.3);
    } else {
      const gap        = state.lastSellerOffer - buyerOffer;
      const concession = gap * (state.currentRound === 2 ? 0.3 : 0.4);
      newOffer = Math.max(
        state.lastSellerOffer - concession,
        state.marginPrice + state.strategyParams.minProfitMargin
      );
    }

    return {
      action:    "COUNTER",
      price:     Math.round(newOffer),
      reasoning: `Strategic counter — ₹${Math.round(newOffer - state.marginPrice)} profit margin`,
    };
  }

  // ================= SEND COUNTER OFFER =================
  private async sendCounterOffer(
    state: SellerNegotiationState,
    price: number,
    reasoning: string,
    logger: NegotiationLogger,
    contextId: string
  ) {
    const previousPrice        = state.lastSellerOffer ?? state.lastBuyerOffer!;
    const priceMovement        = price - previousPrice;
    const priceMovementPercent = (priceMovement / previousPrice) * 100;
    const gap                  = price - state.lastBuyerOffer!;

    logger.log({
      round:                state.currentRound,
      messageType:          "COUNTER_OFFER",
      from:                 "SELLER",
      offeredPrice:         price,
      previousPrice,
      priceMovement,
      priceMovementPercent,
      gap,
      decision:             "COUNTER_OFFER",
      reasoning,
    });

    state.lastSellerOffer = price;
    state.history.push({
      round:        state.currentRound,
      sellerOffer:  price,
      buyerOffer:   state.lastBuyerOffer,
      sellerAction: "COUNTER_OFFER",
      timestamp:    new Date().toISOString(),
      reasoning,
    });

    const counterData: CounterOfferData = {
      type:          "COUNTER_OFFER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      pricePerUnit:  price,
      previousPrice,
      from:          "SELLER",
      reasoning,
    };

    await this.sendToBuyer(counterData, contextId);
  }

  // ================= SEND ACCEPTANCE =================
  private async sendAcceptance(
    state: SellerNegotiationState,
    logger: NegotiationLogger,
    contextId: string
  ) {
    const acceptedPrice = state.lastBuyerOffer!;
    const totalAmount   = acceptedPrice * state.quantity;
    const profit        = acceptedPrice - state.marginPrice;

    logger.log({
      round:        state.currentRound,
      messageType:  "ACCEPT",
      from:         "SELLER",
      offeredPrice: acceptedPrice,
      decision:     "ACCEPT",
      reasoning:    `Profit: ₹${profit}/unit (${((profit / state.marginPrice) * 100).toFixed(1)}%)`,
    });

    state.agreedPrice   = acceptedPrice;
    state.profitPerUnit = profit;
    state.totalRevenue  = totalAmount;
    state.status        = "ACCEPTED";

    const acceptanceData: AcceptanceData = {
      type:          "ACCEPT_OFFER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      acceptedPrice,
      from:          "SELLER",
      finalTerms: {
        pricePerUnit: acceptedPrice,
        quantity:     state.quantity,
        totalAmount,
        deliveryDate: state.deliveryDate,
      },
    };

    await this.sendToBuyer(acceptanceData, contextId);
  }

  // ================= SEND INVOICE =================
  private async sendInvoice(
    state: SellerNegotiationState,
    poId: string,
    invoiceId: string,
    logger: NegotiationLogger,
    contextId: string
  ) {
    const subtotal = state.agreedPrice! * state.quantity;
    const tax      = Math.round(subtotal * 0.18);
    const total    = subtotal + tax;

    const invoiceData: InvoiceData = {
      type:          "INVOICE",
      invoiceId,
      negotiationId: state.negotiationId,
      poId,
      invoiceDate:   new Date().toISOString(),
      terms: {
        pricePerUnit: state.agreedPrice!,
        quantity:     state.quantity,
        subtotal,
        tax,
        total,
      },
      paymentTerms: `Net ${SELLER_CONFIG.dd.paymentTermsDays} days`,
      deliveryDate: state.deliveryDate,
    };

    logger.printInvoice(invoiceData);
    await this.sendToBuyer(invoiceData, contextId);
  }

  // ================= HELPERS =================
  private async sendToBuyer(data: any, contextId: string): Promise<void> {
    try {
      const buyerClient = await A2AClient.fromCardUrl(
        "http://localhost:9090/.well-known/agent-card.json"
      );

      const message: Message = {
        messageId: uuidv4(),
        kind:      "message",
        role:      "agent",
        contextId,
        parts: [
          { kind: "data", data },
          { kind: "text", text: `Negotiation ${data.type} - Round ${data.round || "N/A"}` },
        ],
      };

      const params: MessageSendParams = { message };
      const stream = buyerClient.sendMessageStream(params);

      await Promise.race([
        (async () => { for await (const _ of stream) {} })(),
        new Promise((resolve) => setTimeout(resolve, 10000)),
      ]);
    } catch (error: any) {
      if (error.code !== "UND_ERR_BODY_TIMEOUT" && error.message !== "terminated") {
        logInternal(`Send-to-buyer error: ${error.message || error}`);
      }
    }
  }

  private respond(bus: ExecutionEventBus, taskId: string, contextId: string, text: string, skipSse = false) {
    if (!skipSse) sseBroadcaster.broadcast(text);
    bus.publish({
      kind:      "status-update",
      taskId,
      contextId,
      status: {
        state:     "completed",
        timestamp: new Date().toISOString(),
        message: {
          kind:      "message",
          role:      "agent",
          messageId: uuidv4(),
          parts:     [{ kind: "text", text }],
          taskId,
          contextId,
        },
      },
      final: true,
    } as TaskStatusUpdateEvent);
  }
}

// ================= SERVER SETUP =================
const cardPath   = path.resolve(__dirname, "../../../agent-cards/jupiterSellerAgent-card.json");
const sellerCard: AgentCard = JSON.parse(fs.readFileSync(cardPath, "utf8"));

async function main() {
  const executor = new SellerAgentExecutor();
  const handler  = new DefaultRequestHandler(sellerCard, new InMemoryTaskStore(), executor);

  const app = express();
  app.use(cors());
  new A2AExpressApp(handler).setupRoutes(app);

  // SSE endpoint — UI subscribes here to receive live agent messages
  app.get('/negotiate-events', (req, res) => sseBroadcaster.addClient(req, res));

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`\n🏪  Seller Agent  →  http://localhost:${PORT}`);
    console.log(`    Margin Price : ₹${SELLER_CONFIG.marginPrice}/unit  (protected)`);
    console.log(`    Target Price : ₹${TARGET_PRICE}/unit`);
    console.log(`    Target Profit: ${(SELLER_CONFIG.targetProfitPercentage * 100).toFixed(0)}%`);
    console.log(`    Max Rounds   : ${SELLER_CONFIG.maxRounds}`);
    console.log(`    DD Safety    : ${SELLER_CONFIG.dd.safetyFactor * 100}%  |  Payment Terms: Net ${SELLER_CONFIG.dd.paymentTermsDays}`);
    console.log(`    Treasury     : ${SELLER_CONFIG.treasury.enabled ? `✓ consulting ${SELLER_CONFIG.treasury.url}` : "disabled"}\n`);
  });
}

main().catch(console.error);
