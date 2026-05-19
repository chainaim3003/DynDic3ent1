# M2-δ Rename Cutover — Progress

**Last updated:** 2026-05-19 (session PROJ1-DYN3-CONT8 — M2-ε "Stream A narrow + intent-driven scenarios")
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
   - **PARTIALLY RESOLVED in CONT8 / M2-ε.** The buyer's `/api/mode-status` endpoint had the same issue — it advertised `mode: BASIC_SALES_QUOTING_1` regardless of what the seller ran (UI Settings card was misleading per same root cause). Endpoint removed; UI now fetches `/api/self/mode-status` from the seller directly. The buyer's audit JSON block itself is NOT yet patched (the buyer still records its own process view as `sellerResponseMode` inside its audit) — that requires either reaching across to the seller at deal-close or relabeling the block to `selfProcessMode`. Deferred to a future iteration; lower priority now that the visible UI surface is correct.

2. **Gemini free-tier rate limits cause `GEMINI_ERROR_RULES_FALLBACK`** intermittently. Audit is honest about it via the iter-0.5 fallback labels. Mitigation: set `GEMINI_FORCE_MODEL=gemini-2.5-flash-lite` in each agent's `.env` for cheap dev runs.

3. **ZOPA in outcomeQuality** uses a `demo-constant` sellerMin (₹350) via `constraintDisclosure.fallbackUsed` because the seller doesn't disclose its true floor in `ACCEPT_OFFER`. Behavioral floors observed: ₹722 at qty=2000, ₹380 at qty=50000, ₹385 at qty=100000 — there's bulk-pricing math in seller-agent that ZOPA doesn't see. Pre-existing, not δ.

4. **cli-parser `validStyles` lies about TKI.** The block comment says "the known TKI five" but lists `aggressive, assertive, balanced, cooperative, win-win-seeking` — actual TKI is `competing, collaborating, compromising, avoiding, accommodating`. Should be reconciled when L3 design lands. Out of δ scope.

5. **Cosmetic box-drawing comment dashes** in `ui/src/components/SellerResponseModeCard.tsx` still say `Tier rows` and `How to change it` (the dash count made exact-match str_replace fragile). Same exception as `buyer-agent/index.ts` from CONT6. Non-blocking.

6. **Scenario cards (CONT5 design)** — never built. No `scenarios.ts` or `ScenarioCard.tsx` exists. Today's UI has chat + dashboard only. MVP estimate ~45–60 min: new `lib/scenarios.ts` array of (id, title, description, expected outcome, command string), new `components/ScenarioCard.tsx`, wire into `pages/AgentCenter.tsx` above the chat, click handler calls existing `sendToBuyerAgent(scenario.command, ...)`. Outcomes remain probabilistic until CONT5's proposed `--buyer-anchor`/`--rounds`/`--seller-margin-price` flags are added to the parser.
   - **RESOLVED in CONT8 / M2-ε via a different approach (Option γ).** Scenarios shipped, but the CONT5-proposed script-flag approach was REJECTED. Reason: hard-coded `--buyer-anchor`/`--rounds`/`--seller-margin-price` would have made agents puppets to a script, contradicting FRAMEWORK-V2's autonomy guarantees. Instead, scenarios declare intent (BuyerIntent + SellerIntent + Situation) and the agents execute that intent through their existing LLM + advisor + math machinery. CLI form 3 added: `start negotiation --scenario <id>` loads a JSON scenario from `A2A/js/src/shared/scenarios/`, extracts CLI-honored fields (product/qty/budget), and attaches the full intent for the buyer agent to log. Today only product/qty/maxBudget actually drive agent behavior; goal/style/walk-away/sellerIntent are declared but deferred. See CONT8 section below for details.

## Resume prompt for next session (PROJ1-DYN3-CONT9-TEAM)

> Continue from CONT8. M2-ε work complete — see the "CONT8 / M2-ε — Stream A narrow + intent-driven scenarios" section above for what was done and what was deferred. Pending tracks:
>  (1) **Smoke-test the CONT8 work in browser.** Restart agents via `A2A\js\run-all-agents.ps1`, run `curl http://localhost:8080/api/self/mode-status` (should return `L2_EXECUTIVE_REASONER` with `servedBy: "seller-agent@port-8080"`). Open the UI Settings card (should show `Active: L2_EXECUTIVE_REASONER` instead of `BASIC_SALES_QUOTING_1`). Open `/agents`, do the fetch-seller → verify-agent flow, then click a scenario chip and press ▶ Run. Buyer chat should show the 🎯 scenario banner with ⓘ deferred-honoring note, then proceed through the normal negotiation.
>  (2) **Em-dash cleanup follow-ups** carried from CONT8: buyer-agent's `/api/__removed__mode-status` dead handler body (lines ~1907–1945 in buyer-agent/index.ts) + the misleading startup banner label `── WEDGE1 seller response mode framework ─...`. Both blocked by box-drawing/em-dash byte-matching in str_replace. Cosmetic only; no runtime impact. Same exception class as CONT6/CONT7 box-drawing-dash cosmetic.
>  (3) **Intent honoring — full wire.** Today only `situation.product`, `situation.quantity`, and `buyerIntent.hardConstraints.maxBudgetPerUnit` flow through to agent behavior. Wiring `buyerIntent.goal` / `softPreferences` / `style` / `walkAwayBehavior` and the entire `sellerIntent` through to agent decisions is the next substantial work-stream. Estimated 4–6 hours design + code, 2–3 sessions. Add as FRAMEWORK-V2 §12 D7 if not already there.
>  (4) **Seller-intent envelope wire.** Today the seller acts on its `.env` only; scenario-declared sellerIntent is display-only in UI cards. Wiring requires extending OFFER envelope schema with optional `sellerIntent` hint OR a separate scenario-handshake message. Out of CONT8 scope; flagged for future design pass.
>  (5) **Group D test-script rewrites** — still pending from M2-δ. 4 files have heavy old-name usage. Decide: rewrite test-tier-resolver.ts to test-seller-response-mode-resolver.ts? Update the other 3 in place?
>  (6) **Group F documentation updates** — still pending from M2-δ. Survey DESIGN/ and root README files first.

## CONT8 (M2-ε) — Stream A narrow + Intent-driven scenarios

**Session summary:** Two pieces of work, both narrow:
  - Fix Finding #1 at the UI surface by relocating mode-status to where it can be honest (`/api/self/mode-status` on the seller).
  - Ship intent-driven scenarios via Option γ (cards built now, full intent honoring deferred), explicitly rejecting CONT5's script-flag approach because it would have violated agent autonomy.

### Architectural decisions

**[DECISION] Finding #1 fix is REMOVE, not PROXY.**
The initial Stream A plan was "buyer proxies `/api/mode-status` to seller". On closer reading of FRAMEWORK-V2 §5, that's still wrong: the buyer agent does not (and should not) know the seller's mode. Routing the same lie through one more hop doesn't fix the lie. Correct fix: buyer's `/api/mode-status` is removed entirely; seller exposes `/api/self/mode-status` reporting itself only; UI is rewired to query the seller directly.

**[DECISION] `/api/self/*` is a load-bearing convention.**
Anything under `/api/self/*` is the agent reporting about ITSELF. No agent's `/api/self/*` ever proxies another agent. Violating this is what produced Finding #1 (buyer's `/api/mode-status` claimed to report the seller's mode but read the buyer's env). Convention is documented in inline comments at both the seller's new endpoint and at the buyer's removal site.

**[DECISION] Three observability patterns are additive layers, not a crossroads.**
Deep architectural discussion explored: (1) per-agent self-report + UI as observer (K8s/Prometheus style); (2) dedicated observer-agent (Istio/Linkerd style); (3) audit-log-only post-hoc research. Conclusion: Pattern 1 establishes the `/api/self/*` namespace; Pattern 2 adds an observer-agent later using the same endpoints; Pattern 3 adds historical analytics via HARNESS/ reading audit JSON files (already exists per FRAMEWORK-V2 §9). CONT8 implements Pattern 1's foundation only.

**[DECISION] Intent declares; agents execute. Not the other way.**
CONT5 proposed `--buyer-anchor <price> --rounds <n> --seller-margin-price <p>` flags to make scenario outcomes deterministic. REJECTED. Reasons:
  - Hard-coded flags would make agents puppets to a script, contradicting the autonomy contract.
  - Scenarios would describe what literally happens, not what was attempted — less honest as demos.
  - Probabilistic outcomes within bounded guardrails ARE the product, not a bug to engineer around.

Instead, a Scenario declares: (a) BuyerIntent (goal, hard constraints, soft preferences, style, walk-away behavior), (b) SellerIntent (same shape), (c) Situation (product, quantity, market regime). Existing LLM + advisor + math machinery EXECUTES the intent. Outcomes stay probabilistic but bounded and explainable.

**[DECISION] Option γ — ship intent-shaped data NOW, defer wiring.**
Full intent honoring (goal / style / soft preferences / walk-away / sellerIntent) would require substantial work in the buyer agent (LLM prompt shaping, decision-trail wiring) AND in the seller agent (envelope schema extension or separate handshake). CONT8 ships the scenario contract in its full intent shape, but today only product/qty/maxBudget actually flow through to agent behavior. The rest is declared in the scenario JSON, displayed in the UI card, logged by the buyer at run-time — honest about being deferred.

### What was built

**Phase 1 — Stream A narrow (Finding #1 UI surface fix)**
- `A2A/js/src/agents/seller-agent/index.ts` — added `GET /api/self/mode-status`, sourced from seller's own `process.env`. CORS already permissive via existing `app.use(cors())` at line ~67 (sufficient for localhost dev; should be tightened for non-dev deployment).
- `A2A/js/src/agents/buyer-agent/index.ts` — `/api/mode-status` route renamed to inert `/api/__removed__mode-status`. Dead-code handler body remains (see follow-up #2 in the resume prompt above). Import-block comment updated to document the removal and reference the new convention.
- `ui/src/lib/dealQualityApi.ts` — `fetchModeStatus()` rewired from `BUYER_URL/api/mode-status` to `SELLER_URL/api/self/mode-status`. New `SELLER_URL` constant reads `VITE_SELLER_URL` env or defaults to `http://localhost:8080`. Added optional `servedBy?: string` field to ModeStatus interface so the UI can identify which process served the response.

**Phase 2 — Intent types + scenario files**
- `A2A/js/src/shared/intent-types.ts` — BuyerIntent, SellerIntent, Scenario, Situation, ExpectedOutcome. Style enum accepts BOTH today's parser set (aggressive/assertive/balanced/cooperative/win-win-seeking) AND real TKI five (competing/collaborating/compromising/avoiding/accommodating). Each interface annotated with what's honored today vs deferred.
- `A2A/js/src/shared/scenarios/scenarios-index.json` — manifest, 4 entries, version 1, declared order = presentation order in UI.
- `A2A/js/src/shared/scenarios/happy-path-cotton.json` — qty 100k, budget ₹500, balanced; expected to close in 2–3 rounds.
- `A2A/js/src/shared/scenarios/mid-market-balanced.json` — qty 50k, budget ₹420, cooperative; smooth-path demo through PO + Invoice + DD + ACTUS.
- `A2A/js/src/shared/scenarios/tight-budget-escalation.json` — qty 2k, budget ₹320, aggressive; designed to escalate; demonstrates audit chain when no deal is feasible.
- `A2A/js/src/shared/scenarios/small-test-order.json` — qty 500, budget ₹400; demonstrates bulk-pricing math sensitivity at low qty.
- `A2A/js/src/shared/scenario-loader.ts` — `loadScenario(id)`, `listScenarioIds()`, `loadAllScenarios()`. Manifest-driven (not directory-scan), synchronous reads, shape validation with clear error messages. Uses `fs.readFileSync` + `__dirname`; works because agents run via `tsx` directly from `src/`, not from compiled `dist/`.

**Phase 3 — CLI parser form 3**
- `A2A/js/src/shared/cli-parser.ts` — added form 3 (`--scenario <id>`). `ParsedNegotiationCommand` extended with optional `scenarioIntent?: Scenario` and `scenarioDeferred?: string[]`. New `resolveScenarioForm()` internal function. Rejects combining `--scenario` with other flags. Style mapping normalizes scenario's TKI-or-parser-set value to "balanced" when not in parser's accepted set (avoids coupling the scenario contract to Finding #4's parser quirk).
- `A2A/js/src/agents/buyer-agent/index.ts` — scenarioIntent dispatch added before existing flagged-form startNegotiation call. Logs scenario metadata via `logInternal` and emits a chat banner showing buyer/seller intents + modes + ⓘ honored-vs-deferred disclaimer.

**Phase 4 — UI scenario picker**
- `ui/vite.config.ts` — added `server.fs.allow` rule with `path.resolve(__dirname, "..")` to permit cross-tree glob-import (Vite blocks reads outside `ui/` by default). Verified the existing config had no `fs.allow` set, so default-deny would have broken the glob import.
- `ui/src/lib/scenarios.ts` — Vite glob-import bundling from `../../../A2A/js/src/shared/scenarios/*.json`. Mirrors agent-side types locally because Vite can't reach `A2A/js/src/shared/intent-types.ts` for cross-package import. Exports `listScenarios()` and `getScenario(id)`. Loads manifest first to honor declared order.
- `ui/src/components/ScenarioPicker.tsx` — `ScenarioChip` (inline button with browser `title` attribute for tooltip — no Radix dep needed) + `ScenarioPicker` (component with `onRun` callback prop, `enabled` flag, `disabledHint` string). UX: chip row + selected indicator + ▶ Run button. Tooltip shows description / buyer intent / seller intent / situation / expected outcome / honored-vs-deferred footer.
- `ui/src/pages/AgentCenter.tsx` — wired `<ScenarioPicker>` below the buyer chat input form. `onRun` calls `handleBuyerCommand("start negotiation --scenario " + scenario.id)` which routes through the existing `sendToBuyerAgent` path. `enabled={!!buyerVerificationResult?.success}` mirrors the existing negotiation gate (seller must be verified first).

### Smoke-test steps (deferred to user)

After restarting agents via `A2A\js\run-all-agents.ps1`:

1. `curl http://localhost:8080/api/self/mode-status` → should return `L2_EXECUTIVE_REASONER` block with `servedBy: "seller-agent@port-8080"`.
2. UI Settings card (`http://localhost:5173/settings`) → should show `Active: L2_EXECUTIVE_REASONER` (not `BASIC_SALES_QUOTING_1`).
3. UI scenario picker on `/agents` page → after verifying seller (fetch → verify), click a scenario chip, hover for tooltip, click ▶ Run → negotiation should fire via `start negotiation --scenario happy-path-cotton`.
4. Buyer chat should show 🎯 scenario banner with intent summary + ⓘ deferred-honoring note before the existing negotiation flow runs.

### Deferred / known follow-ups

See numbered list (2)–(6) in the resume prompt above. The most material are: full intent honoring (3) and seller-intent envelope wire (4). Both are non-trivial design + code; tracked but not scheduled.

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

## Resume prompt for old M2-δ session (PROJ1-DYN3-CONT7-TEAM) — SUPERSEDED BY CONT8

> Continue M2-δ. Groups A/B/C done. Group D agent .env files done. One test-script import-path fix done. Pending:
>  (1) Group E: user runs `npx tsc --noEmit -p A2A/js` and reports results. If clean, runs single-dim + multi-dim negotiations and verifies audit JSON has `mode`/`mode` fields (not `tier`/`tier`).
>  (2) Group D test-script rewrites — 4 files have heavy old-name usage. Decide: rewrite test-tier-resolver.ts to test-seller-response-mode-resolver.ts? Update the other 3 in place?
>  (3) Group F documentation updates — survey DESIGN/ and root README files first.
>  (4) Frontend impact: dashboard expects `/api/tier-status`; buyer-agent now serves `/api/mode-status`. Find and update the frontend.
