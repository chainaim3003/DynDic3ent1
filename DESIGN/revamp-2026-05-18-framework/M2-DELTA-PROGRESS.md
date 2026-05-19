# M2-δ Rename Cutover — Progress

**Last updated:** 2026-05-19 (session PROJ1-DYN3-CONT6)
**Branch strategy:** Path 2 (clean-cut, demo down during, restore at Group E)

## Rename map (recap)

| Old | New |
|---|---|
| Type `NegotiationTier` | `SellerResponseMode` |
| Env var `NEGOTIATION_MODE` | `SELLER_RESPONSE_MODE` |
| Value `BASIC1` | `BASIC_SALES_QUOTING_1` |
| Value `ADVANCED1` | `L1_DELEGATED_ADVISORS` |
| Value `ADVANCED2` | `L2_EXECUTIVE_REASONER` |
| Value `ADVANCED3` | `L3_STYLE_AND_AUTONOMY` |
| Value `ADVANCED4` | `L4_LEARNED_PROFILES_AND_PD` |
| Fn `resolveTier` | `resolveSellerResponseMode` |
| Fn `validateTier` | `validateSellerResponseMode` |
| Fn `buildNegotiationModeBlock` | `buildSellerResponseModeBlock` |
| Capability `tacticsEngine` | `advisorMathAggregator` |
| Field `tier` (on bundles/inputs) | `mode` |
| File `tactics-engine.ts` | `advisor-math-aggregator.ts` |
| Endpoint `/api/tier-status` | `/api/mode-status` (buyer only) |

## Completion status by group

### Group A — shared core (COMPLETE)
- ✅ `src/shared/negotiation-mode.ts` — exports SellerResponseMode, advisorMathAggregator capability, fail-fast on `NEGOTIATION_MODE` env var with translation hint
- ✅ `src/shared/consultation-router.ts` — uses SellerResponseMode, `mode` field, MODE_RANK with new keys, predicate functions accept new mode names

### Group B — shared support modules (COMPLETE)
- ✅ `src/shared/l2-wire.ts` — clean: NegotiationTier→SellerResponseMode, tier→mode, advisorMathAggregator capability, mode-name comments
- ✅ `src/shared/l2-executive.ts` — same. Kept internal symbols `tacticsTrace`, `computeTactics()`, `TacticsBundle` unchanged (audit JSON field names from M1, out of δ scope)
- ✅ `src/shared/tactics-engine.ts` → renamed via `Filesystem:move_file` to `advisor-math-aggregator.ts` with new header comment
- ✅ `src/shared/negotiation-types.ts` — verified clean, no NegotiationTier or tier refs
- ✅ `src/shared/negotiationTypes.ts` (legacy camelCase) — verified clean
- ✅ `src/shared/credit-provider.ts` — comments updated
- ✅ `src/shared/treasury-provider.ts` — comments updated
- ✅ `src/shared/inventory-provider.ts` + `logistics-provider.ts` — verified clean, no changes
- ✅ `src/shared/logger.ts` — **missed in CONT6 sweep; caught by Group E tsc check (CONT7).** Patched in CONT7:
  - import line 13: `buildNegotiationModeBlock` → `buildSellerResponseModeBlock`
  - `saveAuditJson()` call site: `negotiationMode: buildNegotiationModeBlock()` → `sellerResponseMode: buildSellerResponseModeBlock()`
  - comment block + inline comment: "tier framework" / "tier under which the deal ran" / "tier+providerModes" → "seller-response-mode framework" / "mode under which the deal ran" / "mode+providerModes"
  - Spec source: `negotiation-mode.ts` module header says "producing the audit-JSON `sellerResponseMode` block". User verification check (Group E step 3) confirms `sellerResponseMode` is the expected audit-JSON property name.
  - Audited consumers of audit JSON in src/ before renaming the property:
    - `audit-pdf.ts` — no `negotiationMode` refs (PDF doesn't surface mode block today)
    - `notify/audit-attach.ts` — only appends `notifications[]` / `notificationsSummary`
    - `audit-writer.ts` — separate legacy `_audit_*.json` writer, unrelated path
    - `buyer-agent/index.ts` `/api/quality/:id` and `/api/quality/:id/pdf` — pass audit JSON through verbatim, no field selection
  - No backward-compat alias emitted; clean-cut per Path 2.

### Group C — agents (COMPLETE)
- ✅ `src/agents/seller-agent/index.ts` — full clean: imports, function calls, banner, comments, log messages, capabilities
- ✅ `src/agents/buyer-agent/index.ts` — full clean: imports, `/api/mode-status` endpoint (renamed from /api/tier-status), validateSellerResponseMode, banner, comments. **Frontend impact:** dashboard fetching `/api/tier-status` will break — re-target to `/api/mode-status`
- ✅ `src/agents/treasury-agent/index.ts` — verified clean, no tier refs
- ✅ `src/agents/inventory-agent/index.ts` — verified clean
- ✅ `src/agents/logistics-agent/index.ts` — verified clean
- ✅ `src/agents/credit-agent/index.ts` — verified clean

### Group D — env files + test scripts (PARTIAL)
- ✅ `src/agents/seller-agent/.env` — `NEGOTIATION_MODE=ADVANCED2` → `SELLER_RESPONSE_MODE=L2_EXECUTIVE_REASONER`, comments updated
- ✅ Other 5 agent `.env` files: verified — no `NEGOTIATION_MODE` references, no changes needed
- ✅ Root `.env.example`: no `NEGOTIATION_MODE` reference; "tier" wording in it refers to GEMINI model tier (Pro/Flash), not seller-response-mode — left as-is

**Test scripts (`scripts/*.ts`):**
- ⚠️ **NOT compile-blocking:** `tsconfig.json` only `include`s `src/**/*.ts`. Test scripts run via `npx tsx` standalone.
- ✅ `scripts/test-router-and-tactics.ts` — import path fix: `tactics-engine.js` → `advisor-math-aggregator.js` (the only compile-breaker)
- ⏳ `scripts/test-tier-resolver.ts` — still uses ALL old names (resolveTier, validateTier, NEGOTIATION_MODE, BASIC1, ADVANCED1-4, tacticsEngine, NegotiationTier). Will fail at runtime when invoked. Recommend: rename to `test-seller-response-mode-resolver.ts` and rewrite per new names.
- ⏳ `scripts/test-router-and-tactics.ts` — beyond import fix, still uses BASIC1/ADVANCED1/ADVANCED2 tier values + `tier:` field in consultAll input. Will fail at runtime.
- ⏳ `scripts/test-l2-wire.ts` — uses tier values + `tier:` field in DecideRoundViaL2Input
- ⏳ `scripts/test-l2-executive.ts` — uses `tier:` field in ConsultationBundle + tier values throughout
- ✅ `scripts/run-mode-matrix.ts` — about CREDENTIAL_MODE × SIGNING_MODE, unrelated to seller-response-mode, no changes needed
- Other scripts (replay-fixtures, test-cli-parser, test-envelope-ordering, test-fixtures-parse, test-gleif, test-outcome-quality, test-tamper, bootstrap-demo-counterparties) — unverified, likely unaffected

### Group E — smoke tests (EXECUTED — PASS)

**1. tsc compile check (`npx tsc --noEmit`):** PASS after one fix.

- First run: 1 error in `src/shared/logger.ts:13` — `buildNegotiationModeBlock` import was missed in CONT6 sweep. Patched in CONT7 (see Group B entry above for logger.ts). Re-run: 0 errors.

**2. Agent boot smoke:** PASS.

- All 6 agents started via `run-all-agents.ps1` (PowerShell orchestrator: 4 advisor sub-agents in phase 1, seller + buyer in phase 2 after 3s delay).
- Seller (8080), buyer (9090), treasury (7070), credit (7071), inventory (7072), logistics (7073) all bound cleanly.
- Seller audit JSON later confirmed `SELLER_RESPONSE_MODE=L2_EXECUTIVE_REASONER` resolved from env. Buyer audit shows `mode=BASIC_SALES_QUOTING_1` because the buyer's own env doesn't set the var (correctly — buyer isn't a seller). See Finding #1 below.
- No `NEGOTIATION_MODE is no longer recognized` fail-fast. No invalid-mode throws. CLI connects cleanly to buyer at :9090.

**3. Scenario A — Guarantee A legacy single-dim (`start negotiation 300`):** PASS.

- Audit: `src/escalations/NEG-1779174658746_escalation_BUYER.audit.json` (paired SELLER audit also exists)
- Outcome: 3-round escalation, buyer capped at ₹400, seller floor ₹722, gap ₹322
- ✅ Top-level `sellerResponseMode` block present (no `negotiationMode`/`tier`)
- ✅ `mode` field inside block (buyer: BASIC; seller: L2_EXECUTIVE_REASONER)
- ✅ `resolvedCapabilities.advisorMathAggregator` flag (no `tacticsEngine`)
- ✅ Negotiation completed end-to-end — clean escalation, escalation .txt + .audit.json written
- LLM was rule-based-fallback throughout (`GEMINI_ERROR_RULES_FALLBACK`) due to free-tier rate limit. Not a rename issue. See Finding #2.

**4. Scenario B — multi-dim:** PASS (in two attempts).

- First attempt with `--buyer-style accommodating`: parser rejected. The cli-parser comment claims `validStyles` is "the TKI five" but the actual set is `aggressive, assertive, balanced, cooperative, win-win-seeking` — NOT real TKI. Pre-existing parser bug, not M2-δ scope. See Finding #4.
- Second attempt with `--buyer-style cooperative`: 3-round escalation at gap ₹25 (audit `NEG-1779175180708_escalation_BUYER.audit.json`).
- Third attempt scaled up to `--qty 100000 --buyer-budget 500`: **DEAL CLOSED** at ₹373/unit, total ₹37.3M.
  - Audit: `src/escalations/NEG-1779175638301_success_BUYER.audit.json` + `_SELLER.audit.json`
  - PO + Invoice + Dynamic Discount auto-accepted + ACTUS PAM simulation SUCCESS — full end-to-end workflow.
  - LLM `usedFallback: false` on rounds 2 and 3 — Gemini recovered, real LLM judgment used.
  - outcomeQuality: bothIR true, ZOPA wasFeasible, buyer captured 85% of surplus.
- All checks 1–4 pass. Check 5 (multi-dim field propagation):
  - ✅ `quantity` propagates to top-level `negotiation.quantity` in both audits
  - ✅ `productCode: "FAB-COTTON-180GSM"` propagates to seller's inventory-advisor consultation snapshots (verified at seller audit lines 251, 366; routes to `DEMO-DATA/inventory/erpnext-bin-FAB-COTTON-180GSM.json`)
  - ⚠️ `buyerStyle` (cooperative) NOT propagated to either audit — **this is correct per spec.** FRAMEWORK-V2.md §3.4 reserves style for L3_STYLE_AND_AUTONOMY (post-WEDGE1). The cli-parser block-comment confirms today's seller doesn't act on `--buyer-style`. Validated at parser, discarded thereafter.

**5. Frontend dashboard patch:** APPLIED.

Files changed (clean-cut, no aliases, no `tier`/`negotiationMode` residuals in renamed types):
- `ui/src/lib/dealQualityApi.ts` — patched:
  - `AuditDoc.negotiationMode?` → `sellerResponseMode?`
  - `NegotiationTier` type → `SellerResponseMode`, with new value literals (BASIC_SALES_QUOTING_1, L1…L4)
  - `ResolvedCapabilities.tacticsEngine` → `advisorMathAggregator`
  - `NegotiationModeBlock` → `SellerResponseModeBlock`, `.tier` field → `.mode`, `resolvedFromEnv.NEGOTIATION_MODE` → `SELLER_RESPONSE_MODE`
  - `TierStatus` → `ModeStatus`, `tierDescriptions` → `modeDescriptions`
  - `fetchTierStatus()` → `fetchModeStatus()`, fetches `/api/mode-status`
- `ui/src/components/TierFrameworkCard.tsx` → renamed via `Filesystem:move_file` to `SellerResponseModeCard.tsx`. Component name, JSDoc, imports, useQuery key, error text, mode-order constants, all field accesses, and the visible footer hint all patched. Two box-drawing-dash comments (`{/* ── Tier rows ──… */}` and `{/* ── How to change it ──… */}`) left as cosmetic residuals, same exception as `buyer-agent/index.ts` from CONT6.
- `ui/src/pages/Settings.tsx` — import path updated, JSX tag renamed, visible help text updated (`negotiation tier` → `seller response mode`, `NEGOTIATION_MODE` → `SELLER_RESPONSE_MODE`).

Heading text chosen: **"Seller response mode framework"** (option (a) per user).

Consumers verified clean (no other UI code reads old field names): `DealQualityCard.tsx`, `Dashboard.tsx`, `a2aService.ts` — none referenced `tier`/`negotiationMode`/`NEGOTIATION_MODE`/`tacticsEngine`.

UI not yet smoke-tested in browser. User to verify by:
```
cd ui && npm install && npm run dev
```
Navigate to `/settings`. Card should render with `Active: L2_EXECUTIVE_REASONER`. If shows "Could not reach /api/mode-status", buyer agent isn't up or has stale routes.

## Findings beyond M2-δ scope (deferred)

1. **Buyer audit's `sellerResponseMode.mode` field is misleading.** `buildSellerResponseModeBlock()` reads the calling process's env. The buyer doesn't (and shouldn't) set `SELLER_RESPONSE_MODE`, so the buyer audit always records `mode: BASIC_SALES_QUOTING_1` regardless of what the seller actually ran. The seller audit correctly records the seller's mode. Architectural inheritance from M1; suggest future fix to either omit the block from buyer audits or label it `selfProcessMode` / query the seller for it at deal start.

2. **Gemini free-tier rate limits cause `GEMINI_ERROR_RULES_FALLBACK`** intermittently. Audit is honest about it via the iter-0.5 fallback labels. Mitigation: set `GEMINI_FORCE_MODEL=gemini-2.5-flash-lite` in each agent's `.env` for cheap dev runs.

3. **ZOPA in outcomeQuality** uses a `demo-constant` sellerMin (₹350) via `constraintDisclosure.fallbackUsed` because the seller doesn't disclose its true floor in `ACCEPT_OFFER`. Behavioral floors observed: ₹722 at qty=2000, ₹380 at qty=50000, ₹385 at qty=100000 — there's bulk-pricing math in seller-agent that ZOPA doesn't see. Pre-existing, not δ.

4. **cli-parser `validStyles` lies about TKI.** The block comment says "the known TKI five" but lists `aggressive, assertive, balanced, cooperative, win-win-seeking` — actual TKI is `competing, collaborating, compromising, avoiding, accommodating`. Should be reconciled when L3 design lands. Out of δ scope.

5. **Cosmetic box-drawing comment dashes** in `ui/src/components/SellerResponseModeCard.tsx` still say `Tier rows` and `How to change it` (the dash count made exact-match str_replace fragile). Same exception as `buyer-agent/index.ts` from CONT6. Non-blocking.

6. **Scenario cards (CONT5 design)** — never built. No `scenarios.ts` or `ScenarioCard.tsx` exists. Today's UI has chat + dashboard only. MVP estimate ~45–60 min: new `lib/scenarios.ts` array of (id, title, description, expected outcome, command string), new `components/ScenarioCard.tsx`, wire into `pages/AgentCenter.tsx` above the chat, click handler calls existing `sendToBuyerAgent(scenario.command, ...)`. Outcomes remain probabilistic until CONT5's proposed `--buyer-anchor`/`--rounds`/`--seller-margin-price` flags are added to the parser.

### Group F — documentation (PENDING)
- ⏳ `DESIGN/current/AGENTIC-PROCUREMENT-ARCHITECTURE.md`
- ⏳ `DESIGN/README.md`
- ⏳ Root `README.md` files (multiple — survey first)

## Compile-state expectations

After this session, running `npx tsc --noEmit -p A2A/js`:
- **Should pass clean** for all `src/` code (agents, shared)
- Test scripts are NOT in compile scope — will be ignored

If tsc fails, likely culprits to grep for:
- `NegotiationTier` (type alias remnant)
- `resolveTier(` / `validateTier(` (function name remnant)
- `buildNegotiationModeBlock(` (function name remnant)
- `tacticsEngine` (capability name remnant)
- `NEGOTIATION_MODE` (env var remnant — except in fail-fast error message)
- `"BASIC1"` / `"ADVANCED1"` / `"ADVANCED2"` / `"ADVANCED3"` / `"ADVANCED4"` (value literals)
- `.tier` field access (should be `.mode`)
- Imports of `./tactics-engine.js` (should be `./advisor-math-aggregator.js`)

## Known cosmetic-only residuals (non-compile, non-runtime)

In `buyer-agent/index.ts`, three lines kept "tier framework" wording in section-divider comments due to box-drawing-dash count matching issues. These are cosmetic; the section labels were updated but trailing `─` runs are sometimes off. Not user-visible.

## Resume prompt for next session (PROJ1-DYN3-CONT7-TEAM)

> Continue M2-δ. Groups A/B/C done. Group D agent .env files done. One test-script import-path fix done. Pending:
>  (1) Group E: user runs `npx tsc --noEmit -p A2A/js` and reports results. If clean, runs single-dim + multi-dim negotiations and verifies audit JSON has `mode`/`mode` fields (not `tier`/`tier`).
>  (2) Group D test-script rewrites — 4 files have heavy old-name usage. Decide: rewrite test-tier-resolver.ts to test-seller-response-mode-resolver.ts? Update the other 3 in place?
>  (3) Group F documentation updates — survey DESIGN/ and root README files first.
>  (4) Frontend impact: dashboard expects `/api/tier-status`; buyer-agent now serves `/api/mode-status`. Find and update the frontend.
