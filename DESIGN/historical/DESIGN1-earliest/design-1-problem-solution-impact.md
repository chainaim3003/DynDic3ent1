# Project 1 — LegentPro: Accountable Enterprise Agentic Procurement
## design-1: Refined Problem Statement, Solution, Impact

> **Source:** Extracted from chat "Long FIN Agents-Team-1"
> (https://claude.ai/chat/a0d16ca6-e71f-4eb7-84b5-5eee99c81124)
> **Hackathon:** Transforming Enterprise Through AI · Tracks 2 (Gemini) + 1 (Veea/Security)
> **Center of gravity:** multi-agent orchestration + cryptographic accountability
> **Date extracted:** 2026-05-15
> **Grounding key:** ✅ = verified from code/docs read in source session · ⚠️ = from README/earlier reads · ◻️ = design proposal, not yet built

---

## 1. The unifying thesis (applies to Projects 1, 2, 3 — but Project 1's center of gravity is item #3)

All three project routes attack the **same four enterprise-agentic-AI problems** the hackathon cares about:

| Enterprise Agentic AI problem | What it means in practice |
|---|---|
| **Public + private data fusion** | Agents must reason over open standards/registries *and* proprietary company data, without leaking between them |
| **Long-running tasks** | Multi-step workflows that can't fit one LLM call, need checkpointing, can fail and resume |
| **Reasoning interweave** | Multiple specialist agents/models consulted and synthesized before an action commits |
| **Long-term memory** | State that survives across sessions — what was decided, what worked, what was attested |

**Project 1's center of gravity = orchestration & trust.** It hits all four problems, but the differentiator is cryptographic accountability for autonomous multi-agent action.

---

## 2. Refined Problem Statement

Enterprises want to deploy AI agents that *act* — negotiate deals, issue invoices, commit funds — not just chat. But an autonomous agent that can commit a company to a contract is also a **liability surface**:

- Who authorized it?
- Did it stay within its mandate?
- Can a regulator audit what it did?
- If it makes a bad decision, who is accountable?

Today's agent frameworks have **no cryptographic answer**. The liability literature (NeurIPS 2024, Interface EU 2025 — recorded in `DESIGN_CITATIONS.md`) confirms: as autonomy rises, **liability shifts to whoever provided the capability**, so **verifiable delegation becomes mandatory, not optional**.

The framing is engineering, not aspirational: **the problem is not that agents can't negotiate — it's that nobody can prove who authorized them to.** A CISO, General Counsel, or CFO who is asked to put AI agents in front of real commercial decisions has no defensible answer today. That's the gap LegentPro closes.

### Why now (the 2026 forcing function)
- **NeurIPS 2024 / Interface EU 2025** call for "autonomy certificates" — verifiable delegation chains for AI agents acting on behalf of legal entities.
- **EU AI Act Articles 14, 26, 27** (general knowledge — specific article numbers should be verified against the OJ text before legal reliance) impose human-oversight and traceability obligations on high-risk AI systems used by deployers.
- **GLEIF vLEI** is the only production-grade, regulated identity standard that provides cryptographically verifiable role delegation from a named officer at a real legal entity down to an AI agent.

---

## 3. Refined Solution

A **buyer-seller-treasury agent system** where:

1. **Each agent runs a hybrid decision engine** — ✅ LLM strategy (Gemini Pro) + deterministic constraint envelope + rule-based fallback (verified in `seller-agent/index.ts`).
2. **Every agent's authority is rooted in a GLEIF/vLEI cryptographic delegation chain** — ✅ live KERI server, IPEX credential issuance verified.
3. **Negotiation reasoning is powered by Gemini Pro** — multi-round alternating-offers, 3-round protocol.
4. ◻️ **Extended with three new consulting agents** (Inventory, Credit, Logistics) so the seller consults finance, ops, and risk *before* committing a discount — based on **real GS1 open standards** (Inventory Report 3.2, DESADV/ASN 3.4) so the mock data follows real enterprise message schemas.

### The 5-layer cryptographic delegation chain (read directly from agent cards)

```
GLEIF Root
    ↓
Qualified vLEI Issuer (QVI) — CHAINAIM-QVI-ANCHORED
    ↓
Legal Entity AID (Tommy: 54930012QJWZMYHNJW95 | Jupiter: 3358004DXAMRWRUIYJ05)
    ↓
OOR Holder AID (named officer — CPO, CSO, CFO)
    ↓
Agent AID (the autonomous AI agent)
    ↓
Sub-Agent AID (scope-bounded, non-redelegable — e.g., scope="treasury_operations", canDelegate=false)
```

Every autonomous action returned by LegentPro can be traced through this chain back to a named human officer at a real GLEIF-registered legal entity.

### What's live today (the moat)

| Asset | Status | Where |
|---|---|---|
| LegentPro MCP gateway with 13 tools | **✅ Live, public URL** | Railway: `nandadyndisc-production.up.railway.app/sse` |
| Tommy buyer / Jupiter seller / Treasury A2A agents | **✅ Live on AWS** | EC2 ports :8080, :9090, :7070 |
| vLEI / KERI cryptographic verification | **✅ Live on AWS** | EC2 :4000 |
| ACTUS PAM cash-flow simulator | **✅ Live** | 34.203.247.32:8083 |
| Real GLEIF Global LEI Index integration | ✅ Working | api.gleif.org |
| Real FRED + Yahoo Finance market data | ✅ Working | Public APIs |

**No other hackathon team will show up with a live AWS + Railway deployment, GLEIF-verified identity, real ACTUS simulation, and a working A2A negotiation.** That's the moat.

### What the extension adds (the hackathon delta)

1. **Idea #16 (NEW): Gemini-powered real A2A negotiation** — replace the rule-based `negotiate_price` MCP tool with Gemini Pro reasoning across the three live agents. **This is the Track 2 win condition.**
2. **Three new consulting agents** that the seller consults before committing a discount:
   - **Inventory Agent** — GS1 Inventory Report (real schema, mock data) — stock on hand, holding cost, slot pressure
   - **Credit/Risk Agent** — GLEIF (real) + FRED macro (real) + payment history (mock) — counterparty risk score
   - **Logistics Agent** — GS1 DESADV/ASN (real schema, mock data) — can-meet-deadline, shipping cost, lead time
3. **Typed JSON returns from every sub-agent** — closes NEST-3 attack vector A9 (tool-result injection from sub-agents).

---

## 4. Impact

### 4.1 The audience that buys this

Named roles — present at AI & Big Data Expo's audience:

| Audience | Pain | What LegentPro gives them |
|---|---|---|
| **Procurement officers at large enterprises (CPO)** | "My team uses AI tools to draft POs. I have no audit trail showing the AI was authorized to commit my company. Audit, compliance, and SOX teams will block this." | Every AI-driven procurement action carries a cryptographic chain back to a named officer. Audit defensible. |
| **Compliance & risk officers (CISO / Head of AI Governance / GC)** | "Autonomous agents are entering payment, contract, and supplier workflows. I cannot prove which human authorized each agent decision. My regulators will start asking soon." | Officer-binding via OOR vLEI. Every machine action is traceable to a named, accountable human. |
| **CFOs / treasury teams** | "I need autonomous agents to clear small commercial decisions without escalating each one — but I can't let them commit cash without a hard ceiling." | Scope-bounded sub-delegation. The treasury sub-agent demonstrates exactly this — it can simulate and approve, but cannot redelegate or exceed scope. |

Tommy Hilfiger Europe and Jupiter Knitting are the **demo characters**. The buyers are the **CISOs, CFOs, GCs, and CPOs** at companies that want autonomous agents in regulated workflows.

### 4.2 Enterprise theme fit — "pilot-to-production made literal"

The hackathon theme is "Transforming Enterprise Through AI." LegentPro's story is concrete: **the system is already live on AWS + Railway today, with real GLEIF, real ACTUS, real FRED, real cotton prices.** The hackathon submission is not "build this from scratch" — it is **swap one component (Gemini reasoning) on an already-deployed production system**.

### 4.3 The 2×2 adoption story (lets a buyer adopt incrementally)

```
                              ┌──────────────────────────────────────┐
                              │  CREDENTIAL FORMAT (orthogonal axis) │
                              │                                       │
                              │       Plain-JSON          vLEI        │
              ┌───────────────┼───────────────────────────────────────┤
              │  Rules-based  │  Reproducible CI baseline             │
              │  (NOW)        │       │       Conservative,           │
              │               │       ▼       verifiable              │
  STRATEGY    │───────────────┼───────────────────────────────────────┤
   AXIS A     │  Autonomous   │   Fast demo,        │                 │
              │  (TO-BE)      │   no infra dep      ▼  THE PRODUCT    │
              │  (Gemini)     │                        VISION         │
              └───────────────┴───────────────────────────────────────┘
```

Any combination is valid:
- `(Rules + PlainJson)` → reproducible CI baseline
- `(Rules + VLEI)` → conservative, verifiable
- `(Autonomous + PlainJson)` → fast demo, no infra dependency
- `(Autonomous + VLEI)` → the full product vision

A buyer can start at one corner and migrate. **That's a real enterprise adoption story, not a "rip and replace" pitch.**

### 4.4 Market sizing (for context, not the core pitch)

**Note:** these are 2026 SaaS-style projections from broader sessions on agentic enterprise procurement; treat as directional, not authoritative.

- **TAM** (B2B procurement automation across large enterprises globally): ~$8.5T procurement spend addressable; 50,000 enterprises × ~$170M avg procurement spend
- **SAM** (Fortune 500 + EU-equivalent enterprises adopting autonomous agents in regulated workflows): early-adopter ~$425B over 10 years at 5% penetration
- **SOM** for a Year-3 SaaS GTM: conservative $25–50M ARR if priced as a control-plane subscription + per-verification fee

**The defensible economic claim (per Rule 3):** the dollar number that matters is *not* the platform fee — it is the **share of automation that becomes possible** because the auditability gap is closed. If a CFO can move 100 small commercial decisions per week to autonomous mode (vs. all going through escalation), the operational savings at a single Fortune 500 dwarf any platform fee.

### 4.5 Track fit

| Track | Why it fits |
|---|---|
| **Track 2 (Gemini)** | Gemini Pro is the negotiation reasoning engine; Gemini Flash powers the 3 consulting sub-agents. Multi-model orchestration is the Track 2 win condition. |
| **Track 1 (Veea/Security)** | The vLEI/KERI/ACDC cryptographic chain *is* the security story. Card-clone defense, AID substitution defense, scope-abuse defense (all 16 attack vectors enumerated in `NEST-3-PART-1.5-MESSAGE-SIGNING.md`). |
| **Track 4 (Data & Intelligence)** | Public+private data fusion: GLEIF (public registry) + GS1 (open standard) ⊕ balance sheet/inventory/payment history (private). Real data fused with private. |

---

## 5. Honest gaps (per Rule 3 — flagged explicitly)

1. **Tool 1 `negotiate_price` is local rules today, not Gemini-driven A2A delegation.** Phase 2 rewrites it to call AWS buyer/seller agents directly with Gemini Pro reasoning.
2. **The three new consulting agents are designed, not built.** Estimated half-day per agent against GS1 schemas. (Treasury — existing, ACTUS-wired — is the working reference.)
3. **GS1 US APIs require licensing for the real registry data.** The hackathon submission uses mock data against the *real GS1 message schemas* — the schema is an open standard you can follow freely; the live GS1 data service is a paid product. This is honest framing for the pitch.
4. **GLEIF is genuinely free and open** — that part of the Credit Agent is real, not mocked. Already working.
5. **Merge conflicts in 2 agent files** (resolvable, ~1hr) need to clear before Gemini swap commits.

These are connector details, not architecture risks. The core story stands.

---

**End of design-1-problem-solution-impact.md**
