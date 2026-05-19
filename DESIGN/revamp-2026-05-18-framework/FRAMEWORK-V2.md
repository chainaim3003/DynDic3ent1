# LegentPro — Agentic Procurement Framework v2

**Version:** 2.0 (draft)
**Started:** 2026-05-18
**Status:** 🚧 IN PROGRESS — revamp of v1.2 master design
**Supersedes (when locked):** `current/AGENTIC-PROCUREMENT-ARCHITECTURE.md` (v1.2)
**Audience:** Both internal engineering AND investor/customer pitch source-of-truth.
Sections 1–4 carry the positioning story; sections 5–8 carry the engineering detail;
section 9 ties them together with the harness. Read whichever you need.

---

## How this revamp came about

The v1.2 master design (`current/AGENTIC-PROCUREMENT-ARCHITECTURE.md`) shipped
on May 17, 2026 to anchor the WEDGE1 release. The code in M2-γ (tier framework,
sub-agents wired, L2 executive, multi-dim CLI) ships per that spec.

But several findings during M2-γ implementation surfaced design gaps:

1. **Naming gap.** `NEGOTIATION_MODE` was described as a bilateral configuration
   axis but in practice is seller-side only. `BASIC1` / `ADVANCED1-4` are
   version numbers, not function names. `tactics-engine` is not a tactics
   engine — it's a math aggregator. `rules-based fallback` is not just for
   outages — it could legitimately serve compliance demos and cost-controlled
   tiers. Names should describe what things DO, not when they were added.

2. **Positioning gap.** The v1.2 doc positions the product as "agentic
   procurement for sellers, audit-graded." That's true but undifferentiated.
   Pactum, Arkestro, Lio, Oro all claim the same surface. The actual
   differentiator — **measurable ROI per dollar of decision infrastructure
   spent, with full delegation traceability** — is buried.

3. **Framework gap.** The five orthogonal axes from v1.2 §1 are correct as
   knobs but missing the next layer: how do you *measure* whether configuring
   them differently produces better outcomes? The product needs a
   measurement framework that turns "we have AI agents" into "we have AI
   agents that produced $X of measured value at $Y of measured cost across
   N deals with these specific pressure settings."

4. **Tier-purpose gap.** Why would a customer choose L1 over L2? L2 over L4?
   v1.2 has pricing targets but no clear rationale beyond "more features =
   higher tier." The real answer — cost-vs-value depends on deal mix, audit
   requirements, data maturity — isn't in the doc.

5. **Delegation gap.** Sub-agents act on behalf of organizational roles
   (treasury ≈ CFO, credit ≈ Risk Manager, etc.) but v1.2 doesn't pin this
   chain. For audit-graded EXIM ECI claims and asset-backed-lender
   underwriting, the chain needs to be explicit and signed.

6. **LLM-thinking-per-round audit gap.** Today's audit shows the final
   per-round decision but doesn't make obvious that the LLM is invoked
   fresh every round with fresh inputs. For a regulator asking "did the
   agent actually reason about round 2 separately, or did it derive?", the
   audit needs a clearer trace.

This v2 doc addresses these six gaps in one coherent design. The code on
`main` continues to ship per v1.2 semantics (Guarantee A); v2 introduces
**additive** renames, instrumentation, and a harness. Nothing breaks.

---

# Part I — Positioning and Framework (Audience: Investor / Customer / Strategy)

---

## 1. Where we sit — Agentic Procurement

Agentic procurement is a real category. Pactum/Arkestro/Lio/Oro have raised
$30M–$100M each in 2025–2026 to build the buyer side. Stripe, OpenAI, Google,
and the Linux Foundation are publishing agent-protocol specs (ACP, AP2, x402).
NIST has an AI Agent Standards Initiative underway. EXIM Bank, factoring
partners, and asset-backed lenders are all paying attention to what "agentic
counterparty due diligence" might look like.

**The category is settled. We start here.** Our customer recognizes the
category name before they recognize us. Our job is to be the supplier-side
incumbent in a category currently dominated, on the buyer side, by Pactum
et al.

What we do NOT do: invent a new category, claim AI superiority, or compete
on throughput. The market has decided agentic procurement is what it is.

## 2. The differentiator — accountability per dollar

Pactum's pitch: "Our AI negotiates 1,000 deals/day."
Arkestro's pitch: "Predictive procurement, $36M Series C."
Lio's pitch: "Agentic supplier intelligence, a16z-backed."

These are throughput claims. None of them answer:

- Did the AI's decisions actually improve margin by $X across those deals?
- For a specific deal, who is accountable for the decision the AI made?
- If a regulator asks "why did the agent counter at ₹385 in round 2?", what's
  the answer?
- For a given deal mix, is the AI tier worth what it costs to run?

These questions matter because the agentic procurement category is heading
into regulatory scrutiny (NIST, SEC §302, OCC Letter 2023-7, CFPB Circular
2022-03 on algorithmic decisioning). The vendor that has answers will own the
market. The vendors that have only throughput claims will face a compliance
re-platform.

**Our differentiator: agentic procurement with measurable ROI and complete
delegation traceability.** Same surface category. Profoundly different
defensibility.

## 3. The framework — five axes that make agentic procurement measurable

The framework is what makes "accountability per dollar" concrete. It defines
**five dimensions of variation** that customers can configure, with each
dimension instrumented so its cost and value can be measured.

### 3.1 Axis 1 — Reasoning depth

How much cognitive machinery is wired into the seller's response. From
deterministic SKU-floor enforcement (`BASIC_SALES_QUOTING_1`) up through
multi-advisor consultation + LLM-as-executive with math-informed reasoning
(`L2_EXECUTIVE_REASONER`).

Cost scales: more advisors, larger LLM prompts, longer audit traces.
Value scales: more contextual reasoning, more dimensions considered, better
catch rate on bad deals.

### 3.2 Axis 2 — Guardrails

What constraints are applied to the LLM's output before it ships:

- No guardrails (LLM commits whatever it says) — fastest, cheapest, riskiest
- Hard floor clamp (never below SKU floor) — minimum sales discipline
- Math-band override (LLM proposal must respect game-theory bounds)
- Sanity warning (out-of-band flagged but not overridden)
- Defensive substitution (when an advisor is missing, force conservative
  behavior — e.g., COD instead of Net-60 when credit data is unavailable)
- Human commit gate (high-stakes deals require a human OK before send)

Each guardrail layer is independently configurable per tier.

### 3.3 Axis 3 — Delegation chain

Every decision pinned to an organizational role with explicit authority
envelope. Today's chain:

```
Treasury sub-agent     → CFO role authority
Credit sub-agent       → Risk Manager role authority
Inventory sub-agent    → Operations Director role authority
Logistics sub-agent    → Operations Director role authority
Seller orchestrator    → Chief Sales Officer role authority
Final commit (L0–L2)   → Sales Manager (or higher per autonomy level)
```

Each decision is signed (today: HMAC envelope; tomorrow: vLEI cryptographic
delegation credential). The audit trail captures the full chain: "this
decision was made by agent X, acting under delegation from role Y, signed
at timestamp T, within authority envelope E."

**This is the EXIM Bank / asset-backed lender / regulator value proposition.**
Pactum cannot show this chain.

### 3.4 Axis 4 — Cross-organizational dynamics

How the seller models the bilateral negotiation, not just its own side:

- **Today (BASIC1–L2):** seller reasons about its own side only. Buyer is
  a counterparty whose offers are inputs.
- **Future (L3):** seller infers buyer style from observed offer patterns.
  Adapts its tactics accordingly.
- **Future (L4):** seller has per-counterparty memory. Recognizes that
  this specific buyer (by LEI) has historically conceded on payment terms
  but not on price. Anchors differently.

This axis is what produces *learning across deals*. It's where the moat
deepens — competitors can't replicate the counterparty profile data without
our deal flow.

### 3.5 Axis 5 — Evaluation context and learning

How the system improves over time:

- `live` — production deals, real counterparties, real money
- `paper-trade` — same data, no commit (sales conversion mode)
- `benchmark` — synthetic counterparty with assigned style (research mode)
- `replay` — past deal re-run with different config (counterfactual analysis)
- `harness` — simulation across many deals under specified pressure settings (NEW)

Learning happens through `LEARNING1/2/3` (per-counterparty profile updates,
per-style refinement, opt-in aggregator) over enough live deals.

## 4. The ROI thesis — value at scale, not value per deal

A single deal's framework cost difference is small. $0.02 vs $0.12 vs $0.40
in LLM + API costs per deal. **At scale, the differences compound.**

A simulation across 10,000 deals (Q1 of a mid-sized supplier) might look like:

| Metric | BASIC1 | L1 | L2 |
|---|---|---|---|
| Infra cost (LLM + APIs) | $200 | $700 | $1,200 |
| Total deal value closed | $87M | $87M | $87M |
| Margin captured vs naive baseline | +$120k | +$280k | +$390k |
| Bad deals prevented (treasury/credit/inventory caught) | $0 | $1.1M | $1.4M |
| Bad-deal slip-through (deal closed despite warning) | -$420k | -$80k | -$50k |
| Over-conservative cost (good deals missed) | -$0 | -$60k | -$110k |
| **Net realized framework value** | **-$300k** | **+$1.24M** | **+$1.63M** |
| **Cost per dollar realized** | — | $0.0006 | $0.0007 |
| **Realized $/$ spent** | — | $1,771/$ | $1,358/$ |

(Numbers above are *illustrative shapes*, not measured. The harness defined
in §9 produces the real values.)

The thesis:
- **L1 vs BASIC1**: For most customers, the +$1.5M delta over BASIC1 will
  dwarf the $500 cost delta. L1 pays for itself immediately at moderate
  deal volume.
- **L2 vs L1**: The marginal +$390k requires +$500 in infra. Worth it for
  customers with audit-grade compliance requirements (EXIM ECI, factoring,
  regulator-facing) or with complex multi-dimensional deals.
- **L3 / L4**: Only pay off when accumulated counterparty data exists.
  First-time buyer? L4 has nothing to add. Repeat customer for the third
  time? L4's profile beats L2's blind reasoning.

This is the data that closes a Series A. Not "we use AI" but "here's the
measured value of each tier in dollars, at scale, against your specific deal
mix."

---

# Part II — Tier Ladder and Renaming (Audience: Engineering / Product)

---

## 5. Renamed configuration axes

| Old name (v1.2) | New name (v2) | Rationale |
|---|---|---|
| `NEGOTIATION_MODE` | `SELLER_RESPONSE_MODE` | Honest about scope. The buyer agent does NOT read this. Only the seller's cognitive machinery is gated. |
| `BASIC1` | `BASIC_SALES_QUOTING_1` | Describes the function: enforces SKU floor on the seller's own quote, nothing more. |
| `ADVANCED1` | `L1_DELEGATED_ADVISORS` | Describes the addition: seller now consults delegated sub-agents (treasury + inventory + logistics). |
| `ADVANCED2` | `L2_EXECUTIVE_REASONER` | Describes the addition: LLM-as-executive with math-informed reasoning over the full advisor bundle + binding-constraint identification + 3-layer guardrails. |
| `ADVANCED3` | `L3_STYLE_AND_AUTONOMY` | TKI 5-style framework + opponent style inference + SAE J3016-style commit gates. (post-WEDGE1) |
| `ADVANCED4` | `L4_LEARNED_PROFILES_AND_PD` | Per-counterparty α/δ profiles + custom commodity PD models + ACTUS cashflow sim. (post-WEDGE1) |
| `tactics-engine` | `ADVISOR_MATH_AGGREGATOR` | It's a math aggregator that consumes advisor data and produces derived numbers (effective floor, NBS midpoint, utility). It's not a tactics engine. |
| `rules-based fallback` | `STATIC_NEGOTIATION_LADDER` | Per-round threshold scheme, deterministic, no LLM. Used today for outage safety; could legitimately serve compliance demos or cost-controlled tiers in future. |

**Backward compatibility (Guarantee A continued):** all old names remain valid
as aliases. Setting `NEGOTIATION_MODE=ADVANCED2` in `.env` still resolves to
the same capability set as `SELLER_RESPONSE_MODE=L2_EXECUTIVE_REASONER`. The
audit JSON captures both names for one release cycle, then the old names are
soft-deprecated with a warning, then removed in v2.x.

## 6. The five-step seller-response-thinking-iteration

(Vocabulary fix: "round" is reserved for buyer↔seller exchanges. The seller's
internal reasoning cycle within one round is the **seller-response-thinking-
iteration**, short form **think-cycle**.)

Each round triggers one think-cycle on the seller side. Today: strictly 1:1.
Future tiers (L3+) may allow N:1 think-cycles per round when the seller needs
to iterate internally before committing.

A think-cycle has five steps. Different tiers run different subsets:

```
STEP 1.  Receive buyer offer
STEP 2.  Decide which advisors to consult, then call them in parallel
STEP 3.  Run ADVISOR_MATH_AGGREGATOR over their results
STEP 4.  Call Gemini with the appropriate prompt for this tier
STEP 5.  Apply guardrails to Gemini's output → final {action, price}
```

| Tier | Step 1 | Step 2 | Step 3 | Step 4 (Gemini prompt) | Step 5 (Guardrails) |
|---|---|---|---|---|---|
| `BASIC_SALES_QUOTING_1` | ✓ | — | — | Simple: constraints + offer + round | 1 layer: SKU floor clamp |
| `L1_DELEGATED_ADVISORS` | ✓ | All 4 advisors, always (today) | ✓ effective floor, NBS, utility | Richer: + advisor data + math summary | 1 layer: effective-floor clamp |
| `L2_EXECUTIVE_REASONER` | ✓ | All 4 advisors (today; adaptive selection at L3) | ✓ | Richest: + binding-constraint question + multi-dim counter | 3 layers: clamp + sanity warning + defensive override |
| `L3_STYLE_AND_AUTONOMY` | ✓ | Adaptive selection per routing rules | ✓ + opponent-δ inference | Richest + style framework + opponent style hypothesis | 3 layers + autonomy-level commit gate (L0–L5) |
| `L4_LEARNED_PROFILES_AND_PD` | ✓ | Adaptive + per-counterparty | ✓ + per-counterparty α/δ + ACTUS PD | Richest + counterparty profile history | 3 layers + autonomy gate + per-counterparty defensive policy |

**Key clarification:** Gemini is called **once per think-cycle**, fresh each
round. At L2, Gemini sees the full advisor bundle and math summary every
round, not a derivation from round 1. The audit must surface this clearly
(see §10).

## 7. Per-tier positioning — when each tier pays off

| Tier | Pays off when... | Cost-to-value tipping point |
|---|---|---|
| `BASIC_SALES_QUOTING_1` | Tiny deals, prototype mode, internal-use-only with no audit requirement. | Below ~$500/deal value. Above this, L1's bad-deal prevention outweighs its $0.05 cost premium. |
| `L1_DELEGATED_ADVISORS` | Mid-size deals ($1k–$25k) where being told "no" by treasury/credit/inventory before commit saves a bad NPV. | Typical SMB exporter sweet spot. Free or $99/mo target. |
| `L2_EXECUTIVE_REASONER` | Deals requiring multi-dimensional reasoning (price + term + date + qty), regulator-facing audits (EXIM, factoring, lender underwriting), or LLM-as-executive judgments worth defending. | Mid-large SMB / mid-market. $499/mo target. |
| `L3_STYLE_AND_AUTONOMY` | Repeat customers where the seller has seen enough rounds to infer style; regulated industries that require human-in-the-loop commit. | Enterprise. $1,499/mo target. |
| `L4_LEARNED_PROFILES_AND_PD` | High-frequency relationships (same buyer LEI 10+ times) or high-value enough to justify per-counterparty custom PD. | Large enterprise + financial counterparties. $3,000–10,000/mo target. |

**Why not always the highest tier?**
1. **Cost** scales monotonically with tier (LLM tokens, API calls, audit weight)
2. **Latency** scales monotonically with tier
3. **Required input data** also scales — a higher tier without its required data is *worse* than a lower tier with full data (L4 with no counterparty history is L4-shaped but L2-quality)
4. **Audit weight** scales — small deals don't need encyclopedic audit trails

The right tier is *the one where marginal value exceeds marginal cost for the customer's deal mix*. This is the framework the harness (§9) measures.

## 8. Delegation accountability (the moat detail)

Every decision the system makes carries four metadata fields, captured in
the audit JSON and rendered in the PDF:

```typescript
interface DelegatedDecision {
  decidedBy:        string;   // agent that produced this — "treasury-agent", "seller-orchestrator", etc
  onAuthorityOf:    string;   // organizational role — "CFO", "Chief Sales Officer", etc
  authorityEnvelope: {
    description: string;      // "may reject deals up to $X without escalation"
    limits: {                 // structured limits where applicable
      maxDealValue?:    number;
      maxConcessionPct?: number;
      requiredEscalationAbove?: number;
    };
  };
  signature: {
    kind:      "HMAC" | "vLEI-OOR-credential" | "vLEI-LE-credential";
    value:     string;        // the signature bytes (today HMAC; tomorrow KERI seal)
    signedAt:  string;        // ISO timestamp
  };
}
```

Today the `signature.kind` is `"HMAC"` (the existing hash envelope). Iter-9
and iter-14 (post-WEDGE1) bring real KERI signing via `VleiSignifySigner`.
The audit shape stays the same; only the signature kind changes.

**Audit trail at deal close** contains an ordered list of every
`DelegatedDecision` made across the negotiation, with explicit role chains
and authority envelopes. A reviewer (regulator, insurer, auditor) reading
the audit can answer:

- Who decided to reject round 1 at ₹280? *Treasury sub-agent, on authority
  of CFO role, within envelope "may veto deals where ACTUS net profit <
  0 OR cash gap < safety threshold". Signed at 2026-05-18T19:29:57Z.*
- Why did seller counter at ₹385 in round 2? *Seller orchestrator under
  Chief Sales Officer authority received executive-judgment output from
  L2 LLM, validated against effective floor ₹376 (multi-advisor floor
  from credit + inventory + logistics + treasury). Counter ₹385
  signed at 2026-05-18T19:29:59Z.*

**This chain is the EXIM/factoring/lender value.** It's also what makes
the framework defensible: every dollar of value the harness measures is
attributable to a signed decision chain.

---

# Part III — Engineering Architecture (Audience: Engineering)

---

## 9. The simulation harness (`HARNESS/`)

A separate construct from the production agents. Lives at `DynDic3ent1/HARNESS/`.

### 9.1 Purpose

The production agents run real negotiations one at a time. The harness runs
synthetic negotiations *at scale, under specified pressure settings*, to
measure framework value across deal mixes.

### 9.2 Architecture

```
DynDic3ent1/HARNESS/
├── deal-generators/
│   ├── deal-flow.ts                  ← synthesizes deals matching a profile
│   └── profiles/                     ← named deal-flow profiles
│       ├── smb-exporter-q1.json      ← 1000 deals/qtr, mix typical of small US exporter
│       ├── mid-market-monthly.json
│       └── enterprise-high-value.json
├── counterparty-models/
│   ├── buyer-aggressive.ts           ← simulated buyer with aggressive TKI style
│   ├── buyer-balanced.ts
│   ├── buyer-cooperative.ts
│   └── buyer-from-trace.ts           ← replays a real recorded buyer (for benchmarking)
├── runners/
│   ├── single-deal.ts                ← runs one synthetic deal through a tier config
│   ├── deal-flow.ts                  ← runs N deals through a tier config
│   └── matrix.ts                     ← runs N deals × M tier configs (for A/B)
├── measurements/
│   ├── cost-extractor.ts             ← reads audit JSON → cost in $
│   ├── outcome-extractor.ts          ← reads audit JSON → margin captured, deals closed
│   ├── risk-extractor.ts             ← reads audit JSON → defensive actions fired,
│   │                                       bad deals prevented (vs counterfactual)
│   └── delegation-trace-extractor.ts ← reads audit JSON → role chain completeness
├── reports/
│   ├── pnl-report.ts                 ← Q1-style P&L report (the §4 table)
│   ├── tier-comparison.ts            ← side-by-side BASIC1 vs L1 vs L2 vs L4
│   └── delegation-audit.ts           ← per-deal delegation chain visualization
├── scenarios/                        ← canonical pressure-setting profiles
│   ├── tight-q4-aggressive-buyers.json
│   ├── healthy-cash-cooperative-buyers.json
│   ├── inventory-shortage-rush-orders.json
│   ├── credit-data-outage.json
│   ├── repeat-counterparty-known-pattern.json
│   └── mixed-realistic.json
└── benchmarks/
    ├── basic-vs-l1-vs-l2.ts          ← canonical comparison run
    ├── l4-with-history.ts             ← L4 with 100 prior deals as warm-start
    └── audit-completeness.ts          ← measures delegation-trace completeness across tiers
```

### 9.3 What the harness produces

For each harness run:
- A P&L-shaped CSV/JSON report (cost, outcome, risk avoided, ROI in dollars)
- A delegation-chain completeness score (% of decisions with full role attribution)
- A per-deal audit folder (one audit JSON per deal, same format as production audits)
- An aggregated dashboard view (the report in §4 shape)

### 9.4 What the harness does NOT do

- Does NOT replace production agents — those still run real deals
- Does NOT touch production audit storage — harness runs write to `HARNESS/runs/`
- Does NOT call live external APIs (GLEIF, ERPNext, etc.) — uses fixtures only,
  to keep harness runs hermetic and reproducible
- Does NOT influence production tier selection — production tier is still
  set via `.env` per agent process

### 9.5 The 6 benchmark scenarios

These are the same six scenarios discussed in earlier conversations, but
re-cast as **harness benchmarks**, not demo scripts:

| # | Scenario | What it tests | Expected ROI shape across tiers |
|---|---|---|---|
| 1 | `happy-path-cotton` | Standard deal, no advisor blocks. | All tiers close. Marginal cost wins for BASIC1; L1+ marginal value = $0 here. |
| 2 | `treasury-blocks-low-offer` | Buyer opens far below treasury floor; ACTUS NPV negative. | BASIC1 may close at loss. L1+ catches via treasury veto. **L1's ROI = avoided $X loss / $0.05 spent = catastrophic ROI.** |
| 3 | `inventory-shortfall-defensive` | Buyer requests qty > available inventory. | BASIC1/L1 unaware. L2+ defensive action: "request partial fulfillment." Audit shows the catch. |
| 4 | `tight-budget-escalation` | Budget < seller floor. Mathematically unbridgeable. | All tiers escalate. Difference is audit clarity, not outcome. |
| 5 | `credit-data-outage` | Real-mode credit fetch fails mid-deal. | BASIC1/L1: no concept of credit. L2: defensive substitution forces COD. Audit explicitly names the data unavailability. |
| 6 | `repeat-counterparty` | Same buyer LEI, 100 prior deals on record. | L2: blind reasoning. L4: uses history, anchors differently, closes at higher price. **This is where L4's marginal value shows.** |

Each scenario runs at every tier. The harness emits a comparison table.
**This becomes the customer-facing pitch deck — actual measured numbers for
the customer's deal mix, not hypotheticals.**

## 10. Audit JSON additions in v2

Three new blocks added to the audit JSON. All additive; v1.2 audits remain
valid.

### 10.1 `delegationChain[]`

An ordered list of every signed decision in the negotiation. One entry per
agent action. Replaces the implicit chain that today's audit only hints at.

```json
"delegationChain": [
  {
    "round": 1,
    "stepName": "treasury-consultation",
    "decidedBy": "treasury-agent@port-7070",
    "onAuthorityOf": "CFO",
    "authorityEnvelope": {
      "description": "may veto deals where ACTUS net profit < 0 OR cash gap < safety threshold",
      "limits": { "safetyThreshold": 300000, "minNpv": 0 }
    },
    "signature": { "kind": "HMAC", "value": "...", "signedAt": "2026-..." },
    "outcome": "REJECTED",
    "rationale": "Cash gap ₹-15,430,000 < safety threshold ₹300,000"
  },
  { ... more entries per advisor per round ... },
  {
    "round": 1,
    "stepName": "seller-orchestrator-final-commit",
    "decidedBy": "seller-agent@port-8080",
    "onAuthorityOf": "Chief Sales Officer",
    "authorityEnvelope": { ... },
    "signature": { ... },
    "outcome": "COUNTER 385",
    "rationale": "L2 executive synthesis of advisor inputs + math + LLM reasoning"
  }
]
```

### 10.2 `thinkCycleTrace[]`

Per-round trace showing the LLM was invoked fresh each round, with the full
context. Fixes the audit-clarity gap from §6.

```json
"thinkCycleTrace": [
  {
    "round": 1,
    "step4_geminiPrompt": "...verbatim prompt text...",
    "step4_geminiResponse": { "action": "COUNTER", "price": 385, "reasoning": "...", "bindingConstraint": "price" },
    "step4_audit": { "tokens": 4123, "costUSD": 0.012, "latencyMs": 1840, "decisionPath": "GEMINI_OK" },
    "step5_guardrailsApplied": ["effective-floor-check-passed", "sanity-band-warning-issued"],
    "step5_finalDecision": { "action": "COUNTER", "price": 385 }
  },
  { "round": 2, ... },
  { "round": 3, ... }
]
```

This makes it explicit: 3 separate Gemini calls in a 3-round negotiation,
each with its own fresh context.

### 10.3 `frameworkMetrics`

Per-deal cost / outcome / risk-avoided summary that the harness reads.

```json
"frameworkMetrics": {
  "tier": "L2_EXECUTIVE_REASONER",
  "thinkCycles": 3,
  "totalCostUSD": 0.12,
  "breakdown": {
    "llmCostUSD": 0.10,
    "advisorAPICostUSD": 0.01,
    "humanReviewCostUSD": 0.00
  },
  "outcome": {
    "closed": true,
    "finalPrice": 385,
    "totalDealValue": 19250000,
    "marginVsFloor": 9,
    "marginCapturedUSD": 81000
  },
  "riskAvoided": {
    "defensiveActionsFired": 1,
    "estimatedLossAvoidedUSD": 0,
    "advisorVetoesApplied": 1
  },
  "delegationCompleteness": 1.0
}
```

The harness reads these metrics across N deals to produce the §4-style P&L.

## 11. Scope and shipping plan

### 11.1 What ships now (no code change)

This v2 design doc, in `revamp-2026-05-18-framework/`. Lock the design first;
code follows. Production agents continue to run on v1.2 semantics — the
multi-dim CLI works, the 6 sub-agents work, the L2 executive works.

### 11.2 What ships next (Wave A — instrumentation, ~6-8h)

Add the three new audit blocks (`delegationChain`, `thinkCycleTrace`,
`frameworkMetrics`) to every negotiation. Additive — existing audits remain
valid. The CLI and UI continue to work unchanged.

This wave delivers: real cost measurement, real delegation traceability,
audit clarity for the regulator/insurer story. **Does not change agent
behavior.**

### 11.3 What ships after (Wave B — harness, ~12-16h)

Build the `HARNESS/` tree per §9. Wire deal generators, counterparty models,
runners, measurements, reports. Implement the 6 benchmark scenarios. Run
them. Produce the P&L tables for §4.

This wave delivers: the harness, the measured numbers, the customer-pitch
data, the regression baseline.

### 11.4 What ships after that (Wave C — renames and L3 prep, ~4-6h)

Soft-deprecate `NEGOTIATION_MODE`, `BASIC1`, `ADVANCED1-4` in favor of new
names. Both old and new resolve to the same tiers; audit JSON captures
both. After one release cycle, remove the old names.

Begin L3 design work: TKI style framework, opponent inference, autonomy
levels. Code does not ship in this wave — only the design extension.

### 11.5 What stays unchanged through all waves

- `start negotiation 300` (legacy CLI) — Guarantee A
- `start negotiation --product ... --qty ... --buyer-budget ...` (multi-dim) — Guarantee A extension
- All 6 sub-agent processes on ports 7070-7073, 8080, 9090
- All UI routes (`/agents`, `/deal-quality`, `/contracts`, `/risk`, `/settings`)
- Existing audit JSON shape (the new blocks are additive)
- vLEI integration plan (iter-9, iter-14) untouched

---

## 12. Decision points still open

Issues this doc identifies but doesn't fully resolve. Each is flagged with
my recommendation but needs an explicit sign-off:

| # | Decision | My recommendation | Status |
|---|---|---|---|
| D1 | L1 advisor data — feed into Gemini's prompt, or use only for floor clamp? | Feed into prompt (richer reasoning at marginal cost). | Awaiting confirmation |
| D2 | Per-deal tier selection (vs. env-set frozen-at-boot) | Static heuristic in WEDGE1+1, data-driven post-WEDGE1+3 once harness has data. | Sketched, not detailed |
| D3 | Static negotiation ladder — outage-only, or also a legitimate cost-mode tier? | Both. Outage-only today; cost-mode tier flagged for post-harness. | Open |
| D4 | Counterparty profile storage (L4) — on-prem only, or aggregator-eligible? | On-prem only at first; opt-in aggregator in LEARNING3. | Per v1.2 doc |
| D5 | Vocabulary lock — "think-cycle" vs alternatives | "seller-response-thinking-iteration" formal, "think-cycle" short form | Pending your call |
| D6 | Should `frameworkMetrics` block be added to BASIC1 audits too? | Yes — even BASIC1 should report its cost and outcome so harness can baseline. | Awaiting confirmation |
| D7 | Scenario architecture — declarative intent (BuyerIntent + SellerIntent + Situation) honored by agents, OR procedural script-flags (`--buyer-anchor`, `--rounds`, `--seller-margin-price`) that force a path? | Declarative intent. Forcing the path would make agents puppets to a script, contradicting the autonomy contract that underpins the EXIM/factoring/lender accountability story (§3.3, §8). Probabilistic outcomes within bounded guardrails ARE the product. CONT8 / M2-ε ships the scenario contract in full intent shape via `start negotiation --scenario <id>` (CLI form 3), with JSON scenarios in `A2A/js/src/shared/scenarios/`. Buyer-side wire honors product / quantity / maxBudget today; `buyerIntent.goal` / `softPreferences` / `style` / `walkAwayBehavior` and the entire `sellerIntent` are declared in JSON, displayed in UI tooltips, logged at run-time, but NOT yet flowed through to agent decisions. Seller-side wire is unimplemented (no scenario-handshake envelope yet). | Sketched in CONT8 / M2-ε; full wire pending future iteration. See `M2-DELTA-PROGRESS.md` CONT8 section for what was built and what is deferred. |

## 13. What's NOT in this revamp

To keep scope contained, the following are explicit non-goals:

- Re-architecting the buyer agent. Today it doesn't read `NEGOTIATION_MODE`
  capabilities; that stays.
- vLEI cryptographic signing — still planned for iter-9/14, schedule
  unchanged.
- A new UI for the harness. Reports are CSV/JSON for v2; a UI viewer is
  separate work.
- Style framework code (L3). Design is sketched; code is post-WEDGE1.
- Counterparty profile schema details (L4). Design is sketched; code is
  post-WEDGE1.
- Replacing the existing audit format. v2 is additive on top of v1.2's
  shape.

---

## 14. Cross-reference index

| If you're asking… | Read this section |
|---|---|
| "Why should an investor care about us vs Pactum?" | §2, §4 |
| "What does each tier actually do in code?" | §6 |
| "When does L1 pay off vs L2?" | §7, plus harness results from §9.5 |
| "How does the seller's CFO get accountability for the AI's decision?" | §3.3, §8, §10.1 |
| "Will my existing CLI / UI / scripts break?" | §11.5 (no — Guarantee A) |
| "What's the next code change?" | §11.2 (Wave A instrumentation) |
| "What's the demo story?" | §9.5 (6 benchmark scenarios produce dollar comparisons) |
| "Where's the audit JSON spec?" | §10 |

---

*End of FRAMEWORK-V2 draft v2.0. Companion docs in `current/` (unchanged
during draft phase). Promote to `current/` only after explicit sign-off on
§12 open decisions and §11 shipping plan.*
