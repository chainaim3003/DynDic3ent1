# WEDGE1 — Milestone Backlog (M2 → M4)

**Doc version:** v1.3 (M1 + M2-α.1 + M2-α.2 + M2-α.3 closed green; M2-β next)
**Codebase root:** _(local clone of DynDic3ent1)_
**Last updated:** 2026-05-17 (after M2-α.3 close)
**Purpose:** Persistent line-item tracker so deferred work doesn't get lost.
            Updated at the close of each milestone.

---

## Status legend
- ☐  pending
- ◐  in progress
- ✓  done
- ⊘  intentionally dropped (reason noted)

---

## M1 — closed GREEN (2026-05-17)

Backend gates: T1.5 (17/17), T3 (20/20), T6 (64/64 NEW), T1 manual deal at ₹370,
T2 envelope ordering 5/5 events match. UI: TierFrameworkCard on /settings
renders BASIC1 active with grayed ADV3/ADV4 rows. Audit JSON carries
`negotiationMode` block at top level.

---

## M2-α.1 — closed GREEN (2026-05-17)

The three "deferred from M1" pre-flight items landed. No agent runtime
behavior changed; the seller now fails fast on a bad `NEGOTIATION_MODE`,
the provider-interface typing contract is in place, and 3 demo fixtures
with `__source` provenance are ready for sub-agents to consume.

| Substep | Status | What landed | Where |
|---------|--------|------------|-------|
| 1 — Seller-agent `validateTier()` + banner | ✓ | 3 surgical inserts mirroring the buyer-agent M1 pattern. | `A2A/js/src/agents/seller-agent/index.ts` |
| 2 — Provider interfaces | ✓ | `Inventory`/`Logistics`/`Credit` provider interfaces + `ConsultationMetadata`/`ConsultationRecord<T>`/`DefensiveAction`/`DefensiveActionRecord`. | `A2A/js/src/shared/provider-types.ts` |
| 3 — DEMO-DATA fixtures | ✓ | 3 JSON files with `__source` provenance + `_realEquivalent` + `_demoNarrative`. | `A2A/js/DEMO-DATA/{inventory,logistics,credit}/*.json` |

**Deviation from original plan:** provider types placed in `src/shared/provider-types.ts` instead of the originally-planned `src/providers/types.ts` to avoid a mkdir round-trip. Sub-agents import from `../../shared/provider-types.js`.

---

## M2-α.2 — closed GREEN (2026-05-17)

Three sub-agent providers (Inventory, Logistics, Credit) implemented as
fixture-readers in demo mode + clean failure stubs in real mode. Singleton
factories. Zero changes to existing agent code.

Verified by `npx tsx scripts/test-fixtures-parse.ts` — 95/95 assertions
green. T1.5 (17/17), T3 (20/20), T6 (64/64) all still green.

| Substep | Status | What landed | Where |
|---------|--------|------------|-------|
| Inventory provider | ✓ | Demo-mode fixture-reader + real-mode stub. Path-discipline asserted in test. | `A2A/js/src/shared/inventory-provider.ts` |
| Logistics provider | ✓ | Demo-mode fixture-reader + real-mode stub. Carrier array sanity check. | `A2A/js/src/shared/logistics-provider.ts` |
| Credit provider    | ✓ | Demo-mode fixture-reader + real-mode stub. Numeric-field sanity check on pd1y/lgd/financialHealthScore. Provider-level comment flags the post-WEDGE1 CounterPartyRisk rename. | `A2A/js/src/shared/credit-provider.ts` |
| T-fix test          | ✓ | 95 assertions across 4 sections; path-portability assertions embedded. | `A2A/js/scripts/test-fixtures-parse.ts` |

**Deviation from original plan:** providers placed in `src/shared/` alongside `provider-types.ts` instead of a dedicated `src/agents/sub-agents/` directory, to avoid a mkdir round-trip. If a cleaner structure is preferred post-WEDGE1, only import paths in M2-β consumers need to change.

---

## M2-α.3 — closed GREEN (2026-05-17)

Treasury sub-agent extended via adapter pattern. Critically, the existing
treasury-agent process (port 7070, /consult endpoint) is **unchanged** — so
the existing seller-agent's treasury-consultation path that T1 depends on
still works byte-for-byte identically. The new adapter (`treasury-provider.ts`)
wraps the existing HTTP call and re-shapes the response into the
`ConsultationRecord<TreasuryConsultation>` shape that M2-β's
ConsultationRouter expects.

| Substep | Status | What landed | Where |
|---------|--------|------------|-------|
| Treasury types | ✓ | `TreasuryProvider`, `TreasuryConsultation`, `TreasuryConsultationInput` added to provider-types.ts. Type shape mirrors the existing TreasuryResult so M2-β doesn't need a translation layer. | `A2A/js/src/shared/provider-types.ts` |
| Treasury adapter | ✓ | Singleton provider. Real mode: HTTP POST to `TREASURY_URL` (default `http://localhost:7070/consult`) with AbortController timeout. Demo mode: stubbed (lands in M2-β alongside `DEMO-DATA/treasury/` fixture). Default mode `real` (unlike the other 3 which default `demo`). Network errors and missing fields produce well-formed failed ConsultationRecord values — never throws. | `A2A/js/src/shared/treasury-provider.ts` |
| T-fix expansion | ✓ | §5/6/7 cover treasury interface, demo-mode stub, real-mode graceful degradation (via port 1 unreachable endpoint — no need for treasury to be running). | `A2A/js/scripts/test-fixtures-parse.ts` |

**Why an adapter instead of editing treasury-agent/index.ts:** the treasury agent file is 60+KB. A full-file rewrite to add ConsultationRecord emission carries non-trivial risk to T1 (which depends on the existing /consult behavior byte-for-byte). The adapter keeps the existing endpoint completely untouched and re-shapes on the consumer side. M2-β consumers call `getTreasuryProvider().consult(...)` instead of building their own HTTP request.

**Mode resolution intentionally kept separate from `resolveProviderModes()`:** treasury reads `TREASURY_MODE` directly (default `real`). Plumbing it through the tier framework would have required adding a 4th field to `ProviderModes`, updating T6's 64 assertions, and adding a 4th cell to TierFrameworkCard.tsx — high churn for a sub-agent that is always-on. Can be promoted into the tier framework post-WEDGE1 if needed.

---

## Pre-existing carry-over (NOT M1 regressions, but on the radar)

Observed while verifying M1; pre-date the WEDGE1 work. Tracking so they don't
become silent technical debt.

| Item | Severity | Pick up at | Notes |
|------|----------|-----------|-------|
| ☐ `envelopeCounter` not populated in `NegotiationLog` entries | LOW | M2-γ (rolled into audit shape work) | T2 currently passes via fallback (timestamp+direction ordering). Type already has `envelopeCounter?: number` and `envelopeHash?: string` from the Guarantee C work. Agent code needs to write these when constructing log entries so T2's strong path (by-counter ordering) becomes the verified path. Until then, T2 says ✓ but via fallback. The invariant still holds; the path is weaker. |
| ☐ Duplicate `[event] NEG-…` lines in chat UI | COSMETIC | M2 or M3 (whenever I'm touching the notification path) | Each notification renders twice in the /agents chat panes (visible in T1 walkthrough). Looks like the notify router fires both via the legacy SSE broadcaster AND the new ui-dashboard channel. Fix: dedupe by event-id in the broadcaster, OR drop one source. Doesn't affect any audit/test/data — purely visual. |

---

## Deferred from M2-α (carry forward into M2-β)

- ☐ Credit → CounterPartyRisk rename. Cosmetically more accurate (the sub-agent does counterparty default-risk, not consumer credit scoring) but threads through 7 files including T6's 64 assertions and the env var contract (`CREDIT_MODE`). Better done post-WEDGE1 demo. Note in `credit-provider.ts` flags this for the next reader.
- ☐ DEMO-DATA/treasury/ fixture. Treasury-provider's demo branch is stubbed pending the fixture file. M2-β will create the directory + fixture and unblock the demo branch.

---

## M2 — ADV2 backend complete (~11h remaining after M2-α.3)

**Goal:** With `NEGOTIATION_MODE=ADVANCED2`, every closed deal produces an
audit containing `consultations[]`, `tacticsTrace`, and `roundOutcome`. A
simulated EDGAR outage produces a defensive COD outcome.

### M2-β — Orchestration (~6h) — NEXT
- ☐ `ConsultationRouter` — decides which sub-agents to consult given tier + round phase. Wired into the buyer-agent's `makeNegotiationDecision()`.
  - At BASIC1: treasury only (already the case via existing code; router just routes through the new provider).
  - At ADV1: treasury + inventory + logistics.
  - At ADV2: treasury + inventory + logistics + credit.
- ☐ Tactics engine — effective floor, δ-discount, NBS midpoint, α-weighted utility. Consumes ConsultationRecord values.
- ☐ L2 executive — LLM-as-executive with 3 guardrails (hard boundary clamp, sanity warning, defensive override).
- ☐ DEMO-DATA/treasury/ fixture + flip TreasuryProvider demo-mode stub into a real fixture-reader (mirror Inventory/Logistics/Credit pattern).
- ☐ (optional, demo-positive) Real-mode unstub for at least one provider — probably credit/GLEIF since it's most demo-able and GLEIF is a stable public API.

### M2-γ — Audit shape + defensive branches + T7/T8 (~5h)
- ☐ `consultations[]` block in audit JSON — one entry per sub-agent call with full provenance.
- ☐ `tacticsTrace` block — round-by-round tactics-engine outputs.
- ☐ `roundOutcome` block — per-round summary (offer, response, deltas).
- ☐ Defensive branches: `defensiveAction` field when a provider fails (uses `DefensiveAction` vocab from `provider-types.ts`).
- ☐ Populate `envelopeCounter` / `envelopeHash` in `NegotiationLog` entries (lift T2 to its strong path — carry-over from M1).
- ☐ T7 — ADV2 audit shape unit test (`scripts/test-adv2-audit-shape.ts`).
- ☐ T8 — Simulated EDGAR outage → defensive COD (manual).

### M2 gate
```bash
# All prior tests still green
npx tsx scripts/test-cli-parser.ts            # T1.5
npx tsx scripts/test-tamper.ts                # T3
npx tsx scripts/test-tier-resolver.ts         # T6
npx tsx scripts/test-fixtures-parse.ts        # T-fix
npx tsx scripts/test-adv2-audit-shape.ts      # T7  (M2-γ)

# ADV2 end-to-end: audit must contain consultations + tactics + roundOutcome
NEGOTIATION_MODE=ADVANCED2 npx tsx src/agents/buyer-agent/index.ts
# Run start negotiation 300

# Defensive branch: env-flip to simulate EDGAR outage, re-run, check audit
EDGAR_PROVIDER_HEALTH=down NEGOTIATION_MODE=ADVANCED2 npx tsx src/agents/buyer-agent/index.ts
```

---

## M3 — User-visible WEDGE1 (~9h)

**Goal:** A user can open a negotiation from the UI, watch round-by-round
progress, drill into sub-agent decisions, and download a PDF audit that
includes provenance.

- ☐ `/negotiations/new` UI route — 6-field form (counterparty, product, quantity, target price, max budget, delivery date)
- ☐ Round timeline component — streams live via existing SSE
- ☐ Drill-down side panel — clicking a round shows sub-agent decisions + tactics outputs
- ☐ PDF Section 9 — provenance per sub-agent consultation + tactics chain
- ☐ Hook the form to the existing `start negotiation` flow (don't duplicate logic)
- ☐ (carry-over candidate) Dedupe `[event] NEG-…` chat lines if not already fixed in M2

### Tests
- ☐ T9 — Manual UI walkthrough of `/negotiations/new`
- ☐ T10 — PDF Section 9 contains all sub-agent provenance + tactics

### M3 gate
- All M1 + M2 tests green
- Open `/negotiations/new`, submit form, timeline streams, drill-down renders
- Download PDF, eyeball Section 9

---

## M4 — Demo dry-runs (~2h + 4h iter-15 buffer)

**Goal:** The 6-minute demo script runs 3 consecutive times from a clean
state without operator fix-ups.

- ☐ Write demo script (scene 1: identity check, scene 2: ADV2 negotiation with consultations, scene 3: defensive branch on outage)
- ☐ Practice runs 1, 2, 3 with timing
- ☐ Iter-15 WhatsApp buffer — exercise the notification path end-to-end
- ☐ Demo-day failover plan documented (what to do if a sub-agent goes down)

### Tests
- ☐ T11 — 3 clean consecutive runs

---

## Cut-points if timing slips

In priority order — drop from bottom first:
1. ⊘ Simulated-outage button (M3) — replace with env-var toggle the operator flips at the terminal
2. ⊘ Drill-down rich UI (M3) — replace with "View raw JSON" link
3. ⊘ 2 routing rules in ConsultationRouter (M2-β) — hardcode the common paths
4. ⊘ Per-counterparty α/δ tuning (M2-β) — use single global α/δ for demo
5. ⊘ Live GLEIF in M2 — fall back to fixture in demo if API is flaky
6. ⊘ Real-mode unstub for any provider — keep all four in demo mode for the May 19 demo. Real-mode lands post-WEDGE1.

Floor budget after cuts: ~25h remaining (was ~28h pre-M2-α.2+α.3).

---

## Update protocol

- At the **start** of each milestone, move "deferred from prior milestone" items into that milestone's pre-flight section.
- At the **end** of each milestone, mark items ✓ or ⊘, and add any newly-deferred items to the next milestone's pre-flight.
- Never let an item disappear silently — if it's dropped, it gets ⊘ with a one-line reason.
