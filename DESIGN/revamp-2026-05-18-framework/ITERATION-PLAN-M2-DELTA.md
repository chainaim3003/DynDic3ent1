# Iteration Plan — M2-δ Clean Rename Cutover

**Path:** `DynDic3ent1/DESIGN/revamp-2026-05-18-framework/ITERATION-PLAN-M2-DELTA.md`
**Status:** 🚧 DRAFT — awaiting your sign-off
**Goal:** Get the working stack (simple `start negotiation 300` + multi-dim
`start negotiation --product ... --qty ...`) running under the new v2 names
from `FRAMEWORK-V2.md`, with zero behavior change.
**Approach:** Clean cut. No aliases. No translation helpers. New names everywhere.

**Per user constraints (Rule 4):**
- No hallucination — every file path verified against disk on 2026-05-18
- No fallback — old env names produce a helpful fail-fast error, NOT silent translation
- No mocks — code paths exercised end-to-end
- No hardcoding — new names live in one canonical place; rest references it

**Defers explicitly:**
- Wave A (audit instrumentation: `delegationChain`, `thinkCycleTrace`, `frameworkMetrics`)
- Wave B (harness, generators, P&L reports)
- L3 / L4 code

---

## 1. The rename table (single source of truth)

This is the ONLY translation table. Apply mechanically wherever the old name appears.

### 1.1 Tier values

| Old | New |
|---|---|
| `BASIC1` | `BASIC_SALES_QUOTING_1` |
| `ADVANCED1` | `L1_DELEGATED_ADVISORS` |
| `ADVANCED2` | `L2_EXECUTIVE_REASONER` |
| `ADVANCED3` | `L3_STYLE_AND_AUTONOMY` |
| `ADVANCED4` | `L4_LEARNED_PROFILES_AND_PD` |

### 1.2 Env var names

| Old | New |
|---|---|
| `NEGOTIATION_MODE` | `SELLER_RESPONSE_MODE` |

(All other env vars — `INVENTORY_MODE`, `LOGISTICS_MODE`, `CREDIT_MODE`,
`CREDENTIAL_MODE`, `EVALUATION_CONTEXT`, `GEMINI_*`, `PORT`, etc. — stay
unchanged. They were already correctly named.)

### 1.3 Type names

| Old (TypeScript) | New |
|---|---|
| `NegotiationTier` | `SellerResponseMode` |
| `NegotiationMode` (resolver output type, if it exists) | `ResolvedSellerResponse` |

### 1.4 Module file renames

| Old file | New file | Rationale |
|---|---|---|
| `src/shared/tactics-engine.ts` | `src/shared/advisor-math-aggregator.ts` | It's a math aggregator, not a tactics engine |

(Other modules — `l2-executive.ts`, `l2-wire.ts`, `consultation-router.ts` —
keep their current names. They describe what they do.)

### 1.5 Symbol renames inside modules

| Old | New |
|---|---|
| `resolveTier()` | `resolveSellerResponseMode()` |
| `validateTier()` | `validateSellerResponseMode()` |
| `getResolvedCapabilities()` | (unchanged — already function-named) |
| `runL2Path()` (seller method) | (unchanged — `L2` is now a proper tier name suffix) |

### 1.6 Strings that need updating but aren't keyed lookups

- Console banner text (`"WEDGE1 tier framework"` → `"Seller Response Mode"`)
- Error messages mentioning old tier names
- Comments referencing old names (where it adds confusion to leave them)

---

## 2. Logical groupings (in execution order)

Five groups. Each one ends in a checkpoint where the demo MUST still work.
**If a checkpoint fails, stop, fix, then continue.**

### Group A — Core type + resolver renames (~45 min)

Touch the source of truth for tier values. TypeScript compiler will surface
every miss downstream.

**Files:**

1. **`src/shared/negotiation-mode.ts`** 📝 MODIFY
   - Rename type `NegotiationTier` → `SellerResponseMode`
   - Replace tier string literals: `"BASIC1"` → `"BASIC_SALES_QUOTING_1"` etc.
   - Rename `resolveTier()` → `resolveSellerResponseMode()`
   - Change env var read: `process.env.NEGOTIATION_MODE` → `process.env.SELLER_RESPONSE_MODE`
   - Add the helpful fail-fast for old env name:
     ```typescript
     if (process.env.NEGOTIATION_MODE && !process.env.SELLER_RESPONSE_MODE) {
       throw new Error(
         "NEGOTIATION_MODE is no longer recognized. " +
         "Use SELLER_RESPONSE_MODE instead. " +
         "Translation table: BASIC1→BASIC_SALES_QUOTING_1, ADVANCED1→L1_DELEGATED_ADVISORS, " +
         "ADVANCED2→L2_EXECUTIVE_REASONER, ADVANCED3→L3_STYLE_AND_AUTONOMY, " +
         "ADVANCED4→L4_LEARNED_PROFILES_AND_PD. " +
         "See DESIGN/revamp-2026-05-18-framework/FRAMEWORK-V2.md §5.1."
       );
     }
     ```
     **This is not a fallback — it refuses to start. It just tells the user what to fix.**
   - Update validator to reject `L3_STYLE_AND_AUTONOMY` and `L4_LEARNED_PROFILES_AND_PD` with the same "not yet supported" message
   - Update capability map keys to new tier names

2. **`src/shared/negotiation-types.ts`** 📝 MODIFY
   - If it re-exports `NegotiationTier`, update the export
   - If it has `negotiationMode` audit-block typing, rename the field shape

**Checkpoint A:** `npx tsc --noEmit -p A2A/js` from repo root. Should fail with many type errors in downstream files — that's expected; we'll fix them in Group B. **At this point the agents won't compile.** That's normal mid-cutover.

### Group B — Downstream type fixes in `src/shared/` (~45 min)

TypeScript errors from Group A guide every fix here.

**Files:**

3. **`src/shared/consultation-router.ts`** 📝 MODIFY
   - Replace `TIER_RANK` keys: old tier names → new tier names
   - Replace any `if (tier === "ADVANCED2")` style checks
   - No logic change

4. **`src/shared/l2-wire.ts`** 📝 MODIFY
   - Type union references to `NegotiationTier` → `SellerResponseMode`
   - Internal capability checks still work via `ResolvedCapabilities` (capability names don't change)
   - Comments updated

5. **`src/shared/l2-executive.ts`** 📝 MODIFY
   - Type references updated
   - Comments updated

6. **`src/shared/tactics-engine.ts` → `src/shared/advisor-math-aggregator.ts`** 📝 RENAME + EDIT
   - File rename
   - Top-of-file comment block updated to reflect new role naming
   - All imports of this module in other files (l2-wire.ts, l2-executive.ts, scripts) updated to new path

7. **`src/shared/credit-provider.ts`** 📝 MODIFY (minor)
   - Probably no changes — providers don't reference tier names
   - Verify by searching for `BASIC` / `ADVANCED` / `NEGOTIATION_MODE`

8. **`src/shared/inventory-provider.ts`** 📝 MODIFY (minor — same as credit)

9. **`src/shared/logistics-provider.ts`** 📝 MODIFY (minor — same as credit)

10. **`src/shared/treasury-provider.ts`** 📝 MODIFY (minor — same as credit)

**Checkpoint B:** `npx tsc --noEmit -p A2A/js` from `A2A/js/`. Should now pass (or only have errors in agent index.ts files — that's Group C).

### Group C — Agent index.ts files (~45 min)

**Files:**

11. **`src/agents/seller-agent/index.ts`** 📝 MODIFY
    - Imports updated: `tactics-engine` → `advisor-math-aggregator`
    - Tier check: `this.resolvedCap.llmExecutiveJudgment` already in canonical form — no change
    - String literal in startup banner: `"NEGOTIATION_MODE"` → `"SELLER_RESPONSE_MODE"`
    - Banner text: `"WEDGE1 tier framework"` → `"Seller Response Mode"`
    - Comments referencing `NEGOTIATION_MODE=ADVANCED2` etc. updated

12. **`src/agents/buyer-agent/index.ts`** 📝 MODIFY (minor)
    - Buyer banner: same env-name change in display only (buyer doesn't gate on this)

13. **`src/agents/treasury-agent/index.ts`** 📝 MODIFY (minor)
    - Probably no tier references; verify and update if any

14. **`src/agents/credit-agent/index.ts`** 📝 MODIFY (minor — same as treasury)
15. **`src/agents/inventory-agent/index.ts`** 📝 MODIFY (minor — same)
16. **`src/agents/logistics-agent/index.ts`** 📝 MODIFY (minor — same)

**Checkpoint C:** `npx tsc --noEmit -p A2A/js` from `A2A/js/`. Should pass with zero errors. **At this point the source compiles. But it won't run yet because .env files still have old names.**

### Group D — env files + scripts (~30 min)

**Files:**

17. **`src/agents/seller-agent/.env`** 📝 MODIFY
    - Replace `NEGOTIATION_MODE=ADVANCED2` with `SELLER_RESPONSE_MODE=L2_EXECUTIVE_REASONER`
    - Keep all other vars (`GEMINI_API_KEY`, `INVENTORY_MODE=real`, etc.)
    - The 4 M2-γ lines I added stay

18. **`src/agents/seller-agent/.env.example`** 📝 MODIFY (same)
19. **`src/agents/buyer-agent/.env`** 📝 MODIFY — if it has `NEGOTIATION_MODE`
20. **`src/agents/buyer-agent/.env.example`** 📝 MODIFY (same)
21. **`src/agents/treasury-agent/.env`** 📝 MODIFY — verify, update if needed
22. **`src/agents/treasury-agent/.env.example`** 📝 MODIFY (same)
23. **`src/agents/credit-agent/.env`** 🚫 NO CHANGE — already only has PORT + CREDIT_FIXTURE
24. **`src/agents/credit-agent/.env.example`** 🚫 NO CHANGE
25. **`src/agents/inventory-agent/.env`** 🚫 NO CHANGE
26. **`src/agents/inventory-agent/.env.example`** 🚫 NO CHANGE
27. **`src/agents/logistics-agent/.env`** 🚫 NO CHANGE
28. **`src/agents/logistics-agent/.env.example`** 🚫 NO CHANGE

29. **Scripts that reference tier strings** 📝 MODIFY
    - `scripts/test-tier-resolver.ts` — uses old names; update tier strings + the new test for the helpful-error path
    - `scripts/test-l2-wire.ts` — likely references tier strings; update
    - `scripts/test-l2-executive.ts` — same
    - `scripts/test-router-and-tactics.ts` — likely references tier strings
    - `scripts/run-mode-matrix.ts` — likely tests across tiers; update strings
    - Other test scripts — check by reading; update only if they reference tier strings

**Checkpoint D:** Start all 6 agents via `run-all-agents.ps1`. All 6 should boot with banners showing the new vocabulary. If anything fails, the error should be one of:
- Old `NEGOTIATION_MODE` in some `.env` we missed → the helpful error fires
- TypeScript miss → fix, restart
- Anything else → diagnose

### Group E — Smoke test + verify (~30 min)

**Tests:**

30. **Run all tests:** `npx tsx scripts/test-tier-resolver.ts`, then run each other test script. **All tests must pass.** Tier names changed; test fixtures changed; tests should still find the same canonical behavior.

31. **Manual smoke test 1 (legacy form):**
    ```
    npm run a2a:cli
    You › /new
    You › start negotiation 300
    ```
    Should complete a negotiation. Audit JSON written.

32. **Manual smoke test 2 (multi-dim form):**
    ```
    You › /new
    You › start negotiation --product COTTON-180GSM --qty 50000 --buyer-budget 400 --buyer-style aggressive --buyer-deadline 2026-06-15
    ```
    Should complete a negotiation. All 4 sub-agent windows should light up with their consultation banners. Audit JSON should reflect the new tier name `L2_EXECUTIVE_REASONER`.

33. **Inspect audit JSON.** Open the most recent audit file. The `negotiationMode` block (or whatever it's now called) should show new names. No occurrence of `BASIC1` / `ADVANCED2` / `NEGOTIATION_MODE` in the new audit JSON.

34. **Inspect agent banners.** All 6 agent windows should display new vocabulary in their startup banners.

**Checkpoint E:** Both smoke tests pass. **Demo is back to working state, under new names.**

---

## 3. Documentation updates (~15 min, can be parallel to Group E)

These don't affect runtime; can be done after Checkpoint E or in parallel.

**Files:**

35. **`DESIGN/current/AGENTIC-PROCUREMENT-ARCHITECTURE.md`** 📝 MODIFY
    - Add a header note: "v1.2; cutover to v2 names happened on 2026-05-18. See FRAMEWORK-V2.md for current vocabulary."
    - Leave the body unchanged — it's the historical v1.2 description.
    - (Alternatively, move it to `historical/v1.2-may-17-master/` and put a thin pointer in `current/`. Cleaner but more disruptive. Recommend NOT doing this now — wait for actual content updates.)

36. **`DESIGN/current/BACKLOG.md`** 📝 MODIFY (minor)
    - Update any references to old tier names

37. **`DESIGN/current/TEST-PLAN-WEDGE1.md`** 📝 MODIFY (minor)
    - Update tier-name references in verification gates

38. **`DESIGN/current/MAY19-RELEASE.md`** 📝 MODIFY (minor)
    - Update tier-name references in iteration tracker

39. **`A2A/js/README.md`** 📝 MODIFY — if it has tier examples
40. **`A2A/js/QUICKSTART.md`** 📝 MODIFY — same
41. **`A2A/js/NEGOTIATION_EXPLANATION.md`** 📝 MODIFY — same

---

## 4. Risk assessment + mitigation

### Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Miss a tier string in some test fixture; test passes wrong way | Medium | TypeScript catches most; manual review of test scripts at Group D |
| Audit JSON files on disk from past runs have old names; if something re-reads them later, it breaks | Low | Past audit files are historical; the harness (Wave B) will read newly-written audits only |
| Some `.env` file referenced from a script we don't notice | Medium | Group D explicitly lists every `.env` file; verify by directory listing before declaring Group D done |
| The cli-parser-test or another script has hardcoded `NEGOTIATION_MODE` | Low | Scripts in Group D step 29; will be caught by reading each |
| Markdown docs out-of-sync after the cutover | High (acceptable) | Documentation updates are Group F (after demo works). Acceptable temporary divergence. |
| Soft references in code comments still say `ADVANCED2` | Low | Acceptable. Comments don't break runtime. Will get cleaned over time. |

### What we will NOT mitigate (out of scope)

- Backward compatibility with audit JSONs from before this cutover. They had old names; they keep old names; harness reads forward only.
- Markdown docs in `DESIGN/historical/`. Those are frozen snapshots — they stay as they are.

---

## 5. Verification scripts that need to pass

In execution order during Checkpoint E:

```bash
cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js

# Compilation
npx tsc --noEmit -p .

# Tests (existing — should pass with new names)
npx tsx scripts/test-tier-resolver.ts
npx tsx scripts/test-cli-parser.ts
npx tsx scripts/test-fixtures-parse.ts
npx tsx scripts/test-router-and-tactics.ts
npx tsx scripts/test-l2-wire.ts
npx tsx scripts/test-l2-executive.ts
npx tsx scripts/test-envelope-ordering.ts
npx tsx scripts/test-outcome-quality.ts
```

If any test fails, stop, diagnose, fix, restart from that test.

Then:

```powershell
# All 6 agents
powershell -ExecutionPolicy Bypass -File .\run-all-agents.ps1

# CLI smoke tests (in a separate PowerShell window)
npm run a2a:cli
# at the You ›  prompt:
#   start negotiation 300
#   /new
#   start negotiation --product COTTON-180GSM --qty 50000 --buyer-budget 400 --buyer-style aggressive --buyer-deadline 2026-06-15
```

---

## 6. Estimated effort

| Group | Time |
|---|---|
| A — Core types + resolver | 45 min |
| B — Downstream type fixes + tactics-engine rename | 45 min |
| C — Agent index.ts files | 45 min |
| D — `.env` files + test scripts | 30 min |
| E — Smoke test + verify | 30 min |
| F — Doc updates (parallel-able) | 15 min |
| **TOTAL** | **3.5 hours** (5 sequential hours if doc work is serial) |

---

## 7. Order of operations (the actual execution plan)

1. **Read the design doc** (you) — make sure §5 of `FRAMEWORK-V2.md` matches what you want
2. **Sign off on this iteration plan** (you) — confirm the file list and execution order
3. **Group A**: rename in `negotiation-mode.ts` + `negotiation-types.ts` → checkpoint A (TypeScript errors expected)
4. **Group B**: fix downstream type errors + rename `tactics-engine.ts` → checkpoint B (clean compile)
5. **Group C**: agent index.ts files → checkpoint C (compile + all sources updated)
6. **Group D**: `.env` files + test scripts → checkpoint D (agents boot, tests pass)
7. **Group E**: smoke tests → checkpoint E (demo works, both forms)
8. **Group F** (parallel): doc updates
9. **Demo!** Show the running stack with new vocabulary.

After this, Wave A and Wave B can be planned separately. The code is now ready for them — clean v2 names everywhere.

---

## 8. What I need from you to start

Sign off on:

- ✅ The rename table in §1 (or push back on any specific rename)
- ✅ The file list in §2 (or call out any file I shouldn't touch)
- ✅ The "no aliases, no fallback" approach (clean cut)
- ✅ The execution order in §7

Once signed off, I'll execute Group A through E in sequence, with status updates
at each checkpoint. Any failure at a checkpoint pauses execution and waits for
your direction.
