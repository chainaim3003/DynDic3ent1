# Project 1 — LegentPro: Accountable Enterprise Agentic Procurement
## design-2: Conceptual Design + Textual Visual Diagram

> **Source:** Extracted from chat "Long FIN Agents-Team-1"
> (https://claude.ai/chat/a0d16ca6-e71f-4eb7-84b5-5eee99c81124)
> **Date extracted:** 2026-05-15

---

## 1. The system at a glance

LegentPro is a **procurement-workflow service for AI agents**: every step (negotiate, simulate cash flow, settle) returns a cryptographic proof of which named officer at which GLEIF-registered company authorized it. The agent does the work; LegentPro makes the work auditable.

Three layers:

| Layer | What it is | Status |
|---|---|---|
| **L1 — MCP Gateway** (LegentPro) | 13 MCP tools, the surface OpenClaw/Claude/Gemini drive | ✅ Live on Railway |
| **L2 — A2A Agents** | Buyer, Seller, Treasury, + 3 new consulting agents | ✅ Buyer/Seller/Treasury live on AWS; ◻️ 3 new agents designed |
| **L3 — Identity Infrastructure** | vLEI/KERI/ACDC, IPEX issuance, GLEIF registry lookup | ✅ Live on AWS |

---

## 2. Top-level conceptual architecture (the bow-tie / star pattern)

```
                Buyer Agent (Gemini Pro) ◄──vLEI mutual verify──► Seller Agent (Gemini Pro)
                Tommy Hilfiger Europe                              Jupiter Knitting Company
                LEI 54930012QJWZMYHNJW95                           LEI 3358004DXAMRWRUIYJ05
                                                                            │
                                                                            │ "Should I offer
                                                                            │ a discount? How much?"
                                                                            │ Fans out to 4 sub-agents:
                                              ┌─────────────────────────────┼───────────────────┐
                                              ▼              ▼              ▼                   ▼
                                        ┌──────────┐  ┌──────────┐  ┌──────────────┐  ┌──────────────┐
                                        │ Treasury │  │Inventory │  │ Credit/Risk  │  │  Logistics   │
                                        │ (:7070)  │  │   (NEW)  │  │    (NEW)     │  │    (NEW)     │
                                        │          │  │          │  │              │  │              │
                                        │Gemini Pro│  │Gemini    │  │ Gemini Flash │  │ Gemini Flash │
                                        │          │  │  Flash   │  │              │  │              │
                                        │ ACTUS ✅ │  │GS1 Inv.  │  │ GLEIF✅+FRED✅│  │ GS1 DESADV◻️│
                                        │ NPV,     │  │Rpt◻️     │  │ + payment    │  │ ASN,         │
                                        │ cash     │  │stock,    │  │ history risk │  │ ship cost,   │
                                        │ schedule,│  │spoilage  │  │              │  │ lead time,   │
                                        │ min      │  │urgency   │  │              │  │ capacity     │
                                        │ viable   │  │          │  │              │  │              │
                                        │ price    │  │          │  │              │  │              │
                                        └──────────┘  └──────────┘  └──────────────┘  └──────────────┘
                                              │              │              │                   │
                                              └──────────────┴──────┬───────┴───────────────────┘
                                                                    │  typed JSON only
                                                                    │  (closes NEST-3 A9
                                                                    │   attack vector)
                                                                    ▼
                                              ┌────────────────────────────────────────┐
                                              │ Seller Agent (Gemini Pro) synthesizes 4│
                                              │ advisory signals into ONE              │
                                              │ DISCOUNT ENVELOPE:                     │
                                              │   { floorPrice,                        │
                                              │     targetPrice,                       │
                                              │     maxDiscount%,                      │
                                              │     urgencyScore }                     │
                                              └─────────────────┬──────────────────────┘
                                                                ▼
                                              Negotiation: alternating-offers, 3-round
                                                                ▼
                                              CredentialProvider.attest()
                                              → plain-JSON OR vLEI ACDC
                                                                ▼
                                              NegotiationAudit persisted
                                              (long-term memory ✅)

  Legend:
  ✅ = verified live in source-chat session
  ◻️ = designed, not yet built (mock data on real GS1 schema)
  Single-line arrows ───►  = synchronous request/response
  Double-line arrows ═══►  = cryptographically signed envelope
```

### Why this shape?

- **Public + private data fusion:** GS1 standards + GLEIF registry (PUBLIC) ⊕ balance sheet, inventory, payment history (PRIVATE). The seller's discount decision fuses both without leakage — each consulting agent enforces its own scope.
- **Long-running:** multi-round negotiation + multi-agent consultation, checkpointable via shared-memory store.
- **Reasoning interweave:** **4 specialist agents synthesized by Gemini Pro before any offer commits.**
- **Long-term memory:** ✅ `NegotiationAudit` JSON + IPEX credential records persist every deal.

---

## 3. The cryptographic delegation chain (zoomed in)

```
        ┌──────────────────────┐
        │   GLEIF Root         │  (regulated identity standard, real-world)
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐
        │  Qualified vLEI      │  (CHAINAIM-QVI-ANCHORED in demo)
        │  Issuer (QVI)        │
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────────────────────┐
        │  Legal Entity AID                    │
        │  e.g., Tommy: 54930012QJWZMYHNJW95   │  ← real LEIs verified at api.gleif.org
        │       Jupiter: 3358004DXAMRWRUIYJ05  │
        └──────────┬───────────────────────────┘
                   ▼
        ┌──────────────────────┐
        │  OOR Holder AID      │  ← named officer (CPO, CSO, CFO)
        │  (Official           │
        │   Organizational     │
        │   Role)              │
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────┐
        │  Agent AID           │  ← the autonomous AI agent
        │  (e.g.,              │
        │   jupiterSellerAgent)│
        └──────────┬───────────┘
                   ▼
        ┌──────────────────────────────────────┐
        │  Sub-Agent AID                       │  ← scope-bounded, non-redelegable
        │  scope = "treasury_operations"       │
        │  canDelegate = false                 │
        │  (e.g., Jupiter Treasury Agent)      │
        └──────────────────────────────────────┘
```

**Every autonomous action returned by LegentPro is anchored in this chain.** A regulator, an auditor, or a CISO can resolve from any agent action back to a named human officer at a real GLEIF-registered legal entity.

---

## 4. The end-to-end deal flow (what OpenClaw / Claude / Gemini drives)

```
   Stock LLM (the judge's Gemini/Claude/GPT)
        │
        │ MCP/SSE over HTTPS
        ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  RAILWAY: legentpro-mcp service                                 │
   │  ─────────────────────────────────────────────────────────────  │
   │  13 MCP tools, e.g.:                                            │
   │    1.  gleif_lookup_lei (Tommy)         → real GLEIF API        │
   │    2.  gleif_lookup_lei (Jupiter)       → real GLEIF API        │
   │    3.  get_buyer_agent_card             → real AWS              │
   │    4.  get_seller_agent_card            → real AWS              │
   │    5.  verify_vlei_delegation_chain     → real KERI :4000       │
   │    6.  get_market_data (SOFR/cotton/FX) → real FRED + Yahoo     │
   │    7.  negotiate_price                  → Gemini Pro (Phase 2)  │
   │    8.  treasury_approve (ACTUS)         → real ACTUS PAM        │
   │    9.  calculate_dynamic_discount       → ACTUS-backed math     │
   │   10.  submit_settlement                → real ACTUS            │
   │   11.  audit_narrative                  → Gemini Pro            │
   │   12.  start_negotiation (Phase 2)      → AWS A2A               │
   │   13.  get_negotiation_status (Phase 2) → AWS A2A               │
   └────────┬────────────────────────────────────────────────────────┘
            │
            │ HTTP / JSON-RPC over public internet
            ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  AWS EC2 (54.84.215.140)                                        │
   │  ─────────────────────────────────────────────────────────────  │
   │  Port 9090 → Tommy Buyer Agent     (A2A SDK)                    │
   │  Port 8080 → Jupiter Seller Agent  (A2A SDK)                    │
   │  Port 7070 → Jupiter Treasury Agent (REST)                      │
   │  Port 4000 → vLEI Verification Server                           │
   │                                                                  │
   │  ◻️ NEW (Phase 2):                                              │
   │  Port 7071 → Jupiter Inventory Agent  (REST)                    │
   │  Port 7072 → Jupiter Credit Agent     (REST)                    │
   │  Port 7073 → Jupiter Logistics Agent  (REST)                    │
   │                                                                  │
   │  Buyer ↔ Seller talk on localhost inside this box               │
   │  Seller fans out to sub-agents on localhost                     │
   └─────────────────────────────────────────────────────────────────┘

   The end-to-end story (9 tool calls, 7+ hit real backends):

   1. Verify Tommy in GLEIF  ── confirms ACTIVE
   2. Verify Jupiter in GLEIF ── confirms ACTIVE
   3. Get Tommy buyer agent card ── shows KERI chain back to CPO
   4. Verify Tommy delegation cryptographically through vLEI
   5. Get current SOFR / cotton / USD-INR (real FRED + Yahoo)
   6. Jupiter Treasury sub-agent runs ACTUS PAM simulation
      ── approves, returns NPV + min-viable price + cash schedule
   7. Generate dynamic discount offer
   8. Submit settlement to ACTUS
   9. Produce audit narrative explaining how every autonomous
      action traces back to a named human officer
```

---

## 5. The four enterprise-agentic problems, mapped to this architecture

| Problem | Where it shows up |
|---|---|
| **Public+private data fusion** | GS1 (public) + GLEIF (public) ⊕ balance sheet (private) + inventory (private) + payment history (private). Each consulting agent enforces a scope boundary so private data does not leak across boundaries. |
| **Long-running tasks** | 3-round negotiation + 4-way sub-agent consultation. Checkpointed in shared-memory store; resumable via `negotiationId`. ACTUS simulation is multi-step. |
| **Reasoning interweave** | Seller Agent (Gemini Pro) consults 4 sub-agents (Treasury Pro, Inventory Flash, Credit Flash, Logistics Flash). Synthesizes typed-JSON advisories into a single discount envelope before any offer commits. |
| **Long-term memory** | `NegotiationAudit` JSON written every round. IPEX credential records persist every closed deal. Both survive across sessions and can be replayed for regulator review. |

---

## 6. What changes vs. the live system (the hackathon delta)

| What's live ✅ | What changes ◻️ |
|---|---|
| Rule-based `negotiate_price` MCP tool | Replaced by Gemini Pro reasoning on AWS A2A agents |
| Single Treasury consultation (1 sub-agent) | Fan-out to 4 consulting sub-agents (add Inventory, Credit, Logistics) |
| Plain-JSON credential attestation | Add vLEI ACDC credential attestation as parallel option |
| Demo Tommy + Jupiter only | Generalize to any LEI-registered counterparty (Phase 3) |

Two new MCP tools (`start_negotiation`, `get_negotiation_status`) wrap the AWS A2A negotiation lifecycle so OpenClaw can trigger and poll without holding the SSE connection open.

---

**End of design-2-conceptual-design.md**
