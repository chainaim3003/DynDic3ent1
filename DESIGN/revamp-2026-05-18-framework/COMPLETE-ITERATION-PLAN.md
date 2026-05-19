# Iteration Plan — Complete Status + Forward Plan

**Path:** `DynDic3ent1/DESIGN/revamp-2026-05-18-framework/COMPLETE-ITERATION-PLAN.md`
**Created:** 2026-05-18
**Status:** Draft — awaiting your sign-off before execution
**Grounded against disk:** all "DONE" claims verified against actual files + this session's work.

This document supersedes the partial plans in earlier chats and the `ITERATION-PLAN-M2-DELTA.md`
draft. It captures the COMPLETE state: what's done, what was added in our recent
sessions, what's left to make the demo solid, and what's on the longer roadmap.

---

## Part 1 — What is ACTUALLY done (verified from disk on 2026-05-18)

These items have code on disk AND have been exercised end-to-end at least once.

### Pre-WEDGE1 (iterations 0–7 + 15, foundation)

| # | Iteration | Status | Where it lives |
|---|---|---|---|
| 0 | Baseline + Gemini provider swap | ✅ DONE | `shared/llm-client.ts` |
| 0.5 | Gemini robustness (backoff, JSON parsing, fallback labels) | ✅ DONE | same |
| 1 | CredentialProvider + onboarding API + GLEIF risk check | ✅ DONE | `shared/vlei-verification-client.ts`, `api/onboarding-server.ts` |
| 2 | MessageSigner + hash envelope | ✅ DONE | envelope-counter mechanism visible in agent logs |
| 3 | Outcome-quality metrics + DealQualityCard | ✅ DONE | `shared/outcome-quality.ts`, UI page |
| 4 | Constraint-budget recording + Decision Trail viewer | ✅ DONE | `negotiation-types.ts:DecisionTrailEntry`, UI page |
| 5 | Fixture replay + baseline summary | ✅ DONE | `scripts/replay-fixtures.ts` |
| 6 | Mode-matrix runner + UI mode toggle | ✅ DONE | `scripts/run-mode-matrix.ts` |
| 7 | Signed PDF audit + dashboard list view | ✅ DONE | `shared/audit-pdf.ts`, `shared/audit-writer.ts` |
| 15 | WhatsApp notifications via Meta Cloud API | ✅ DONE | notification channels in agent code |

### WEDGE1 (M1, M2 — tier framework + sub-agents)

| Item | Status | Verification |
|---|---|---|
| **M1 — Tier resolver** (BASIC1/ADV1/ADV2 + validator) | ✅ DONE | `shared/negotiation-mode.ts` exists; 64/64 tests passed |
| **M2-α.1 — Provider abstraction** | ✅ DONE | `shared/provider-types.ts` defines `CreditProvider`, `InventoryProvider`, `LogisticsProvider`, `TreasuryProvider` interfaces |
| **M2-α.2 — Providers + fixtures (demo mode)** | ✅ DONE | All 4 providers in `shared/*.ts`; DEMO-DATA fixtures present; 114/114 tests passed |
| **M2-β.1 — ConsultationRouter** | ✅ DONE | `shared/consultation-router.ts`; verifying it actually does tier-keyed dispatch (not adaptive routing yet) |
| **M2-β.1 — Tactics engine (math aggregator)** | ✅ DONE | `shared/tactics-engine.ts` — pure math: effectiveFloor, NBS, α-utility, δ-discount |
| **M2-β.2 — Treasury fixture** | ✅ DONE | `DEMO-DATA/treasury/jupiter-treasury-pricepoint-370-net30.json` |
| **M2-β.3 — L2 executive** | ✅ DONE | `shared/l2-executive.ts` — calls LLM with consultation bundle, applies 3-layer guardrails |
| **M2-β.4 — L2 wire-in** | ✅ DONE | `shared/l2-wire.ts` + seller code calls `runL2Path()` when tier permits |
| **M2-γ.1 — Sub-agents as standalone HTTP processes** | ✅ DONE *(this session)* | 4 new files: `agents/credit-agent/index.ts` (port 7071), `agents/inventory-agent/index.ts` (7072), `agents/logistics-agent/index.ts` (7073). Treasury already standalone (7070). |
| **M2-γ.2 — Provider HTTP adapters (`*_MODE=real`)** | ✅ DONE *(this session)* | `shared/credit-provider.ts`, `inventory-provider.ts`, `logistics-provider.ts` extended with `consultViaHttp()` |
| **M2-γ.3 — Launcher scripts** | ✅ DONE *(this session)* | `run-all-agents.ps1` + `.sh`, `stop-all-agents.ps1` + `.sh`, `check-agents.ps1` + `.sh` |
| **M2-γ.4 — Seller .env flipped to ADV2 + *_MODE=real** | ✅ DONE *(this session)* | `agents/seller-agent/.env` updated; 4 sub-agent windows light up during a negotiation |
| **M2-γ.5 — Multi-dim CLI form wired** | ✅ DONE *(this session)* | `shared/cli-parser.ts` validates flagged form; `buyer-agent/index.ts` startNegotiation accepts multi-dim object; OfferData carries productCode + buyerStyle; seller's runL2Path uses state.productCode |
| **M2-γ.6 — Buyer audit reflects state.maxBudget, state.targetQuantity** | ✅ DONE *(this session)* | `buyer-agent/index.ts` audit-emission paths updated; constraintDisclosure uses state.maxBudget |
| **M2-γ.7 — Demonstrated end-to-end** | ✅ DONE *(this session)* | You ran two multi-dim negotiations. All 4 sub-agent windows printed consultation banners. Treasury rejected, L2 math override fired, defensive action logged. Audit JSONs written. |

### Smoke-tested in this session

- Legacy form `start negotiation 300` runs end-to-end at ADV2
- Multi-dim form `start negotiation --product COTTON-180GSM --qty 50000 --buyer-budget 400 --buyer-style aggressive --buyer-deadline 2026-06-15` runs end-to-end at ADV2
- All 4 sub-agent windows print live consultation logs
- Audit JSONs written to `src/escalations/`
- Stop and check scripts work after fixing the em-dash encoding issue

### What was completed before WEDGE1 that's still relevant

- 6 working agent processes
- Existing UI on port 5173 with routes `/`, `/agents`, `/contracts`, `/risk`, `/deal-quality`, `/settings`
- Existing CLI on `npm run a2a:cli`
- Notification system (WhatsApp Meta Cloud) configured

---

## Part 2 — Where we are vs. the original ADV1/ADV2/ADV3/ADV4 plan

| Tier | Plan (per `current/AGENTIC-PROCUREMENT-ARCHITECTURE.md` v1.2) | Reality on disk |
|---|---|---|
| **BASIC1** | SKU floor + treasury + LLM via seller agent | ✅ Code path live. Triggered when capability matrix excludes L2 (today: ADV1, ADV2 both fall into the L2-or-not branch; only true BASIC1 if env explicitly says so). |
| **ADV1** | + inventory + logistics sub-agents wired | ✅ Sub-agents wired; capabilities flag set; but in practice ADV1 today consults all 4 via router (no adaptive routing yet). |
| **ADV2** | + credit + tactics engine + L2 executive + 3-layer guardrails | ✅ All wired. Smoke-tested. **This is what runs today when seller `.env` says `NEGOTIATION_MODE=ADVANCED2`.** |
| **ADV3** | + opponent style inference + autonomy levels + per-deal style routing | ❌ NOT DONE. `validateTier()` rejects ADV3 with "not yet supported" error. Style env var (`SELLER_STYLE`) and buyer style (`--buyer-style`) captured into state but **not read by any decision code**. Autonomy levels not implemented at all. |
| **ADV4** | + per-counterparty α/δ profiles + custom commodity PD + ACTUS sim | ❌ NOT DONE. Same rejection in validator. No counterparty profile schema. No commodity PD models. ACTUS simulation exists for treasury (`shared/actus-client.ts`) but only for treasury's own cash-flow check, not for credit's PD model. |

### So: **ADV2 is complete. ADV3 and ADV4 are entirely future work.**

The design-doc roadmap (Week 1 through Week 10+) lays out ~147h of post-WEDGE1
work. We have done **none** of that yet. Per chat discussions, that work was
deferred until after the demo is solid.

---

## Part 3 — The new decisions from our recent chat sessions

These are design decisions we made in this session and the previous one. They
exist as conversation outcomes — **none of them are in code yet**.

| # | Decision | Status | Code impact |
|---|---|---|---|
| C1 | Sub-agents as standalone HTTP processes (not in-process providers) | ✅ Implemented this session | 6 new files + 3 modified providers |
| C2 | Multi-dim CLI form (`start negotiation --product ... --qty ...`) | ✅ Implemented this session | cli-parser, buyer-agent, seller-agent, negotiation-types |
| C3 | Seller `.env` flipped to ADV2 + real-mode | ✅ Implemented this session | seller `.env` |
| C4 | Vocabulary cleanup: `NEGOTIATION_MODE` → `SELLER_RESPONSE_MODE`, tier names → function names, `tactics-engine` → `advisor-math-aggregator` | ❌ Designed only (in `FRAMEWORK-V2.md` §5); code unchanged |
| C5 | Clean cut for renames (no aliases, no fallback) | ❌ Designed only |
| C6 | "think-cycle" terminology lock | ❌ Designed only; will land with C4 |
| C7 | Framework's 5 axes (reasoning depth, guardrails, delegation, cross-org, evaluation+learning) | ❌ Designed only in `FRAMEWORK-V2.md` §3 |
| C8 | Delegation chain (every decision pinned to role authority) | ❌ Designed only in `FRAMEWORK-V2.md` §3.3 + §8 + §10.1 — needs `delegationChain[]` audit block |
| C9 | Per-round LLM call trace (`thinkCycleTrace[]` audit block) | ❌ Designed only |
| C10 | Per-deal cost+outcome+risk-avoided audit block (`frameworkMetrics`) | ❌ Designed only |
| C11 | Simulation harness for measuring framework value across pressure settings | ❌ Designed only |
| C12 | 6 benchmark scenarios reframed as ROI proofs (not demo scripts) | ❌ Designed only |
| C13 | Per-deal tier selection (heuristic now, data-driven post-harness) | ❌ Designed only |

So the gap between "what we discussed" and "what's in code" is **10 items (C4 through C13)**.

---

## Part 4 — The forward plan, in 5 waves

Each wave is independently shippable. After each wave, the demo still works.
Each wave has a clear test gate.

### Wave M2-δ — Rename cutover (3-4 hours, clean cut)

**What:** C4, C5, C6 in code. Old names removed everywhere. New names everywhere.

**Why first:** It's the only wave that touches the source-of-truth files
(`negotiation-mode.ts`, `negotiation-types.ts`). Doing it first means every
subsequent wave can use the new vocabulary in its own code without churn.

**Files modified (~10 source, ~6 .env, ~5 tests, ~7 docs — ~28 files total):**
- Group A: `shared/negotiation-mode.ts`, `shared/negotiation-types.ts`
- Group B: `consultation-router.ts`, `l2-wire.ts`, `l2-executive.ts`, `tactics-engine.ts` → `advisor-math-aggregator.ts`, 4 providers
- Group C: All 6 agent `index.ts` files (mainly banner text + imports)
- Group D: 3 `.env` files (seller, buyer, treasury — others don't have `NEGOTIATION_MODE`), 4-5 test scripts
- Group E: Smoke tests
- Group F: Doc updates (parallel)

**Test gate:** `start negotiation 300` and multi-dim form both work; all `scripts/test-*.ts` pass.

### Wave M2-ε — Audit instrumentation (6-8 hours; this is "Wave A" from earlier)

**What:** C8, C9, C10 in code. Three new audit blocks.

**Why second:** It's behavior-additive. No existing code path changes. New
audit data is captured during the same negotiation flow.

**Files modified:**
- `shared/negotiation-types.ts` — add `DelegationChainEntry`, `ThinkCycleTrace`, `FrameworkMetrics` types
- `shared/llm-client.ts` — already returns cost info; bubble it up
- `shared/l2-wire.ts` — emit `thinkCycleTrace` entries per round
- `shared/l2-executive.ts` — emit `frameworkMetrics.riskAvoided` info when defensive actions fire
- All 5 sub-agents (`treasury`, `credit`, `inventory`, `logistics`, plus seller for orchestrator) — emit `DelegationChainEntry` with role + authority + signature
- `shared/audit-writer.ts` — write the 3 new blocks into audit JSON
- Tests for new audit fields

**Test gate:** Run a multi-dim negotiation. Audit JSON contains all 3 new blocks.
`delegationChain[]` shows every decision with role attribution.
`thinkCycleTrace[]` shows N entries for N rounds with the Gemini prompt + response + audit metadata.
`frameworkMetrics` shows real cost in USD, real outcome, real defensive-action count.

### Wave M2-ζ — Simulation harness (12-16 hours; this is "Wave B")

**What:** C11, C12 in code. The `HARNESS/` tree.

**Why third:** Depends on M2-ε audit instrumentation to produce metrics.

**New directory:** `DynDic3ent1/HARNESS/`
- `deal-generators/deal-flow.ts` — synthesize deals matching a profile
- `deal-generators/profiles/*.json` — named profiles (smb-exporter-q1, etc.)
- `counterparty-models/buyer-{aggressive,balanced,cooperative}.ts` — simulated buyers
- `counterparty-models/buyer-from-trace.ts` — replay a real recorded buyer
- `runners/single-deal.ts`, `deal-flow.ts`, `matrix.ts`
- `measurements/cost-extractor.ts`, `outcome-extractor.ts`, `risk-extractor.ts`, `delegation-trace-extractor.ts`
- `reports/pnl-report.ts`, `tier-comparison.ts`, `delegation-audit.ts`
- `scenarios/*.json` — the 6 benchmark scenarios
- `benchmarks/basic-vs-l1-vs-l2.ts`, `l4-with-history.ts`, etc.

**Test gate:** Run `npx tsx HARNESS/benchmarks/basic-vs-l1-vs-l2.ts`. Get a P&L table.
Numbers are *real* (from actual audit JSONs), not made up. Each scenario
shows different outcomes across tiers.

### Wave M2-η — ADV3 prep (Style framework + autonomy levels)

This is **Weeks 3** of the original `MAY19-RELEASE.md` plan, ~14 hours.

**What:** Code the design that's been on paper since v1.0.

| Sub-iteration | Hours |
|---|---|
| W3.1 — TKI 5-style framework + per-style parameter packs | 3h |
| W3.2 — Opponent style inference + perceived-opp belief tracking | 2h |
| W3.3 — Asymmetric NBS with δ-weighting | 2h |
| W3.4 — Multi-signal δ adjustment | 3h |
| W3.5 — Autonomy levels L0–L5 + commit gates | 3h |
| W3.6 — Tier ADV3 (`L3_STYLE_AND_AUTONOMY`) unlock + UI tooltip | 1h |

**Files affected:**
- New: `shared/style-framework.ts` (TKI 5-style parameter packs)
- New: `shared/opponent-inference.ts` (style inference from observed behavior)
- New: `shared/autonomy-gate.ts` (commit gate per autonomy level)
- Modified: `shared/l2-executive.ts` (consume style + autonomy)
- Modified: `shared/advisor-math-aggregator.ts` (asymmetric NBS, multi-signal δ)
- Modified: `shared/negotiation-mode.ts` (allow `L3_STYLE_AND_AUTONOMY` in validator)
- Modified: all sub-agents (emit autonomy-aware delegation records)

**Test gate:** Run a negotiation at L3. Audit shows: opponent style inferred,
self-style applied, asymmetric NBS used, autonomy gate fired (or didn't),
commit signed by appropriate authority.

### Wave M2-θ — ADV4 (Per-counterparty profiles + commodity PD)

Weeks 8-9 of the original plan, ~14 hours.

**What:** Counterparty memory + custom commodity PD models.

| Sub-iteration | Hours |
|---|---|
| W8.1 — Custom commodity PD models (per SITC/HS-code class) | 6h |
| W8.2 — ADVANCED4 tier unlock + UI tooltip | 1h |
| W4.1 — Per-counterparty α/δ profiles (`config/counterparty-tactics.yaml`) | 4h |
| W7.1 — LEARNING1: per-counterparty profile updater | 8h |

**Files affected:**
- New: `shared/counterparty-profile.ts` (load/save per-LEI profiles)
- New: `shared/commodity-pd.ts` (HS-code-based PD models)
- New: `config/counterparty-tactics.yaml` (per-counterparty α/δ defaults)
- Modified: `shared/credit-provider.ts` (uses commodity PD, falls back to country if missing)
- Modified: `shared/l2-executive.ts` (consume counterparty profile)
- Modified: `shared/negotiation-mode.ts` (allow `L4_LEARNED_PROFILES_AND_PD`)
- Modified: audit writers (record which profile was used)

**Test gate:** Run a negotiation against a counterparty with a known profile.
Audit shows the profile was loaded and influenced reasoning. Run against a
counterparty with no profile — defensive substitution fires (no profile to
use = conservative default).

---

## Part 5 — The dependency graph

```
M2-δ (renames) ─────────────┬───→ M2-η (ADV3)
                            │
                            ↓
                          M2-ε (audit instrumentation) ───→ M2-ζ (harness) ──→ M2-θ (ADV4)
                                                                                  │
                                                                                  └─→ LEARNING1
```

Why this order:
- M2-δ first: cleans up names before adding more
- M2-ε second: gives M2-ζ harness real metrics to work with
- M2-ζ third: gives M2-η ADV3 a way to *prove* style framework improves outcomes
- M2-η fourth: unlocks counterparty pattern recognition
- M2-θ fifth: unlocks per-counterparty memory + custom PD

Each wave has a clear demo and a clear test gate. None of them risks the
working stack — they all build forward.

---

## Part 6 — What I propose we do NEXT

Given:
- Demo works today (sub-agents lit up; multi-dim form runs)
- 10 design decisions exist on paper but not in code

I propose **M2-δ first** (~3-4 hours). Rationale:

1. **Cheap insurance.** Once renames are done, every subsequent wave starts from clean vocabulary.
2. **No new behavior.** Risk to demo is bounded to mid-cutover compile errors, which are mechanical to fix.
3. **Unblocks doc work.** After M2-δ, the design docs reflect what's in code.

Then **M2-ε** (~6-8 hours). Without instrumentation, the harness can't measure
anything. Audit instrumentation is the foundation everything else stands on.

Then pause and let you decide: harness (M2-ζ) for measurement, or ADV3 (M2-η)
for feature? Different value propositions. You may want harness first to prove
the L1/L2 ROI we discussed; or you may want ADV3 first to have a richer demo
story.

---

## Part 7 — What I want you to sign off on before I touch code

For Wave M2-δ specifically (the only thing I'd execute next):

1. **Rename table (FRAMEWORK-V2.md §5)** — agreed?
2. **Clean cut, no aliases** — confirmed?
3. **File list above in Part 4 / Wave M2-δ** — anything to add or skip?
4. **Execution order** — Group A → B → C → D → E → F with checkpoint after each?
5. **What to do AFTER M2-δ** — M2-ε straight away, or pause for explicit go-ahead?

Answer those 5 and I execute M2-δ. **Until then, no code changes.**

---

## Part 8 — What's deferred but not forgotten

These items from `MAY19-RELEASE.md` are sized and ready when you want them.
Listed here so they don't fall off the radar.

### Week 1 backlog (~22h)
- W1.1 Live ERPNext setup
- W1.2 Live SEC EDGAR
- W1.3 Live OpenCorporates
- W1.4 Live Companies House
- W1.5 Live World Bank
- Iter 7.5 Email notifications
- Iter 7.6 PWA mobile + Solution brief
- W1.6 Demo capture clip

### Week 2 backlog (~14h)
- W2.1 Live Maersk DCSA T&T 2.2
- W2.2 ShipEngine
- W2.3 17track
- W2.4 Full routing (6 rules)
- W2.5 ACTUS-PD wrapper

### Week 5 backlog (~18h) — PROTOCOL1 + AUDIT1
- ACP envelope emit
- AP2 mandate verify
- x402 settlement
- EXIM ECI audit pack
- Factoring/lender audit packs

### Week 6 backlog (~16h) — EMBED1 (distribution)
- QuickBooks
- BILL.com
- Ramp

### Week 7-9 backlog (~33h) — identity moat + LEARNING1 + ADV4
- iter-9 VleiProvider
- iter-14 VleiSignifySigner (real KERI)
- LEARNING1 per-counterparty profile updater
- LEARNING2 per-style policy refinement
- LEARNING3 opt-in aggregator

### Total deferred backlog: ~150 hours

At a steady 30h/week pace: **~5 weeks to reach the ADV3 unlock; ~8 weeks to
ADV4; ~10+ weeks to LEARNING-tier**. Realistic Series-A milestone: late June
/ early July 2026.

---

## Appendix — Honest assessment

What's working:
- Foundation (iters 0-7+15) is solid
- WEDGE1 M1, M2-α, M2-β, M2-γ all landed
- ADV2 demo end-to-end works
- 4 sub-agents are real HTTP processes (per this session's work)
- Multi-dim CLI works

What's not yet started:
- ADV3 and ADV4 — all 22h+ of style framework + autonomy + counterparty profiles + commodity PD
- Audit instrumentation that the new design calls for (`delegationChain`, `thinkCycleTrace`, `frameworkMetrics`)
- Simulation harness
- Renames per FRAMEWORK-V2.md
- Live external API integrations (ERPNext, EDGAR, OpenCorporates, etc.)

What's deferred deliberately:
- WhatsApp deeper integration
- Real vLEI (iter-9, iter-14)
- LEARNING1/2/3
- PROTOCOL1 (ACP/AP2/x402)
- EMBED1 (QuickBooks/BILL.com/Ramp)

This honest picture matches the discussions we've had. No surprises. No
hidden completed work. No tasks claimed-done that aren't.
