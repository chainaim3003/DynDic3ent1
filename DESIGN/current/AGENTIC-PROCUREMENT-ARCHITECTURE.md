# LegentPro — Agentic Procurement Architecture (Master Design)

**Version:** 1.2
**Last updated:** 2026-05-17
**Status:** Authoritative design. Supersedes `ITER-8-10-11-12-13-DETAILED-DESIGN.md`.
**Companion files:** `MAY19-RELEASE.md` (iteration tracker), `RESEARCH-CITATIONS.md` (bibliography)

**v1.2 changes:** §7.0 adds Guarantee C (message-ordering audit invariant); §6.1
audit schema adds `envelopeCounter` + `envelopeHash` on log entries; WEDGE1
budget revised 38h → 39h (+1h for the invariant work + regression test).

**v1.1 changes:** §7 expanded with backward-compatibility + UI-isolation guarantees;
new §7.4 covers UI gestures and the new `/negotiations/new` route; new §7.5 lists
cut points if running over budget. WEDGE1 budget revised 33h → ~38h.

---

## 0. Story (the one-paragraph pitch)

Fortune 500 buyers are deploying agentic procurement at scale — Arkestro, Pactum, Lio,
Oro Labs are funded ($30M–$100M rounds in 2025–2026) and serve the buyer's side of
the negotiation. The supplier — especially a US SMB exporter selling on open-account
terms — has nothing comparable, despite quantified pain: only 10% of US exporters use
trade credit insurance vs 50% of European ones (EXIM), foreign buyers offered open
account terms buy 40% more (WTO), 4.5% non-payment rate in 2024 (ICC), $17.5k average
unpaid invoices per US SMB (QuickBooks 2025), and 1.3M US small business exporters
total (SBA 2023 study).

LegentPro builds the supplier-side accountable-agent stack. Same caliber of game-theoretic
reasoning, sub-agent fan-out (inventory + logistics + credit + treasury), and audit-grade
provenance as the buyer-side incumbents — but pointed at the US SMB exporter market they
ignore. Composes natively with ACP (Stripe/OpenAI), AP2 (Google), x402 (Coinbase/Linux
Foundation), and GLEIF/vLEI identity. Audit pack format positioned for EXIM Bank ECI
claims, asset-backed lender underwriting, and factoring partners.

The architecture is built around a single principle: **every claim the agent makes is
sourced, every input is provenance-tagged, and the system degrades visibly when data
is missing rather than silently faking it.** That discipline — codified in 5 orthogonal
configuration axes with frozen-at-boot semantics — is what makes the output regulator-
grade in a market where the IBM accountability gap, Liberis "no validated model" finding,
and Center for Data Innovation SOX §302 uncertainty all point to a coming compliance
storm.

See `RESEARCH-CITATIONS.md` for every claim's source.

---

## 1. The five orthogonal configuration axes

Each axis is set per-agent-process at boot, frozen for the session, recorded in the
audit JSON. Mode never changes mid-deal — that would produce ambiguous audit artifacts.

```bash
# ─── Axis 1: Capability tier — sophistication of reasoning ──────────
NEGOTIATION_MODE=ADVANCED2          # BASIC1, ADVANCED1, ADVANCED2, ADVANCED3, ADVANCED4

# ─── Axis 2: Style — negotiation posture (post-WEDGE1) ──────────────
SELLER_STYLE=BALANCED                # AGGRESSIVE, ASSERTIVE, BALANCED, COOPERATIVE, WIN_WIN_SEEKING
# Self-style only — opponent style is INFERRED in operational use

# ─── Axis 3: Autonomy level — who commits (post-WEDGE1) ─────────────
SELLER_AUTONOMY_LEVEL=L1             # L0=advisor through L5=full

# ─── Axis 4: Evaluation context — ground-truth access ───────────────
EVALUATION_CONTEXT=live              # live, paper-trade, benchmark, replay

# ─── Axis 5: Provider modes — per-sub-agent data source ─────────────
INVENTORY_MODE=demo
LOGISTICS_MODE=demo
CREDIT_MODE=real                     # GLEIF live; SEC EDGAR demo for WEDGE1
```

### 1.1 Capability tier (the SKU ladder)

| Tier | What it adds | Pricing target | Status (WEDGE1) |
|---|---|---|---|
| **BASIC1** | Today's agent: identity + signing + constraint budget + audit + WhatsApp | Free (lead magnet) | ✅ Built (iters 1–7 + 15) |
| **ADVANCED1** | + inventory + logistics sub-agents (sourced delivery & fulfillment) | $99/mo | 🎯 **WEDGE1** |
| **ADVANCED2** | + credit sub-agent + adaptive routing + tactics engine (game theory + executive judgment) | $499/mo | 🎯 **WEDGE1** |
| **ADVANCED3** | + opponent style inference + autonomy levels + per-deal style routing | $1,499/mo | 📋 v1.1 (post-WEDGE1) |
| **ADVANCED4** | + per-counterparty profiles + custom commodity PD models + ACTUS cashflow sim | $3,000–10,000/mo | 📋 v1.2 |

In WEDGE1: ADVANCED3 and ADVANCED4 resolve to a clear error message: `"<tier>
not yet supported in v1.0; use ADVANCED2"`. UI grays them with sized tooltips.

### 1.2 Style (TKI five-style framework, post-WEDGE1)

Drawn from Thomas-Kilmann Conflict Mode Instrument. Each style maps to a parameter
pack (δ baseline, α vector, anchoring rule, concession schedule). Operational rule:
**each agent's own style is configured; opponent style is inferred from observation.**
Only `EVALUATION_CONTEXT=benchmark` permits `ASSIGNED_OPP_STYLE` for measuring
inference accuracy.

Style availability is gated by tier: BASIC1–ADV2 honor self-style only at the
`α-vector` level; ADV3+ honors the full pack and adds opponent style inference.

### 1.3 Autonomy level (SAE J3016 analog, post-WEDGE1)

Borrowed from autonomous-vehicle taxonomy. Gates the *commit* step, not the *reasoning*.
The full battery of agents runs at every level — what changes is what auto-sends vs
escalates vs requires human approval.

- L0 = Advisor (every move renders to human)
- L1 = Assisted (auto-send inside tight envelope; default for first customers)
- L2 = Supervised (auto-close standard deals; escalate exceptions; LLM-as-executive
  reasoning replaces math-band-override at this level)
- L3+ = progressively more permissive escalation criteria

### 1.4 Evaluation context

| Value | Use |
|---|---|
| `live` | Production: real counterparty, no ground truth |
| `paper-trade` | Trial mode: real data, no commit — huge for sales conversion |
| `benchmark` | Research / iter 13 A/B: synthetic counterparty with assigned style |
| `replay` | Past deal re-run with different config — counterfactual analysis |

### 1.5 Provider modes (per sub-agent)

`{INVENTORY,LOGISTICS,CREDIT}_MODE = real | demo`. The mode is set per-sub-agent so
WEDGE1 can have GLEIF live (inside Credit's composite) while inventory and logistics
run from handcrafted fixtures. **No silent fallback ever.** If `real` mode fails
mid-deal, the defensive branch fires and the audit records `dataMode: "real",
error: "<verbatim>", defensiveAction: "<what-changed>"`.

---

## 2. The honesty contract (5 rules applied everywhere)

1. **Provider abstraction.** Every external data class sits behind a `Provider`
   interface in `src/providers/{class}/`. At least two impls: Real and Demo.
2. **Mode is set at boot, never silently flipped.** Validator refuses to start with
   missing required env. Audit records mode for every deal.
3. **No fallback.** Real-mode failure → defensive branch (per sub-agent rules in
   §3 below), never silent swap to demo data.
4. **DEMO-DATA fixtures with `__source` provenance.** Each fixture file carries
   `__source: { kind, specReference | upstreamUrl, relatedStandards[], createdAt,
   willBeReplacedWith }`. Three `kind` values:
   - `handcrafted-to-spec` — built to match the API contract; used Tuesday for
     inventory + logistics + most of credit
   - `captured-from-live` — snapshot from a running real API; the upgrade path
     post-WEDGE1
   - `live` — actual real-time call, no fixture

   `relatedStandards[]` lists every standard relevant to the data class even when
   not emitted yet (e.g. GS1 DESADV listed on logistics fixtures; UN/LOCODE on port
   codes; ACTUS event codes on credit fixtures). This gives reviewers a complete
   "standards footprint" without overclaiming.

   The audit JSON and PDF Section 9 surface `dataMode` AND `demoSourceKind` so
   reviewers see exactly what they're looking at.
5. **Audit-grade response shape.** Every sub-agent response embeds the metadata
   above plus its domain payload. PDF Section 9 renders all of it per deal.

---

## 3. The battery of agents

### 3.1 Treasury (existing)

Knows: static margin floor, cash position, CFO red lines.
Owns: *"Is this deal allowed under our policies?"*

### 3.2 Inventory (ADVANCED1+)

Knows: ATP (available-to-promise), expedite costs, lead times.
Owns: *"Can we fulfill what we're about to promise, at what cost?"*

**Provider interface (`InventoryProvider`)** queries by `itemSku`, `requiredQuantity`,
`requiredByDate`. Returns `availableToPromise`, `leadTimeDays`,
`fulfillmentScenarios[]`.

**WEDGE1 implementation:** `DemoInventoryProvider` reads
`DEMO-DATA/inventory/erpnext-bin-*.json` with `__source.kind: handcrafted-to-spec`
and `specReference` pointing at https://docs.erpnext.com/docs/user/manual/en/stock/bin.
`__source.relatedStandards` includes `["GS1 GTIN (item identifier)", "GS1 GLN (warehouse
location)", "ERPNext v15 DocType: Bin"]`. Real impl `ErpNextInventoryProvider` is
code-ready (REST against `/api/resource/Bin`), activated by `INVENTORY_MODE=real`
post-WEDGE1.

**Defensive branch on error:** seller refuses to commit a quantity SLA — quote says
"subject to confirmation". Audit: `defensiveAction: "no-quantity-sla-inventory-unavailable"`.

**Consulted when:** every pre-quote; on quantity counter (>10% shift); on
delivery-date shift.

### 3.3 Logistics (ADVANCED1+)

Knows: carrier schedules, port congestion, freight rates, transit times.
Owns: *"Can the goods move from origin to destination by the buyer's date, at what cost?"*

**Provider interface (`LogisticsProvider`)** queries by `originPortUNLOCODE`,
`destinationPortUNLOCODE`, `cargoType`, `volumeCBM`, `weightKg`, `readyDate`.
Returns `feasible`, `earliestDeliveryDate`, `totalLogisticsCostUSD`, `transitDays`,
`carrierName`.

**WEDGE1 implementation:** `DemoLogisticsProvider` reads `DEMO-DATA/logistics/dcsa-*.json`
handcrafted to match Maersk DCSA Track & Trace 2.2 contract. `__source.relatedStandards`
includes `["DCSA T&T 2.2 (this format)", "GS1 DESADV EDIFACT D.96A (downstream notify,
post-Week-2)", "UN/LOCODE (port codes — INMAA, USLAX)", "IATA ONE Record (air cargo,
post-Week-2)"]`. Real impls (Maersk, ShipEngine, 17track) coded as stubs, activated
post-WEDGE1.

**Defensive branch on error:** quote includes "best-effort, no SLA" language; no
specific `earliestDeliveryDate`. Audit: `defensiveAction: "no-delivery-sla-logistics-unavailable"`.

**Consulted when:** every pre-quote; on delivery-date shift; on volume/qty change >10%.

### 3.4 Credit (ADVANCED2+)

Knows: counterparty PD/LGD from GLEIF + SEC EDGAR + (post-WEDGE1) OpenCorporates +
Companies House + World Bank + ACTUS.
Owns: *"What is the risk-adjusted true price of accepting deferred payment terms?"*

**Provider interface (`CreditProvider`)** queries by `counterpartyLei`,
`exposureAmount`, `paymentTermDays`. Returns `probabilityOfDefault`,
`lossGivenDefault`, `riskPremiumPerUnit`, `confidence`.

**WEDGE1 implementation:** `CompositeCreditProvider` with two sources:
- **GLEIF live** — `GET https://api.gleif.org/api/v1/lei-records/{LEI}`. No auth,
  unlimited free. Returns entity status, registration date, jurisdiction.
- **SEC EDGAR demo** — `DEMO-DATA/credit/edgar-companyfacts-*.json` handcrafted-to-spec
  matching `data.sec.gov/api/xbrl/companyfacts/CIK{padded}.json`. Will go live in v1.1.

`__source.relatedStandards` includes `["GLEIF LEI (ISO 17442)", "XBRL US-GAAP taxonomy",
"ACTUS event codes (post-WEDGE1 cashflow PD)"]`.

Composition: PD = max(country_band_PD, gleif_status_PD). LGD = 0.6 default. Premium
= `exposureAmount × PD × LGD ÷ orderQuantity`. Confidence "high" if 2+ sources agreed.

**Defensive branch on error:** seller refuses all deferred terms — counter rebuilt
as COD (Net-0) at original quoted price. Audit:
`defensiveAction: "refused-deferred-terms-credit-data-unavailable"`.

**Consulted when:** pre-quote if `orderValueUSD > 25k` (`CREDIT_CHECK_THRESHOLD_USD`);
on payment-term shift (longer terms); on counter implying >20% exposure increase.

---

## 4. Adaptive routing (ADVANCED2+)

The `ConsultationRouter` decides which sub-agents to consult on each round. Not every
counter needs every sub-agent — routing rules keep API quota and audit weight in check.

**WEDGE1 ships 3 rules** (full set of 6 lands post-WEDGE1):

1. **pre-quote-baseline** — always fires on first counter → consults inventory +
   logistics + treasury, plus credit if `orderValueUSD > 25k`
2. **payment-term-shift** — buyer proposes longer terms (Net-15 → Net-60) →
   re-consults credit
3. **delivery-date-shift** — buyer asks for earlier delivery → re-consults inventory
   + logistics

Dispatcher fans out in parallel via `Promise.all`, dedupes when multiple rules ask
the same sub-agent, returns `ConsultationRecord[]` to the seller.

---

## 5. The tactics engine and executive reasoning (ADVANCED2+)

Two reasoning modes, both inside WEDGE1, chosen by autonomy level.

### 5.0 The two-mode architecture

| Autonomy level | Reasoning style | What math does | What LLM does |
|---|---|---|---|
| L0–L1 | **Rails-bounded** | Computes feasibility region, NBS midpoint, math-derived band; **overrides** LLM proposal if outside band | Narrates within the math band; emits human-readable rationale |
| L2+ | **Executive judgment, math-informed** | Computes feasibility region, NBS midpoint, math-derived band as *advisory context*; applies **hard boundary clamps only** + flags out-of-band proposals as audit warnings (no override) | Reasons holistically across all 4 dimensions, identifies binding constraint, proposes multi-dimensional counter with rationale |

The structural rule at every level: **defensive branches are inviolable.** Even L5
cannot accept a deal when credit data is missing — the agent's eyes are partly closed
and no autonomy level authorizes deciding blind.

WEDGE1 ships both modes, with the executive-reasoning path being the demo highlight
at L2 (default for the ADV2 tier demo).

### 5.1 Effective floor calculation (all modes)

```
effective_floor =
    treasury_static_base
  + inventory.expediteCostPerUnit (if needed for date)
  + logistics.totalLogisticsCostUSD / orderQuantity
  + credit.riskPremiumPerUnit
```

Per-deal, per-round. Replaces the static margin floor that BASIC1 uses.

### 5.2 Patience-δ engine (all modes)

Rubinstein bargaining theory: each party has a per-round discount factor δ ∈ (0,1)
representing patience. Higher δ = more patient = better outcome.

**WEDGE1 implementation:** self-δ hardcoded per tier (ADV2 default = 0.94). Opponent-δ
inferred from one signal: the magnitude of the buyer's last-round price jump.
Larger jump = less patient = lower inferred δ.

**Post-WEDGE1 (ADV3):** self-δ adjusted from multiple signals (credit confidence,
inventory ATP slack, logistics rate trend, round count). Opponent-δ inferred from
multiple behavioral signals.

### 5.3 NBS midpoint (all modes)

```
nbs_midpoint = (effective_floor + inferred_buyer_ceiling) / 2
inferred_buyer_ceiling = max(buyer_offers_so_far) × 1.05
```

Symmetric NBS in WEDGE1. Asymmetric NBS with δ-weighting in ADV3.

### 5.4 α-weighted utility (all modes)

```
U_seller(counter) =
    α_price × normalize(counter.pricePerUnit, effective_floor, max_observed)
  + α_term  × normalize(90 − counter.paymentTermDays, 0, 90)         // shorter = better
  + α_date  × normalize(counter.deliveryDate − ready_date, max_days, min_days)
  + α_risk  × −(credit.riskPremiumPerUnit × counter.quantity / max_exposure_premium)
```

WEDGE1: hardcoded α at tier level. BALANCED default = `[0.5, 0.15, 0.15, 0.2]`.
ADV3: per-counterparty configurable α via `config/counterparty-tactics.yaml`.

### 5.5 L0–L1 mode: math-band override

```
band = [nbs_midpoint - bandwidth, nbs_midpoint + bandwidth]
       where bandwidth = (inferred_buyer_ceiling - effective_floor) × 0.15

if llm_proposal outside band:
    counter = clamp(llm_proposal, band.low, band.high)
    audit.log("llm-override", { original: llm_proposal, overridden_to: counter })
else:
    counter = llm_proposal
```

The structural answer to Xia et al. 2024's finding that LLM negotiators leak money
without constraint enforcement.

### 5.6 L2+ mode: LLM-as-executive with three guardrail layers

At L2+, the LLM receives a structured "executive briefing" containing:
- The buyer's full multi-dimensional counter (price, term, date, qty)
- All 4 sub-agent outputs with `dataMode` + `__source` provenance
- The math summary (effective floor, NBS, ZOPA analysis, α-vector)
- Observed buyer behavior pattern (concession magnitudes per dimension)
- A focused decision question

The LLM emits structured JSON: `{ decision: ACCEPT | COUNTER | NO_DEAL, counter: {...},
reasoning: "...", bindingConstraint: "price" | "term" | "date" | "qty", confidence }`.

Three guardrail layers apply in order:

1. **Hard boundary clamp** — counter cannot violate seller's hard floor on any
   dimension. ₹350 is the absolute minimum; LLM proposing ₹340 gets clamped to ₹350.
   Override logged. **Non-negotiable at every autonomy level.**
2. **Sanity warning** — if LLM proposal is outside math band by >15%, audit flags
   it; no override. *"Executive judgment overrides math; review recommended."*
3. **Defensive override** — defensive substitution wins over LLM judgment when
   triggered. Credit unavailable + LLM proposed Net-60 → counter forced to COD,
   override logged.

The LLM is the agent; the math is the board's pre-meeting briefing memo. **This
distinguishes WEDGE1 from rules-based negotiation tools and from unconstrained LLM
agents alike.**

### 5.7 Negotiation dimensions (all 4 explicit)

| Dimension | Buyer wants | Seller responds with | Sub-agent that grounds it |
|---|---|---|---|
| Price per unit | Lower | Higher (with floor visibility) | Treasury + all 4 contribute to effective floor |
| Payment terms (days) | Longer (Net-60, Net-90) | Shorter (Net-15, COD) | Credit (premium per term length) |
| Delivery date / lead time | Earlier | Later, or premium for early | Inventory (expedite) + Logistics (air vs sea) |
| Quantity | Often larger (volume discount) | Larger only if ATP supports + floor reduces with bulk | Inventory (ATP + tier breaks) + Logistics (rate tier shifts) |

Each round, the agent emits exactly one of five outcomes via the LLM's
structured decision (at L2+) or via the rules engine (at L0–L1):

| Outcome | Trigger | Audit label |
|---|---|---|
| ACCEPT (deal closes) | All 3 conditions hold for buyer's counter | `decision: "ACCEPT"` |
| COUNTER | At least one condition fails, ZOPA non-empty, round count < max | `decision: "COUNTER"` |
| COUNTER_DEFENSIVE | Defensive branch active; counter forces conservative substitution | `decision: "COUNTER_DEFENSIVE"` |
| NO-DEAL (declared) | ZOPA empty across one or more dimensions, derivable from data | `decision: "NO_DEAL_ZOPA_EMPTY"` |
| ESCALATE | Max rounds hit, stalled, or autonomy level requires human approval | `decision: "ESCALATE_TO_HUMAN"` |

NO-DEAL is **not failure** — it's the agent correctly recognizing economic
incompatibility and saving everyone's time, with the audit explaining which
dimension blocked.

---

## 6. Audit & PDF surface

### 6.1 Audit JSON additions

```json
{
  "negotiationMode": {
    "tier": "ADVANCED2",
    "resolvedCapabilities": { ... },
    "providerModes": { "inventory": "demo", "logistics": "demo", "credit": "real" },
    "evaluationContext": "live"
  },
  "logs": [
    {
      "round": 2,
      "messageType": "COUNTER_OFFER",
      "from": "BUYER",
      "envelopeCounter": 2,           // NEW — from envelope.counter
      "envelopeHash": "a1b2c3...",    // NEW — canonical event reference
      "offeredPrice": 330,
      "paymentTermDays": 45,          // NEW — ADV1+ only, absent at BASIC1
      "requestedDelivery": "2026-06-22", // NEW — ADV1+ only
      "quantity": 50000,              // NEW — ADV1+ only
      "previousPrice": 380,
      "priceMovement": -50,
      "decision": "COUNTER_OFFER",
      "reasoning": "...",
      "timestamp": "2026-05-19T14:32:01.241Z",
      "negotiationId": "NEG-..."
    }
  ],
  "consultations": [
    {
      "subAgent": "credit",
      "trigger": "advanced2-pre-counter",
      "result": {
        "status": "ok",
        "data": { ... },
        "meta": {
          "dataMode": "real",
          "demoSourceKind": null,
          "provider": "gleif@api.gleif.org",
          "fetchedAt": "2026-05-19T14:32:01.241Z",
          "latencyMs": 138,
          "requestId": "01HXYZ...",
          "upstreamUrl": "https://api.gleif.org/api/v1/lei-records/549300SVDFI5BWA89T19"
        }
      },
      "influencedDecision": "adjusted-floor-by-4-rupees-per-unit"
    }
  ],
  "tacticsTrace": {
    "effectiveFloor": 376,
    "selfDelta": 0.94,
    "inferredOppDelta": 0.85,
    "nbsMidpoint": 393,
    "alphaVector": [0.5, 0.15, 0.15, 0.2],
    "mathBand": [388, 394],
    "llmProposed": 398,
    "llmReasoning": "Their longest concession is on term, signaling that's their flex axis. ...",
    "bindingConstraint": "term",
    "mathOverridden": false,
    "sanityWarning": "proposal slightly above band ceiling",
    "finalCounter": { "price": 390, "term": 30, "date": "2026-06-22", "qty": 50000 }
  },
  "roundOutcome": {
    "round": 2,
    "decision": "COUNTER",
    "feasibility": { "feasible": true, "violations": [] },
    "utility": { "seller": 0.74, "sellerReservation": 0.55 },
    "defensiveActions": [],
    "zopaAnalysis": {
      "price": { "overlaps": true, "sellerMin": 376, "buyerMaxInferred": 388 },
      "term": { "overlaps": true, "sellerMax": 60, "buyerMin": 30 },
      "date": { "overlaps": true, "sellerEarliest": "2026-06-20", "buyerRequiredBy": "2026-07-01" },
      "quantity": { "overlaps": true, "sellerATP": 50000, "buyerMin": 30000 }
    }
  }
}
```

### 6.2 PDF Section 9

Renders all of the above human-readably. For each consultation: header bar showing
sub-agent name + `dataMode` + `demoSourceKind` (e.g. *"Inventory (demo,
handcrafted-to-spec, will be replaced with captured-from-live snapshot Week 1
post-launch)"*). Then payload summary, defensive actions if any.

Tactics trace renders as a single page: the math chain from floor through NBS
through α-weighted utility to the final counter, with the LLM reasoning text
displayed verbatim and any override or sanity-warning shown explicitly.

Round outcome renders as a final per-round block summarizing the decision, the
feasibility check, utility scores, ZOPA analysis, and the audit-grade rationale.

### 6.3 Honesty in the audit (the discipline)

- Every sub-agent response declares its `dataMode` AND `demoSourceKind`
- Every math derivation is reproducible from the recorded inputs
- LLM reasoning text is preserved verbatim
- LLM proposals, math overrides, sanity warnings are all logged
- Defensive actions are explicit, named, and tied to specific data unavailability
- Provider URLs are recorded so a reviewer can re-fetch the same data later

---

## 7. WEDGE1 — explicit scope for May 19, 2026

This is what gets built between Sun 2026-05-17 PM and Tue 2026-05-19 AM.

### 7.0 Two non-negotiable guarantees

**Guarantee A — Backward compatibility on the existing CLI.** The legacy
command `start negotiation 300` must continue to work exactly as it does
today, with byte-identical audit output, throughout WEDGE1 development. The
new multi-dimensional command form is *additive* — it adds new flags
(`--product`, `--qty`, `--buyer-budget`, `--buyer-style`, `--buyer-deadline`)
but does not change behavior when the legacy bare-number form is used.

Implementation: the CLI parser detects which form was invoked. If the first
arg after `start negotiation` is a bare number → legacy adapter fills in
defaults and forces the run at `NEGOTIATION_MODE=BASIC1` for that invocation.
If the first arg is a flag → new multi-dimensional path. A dedicated regression
test asserts that `start negotiation 300` produces audit output byte-identical
to the current product baseline. **This test runs in CI; if it fails, WEDGE1
is not shipped.**

**Guarantee B — Existing UI is untouched.** The current dashboard
(`/deal-quality`, `/settings`, etc. — all of iters 3, 5, 6, 7) ships
unchanged. WEDGE1 adds exactly one new route, `/negotiations/new`, with its
own component tree. The nav bar gets one new link. No existing component is
modified; no existing screenshot is invalidated; no existing user flow is
broken. The new UI route is purely additive and can be disabled by a single
route deletion if needed.

**Guarantee C — Message ordering is canonical across both audits.** Each
sealed message has a monotonic `envelope.counter` per (sender, receiver) pair
(iter-2 mechanism, already shipped). WEDGE1 surfaces this counter into the
audit `logs[]` array on both BUYER and SELLER sides via two new optional
fields per entry: `envelopeCounter` and `envelopeHash`. A regression test
asserts that, after filtering each agent's logs to sealed-message events only,
sorting by `(direction, envelopeCounter)` produces byte-identical event
sequences across both audits.

This is the structural answer to the historical round-numbering divergence
(iter-4 fixed off-by-one in seller priceTrail for NEG-079945; iter-4.3 fixed
the SSE/A2A race). Round labels can still differ between BUYER and SELLER
perspectives by convention (e.g. ACCEPT round numbering), but the
envelope-counter sequence cannot — it is the authoritative ordering key.

Multi-dimensional extension: the same envelope wraps any negotiation payload
shape. ADV1+ payloads carry `paymentTermDays`, `requestedDelivery`, and
`quantity` alongside `pricePerUnit`. BASIC1 (legacy `start negotiation X`)
payloads omit those fields. The envelope-counter ordering invariant holds
regardless of payload shape.

### 7.1 In scope (~39 hours)

| Block | Hours |
|---|---|
| Tier framework: `BASIC1`, `ADVANCED1`, `ADVANCED2` + validator + audit `negotiationMode` block | 3h |
| `Provider` abstraction (`CreditProvider`, `InventoryProvider`, `LogisticsProvider` interfaces + `ConsultationMetadata` type) | 1h |
| **4 sub-agents wired** (Treasury existing; Inventory + Logistics demo-only; Credit composite with GLEIF live + SEC EDGAR demo) | 4h |
| `GleifEntityClient` live HTTP integration | 2h |
| `ConsultationRouter` with 3 rules + dispatcher + dedup | 2h |
| **Tactics engine + LLM-as-executive at L2** (effective floor, δ, NBS, α-weighted utility, both reasoning modes, 3 guardrail layers) | 7h |
| Audit JSON `consultations[]` + `tacticsTrace` + `roundOutcome` + `zopaAnalysis` blocks | 2h |
| **Message-ordering audit invariant** (Guarantee C): `envelopeCounter` + `envelopeHash` on AuditLogEntry, capture at seal/verify points, regression test | 1h |
| PDF Section 9 (renders all 4 sub-agents + tactics chain + round outcomes + LLM reasoning verbatim) | 3h |
| Defensive branches (credit-down → COD; logistics-down → no SLA; inventory-down → no qty commit) | 2h |
| Handcrafted-to-spec fixtures: 2 inventory, 2 logistics, 1 EDGAR, 1 OpenCorporates, 1 Companies House (each with `__source.relatedStandards[]`) | 3h |
| **Legacy CLI dual-parser + adapter + byte-identical regression test** (Guarantee A) | 1.5h |
| **New `/negotiations/new` UI route** (Guarantee B): `OpenForm` (6-field opening form), `RoundTimeline` (live SSE stream), `RoundCard` (reasoning render), nav-link add | 6h |
| Consultation drill-down side panel (click sub-agent badge → see provenance + raw JSON) | 1.5h |
| `/settings` page extension: tier card + capability grid + grayed v1.1/v1.2 tiers | 1h |
| Demo script + 3 dry-runs | 2h |
| iter-15 WhatsApp test buffer | 4h |
| **Subtotal new work** | **~39h** |

The legacy adapter + regression test (1.5h) is the cheapest insurance available
for protecting the working product. **It must land at the start of WEDGE1 coding,
not at the end** — that way every subsequent commit is checked against the
byte-identical baseline.

### 7.2 Out of scope for WEDGE1 (sized for post-launch)

| Item | Sized | When |
|---|---|---|
| Live ERPNext (Docker setup + capture script + env-var swap to real) | 4h | Week 1 |
| Live SEC EDGAR integration | 2h | Week 1 |
| Live Maersk DCSA + ShipEngine integration | 6h | Week 2 |
| Live OpenCorporates + Companies House + World Bank | 4h | Week 2 |
| Full routing (6 rules instead of 3) | 2h | Week 2 |
| Opponent style inference (TKI 5-style framework + perception accuracy metric) | 5h | Week 3 |
| Autonomy levels L0–L5 + commit gates | 3h | Week 3 |
| Per-counterparty α/δ profiles (`counterparty-tactics.yaml`) | 4h | Week 4 |
| Iter 13 A/B testing framework | 8h | Week 4 |
| PROTOCOL1: ACP envelope emit + AP2 mandate verify + x402 settlement | 12h | Week 5 |
| AUDIT1: EXIM ECI / factoring / asset-backed-lender audit pack variants | 6h | Week 5 |
| EMBED1: QuickBooks + BILL.com + Ramp integrations | 16h | Week 6 |
| LEARNING1: per-counterparty profile updater | 8h | Week 7 |
| iter 9: `VleiProvider` wired through abstraction | 3h | Week 7 |
| iter 14: `VleiSignifySigner` (real KERI signing) | 8h | Week 8 |
| ADVANCED4 features: custom commodity PD, ACTUS cashflow sim | 12h | Weeks 8–9 |
| LEARNING2/3: per-style refinement + opt-in aggregator | 20h+ | Weeks 10+ |

**Total post-WEDGE1 backlog: ~123h** at sized estimates. At a steady 30h/week pace:
realistic Series-A milestone end of June / early July 2026.

### 7.3 Demo script (6 minutes)

| Scene | What viewer sees | Configuration |
|---|---|---|
| **1 (60s)** | Existing dashboard. Run legacy `start negotiation 300` from CLI. Outputs unchanged from today's product — single price counter, BASIC1 audit. | `NEGOTIATION_MODE` unset / `BASIC1` |
| **2 (3 min)** | Click "Open Negotiation" nav link. Land at `/negotiations/new`. Fill 6-field form (product, qty, buyer-budget ₹400, buyer-style aggressive, buyer-deadline 2026-06-15). Click "Open negotiation." Watch buyer open at ₹340 / Net-60 / 50k / 06-15. Watch seller consult 4 sub-agents (badges light up sequentially), render reasoning text, counter at ₹385 / Net-30 / 4-week sea. Click on "Credit" badge → drill-down shows live GLEIF JSON + handcrafted-to-spec EDGAR with `__source` provenance. | `NEGOTIATION_MODE=ADVANCED2` |
| **3 (90s)** | Same form, re-open. This time the credit endpoint is reachable but EDGAR fixture is set to error mode. Watch credit return error → defensive branch fires → seller forces COD, refuses Net-60. Reasoning text explains the defensive policy in business terms. | Same as Scene 2 with simulated EDGAR outage |

**Closing slide (60s)** — `/settings` page (which already exists from iter 6,
now extended with the new tier card) showing all 5 tiers with BASIC1 / ADV1 /
ADV2 active and ADV3 / ADV4 grayed with sized tooltips. One slide showing funded
comps (Arkestro $36M, Pactum, Lio $30M from a16z, Oro $100M) all serving the *buyer*
side — LegentPro serving the *supplier* side.

### 7.4 UI gestures (the human input surface)

WEDGE1 introduces *minimal* human input — the human declares intent, agents do the
negotiation themselves. The agentic property of the system shows up in the gap
between the few fields the human typed and the rich multi-dimensional reasoning
the agents produce.

**The 6-field open-negotiation form** (the only new input):

```
Open a new negotiation
─────────────────────
Product:        FAB-COTTON-180GSM  ▼
Quantity:       50,000 units
Max budget:     ₹400 per unit
Buyer style:    aggressive  ▼   (aggressive / balanced / cooperative)
Required by:    2026-06-15
[ Open negotiation ]
```

The seller's posture comes from `SELLER_STYLE=BALANCED` env (set at boot —
ADV3 work, not WEDGE1). Everything else — opening offers, counter values,
payment terms, delivery dates, accept/counter/no-deal decisions — emerges
from agent reasoning.

**The round timeline** — after submission, the dashboard streams round-by-round.
Each card shows the agent's reasoning text prominently with sourced sub-agent
inputs collapsible underneath. Provenance side-panel opens on badge click.

**The four demo gestures** (in priority order):

1. **Fill form, click Open** — proves agency by showing how much the agents produce
   from minimal human input. (Required.)
2. **Watch rounds stream** — proves multi-dimensional reasoning by showing the
   agent's reasoning text per round. (Required.)
3. **Click into a sub-agent badge** — proves provenance by showing the raw data,
   the spec reference, and how it influenced the decision. (Required.)
4. **Simulate sub-agent outage** — proves the honesty story by showing visible
   degradation. (Optional; first to cut if time runs short.)

**What this is not:**
- The human does NOT type a price counter
- The human does NOT pick payment terms
- The human does NOT choose delivery dates
- The human does NOT specify acceptable trade-offs
- All of those are produced by the agents from minimal intent input

This is the line between "automation" (human types every decision) and "agency"
(human declares intent; agents reason their way to the deal).

### 7.5 Cut points if running over budget

In priority order — cut from the bottom first if WEDGE1 starts slipping past 38h
by end of Monday evening:

1. **Cut Gesture 4 (simulate-outage button)** → -0.5h. Still ship the defensive-
   branch code; just don't demo it interactively. Saves 30 minutes.
2. **Cut side-by-side tier comparison launcher** → -0.5h. Demo runs the three
   tiers sequentially in three browser tabs (manual gesture, looks fine). Already
   not budgeted as a separate line — this is just clarifying intent.
3. **Reduce consultation drill-down to a "View raw JSON" link** → -1h. Saves on
   the side-panel polish; opens raw audit JSON in a new tab instead. Loses some
   provenance polish but data is still there.
4. **Drop opponent-δ inference, use hardcoded opponent-δ = 0.85** → -1h. Loses
   one game-theory detail; the math chain still works.
5. **Drop 1 of the 3 routing rules** (keep only `pre-quote-baseline`) → -0.5h.
   Loses adaptive routing demonstration; sub-agents still consulted on first
   counter.

Total available cuts: ~3.5h. Hard floor on WEDGE1: ~34.5h. Below that, demo
quality drops materially.

**Never cut:** Guarantee A (legacy command), Guarantee B (UI isolation), all 4
sub-agents wired, GLEIF live, defensive branches in code (even if not demoed),
audit PDF Section 9, regression test.

---

## 8. Competitive positioning summary

| | Pactum / Arkestro / Lio | LegentPro WEDGE1+ |
|---|---|---|
| Who it serves | Fortune 500 *buyers* | The *supplier*, including 1.3M US SMBs |
| Sub-agent fan-out | Single optimization function | 4 specialists consulted per round, with provenance |
| LLM constraint enforcement | Trust the model | Two reasoning modes; L0–L1 math-band override, L2+ executive judgment with hard-clamp + sanity-warn + defensive override |
| Identity layer | Basic auth / SSO | GLEIF live (WEDGE1); vLEI-ready (iter 9/14) |
| Protocol layer | Proprietary | ACP/AP2/x402-ready (Phase 2) |
| Audit format | Internal log | Signed PDF with sourced provenance per input + LLM reasoning verbatim + EXIM ECI variant (Phase 2) |
| Defensive degradation | Silent fallback | Visibly refuses deferred terms when credit data missing |
| Customer ACV | $M+ enterprise | $99–$10k/mo across the SMB ladder |

See `RESEARCH-CITATIONS.md` §7 for full citations on each competitor.

---

## 9. Distribution wedge (post-WEDGE1)

Three partnerships that solve the SMB-distribution problem:

1. **EXIM Bank** — your audit pack lowers their ECI underwriting cost; they refer
   SMBs to you for due-diligence-grade buyer reports. EXIM has explicit small-exporter
   programs (Express Multi-Buyer Insurance Policy for <$7.5M average export credit
   sales over the last three years).
2. **QuickBooks + BILL.com + Ramp** — embed inside SMB financial workflows. Trigger:
   when QB books an invoice >$25k for a new foreign buyer, auto-run buyer-DD check.
3. **Stripe (via ACP)** — when a US SMB processes ACP payments at scale, surface
   the tool through Stripe's merchant dashboard as the "agentic counterparty
   verification" add-on.

---

## 10. Risks & mitigations

See `RESEARCH-CITATIONS.md` for fuller treatment. Summary:

- **SMB distribution is hard** → lead with EXIM + QuickBooks + Stripe partnerships,
  not direct sales.
- **Intuit/Stripe/Brex/Ramp could swallow this** → audit-pack format depth +
  ACTUS-PD proprietary model + vLEI/KERI identity moat. Also: be acquirable.
- **LLM negotiation literature shows they lose money on average** → math-band
  override + L2+ executive-judgment guardrails are the structural answer
  (Xia 2024 finding becomes our differentiation).
- **Regulator uncertainty** → being early to a defensible audit format positions
  for whatever NIST/SEC/CFPB publishes. NIST AI Agent Standards Initiative
  underway (2026).
- **Foundation model commoditization** → moat is in data pipeline + audit format +
  partnerships + multi-dimensional executive reasoning, not in the LLM itself.

---

## 11. File index (everything in `DESIGN/`)

| File | Purpose | Status |
|---|---|---|
| `AGENTIC-PROCUREMENT-ARCHITECTURE.md` | THIS FILE — master design | ✅ Current v1.1 |
| `MAY19-RELEASE.md` | Iteration tracker | ✅ Current |
| `RESEARCH-CITATIONS.md` | Bibliography | ✅ Current |
| `ITER-8-10-11-12-13-DETAILED-DESIGN.md` | Earlier partial draft | ⚠️ Superseded (stub points here) |
| `DESIGN1/`, `DESIGN2/` | Pre-WEDGE1 design folders | Historical reference only |

---

## 12. Honest scope (what's claim-able vs. forward-looking)

**Grounded (defensible in any meeting today):**
- The accountability gap exists, regulators have noticed, procurement-specific
  governance is unsolved (Liberis, IBM, Center for Data Innovation, NIST).
- US SMB exporters are real, large, underserved, with quantified credit/payments/fraud
  problems (SBA, EXIM, Fed SBCS, ICC, WTO).
- LLM negotiators currently fail at constraint-following and opponent modeling
  (Xia, ICML 2025, HAMBA/MERIT).
- WEDGE1 stack (identity + signing + constraint budget + sourced sub-agents +
  L0–L1 math-band override + L2+ executive judgment + audit) is a direct,
  point-by-point response to the named gaps — and live-demonstrable.

**Stretch (defensible as a research claim, not a product claim yet):**
- Functional-ToM convergence improvements over baselines (requires iter 13 + LEARNING1/2
  to show with data).
- Privacy-bounded global aggregator producing useful style-distribution priors
  (requires LEARNING3 and opt-in deployment).
- Standard-setting for accountable agentic procurement (requires adoption, not
  just architecture).

**Off-limits (don't claim, anywhere):**
- That the system "outperforms" any specific human negotiator or commercial platform
  (no benchmark yet; LLM-negotiation literature shows even GPT-4 loses money on average).
- Specific percentages of credit-loss reduction, deal-velocity improvement, or fraud
  prevention (need pilot data we don't have yet).

---

*End of master design v1.1. Companion docs: `MAY19-RELEASE.md` for iteration status,
`RESEARCH-CITATIONS.md` for source bibliography.*
