# Game-Theoretic Negotiation Design for LegentPro
## Grounded in 2024-2026 Agentic AI Research

> **Audience:** Project 1 (LegentPro) implementers in `DynDic3ent1/`
> **Date:** 2026-05-15
> **Status:** Research synthesis + design proposal. No code changed.
> **Grounding rule:** Every claim about an external paper here is anchored to a specific paper with full citation. Where I cite specific findings, I cite from snippets retrieved this session — claims at the level of headline result. Before academic submission, the source PDFs must be read in full; the snippets in this document are sufficient for design decisions but not for claims in a paper.

---

## 1. Why this design is needed

Project 1 already implements a 3-round alternating-offers negotiation between buyer, seller, and a treasury sub-agent. The structure is Rubinstein-shaped (alternating offers, finite horizon, monotonicity ratchet, BATNA-as-escalation) — but the system does not currently distinguish levels of agent autonomy, does not compute or target a theoretical equilibrium, and does not exercise the seller's sub-agent consultation pattern as a meaningful strategic choice.

DESIGN2 (existing) added abstractions for `NegotiationStrategy` (rules vs autonomous), `LLMProvider` (groq vs gemini), `CredentialProvider` (plain vs vlei), and `MessageSigner` (plain vs vlei).

**What this document adds:** a fifth axis — a concrete, **non-trivial but simple** game-theoretic negotiation design that exercises the autonomous and consulting-sub-agent capabilities meaningfully, grounded in the recent agentic-AI research literature.

---

## 2. Research synthesis

### 2.1 Levels of autonomy — the Knight Institute framework (Feng, McDonald, Zhang 2025)

**Source:** Kevin Feng, David McDonald, Amy Zhang. "Levels of Autonomy for AI Agents," *Knight First Amendment Institute*, July 28, 2025. <https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1>. Full paper read in this research session.

The Knight framework defines **five user-centered levels** of agent autonomy based on the role the *user* (which may be another agent) plays. Critically, the paper argues autonomy is a **design decision separable from capability**: a highly capable agent can run at L1, and a less capable agent can run at L5.

| Level | User role | Characteristic |
|---|---|---|
| **L1** — Operator | User is in charge at all times; agent assists on demand | The "copilot" pattern. Agent does not act without explicit invocation. |
| **L2** — Collaborator | User and agent plan, delegate, execute together | Close back-and-forth communication. Agent works on its own subtasks but the user can take control. |
| **L3** — Consultant | Agent drives planning and execution; user provides feedback at key checkpoints | User cannot directly take control; influence is via feedback messages. |
| **L4** — Approver | Agent runs autonomously; user is only summoned for blockers (credentials, consequential decisions) | "Rubber-stamping" risk. Most consequential agentic AI is here today. |
| **L5** — Observer | Agent fully autonomous; user can only monitor or hit emergency stop | No way to steer mid-execution. |

**Key derived idea:** Multi-agent systems work best with a **mix** of autonomy levels — pure-L5 systems have sparse communication and become un-debuggable; pure-L1 systems stall waiting for operators. The paper proposes **autonomy certificates** issued by a third-party governing body to communicate which level an agent is operating at, and recommends "*a mix of agents certified at different autonomy levels and/or many collaborative L2 agents working together*" for useful multi-agent systems.

### 2.2 LLMs as negotiators — what they actually do well and badly

Three converging findings across 2024–2026 research:

**Finding A — LLMs deviate from rational strategies as game complexity grows.**
**Source:** Wenyue Hua et al., "Game-theoretic LLM: Agent Workflow for Negotiation Games," *arXiv:2411.05990*, Nov 2024. <https://arxiv.org/abs/2411.05990>

> *"Our findings reveal that LLMs frequently deviate from rational strategies, particularly as the complexity of the game increases with larger payoff matrices or deeper sequential trees."*

The paper's intervention: **game-theoretic workflows that guide the LLM's reasoning** (pre-compute equilibria, structure the reasoning chain). With the workflow, "*LLMs exhibit marked improvements in identifying optimal strategies, achieving near-optimal allocations*." This validates DESIGN2's split between `RulesBasedStrategy` and `AutonomousStrategy`: pure LLM is unreliable; LLM + structured reasoning workflow + hard constraints is reliable.

**Finding B — LLMs are systematically worse as buyers than as sellers.**
**Source:** Tian Xia et al., "Measuring Bargaining Abilities of LLMs," *arXiv:2402.15813*, ACL 2024 Findings. <https://aclanthology.org/2024.findings-acl.213/>

> *"We find that playing a Buyer is much harder than a Seller, and increasing model size cannot effectively improve the Buyer's performance."*

Their fix — OG-Narrator — separates **a deterministic Offer Generator** (controls price range) from an **LLM Narrator** (writes natural-language justification): *"deal rates from 26.67% to 88.88% and brings a ten times multiplication of profits."*

This is a direct architectural recommendation for LegentPro: **the buyer agent benefits substantially from a deterministic offer-generation step under the LLM's natural-language reasoning.** Our existing buyer's hard `applyBuyerConstraints(...)` partially does this, but does not separate the offer generator from the narrator the way the paper does.

**Finding C — LLM agents in supply-chain bargaining exhibit human-like heuristics but are more agreement-seeking.**
**Source:** Samuel N. Kirshner et al., "Talking terms: Agent information in LLM supply chain bargaining," *Decision Sciences* 57:9–23, 2026. DOI: 10.1111/deci.70010.

> *"LLM agents use simple heuristics to make decisions and generally exhibit human-like negotiating behavior. Contrasting humans, LLM agents are more inclined toward reaching agreement, leading to greater supply chain efficiency but potentially greater inequality compared to human negotiators. Deceiving LLM agents into believing they have higher costs can improve outcomes for the supplier at the expense of retailers."*

Two relevant implications for LegentPro:
1. LLM agents over-converge — they want a deal more than a *good* deal. The constraint envelope must hold firm.
2. Cost information manipulation is a real attack — directly relevant to DESIGN2's `MessageSigner` and `CredentialProvider` (tampered cost claims must be detectable).

### 2.3 Multi-agent buyer-seller benchmark — AgenticPay (2026)

**Source:** Xianyang Liu, Shangding Gu, Dawn Song. "AgenticPay: A Multi-Agent LLM Negotiation System for Buyer–Seller Transactions," *arXiv:2602.06008*, Feb 2026. <https://arxiv.org/abs/2602.06008>. GitHub: <https://github.com/SafeRL-Lab/AgenticPay>

> *"AgenticPay models markets in which buyers and sellers possess **private constraints and product-dependent valuations**, and must reach agreements through multi-round linguistic negotiation rather than numeric bidding alone. The framework supports a diverse suite of over 110 tasks ranging from bilateral bargaining to many-to-many markets, with structured action extraction and metrics for feasibility, efficiency, and welfare."*

Reported headline: 15% increase in social welfare vs. fixed-price baselines; 92% payment-execution success in converging scenarios.

Key methodological idea: **private reservation values combined with public product attributes** — buyers and sellers have hidden floors/ceilings but argue over publicly observable attributes. This is exactly Jupiter Knitting Company ↔ Tommy Hilfiger Europe in LegentPro: private margin price ₹350 and private max budget ₹400, against publicly observable cotton index, SOFR rate, and delivery date.

### 2.4 Hierarchical multi-agent reasoning — leader/team patterns

**Source:** "How to Train a Leader: Hierarchical Reasoning in Multi-Agent LLMs," *arXiv:2507.08960*, 2025. <https://arxiv.org/pdf/2507.08960>

The leader-team pattern: one trained leader LLM **queries a team of off-the-shelf LLM agents** that provide candidate solutions, then **synthesizes** their outputs. The leader is the only trained component; the team members are fixed. *"Leaders trained with MLPO exhibit improved performance not only when interacting with the agent team at inference time, but also enjoy improved performance when deployed in single-agent settings without the team."*

This is precisely the pattern LegentPro's seller already implements with the treasury sub-agent — and the pattern DESIGN2 Phase 2 extends to four sub-agents (Treasury, Inventory, Credit, Logistics). The literature validates the architecture; what's missing in LegentPro is a **principled way to use** the sub-agent advisories during negotiation, not just before it.

### 2.5 The AI-advisor adoption gap — preference vs. performance

**Source:** Kehang Zhu et al., "Choose Your Agent: Tradeoffs in Adopting AI Advisors, Coaches, and Delegates in Multi-Party Negotiation," *arXiv:2602.12089*, Feb 2026. <https://arxiv.org/pdf/2602.12089>

A behavioral experiment with N=243 humans negotiating with three modalities — **Advisor** (proactive recommendations), **Coach** (reactive feedback), **Delegate** (autonomous action). Same underlying LLM, achieves superhuman performance in all-agent setting.

> *"Despite preferring the Advisor modality, participants achieve the highest mean individual gains with the Delegate, demonstrating a preference-performance misalignment."*

This is a direct empirical mapping onto Knight Institute L1/L2/L3 (Advisor/Coach) vs. L4/L5 (Delegate). The finding: **people want to drive but get better outcomes when they let the agent drive**. For a hackathon-grade demo, the design should let a judge or operator *see* this trade-off — pick a level, watch what happens, see how the outcome differs.

### 2.6 Rubinstein and Nash — the canonical anchors

The chats *DyDisc-Rules-Autonomous-CIT3-1* and *Long FIN Agents-Team-1* already established the academic grounding. To restate the citations briefly:

- **Rubinstein (1982)** — alternating-offers bargaining game with discount factors as the canonical bilateral-bargaining model.
- **Nash (1950)** — "The Bargaining Problem," *Econometrica*. Establishes the Nash Bargaining Solution.
- **Feng, Li & Tan (2023)** — *Behavioral Sciences* 13(2):124, DOI: 10.3390/bs13020124. Uses the Nash bargaining solution as the fairness reference inside the Rubinstein game.

---

## 3. The proposed game-theoretic design — non-trivial but simple

### 3.1 The core question this design answers

> Given LegentPro's existing infrastructure (alternating-offers protocol, monotonicity, treasury sub-agent, vLEI identity), what is the **simplest game-theoretic extension that meaningfully exercises agent autonomy** at different levels, demonstrates measurable performance differences across levels, and remains buildable in 1-2 days on top of DESIGN2 Phase 1?

### 3.2 The design — "ZOPA Discovery via Patience-Coupled Sub-Agent Consultation"

The design has **five components**, each grounded in a paper above. None of them is novel research — they are direct, well-known patterns combined for a specific purpose.

#### Component 1: Explicit autonomy levels mapped onto the existing agents

| Agent | Autonomy level | Justification |
|---|---|---|
| Buyer (Tommy) | **L3 Consultant** | A human CPO sees the buyer's plan and can change it at session start. After that, the buyer runs autonomously through the rounds. Matches Knight §3.3. |
| Seller (Jupiter) | **L4 Approver** | Jupiter CSO sees the agent's discount envelope. The agent runs autonomously through negotiation, only summoning the CSO on a blocker (e.g., treasury rejects + agent wants to override). Matches Knight §3.4. |
| Treasury sub-agent | **L2 Collaborator** | Returns typed JSON when asked, but **also signals back** when the seller's proposed price approaches the floor. Matches Knight §3.2 — close back-and-forth. |
| Inventory / Credit / Logistics sub-agents (Phase 2) | **L1 Operator** | Answer-on-demand. Do not act unless asked. Matches Knight §3.1. |

This is the **autonomy mix** Knight §4 explicitly recommends.

**What this enables in the demo:** a judge sees a printout like:

```
🧭 AUTONOMY POSTURE
   Buyer (Tommy)     : L3 — CONSULTANT  (CPO can override plan; no per-round intervention)
   Seller (Jupiter)  : L4 — APPROVER    (CSO summoned on blockers only)
   Treasury (Jupiter): L2 — COLLABORATOR (typed JSON + reverse signals)
```

**Code surface:** a single env var `BUYER_AUTONOMY=L3` and `SELLER_AUTONOMY=L4`, defaulted, used to gate two specific behaviors. **Tiny.**

#### Component 2: Explicit ZOPA + NBS computation (visible, not hidden)

The **Zone of Possible Agreement (ZOPA)** is the overlap between buyer's max budget and seller's minimum acceptable. Today these values live in code constants but the system never names them. The proposal:

At session start, the seller computes (privately) its `minimumAcceptable = marginPrice + minProfitMargin` = 355. The buyer computes (privately) its `maximumAcceptable = maxBudget` = 400. The ZOPA is `[355, 400]`. Neither agent knows the other's number — but **both agents announce that they have one**.

The **Nash Bargaining Solution under equal patience** for this ZOPA is the midpoint: `(355 + 400) / 2 = 377.5`.

The system computes this **post-negotiation**, after the deal closes, and writes to the audit:
- Final agreed price
- Theoretical NBS (computed from now-revealed reservation prices)
- Deviation: `final - NBS`
- Which side "won" the surplus

**Why this matters for the demo:** A judge sees not just "they reached ₹350," but "they reached ₹350 vs. theoretical fair split ₹377.50 — buyer captured 90% of the surplus, suggesting the seller conceded too aggressively." That is a *meaningful* analysis of the negotiation.

**Code surface:** post-deal computation, ~30 lines in `audit-writer.ts`. **Tiny.**

#### Component 3: Patience as a coupled sub-agent signal (the non-trivial part)

This is the design's novel-for-LegentPro piece. The seller's "patience" (Rubinstein δ) is **not** a config constant — it is **derived dynamically from sub-agent advisories**.

Each round, the seller asks the four sub-agents one question each (the existing pattern from DESIGN2 §4.7):

| Sub-agent | Asks | Returns (typed JSON) |
|---|---|---|
| Treasury | "How urgent is *closing* this deal for cash position?" | `cashUrgency: 0..1` |
| Inventory | "How urgent is moving this stock?" | `inventoryUrgency: 0..1` |
| Credit | "How risky is the counterparty if we accept lower price?" | `creditRisk: 0..1` |
| Logistics | "Do we have lead-time slack?" | `logisticsSlack: 0..1` |

The seller's **dynamic discount factor**:
```
δ_seller(round) = base_patience
                × (1 - cashUrgency)       // cash urgency lowers patience
                × (1 - inventoryUrgency)  // stock urgency lowers patience
                × (1 + creditRisk × 0.2)  // risky counterparty → more patient (don't rush a bad deal)
                × (1 + logisticsSlack)    // slack → more patient
```

A patient seller (δ close to 1) makes **smaller concessions per round** and is willing to walk away. An impatient seller (δ close to 0) **concedes faster and closes a deal sooner**. This is the standard Rubinstein interpretation.

The **buyer's δ** is computed symmetrically from its (currently-not-existing) sub-agents — Phase 3 work. For Phase 1, the buyer δ is a config constant (the demo varies it across runs).

**Why this is non-trivial:** the sub-agents are not just data sources — their advisories *change the seller's strategic posture mid-negotiation*. This is the **only place** in the LegentPro architecture where sub-agent consultation has a measurable effect on the negotiation trajectory beyond the existing pass/fail floor check.

**Why this is still simple:** the formula is four multiplications. The advisories are typed JSON. No new infrastructure beyond the four Phase-2 sub-agents already designed.

#### Component 4: NBS-anchored target price as the LLM prompt input

Today, the seller's LLM prompt includes `marginPrice`, `targetPrice`, and constraints. The proposal: add **one more line** — the **patience-adjusted NBS estimate**:

```
NEGOTIATION TARGET (from game theory, this round):
- Patience-adjusted fair split estimate : ₹378
- Your patience this round : 0.72 (moderate)
- Their inferred patience : 0.85 (high — they can wait)
- → Recommended concession this round : ₹4 toward their offer
```

The LLM is now reasoning **against an explicit equilibrium target**, not just against constraints. Hua et al. (2411.05990) showed this is exactly the kind of workflow that significantly improves LLM rationality in negotiation games.

**The buyer's δ is inferred** from observed concession patterns (how much they conceded last round vs. how much they could have). This is the bounded-rationality variant of the Rubinstein model.

**Code surface:** prompt extension in `llm-client.ts buildPrompt()` — about 10 lines.

#### Component 5: The "demonstration matrix" — what the judge actually sees

The demo runs the same scenario four times, varying the autonomy posture:

| Run | Buyer level | Seller level | Treasury level | Expected outcome (per Knight + AgenticPay) |
|---|---|---|---|---|
| A | L5 | L5 | L5 | Fast deal, possibly suboptimal (LLM over-converges per Kirshner) |
| B | L4 | L4 | L2 | Reasonable deal, sub-agent advisories used |
| C | L3 | L4 | L2 | Buyer plan reviewed by CPO before run; otherwise like B |
| D | L1 | L1 | L1 | Negotiation cannot proceed without human input every step |

After all four runs, an aggregate table:

```
RUN | FINAL  | NBS   | DEVIATION | ROUNDS | TIME    | HUMAN TOUCHES
A   | ₹362   | ₹378  | -₹16      | 2      | 28s     | 0
B   | ₹375   | ₹378  | -₹3       | 3      | 41s     | 0
C   | ₹372   | ₹378  | -₹6       | 3      | 45s     | 1 (plan review)
D   | ₹--    | ₹378  | n/a       | --     | manual  | 6+ (every step)
```

**This is the demo.** It directly demonstrates Knight §4's claim that *a mix of L2/L3/L4 agents produces useful systems while pure-L5 sacrifices quality and pure-L1 stalls*.

### 3.3 What this design demonstrates that the current system cannot

| Capability | Current | With this design |
|---|---|---|
| Distinguishes agent autonomy levels | No (all agents run uniformly) | Yes — per Knight Institute taxonomy |
| Names a theoretical equilibrium | No | Yes — Nash Bargaining Solution computed and audited |
| Uses sub-agent advisories during negotiation | No (only floor check) | Yes — they shape patience and thus concession rate |
| Demonstrates preference-performance trade-off | No | Yes — the 4-run matrix shows it |
| Detects over-convergence (Kirshner finding) | No | Yes — NBS deviation surfaces it |

### 3.4 What this design deliberately does NOT do (kept simple)

- **No mixed-strategy Nash equilibrium** — would require payoff-matrix construction the LLM cannot reliably compute (Hua et al.'s exact finding).
- **No incomplete-information Bayesian update** — would need belief tracking infrastructure not present.
- **No utility-function elicitation** — uses linear utility (price only) as the demo's simplification.
- **No multi-issue negotiation** — price-only. Multi-issue (price + delivery + quantity) is a clean Phase 3 extension.
- **No reinforcement learning** — patience comes from typed sub-agent advisories, not from learned policies.
- **No new LLM model** — uses the same Groq/Gemini stack DESIGN2 already wires.

### 3.5 Build effort (estimated, in DynDic3ent1)

| Component | New code | Modified code | Effort |
|---|---|---|---|
| 1. Autonomy-level env vars + startup banner | None | seller-agent, buyer-agent, treasury-agent startup blocks | 1 hour |
| 2. NBS computation + audit field | `shared/nbs.ts` (~50 lines) | `audit-writer.ts` | 2 hours |
| 3. Patience formula + dynamic δ | `shared/patience.ts` (~80 lines) | seller-agent `makeNegotiationDecision` | 3 hours |
| 4. Prompt extension with NBS target | None | `llm-client.ts buildPrompt()` | 1 hour |
| 5. Demo matrix harness | `scripts/run-demo-matrix.ts` (~120 lines) | None | 2 hours |
| **Total** | ~250 lines new | ~50 lines modified | **~9 hours** |

This slots between DESIGN2 Phase 1 (May 18 plain mode) and Phase 2 (Jun 1 four sub-agents). It can be demoed with just Treasury (Phase 1 state) and gracefully accepts more sub-agents (Phase 2) as they come online.

---

## 4. Why this is "non-trivial but simple"

**Non-trivial:**
- It maps directly onto the Knight Institute's published autonomy framework — judges who know the literature will recognize the framing.
- It instantiates Rubinstein/Nash with **real** sub-agent signals, not abstract δ parameters — this is the design contribution that distinguishes a thoughtful procurement system from a toy.
- It addresses three findings from the 2024-2026 literature: LLM rationality decay with complexity (Hua), LLM over-convergence (Kirshner), buyer-side weakness (Xia) — and offers a concrete architectural response to each.

**Simple:**
- No new infrastructure beyond what DESIGN2 already specifies.
- One scalar (δ) per agent per round, computed from typed JSON advisories that already need to exist for Phase 2.
- All math is single-line formulas — surplus = max - min, NBS = midpoint × patience weighting, δ = product of four normalized scalars.
- The "demo matrix" is just running the same scenario four times with different env vars.

---

## 5. Open questions for review

Per Operating Principle 5 (separate facts from assumptions), here are the items that need confirmation before implementation:

1. **Choice of `base_patience` value.** Suggested 0.85 as the seller's base. Needs sensitivity analysis. Currently a config constant.
2. **Whether the buyer's δ is exposed in the audit.** I suggest yes — gives the post-deal NBS computation its full inputs. But this leaks information that real-world buyers would not share. For the hackathon demo, yes; for a real deployment, the audit should mask this until after the deal closes.
3. **Whether the L3 buyer's "plan review" step is a real human interaction or a simulated one.** For the demo, the CLI can pause and prompt the operator. For automated testing, the plan is "pre-approved" automatically. Both modes should exist.
4. **NBS-as-prompt risk.** Telling the LLM "the fair price is ₹378" might cause it to converge there too aggressively, removing variance. The patience-adjusted version helps — different patiences → different NBS estimates per side → still divergent reasoning. Worth testing.
5. **Whether this design needs its own `DESIGN3` folder, or extends DESIGN2.** I suggest it's a sibling document to `design-2-detailed-design.md` in DESIGN2 — call it `design-2-game-theory.md`. The four-axis DESIGN2 architecture is preserved; this adds a fifth element (autonomy posture + game-theoretic target) that lives orthogonal to the four axes.

---

## 6. Bibliography (sources actually consulted in this research session)

All sources were retrieved via web search and reading abstracts/snippets. Full PDFs should be read before any formal academic submission.

1. **Feng, K., McDonald, D., Zhang, A.** (2025). "Levels of Autonomy for AI Agents." *Knight First Amendment Institute*, July 28, 2025. <https://knightcolumbia.org/content/levels-of-autonomy-for-ai-agents-1>. **Read in full this session.** The five-level framework (Operator → Collaborator → Consultant → Approver → Observer).

2. **Hua, W., Liu, O., Li, L., et al.** (2024). "Game-theoretic LLM: Agent Workflow for Negotiation Games." *arXiv:2411.05990*. <https://arxiv.org/abs/2411.05990>. Snippet read. LLMs deviate from rational play as complexity grows; game-theoretic workflows fix this.

3. **Xia, T., He, Z., Ren, T., et al.** (2024). "Measuring Bargaining Abilities of LLMs: A Benchmark and A Buyer-Enhancement Method." *Findings of ACL 2024*. <https://aclanthology.org/2024.findings-acl.213/>. Snippet read. LLMs perform poorly as buyers; OG-Narrator (deterministic offer + LLM narration) raises deal rate from 26.67% to 88.88%.

4. **Kirshner, S. N., Pan, Y., Wu, X., Gould, A.** (2026). "Talking terms: Agent information in LLM supply chain bargaining." *Decision Sciences* 57:9–23. DOI: 10.1111/deci.70010. Snippet read. LLM agents use simple heuristics, are more agreement-seeking than humans, and can be manipulated by deceiving cost information.

5. **Liu, X., Gu, S., Song, D.** (2026). "AgenticPay: A Multi-Agent LLM Negotiation System for Buyer–Seller Transactions." *arXiv:2602.06008*. <https://arxiv.org/abs/2602.06008>. Snippet read. Benchmark with 110+ tasks; private reservation values + multi-round linguistic negotiation; 15% welfare gain, 92% execution success.

6. **Zhu, K., Thain, N., Tsai, V., Wexler, J., Qian, C.** (2026). "Choose Your Agent: Tradeoffs in Adopting AI Advisors, Coaches, and Delegates in Multi-Party Negotiation." *arXiv:2602.12089*. <https://arxiv.org/pdf/2602.12089>. Snippet read. N=243 humans; preference-performance misalignment — humans prefer Advisor, perform best with Delegate.

7. **"How to Train a Leader: Hierarchical Reasoning in Multi-Agent LLMs"** (2025). *arXiv:2507.08960*. <https://arxiv.org/pdf/2507.08960>. Snippet read. Leader-team pattern: one trained leader + team of off-the-shelf LLMs; MLPO training procedure.

8. **Bhattacharya, A., Svedas, G., Lyskov, A., Strasser, M., Barberis Canonico, L.** (2025). "Evaluating Negotiation Capabilities of Large Language Models: From Ultimatum Games to Nash Bargaining." *Journal article*, sagepub. Snippet read. Model-by-model behavior: Llama-3 most effective, Claude-3 aggressive, GPT-4 fairest.

9. **Feng, S., Li, X., Tan, P.** (2023). "Alternating-Offers Bargaining with Nash Bargaining Fairness Concerns." *Behavioral Sciences* 13(2):124. DOI: 10.3390/bs13020124. **Citation only**, not read in this session.

10. **Rubinstein, A.** (1982). "Perfect Equilibrium in a Bargaining Model." *Econometrica* 50(1):97–109. **Citation only**, the canonical alternating-offers reference.

11. **Nash, J. F.** (1950). "The Bargaining Problem." *Econometrica* 18(2):155–162. **Citation only**, the canonical NBS reference.

12. **The 2025 AI Agent Index** (MIT, 2026). <https://aiagentindex.mit.edu/>. Snippet read. Annotates 30 agentic systems across 6 categories; enterprise agents typically move from L1-L2 in design to L3-L5 in deployment.

13. **Almutairi, M., Kim, H.** (2025). "Resilient Multi-Agent Negotiation for Medical Supply Chains: Integrating LLMs and Blockchain for Transparent Coordination." *arXiv:2507.17134*. Snippet read. Adjacent work on multi-agent negotiation + blockchain (analogous to vLEI).

---

## 7. Recommendation summary

**Do this:** add the five-component "ZOPA Discovery via Patience-Coupled Sub-Agent Consultation" design as `entAgentProject11/DESIGN/DESIGN2/design-2-game-theory.md`. ~9 hours of build work in `DynDic3ent1/`, slotted between Phase 1 (May 18) and Phase 2 (Jun 1).

**Don't do this:** the more ambitious things — Bayesian belief tracking, multi-issue negotiation, RL-trained policies, mixed-strategy NE — until after a working demo of the simple version exists. The literature explicitly says LLMs degrade as complexity rises; the design's value is *demonstrating agent autonomy via a transparent equilibrium*, not in optimizing the negotiation outcome.

**The 30-second pitch the demo enables:**

> "We don't just have buyer-and-seller LLMs talking to each other. We have a Level-4 seller running with a team of Level-2 sub-agents whose advisories shape its patience — its Rubinstein discount factor — in real time. The system measures the deal against the Nash Bargaining Solution and shows you, in the audit, exactly how the autonomy posture changed the outcome. That's not a chat demo. That's a structured economic transaction with named accountability and a theoretical baseline."

This positions LegentPro against the AgenticPay benchmark, the Knight Institute autonomy framework, and the Hua et al. workflow paper — three of the most cited 2024-2026 works on agentic AI negotiation — without requiring novel research.

---

**End of game-theory-research-and-design.md**
