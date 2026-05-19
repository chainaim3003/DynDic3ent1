# Autonomy in Sub-Agent Consultation — Deep Dive Research & Design Proposal
## For LegentPro Seller Agent's Consulting Behavior

> **Audience:** Project 1 (LegentPro) implementers in `DynDic3ent1/`
> **Date:** 2026-05-15
> **Status:** Research synthesis + design proposal. No code changed.
> **Question being answered:** When the seller has up to four sub-agents (Treasury, Inventory, Credit, Logistics), which does it consult, when, how is the answer weighted, what prompt is used, what time budget applies, and how do these decisions map to autonomy levels and to *reasonable, realistic outcomes* for buyer and seller?

---

## Part 0 — What I'm grounding this on

This document combines findings from three research literatures I read this session:

1. **Levels of autonomy** — Feng/McDonald/Zhang (Knight Institute 2025), framework with five levels (Operator → Collaborator → Consultant → Approver → Observer); MIT 2025 Agent Index for deployed-system level distributions.
2. **Meta-reasoning and adaptive consultation in LLM agents** — Ares (2603.07915, lightweight router for reasoning effort per step); EcoAct (2411.01643, register tools only as needed, ~50% cost reduction); CTA "Calibrate-Then-Act" (2602.16699, cost-aware exploration); VoI (2601.06407, decision-theoretic Value of Information for clarify-vs-commit); Utility-Guided Orchestration (2603.19896, explicit gain/cost/uncertainty/redundancy scoring); When2Tool (2605.09252, "LLM agents already know when to call tools — even without reasoning"); MAXS (2601.09259, meta-adaptive exploration with lookahead).
3. **Bargaining outcome quality** — Rubinstein 1982 and Nash 1950 (canonical); Singh/Borkotokey/Kumar (arXiv:2603.29297, "individual rationality + Nash bargaining solution + Pareto efficiency" as the formal benchmark trio); Tuncel/Mislin/Kesebir/Pinkley 2016 (Psychological Science — "agreement attraction and impasse aversion" → people accept bad deals rather than no deal); Yao et al. 2020 (when there is no ZOPA, mental fatigue & integrative complexity become the determinants); Baarslag (CWI, "The Value of Information in Automated Negotiation"); Harvard PON's ZOPA + BATNA practitioner literature.

Citations in §10. Every claim of a specific finding here is anchored to one of these.

---

## Part 1 — A reframing of your sub-questions

You asked five things. Let me restate them as a coherent decision problem the seller agent must solve every round:

> **The seller's consultation problem:** Each round, the seller has up to 4 sub-agents it could ask. Consulting any sub-agent costs latency, tokens, and adds noise. Skipping a sub-agent risks missing a signal that would change the price. Given the round number, the negotiation history so far, and the seller's prior beliefs about the four signals, the seller must choose (a) **which** sub-agents to consult, (b) **what specific question** to ask each one, (c) **how much** to weigh each answer, (d) **how much time** to give each consultation, (e) **how** to synthesize their advisories into a price decision.

This is **not** a question the current code answers. Today's code consults Treasury always, with the same query each round, with a 5-second timeout, and uses its result only as a floor check. **The single most non-trivial autonomy increase the design could add** is to let the seller answer the five questions above adaptively.

Below I explain each sub-question, grounded in the research, then propose a design.

---

## Part 2 — Which sub-agents to consult (the routing decision)

### What the research says

**Finding 1 — "LLM agents already know when to call tools, even without reasoning."**
> Source: When2Tool (arXiv:2605.09252, 2026). The paper benchmarks frontier LLMs on the decision *whether* to call a tool, given the correct tool is available. Result: GPT-class models reach reasonable tool/no-tool accuracy without explicit chain-of-thought reasoning. *"Reasoning before decisions partially mitigates this problem... however, reasoning still carries a high accuracy cost per saved call on hard tasks."*

Implication: the LLM itself can be asked "should I consult X right now?" and the answer is good enough to act on, *without* needing a separate routing model.

**Finding 2 — Selective tool registration cuts cost 50% with minimal quality loss.**
> Source: EcoAct (arXiv:2411.01643, NeurIPS 2024-style). Selectively register tools as needed rather than passively offering all of them. *"Reduces computational costs by over 50% in multi-step reasoning tasks while maintaining performance."*

Implication: presenting all four sub-agents as available every round is the *wrong* default. Selectively offer them.

**Finding 3 — Cost-aware exploration via explicit priors.**
> Source: CTA / Calibrate-Then-Act (arXiv:2602.16699, NYU, Feb 2026). LLM agents over-explore (use too many tool calls) under standard prompting. CTA passes the LLM an *explicit prior* about the environment state, and explicit gain/cost tradeoffs. *"Making cost-benefit tradeoffs explicit with CTA can help agents discover more optimal decision-making strategies."*

Implication: the right architecture is *not* "tell the LLM to decide" but "tell the LLM the cost of each consultation, the expected information gain, and let it choose against that scoreboard."

**Finding 4 — Utility-guided orchestration as explicit decision.**
> Source: Liu, Zhao, Xu (arXiv:2603.19896, USTC, 2026). Proposes scoring actions (`respond`, `retrieve`, `tool_call`, `verify`, `stop`) by **estimated gain − step cost − uncertainty − redundancy**. *"At each step, the agent chooses among actions... by balancing estimated gain, step cost, uncertainty, and redundancy."*

Implication: the seller's per-round consultation decision is best framed as scoring each of the 4 sub-agents on four dimensions, then choosing the top-k by score with a stop-rule.

### Recommendation for LegentPro

A **routing function** `whichToConsult(state, round) → SubAgent[]` whose body is approximately:

```
For each candidate sub-agent C ∈ {Treasury, Inventory, Credit, Logistics}:
  gain(C)        = expected change in price decision if C is consulted
  cost(C)        = latency + token cost
  uncertainty(C) = "how stale is the previous answer from C?"
  redundancy(C)  = "how much does C's signal overlap with what we already know?"

  score(C) = w_g·gain(C) − w_c·cost(C) + w_u·uncertainty(C) − w_r·redundancy(C)

Consult C if score(C) > threshold OR C is mandatory this round (see §5).
```

Concrete instantiation for round 1 (initial pricing decision) vs round 3 (closing decision):

| Sub-agent | Round 1 (anchor) | Round 2 (mid) | Round 3 (closer) |
|---|---|---|---|
| Treasury | **Must consult** (sets floor) | Consult if last verdict was a tight pass | Consult if proposed price is near floor |
| Inventory | High value — affects opening anchor via patience | Low if inventory signal unchanged | High again — affects last-mile concession |
| Credit | Moderate — affects acceptable terms | Low | High if buyer asked for extended payment |
| Logistics | Low if no delivery-date pressure | Moderate | Low — too late to change shipping |

This is **non-trivial**: the agent makes 4 binary decisions per round, total 12 across a 3-round negotiation, each one defensible by the four-component score above. Each *not-consult* decision is auditable: "we skipped Inventory in round 2 because (a) signal unchanged from round 1 (low uncertainty), (b) redundant with Treasury's cash-urgency signal (high redundancy), (c) expected price impact < ₹1 (low gain)."

### Anti-pattern to avoid

The naïve "consult-everyone-every-round" approach. EcoAct's 50% cost finding plus the CTA over-exploration finding both predict that this degrades performance, not just efficiency — too many signals cause the LLM to over-converge or pattern-match irrelevantly.

---

## Part 3 — What question to ask each sub-agent (the query design)

### What the research says

**Finding 5 — Queries to specialist agents should be specific, not generic.**
> Source: Atlas (arXiv:2601.03872, 2026, RL-driven multi-step routing). Domain-specific queries to specialist tools dramatically outperform generic queries.

**Finding 6 — Per-step adaptive reasoning effort matters.**
> Source: Ares (arXiv:2603.07915, UCSB, 2026). A lightweight router predicts the *minimum* reasoning level needed per step. *"ARES reduces reasoning token usage by up to 52.7% compared to fixed high-effort reasoning, while introducing minimal degradation in task success rates."*

Implication: each consultation should be parameterized — both the question content *and* the reasoning depth.

**Finding 7 — Entropy is a good signal of question quality.**
> Source: Rethinking the Role of Entropy in Tool-Use (arXiv:2602.02050). *"High-quality tool calls help the model reduce uncertainty, as indicated by a decrease in entropy."*

Implication: post-hoc, you can score whether a consultation was *worth it* by measuring whether the seller's price-distribution narrowed after it.

### Recommendation for LegentPro

Each sub-agent has a **menu of questions** the seller can ask, not a single fixed query. The seller picks the most informative one given current state.

**Treasury — menu of questions:**

| Question | When to ask | Returns |
|---|---|---|
| `floorCheck(price)` | Always before final offer | `approved: bool, minViablePrice: number` |
| `cashUrgency()` | Round 1 anchor or when price drift is large | `urgency: 0..1, weeksOfRunway: number` |
| `whatIfTerms(termsOptions[])` | Round 3 if buyer pushes for extended terms | per-option `approved, minViablePrice` |
| `cashWindow(daysOut)` | When delivery date matters | `cashAvailableAt: number` |

**Inventory — menu:**

| Question | When | Returns |
|---|---|---|
| `urgency()` | Round 1 for anchor calibration | `urgency: 0..1, daysToHoldingCostSpike: number` |
| `whatIfQuantity(units)` | If buyer suggests larger order | `urgencyAtQty: 0..1` |
| `slotPressure(deliveryDate)` | If date is unusual | `pressure: 0..1` |

**Credit — menu:**

| Question | When | Returns |
|---|---|---|
| `counterpartyRisk()` | Round 1, only if no recent cached answer | `risk: 0..1, gleifStatus, paymentHistorySignal` |
| `recommendedTerms(price)` | Round 3 closing | `terms, riskAtTerms` |

**Logistics — menu:**

| Question | When | Returns |
|---|---|---|
| `canDeliverBy(date)` | Always before final offer | `canMeet: bool, alternateDate?` |
| `shippingCostPerUnit(qty)` | Round 1 anchor | `cost, leadDays` |
| `slack()` | Round 2 if flexibility is a tactic | `daysSlack: number` |

Today's code asks only `floorCheck(price)` of Treasury, and asks it *every* round. The proposal: **make the question selection part of the agent's decisions**.

---

## Part 4 — Weightage and synthesis (how answers combine)

### What the research says

**Finding 8 — Individual rationality + NBS + Pareto efficiency are the formal benchmark trio.**
> Source: Singh, Borkotokey, Kumar (arXiv:2603.29297, Mar 2026, Dibrugarh/Queen's-Belfast). *"Autonomous AI agents in negotiation systems must generate equitable utility allocations satisfying individual rationality (IR), ensuring each agent receives at least its outside option, and the Nash Bargaining Solution (NBS), which maximizes joint surplus."* The four Nash axioms — Pareto efficiency, symmetry, scale invariance, independence of irrelevant alternatives — *uniquely characterize* the NBS.

**Finding 9 — Three formal evaluation dimensions for bilateral trade.**
> Source: arXiv:2604.16472 "Training Language Models for Bilateral Trade with Private Information." Defines:
> 1. **Individual Rationality (IR)** — did each party receive at least their reservation utility?
> 2. **Strategic Effectiveness (surplus share)** — how much of the ZOPA did each party capture?
> 3. **Allocative Efficiency (deal rate)** — fraction of feasible deals actually consummated.

Each metric is automatically computable from the negotiation trace. **This is the formal yardstick** the design should use.

### Recommendation for LegentPro

The four sub-agent advisories combine into the seller's per-round decision in two distinct ways — direct constraints (hard) and patience modulation (soft).

#### Hard constraints (failure of any → cannot offer)

| Source | Constraint |
|---|---|
| Treasury | proposed price ≥ `minViablePrice` |
| Logistics | proposed price + delivery date is logistically feasible |
| Credit | counterparty status ≠ "REVOKED" or "LAPSED" |

Hard constraints are **not weighted** — they are veto bits. This matches the existing constraint envelope pattern.

#### Soft signals (patience modulator)

The patience formula from the earlier design proposal, refined with research grounding:

```
δ(round) = base × ∏ f_i(advisory_i)

where:
  f_treasury  (cashUrgency)      = 1 − α_T · cashUrgency           (α_T ≈ 0.30)
  f_inventory (inventoryUrgency) = 1 − α_I · inventoryUrgency      (α_I ≈ 0.25)
  f_credit    (creditRisk)       = 1 + α_C · creditRisk            (α_C ≈ 0.15)
  f_logistics (logisticsSlack)   = 1 + α_L · logisticsSlack        (α_L ≈ 0.20)
```

**Why these specific weightings?** They are **derived from the seller's utility structure**, not arbitrary:

- `α_T (cash)` is largest because cash flow directly threatens seller's solvency (continuation value). Lower patience.
- `α_I (inventory)` is second because holding cost compounds linearly with time. Lower patience.
- `α_L (logistics)` favors patience — slack means you can wait without missing the buyer's date.
- `α_C (credit)` favors patience inversely — risky counterparty means walking away preserves option value.

These α values are **the right things to tune** in the demo matrix (Part 8). They are *not* arbitrary because their *signs* are determined by economic reasoning. Only their *magnitudes* are tunable.

### How patience translates to action

| δ range | Concession behavior |
|---|---|
| δ > 0.85 | Move toward NBS in small steps; willing to walk |
| 0.65 ≤ δ ≤ 0.85 | Standard Rubinstein concession toward NBS |
| δ < 0.65 | Larger concession; close the deal |

The actual concession step is `(NBS − lastSellerOffer) × (1 − δ)`, clamped above the floor.

---

## Part 5 — Dependencies (what the consultation decisions depend on)

The routing function from §2 takes as input five things, all already in state:

| Dependency | Where it lives today |
|---|---|
| **Round number** | `state.round` |
| **Negotiation history** | `state.history[]` (all rounds' offers + concessions) |
| **Last advisory from each sub-agent** | (proposed `state.lastAdvisories: Record<source, advisory>`) — new |
| **Buyer's observed concession pattern** | computable from `state.history` — measures buyer's inferred patience |
| **Market context** | `state.marketContext` from `market-data-client.ts` |

The routing function is **deterministic** given these inputs. No LLM is involved in the *routing decision itself* — only in *executing each consultation* (the LLM asks the question; the sub-agent's LLM answers it).

This matches Ares and EcoAct architecture: a lightweight, non-LLM router decides what to call; the LLMs do the heavy reasoning inside the calls.

### Cache and staleness

Sub-agent advisories are cached per negotiation with a TTL keyed to round number:

| Advisory | TTL |
|---|---|
| Treasury floor | 1 round (revalidate every round at near-floor prices) |
| Inventory urgency | 2 rounds (slow-moving) |
| Credit | 3 rounds (very slow-moving; cache the whole negotiation) |
| Logistics | 2 rounds |

This implements the **redundancy** term in the routing score: if a fresh answer exists, asking again is redundant.

---

## Part 6 — The prompt structure

The current `llm-client.ts buildPrompt(context)` builds the seller's price-decision prompt. The new structure separates **the routing prompt** from **the price-decision prompt**.

### Prompt A — Routing (per round, before consultations)

This is a small, fast LLM call:

```
You are the seller agent at Jupiter Knitting Company, round {round} of {maxRounds}.

NEGOTIATION STATE
- Last buyer offer  : ₹{lastTheirOffer}
- Last seller offer : ₹{lastOwnOffer}
- Implied ZOPA     : [{seller_min}, {buyer_max_inferred}]
- Current NBS estimate : ₹{nbs}
- Estimated gap     : ₹{gap}

CACHED ADVISORIES (with age in rounds)
- Treasury (age {age_T} rounds) : ✓ approved, floor=₹{floor}, cashUrgency={cash_u}
- Inventory (age {age_I} rounds) : urgency={inv_u}, holdingCostPerDay=₹{hcd}
- Credit    (age {age_C} rounds) : risk={credit_r}, status={status}
- Logistics (age {age_L} rounds) : canMeet={can_meet}, slack={slack}

DECIDE: which sub-agents to consult this round, and what question to ask each.
Available menus per sub-agent: [list from §3]
Cost per consultation: ~3 seconds, ~500 tokens
Skip a sub-agent if its current cached advisory is sufficient.

Return JSON only:
{
  "consultations": [
    {"agent": "treasury", "question": "floorCheck", "args": {...}, "reason": "..."},
    {"agent": "inventory", "question": "urgency", "args": {}, "reason": "..."}
  ]
}
```

**Time budget**: 2 seconds. If LLM doesn't respond, fall back to a deterministic policy: round 1 = consult Treasury+Inventory; round 2 = consult Treasury if near floor; round 3 = consult Treasury+Logistics.

### Prompt B — Price decision (after consultations, same as today but extended)

This is the existing prompt with two additions:

```
{ existing prompt content }

NEGOTIATION TARGET (from game theory, this round):
- Patience-adjusted fair split estimate : ₹{nbs_adjusted}
- Your patience this round : {delta} ({delta_label})
- Their inferred patience  : {their_delta_inferred}
- Recommended concession this round : ₹{rec_concession}

ADVISORIES JUST RECEIVED THIS ROUND:
{ formatted typed JSON from each sub-agent consulted }

CONSTRAINTS (hard):
- Floor (treasury): ₹{floor}
- Logistics deliverable: {can_meet ? "yes" : "no"}
- Credit status: {status}

DECIDE: ACCEPT, COUNTER, or REJECT.
```

Time budget: 5 seconds (same as today).

---

## Part 7 — Time budgets and concurrency

| Operation | Budget today | Proposed |
|---|---|---|
| Treasury consultation (REST `POST /consult`) | 5 sec | 3 sec |
| LLM price decision | unbounded | 5 sec |
| LLM routing decision | n/a | 2 sec |
| Inventory / Credit / Logistics consultations | n/a | 3 sec each |

**Concurrency**: parallel `Promise.all` for all chosen sub-agent consultations, not sequential. This means a 3-sub-agent consultation costs ~3 seconds wall-clock, not 9.

**Per-round budget**: 2 (routing) + 3 (parallel consultations) + 5 (price decision) ≈ **10 seconds**. Three-round negotiation completes in ~30 seconds, the same wall-clock as today.

---

## Part 8 — The autonomy yardstick (perceived vs measured)

### What's been observed about levels of autonomy

The Knight Institute framework defines autonomy by the **user's role**, not by the agent's intelligence. But measuring autonomy as deployed requires looking at the agent's *actual behavior*. Three measurement approaches in the literature:

**Yardstick A — Knight's assisted evaluation (user-involvement counting).**
> Iteratively reduce user involvement until task success drops below threshold T. The minimum involvement needed = the autonomy level.

**Yardstick B — Edit-distance to reference human behavior (Pittman 2024).**
> *"A measure based on edit distance between observed sequences of agent actions and reference human behaviors provides a normalized, operational autonomy score."*

**Yardstick C — Static code inspection (Cihon et al. 2025, arXiv:2502.15212).**
> *"Alternative approaches use code-level inspection... to categorize the impact of agent actions, operational environment, human-in-the-loop controls, and observability features without running the agent."*

### Proposed yardstick for LegentPro — six observable axes

Combining the three approaches into a per-axis score the system can compute from a negotiation trace:

| Axis | What it measures | How to compute from trace |
|---|---|---|
| **A1. Workflow agency** | Did the agent decide the protocol, or follow a hardcoded one? | Count of branches the agent chose vs. hardcoded — today: 0/N (always offer→counter→counter) |
| **A2. Consultation discretion** | Did the agent choose which sub-agents to ask? | Count of non-default routing decisions in `consultations` log |
| **A3. Question discretion** | Did the agent choose what to ask each sub-agent? | Count of distinct questions asked across rounds vs. fixed query |
| **A4. Synthesis discretion** | Did the agent choose how to weight advisories? | Variance in patience δ across rounds — flat = no synthesis |
| **A5. Exit discretion** | Did the agent choose to walk away early or extend? | Counter-factual: did agent skip an accept the LLM-only would have taken? |
| **A6. Human-touch dimension** | How often was a human invoked? | Knight's L1-L5 baseline, integer count of human approvals |

A score of `[6/6, 5/6, ...]` across these axes gives a defensible per-run autonomy profile, separable into "perceived" (how it looks from outside) and "measured" (what the trace shows).

### Mapping LegentPro states to Knight levels via these axes

| System state | A1 | A2 | A3 | A4 | A5 | A6 | Net Knight level |
|---|---|---|---|---|---|---|---|
| Today (touchless but scripted) | 0 | 0 | 0 | 0 | 0 | 6 | **L2-L3** (high human-absence ≠ high autonomy) |
| + Patience formula (Component 3 from prior design) | 0 | 0 | 0 | 1 | 0 | 6 | L3 |
| + Adaptive consultation (this proposal) | 0 | 1 | 1 | 1 | 0 | 6 | L4 |
| + Early-exit discretion | 0 | 1 | 1 | 1 | 1 | 6 | L4+ |
| + Workflow agency (agent designs the protocol) | 1 | 1 | 1 | 1 | 1 | 6 | L5 |

**This is honest measurement.** Calling the current system L5 because no human touches it conflates one axis (A6) with five others where the score is zero. The proposal raises three of the axes (A2, A3, A4) — a real autonomy lift — to earn an L4 label.

---

## Part 9 — Mapping to "reasonable, realistic outcomes" for buyer and seller

### What counts as a good outcome — the research consensus

From the negotiation-analysis literature (Raiffa 1982, Lax & Sebenius 1986, Tuncel et al. 2016, the formal trio from 2603.29297 and 2604.16472):

| Outcome property | Plain-English definition | Computable from LegentPro trace? |
|---|---|---|
| **Individual Rationality (IR)** | Each party's final utility ≥ their walk-away utility (BATNA) | Yes: `final_price` vs each party's reservation |
| **Pareto Efficiency** | No alternative deal makes one party better off without making the other worse off | Yes: in single-issue price negotiation, every in-ZOPA deal is Pareto-efficient on price alone; multi-issue requires the issue space |
| **Surplus capture (strategic effectiveness)** | What fraction of the ZOPA did each party capture? | Yes: `(final − reservation) / (counterparty_reservation − own_reservation)` |
| **Allocative Efficiency (deal rate)** | Fraction of feasible deals that get done | Yes: count of `success` vs `escalation` runs |
| **NBS deviation** | Distance from the theoretical fair split | Yes: `final_price − nbs` |
| **Process satisfaction** | Did the parties feel the process was fair? | Not directly — but proxied by *consistency of concessions* and *fairness of NBS deviation* |
| **Impasse avoidance vs. agreement-trap risk** | Did the deal happen, *and* was it worth doing? | Yes via the Tuncel "agreement attraction" lens: did we accept something below NBS minus a threshold? |

### The two failure modes the research warns about

**Failure 1 — Over-convergence (agreement attraction trap)**
> Tuncel/Mislin/Kesebir/Pinkley 2016, Psychological Science: people accept poor deals to avoid no-deal anxiety. Kirshner et al. 2026 confirmed this pattern in LLM agents — *"LLM agents are more inclined toward reaching agreement, leading to greater supply chain efficiency but potentially greater inequality."*

For LegentPro: the seller might close at ₹350 (exactly the floor) when patient negotiation would have closed at ₹372 (closer to NBS ₹378). Both are individually rational; only one is reasonable.

**Failure 2 — Impasse from missing ZOPA**
> Yao et al. 2020, Negotiation and Conflict Management Research: when ZOPA doesn't exist, mental fatigue and integrative complexity become the determinants of outcome.

For LegentPro: if buyer's max = ₹340 and seller's floor = ₹355, there is no overlap. The current system simply escalates. A smarter system would attempt **non-price moves** — extended payment terms, larger quantity, faster shipping — that expand the issue space until a ZOPA emerges. This is a Phase 3 capability.

### Realistic outcome criteria for the LegentPro demo

A negotiation is "reasonable and realistic" if it satisfies:

```
1. IR        : final_price ≥ seller_floor AND final_price ≤ buyer_ceiling
2. Inside ZOPA when ZOPA exists
3. NBS deviation ≤ 10% of ZOPA width
4. Decision trace makes sense to a regulator (every accept/reject/counter has a recorded reason)
```

These are the four pass/fail bits the audit JSON would check. **Today's system only ensures #1.** Items 2-4 require the design proposed here.

### The buyer-side question

You asked about *both* buyer and seller goals. For Tommy (buyer), the symmetric formulation:

| Buyer's goal | How to measure |
|---|---|
| **IR** (price ≤ budget) | `final ≤ 400` |
| **Surplus capture** | `(buyer_ceiling − final) / ZOPA_width` |
| **Process** | Did the buyer get to express preferences (delivery, terms) or just price? |
| **Avoid the agreement trap** | Did buyer close at ₹399 just to close, when ₹385 was achievable? |

In today's code, the buyer has only price as a lever — no preferences over terms, no preferences over quantity. So buyer-side surplus capture is computable but limited to price.

### What a "reasonable result" looks like in the LegentPro demo

For the canonical Jupiter-Tommy scenario (ZOPA `[355, 400]`, NBS `377.5`, midpoint ₹377-378):

| Final price | Seller surplus | Buyer surplus | Verdict |
|---|---|---|---|
| ₹350 | 0% (at floor) | 100% | Bad for seller (agreement trap) |
| ₹360 | 11% | 89% | Very buyer-favorable |
| ₹372 | 38% | 62% | Reasonable, slightly buyer-favorable |
| ₹378 | 51% | 49% | Reasonable, near NBS |
| ₹385 | 67% | 33% | Reasonable, slightly seller-favorable |
| ₹395 | 89% | 11% | Very seller-favorable |
| ₹400 | 100% (at ceiling) | 0% | Bad for buyer (agreement trap) |
| no deal | n/a | n/a | Bad for both — impasse |

**A reasonable system should produce ₹372-385 most of the time, with some run-to-run variance, and rarely the extremes.** This is the empirical test of whether the design is working.

---

## Part 10 — Concrete recommendation

Three-phase build. Each phase is independently demoable.

### Phase A — Honest measurement (3 hours)

Build the **observability** without changing the negotiation logic yet:

1. Add the six-axis autonomy scoring to the audit JSON.
2. Add the four-property outcome quality scoring (IR, ZOPA, NBS deviation, audit-completeness).
3. Run the existing 100 fixtures in `escalations/` through the new scorers.

**What this produces:** a baseline distribution of today's system's performance. *Before* changing any logic, you'll know whether the current system already produces "reasonable" outcomes (and just lacks the labels) or actually performs poorly (validates the need for everything in Phase B/C).

### Phase B — Adaptive consultation (5 hours)

Build the routing function from §2 and the per-sub-agent question menus from §3:

1. `shared/consultation-router.ts` — implements the four-component scoring.
2. Each sub-agent gets a small dispatch table for its menu (Treasury already has all the questions implemented; just expose them as separate endpoints).
3. The seller's `consultAdvisors(state, round)` calls the router, not Treasury hardcoded.

**What this produces:** axes A2 and A3 lift from 0 to 1+. The audit shows *which* sub-agent was called for *what reason* per round.

### Phase C — Patience synthesis (3 hours)

Build the patience formula from §4 and the NBS-in-prompt extension:

1. `shared/patience.ts` — implements the δ formula.
2. `llm-client.ts buildPrompt()` — adds the NBS target block.
3. Audit records the per-round δ and the deviation.

**What this produces:** axis A4 lifts from 0 to 1+. Different runs at different α settings now produce visibly different concession trajectories.

### Total: ~11 hours, three independently shippable phases.

The original "9-hour" estimate from the earlier design was missing the routing complexity. This is the honest number.

---

## Part 11 — Open questions for review

1. **Routing-LLM vs. deterministic router.** Is the routing decision worth an LLM call (2 seconds), or should it be a hand-coded heuristic with a deterministic policy table? The Ares paper shows lightweight routers work; the When2Tool paper shows LLMs can decide adequately. The token-cost difference is ~$0.0001 per negotiation — negligible. Recommend the LLM router *unless* there's a deterministic-replay requirement for the audit, in which case the heuristic router with seedable randomness is correct.

2. **Sub-agent latency under network failure.** Today, treasury runs locally on port 7070; in production, Phase-2 sub-agents could be remote. The 3-second budget per consultation needs to hold under variable network latency. Recommend: timeout enforcement + cached-fallback (use stale advisory if fresh call times out, with the staleness recorded in audit).

3. **Buyer-side symmetry.** This entire design treats the seller as the consulting principal. The buyer has no sub-agents in DESIGN2. Should we add buyer-side sub-agents (Procurement, Finance, QA) in Phase 3? Or accept asymmetric autonomy? Asymmetry is honest — real Tommy CPO has access to procurement specialists; real Jupiter CSO has access to treasury/inventory/logistics. The two parties don't need to mirror each other's consultation graph.

4. **What α values to use.** The patience-formula weights need calibration. Recommend: start with `α_T=0.30, α_I=0.25, α_C=0.15, α_L=0.20`, run the demo matrix, and tune by minimizing NBS deviation while keeping the deal rate high.

5. **Where to draw the line between "router-decided" and "round-mandated" consultations.** Treasury floor check is always required before sending an offer (it's an invariant of the seller's solvency). Should it be exempt from the routing decision? Recommend: yes — routing decides among Inventory/Credit/Logistics; Treasury is always consulted but the *specific Treasury question* varies by round.

---

## Part 12 — Bibliography for this document

All sources retrieved via web search this session. Snippets read; full PDFs should be read before any academic submission.

**Autonomy frameworks:**
1. Feng, McDonald, Zhang. "Levels of Autonomy for AI Agents." Knight First Amendment Institute, July 2025. <https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1>
2. Cihon et al. "Measuring AI Agent Autonomy: Towards a scalable approach with code inspection." *arXiv:2502.15212*, 2025.
3. Pittman (2024). Edit-distance autonomy scoring — cited in EmergentMind 2025 survey of autonomy taxonomies.
4. The 2025 AI Agent Index. MIT, 2026. <https://aiagentindex.mit.edu/>

**Meta-reasoning and adaptive consultation:**
5. Ares: "Adaptive Reasoning Effort Selection for Efficient LLM Agents." *arXiv:2603.07915*, UCSB, 2026. <https://arxiv.org/pdf/2603.07915>
6. MAXS: "Meta-Adaptive Exploration with LLM Agents." *arXiv:2601.09259*, 2026. <https://arxiv.org/html/2601.09259>
7. EcoAct: "Economic Agent Determines When to Register What Action." *arXiv:2411.01643*, Microsoft Research, 2024. <https://arxiv.org/pdf/2411.01643>
8. CTA: "Calibrate-Then-Act: Cost-Aware Exploration in LLM Agents." *arXiv:2602.16699*, NYU, Feb 2026. <https://arxiv.org/pdf/2602.16699>
9. "Utility-Guided Agent Orchestration for Efficient LLM Tool Use." *arXiv:2603.19896*, USTC, 2026.
10. When2Tool: "LLM Agents Already Know When to Call Tools — Even Without Reasoning." *arXiv:2605.09252*, 2026.
11. "Alignment for Efficient Tool Calling of LLMs." *arXiv:2503.06708*, 2025.
12. Atlas: "Orchestrating Heterogeneous Models and Tools for Multi-Domain Complex Reasoning." *arXiv:2601.03872*, 2026.
13. "Rethinking the Role of Entropy in Optimizing Tool-Use Behaviors." *arXiv:2602.02050*, 2026.

**Value of Information for agent communication:**
14. Baarslag. "The Value of Information in Automated Negotiation: A Decision Model for Eliciting User Preferences." CWI.
15. "Value of Information: A Framework for Human-Agent Communication." *arXiv:2601.06407*, 2026.

**Bargaining theory + LLM negotiation outcome:**
16. Rubinstein, A. (1982). "Perfect Equilibrium in a Bargaining Model." *Econometrica* 50(1):97–109.
17. Nash, J. F. (1950). "The Bargaining Problem." *Econometrica* 18(2):155–162.
18. Singh, Borkotokey, Kumar. "Differentiable Normative Guidance for Nash Bargaining Solution Recovery." *arXiv:2603.29297*, Mar 2026. Defines IR + NBS + Pareto trio for AI negotiators.
19. "Training Language Models for Bilateral Trade with Private Information." *arXiv:2604.16472*, 2026. Defines three formal evaluation dimensions for bilateral trade.
20. Tuncel, Mislin, Kesebir, Pinkley (2016). "Agreement Attraction and Impasse Aversion: Reasons for Selecting a Poor Deal over No Deal at All." *Psychological Science* 27:312–321.
21. Yao et al. (2020). "When there is No ZOPA: Mental Fatigue, Integrative Complexity, and Creative Agreement in Negotiations." *Negotiation and Conflict Management Research*.
22. Tripp & Sondak (1992). "An evaluation of dependent variables in experimental negotiation studies: Impasse rates and Pareto efficiency." *Organizational Behavior and Human Decision Processes* 51:273–295.
23. Lax, D. A., & Sebenius, J. K. (1986). *The Manager as Negotiator*. Free Press.
24. Raiffa, H. (1982). *The Art and Science of Negotiation*. Harvard University Press.

**LLM negotiation experiments (already cited in prior research doc):**
25. Hua, W. et al. "Game-theoretic LLM: Agent Workflow for Negotiation Games." *arXiv:2411.05990*, Nov 2024.
26. Xia, T. et al. "Measuring Bargaining Abilities of LLMs." Findings of ACL 2024.
27. Kirshner, S. N. et al. "Talking terms: Agent information in LLM supply chain bargaining." *Decision Sciences* 57:9–23, 2026.
28. Zhu, K. et al. "Choose Your Agent: Tradeoffs in Adopting AI Advisors, Coaches, and Delegates in Multi-Party Negotiation." *arXiv:2602.12089*, 2026.
29. AgenticPay: Liu, Gu, Song. *arXiv:2602.06008*, 2026.

---

**End of consultation-autonomy-deep-dive.md**
