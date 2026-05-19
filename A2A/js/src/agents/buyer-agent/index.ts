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
  DecisionTrailEntry,
  ConstraintDisclosureRecord,
  RejectionData,
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

// WEDGE1 / Guarantee A — dual-parser for 'start negotiation' commands.
// Pure function, no side effects. Legacy bare-number form stays byte-identical
// (verified by scripts/test-cli-parser.ts). Flagged multi-dimensional form is
// validated but not yet wired to a code path until the seller-response-mode
// framework lands.
import { parseNegotiationCommand } from "../../shared/cli-parser.js";

// WEDGE1 / M1 — seller-response-mode framework. validateSellerResponseMode()
// throws at startup if the SELLER_RESPONSE_MODE env var is set to a
// non-shippable value (L3/L4), so the agent fails fast on misconfig rather
// than producing ambiguous audits.
// buildSellerResponseModeBlock + formatStartupBanner are used to log the
// resolved mode block in the startup banner. NOTE (CONT8 / M2-ε): the buyer's
// own /api/mode-status endpoint was REMOVED — it was misleading per Finding
// #1 (it claimed to report the seller's mode but actually reported the
// buyer's process env, which by design never sets SELLER_RESPONSE_MODE).
// The UI now fetches /api/self/mode-status from the seller agent directly
// (port 8080), per the /api/self/* convention introduced in this iteration.
// The buyer's startup banner is kept for diagnostic value but relabeled to
// "buyer-process view" so the log doesn't recreate the same confusion.
import {
  validateSellerResponseMode,
  buildSellerResponseModeBlock,
  formatStartupBanner,
} from "../../shared/negotiation-mode.js";

// ── Iteration 15: notifications (UI dashboard + WhatsApp via Meta Cloud API) ─
// The notifier reads config/notification-routing.yaml at startup and routes
// semantic AgentEvents to whichever channels are configured. The agent code
// stays vendor-agnostic — no phone numbers, no WhatsApp specifics, here.
import { getNotifier, type AgentEvent } from "../../notify/index.js";
import { attachNotificationsToAudit } from "../../notify/audit-attach.js";

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

  // Iteration 4: per-negotiation decision trail + counterparty disclosure.
  // decisionTrail   — one entry per LLM/constraint pass, written to audit JSON
  // disclosedBySeller — the sellerMin the seller voluntarily disclosed in its
  //                       ACCEPT_OFFER (after the deal). Used to populate the
  //                       audit's constraintDisclosure block. If the seller
  //                       never disclosed (older/incompatible client), the
  //                       audit records fallbackUsed instead.
  private decisionTrail    = new Map<string, DecisionTrailEntry[]>();
  private disclosedBySeller = new Map<string, { value: number; receivedAt: string; note?: string }>();

  constructor() {
    this.llmClient = new LLMNegotiationClient();
  }

  /** Iteration 4: build the constraintDisclosure audit block for the buyer side.
   *  WEDGE1 / M2-γ: prefers state.maxBudget (per-negotiation, honors the multi-dim
   *  --buyer-budget override) over the BUYER_CONFIG.maxBudget default. Falls back
   *  to the config default only if the state for this negotiationId is gone (e.g.
   *  after a future cleanup pass clears completed negotiations from this.negotiations). */
  private buildBuyerConstraintDisclosure(negotiationId: string): ConstraintDisclosureRecord {
    const state = this.negotiations.get(negotiationId);
    const effectiveBuyerMax = state?.maxBudget ?? BUYER_CONFIG.maxBudget;
    const disclosed = this.disclosedBySeller.get(negotiationId);
    if (disclosed) {
      return {
        selfReservationPrice: {
          value:    effectiveBuyerMax,
          source:   "own-config",
          currency: "INR",
        },
        disclosedByCounterparty: {
          value:      disclosed.value,
          source:     "disclosed-in-ACCEPT_OFFER",
          currency:   "INR",
          receivedAt: disclosed.receivedAt,
          note:       disclosed.note,
        },
      };
    }
    // No disclosure received — audit explicitly records the fallback so a
    // reviewer can see we did not silently make up the value.
    return {
      selfReservationPrice: {
        value:    effectiveBuyerMax,
        source:   "own-config",
        currency: "INR",
      },
      fallbackUsed: {
        value:  350,
        source: "demo-constant",
        reason: "counterparty did not disclose sellerMin in ACCEPT_OFFER (older client or disclosure suppressed)",
      },
    };
  }

  /** Iteration 4: read the sellerMin (if any) that came over the wire and store it. */
  private captureSellerDisclosure(negotiationId: string, data: AcceptanceData) {
    if (data.disclosed?.reservationPrice !== undefined) {
      this.disclosedBySeller.set(negotiationId, {
        value:      data.disclosed.reservationPrice,
        receivedAt: new Date().toISOString(),
        note:       data.disclosed.note,
      });
      logInternal(`[disclose] seller disclosed sellerMin=₹${data.disclosed.reservationPrice} (audit-only, not echoed to chat)`);
    }
  }

  /** Iteration 4: resolve the sellerMin used in outcomeQualityInputs (disclosed > fallback). */
  private resolveSellerMin(negotiationId: string): number {
    return this.disclosedBySeller.get(negotiationId)?.value ?? 350;
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

    // WEDGE1 / Guarantee A: route 'start negotiation' through the dual-parser.
    // Legacy bare-number form ("start negotiation 300") keeps identical behavior
    // to the prior product. Flagged multi-dimensional form is recognized but
    // routed to a stub response until the seller-response-mode framework lands. Invalid forms
    // produce an explicit error in chat instead of silently triggering a
    // random-price negotiation (the previous fall-through behavior).
    const parsed = parseNegotiationCommand(textInput);
    if (parsed !== null) {
      if (parsed.form === "legacy") {
        await this.startNegotiation(contextId, bus, taskId, parsed.price);
        return;
      }
      if (parsed.form === "flagged") {
        // CONT8 / M2-ε — form 3 (scenario-driven) brings scenarioIntent along
        // for the ride. Today we log it so the operator can see what was
        // declared; we do NOT yet alter agent behavior based on it. Wiring
        // intent fields (goal, style, soft preferences, walk-away) through
        // to agent decisions is a separate work-stream (FRAMEWORK-V2 §12 D7).
        if (parsed.scenarioIntent) {
          logInternal(
            `[scenario] loaded "${parsed.scenarioIntent.id}" — "${parsed.scenarioIntent.title}". ` +
            `Buyer goal=${parsed.scenarioIntent.buyerIntent.goal} ` +
            `style=${parsed.scenarioIntent.buyerIntent.style} ` +
            `walk-away=${parsed.scenarioIntent.buyerIntent.walkAwayBehavior}. ` +
            `Honored today: product, quantity, maxBudgetPerUnit. ` +
            `Deferred (declared but not yet honored): ${(parsed.scenarioDeferred ?? []).join("; ")}.`
          );
          this.respond(bus, taskId, contextId,
            `🎯 Scenario "${parsed.scenarioIntent.title}" loaded.\n` +
            `   Buyer intent: goal=${parsed.scenarioIntent.buyerIntent.goal}, style=${parsed.scenarioIntent.buyerIntent.style}\n` +
            `   Seller intent: goal=${parsed.scenarioIntent.sellerIntent.goal}, mode=${parsed.scenarioIntent.sellerIntent.hardConstraints.sellerResponseMode ?? "(unset)"}\n` +
            `   ⓘ Today the agents honor product, quantity, and budget from the intent. ` +
            `Other intent fields are declared but deferred to a future iteration.`
          );
        }

        // WEDGE1 / M2-γ — wire-in. Pass the parsed dimensions to startNegotiation as
        // an opt-in second parameter. The legacy bare-number form leaves multiDim
        // undefined, so its code path is byte-identical to the prior product
        // (Guarantee A preserved; cli-parser regression test still passes).
        await this.startNegotiation(contextId, bus, taskId, undefined, {
          productCode:   parsed.product,
          quantity:      parsed.quantity,
          buyerBudget:   parsed.buyerBudget,
          buyerStyle:    parsed.buyerStyle,
          buyerDeadline: parsed.buyerDeadline,
        });
        return;
      }
      // parsed.form === "invalid"
      this.respond(bus, taskId, contextId, `❌ ${parsed.error}`);
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
  //
  // Two ways this can be called:
  //   (1) Legacy form  — userPrice may be set (or random), multiDim is undefined.
  //                       Behavior is byte-identical to the prior product.
  //   (2) Multi-dim form (WEDGE1 / M2-γ) — userPrice is undefined; multiDim carries
  //                       product, quantity, buyer budget, TKI style, deadline.
  //                       Budget overrides BUYER_CONFIG.maxBudget, quantity overrides
  //                       BUYER_CONFIG.targetQuantity, deadline overrides the default
  //                       (today + 60 days). Product and style propagate to the seller
  //                       via OfferData.productCode / OfferData.buyerStyle so the
  //                       seller's L2 wire can pass productCode to the inventory/
  //                       credit/logistics sub-agents in their consultation input.
  private async startNegotiation(
    contextId: string,
    bus:       ExecutionEventBus,
    taskId:    string,
    userPrice?: number,
    multiDim?: {
      productCode:   string;
      quantity:      number;
      buyerBudget:   number;
      buyerStyle:    string;
      buyerDeadline: string;     // ISO date already validated by cli-parser
    },
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

    // WEDGE1 / M2-γ — apply multi-dim overrides when present. The ?? operator
    // means the legacy form (multiDim === undefined) falls through to the exact
    // same values as before. The flagged form replaces them with the user-supplied
    // numbers from cli-parser (already validated: positive qty, positive budget,
    // parseable date).
    const effectiveQuantity     = multiDim?.quantity      ?? BUYER_CONFIG.targetQuantity;
    const effectiveMaxBudget    = multiDim?.buyerBudget   ?? BUYER_CONFIG.maxBudget;
    const effectiveDeliveryDate = multiDim?.buyerDeadline ?? this.getDeliveryDate();

    const state: BuyerNegotiationState = {
      negotiationId,
      contextId,
      status:         "INITIATED",
      targetQuantity: effectiveQuantity,
      maxBudget:      effectiveMaxBudget,
      deliveryDate:   effectiveDeliveryDate,
      currentRound:   1,
      maxRounds:      BUYER_CONFIG.maxRounds,
      history:        [],
      lastBuyerOffer: initialOffer,
      strategyParams: {
        ...BUYER_CONFIG.strategyParams,
        initialOfferRange: BUYER_CONFIG.initialOfferRange,
      },
      // WEDGE1 / M2-γ — multi-dim context (undefined in legacy form)
      productCode: multiDim?.productCode,
      buyerStyle:  multiDim?.buyerStyle,
    };

    this.negotiations.set(negotiationId, state);
    logger.printRoundHeader(1, BUYER_CONFIG.maxRounds);

    // Iter 15: notify both sides — negotiation started + buyer's opening offer
    const buyerMetaForEvent  = readAgentCardMetadata("tommyBuyerAgent");
    const sellerMetaForEvent = readAgentCardMetadata("jupiterSellerAgent");
    await getNotifier().publish({
      type:          "negotiation-started",
      perspective:   "BUYER",
      negotiationId,
      timestamp:     new Date().toISOString(),
      payload: {
        counterpartyName: sellerMetaForEvent?.legalEntityName ?? "Counterparty",
        // WEDGE1 / M2-γ — reflect multi-dim overrides in the notification payload
        // (previously hardcoded to BUYER_CONFIG which ignored --qty / --product flags).
        quantity:         state.targetQuantity,
        product:          state.productCode ?? "fabric units",
        deliveryDate:     state.deliveryDate,
      },
    } as AgentEvent);
    await getNotifier().publish({
      type:          "own-offer-sent",
      perspective:   "BUYER",
      negotiationId,
      round:         1,
      timestamp:     new Date().toISOString(),
      payload: {
        action:    "offer",
        price:     initialOffer,
        reasoning: userPrice ? "Opening at user-specified price" : "Opening offer with negotiation headroom",
      },
    } as AgentEvent);

    const offerData: OfferData = {
      type: "OFFER", negotiationId,
      round: 1, timestamp: new Date().toISOString(),
      pricePerUnit: initialOffer, quantity: state.targetQuantity,
      from: "BUYER", deliveryDate: state.deliveryDate,
      // WEDGE1 / M2-γ — propagate multi-dim context to seller. Undefined in legacy
      // form. Seller's handleBuyerOffer reads these into SellerNegotiationState
      // and runL2Path passes productCode to the sub-agent consultations.
      productCode: state.productCode,
      buyerStyle:  state.buyerStyle,
    };

    logger.log({ round: 1, messageType: "OFFER", from: "BUYER",
      offeredPrice: initialOffer, decision: "OFFER",
      reasoning: `Opening at ₹${initialOffer}, leaving negotiation room` });

    state.history.push({ round: 1, buyerOffer: initialOffer,
      buyerAction: "OFFER", timestamp: new Date().toISOString() });

    await this.sendToSeller(offerData, contextId);
    // Iter-4.3: embed "Round 1" in the text so the UI parser extracts the
    // round directly instead of trying to infer it from arrival order. With
    // two independent SSE channels (buyer :9090, seller :8080), inferring
    // round from sequence is unreliable.
    if (multiDim) {
      // WEDGE1 / M2-γ — richer banner for the multi-dim form so the operator
      // sees what dimensions are in force this negotiation.
      this.respond(bus, taskId, contextId,
        `✓ Multi-dimensional negotiation started (Round 1)\n` +
        `Product : ${multiDim.productCode}\n` +
        `Quantity: ${state.targetQuantity} units\n` +
        `Budget  : ₹${state.maxBudget}/unit  |  Style: ${multiDim.buyerStyle}\n` +
        `Deadline: ${state.deliveryDate}\n` +
        `Initial offer: ₹${initialOffer}/unit\n` +
        `Waiting for seller response...`);
    } else {
      this.respond(bus, taskId, contextId,
        `✓ Negotiation started (Round 1)\nInitial offer: ₹${initialOffer}/fabric unit  |  Qty: ${state.targetQuantity} fabric units\nWaiting for seller response...`);
    }
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
      return this.handleSellerRejection(data as RejectionData, state, logger, bus, taskId, contextId);
    }
  }

  // ================= HANDLE SELLER REJECTION (iter-4 fix) =================
  /**
   * Seller refused to close in the final round. Now we (a) log it, (b) write
   * buyer-side audit JSON with outcome="escalation" so /deal-quality lists
   * the failed deal, (c) print a clear "escalated to human" message in the
   * buyer chat.
   */
  private async handleSellerRejection(
    data: RejectionData,
    state: BuyerNegotiationState,
    logger: NegotiationLogger,
    bus: ExecutionEventBus,
    taskId: string,
    contextId: string,
  ) {
    logger.log({
      round:       state.currentRound,
      messageType: "REJECT",
      from:        "SELLER",
      decision:    "REJECT",
      reasoning:   data.reason,
    });
    state.status = "REJECTED";

    const buyerFinalOffer  = state.lastBuyerOffer  ?? 0;
    const sellerFinalOffer = state.lastSellerOffer ?? 0;
    const gap              = Math.max(0, sellerFinalOffer - buyerFinalOffer);

    logger.printNegotiationSummary("FAILED", {
      roundsUsed: state.currentRound,
      maxRounds:  state.maxRounds,
      quantity:   state.targetQuantity,
    });

    // .txt escalation report for human review
    const reportPath = logger.saveEscalationReport({
      buyerFinalOffer, sellerFinalOffer, gap,
      rounds:       state.currentRound,
      maxRounds:    state.maxRounds,
      quantity:     state.targetQuantity,
      deliveryDate: state.deliveryDate,
      logs:         logger.getLogs(),
    });
    logger.printEscalationNotice(buyerFinalOffer, sellerFinalOffer, gap, reportPath);

    // Audit JSON — outcome="escalation" so /deal-quality shows it.
    const sellerMetaEsc = readAgentCardMetadata("jupiterSellerAgent");
    const buyerMetaEsc  = readAgentCardMetadata("tommyBuyerAgent");
    const sellerMinEsc  = this.resolveSellerMin(state.negotiationId);
    const auditPathEsc  = logger.saveAuditJson({
      outcome:         "escalation",
      finalPrice:      Math.round((buyerFinalOffer + sellerFinalOffer) / 2),
      quantity:        state.targetQuantity,
      deliveryDate:    state.deliveryDate,
      paymentTerms:    "Net 30",
      roundsUsed:      state.currentRound,
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
        // WEDGE1 / M2-γ — state.maxBudget honors multi-dim --buyer-budget override
        buyerMax:      state.maxBudget,
        sellerMin:     sellerMinEsc,
        quantity:      state.targetQuantity,
        currency:      "INR",
      },
      decisions:           this.decisionTrail.get(state.negotiationId) as unknown as Record<string, unknown>[],
      constraintDisclosure: this.buildBuyerConstraintDisclosure(state.negotiationId) as unknown as Record<string, unknown>,
      extras: {
        rejectedBySeller: true,
        rejectionReason:  data.reason,
        buyerFinalOffer,
        sellerFinalOffer,
        gap,
      },
    });
    logInternal(`[audit] JSON written (rejection-as-escalation): ${auditPathEsc}`);

    // Iter 15: attach notification receipts to the audit (slight delay so
    // async WhatsApp sends have time to return before we drain receipts).
    setTimeout(() => attachNotificationsToAudit(auditPathEsc, state.negotiationId), 1500);

    // Iter 15: notify — escalation
    const buyerUrlForEsc1 = `http://localhost:${process.env.PORT ?? 9090}`;
    await getNotifier().publish({
      type:          "escalation",
      perspective:   "BUYER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        reason:   `Seller rejected our final offer of ₹${buyerFinalOffer}. ${data.reason ?? ""}`,
        auditUrl: `${buyerUrlForEsc1}/api/quality/${state.negotiationId}/pdf`,
      },
    } as AgentEvent);

    this.respond(
      bus, taskId, contextId,
      `✗ NO DEAL — seller rejected our final offer of ₹${buyerFinalOffer}.\n` +
      `Seller's final ask was ₹${sellerFinalOffer} (gap: ₹${gap}).\n` +
      `Reason: ${data.reason}\n` +
      `⚠ escalated to human procurement officer for review.\n` +
      `Report saved → ${reportPath}`,
    );
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

    // Iteration 4: capture seller's disclosed sellerMin (audit-only, NOT shown in chat).
    this.captureSellerDisclosure(state.negotiationId, data);

    logger.log({ round: state.currentRound, messageType: "ACCEPT", from: "SELLER",
      offeredPrice: data.acceptedPrice, decision: "ACCEPT", reasoning: "Seller accepted our offer" });

    // Iter 15: notify — counterparty accepted (visible on buyer WhatsApp/UI)
    await getNotifier().publish({
      type:          "counterparty-offer-received",
      perspective:   "SELLER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        action: "accept",
        price:  data.acceptedPrice,
      },
    } as AgentEvent);

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
    const sellerMinForAudit  = this.resolveSellerMin(state.negotiationId);
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
        // WEDGE1 / M2-γ — state.maxBudget honors multi-dim --buyer-budget override
        buyerMax:      state.maxBudget,
        sellerMin:     sellerMinForAudit,   // iter-4: disclosed value when available
        quantity:      state.targetQuantity,
        currency:      "INR",
      },
      // Iteration 4 — decision trail + constraint disclosure
      decisions:           this.decisionTrail.get(state.negotiationId) as unknown as Record<string, unknown>[],
      constraintDisclosure: this.buildBuyerConstraintDisclosure(state.negotiationId) as unknown as Record<string, unknown>,
    });
    logInternal(`[audit] JSON written: ${auditPath}`);

    // Iter 15: attach notification receipts to the audit
    setTimeout(() => attachNotificationsToAudit(auditPath, state.negotiationId), 1500);

    // Iter 15: notify — deal closed
    const buyerUrlForDeal = `http://localhost:${process.env.PORT ?? 9090}`;
    await getNotifier().publish({
      type:          "deal-closed",
      perspective:   "BUYER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        finalPrice:  data.acceptedPrice,
        quantity:    state.targetQuantity,
        buyerShare:  undefined,  // outcomeQuality computed inside audit-writer; not echoed here to keep WhatsApp short
        sellerShare: undefined,
        auditUrl:    `${buyerUrlForDeal}/api/quality/${state.negotiationId}/pdf`,
      },
    } as AgentEvent);

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

    // Iter 15: notify — seller countered
    await getNotifier().publish({
      type:          "counterparty-offer-received",
      perspective:   "SELLER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        action: "counter",
        price:  data.pricePerUnit,
        gap:    (state.lastBuyerOffer !== undefined) ? data.pricePerUnit - state.lastBuyerOffer : undefined,
      },
    } as AgentEvent);

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
      const sellerMinForAudit2  = this.resolveSellerMin(state.negotiationId);
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
          // WEDGE1 / M2-γ — state.maxBudget honors multi-dim --buyer-budget override
          buyerMax:      state.maxBudget,
          sellerMin:     sellerMinForAudit2,
          quantity:      state.targetQuantity,
          currency:      "INR",
        },
        // Iteration 4 — decision trail + constraint disclosure
        decisions:           this.decisionTrail.get(state.negotiationId) as unknown as Record<string, unknown>[],
        constraintDisclosure: this.buildBuyerConstraintDisclosure(state.negotiationId) as unknown as Record<string, unknown>,
      });
      logInternal(`[audit] JSON written: ${auditPath2}`);

      // Iter 15: attach notification receipts to the audit
      setTimeout(() => attachNotificationsToAudit(auditPath2, state.negotiationId), 1500);

      // Iter 15: notify — deal closed (buyer accepts seller's counter)
      const buyerUrlForDeal2 = `http://localhost:${process.env.PORT ?? 9090}`;
      await getNotifier().publish({
        type:          "deal-closed",
        perspective:   "BUYER",
        negotiationId: state.negotiationId,
        round:         state.currentRound,
        timestamp:     new Date().toISOString(),
        payload: {
          finalPrice: data.pricePerUnit,
          quantity:   state.targetQuantity,
          auditUrl:   `${buyerUrlForDeal2}/api/quality/${state.negotiationId}/pdf`,
        },
      } as AgentEvent);

      this.respond(bus, taskId, contextId,
        `✓✓ Deal Closed!\n\nFinal Price : ₹${data.pricePerUnit}/fabric unit\nTotal       : ₹${(data.pricePerUnit * state.targetQuantity).toLocaleString()}\nPurchase Order sent to seller.`);

    } else if (decision.action === "COUNTER") {
      // Iter 15: notify — buyer's own counter-offer
      await getNotifier().publish({
        type:          "own-offer-sent",
        perspective:   "BUYER",
        negotiationId: state.negotiationId,
        round:         state.currentRound,
        timestamp:     new Date().toISOString(),
        payload: {
          action:    "counter",
          price:     decision.price,
          reasoning: decision.reasoning,
          gap:       state.lastSellerOffer !== undefined && decision.price !== undefined
                       ? state.lastSellerOffer - decision.price
                       : undefined,
        },
      } as AgentEvent);

      // Iter-4.3 race-fix: broadcast SSE FIRST, then do the A2A send. This
      // means the template literal evaluates BEFORE any await, so
      // state.currentRound cannot be mutated by a parallel handler before we
      // read it. The previous version snapshotted into a const, which is
      // equivalent but more fragile — broadcasting first removes the window
      // entirely.
      this.respond(bus, taskId, contextId,
        `↑ Counter-offer sent (Round ${state.currentRound}): ₹${decision.price}/fabric unit\nWaiting for seller response...`);
      await this.sendCounterOffer(state, decision.price!, decision.reasoning, logger, contextId);
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
    const sellerMinEsc  = this.resolveSellerMin(state.negotiationId);
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
        // WEDGE1 / M2-γ — state.maxBudget honors multi-dim --buyer-budget override
        buyerMax:      state.maxBudget,
        sellerMin:     sellerMinEsc,
        quantity:      state.targetQuantity,
        currency:      "INR",
      },
      // Iteration 4 — decision trail + constraint disclosure
      decisions:           this.decisionTrail.get(state.negotiationId) as unknown as Record<string, unknown>[],
      constraintDisclosure: this.buildBuyerConstraintDisclosure(state.negotiationId) as unknown as Record<string, unknown>,
      extras: {
        buyerFinalOffer, sellerFinalOffer, gap,
      },
    });
    logInternal(`[audit] JSON written (escalation): ${auditPathEsc}`);

    // Iter 15: attach notification receipts to the audit
    setTimeout(() => attachNotificationsToAudit(auditPathEsc, state.negotiationId), 1500);

    // Iter 15: notify — escalation (rounds exhausted)
    const buyerUrlForEsc2 = `http://localhost:${process.env.PORT ?? 9090}`;
    await getNotifier().publish({
      type:          "escalation",
      perspective:   "BUYER",
      negotiationId: state.negotiationId,
      round:         state.maxRounds,
      timestamp:     new Date().toISOString(),
      payload: {
        reason:   `Negotiation rounds exhausted with ₹${gap} gap (buyer ₹${buyerFinalOffer} vs seller ₹${sellerFinalOffer})`,
        auditUrl: `${buyerUrlForEsc2}/api/quality/${state.negotiationId}/pdf`,
      },
    } as AgentEvent);

    await this.sendToSeller({
      type: "ESCALATION_NOTICE", negotiationId: state.negotiationId,
      round: state.maxRounds, timestamp: new Date().toISOString(),
      from: "BUYER", buyerFinalOffer, sellerFinalOffer, gap, reportPath,
    } as EscalationNoticeData, contextId);

    this.respond(bus, taskId, contextId,
      `✗ NO DEAL — escalated to human procurement officer for review.\n` +
      `Buyer's final offer: ₹${buyerFinalOffer}  |  Seller's final offer: ₹${sellerFinalOffer}  (gap: ₹${gap})\n` +
      `Rounds used: ${state.maxRounds} of ${state.maxRounds}\n` +
      `Report saved → ${reportPath}`);
  }

  // ================= HYBRID DECISION MAKING =================
  private async makeNegotiationDecision(state: BuyerNegotiationState): Promise<NegotiationDecision> {
    // Iteration 4: capture full decision context for audit trail.
    const marketBefore = await getMarketSnapshot();
    const llmDecision  = await this.getLLMDecision(state);

    const llmProposalSnapshot = {
      action:    llmDecision.action,
      price:     llmDecision.price,
      reasoning: llmDecision.reasoning,
    };

    const validatedDecision = this.applyBuyerConstraints({ ...llmDecision }, state);
    let finalDecision: NegotiationDecision;
    let usedFallback = false;

    if (!validatedDecision) {
      logInternal("LLM decision invalid — using rule-based fallback");
      finalDecision = this.ruleBasedDecision(state);
      usedFallback  = true;
    } else {
      finalDecision = validatedDecision;
    }

    // Build the decision trail entry. constraintAdjustment is recorded only
    // if the validator actually changed action or price (not just appended to
    // reasoning), to avoid noisy entries.
    const constraintChanged =
      validatedDecision &&
      (validatedDecision.action !== llmDecision.action ||
       validatedDecision.price  !== llmDecision.price);

    const entry: DecisionTrailEntry = {
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      perspective:   "BUYER",
      incomingOffer: state.lastSellerOffer,
      llmProposal: {
        ...llmProposalSnapshot,
        usedFallback,
      },
      constraintAdjustment: constraintChanged && validatedDecision
        ? {
            action:    validatedDecision.action,
            price:     validatedDecision.price,
            reasoning: validatedDecision.reasoning,
          }
        : undefined,
      finalDecision: {
        action: finalDecision.action,
        price:  finalDecision.price,
      },
      marketContext: {
        sofrRate:               marketBefore.sofrRate,
        sofrSource:             marketBefore.sofrSource,
        effectiveBorrowingRate: marketBefore.effectiveBorrowingRate,
        cottonPricePerLb:       marketBefore.cottonPricePerLb,
        capturedAt:             new Date().toISOString(),
      },
    };
    const trail = this.decisionTrail.get(state.negotiationId) ?? [];
    trail.push(entry);
    this.decisionTrail.set(state.negotiationId, trail);

    return finalDecision;
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
    // Iter-4.1: Concession sanity check. The LLM (and the rule-based fallback)
    // can decide to ACCEPT any seller price under maxBudget, even when it
    // would be a huge unilateral concession from the buyer's last counter.
    // Real procurement officers don't roll over like that. If the gap between
    // buyer's last offer and seller's current offer is > 30% of the buyer's
    // last offer, refuse the ACCEPT:
    //   - if buyer has rounds left, counter at the midpoint
    //   - if this IS the final round, REJECT (will trigger escalation when
    //     the buyer's currentRound exceeds maxRounds on next seller response
    //     — actually for the final-round case we counter once more and let
    //     the seller's response drive escalation, which is the cleaner UX).
    if (
      decision.action === "ACCEPT" &&
      state.lastSellerOffer !== undefined &&
      state.lastBuyerOffer  !== undefined &&
      state.lastSellerOffer <= state.maxBudget
    ) {
      const gap         = state.lastSellerOffer - state.lastBuyerOffer;
      const gapPercent  = gap / state.lastBuyerOffer;
      const CONCESSION_THRESHOLD = 0.30; // 30%
      if (gapPercent > CONCESSION_THRESHOLD) {
        const midpoint = Math.round((state.lastBuyerOffer + state.lastSellerOffer) / 2);
        const counterPrice = Math.min(midpoint, state.maxBudget);
        logInternal(
          `Sanity check: blocking ACCEPT at ₹${state.lastSellerOffer} — ` +
          `gap from own last offer ₹${state.lastBuyerOffer} is ` +
          `${(gapPercent * 100).toFixed(1)}% (> ${(CONCESSION_THRESHOLD * 100).toFixed(0)}% threshold). ` +
          `Countering at midpoint ₹${counterPrice} instead (round ${state.currentRound}).`
        );
        decision.action    = "COUNTER";
        decision.price     = counterPrice;
        decision.reasoning =
          `Seller ₹${state.lastSellerOffer} is ${(gapPercent * 100).toFixed(0)}% above our last offer ₹${state.lastBuyerOffer}. ` +
          `Countering at midpoint ₹${counterPrice} before considering acceptance.`;
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

    // Iter-4.1: Round-3 rule-based threshold was opening a backdoor —
    // anything ≤ ₹380 was accepted regardless of buyer's last offer. Now also
    // require seller's offer to be close to buyer's last counter (≤ +₹30) so
    // the rule-based fallback can't capitulate either. Earlier rounds keep
    // their flat thresholds since the buyer still has rounds to negotiate.
    if (state.currentRound === state.maxRounds) {
      const nearBuyerOffer = sellerOffer <= lastBuyerOffer + 30;
      if (sellerOffer <= threshold && sellerOffer <= state.maxBudget && nearBuyerOffer)
        return { action: "ACCEPT", reasoning: `Final round: seller ₹${sellerOffer} is within ₹30 of our last offer ₹${lastBuyerOffer}` };
      if (sellerOffer <= state.maxBudget + 10 && nearBuyerOffer)
        return { action: "ACCEPT", reasoning: "Final round — accepting near-budget offer close to our last counter" };
      // Otherwise fall through to counter (or eventual escalation via maxRounds check).
    } else {
      if (sellerOffer <= threshold && sellerOffer <= state.maxBudget)
        return { action: "ACCEPT", reasoning: `Seller ₹${sellerOffer} meets round ${state.currentRound} threshold` };
    }

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
      // Iteration 4: voluntarily disclose our maxBudget so the seller's audit
      // can record the bargaining-zone bounds it knew at deal-close. Audit-only.
      // Not echoed to chat UI.
      // WEDGE1 / M2-γ — state.maxBudget honors multi-dim --buyer-budget override.
      disclosed: {
        reservationPrice: state.maxBudget,
        currency:         "INR",
        note:             "audit-only constraint disclosure (iter-4)",
      },
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
          { kind: "data", data: sealed as unknown as Record<string, unknown> },
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

// Iter 15: initialize the notification router (loads YAML, registers channels).
// Reuse the existing sseBroadcaster so the ui-dashboard channel pushes into
// the same SSE stream the agent code already writes to.
await getNotifier().initialize({ sharedBroadcaster: sseBroadcaster, agentLabel: "buyer" });

// SSE endpoint — UI subscribes here to receive live agent messages
app.get('/negotiate-events', (req, res) => sseBroadcaster.addClient(req, res));

// Iter 15: notification-status endpoint — UI shows which channels are active
app.get('/api/notify-status', (_req, res) => {
  try {
    res.json({ channels: getNotifier().status() });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "unknown" });
  }
});

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
      return void res.json({
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
    return void res.json({
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

// ── /api/recent-deals — list deals with optional filters (iter 7 enhancement) ─
// Backwards compatible: no query params = same as before (last 20, no filters).
// Query params (all optional):
//   limit        max number of deals to return (default 20, max 500)
//   outcome      'success' | 'escalation' — filter by outcome
//   counterparty substring match against counterparty legal entity name
//   from         ISO date — only deals closed at or after
//   to           ISO date — only deals closed at or before
app.get('/api/recent-deals', (req, res) => {
  try {
    if (!fs.existsSync(escalationsDir)) {
      return void res.json({ deals: [] });
    }
    const q = req.query as Record<string, string | undefined>;
    const limit        = Math.min(500, Math.max(1, parseInt(q.limit ?? "20", 10) || 20));
    const outcomeF     = q.outcome?.toLowerCase();
    const counterpartyF= q.counterparty?.toLowerCase();
    const fromMs       = q.from ? Date.parse(q.from) : NaN;
    const toMs         = q.to   ? Date.parse(q.to)   : NaN;

    const all = fs.readdirSync(escalationsDir)
      .filter(f => f.endsWith("_BUYER.audit.json"))
      .map(f => ({
        name: f,
        path: path.join(escalationsDir, f),
        mtime: fs.statSync(path.join(escalationsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    const deals: any[] = [];
    for (const { name, path: fp } of all) {
      let audit: any;
      try {
        audit = JSON.parse(fs.readFileSync(fp, "utf8"));
      } catch {
        deals.push({ negotiationId: name.replace("_BUYER.audit.json", ""), error: "unparseable" });
        if (deals.length >= limit) break;
        continue;
      }
      const closedAtMs = audit.generatedAt ? Date.parse(audit.generatedAt) : NaN;
      if (outcomeF && (audit.outcome ?? "").toLowerCase() !== outcomeF) continue;
      if (counterpartyF) {
        const cp = (audit.parties?.counterparty?.legalEntityName ?? "").toLowerCase();
        if (!cp.includes(counterpartyF)) continue;
      }
      if (!Number.isNaN(fromMs) && (Number.isNaN(closedAtMs) || closedAtMs < fromMs)) continue;
      if (!Number.isNaN(toMs)   && (Number.isNaN(closedAtMs) || closedAtMs > toMs))   continue;
      deals.push({
        negotiationId: audit.negotiationId,
        outcome:       audit.outcome,
        finalPrice:    audit.negotiation?.finalPrice,
        quantity:      audit.negotiation?.quantity,
        roundsUsed:    audit.negotiation?.roundsUsed,
        closedAt:      audit.generatedAt,
        counterparty:  audit.parties?.counterparty?.legalEntityName,
        summary:       audit.outcomeQuality?.summary,
      });
      if (deals.length >= limit) break;
    }
    res.json({ deals, totalReturned: deals.length, limitApplied: limit });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "unknown" });
  }
});

// ── Iteration 5: Baseline endpoint ─────────────────────────────────────────
// Returns the latest fixture-replay baseline if one has been generated by
// `npm run replay:fixtures`. If no baseline file exists yet, returns 404 with
// a clear hint — UI shows a prompt to run the replay script.
const baselinesDir = path.resolve(__dirname, "..", "..", "..", "baselines");
app.get('/api/baseline', (_req, res) => {
  try {
    const fp = path.join(baselinesDir, "baseline-latest.json");
    if (!fs.existsSync(fp)) {
      return void res.status(404).json({
        error:    "No baseline generated yet",
        hint:     "Run `npm run replay:fixtures` in A2A/js to generate the baseline.",
        expected: fp,
      });
    }
    const stat = fs.statSync(fp);
    const baseline = JSON.parse(fs.readFileSync(fp, "utf8"));
    // Add a freshness header so the UI can warn if the baseline is stale
    // relative to the escalations dir (e.g. new deals added after last replay).
    let escalationsMtimeMs: number | null = null;
    try {
      escalationsMtimeMs = fs.statSync(escalationsDir).mtimeMs;
    } catch { /* dir missing — leave null */ }
    res.json({
      ...baseline,
      _meta: {
        baselineFileMtimeMs:  stat.mtimeMs,
        baselineFilePath:     fp,
        escalationsMtimeMs,
        stale: escalationsMtimeMs !== null && escalationsMtimeMs > stat.mtimeMs,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "unknown" });
  }
});

// ── Iteration 6: Signing-mode + mode-matrix endpoints ──────────────────────
// /api/signing-mode reports SIGNING_MODE env var (plain | vlei).
// /api/mode-matrix combines credential + signing mode into one payload so the
// UI's 2×2 mode-matrix card can be rendered from one fetch.
app.get('/api/signing-mode', (_req, res) => {
  const raw  = (process.env.SIGNING_MODE ?? "plain").toLowerCase();
  const mode = raw === "vlei" ? "vlei" : "plain";
  res.json({
    mode,
    envVar:      "SIGNING_MODE",
    rawValue:    process.env.SIGNING_MODE ?? "(unset → defaults to plain)",
    description: mode === "vlei"
      ? "Per-message KERI Ed25519 signing via signify-ts (deferred to iter 14 — currently throws)"
      : "Per-message sha256 hash envelope with monotonic counter + freshness window (NOT a KERI seal)",
  });
});

app.get('/api/mode-matrix', (_req, res) => {
  const credRaw  = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase();
  const credMode = credRaw === "vlei" ? "vlei" : "plain";
  const signRaw  = (process.env.SIGNING_MODE ?? "plain").toLowerCase();
  const signMode = signRaw === "vlei" ? "vlei" : "plain";
  res.json({
    current: {
      credential: credMode,
      signing:    signMode,
    },
    cells: [
      { credential: "plain", signing: "plain", supported: true,  label: "Demo / dev mode",                                  envHint: "CREDENTIAL_MODE=plain SIGNING_MODE=plain" },
      { credential: "plain", signing: "vlei",  supported: false, label: "Wire-signed without identity — deferred to iter 14", envHint: "CREDENTIAL_MODE=plain SIGNING_MODE=vlei" },
      { credential: "vlei",  signing: "plain", supported: true,  label: "vLEI identity, hash-envelope wire (iter 1 baseline)", envHint: "CREDENTIAL_MODE=vlei SIGNING_MODE=plain" },
      { credential: "vlei",  signing: "vlei",  supported: false, label: "Full vLEI end-to-end — deferred to iter 14",         envHint: "CREDENTIAL_MODE=vlei SIGNING_MODE=vlei" },
    ],
    note: "Mode is set via env vars at agent startup. To change mode, edit .env and restart the agents (no hot reload — by design, to keep the audit trail unambiguous about which mode produced each deal).",
  });
});

// ── WEDGE1 / M1: Seller-response-mode-status endpoint ──────────────────────────────────────
// Returns the seller-response-mode resolved from env, plus the capability
// matrix and provider modes. The UI's mode card fetches this and renders it
// alongside the existing mode-matrix card. Reads env on each call so /settings
// reflects the actual running state (no caching).
// REMOVED app.get('/api/mode-status') in CONT8 / M2-ε — see note above.
// The handler body below is unreachable (no route registered against it).
// Kept temporarily because the surrounding em-dash comment-header bytes were
// fragile for atomic str-replace; will be deleted in a follow-up cleanup
// pass. UI Settings card now fetches /api/self/mode-status from the seller
// agent directly (http://localhost:8080/api/self/mode-status).
app.get('/api/__removed__mode-status', (_req, res) => {
  try {
    const block = buildSellerResponseModeBlock();
    // We also include the human-friendly description of each mode so the UI
    // can render a small caption next to each row.
    const modeDescriptions: Record<string, string> = {
      "BASIC_SALES_QUOTING_1":       "Treasury-only — today's product baseline",
      "L1_DELEGATED_ADVISORS":       "Adds Inventory + Logistics sub-agents",
      "L2_EXECUTIVE_REASONER":       "Adds Credit sub-agent + Advisor math aggregator + L2 executive judgment (WEDGE1 ceiling)",
      "L3_STYLE_AND_AUTONOMY":       "Adds Style framework, opponent inference, autonomy levels (post-WEDGE1)",
      "L4_LEARNED_PROFILES_AND_PD":  "Adds per-counterparty profiles, custom PD models (post-WEDGE1)",
    };
    res.json({
      ...block,
      modeDescriptions,
      // Help the UI explain how to change the mode
      changeInstructions:
        "Seller response mode is set by SELLER_RESPONSE_MODE env var at agent startup. " +
        "Edit A2A/js/src/agents/*/.env and restart agents (no hot reload — " +
        "by design, so audit can't have ambiguous mode).",
    });
  } catch (err: any) {
    // Should only happen if env is set to a literal invalid string
    res.status(500).json({
      error:   err?.message ?? "mode-status endpoint error",
      hint:    "Check SELLER_RESPONSE_MODE in .env — must be unset, BASIC_SALES_QUOTING_1, L1_DELEGATED_ADVISORS, L2_EXECUTIVE_REASONER, L3_STYLE_AND_AUTONOMY, or L4_LEARNED_PROFILES_AND_PD.",
    });
  }
});

// ── Iteration 7: Signed PDF audit endpoint ─────────────────────────────────
// GET /api/quality/:negotiationId/pdf streams a PDF rendered from the BUYER
// audit.json. Returns 404 if no audit JSON exists for that negotiation id.
app.get('/api/quality/:negotiationId/pdf', async (req, res) => {
  const { negotiationId } = req.params;
  if (!/^NEG-\d+$/.test(negotiationId)) {
    return void res.status(400).json({ error: "Invalid negotiationId format" });
  }
  try {
    const candidates = [
      path.join(escalationsDir, `${negotiationId}_success_BUYER.audit.json`),
      path.join(escalationsDir, `${negotiationId}_escalation_BUYER.audit.json`),
    ];
    let auditPath: string | null = null;
    for (const fp of candidates) {
      if (fs.existsSync(fp)) { auditPath = fp; break; }
    }
    if (!auditPath) {
      return void res.status(404).json({ error: `No audit JSON for ${negotiationId}` });
    }
    const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    // Try to enrich with seller perspective if available (richer treasury info)
    let sellerAudit: any = null;
    for (const fp of [
      path.join(escalationsDir, `${negotiationId}_success_SELLER.audit.json`),
      path.join(escalationsDir, `${negotiationId}_escalation_SELLER.audit.json`),
    ]) {
      if (fs.existsSync(fp)) { try { sellerAudit = JSON.parse(fs.readFileSync(fp, "utf8")); } catch {} break; }
    }
    // Dynamic import keeps pdfkit out of the cold path / startup
    const { generateAuditPdf } = await import("../../shared/audit-pdf.js");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${negotiationId}-audit.pdf"`);
    await generateAuditPdf(audit, sellerAudit, res);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "pdf generation failed" });
  }
});

app.get('/api/quality/:negotiationId', (req, res) => {
  const { negotiationId } = req.params;
  if (!/^NEG-\d+$/.test(negotiationId)) {
    return void res.status(400).json({ error: "Invalid negotiationId format" });
  }
  try {
    const candidates = [
      path.join(escalationsDir, `${negotiationId}_success_BUYER.audit.json`),
      path.join(escalationsDir, `${negotiationId}_escalation_BUYER.audit.json`),
    ];
    for (const fp of candidates) {
      if (fs.existsSync(fp)) {
        const audit = JSON.parse(fs.readFileSync(fp, "utf8"));
        return void res.json(audit);
      }
    }
    return void res.status(404).json({ error: `No audit JSON for ${negotiationId}` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "unknown" });
  }
});

// ── WEDGE1 / M1: validate seller-response-mode before listening ────────────────────────────
// Fail-fast on misconfig. validateSellerResponseMode() throws if
// SELLER_RESPONSE_MODE is set to a non-shippable value (L3/L4) or anything
// not in the mode set. Unset env defaults to BASIC_SALES_QUOTING_1
// (backward compat with prior product).
const resolvedModeBlock = buildSellerResponseModeBlock();
try {
  validateSellerResponseMode();
} catch (err: any) {
  console.error("");
  console.error(`\x1b[31m\x1b[1m  ✗  SELLER RESPONSE MODE VALIDATION FAILED${"".padEnd(18)}\x1b[0m`);
  console.error(`\x1b[31m     ${err?.message ?? err}\x1b[0m`);
  console.error("");
  process.exit(1);
}

const PORT = process.env.PORT || 9090;
app.listen(PORT, () => {
  console.log(`\n🛒  Buyer Agent  →  http://localhost:${PORT}`);
  console.log(`    Max Budget    : ₹${BUYER_CONFIG.maxBudget}/unit`);
  console.log(`    Target Price  : ₹${BUYER_CONFIG.targetPrice}/unit`);
  console.log(`    Quantity      : ${BUYER_CONFIG.targetQuantity} units`);
  console.log(`    Max Rounds    : ${BUYER_CONFIG.maxRounds}`);
  console.log(`    DD Mode       : AUTONOMOUS (cost of capital ${(BUYER_DD_CONFIG.costOfCapital * 100).toFixed(0)}%  |  escalation band ±${(BUYER_DD_CONFIG.escalationBand * 100).toFixed(0)}%)`);
  // WEDGE1 / M1 — print the resolved seller-response-mode block to the startup log
  console.log("");
  console.log(`    ── WEDGE1 seller response mode framework ─────────────────────────`);
  for (const line of formatStartupBanner(resolvedModeBlock).split("\n")) {
    console.log(`    ${line}`);
  }
  console.log("");
});
