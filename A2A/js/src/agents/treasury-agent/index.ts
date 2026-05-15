// ================= JUPITER TREASURY AGENT =================
// Holds Jupiter Knitting Company's balance sheet and validates cash-flow impact
// before the seller agent commits to any price.
//
// Two interfaces:
//   1. A2A agent  (port 7070)                  — standard streaming protocol
//   2. REST POST /consult  (same port)          — synchronous, used by seller agent
//
// ACTUS Simulation:
//   Models the proposed sale as a PAM contract (Receivable, RPA role):
//     IED (t=0)  : production outflow leaves the treasury
//     MD  (t=N)  : invoice collection arrives after Net-N payment terms
//   Checks:
//     1. cashPositive   — gap cash stays above safetyThreshold during the N-day wait
//     2. dealProfitable — adjusted net profit > 0 after working-capital financing cost
//     3. npvPositive    — discounted NPV of the receivable > 0 at hurdle rate
//   If any check fails → approved = false, minViablePrice is computed.

import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

import { AgentCard, TaskStatusUpdateEvent } from "@a2a-js/sdk";
import {
  InMemoryTaskStore,
  AgentExecutor,
  RequestContext,
  ExecutionEventBus,
  DefaultRequestHandler,
} from "@a2a-js/sdk/server";
import { A2AExpressApp } from "@a2a-js/sdk/server/express";
import { ActusClient } from "../../shared/actus-client.js";
import type { ActusEvent } from "../../shared/actus-client.js";
import {
  getMarketSnapshot,
  buildSOFRAdjustedSeries,
  printMarketSnapshot,
} from "../../shared/market-data-client.js";

import { suppressSDKNoise, logInternal } from "../../shared/logger.js";
import { SSEBroadcaster } from "../../shared/sse-broadcaster.js";
import { computeLinearDiscount } from "../../shared/dd-calculator.js";

const sseBroadcaster = new SSEBroadcaster("treasury");

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
suppressSDKNoise();

// ================= JUPITER KNITTING COMPANY — BALANCE SHEET =================
const TREASURY_CONFIG = {
  // Balance sheet (public within Jupiter)
  currentBalance:     25_00_000,   // ₹25 lakhs total cash
  pendingOutflows:    14_00_000,   // ₹14 lakhs committed to in-progress orders
  // Derived
  get availableLiquidity() { return this.currentBalance - this.pendingOutflows; },  // ₹11 lakhs free

  // Production economics (internal cost model)
  unitProductionCost: 330,         // raw material + direct labour per unit (INR)
  overheadPerOrder:   30_000,      // fixed: S&A, logistics, quality check (INR)

  // Risk thresholds
  safetyThreshold:    3_00_000,    // ₹3 lakhs minimum buffer — NEVER go below this
  hurdleRateAnnual:   0.12,        // 12 % p.a. — cost of working capital / opportunity cost

  company: "Jupiter Knitting Company",
};

// ================= TYPES (exported for seller-agent import) =================
export interface TreasuryQuery {
  negotiationId:  string;
  pricePerUnit:   number;
  quantity:       number;
  paymentTerms:   number;   // days  (e.g. 30 for Net 30)
  round:          number;
}

export interface ActusCashFlowEvent {
  date:     string;         // ISO date
  eventType: "IED" | "MD"; // Initial Exchange Date | Maturity Date
  cashFlow: number;         // negative = outflow, positive = inflow
  runningBalance: number;   // treasury balance after this event
  description: string;
}

export interface TreasuryResult {
  approved:            boolean;
  // Balance snapshot
  currentBalance:      number;
  availableLiquidity:  number;
  safetyThreshold:     number;
  // Deal metrics
  productionCost:      number;
  grossRevenue:        number;
  workingCapitalCost:  number;   // financing cost for the N-day gap
  netProfit:           number;   // gross revenue − productionCost − workingCapitalCost
  npvOfDeal:           number;   // PV of invoice inflow − productionCost outflow
  // Cash position during the gap
  projectedMinBalance: number;   // availableLiquidity − productionCost (worst-case during gap)
  // Failure details
  failReasons:         string[];
  // Minimum price to restore approval (set if !approved)
  minViablePrice?:     number;
  // Human-readable summary
  recommendation:      string;
  // ACTUS cash flow timeline
  actusEvents:         ActusCashFlowEvent[];
}

// ================= ACTUS PAM SIMULATION (local, always available) ============
function runActusSimulation(query: TreasuryQuery): TreasuryResult {
  const { pricePerUnit, quantity, paymentTerms } = query;

  // ── Cost model ────────────────────────────────────────────────────────────
  const productionCost     = quantity * TREASURY_CONFIG.unitProductionCost + TREASURY_CONFIG.overheadPerOrder;
  const availLiq           = TREASURY_CONFIG.availableLiquidity;

  // ── Revenue model ─────────────────────────────────────────────────────────
  const grossRevenue       = pricePerUnit * quantity;
  const gstAmount          = Math.round(grossRevenue * 0.18);   // 18 % GST on invoice
  const invoiceTotal       = grossRevenue + gstAmount;

  // ── Working capital financing cost ────────────────────────────────────────
  //    Seller must fund productionCost for `paymentTerms` days before inflow arrives.
  const dailyRate          = TREASURY_CONFIG.hurdleRateAnnual / 365;
  const workingCapitalCost = Math.round(productionCost * dailyRate * paymentTerms);

  // ── Net profit (nominal, after financing) ─────────────────────────────────
  const netProfit          = grossRevenue - productionCost - workingCapitalCost;

  // ── NPV of deal (discounted receivable) ───────────────────────────────────
  //    NPV = PV(invoice_inflow) − production_outflow
  const discountFactor     = 1 / (1 + TREASURY_CONFIG.hurdleRateAnnual * (paymentTerms / 365));
  const npvOfDeal          = Math.round(invoiceTotal * discountFactor - productionCost);

  // ── Cash-position check ───────────────────────────────────────────────────
  //    During the N-day gap, treasury loses `productionCost` immediately.
  const projectedMinBalance = availLiq - productionCost;

  // ── ACTUS PAM Cash Flow Events (seller = RPA) ─────────────────────────────
  const today    = new Date();
  const maturity = new Date(today);
  maturity.setDate(maturity.getDate() + paymentTerms);

  const actusEvents: ActusCashFlowEvent[] = [
    {
      date:           today.toISOString().split("T")[0],
      eventType:      "IED",
      cashFlow:       -productionCost,
      runningBalance: availLiq - productionCost,
      description:    `Production outflow: ${quantity} units × ₹${TREASURY_CONFIG.unitProductionCost} + ₹${TREASURY_CONFIG.overheadPerOrder.toLocaleString()} overhead`,
    },
    {
      date:           maturity.toISOString().split("T")[0],
      eventType:      "MD",
      cashFlow:       +invoiceTotal,
      runningBalance: availLiq - productionCost + invoiceTotal,
      description:    `Invoice collection (Net ${paymentTerms}): ₹${grossRevenue.toLocaleString()} + GST ₹${gstAmount.toLocaleString()}`,
    },
  ];

  // ── Check conditions ──────────────────────────────────────────────────────
  const cashPositive    = projectedMinBalance >= TREASURY_CONFIG.safetyThreshold;
  const dealProfitable  = netProfit > 0;
  const npvPositive     = npvOfDeal > 0;
  const approved        = cashPositive && dealProfitable && npvPositive;

  const failReasons: string[] = [];
  if (!cashPositive)   failReasons.push(`Gap cash ₹${projectedMinBalance.toLocaleString()} < safety threshold ₹${TREASURY_CONFIG.safetyThreshold.toLocaleString()}`);
  if (!dealProfitable) failReasons.push(`Net profit negative: ₹${netProfit.toLocaleString()} (after ₹${workingCapitalCost.toLocaleString()} financing cost)`);
  if (!npvPositive)    failReasons.push(`NPV negative: ₹${npvOfDeal.toLocaleString()}`);

  // ── Minimum viable price (if rejected) ───────────────────────────────────
  let minViablePrice: number | undefined;
  if (!approved) {
    // 1) From profitability: price × qty ≥ productionCost + workingCapitalCost
    //    (workingCapitalCost ≈ productionCost × dailyRate × paymentTerms, treat as constant)
    const minFromProfit = Math.ceil((productionCost + workingCapitalCost) / quantity) + 1;

    // 2) From NPV: price × qty × 1.18 × discountFactor ≥ productionCost
    const minFromNPV    = Math.ceil(productionCost / (quantity * 1.18 * discountFactor)) + 1;

    // 3) From cash: if cash is always below threshold regardless of price, the
    //    seller must request advance payment — represent as a liquidity premium.
    //    liquidityShortfall = safetyThreshold − projectedMinBalance  (if positive)
    const shortfall     = Math.max(0, TREASURY_CONFIG.safetyThreshold - projectedMinBalance);
    const liquidityPremiumPerUnit = shortfall > 0
      ? Math.ceil(shortfall * TREASURY_CONFIG.hurdleRateAnnual * (paymentTerms / 365) / quantity) + 1
      : 0;
    const minFromCash   = Math.ceil(TREASURY_CONFIG.unitProductionCost + liquidityPremiumPerUnit);

    minViablePrice = Math.max(minFromProfit, minFromNPV, minFromCash);
  }

  // ── Build recommendation text ─────────────────────────────────────────────
  let recommendation: string;
  if (approved) {
    recommendation = [
      `✓ APPROVED — Cash flow and profitability safe.`,
      `  Gap cash    : ₹${projectedMinBalance.toLocaleString()} (threshold ₹${TREASURY_CONFIG.safetyThreshold.toLocaleString()})`,
      `  NPV of deal : ₹${npvOfDeal.toLocaleString()}`,
      `  Net profit  : ₹${netProfit.toLocaleString()} (after ₹${workingCapitalCost.toLocaleString()} financing cost)`,
    ].join("\n");
  } else {
    recommendation = [
      `✗ REJECTED — ${failReasons.join("  |  ")}`,
      `  → Minimum viable price: ₹${minViablePrice}/unit`,
    ].join("\n");
  }

  return {
    approved,
    currentBalance:      TREASURY_CONFIG.currentBalance,
    availableLiquidity:  availLiq,
    safetyThreshold:     TREASURY_CONFIG.safetyThreshold,
    productionCost,
    grossRevenue,
    workingCapitalCost,
    netProfit,
    npvOfDeal,
    projectedMinBalance,
    failReasons,
    minViablePrice,
    recommendation,
    actusEvents,
  };
}

// ================= TREASURY PRINTER (server-side console) ===================
function printTreasuryResult(query: TreasuryQuery, result: TreasuryResult) {
  const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", red: "\x1b[31m", cyan: "\x1b[36m", yellow: "\x1b[33m",
    bgGreen: "\x1b[42m", bgRed: "\x1b[41m",
  };

  console.log("");
  console.log(`  ${C.cyan}${C.bold}  🏦  ACTUS SIMULATION — JUPITER TREASURY${"".padEnd(18)}  ${C.reset}`);
  console.log(`  ${C.dim}  Neg : ${query.negotiationId}  │  Round ${query.round}  │  ₹${query.pricePerUnit}/unit × ${query.quantity} | Net ${query.paymentTerms}d${C.reset}`);
  console.log(`  ${C.dim}  ─────────────────────────────────────────────────────────${C.reset}`);
  console.log(`  ${C.dim}  Available liquidity  : ₹${result.availableLiquidity.toLocaleString()}${C.reset}`);
  console.log(`  ${C.dim}  Production cost      : ₹${result.productionCost.toLocaleString()} (${query.quantity} units × ₹${TREASURY_CONFIG.unitProductionCost} + ₹${TREASURY_CONFIG.overheadPerOrder.toLocaleString()} overhead)${C.reset}`);
  console.log(`  ${C.dim}  Working capital cost : ₹${result.workingCapitalCost.toLocaleString()} (${(TREASURY_CONFIG.hurdleRateAnnual * 100).toFixed(0)}% p.a. × ${query.paymentTerms}d)${C.reset}`);
  console.log("");

  // ACTUS cash flow events
  console.log(`  ${C.bold}  Cash Flow Timeline (ACTUS PAM — Seller = RPA):${C.reset}`);
  for (const evt of result.actusEvents) {
    const sign     = evt.cashFlow >= 0 ? "+" : "-";
    const flowColor = evt.cashFlow >= 0 ? C.green : C.red;
    const balColor  = evt.runningBalance < TREASURY_CONFIG.safetyThreshold ? C.red : C.dim;
    console.log(`  ${C.dim}  [${evt.date}] ${evt.eventType.padEnd(4)}  ${flowColor}${C.bold}${sign}₹${Math.abs(evt.cashFlow).toLocaleString()}${C.reset}  │ balance: ${balColor}₹${evt.runningBalance.toLocaleString()}${C.reset}`);
    console.log(`  ${C.dim}                    ${evt.description}${C.reset}`);
  }

  console.log("");
  console.log(`  ${C.dim}  NPV of deal          : ₹${result.npvOfDeal.toLocaleString()}${C.reset}`);
  console.log(`  ${C.dim}  Net profit           : ₹${result.netProfit.toLocaleString()}${C.reset}`);

  if (result.approved) {
    console.log(`  ${C.bgGreen}${C.bold}  → TREASURY APPROVED ✓${"".padEnd(38)}  ${C.reset}`);
  } else {
    console.log(`  ${C.bgRed}${C.bold}  → TREASURY REJECTED ✗  — ${result.failReasons.join(" | ")}${"".padEnd(Math.max(0, 35 - result.failReasons.join(" | ").length))}  ${C.reset}`);
    console.log(`  ${C.yellow}${C.bold}  → Min viable price: ₹${result.minViablePrice}/unit${C.reset}`);
  }
  console.log(`  ${C.dim}  ─────────────────────────────────────────────────────────${C.reset}`);
  console.log("");
}

// ================= A2A AGENT EXECUTOR =======================================
class TreasuryAgentExecutor implements AgentExecutor {
  async cancelTask(taskId: string): Promise<void> {
    logInternal(`Treasury: task cancelled ${taskId}`);
  }

  async execute(ctx: RequestContext, bus: ExecutionEventBus) {
    const taskId    = ctx.task?.id        || uuidv4();
    const contextId = ctx.task?.contextId || uuidv4();

    const dataParts = ctx.userMessage.parts.filter((p) => p.kind === "data");

    if (dataParts.length === 0) {
      this.respond(bus, taskId, contextId,
        `🏦 Jupiter Treasury Agent Ready\n` +
        `   Company            : ${TREASURY_CONFIG.company}\n` +
        `   Current Balance    : ₹${TREASURY_CONFIG.currentBalance.toLocaleString()}\n` +
        `   Available Liquidity: ₹${TREASURY_CONFIG.availableLiquidity.toLocaleString()}\n` +
        `   Safety Threshold   : ₹${TREASURY_CONFIG.safetyThreshold.toLocaleString()}\n` +
        `   Hurdle Rate        : ${(TREASURY_CONFIG.hurdleRateAnnual * 100).toFixed(0)}% p.a.`
      );
      return;
    }

    const query = (dataParts[0] as any).data as TreasuryQuery;
    logInternal(`Treasury A2A consultation: NEG ${query.negotiationId} | ₹${query.pricePerUnit}/unit × ${query.quantity} | Net ${query.paymentTerms}`);

    const result = runActusSimulation(query);
    printTreasuryResult(query, result);

    this.respond(bus, taskId, contextId,
      `Treasury verdict: ${result.approved ? "APPROVED ✓" : "REJECTED ✗"}\n${result.recommendation}`
    );
  }

  private respond(bus: ExecutionEventBus, taskId: string, contextId: string, text: string) {
    sseBroadcaster.broadcast(text);
    bus.publish({
      kind: "status-update",
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

// ================= EXPRESS SERVER SETUP =====================================
const cardPath = path.resolve(__dirname, "../../../agent-cards/jupiterTreasuryAgent-card.json");
const treasuryCard: AgentCard = JSON.parse(fs.readFileSync(cardPath, "utf8"));

const app = express();
app.use(cors());
app.use(express.json());

// ── Synchronous REST consultation endpoint — used by seller agent ────────────
// The seller needs a synchronous response BEFORE replying to the buyer,
// so it calls this REST endpoint directly rather than going through A2A streaming.
app.post("/consult", (req, res) => {
  const query: TreasuryQuery = req.body;

  if (!query.negotiationId || !query.pricePerUnit || !query.quantity) {
    res.status(400).json({ error: "Missing required fields: negotiationId, pricePerUnit, quantity" });
    return;
  }

  // Broadcast incoming consultation request (Seller → Treasury)
  sseBroadcaster.broadcast(
    `📨 Seller → Treasury\nConsultation request\nNeg    : ${query.negotiationId}\nPrice  : ₹${query.pricePerUnit}/unit × ${query.quantity}\nTerms  : Net ${query.paymentTerms} days\nRound  : ${query.round}`
  );

  const result = runActusSimulation(query);
  printTreasuryResult(query, result);

  // Broadcast full ACTUS simulation result (Treasury → Seller)
  const eventsText = result.actusEvents.map(e => {
    const sign = e.cashFlow >= 0 ? '+' : '-';
    return `  [${e.date}] ${e.eventType}  ${sign}₹${Math.abs(e.cashFlow).toLocaleString()}  balance: ₹${e.runningBalance.toLocaleString()}\n  ${e.description}`;
  }).join('\n');

  sseBroadcaster.broadcast(
    `🏦 Treasury → Seller\n` +
    `Neg    : ${query.negotiationId}  Round ${query.round}\n` +
    `Price  : ₹${query.pricePerUnit}/unit × ${query.quantity}  |  Net ${query.paymentTerms}d\n` +
    `─────────────────────────────────\n` +
    `Liquidity    : ₹${result.availableLiquidity.toLocaleString()}\n` +
    `Prod cost    : ₹${result.productionCost.toLocaleString()}\n` +
    `Working cap  : ₹${result.workingCapitalCost.toLocaleString()}\n` +
    `NPV          : ₹${result.npvOfDeal.toLocaleString()}\n` +
    `Net profit   : ₹${result.netProfit.toLocaleString()}\n` +
    `─────────────────────────────────\n` +
    `${eventsText}\n` +
    `─────────────────────────────────\n` +
    `Verdict : ${result.approved ? "APPROVED ✓" : "REJECTED ✗"}\n` +
    `${result.recommendation}`
  );

  res.json(result);
});

// ── DD Validation endpoint — called by seller when DD_ACCEPT arrives ─────────
app.post("/validate-dd", (req, res) => {
  const { negotiationId, invoiceId, settlementDate, notionalAmount,
          maxDiscountRate, invoiceDate, dueDate, sellerRevenue } = req.body;

  if (!negotiationId || !invoiceId || !settlementDate) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  // ── Mock delegation chain check ───────────────────────────────────────────
  // In production this would verify via GLEIF OOR API:
  //   treasury.di → jupiterSellerAgent.lei, and that delegation is unrevoked.
  // Here we hard-code the expected LEI of jupiterSellerAgent.
  const EXPECTED_SELLER_LEI = "3358004DXAMRWRUIYJ05"; // same LEI — same legal entity
  const delegationValid = true; // mock: always valid within same entity

  const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m",
  };

  console.log("");
  console.log(`  ${C.cyan}${C.bold}  🔐  DD VALIDATION REQUEST — ${invoiceId}${C.reset}`);
  console.log(`  ${C.dim}  Negotiation : ${negotiationId}${C.reset}`);
  console.log(`  ${C.dim}  Settlement  : ${settlementDate}  |  Notional: ₹${Number(notionalAmount).toLocaleString()}${C.reset}`);
  console.log(`  ${C.dim}  Delegation chain check: treasury.di → jupiterSellerAgent (LEI ${EXPECTED_SELLER_LEI})${C.reset}`);
  console.log(`  ${delegationValid ? C.green : C.yellow}${C.bold}  ${delegationValid ? "✓ Delegation valid" : "⚠ Delegation check failed"}${C.reset}`);

  // ── Verify DD economics from treasury's perspective ───────────────────────
  const MS_PER_DAY = 86_400_000;
  const totalDays = Math.max(1, Math.round(
    (new Date(dueDate).getTime() - new Date(invoiceDate).getTime()) / MS_PER_DAY
  ));
  const daysEarly = Math.max(0, Math.round(
    (new Date(dueDate).getTime() - new Date(settlementDate).getTime()) / MS_PER_DAY
  ));
  const appliedRate     = maxDiscountRate * (daysEarly / totalDays);
  const discountAmount  = Math.round(notionalAmount * appliedRate);
  const netReceivable   = notionalAmount - discountAmount;
  const profitAfterDD   = sellerRevenue - discountAmount;
  const ddValidEconomic = profitAfterDD > 0;

  console.log(`  ${C.dim}  DD economics: applied ${(appliedRate * 100).toFixed(3)}%  |  discount ₹${discountAmount.toLocaleString()}  |  net receivable ₹${netReceivable.toLocaleString()}${C.reset}`);
  console.log(`  ${C.dim}  Profit after DD: ₹${profitAfterDD.toLocaleString()} ${ddValidEconomic ? "(positive ✓)" : "(NEGATIVE ✗)"}${C.reset}`);
  console.log(`  ${C.dim}  ─────────────────────────────────────────────────────────${C.reset}`);
  console.log("");

  res.json({
    approved:         delegationValid && ddValidEconomic,
    delegationValid,
    ddValidEconomic,
    appliedRate,
    discountAmount,
    netReceivable,
    profitAfterDD,
    failReasons: [
      ...(!delegationValid ? ["Delegation chain invalid"] : []),
      ...(!ddValidEconomic ? [`Profit after DD is negative: ₹${profitAfterDD.toLocaleString()}`] : []),
    ],
  });
});

// ── In-memory store of completed DD ACTUS contracts ──────────────────────────
interface ActusContractRecord {
  invoiceId:       string;
  negotiationId:   string;
  invoiceDate:     string;
  dueDate:         string;
  settlementDate:  string;
  notionalAmount:  number;
  maxDiscountRate: number;
  appliedRate:     number;
  discountedAmount: number;
  savingAmount:    number;
  sofrRate:        number;
  hurdleRate:      number;
  actusSuccess:    boolean;
  events:          ActusEvent[];
  createdAt:       string;
}
const actusContractStore: ActusContractRecord[] = [];

// ── DD Cashflow Schedule endpoint (sub-delegation from seller on DD_ACCEPT) ───────
// Seller delegates ACTUS cashflow computation to treasury.
// Treasury:
//   1. Gets live market data (SOFR, cotton, EBR)
//   2. Builds SOFR-adjusted reference index series (L4 — not flat)
//   3. Sets hurdle rate = EBR + 300bps (SOFR-linked, not static 7.5%)
//   4. Runs 4-step ACTUS PAM simulation
//   5. Returns cashflow events + market context to seller
app.post("/dd-cashflow-schedule", async (req, res) => {
  const {
    negotiationId, invoiceId, settlementDate,
    notionalAmount, maxDiscountRate,
    invoiceDate, dueDate, sellerRevenue,
  } = req.body;

  if (!negotiationId || !invoiceId || !settlementDate) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", magenta: "\x1b[35m",
  };

  console.log("");
  console.log(`  ${C.magenta}${C.bold}  📅  DD CASHFLOW SCHEDULE — SUB-DELEGATION FROM SELLER${C.reset}`);
  console.log(`  ${C.dim}  Invoice   : ${invoiceId}  |  Negotiation: ${negotiationId}${C.reset}`);
  console.log(`  ${C.dim}  Settlement: ${settlementDate}  |  Notional: ₹${Number(notionalAmount).toLocaleString()}${C.reset}`);

  try {
    // Step 1: Get live market data
    const market = await getMarketSnapshot();
    printMarketSnapshot(market, "L4 Market Data for ACTUS Cashflow");

    // Step 2: Compute SOFR-adjusted hurdle rate (replaces static 7.5%)
    const adjustedHurdle = parseFloat((market.effectiveBorrowingRate + 0.03).toFixed(6));
    console.log(`  ${C.dim}  Hurdle rate: ${(adjustedHurdle * 100).toFixed(2)}%  (EBR ${(market.effectiveBorrowingRate * 100).toFixed(2)}% + 300bps)  [was static 7.5%]${C.reset}`);

    // Step 3: Build SOFR-adjusted declining reference index series (replaces flat)
    const refSeries = buildSOFRAdjustedSeries(
      invoiceDate, dueDate, Number(sellerRevenue), market.sofrRate
    );
    console.log(`  ${C.dim}  Reference series: ${refSeries.length} points  Day-0=₹${refSeries[0]?.value.toLocaleString()}  Day-last=₹${refSeries[refSeries.length - 1]?.value.toLocaleString()}  [SOFR-adjusted, not flat]${C.reset}`);

    // Step 4: Run ACTUS 4-step simulation
    const actusClient = new ActusClient();
    const actusResult = await actusClient.submitDDContract({
      contractId:            invoiceId,
      negotiationId,
      invoiceDate,
      dueDate,
      settlementDate,
      notionalAmount:        Number(notionalAmount),
      maxDiscountRate:       Number(maxDiscountRate),
      hurdleRateAnnualized:  adjustedHurdle,
      sellerRevenue:         Number(sellerRevenue),
      referenceIndexSeries:  refSeries,
    });

    if (actusResult.success) {
      console.log(`  ${C.green}${C.bold}  ✓  ACTUS simulation SUCCESS — ${actusResult.events?.length ?? 0} cashflow events${C.reset}`);
    } else {
      console.log(`  ${C.yellow}${C.bold}  ⚠  ACTUS simulation FAILED — ${actusResult.error}${C.reset}`);
    }
    console.log(`  ${C.dim}  ─────────────────────────────────────────────────────────${C.reset}`);
    console.log("");

    // Broadcast ACTUS result to UI
    sseBroadcaster.broadcast(
      `🏦 Treasury → Seller\nACTUS DD Cashflow\nInvoice    : ${invoiceId}\nSettlement : ${settlementDate}\nSOFR       : ${(market.sofrRate * 100).toFixed(2)}%\nHurdle     : ${(adjustedHurdle * 100).toFixed(2)}%\nACTUS      : ${actusResult.success ? "✓ SUCCESS" : "⚠ " + actusResult.error}`
    );

    // Store contract record for UI retrieval
    const ddResult = computeLinearDiscount(
      Number(notionalAmount), Number(maxDiscountRate),
      invoiceDate, dueDate, settlementDate
    );
    actusContractStore.push({
      invoiceId,
      negotiationId,
      invoiceDate,
      dueDate,
      settlementDate,
      notionalAmount:   Number(notionalAmount),
      maxDiscountRate:  Number(maxDiscountRate),
      appliedRate:      ddResult.appliedRate,
      discountedAmount: ddResult.discountedAmount,
      savingAmount:     ddResult.savingAmount,
      sofrRate:         market.sofrRate,
      hurdleRate:       adjustedHurdle,
      actusSuccess:     actusResult.success,
      events:           actusResult.events ?? [],
      createdAt:        new Date().toISOString(),
    });

    res.json({
      success:         actusResult.success,
      events:          actusResult.events ?? [],
      contractId:      actusResult.contractId,
      scenarioId:      actusResult.scenarioId,
      error:           actusResult.error,
      market: {
        sofrRate:               market.sofrRate,
        sofrSource:             market.sofrSource,
        effectiveBorrowingRate: market.effectiveBorrowingRate,
        adjustedHurdleRate:     adjustedHurdle,
        cottonPricePerLb:       market.cottonPricePerLb,
      },
    });

  } catch (err: any) {
    console.log(`  ${C.yellow}  ⚠  DD cashflow schedule error: ${err?.message ?? err}${C.reset}`);
    res.status(500).json({ success: false, error: err?.message ?? String(err), events: [] });
  }
});

// ── ACTUS Contracts endpoint — UI fetches completed DD contracts ──────────────
app.get("/actus-contracts", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json(actusContractStore);
});

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    company: TREASURY_CONFIG.company,
    currentBalance: TREASURY_CONFIG.currentBalance,
    availableLiquidity: TREASURY_CONFIG.availableLiquidity,
    safetyThreshold: TREASURY_CONFIG.safetyThreshold,
  });
});

// ── A2A routes ────────────────────────────────────────────────────────────────
const executor = new TreasuryAgentExecutor();
const handler  = new DefaultRequestHandler(treasuryCard, new InMemoryTaskStore(), executor);
new A2AExpressApp(handler).setupRoutes(app);

// SSE endpoint — UI subscribes here to receive live treasury messages
app.get('/negotiate-events', (req, res) => sseBroadcaster.addClient(req, res));

const PORT = process.env.PORT || 7070;
app.listen(PORT, () => {
  console.log(`\n🏦  Jupiter Treasury Agent  →  http://localhost:${PORT}`);
  console.log(`    Company            : ${TREASURY_CONFIG.company}`);
  console.log(`    Current Balance    : ₹${TREASURY_CONFIG.currentBalance.toLocaleString()}`);
  console.log(`    Available Liquidity: ₹${TREASURY_CONFIG.availableLiquidity.toLocaleString()}`);
  console.log(`    Pending Outflows   : ₹${TREASURY_CONFIG.pendingOutflows.toLocaleString()}`);
  console.log(`    Safety Threshold   : ₹${TREASURY_CONFIG.safetyThreshold.toLocaleString()}`);
  console.log(`    Unit Prod. Cost    : ₹${TREASURY_CONFIG.unitProductionCost}/unit`);
  console.log(`    Overhead/Order     : ₹${TREASURY_CONFIG.overheadPerOrder.toLocaleString()}`);
  console.log(`    Working Cap. Rate  : ${(TREASURY_CONFIG.hurdleRateAnnual * 100).toFixed(0)}% p.a.`);
  console.log(`    REST endpoint      : POST http://localhost:${PORT}/consult`);
  console.log(`    A2A card           : http://localhost:${PORT}/.well-known/agent-card.json\n`);
});
