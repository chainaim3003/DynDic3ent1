# LegentPro — May 19 Release

**Status:** iterations 5, 6, 7, 15 landed in code. **WEDGE1 is the next iteration line item**, currently being built for May 19 demo.
**Last updated:** 2026-05-17 (v1.2 — Guarantee C / message-ordering audit invariant added; +1h to budget)

See also: `AGENTIC-PROCUREMENT-ARCHITECTURE.md` (master design) and `RESEARCH-CITATIONS.md` (bibliography).

## What this release ships

A customer-facing MVP of accountable agentic procurement, positioned for the US SMB exporter market. A supplier can onboard their counterparties (real GLEIF LEIs), run a real
negotiation between buyer and seller agents (Gemini 2.5 Pro) at a configurable sophistication tier, receive a signed PDF audit with sub-agent provenance, and demonstrate the
upgrade path from BASIC1 (today's product) to ADVANCED4 (per-counterparty profiles + commodity-specific PD models, week 8+).

## Iteration status (cumulative through May 17)

| # | Iteration | Hours | Status |
|---|---|---|---|
| 0   | Baseline hygiene + Gemini provider swap                                    | 3h   | ✅ DONE — verified |
| 0.5 | Gemini robustness (key validation, backoff, JSON parsing, fallback labels) | 2h   | ✅ DONE — verified |
| 1   | CredentialProvider + onboarding API + GLEIF risk check + CLI SSE fix       | 5h   | ✅ DONE — verified end-to-end |
| 2   | MessageSigner + plain envelope                                             | 3h   | ✅ DONE — verified (3-round neg, all envelopes wrapped/verified) |
| 3   | Outcome-quality metrics + DealQualityCard + mode-aware UI gate             | 4h   | ✅ DONE — verified |
| 4   | Constraint-budget recording + Decision Trail viewer + per-round SOFR       | 4.5h | ✅ DONE — verified (incl. iter-4 hotfix + iter-4.1 buyer ACCEPT block) |
| 5   | Fixture replay + baseline summary                                          | 2h   | ✅ DONE — code landed 2026-05-17 |
| 6   | Mode-matrix runner + UI mode toggle                                        | 2.5h | ✅ DONE — code landed 2026-05-17 |
| 7   | Signed PDF audit + dashboard list view                                     | 3h   | ✅ DONE — code landed 2026-05-17 (prior MVP cut-line) |
| 15  | WhatsApp notifications via Meta Cloud API (direct, no BSP)                 | 5h   | ✅ DONE — code landed 2026-05-17 (testing in parallel with WEDGE1) |
| **WEDGE1** | **Tier framework + 4 sub-agents + tactics + executive reasoning + new UI route + message-ordering invariant — May 19 MVP cut-line** | **~39h** | **🎯 IN PROGRESS — see §"WEDGE1 — what we're building right now" below** |
| 7.5 | Email notifications (CFO inbox + daily digest)                             | 3h   | ⏸️ Deferred to Week 1 post-WEDGE1 |
| 7.6 | PWA mobile + Solution brief                                                | 2.5h | ⏸️ Deferred to Week 1 post-WEDGE1 |

**Total done through 2026-05-17: ~34 hours.** WEDGE1 adds the SF-bandwagon-aligned wedge differentiator on top.

---

## WEDGE1 — what we're building right now (May 17 PM through May 19 AM)

### One-sentence framing

WEDGE1 ships the **tier framework + 4 sub-agents (Inventory, Logistics, Credit, Treasury) + adaptive routing + tactics engine + LLM-as-executive reasoning at L2 + a new `/negotiations/new` UI route with multi-dimensional intent input** in a single ~38h push so that the May 19 demo proves we have all four agents talking to each other, autonomous executive-style decision-making with visible reasoning, and a clear `.env`-toggleable upgrade path from today's BASIC1 product to the ADVANCED4 enterprise tier.

### Why this is the right line item right now

- Demoing just one sub-agent (credit) doesn't prove the enterprise point. A sharp VC asks "where's the rest?" and the demo deflates.
- The funded comps (Arkestro $36M, Pactum, Lio $30M, Oro $100M) all serve the buyer side. WEDGE1 is the supplier-side mirror — same caliber of reasoning, untouched market.
- The audit-grade output (sourced provenance per input, LLM reasoning verbatim, defensive degradation when data missing) is the structural answer to the IBM accountability gap, Liberis "no validated model" finding, and Xia 2024's empirical result that LLM negotiators leak money without constraint enforcement.
- The single env var swap (`NEGOTIATION_MODE=BASIC1` → `ADVANCED2`) is the SaaS pricing-tier story made literal. Same code, env-var-flippable, demonstrably different audit per tier.

### Three non-negotiable guarantees

**Guarantee A — `start negotiation 300` keeps working.** The legacy CLI command produces byte-identical audit output throughout WEDGE1 development. New multi-dimensional command form is additive — `start negotiation --product X --qty N --buyer-budget $ --buyer-style S --buyer-deadline D`. Parser detects which form was used. A regression test enforces byte-identical legacy output and runs in CI. **If that test fails, WEDGE1 is not shipped.**

**Guarantee B — Existing UI is untouched.** Current dashboard (`/deal-quality`, `/settings`, all iters 3/5/6/7) ships unchanged. WEDGE1 adds one new route, `/negotiations/new`, with its own component tree. Nav bar gets one new link. No existing component is modified.

**Guarantee C — Message ordering is canonical across both audits.** Every sealed message carries a monotonic envelope counter per (sender, receiver) pair (iter-2). WEDGE1 surfaces this counter into the audit `logs[]` array via new optional fields `envelopeCounter` + `envelopeHash`. A regression test asserts that BUYER's and SELLER's logs, after filtering to sealed events and sorting by `(direction, envelopeCounter)`, produce byte-identical sequences. Round labels can still differ by convention (ACCEPT round numbering); envelope-counter sequence cannot.

### Scope summary (~38 hours, fits Sun PM + Mon + Tue AM)

| Block | Hours |
|---|---|
| Tier framework: `BASIC1`, `ADVANCED1`, `ADVANCED2` + validator + audit `negotiationMode` block | 3h |
| `Provider` abstraction (`CreditProvider`, `InventoryProvider`, `LogisticsProvider` interfaces) | 1h |
| 4 sub-agents wired (Treasury existing; Inventory + Logistics demo-only; Credit composite GLEIF live + EDGAR demo) | 4h |
| `GleifEntityClient` live HTTP integration | 2h |
| `ConsultationRouter` with 3 rules + dispatcher + dedup | 2h |
| Tactics engine + L2 LLM-as-executive (effective floor, δ, NBS, α-weighted utility, math-band override at L0–L1, hard-clamp + sanity-warn + defensive-override at L2+) | 7h |
| Audit JSON `consultations[]` + `tacticsTrace` + `roundOutcome` + `zopaAnalysis` blocks | 2h |
| **Message-ordering audit invariant (Guarantee C):** `envelopeCounter` + `envelopeHash` on AuditLogEntry, capture at seal/verify, regression test | 1h |
| PDF Section 9 (renders all 4 sub-agents + tactics chain + round outcomes + LLM reasoning verbatim) | 3h |
| Defensive branches (one per sub-agent: credit-down → COD; logistics-down → no SLA; inventory-down → no qty commit) | 2h |
| Handcrafted-to-spec DEMO-DATA fixtures (2 inventory, 2 logistics, 1 EDGAR, 1 OpenCorporates, 1 Companies House) with `__source.relatedStandards[]` | 3h |
| **Legacy CLI dual-parser + adapter + byte-identical regression test (Guarantee A)** | 1.5h |
| **New `/negotiations/new` UI route (Guarantee B): `OpenForm`, `RoundTimeline`, `RoundCard`, nav-link add** | 6h |
| Consultation drill-down side panel (click sub-agent badge → see provenance + raw JSON) | 1.5h |
| `/settings` page extension: tier card + capability grid + grayed v1.1/v1.2 tiers | 1h |
| Demo script + 3 dry-runs | 2h |
| iter-15 WhatsApp test buffer | 4h |
| **TOTAL** | **~39h** |

**Implementation order rule:** the legacy adapter + regression test (1.5h) lands at the *start* of WEDGE1 coding, not the end. Every subsequent commit is verified against the byte-identical baseline.

### Live API anchor

**One live API call lands during the Tuesday demo: GLEIF inside the Credit sub-agent.** No auth needed, stable for 5+ years, can't fail badly. Everything else is handcrafted-to-spec fixtures with `__source.kind: "handcrafted-to-spec"` provenance pointing at the official API spec URL. The audit + PDF show this distinction transparently.

### The new human input surface

WEDGE1 introduces minimal human input. The 6-field open-negotiation form replaces today's single-number `start negotiation X`:

```
Product:        FAB-COTTON-180GSM
Quantity:       50,000 units
Max budget:     ₹400 per unit
Buyer style:    aggressive
Required by:    2026-06-15
[Open negotiation]
```

The human declares intent. Agents reason and counter across all 4 dimensions (price, term, date, qty). Every sub-agent input is sourced. Every LLM reasoning paragraph is preserved verbatim in audit.

The legacy `start negotiation 300` command continues to work and produces the same single-dimensional output today's tests expect.

### Demo script (6 minutes, 3 scenes + closing)

| Scene | What viewer sees | Configuration |
|---|---|---|
| 1 (60s) | Existing dashboard. Legacy `start negotiation 300` from CLI. Unchanged output. | `NEGOTIATION_MODE=BASIC1` |
| 2 (3 min) | New "Open Negotiation" link → 6-field form → live round-by-round timeline → all 4 sub-agents consulted → click on Credit badge → drill-down shows live GLEIF response + handcrafted EDGAR with provenance | `NEGOTIATION_MODE=ADVANCED2` |
| 3 (90s) | Same form again, EDGAR fixture in error mode → defensive branch fires → counter forces COD, LLM reasoning explains the policy | Same as Scene 2 with simulated outage |
| Closing (60s) | `/settings` page with all 5 tiers, ADV3/ADV4 grayed with sized tooltips. Slide on supplier-side vs. funded-buyer-side comps. | — |

See `AGENTIC-PROCUREMENT-ARCHITECTURE.md` §7 for the full WEDGE1 scope spec.

### Cut points if running over budget (in priority order)

1. Drop Gesture 4 (simulate-outage button) → -0.5h. Defensive-branch code still ships; just not interactively demoed.
2. Drop side-by-side tier launcher → -0.5h. Run tiers sequentially in 3 browser tabs manually.
3. Reduce drill-down to "View raw JSON" link → -1h. Loses side-panel polish; data is still there.
4. Drop opponent-δ inference, hardcode = 0.85 → -1h.
5. Drop 2 of the 3 routing rules → -0.5h. Keep only `pre-quote-baseline`.

Total available cuts: ~3.5h. Hard floor: ~34.5h.

**Never cut:** Guarantee A (legacy command), Guarantee B (UI isolation), all 4 sub-agents wired, GLEIF live, defensive branches in code, audit PDF Section 9, regression test.

---

## ⏳ Pending — Phase 2 backlog (post-WEDGE1)

Sorted by week. Every item designed in the chat sessions of May 2026; see `AGENTIC-PROCUREMENT-ARCHITECTURE.md` §7.2 for full sizing rationale.

### Week 1 (Memorial Day week, ~22h)
| # | Iteration | Hours |
|---|---|---|
| W1.1 | Live ERPNext Docker setup + capture script + INVENTORY_MODE=real swap | 4h |
| W1.2 | Live SEC EDGAR integration (User-Agent header, rate-limit handling) | 2h |
| W1.3 | Live OpenCorporates + API key onboarding | 2h |
| W1.4 | Live Companies House + Basic auth integration | 2h |
| W1.5 | Live World Bank country indicators (replaces hardcoded country-band table) | 2h |
| 7.5 | Email notifications (CFO inbox + daily digest) — was pre-WEDGE1 buffer | 3h |
| 7.6 | PWA mobile + Solution brief — was pre-WEDGE1 buffer | 2.5h |
| W1.6 | Demo capture clip for investor follow-up — ERPNext live recording | 4h |

### Week 2 (~14h)
| # | Iteration | Hours |
|---|---|---|
| W2.1 | Live Maersk DCSA T&T 2.2 sandbox integration | 3h |
| W2.2 | ShipEngine sandbox integration | 2h |
| W2.3 | 17track free-tier integration | 2h |
| W2.4 | Full routing — 6 rules instead of 3 | 2h |
| W2.5 | ACTUS-PD cashflow simulation wrapper (uses existing `shared/actus-client.ts`) | 5h |

### Week 3 (~14h) — Unlocks ADVANCED3 tier
| # | Iteration | Hours |
|---|---|---|
| W3.1 | TKI 5-style framework (AGGR / ASSERT / BAL / COOP / WIN-WIN) + per-style parameter packs | 3h |
| W3.2 | Opponent style inference + perceived-opp belief tracking | 2h |
| W3.3 | Asymmetric NBS with δ-weighting | 2h |
| W3.4 | Multi-signal δ adjustment (credit confidence, ATP slack, freight trend, round count) | 3h |
| W3.5 | Autonomy levels L0–L5 + commit gates | 3h |
| W3.6 | Tier ADV3 unlock + UI tooltip update | 1h |

### Week 4 (~12h) — A/B research framework
| # | Iteration | Hours |
|---|---|---|
| W4.1 | Per-counterparty α/δ profiles (`config/counterparty-tactics.yaml` + checksum + validation) | 4h |
| W4.2 | Iter 13 A/B testing framework (scenario fixtures, statistical engine using simple-statistics, Mann-Whitney U) | 8h |

### Week 5 (~18h) — PROTOCOL1 + AUDIT1 (distribution)
| # | Iteration | Hours |
|---|---|---|
| W5.1 | PROTOCOL1.a: ACP envelope emit (Stripe/OpenAI Agentic Commerce Protocol) | 4h |
| W5.2 | PROTOCOL1.b: AP2 mandate verify (Google Agent Payments Protocol) | 4h |
| W5.3 | PROTOCOL1.c: x402 stablecoin settlement handler (Coinbase / Linux Foundation) | 4h |
| W5.4 | AUDIT1: EXIM ECI audit pack variant | 3h |
| W5.5 | AUDIT1: Factoring / asset-backed lender audit pack variants | 3h |

### Week 6 (~16h) — EMBED1 (SMB distribution)
| # | Iteration | Hours |
|---|---|---|
| W6.1 | EMBED1.a: QuickBooks webhook + OAuth integration | 6h |
| W6.2 | EMBED1.b: BILL.com OAuth integration | 5h |
| W6.3 | EMBED1.c: Ramp Connect integration | 5h |

### Week 7 (~11h) — Identity moat + LEARNING1
| # | Iteration | Hours |
|---|---|---|
| 9 | `VleiProvider` wired through `CredentialProvider` abstraction | 3h |
| W7.1 | LEARNING1: per-counterparty profile updater (writes to counterparty-tactics.yaml from deal history) | 8h |

### Week 8–9 (~20h) — ADVANCED4 unlock
| # | Iteration | Hours |
|---|---|---|
| 14 | `VleiSignifySigner` (real KERI signing end-to-end) | 8h |
| W8.1 | Custom commodity PD models (per SITC / HS-code class) | 6h |
| W8.2 | ADVANCED4 tier unlock + UI tooltip update | 1h |
| W8.3 | Multi-tenant config isolation (one WABA per deployment → multi-tenant) | 5h |

### Weeks 10+ (~20h+) — Long-term research moat
| # | Iteration | Hours |
|---|---|---|
| 16 | SMS critical alerts (Twilio) — reuses iter 15 abstraction | 2h |
| 17 | Inbound WhatsApp webhook (2-way) — extends iter 15 with `InboundChannel` seam | 4h |
| LEARNING2 | Per-style policy refinement (across deals where seller was in BALANCED, learn best concession schedule) | 8h |
| LEARNING3 | Opt-in global aggregator with k-anonymity + ε-differential privacy | 8h+ |

### Total post-WEDGE1 backlog: ~147 hours

At a steady 30h/week pace: **~5 weeks to ADVANCED3, ~8 weeks to ADVANCED4, ~10 weeks to LEARNING-tier features.** Realistic Series-A milestone: end of June / early July 2026.

---

## ⚠️ Known issue (not blocking)

`src/cli.ts` shows only the first SSE event after `start negotiation`; subsequent rounds don't update in CLI. Agents themselves complete the negotiation correctly (visible in seller/buyer terminals + `src/escalations/`). Pre-existing bug — iteration 3+ replaces CLI with web dashboard, so CLI is being deprecated. **WEDGE1 does NOT fix this** — `start negotiation 300` legacy command still produces this same not-blocking behavior, and the regression test asserts that.

---

## 🚫 Out of scope — explicitly not building

- Buyer-side procurement automation (Arkestro / Pactum / Lio territory — they're funded incumbents, we play the supplier side)
- General-purpose agent platform (a16z thesis says vertical depth wins)
- Custom LLM training (foundation models are commoditizing — we layer on top)
- Anything that would require us to make claims we can't defend from `RESEARCH-CITATIONS.md`

---

## File index

| File | Purpose |
|---|---|
| `AGENTIC-PROCUREMENT-ARCHITECTURE.md` | Master design — read first (v1.1) |
| `MAY19-RELEASE.md` | THIS FILE — iteration status (v1.1) |
| `RESEARCH-CITATIONS.md` | Source bibliography |
| `ITER-8-10-11-12-13-DETAILED-DESIGN.md` | Superseded; see master design |
