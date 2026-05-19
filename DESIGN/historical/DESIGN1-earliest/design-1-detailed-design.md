# Project 1 — LegentPro: Accountable Enterprise Agentic Procurement
## design-3: Detailed Design (agents, interfaces, contracts, attack surface)

> **Source:** Extracted from chat "Long FIN Agents-Team-1"
> (https://claude.ai/chat/a0d16ca6-e71f-4eb7-84b5-5eee99c81124)
> **Date extracted:** 2026-05-15

---

## 1. The two design axes (orthogonal, both implemented)

The product is a 2×2 of strategy × credential format. Any combination is a valid mode.

### AXIS A — Negotiation Strategy: `NOW (rules-based)` vs `TO-BE (autonomous)`

```typescript
/** Which decision mode produced (or would produce) a move. */
export type DecisionMode = "RULES_BASED" | "AUTONOMOUS";
```

- `RULES_BASED` — deterministic threshold rules, no LLM call. Reproducible CI baseline.
- `AUTONOMOUS` — Gemini Pro reasoning over consultation results + constraint envelope.

Both implement the same `NegotiationStrategy` interface, so the *same state + context* can be run through both and the divergence displayed side-by-side. The UI's "NOW vs TO-BE" panel literally renders both traces next to each other.

### AXIS B — Credential Format: `PlainJson` vs `VLEI`

- `PlainJson` — fast demo, no infrastructure dependency.
- `VLEI` — full ACDC credential, IPEX issued-and-granted, KERI-anchored.

A `CredentialProvider` interface lets either implementation produce a `NegotiationAudit` artifact, attested either way.

---

## 2. The seven-agent textual graph

```
Node N0 — Buyer Agent (Tommy, :9090, Gemini Pro)
   ├─ verifyCounterparty(seller) ──vLEI mutual──► N1
   ├─ proposeOffer(initialPrice)            ────► N1
   └─ evaluateCounter(response)             ◄──── N1

Node N1 — Seller Agent (Jupiter, :8080, Gemini Pro)
   ├─ verifyCounterparty(buyer) ──vLEI mutual──► N0
   ├─ requestConsultation(question)
   │     ├──► N2 (Treasury, ACTUS)
   │     ├──► N3 (Inventory, GS1 Inventory Report)
   │     ├──► N4 (Credit, GLEIF + FRED + payment history)
   │     └──► N5 (Logistics, GS1 DESADV/ASN)
   ├─ synthesizeEnvelope(consultations)  → { floorPrice, targetPrice, maxDiscount%, urgencyScore }
   ├─ proposeCounter(envelope)              ────► N0
   └─ closeDeal()                           ────► N6

Node N2 — Treasury Agent (:7070, Gemini Pro)  [exists ✅]
   ├─ Q: "What is the lowest price at which this deal is NPV-positive?"
   ├─ Private: balance sheet, cash schedule, hurdle rate (12%)
   ├─ Public:  SOFR from FRED (cost of capital benchmark)
   ├─ Tool:    ACTUS PAM simulation
   └─ Returns: { minViablePrice: number, npvAtMinPrice: number, cashRunwayDays: number }

Node N3 — Inventory Agent (:7071, Gemini Flash)  [new ◻️]
   ├─ Q: "How urgent is moving this stock?"
   ├─ Private: stock-on-hand, holding cost/day, spoilage horizon, production slot
   ├─ Public:  GS1 Inventory Report 3.2 schema (mock data, real schema)
   ├─ Tool:    none (pure data lookup)
   └─ Returns: { urgencyScore: 0..1, holdingCostPerDay: number, slotPressure: 0..1 }

Node N4 — Credit/Risk Agent (:7072, Gemini Flash)  [new ◻️]
   ├─ Q: "How risky is this counterparty?"
   ├─ Private: payment history, prior-deal record
   ├─ Public:  GLEIF status (✅ real), FRED macro indicators (✅ real)
   ├─ Tool:    GLEIF API lookup
   └─ Returns: { counterpartyRiskScore: 0..1, recommendedPaymentTerms: string }

Node N5 — Logistics Agent (:7073, Gemini Flash)  [new ◻️]
   ├─ Q: "Can we deliver on time, and at what cost?"
   ├─ Private: shipping contract, route capacity
   ├─ Public:  GS1 DESADV/ASN 3.4 schema (mock data, real schema)
   ├─ Tool:    none (pure data lookup)
   └─ Returns: { canMeetDeadline: boolean, shippingCostPerUnit: number, leadTimeDays: number }

Node N6 — CredentialProvider (interface, two implementations)
   ├─ PlainJsonProvider.attest(deal)  → NegotiationAudit JSON
   └─ VLEIProvider.attest(deal)       → ACDC + IPEX issued-and-granted

Node N7 — Memory / Audit Store
   ├─ NegotiationAudit (always written)
   ├─ IPEX credential record (if VLEI mode)
   └─ Survives sessions, replayable for audit
```

---

## 3. Edges and invariants

### 3.1 Hard invariants (must hold for every decision)

1. **A strategy proposes; the envelope disposes.** `RulesBasedStrategy.decide()` and `AutonomousStrategy.decide()` may return any `NegotiationDecision`, but the **agent's hard constraint envelope** (`applySellerConstraints` / `applyBuyerConstraints`) runs downstream and can override. Strategies can never violate the floor price, max rounds, or scope rules.
2. **Consultation results are typed JSON only — never free text.** This closes NEST-3 attack vector A9 (tool-result injection from a compromised sub-agent). A sub-agent cannot "talk Gemini Pro into" anything; it returns a typed record and that's all the orchestrator sees.
3. **Each consulting agent answers exactly one question.** Treasury answers "min viable price", Inventory answers "how urgent is moving stock", etc. No multi-purpose agents. Single-responsibility is a security boundary, not a code-quality preference.
4. **No sub-agent can re-delegate.** Sub-agent vLEI cards have `canDelegate: false`. Cryptographically enforced; not just a metadata flag.
5. **Scope is enforced on every received task.** Treasury sub-agent will refuse any task whose claimed scope is outside `treasury_operations`, even if it would otherwise be valid. Verified against the sub-delegation credential, not the card alone.

### 3.2 Strategy interface (both modes implement this)

```typescript
export interface NegotiationStrategy {
  readonly mode: DecisionMode;

  /** Pure function over state+context. Implementations MUST NOT mutate inputs. */
  decide(
    state: BuyerNegotiationState | SellerNegotiationState,
    context: DecisionContext,
  ): Promise<NegotiationDecision>;

  /** Reasoning trace — drives the side-by-side "NOW vs TO-BE" panel. */
  explainLast(): StrategyTrace;
}

export interface DecisionContext {
  role: AgentRole;
  round: number;
  maxRounds: number;
  /** Results of consulting sub-agents. Empty for pure rules mode. */
  consultations: ConsultationResult[];
  /** Live market data snapshot, if available (SOFR, cotton, EBR). */
  marketContext?: {
    sofrRate: number;
    cottonPricePerLb: number;
    effectiveBorrowingRate: number;
    sofrSource: string;
  };
}

export interface ConsultationResult {
  source: "TREASURY" | "INVENTORY" | "CREDIT" | "LOGISTICS";
  ok: boolean;  /** false → agent unreachable / timed out */
  /** Shape depends on `source`. Each consumer narrows it. */
  advisory: Record<string, unknown>;
  note?: string;  /** Free-form note for audit log / UI. Not fed to any LLM. */
}
```

### 3.3 The shared-memory protocol (long-running task substrate)

A single in-process store with version-locked writes plus an HTTP wrapper on port `:4100`:

```
POST   /memory               -- create a new negotiation
GET    /memory/:id           -- read full state
POST   /memory/:id/moves     -- append a move (rejected if stale version)
PUT    /memory/:id/dd-offer  -- set DD offer (writtenBy: BUYER|SELLER|TREASURY)
PUT    /memory/:id/dd-result -- set DD result
PUT    /memory/:id/actus-result -- set ACTUS PAM result
```

Every write carries a `writtenBy` claim that's checked against the writer's vLEI scope. Last-write-wins is **not** acceptable for negotiation state; the store uses optimistic version locking and rejects stale writes.

---

## 4. The MCP gateway — 13 tools (current + Phase 2)

| # | Tool | What it does | Backend | Status |
|---|---|---|---|---|
| 1 | `negotiate_price` | Multi-round role-based negotiation | Gemini Pro on AWS A2A | ✅→◻️ rewrite |
| 2 | `compute_dd_rate` | Safe discount rate from margin | Pure math | ✅ |
| 3 | `calculate_early_payment_discount` | Actual savings + settlement date | Pure math | ✅ |
| 4 | `generate_dd_offer` | DD offer document | Pure math | ✅ |
| 5 | `submit_dd_to_actus` | ACTUS PAM contract validation | Real ACTUS server | ✅ |
| 6 | `get_dd_summary` | Plain-English audit narrative | Gemini Pro | ✅ |
| 7 | `verify_vlei_delegation_chain` | Full KERI chain resolution | Real vLEI :4000 | ✅ |
| 8 | `get_market_data` | SOFR + cotton + USD-INR | Real FRED + Yahoo | ✅ |
| 9 | (legacy slot) | — | — | — |
| 10 | `gleif_lookup_lei` | Real GLEIF Global LEI Index | api.gleif.org | ✅ |
| 11 | `treasury_approve` | ACTUS NPV + cash schedule | Real ACTUS + treasury sub-agent | ✅ |
| 12 | `get_buyer_agent_card` | Tommy's full delegation chain | Real AWS :9090 | ✅ |
| 13 | `get_seller_agent_card` | Jupiter's full delegation chain | Real AWS :8080 | ✅ |
| 14 | `start_negotiation` (new) | Kick off A2A negotiation, return `negotiationId` | AWS A2A | ◻️ Phase 2 |
| 15 | `get_negotiation_status` (new) | Poll progress / final outcome | AWS A2A | ◻️ Phase 2 |

Of 13 current tools, **6+ hit real backends** (GLEIF, FRED, Yahoo, ACTUS, vLEI, AWS A2A). That's the demo's credibility floor.

---

## 5. Attack-surface enumeration (from `NEST-3-PART-1.5-MESSAGE-SIGNING.md`)

The full enumeration of 16 production attack vectors. Project 1's hackathon scope addresses A1, A2, A4, A9 directly.

### Identity-layer
- **A1 — Card-clone impersonation.** Attacker hosts a byte-identical copy of Jupiter's `/.well-known/agent-card.json` at `evil.example`. The current localhost demo is safe by virtue of not being networked. Production fix: mutual challenge-response (envelope signature → resolved KEL key). ◻️ Closed by Part 1.5.
- **A2 — AID substitution.** Attacker substitutes their own AID into negotiation messages. Closed by Part 1.5 — session map binds `negotiationId → authenticated peerAID`.
- **A3 — Stale/revoked OOR replay.** Card has no `expiresAt`. Mitigation: card `expiresAt` field; verifier resolves OOR KEL fresh on every call.
- **A4 — Sub-delegation scope abuse.** Sub-agent `scope` is metadata, not enforced. Mitigation: sub-agent inspects every received task's claimed scope, refuses outside-scope work; scope verified against the OOR/sub-delegation credential, not just the card.

### Transport / replay
- **A5 — Verification response replay.** ◻️
- **A6 — Message tampering in transit.** Closed by envelope signing (Part 1.5).
- **A7 — Channel downgrade (HTTPS → HTTP).** Mitigation: HSTS + cert pinning.
- **A8 — Negotiation-state desync.** Mitigation: shared-memory version locking.

### Tool / agent boundary
- **A9 — Tool-result injection from sub-agent.** **Closed by Project 1's typed-JSON-only sub-agent contract.** A compromised sub-agent cannot inject instructions because the orchestrator only consumes `Record<string, unknown>` advisory payloads, never `string` content.
- **A10 — Prompt injection via market-data fields.** Mitigation: market data schema-validated; numeric fields cast to `number` before prompt construction.
- **A11 — Counterparty agent prompt injection.** Closed by Part 1.5 + JSON-only message envelopes.

### Operational
- **A12 — Key compromise of sub-agent.** Mitigation: short-lived sub-delegation; revocation pushed via KEL update.
- **A13 — Replay of completed negotiation.** Mitigation: `negotiationId` consumed once.
- **A14 — Audit log tampering.** Mitigation: append-only log + KEL anchor.
- **A15 — Sybil counterparties.** Mitigation: GLEIF gating (no LEI, no deal).
- **A16 — Regulator impersonation in audit retrieval.** Mitigation: mutual TLS + officer-bound query token.

---

## 6. The four enterprise-agentic problems — concrete mappings

### 6.1 Public+private data fusion

| Agent | Public source (open) | Private source (proprietary) |
|---|---|---|
| Treasury | SOFR (FRED) | Balance sheet, cash schedule |
| Inventory | GS1 Inventory Report 3.2 schema | Stock-on-hand, holding cost, slot |
| Credit | GLEIF registry + FRED macro | Payment history, prior-deal record |
| Logistics | GS1 DESADV/ASN 3.4 schema | Shipping contract, route capacity |

The seller's discount decision **fuses both** without leakage. Each consulting agent enforces its own scope boundary — Treasury cannot read Inventory's stock, Credit cannot read Logistics' routes. Cross-talk happens only through typed JSON advisories at the orchestrator.

### 6.2 Long-running tasks

- 3-round alternating-offers negotiation between Buyer and Seller.
- Each round, the Seller fans out to 4 sub-agents and waits for typed JSON.
- All state checkpointed in shared-memory store (port :4100) with version locking.
- Resumable: any agent can crash and rejoin via `negotiationId`.
- ACTUS PAM simulation itself is multi-step (cash schedule generation, contract event evaluation).

### 6.3 Reasoning interweave

- **Seller Agent (Gemini Pro)** synthesizes 4 sub-agent advisories.
- **Treasury (Gemini Pro)** is the only sub-agent on Pro because ACTUS reasoning is non-trivial.
- **Inventory / Credit / Logistics (Gemini Flash)** are fast, narrow, single-question.
- Synthesis produces ONE typed `DiscountEnvelope` — `{ floorPrice, targetPrice, maxDiscount%, urgencyScore }` — before any offer commits.
- Same envelope feeds both `RulesBasedStrategy.decide()` and `AutonomousStrategy.decide()`. Their outputs diverge; the UI shows both.

### 6.4 Long-term memory

- `NegotiationAudit` JSON written after every closed deal.
- In VLEI mode, IPEX credential record persists the cryptographic attestation.
- The audit log replays the full reasoning chain (consultations, envelope, strategy trace) on demand.
- A learning signal — e.g., "3-deal average is ₹400, trending downward" — is computed from the audit log and fed back as a soft hint to the next negotiation (not a hard constraint).

---

## 7. Honest open contracts (per Rule 3)

Three connector-detail TODOs flagged explicitly. These are wiring decisions, not architecture risks:

1. **A2A SDK message-signing API surface.** Two paths exist — built-in `securitySchemes` field, or custom envelope. Trade-off documented in `NEST-3-PART-1.5-MESSAGE-SIGNING.md`. Decision deferred until first networked deploy.
2. **GS1 Inventory Report / DESADV exact field selection for the mocks.** The full XSD has ~hundreds of fields; the consulting agents need ~5–10 each. Need to read the schemas and pick the minimum-viable subset.
3. **Sub-agent vLEI provisioning for Inventory / Credit / Logistics.** Treasury is already provisioned. The three new agents need ECR credentials from Jupiter's CSO with scope-bounded `canDelegate: false`. Provisioning script exists for the Treasury pattern; needs a parametric version.

---

## 8. Build state and timeline

| Component | State | Effort to ship |
|---|---|---|
| Buyer + Seller A2A agents | ✅ live on AWS | — |
| Treasury sub-agent | ✅ live on AWS | — |
| vLEI / KERI infra | ✅ live on AWS | — |
| ACTUS PAM integration | ✅ live | — |
| 13 MCP tools | ✅ live on Railway | — |
| Gemini Pro for `negotiate_price` | ◻️ swap | ~half day |
| Inventory sub-agent | ◻️ new | ~half day |
| Credit sub-agent (extends existing GLEIF) | ◻️ new | ~half day |
| Logistics sub-agent | ◻️ new | ~half day |
| Tools 14/15 (`start_negotiation`, `get_negotiation_status`) | ◻️ new | ~half day |
| Merge-conflict cleanup in 2 agent files | ⚠️ blocker | ~1 hour |

Total new work: ~3 dev-days to a complete Phase 2 demo with all four consulting agents and Gemini-driven negotiation.

---

**End of design-3-detailed-design.md**
