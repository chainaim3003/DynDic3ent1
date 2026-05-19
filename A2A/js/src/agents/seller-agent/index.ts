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
  DecisionTrailEntry,
  ConstraintDisclosureRecord,
  RejectionData,
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

import { getMessageSigner } from "../../messaging/index.js";
import type { SealedMessage } from "../../messaging/index.js";

// ── Iteration 15: notifications (UI dashboard + WhatsApp via Meta Cloud API) ─
// Same surface as buyer-agent. Seller code never sees a phone number; it
// emits semantic AgentEvents and the notify router does the routing.
import { getNotifier, type AgentEvent } from "../../notify/index.js";
import { attachNotificationsToAudit } from "../../notify/audit-attach.js";

// WEDGE1 / M2-α.1 — seller-response-mode framework. Same wiring pattern as
// buyer-agent (see src/agents/buyer-agent/index.ts substep 4 in M1).
// validateSellerResponseMode() throws at startup if SELLER_RESPONSE_MODE env
// is set to a non-shippable value (L3/L4 or anything not in the mode set),
// so the seller fails fast on misconfig rather than producing escalation
// audits with an invalid mode.
// Audit JSON already carries the sellerResponseMode block via
// logger.saveAuditJson() since M1 — this just adds the startup-time guard.
import {
  resolveSellerResponseMode,
  validateSellerResponseMode,
  getResolvedCapabilities,
  buildSellerResponseModeBlock,
  formatStartupBanner,
} from "../../shared/negotiation-mode.js";
import type { ResolvedCapabilities } from "../../shared/negotiation-mode.js";

// WEDGE1 / M2-β.4 — L2 wire orchestrator. Engaged only when the active
// mode's resolved capabilities include `llmExecutiveJudgment`
// (L2_EXECUTIVE_REASONER+). BASIC_SALES_QUOTING_1/L1_DELEGATED_ADVISORS
// paths are untouched (Guarantee A: byte-identical behavior).
import { decideRoundViaL2 } from "../../shared/l2-wire.js";
import type { ConsultationBundle } from "../../shared/consultation-router.js";
import type { L2ExecutiveDecision } from "../../shared/l2-executive.js";

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

  // Iteration 4: symmetric to buyer — capture full decision trail and any
  // counterparty-disclosed buyerMax that arrives in PURCHASE_ORDER.
  private decisionTrail   = new Map<string, DecisionTrailEntry[]>();
  private disclosedByBuyer = new Map<string, { value: number; receivedAt: string; note?: string }>();

  // WEDGE1 / M2-β.4 — mode-resolved capabilities computed once at construction.
  // When `llmExecutiveJudgment` is true (L2_EXECUTIVE_REASONER+), the L2 wire
  // path runs; otherwise the legacy BASIC_SALES_QUOTING_1/L1_DELEGATED_ADVISORS
  // path runs unchanged (Guarantee A).
  private resolvedCap: ResolvedCapabilities;

  // WEDGE1 / M2-β.4 — per-negotiation L2 audit storage. Bundles + L2 decisions
  // are appended in round order; the audit JSON's extras block reads from these.
  // TODO(β.4-cleanup): these leak across negotiations the same way `negotiations`
  // and `decisionTrail` already do. β.5+ should add cleanup on COMPLETED/
  // REJECTED/ESCALATED states.
  private l2BundleByRound    = new Map<string, ConsultationBundle[]>();
  private l2DecisionsByRound = new Map<string, L2ExecutiveDecision[]>();

  constructor() {
    this.llmClient   = new LLMNegotiationClient();
    this.actusClient = new ActusClient();
    // WEDGE1 / M2-β.4: resolve capabilities once. resolveSellerResponseMode
    // defaults to BASIC_SALES_QUOTING_1 when SELLER_RESPONSE_MODE is unset,
    // preserving Guarantee A's byte-identical path.
    this.resolvedCap = getResolvedCapabilities(resolveSellerResponseMode());
  }

  /** Iteration 4: build constraintDisclosure block for seller-side audit. */
  private buildSellerConstraintDisclosure(negotiationId: string): ConstraintDisclosureRecord {
    const disclosed = this.disclosedByBuyer.get(negotiationId);
    if (disclosed) {
      return {
        selfReservationPrice: {
          value:    SELLER_CONFIG.marginPrice,
          source:   "own-config",
          currency: "INR",
        },
        disclosedByCounterparty: {
          value:      disclosed.value,
          source:     "disclosed-in-PURCHASE_ORDER",
          currency:   "INR",
          receivedAt: disclosed.receivedAt,
          note:       disclosed.note,
        },
      };
    }
    return {
      selfReservationPrice: {
        value:    SELLER_CONFIG.marginPrice,
        source:   "own-config",
        currency: "INR",
      },
      fallbackUsed: {
        value:  400,
        source: "demo-constant",
        reason: "counterparty did not disclose buyerMax in PURCHASE_ORDER (older client or disclosure suppressed)",
      },
    };
  }

  private resolveBuyerMax(negotiationId: string): number {
    return this.disclosedByBuyer.get(negotiationId)?.value ?? 400;
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

    // Iteration 2: verify the envelope before dispatching to handlers.
    // Sealed messages have shape {envelope, payload}; legacy unsealed messages
    // (e.g. from older clients) come as bare NegotiationData. We accept both
    // for backward compatibility — but log a warning when a message arrives
    // unsealed so the operator knows the chain has a gap.
    let actual: NegotiationData;
    const maybeSealed = data as unknown as SealedMessage<NegotiationData> | NegotiationData;
    if (maybeSealed && (maybeSealed as any).envelope && (maybeSealed as any).payload) {
      const sealed = maybeSealed as SealedMessage<NegotiationData>;
      const signer = getMessageSigner();
      const result = signer.verify(sealed, "jupiterSellerAgent");
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
      logInternal(`[envelope] ⚠ received UNSEALED message type=${(data as any).type} — chain has a gap`);
      actual = data;
    }

    switch (actual.type) {
      case "OFFER":
        await this.handleBuyerOffer(actual as OfferData, contextId, bus, taskId);
        break;
      case "COUNTER_OFFER":
        await this.handleBuyerCounterOffer(actual as CounterOfferData, contextId, bus, taskId);
        break;
      case "ACCEPT_OFFER":
        await this.handleBuyerAcceptance(actual as AcceptanceData, contextId, bus, taskId);
        break;
      case "PURCHASE_ORDER":
        await this.handlePurchaseOrder(actual as PurchaseOrderData, contextId, bus, taskId);
        break;
      case "ESCALATION_NOTICE":
        await this.handleEscalationNotice(actual as EscalationNoticeData, contextId, bus, taskId);
        break;
      case "DD_ACCEPT":
        await this.handleDDAccept(actual as DDAcceptData, contextId, bus, taskId);
        break;
      default:
        logInternal(`Unknown message type: ${(actual as any).type}`);
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
      // Iter 15: notify — treasury blocked the proposed acceptance
      // Fire-and-forget so synchronous decision path is not awaited; failures
      // are logged inside the router and never crash the negotiation.
      void getNotifier().publish({
        type:          "treasury-block",
        perspective:   "TREASURY",
        negotiationId: state.negotiationId,
        round:         state.currentRound,
        timestamp:     new Date().toISOString(),
        payload: {
          priceQueried:   state.lastBuyerOffer,
          minViablePrice: minPrice,
          reason:         treasuryResult.failReasons.join("; "),
          npvOfDeal:      treasuryResult.npvOfDeal,
          netProfit:      treasuryResult.netProfit,
        },
      } as AgentEvent);
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

  // ================= WEDGE1 / M2-β.4 — L2 EXECUTIVE PATH =================
  /**
   * Run one round through the M2-β router + L2 executive pipeline.
   * Only called when `this.resolvedCap.llmExecutiveJudgment` is true
   * (L2_EXECUTIVE_REASONER+).
   *
   * Side effects (same shape as the legacy path so downstream code is unaware):
   *  - Appends the round's bundle to `l2BundleByRound[negotiationId]`
   *  - Appends the round's L2 decision to `l2DecisionsByRound[negotiationId]`
   *  - Updates `state.lastTreasuryResult` with the TreasuryConsultationSummary
   *    (legacy shape; success-report code remains unchanged)
   *  - Pushes a DecisionTrailEntry into `decisionTrail[negotiationId]` so the
   *    Decision Trail viewer renders L2 rounds. The entry's shape is mapped
   *    best-effort from L2's mathOverride/defensiveActions onto the legacy
   *    llmProposal/constraintAdjustment/treasuryOverride fields.
   *    TODO(β.4-cleanup): DecisionTrailEntry should become a discriminated
   *    union with first-class L2 fields rather than this best-effort mapping.
   *
   * Returns the legacy-shaped NegotiationDecision so the existing ACCEPT/
   * COUNTER/REJECT branches in the handler code path stay unchanged.
   */
  private async runL2Path(
    state: SellerNegotiationState,
    buyerOffer: number,
    round: number,
    _logger: NegotiationLogger,
  ): Promise<{ decision: NegotiationDecision; overrideApplied: boolean }> {
    const buyerMeta = readAgentCardMetadata("tommyBuyerAgent");

    // Fetch market snapshot for the LLM prompt (parity with legacy path which
    // calls getMarketSnapshot inside makeNegotiationDecision).
    const market = await getMarketSnapshot();

    const out = await decideRoundViaL2({
      negotiationId:    state.negotiationId,
      round,
      maxRounds:        state.maxRounds,
      buyerOffer,
      quantity:         state.quantity,
      lastSellerOffer:  state.lastSellerOffer,
      history:          state.history,

      marginPrice:      state.marginPrice,
      minProfitMargin:  state.strategyParams.minProfitMargin,
      targetPrice:      TARGET_PRICE,

      mode:             resolveSellerResponseMode(),
      capabilities:     this.resolvedCap,

      paymentTermsDays: SELLER_CONFIG.dd.paymentTermsDays,

      // WEDGE1 / M2-γ — prefer per-negotiation productCode from buyer's OfferData
      // (set when the buyer used the flagged multi-dim CLI form), with the legacy
      // FAB-COTTON-180GSM fallback for the bare-number form. The sub-agents (inventory,
      // credit, logistics) currently serve a single fixture regardless of productCode,
      // so demoing with a non-cotton product still returns cotton data — honest demo
      // limitation; fixture multiplication is a follow-up task.
      // originPort/destinationPort remain seller-side defaults; the buyer's CLI flags
      // don't include shipping origin/destination (seller knows where it ships from).
      // TODO(β.5+): move origin/destination into SELLER_CONFIG, and accept --origin /
      // --destination flags on the buyer CLI if a future demo requires multi-route.
      productCode:      state.productCode ?? "FAB-COTTON-180GSM",
      originPort:       "INMAA",
      destinationPort:  "USLAX",
      buyerLei:         buyerMeta?.lei,
      buyerEntityName:  buyerMeta?.legalEntityName,
      buyerMax:         this.resolveBuyerMax(state.negotiationId),

      llmClient:        this.llmClient,
      marketContext: {
        sofrRate:               market.sofrRate,
        cottonPricePerLb:       market.cottonPricePerLb,
        effectiveBorrowingRate: market.effectiveBorrowingRate,
        sofrSource:             market.sofrSource,
      },
    });

    // ── Store bundle + L2 decision for audit ─────────────────────────────
    const bundles   = this.l2BundleByRound.get(state.negotiationId)    ?? [];
    bundles.push(out.bundle);
    this.l2BundleByRound.set(state.negotiationId, bundles);

    const decisions = this.l2DecisionsByRound.get(state.negotiationId) ?? [];
    decisions.push(out.l2Decision);
    this.l2DecisionsByRound.set(state.negotiationId, decisions);

    // ── Update state.lastTreasuryResult so success-report code stays sane ──
    if (out.treasurySummary) {
      state.lastTreasuryResult = out.treasurySummary;
    }

    // ── Log overrides + defensive actions to terminal (operator-visible) ───
    if (out.l2Decision.mathOverride) {
      logInternal(`[L2] math override: ${out.l2Decision.mathOverride.reason}`);
    }
    for (const def of out.l2Decision.defensiveActions) {
      logInternal(`[L2] defensive: ${def.action} (${def.triggeredBy}) — ${def.rationale}`);
    }

    // Iter 15 notification parity: if treasury rejected the price, emit the
    // same treasury-block event the legacy applyTreasuryConstraint emits.
    if (
      out.l2Decision.mathOverride !== undefined &&
      out.bundle.treasury?.success === true &&
      out.bundle.treasury.result?.approved === false
    ) {
      const trResult = out.bundle.treasury.result;
      void getNotifier().publish({
        type:          "treasury-block",
        perspective:   "TREASURY",
        negotiationId: state.negotiationId,
        round,
        timestamp:     new Date().toISOString(),
        payload: {
          priceQueried:   buyerOffer,
          minViablePrice: out.decision.price ?? trResult.minViablePrice ?? 0,
          reason:         (trResult.failReasons ?? []).join("; "),
          npvOfDeal:      trResult.npvOfDeal,
          netProfit:      trResult.netProfit,
        },
      } as AgentEvent);
    }

    // ── DecisionTrail entry (legacy-shape, best-effort mapping from L2) ────
    // TODO(β.4-cleanup): map is lossy. Promote to a discriminated union in β.5+
    // so the Decision Trail viewer can render L2-native fields (tacticsTrace,
    // defensiveActions, mathOverride) directly.
    const trailEntry: DecisionTrailEntry = {
      round,
      timestamp:     new Date().toISOString(),
      perspective:   "SELLER",
      incomingOffer: buyerOffer,
      llmProposal: {
        action:    out.l2Decision.mathOverride?.llmProposed.action ?? out.l2Decision.action,
        price:     out.l2Decision.mathOverride?.llmProposed.price  ?? out.l2Decision.counterPrice,
        reasoning: out.l2Decision.reasoning,
        usedFallback: out.l2Decision.llmAudit?.decisionPath?.includes("FALLBACK") ?? false,
      },
      constraintAdjustment: out.l2Decision.mathOverride ? {
        action:    out.l2Decision.mathOverride.clampedTo.action,
        price:     out.l2Decision.mathOverride.clampedTo.price,
        reasoning: out.l2Decision.mathOverride.reason,
      } : undefined,
      treasuryOverride: out.treasurySummary ? {
        approved:       out.treasurySummary.approved,
        minViablePrice: out.treasurySummary.minViablePrice,
        failReasons:    out.bundle.treasury?.result?.failReasons,
        npvOfDeal:      out.treasurySummary.npvOfDeal,
        netProfit:      out.treasurySummary.netProfit,
      } : undefined,
      finalDecision: {
        action: out.decision.action,
        price:  out.decision.price,
      },
      marketContext: {
        sofrRate:               market.sofrRate,
        sofrSource:             market.sofrSource,
        effectiveBorrowingRate: market.effectiveBorrowingRate,
        cottonPricePerLb:       market.cottonPricePerLb,
        capturedAt:             new Date().toISOString(),
      },
    };
    const trail = this.decisionTrail.get(state.negotiationId) ?? [];
    trail.push(trailEntry);
    this.decisionTrail.set(state.negotiationId, trail);

    return {
      decision:        out.decision,
      overrideApplied: out.l2Decision.mathOverride !== undefined,
    };
  }

  /**
   * Build the L2-specific extras block for the audit JSON.
   * Returns {} when no L2 round ran (BASIC_SALES_QUOTING_1/L1_DELEGATED_ADVISORS)
   * so adding to extras is always safe — the legacy path's audit shape is unchanged.
   *
   * TODO(β.4-cleanup): these go into the untyped `extras` blob. β.5+ should
   * promote `consultations`, `tacticsTrace`, `mathOverrides`, `defensiveActions`
   * to first-class fields on the NegotiationAudit interface.
   */
  private buildL2AuditExtras(negotiationId: string): Record<string, unknown> {
    const bundles   = this.l2BundleByRound.get(negotiationId);
    const decisions = this.l2DecisionsByRound.get(negotiationId);
    if (!bundles || !decisions || bundles.length === 0) return {};

    return {
      l2: {
        engaged:       true,
        roundCount:    decisions.length,
        consultations: bundles.map((b, i) => ({
          round:           i + 1,
          mode:            b.mode,
          routerLatencyMs: b.routerLatencyMs,
          treasury:        b.treasury,
          inventory:       b.inventory,
          logistics:       b.logistics,
          credit:          b.credit,
        })),
        tacticsTrace: decisions.map((d, i) => ({
          round: i + 1,
          ...d.tacticsTrace,
        })),
        mathOverrides: decisions
          .map((d, i) => d.mathOverride ? { round: i + 1, ...d.mathOverride } : null)
          .filter((x): x is NonNullable<typeof x> => x !== null),
        defensiveActions: decisions.flatMap((d, i) =>
          d.defensiveActions.map(a => ({ round: i + 1, ...a })),
        ),
      },
    };
  }

  // ================= HANDLE BUYER INITIAL OFFER =================
  private async handleBuyerOffer(
    data: OfferData,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string
  ) {
    const { negotiationId, pricePerUnit, quantity, deliveryDate, productCode, buyerStyle } = data;

    const logger = new NegotiationLogger(negotiationId, "SELLER");
    this.loggers.set(negotiationId, logger);

    logger.printSessionHeader(contextId);

    // ── Identity verification BEFORE responding ───────────────────────────
    // Honest message: in plain mode we are doing a GLEIF-only check, NOT vLEI.
    const mode = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase();
    logInternal(`[identity] mode=${mode} — verifying tommyBuyerAgent`);
    const vLEIResult = await verifyCounterparty("seller", "DEEP-EXT");
    const buyerMeta  = readAgentCardMetadata("tommyBuyerAgent");
    printVerificationResult(vLEIResult, buyerMeta);

    if (!vLEIResult.verified) {
      this.respond(
        bus, taskId, contextId,
        `❌ Identity verification FAILED — cannot proceed with negotiation.\nReason: ${vLEIResult.error ?? "Buyer delegation could not be verified"}`
      );
      return;
    }
    const proceedMsg = vLEIResult.verificationType === "DISABLED"
      ? `[identity] Buyer plain-mode check passed (NOT vLEI — GLEIF + agent card only) — proceeding`
      : `[identity] Buyer vLEI delegation verified (${vLEIResult.verificationScript}) — proceeding`;
    logInternal(proceedMsg);
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
      // WEDGE1 / M2-γ — capture multi-dim context from buyer's OfferData. Undefined
      // when buyer used the legacy `start negotiation 300` form. runL2Path reads
      // state.productCode below to drive the inventory/credit/logistics consultation.
      productCode: productCode,
      buyerStyle:  buyerStyle,
    };

    this.negotiations.set(negotiationId, state);

    // Iter 15: notify — negotiation started + buyer's opening offer
    // (seller sees buyer as counterparty)
    const buyerMetaForEvent = readAgentCardMetadata("tommyBuyerAgent");
    await getNotifier().publish({
      type:          "negotiation-started",
      perspective:   "BUYER",
      negotiationId,
      timestamp:     new Date().toISOString(),
      payload: {
        counterpartyName: buyerMetaForEvent?.legalEntityName ?? "Counterparty",
        quantity,
        product:          "fabric units",
        deliveryDate,
      },
    } as AgentEvent);
    await getNotifier().publish({
      type:          "counterparty-offer-received",
      perspective:   "BUYER",
      negotiationId,
      round:         1,
      timestamp:     new Date().toISOString(),
      payload: {
        action: "offer",
        price:  pricePerUnit,
      },
    } as AgentEvent);

    // ── Treasury consultation BEFORE making decision ───────────────────────────
    // ── Decision: mode-gated between legacy (BASIC_SALES_QUOTING_1/L1_DELEGATED_ADVISORS) and L2 (L2_EXECUTIVE_REASONER+) ──
    let decision: NegotiationDecision;
    let overrideApplied: boolean;

    if (this.resolvedCap.llmExecutiveJudgment) {
      // WEDGE1 / M2-β.4: L2_EXECUTIVE_REASONER+ path — router + L2 executive
      logInternal(`[mode=${resolveSellerResponseMode()}] Running L2 executive for Round 1 — buyer offer ₹${pricePerUnit}...`);
      const l2 = await this.runL2Path(state, pricePerUnit, 1, logger);
      decision        = l2.decision;
      overrideApplied = l2.overrideApplied;
    } else {
      // Legacy BASIC_SALES_QUOTING_1/L1_DELEGATED_ADVISORS path — unchanged from iteration 4. Guarantee A.
      logInternal(`Consulting JupiterTreasuryAgent for Round 1 — buyer offer ₹${pricePerUnit}...`);
      const treasuryResult = await this.consultTreasury(negotiationId, pricePerUnit, quantity, 1);

      decision = await this.makeNegotiationDecision(state);
      const tc = this.applyTreasuryConstraint(decision, treasuryResult, state, logger);
      decision        = tc.decision;
      overrideApplied = tc.overrideApplied;

      this.recordTreasurySummary(state, treasuryResult, 1, pricePerUnit, overrideApplied);
      // Iteration 4: patch the just-pushed trail entry with treasury info.
      this.recordTreasuryInLatestTrailEntry(state.negotiationId, treasuryResult, overrideApplied, decision);
    }

    if (decision.action === "ACCEPT") {
      await this.sendAcceptance(state, logger, contextId);
      this.respond(
        bus, taskId, contextId,
        `✓ Accepting buyer's offer: ₹${pricePerUnit}/fabric unit\nProfit: ₹${pricePerUnit - SELLER_CONFIG.marginPrice}/fabric unit\nWaiting for buyer confirmation...`
      );
    } else if (decision.action === "COUNTER") {
      // Iter-4.3 race-fix: broadcast SSE FIRST (sync, no await), then A2A send.
      // state.currentRound is evaluated BEFORE the await window where parallel
      // handlers could mutate it.
      this.respond(
        bus, taskId, contextId,
        `↓ Counter-offer sent (Round ${state.currentRound}): ₹${decision.price}/fabric unit  (buyer offered ₹${pricePerUnit})${overrideApplied ? "  [treasury floor applied]" : ""}\nWaiting for buyer response...`
      );
      await this.sendCounterOffer(state, decision.price!, decision.reasoning, logger, contextId);
    } else {
      // Iter-4 fix: REJECT must notify buyer + write audit (escalation outcome)
      // so the UI shows the failed deal and "escalated to human".
      await this.handleFinalRejection(state, logger, contextId, bus, taskId, decision.reasoning);
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

    // Iter 15: notify — buyer countered (counterparty action from seller's view)
    await getNotifier().publish({
      type:          "counterparty-offer-received",
      perspective:   "BUYER",
      negotiationId: data.negotiationId,
      round:         state.currentRound + 1,  // buyer's counter is for the next round
      timestamp:     new Date().toISOString(),
      payload: {
        action: "counter",
        price:  data.pricePerUnit,
        gap:    state.lastSellerOffer !== undefined ? data.pricePerUnit - state.lastSellerOffer : undefined,
      },
    } as AgentEvent);

    // ── Round-bookkeeping fix (matches buyer-side pattern) ──────────────
    // The buyer COUNTER we just received is the buyer's offer for the NEXT
    // round (the buyer is responding to our last counter). Increment FIRST
    // so the logger.log call and the priceTrail entry are keyed under the
    // correct round number. Previous code logged the incoming counter under
    // state.currentRound (the OLD round), which caused the seller's price
    // trail to be off-by-one in the buyer column — visible as R1=₹250 instead
    // of ₹100, R2=₹330 instead of ₹250, R3=“—” instead of ₹330 in NEG-079945.
    state.currentRound += 1;

    if (state.currentRound > state.maxRounds) {
      // Seller side just waits — buyer will send ESCALATION_NOTICE shortly
      state.status = "ESCALATED";
      logInternal(`Max rounds reached — awaiting escalation notice from buyer`);
      this.respond(bus, taskId, contextId, "⚠ Max rounds reached — awaiting escalation notice...");
      return;
    }

    // ── Use seller's own last offer as the baseline for delta display ─────────
    const sellerLastPrice      = state.lastSellerOffer;
    const priceMovement        = sellerLastPrice !== undefined
      ? data.pricePerUnit - sellerLastPrice
      : 0;
    const priceMovementPercent = sellerLastPrice !== undefined && sellerLastPrice !== 0
      ? (priceMovement / sellerLastPrice) * 100
      : 0;

    logger.log({
      round:                state.currentRound,   // ← now the CORRECT new round
      messageType:          "COUNTER_OFFER",
      from:                 "BUYER",
      offeredPrice:         data.pricePerUnit,
      previousPrice:        sellerLastPrice,
      priceMovement,
      priceMovementPercent,
      decision:             "COUNTER_OFFER",
      reasoning:            data.reasoning,
    });

    // Note: the previous code did
    //   const h = state.history.find(r => r.round === state.currentRound);
    //   if (h) { h.buyerOffer = data.pricePerUnit; h.buyerAction = "COUNTER_OFFER"; }
    // That overwrote the PREVIOUS round's history entry. Removed — the new
    // round's row will be pushed by sendCounterOffer() below with the
    // correct buyer + seller offers paired together.

    logger.printRoundHeader(state.currentRound, state.maxRounds);

    // ── Treasury consultation BEFORE making decision ───────────────────────────
    // ── Decision: mode-gated between legacy (BASIC_SALES_QUOTING_1/L1_DELEGATED_ADVISORS) and L2 (L2_EXECUTIVE_REASONER+) ──
    let decision: NegotiationDecision;
    let overrideApplied: boolean;

    if (this.resolvedCap.llmExecutiveJudgment) {
      // WEDGE1 / M2-β.4: L2_EXECUTIVE_REASONER+ path — router + L2 executive
      logInternal(`[mode=${resolveSellerResponseMode()}] Running L2 executive for Round ${state.currentRound} — buyer counter ₹${data.pricePerUnit}...`);
      const l2 = await this.runL2Path(state, data.pricePerUnit, state.currentRound, logger);
      decision        = l2.decision;
      overrideApplied = l2.overrideApplied;
    } else {
      // Legacy BASIC_SALES_QUOTING_1/L1_DELEGATED_ADVISORS path — unchanged from iteration 4. Guarantee A.
      logInternal(`Consulting JupiterTreasuryAgent for Round ${state.currentRound} — buyer counter ₹${data.pricePerUnit}...`);
      const treasuryResult = await this.consultTreasury(
        state.negotiationId,
        data.pricePerUnit,
        state.quantity,
        state.currentRound,
      );

      decision = await this.makeNegotiationDecision(state);
      const tc = this.applyTreasuryConstraint(decision, treasuryResult, state, logger);
      decision        = tc.decision;
      overrideApplied = tc.overrideApplied;

      this.recordTreasurySummary(state, treasuryResult, state.currentRound, data.pricePerUnit, overrideApplied);
      // Iteration 4: patch the just-pushed trail entry with treasury info.
      this.recordTreasuryInLatestTrailEntry(state.negotiationId, treasuryResult, overrideApplied, decision);
    }

    if (decision.action === "ACCEPT") {
      await this.sendAcceptance(state, logger, contextId);
      const profit = data.pricePerUnit - SELLER_CONFIG.marginPrice;
      this.respond(
        bus, taskId, contextId,
        `✓ Accepting buyer's offer: ₹${data.pricePerUnit}/fabric unit\nProfit: ₹${profit}/fabric unit (${((profit / SELLER_CONFIG.marginPrice) * 100).toFixed(1)}%)\nWaiting for buyer confirmation...`
      );
    } else if (decision.action === "COUNTER") {
      // Iter-4.3 race-fix: broadcast SSE FIRST (sync, no await), then A2A send.
      // state.currentRound is evaluated BEFORE the await window where parallel
      // handlers (the buyer's next reply triggering another handleBuyerCounterOffer)
      // could mutate state.currentRound++.
      this.respond(
        bus, taskId, contextId,
        `↓ Counter-offer sent (Round ${state.currentRound}): ₹${decision.price}/fabric unit${overrideApplied ? "  [treasury floor applied]" : ""}\nWaiting for buyer response...`
      );
      await this.sendCounterOffer(state, decision.price!, decision.reasoning, logger, contextId);
    } else {
      // Iter-4 fix: REJECT must notify buyer + write audit (escalation outcome)
      // so the UI shows the failed deal and "escalated to human".
      await this.handleFinalRejection(state, logger, contextId, bus, taskId, decision.reasoning);
    }
  }

  // ================= HANDLE FINAL REJECTION (iter-4 fix) =================
  /**
   * Called when the seller's constraint validator / rule-based fallback produces
   * a REJECT in any round. Previously this just logged to terminal — the buyer
   * was left hanging and no audit JSON was written. Now it:
   *  1. Sends a REJECT_OFFER message to the buyer so the buyer's state advances
   *     and the buyer also writes its audit JSON.
   *  2. Saves the seller-side .txt escalation report.
   *  3. Saves the seller-side audit JSON with outcome="escalation" so the
   *     dashboard's /deal-quality page shows the failed deal.
   *  4. Broadcasts "✗ No deal — escalated to human review" to the seller chat
   *     in the UI.
   */
  private async handleFinalRejection(
    state: SellerNegotiationState,
    logger: NegotiationLogger,
    contextId: string,
    bus: ExecutionEventBus,
    taskId: string,
    reason: string,
  ) {
    state.status = "REJECTED";

    const buyerFinalOffer  = state.lastBuyerOffer  ?? 0;
    const sellerFinalOffer = state.lastSellerOffer ?? SELLER_CONFIG.marginPrice;
    const gap              = Math.max(0, sellerFinalOffer - buyerFinalOffer);

    // 1. Notify the buyer so it can write its own audit + advance state.
    const rejectionData: RejectionData = {
      type:          "REJECT_OFFER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      from:          "SELLER",
      reason,
      finalRound:    state.currentRound >= state.maxRounds,
    };
    await this.sendToBuyer(rejectionData, contextId);

    // 2. Terminal summary + escalation report (.txt) for human review.
    logger.printNegotiationSummary("FAILED", {
      roundsUsed: state.currentRound,
      maxRounds:  state.maxRounds,
      quantity:   state.quantity,
    });
    const reportPath = logger.saveEscalationReport({
      buyerFinalOffer, sellerFinalOffer, gap,
      rounds:       state.currentRound,
      maxRounds:    state.maxRounds,
      quantity:     state.quantity,
      deliveryDate: state.deliveryDate,
      logs:         logger.getLogs(),
    });
    logger.printEscalationNotice(buyerFinalOffer, sellerFinalOffer, gap, reportPath);

    // 3. Audit JSON — outcome="escalation" so /deal-quality lists it.
    const buyerMetaForAudit  = readAgentCardMetadata("tommyBuyerAgent");
    const sellerMetaForAudit = readAgentCardMetadata("jupiterSellerAgent");
    const buyerMaxForAudit   = this.resolveBuyerMax(state.negotiationId);
    const auditPath = logger.saveAuditJson({
      outcome:         "escalation",
      finalPrice:      Math.round((buyerFinalOffer + sellerFinalOffer) / 2),
      quantity:        state.quantity,
      deliveryDate:    state.deliveryDate,
      paymentTerms:    `Net ${SELLER_CONFIG.dd.paymentTermsDays}`,
      roundsUsed:      state.currentRound,
      maxRounds:       state.maxRounds,
      logs:            logger.getLogs(),
      counterpartyLEI:        buyerMetaForAudit?.lei,
      counterpartyEntityName: buyerMetaForAudit?.legalEntityName,
      ownLEI:                 sellerMetaForAudit?.lei,
      ownEntityName:          sellerMetaForAudit?.legalEntityName,
      credentialMode:         (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain",
      outcomeQualityInputs: {
        closed:        false,
        closedPrice:   Math.round((buyerFinalOffer + sellerFinalOffer) / 2),
        buyerMax:      buyerMaxForAudit,
        sellerMin:     SELLER_CONFIG.marginPrice,
        quantity:      state.quantity,
        currency:      "INR",
      },
      treasury: state.lastTreasuryResult ? { ...state.lastTreasuryResult } : undefined,
      decisions:           this.decisionTrail.get(state.negotiationId) as unknown as Record<string, unknown>[],
      constraintDisclosure: this.buildSellerConstraintDisclosure(state.negotiationId) as unknown as Record<string, unknown>,
      extras: {
        ...this.buildL2AuditExtras(state.negotiationId),
        rejectedBySeller: true,
        rejectionReason:  reason,
        buyerFinalOffer,
        sellerFinalOffer,
        gap,
      },
    });
    logInternal(`[audit] JSON written (rejection-as-escalation): ${auditPath}`);

    // Iter 15: attach notification receipts to the audit
    setTimeout(() => attachNotificationsToAudit(auditPath, state.negotiationId), 1500);

    // Iter 15: notify — escalation (seller's final rejection)
    await getNotifier().publish({
      type:          "escalation",
      perspective:   "SELLER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        reason,
        auditUrl: `http://localhost:${process.env.BUYER_PUBLIC_PORT ?? 9090}/api/quality/${state.negotiationId}/pdf`,
      },
    } as AgentEvent);

    // 4. Tell the UI seller-chat what happened.
    this.respond(
      bus, taskId, contextId,
      `✗ NO DEAL — final-round rejection\n` +
      `Buyer final offer  : ₹${buyerFinalOffer}\n` +
      `Seller final offer : ₹${sellerFinalOffer}\n` +
      `Gap                : ₹${gap}\n` +
      `Reason : ${reason}\n` +
      `⚠ escalated to human procurement officer for review.`,
    );
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

      // Iteration 3: parallel JSON audit for escalation (seller side).
      // Iteration 4: buyerMax now comes from disclosure when present.
      const buyerMetaEsc  = readAgentCardMetadata("tommyBuyerAgent");
      const sellerMetaEsc = readAgentCardMetadata("jupiterSellerAgent");
      const trSummaryEsc = state?.lastTreasuryResult;
      const buyerMaxEsc = state ? this.resolveBuyerMax(state.negotiationId) : 400;
      const auditPathEsc = logger.saveAuditJson({
        outcome:         "escalation",
        finalPrice:      Math.round((data.buyerFinalOffer + data.sellerFinalOffer) / 2),
        quantity:        state?.quantity ?? 0,
        deliveryDate:    state?.deliveryDate ?? "—",
        paymentTerms:    `Net ${SELLER_CONFIG.dd.paymentTermsDays}`,
        roundsUsed:      data.round,
        maxRounds:       state?.maxRounds ?? data.round,
        logs:            logger.getLogs(),
        counterpartyLEI:        buyerMetaEsc?.lei,
        counterpartyEntityName: buyerMetaEsc?.legalEntityName,
        ownLEI:                 sellerMetaEsc?.lei,
        ownEntityName:          sellerMetaEsc?.legalEntityName,
        credentialMode:         (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain",
        outcomeQualityInputs: {
          closed:        false,
          closedPrice:   Math.round((data.buyerFinalOffer + data.sellerFinalOffer) / 2),
          buyerMax:      buyerMaxEsc,                 // iter-4: typically just fallback since escalation = no PO ever sent
          sellerMin:     SELLER_CONFIG.marginPrice,
          quantity:      state?.quantity ?? 0,
          currency:      "INR",
        },
        treasury: trSummaryEsc ? { ...trSummaryEsc } : undefined,
        // Iteration 4 — decision trail + constraint disclosure (only the
        // trail exists for escalation; fallbackUsed will be present since
        // PURCHASE_ORDER never got sent).
        decisions:           state ? (this.decisionTrail.get(state.negotiationId) as unknown as Record<string, unknown>[]) : undefined,
        constraintDisclosure: state ? (this.buildSellerConstraintDisclosure(state.negotiationId) as unknown as Record<string, unknown>) : undefined,
        extras: {
          ...(state ? this.buildL2AuditExtras(state.negotiationId) : {}),
          buyerFinalOffer:  data.buyerFinalOffer,
          sellerFinalOffer: data.sellerFinalOffer,
          gap:              data.gap,
          buyerReportPath:  data.reportPath,
        },
      });
      logInternal(`[audit] JSON written (escalation): ${auditPathEsc}`);

      // Iter 15: attach notification receipts to the audit
      setTimeout(() => attachNotificationsToAudit(auditPathEsc, data.negotiationId), 1500);

      // Iter 15: notify — escalation received (seller's perspective)
      await getNotifier().publish({
        type:          "escalation",
        perspective:   "BUYER",
        negotiationId: data.negotiationId,
        round:         data.round,
        timestamp:     new Date().toISOString(),
        payload: {
          reason:   `Buyer escalated. Final offers: buyer ₹${data.buyerFinalOffer} vs seller ₹${data.sellerFinalOffer} (gap ₹${data.gap})`,
          auditUrl: `http://localhost:${process.env.BUYER_PUBLIC_PORT ?? 9090}/api/quality/${data.negotiationId}/pdf`,
        },
      } as AgentEvent);

    } else {
      logInternal(`Escalation received for ${data.negotiationId} — gap ₹${data.gap} — report: ${data.reportPath}`);
    }

    this.respond(
      bus, taskId, contextId,
      `✗ NO DEAL — escalated to human procurement officer for review.\n` +
      `Buyer's final offer: ₹${data.buyerFinalOffer}  |  Seller's final offer: ₹${data.sellerFinalOffer}  (gap: ₹${data.gap})\n` +
      `Buyer report: ${data.reportPath}`
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

    // Iter 15: notify — buyer accepted seller's offer (counterparty action from seller view)
    await getNotifier().publish({
      type:          "counterparty-offer-received",
      perspective:   "BUYER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        action: "accept",
        price:  data.acceptedPrice,
      },
    } as AgentEvent);

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
      // Iteration 4: bilateral-acceptance also carries audit-only sellerMin disclosure.
      disclosed: {
        reservationPrice: SELLER_CONFIG.marginPrice,
        currency:         "INR",
        note:             "audit-only constraint disclosure (iter-4)",
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

    // Iteration 3: parallel JSON audit + outcome-quality metrics from seller perspective.
    // Iteration 4: buyerMax now comes from disclosure (or labeled fallback).
    const buyerMetaForAudit  = readAgentCardMetadata("tommyBuyerAgent");
    const sellerMetaForAudit = readAgentCardMetadata("jupiterSellerAgent");
    const trSummary = state.lastTreasuryResult;
    const buyerMaxForAudit = this.resolveBuyerMax(state.negotiationId);
    const auditPath = logger.saveAuditJson({
      outcome:         "success",
      finalPrice:      data.acceptedPrice,
      quantity:        state.quantity,
      deliveryDate:    state.deliveryDate,
      paymentTerms:    `Net ${SELLER_CONFIG.dd.paymentTermsDays}`,
      roundsUsed:      state.currentRound,
      maxRounds:       state.maxRounds,
      logs:            logger.getLogs(),
      counterpartyLEI:        buyerMetaForAudit?.lei,
      counterpartyEntityName: buyerMetaForAudit?.legalEntityName,
      ownLEI:                 sellerMetaForAudit?.lei,
      ownEntityName:          sellerMetaForAudit?.legalEntityName,
      credentialMode:         (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain",
      outcomeQualityInputs: {
        closed:        true,
        closedPrice:   data.acceptedPrice,
        buyerMax:      buyerMaxForAudit,                // iter-4: disclosed value when available
        sellerMin:     SELLER_CONFIG.marginPrice,       // seller knows its own floor
        quantity:      state.quantity,
        currency:      "INR",
      },
      treasury: trSummary ? { ...trSummary } : undefined,
      // Iteration 4 — decision trail + constraint disclosure
      decisions:           this.decisionTrail.get(state.negotiationId) as unknown as Record<string, unknown>[],
      constraintDisclosure: this.buildSellerConstraintDisclosure(state.negotiationId) as unknown as Record<string, unknown>,
      // WEDGE1 / M2-β.4: L2-specific extras (consultations, tacticsTrace,
      // mathOverrides, defensiveActions). Empty {} when L2 didn't run (BASIC1/ADV1).
      extras: this.buildL2AuditExtras(state.negotiationId),
    });
    logInternal(`[audit] JSON written: ${auditPath}`);

    // Iter 15: attach notification receipts to the audit
    setTimeout(() => attachNotificationsToAudit(auditPath, state.negotiationId), 1500);

    // Iter 15: notify — deal closed (seller's view; PDF lives on buyer's port)
    await getNotifier().publish({
      type:          "deal-closed",
      perspective:   "SELLER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        finalPrice: data.acceptedPrice,
        quantity:   state.quantity,
        auditUrl:   `http://localhost:${process.env.BUYER_PUBLIC_PORT ?? 9090}/api/quality/${state.negotiationId}/pdf`,
      },
    } as AgentEvent);

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

    // Iteration 4: capture buyer's disclosed buyerMax (audit-only, NOT shown in chat).
    if (data.disclosed?.reservationPrice !== undefined) {
      this.disclosedByBuyer.set(data.negotiationId, {
        value:      data.disclosed.reservationPrice,
        receivedAt: new Date().toISOString(),
        note:       data.disclosed.note,
      });
      logInternal(`[disclose] buyer disclosed buyerMax=₹${data.disclosed.reservationPrice} (audit-only, not echoed to chat)`);
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
    // Iteration 4: capture full decision context for audit trail.
    const marketBefore = await getMarketSnapshot();
    const llmDecision  = await this.getLLMDecision(state);

    const llmProposalSnapshot = {
      action:    llmDecision.action,
      price:     llmDecision.price,
      reasoning: llmDecision.reasoning,
    };

    const validatedDecision = this.applySellerConstraints({ ...llmDecision }, state);
    let finalDecision: NegotiationDecision;
    let usedFallback = false;

    if (!validatedDecision) {
      logInternal("LLM decision invalid — using rule-based fallback");
      finalDecision = this.ruleBasedDecision(state);
      usedFallback  = true;
    } else {
      finalDecision = validatedDecision;
    }

    const constraintChanged =
      validatedDecision &&
      (validatedDecision.action !== llmDecision.action ||
       validatedDecision.price  !== llmDecision.price);

    const entry: DecisionTrailEntry = {
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      perspective:   "SELLER",
      incomingOffer: state.lastBuyerOffer,
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
      // treasuryOverride is filled in by recordTreasuryInLatestTrailEntry()
      // after applyTreasuryConstraint() runs in the calling handler. Initial
      // finalDecision reflects the pre-treasury choice; the handler updates
      // it post-override.
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

  /**
   * Iteration 4: after applyTreasuryConstraint() runs in the calling handler,
   * patch the latest decision-trail entry with the treasury override info and
   * the post-treasury final decision. Idempotent — safe to call even when
   * no override was applied.
   */
  private recordTreasuryInLatestTrailEntry(
    negotiationId: string,
    treasuryResult: TreasuryResult | null,
    overrideApplied: boolean,
    finalDecisionAfterTreasury: NegotiationDecision,
  ) {
    const trail = this.decisionTrail.get(negotiationId);
    if (!trail || trail.length === 0) return;
    const latest = trail[trail.length - 1];

    if (treasuryResult) {
      latest.treasuryOverride = {
        approved:        treasuryResult.approved,
        minViablePrice:  treasuryResult.minViablePrice,
        failReasons:     treasuryResult.failReasons,
        npvOfDeal:       treasuryResult.npvOfDeal,
        netProfit:       treasuryResult.netProfit,
      };
    }
    if (overrideApplied) {
      latest.finalDecision = {
        action: finalDecisionAfterTreasury.action,
        price:  finalDecisionAfterTreasury.price,
      };
    }
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

    // Iter 15: notify — seller's own counter offer
    await getNotifier().publish({
      type:          "own-offer-sent",
      perspective:   "SELLER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        action:    "counter",
        price,
        reasoning,
        gap:       state.lastBuyerOffer !== undefined ? price - state.lastBuyerOffer : undefined,
      },
    } as AgentEvent);

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

    // Iter 15: notify — seller's own acceptance (own-offer-sent with accept action)
    await getNotifier().publish({
      type:          "own-offer-sent",
      perspective:   "SELLER",
      negotiationId: state.negotiationId,
      round:         state.currentRound,
      timestamp:     new Date().toISOString(),
      payload: {
        action: "accept",
        price:  acceptedPrice,
      },
    } as AgentEvent);

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
      // Iteration 4: voluntarily disclose our marginPrice so the buyer's audit
      // can record the bargaining-zone bounds. Audit-only. Not echoed to chat UI.
      disclosed: {
        reservationPrice: SELLER_CONFIG.marginPrice,
        currency:         "INR",
        note:             "audit-only constraint disclosure (iter-4)",
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

      // Iteration 2: wrap the payload in a tamper-evident HASH ENVELOPE before
      // sending. NOT a KERI seal — plain mode is sha256 hashing + monotonic
      // counter + freshness window. Tamper-evidence + replay protection, NOT
      // cryptographic identity. The receiver verifies before processing.
      const signer = getMessageSigner();
      const sealed: SealedMessage<any> = signer.seal(
        data,
        "jupiterSellerAgent",   // logical sender
        "tommyBuyerAgent",       // logical receiver
      );
      logInternal(
        `[envelope] wrap kind=hash-envelope mode=${sealed.envelope.mode} counter=${sealed.envelope.counter} ` +
        `payloadHash=${sealed.envelope.payloadHash.slice(0,12)}... type=${data.type} ` +
        `(NOT a KERI seal)`
      );

      const message: Message = {
        messageId: uuidv4(),
        kind:      "message",
        role:      "agent",
        contextId,
        parts: [
          { kind: "data", data: sealed as unknown as Record<string, unknown> },
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

const cardPath   = resolveCardPath("jupiterSellerAgent");
const sellerCard: AgentCard = JSON.parse(fs.readFileSync(cardPath, "utf8"));

async function main() {
  const executor = new SellerAgentExecutor();
  const handler  = new DefaultRequestHandler(sellerCard, new InMemoryTaskStore(), executor);

  const app = express();
  app.use(cors());
  new A2AExpressApp(handler).setupRoutes(app);

  // Iter 15: initialize notification router (loads YAML, registers channels).
  // Reuse the existing sseBroadcaster so the ui-dashboard channel pushes
  // into the same SSE stream the seller agent already writes to.
  await getNotifier().initialize({ sharedBroadcaster: sseBroadcaster, agentLabel: "seller" });

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

  // ── Iteration 3: mode + verify endpoints for UI gate ────────────────────────────
  // Mirror of the buyer's /api/identity-mode and /api/verify/seller — both
  // agents expose the same shape so the UI can call either side symmetrically.
  // The endpoints honor CREDENTIAL_MODE from THIS agent's .env: plain mode
  // returns a synthesized GLEIF-only result; vlei mode delegates to the
  // localhost:4000 api-server via verifyCounterparty().
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

  app.post('/api/verify/buyer', async (_req, res) => {
    try {
      const result    = await verifyCounterparty("seller", "DEEP-EXT");
      const buyerMeta = readAgentCardMetadata("tommyBuyerAgent");
      const mode = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase() === "vlei" ? "vlei" : "plain";

      if (result.verified && result.verificationType === "DISABLED") {
        const hasLei  = !!buyerMeta?.lei;
        const hasName = !!buyerMeta?.legalEntityName;
        const hasPath = (buyerMeta?.verificationPath?.length ?? 0) > 0;
        return void res.json({
          success: hasLei && hasName,
          mode,
          verificationType:   "PLAIN_GLEIF",
          verificationScript: "NONE",
          agent:              buyerMeta?.agentName ?? "tommyBuyerAgent",
          oorHolder:          buyerMeta?.oorHolderName ?? "Tommy_Chief_Procurement_Officer",
          legalEntityName:    buyerMeta?.legalEntityName ?? "",
          lei:                buyerMeta?.lei ?? "",
          timestamp:          result.timestamp,
          verification: {
            step1_info_loaded:           hasName,
            step2_di_verified:           hasLei,
            step3_seal_found:            hasPath,
            step4_digest_verified:       false,
            step5_public_key_available:  !!buyerMeta?.publicKey,
          },
          plainModeNote: "GLEIF-only check; KERI/vLEI delegation chain NOT verified (CREDENTIAL_MODE=plain)",
        });
      }

      return void res.json({
        success: result.verified,
        mode,
        verificationType:   result.verificationType,
        verificationScript: result.verificationScript,
        agent:              result.agentName,
        oorHolder:          result.oorHolderName,
        legalEntityName:    buyerMeta?.legalEntityName ?? "",
        lei:                buyerMeta?.lei ?? "",
        timestamp:          result.timestamp,
        error:              result.error,
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

  // ── PROJ1-DYN3-CONT8 / M2-ε: Seller self-mode-status endpoint ────────────
  // The seller is the ONLY agent that knows its own SELLER_RESPONSE_MODE
  // (per FRAMEWORK-V2 §5: "SELLER_RESPONSE_MODE is seller-side only; the
  // buyer agent does NOT read this"). This endpoint reports the seller's
  // own resolved mode block — sourced from THIS process's env — for the
  // UI Settings card and any future observer/admin tooling.
  //
  // Naming convention: anything under /api/self/* is the agent reporting
  // ABOUT ITSELF only. No agent's /api/self/* ever proxies another agent.
  // Violating this is what produced Finding #1 (buyer's /api/mode-status
  // claimed to report the seller's mode but read the buyer's env).
  //
  // CORS: seller already uses `app.use(cors())` above (line ~67), which
  // permits all origins. This is fine for the localhost dev rig but should
  // be tightened (to a specific UI origin) before any non-dev deployment.
  app.get('/api/self/mode-status', (_req, res) => {
    try {
      const block = buildSellerResponseModeBlock();
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
        changeInstructions:
          "Seller response mode is set by SELLER_RESPONSE_MODE env var at SELLER agent startup. " +
          "Edit A2A/js/src/agents/seller-agent/.env and restart the seller (no hot reload — " +
          "by design, so audit can't have ambiguous mode).",
        servedBy: "seller-agent@port-" + (process.env.PORT || 8080),
      });
    } catch (err: any) {
      res.status(500).json({
        error:   err?.message ?? "mode-status endpoint error",
        hint:    "Check SELLER_RESPONSE_MODE in A2A/js/src/agents/seller-agent/.env — must be unset, BASIC_SALES_QUOTING_1, L1_DELEGATED_ADVISORS, L2_EXECUTIVE_REASONER, L3_STYLE_AND_AUTONOMY, or L4_LEARNED_PROFILES_AND_PD.",
      });
    }
  });

  // ── WEDGE1 / M2-α.1: validate seller-response-mode before listening ───────────
  // Fail-fast on misconfig. validateSellerResponseMode() throws if
  // SELLER_RESPONSE_MODE is set to a non-shippable value (L3/L4) or anything
  // not in the mode set. Unset env defaults to BASIC_SALES_QUOTING_1
  // (backward compat with prior product).
  // Same wiring as buyer-agent — see substep 4 of M1 there.
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

  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`\n🏪  Seller Agent  →  http://localhost:${PORT}`);
    console.log(`    Margin Price : ₹${SELLER_CONFIG.marginPrice}/unit  (protected)`);
    console.log(`    Target Price : ₹${TARGET_PRICE}/unit`);
    console.log(`    Target Profit: ${(SELLER_CONFIG.targetProfitPercentage * 100).toFixed(0)}%`);
    console.log(`    Max Rounds   : ${SELLER_CONFIG.maxRounds}`);
    console.log(`    DD Safety    : ${SELLER_CONFIG.dd.safetyFactor * 100}%  |  Payment Terms: Net ${SELLER_CONFIG.dd.paymentTermsDays}`);
    console.log(`    Treasury     : ${SELLER_CONFIG.treasury.enabled ? `✓ consulting ${SELLER_CONFIG.treasury.url}` : "disabled"}`);
    // WEDGE1 / M2-α.1: seller-response-mode banner — mirrors buyer-agent
    console.log(`    ── WEDGE1 seller response mode framework ──────────`);
    for (const line of formatStartupBanner(resolvedModeBlock).split("\n")) {
      console.log(`    ${line}`);
    }
    console.log("");
  });
}

main().catch(console.error);
