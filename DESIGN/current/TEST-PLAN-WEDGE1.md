# WEDGE1 Test Plan

**Version:** 1.2
**Last updated:** 2026-05-17
**Status:** Live document — updated as each WEDGE1 commit lands.

**v1.2 changes:** Added T1.5 — unit-test for the legacy-CLI dual-parser
(`src/shared/cli-parser.ts`). This is Guarantee A's first regression
test that doesn't require running agents — a pure-function check that
catches breakage of `start negotiation 300` before it reaches any agent code.

**v1.1 changes:** §T2 — corrected the "Known divergences" note to reflect
that bilateral-accept echo is excluded via the `reasoning includes "bilateral"`
heuristic (matching `logger.ts:printLog`), not via the `EXTERNAL_TYPES` filter
(because the echo's `messageType` is `"ACCEPT"`, which IS in `EXTERNAL_TYPES`).
First test run on `NEG-1779035441619` correctly caught this bug in the test
script itself; fix landed in `scripts/test-envelope-ordering.ts` same day.

This document lists the explicit test procedures for each WEDGE1 guarantee
and feature. Run these before any demo dry-run; **all must pass before
shipping WEDGE1.**

---

## T1. Guarantee A — legacy CLI continues to work (manual integration test)

**Goal:** prove that `start negotiation 300` works exactly as it does today
throughout WEDGE1 development. No regression in behavior or audit format
visible to existing code paths.

### Procedure

```bash
# From repository root: C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js\

# 1. Start the three agents (in three separate terminals)
npx tsx src/agents/seller-agent/index.ts       # port 8080
npx tsx src/agents/buyer-agent/index.ts        # port 9090
npx tsx src/agents/treasury-agent/index.ts     # port 7070

# 2. From a fourth terminal, start the CLI
npx tsx src/cli.ts

# 3. At the CLI prompt, run the legacy command
> start negotiation 300

# Expected behavior:
#   - Buyer agent opens at ₹300 (the bare number)
#   - 3-round negotiation runs to completion (success or escalation)
#   - Two new audit files appear in src/escalations/:
#       NEG-{timestamp}_success_BUYER.audit.json
#       NEG-{timestamp}_success_SELLER.audit.json
#   - Audit JSON shape unchanged from previous product baseline
```

### Pass criteria

- ✅ Negotiation completes (success or escalation, both are valid)
- ✅ Both audit files written
- ✅ Audit JSON contains the expected top-level fields:
  `negotiationId`, `perspective`, `outcome`, `parties`, `negotiation`,
  `outcomeQuality`, `logs`
- ✅ `logs[]` array has entries for each round with `from`, `messageType`,
  `decision`, `timestamp`, `negotiationId`
- ✅ Audit format remains backward-compatible (new optional fields like
  `envelopeCounter`/`envelopeHash` are allowed to be absent)
- ✅ Post-run: T2 (`test-envelope-ordering.ts`) and T3 (`test-tamper.ts`)
      both still pass

### Fail criteria

- ❌ Negotiation hangs or crashes
- ❌ Audit files missing or malformed
- ❌ Existing required fields (`negotiationId`, `parties`, etc.) missing or
  renamed
- ❌ Existing tests (`scripts/test-tamper.ts`, etc.) fail

---

## T1.5. Guarantee A — CLI parser unit test (automated, no agents needed)

**Goal:** prove that `parseNegotiationCommand()` correctly handles every
form of `start negotiation` input, with special focus on the legacy
bare-number form. This is the cheapest insurance against Guarantee A
breakage — runs in 1 second, exits with a clear code, and catches a whole
class of CLI parsing regressions before they reach any agent code.

### Procedure

```bash
cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js\
npx tsx scripts/test-cli-parser.ts
```

### What it tests

The test exercises `parseNegotiationCommand()` across five sections:

| § | What it checks | Key inputs |
|---|---|---|
| §1 | Legacy bare-number form (Guarantee A core) | `start negotiation 300`, `start negotiation 250`, `start negotiation`, whitespace variants |
| §2 | Non-negotiation input is rejected (returns null) | `hello`, empty string, command embedded mid-text |
| §3 | Flagged multi-dimensional form | full 5-flag invocation, valid styles |
| §4 | Malformed inputs return `{form: "invalid", error: ...}` | missing required flags, bad numbers, unknown style, unparseable date |
| §5 | TypeScript discriminated-union ergonomics | exhaustive type narrowing without casts |

### Expected output

```
══════════════════════════════════════════════════════════════
  WEDGE1 / Guarantee A — CLI Parser Unit Test
══════════════════════════════════════════════════════════════

§1 Legacy bare-number form — Guarantee A invariant
  ✓ "start negotiation 300" → legacy with price 300
  ✓ "start negotiation 250" → legacy with price 250
  ✓ "start negotiation" (no price) → legacy with no price
  ✓ "  start negotiation 300  " (extra whitespace) → legacy with price 300
  ✓ "start negotiation    300" (multiple spaces) → legacy with price 300

§2 Non-negotiation input — parser returns null
  ✓ "hello" → null
  ✓ "" (empty) → null
  ✓ "how do i start negotiation" (start negotiation not at beginning) → null

§3 Flagged multi-dimensional form
  ✓ full flagged form → flagged with all fields
  ✓ flagged with cooperative style → flagged with style "cooperative"

§4 Invalid forms — parser returns { form: "invalid", error: ... }
  ✓ "start negotiation foo" → invalid
  ✓ flagged missing required flags → invalid
  ✓ flagged with --qty -50 (negative) → invalid
  ✓ flagged with --buyer-budget 0 → invalid
  ✓ flagged with unknown --buyer-style "chaotic" → invalid
  ✓ flagged with bad --buyer-deadline → invalid

§5 TypeScript discriminated-union ergonomics
  ✓ discriminated-union routing for legacy → "legacy:300"

══════════════════════════════════════════════════════════════
  ✓ 17 passed, 0 failed
  Guarantee A invariant holds: legacy bare-number form is byte-identical.
══════════════════════════════════════════════════════════════
```

### Pass criteria

- ✅ All assertions in §1 pass — Guarantee A's core invariant holds
- ✅ Exit code 0

### Fail criteria

- ❌ Any §1 assertion fails — **DO NOT MERGE** any change that touches CLI parsing
- ❌ Any §2–§5 assertion fails — fix the parser before continuing

### When to run

- Before every commit that touches `src/shared/cli-parser.ts`
- Before every commit that touches the `execute()` method of either agent
- As a sanity check before T1 (saves you starting agents if the parser is already broken)

---

## T2. Guarantee C — message-ordering invariant

**Goal:** prove that BUYER's and SELLER's audits agree on the
externally-visible event sequence for the same negotiation.

### Procedure

```bash
# After T1 has run a negotiation (or any other negotiation that produced
# a BUYER + SELLER audit pair in src/escalations/), run:

cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js\
npx tsx scripts/test-envelope-ordering.ts

# To test a specific historical negotiation:
npx tsx scripts/test-envelope-ordering.ts NEG-1779035441619
```

### Expected output (Phase 1 — before agent instrumentation lands)

```
══════════════════════════════════════════════════════════════
  WEDGE1 / Guarantee C — Message-Ordering Invariant Test
══════════════════════════════════════════════════════════════

  Testing: NEG-1779035441619

  BUYER audit:  NEG-1779035441619_success_BUYER.audit.json
  SELLER audit: NEG-1779035441619_success_SELLER.audit.json

  ⚠ Phase 2 instrumentation not yet present
      envelopeCounter populated: BUYER 0/5, SELLER 0/5
      Falling back to (timestamp, direction) ordering.
      Internal entries excluded from comparison: BUYER 0, SELLER 1

  Externally-visible event sequence (...):
  ...

  ✓ INVARIANT HOLDS
```

### Pass criteria (Phase 1)

- ✅ Script runs without error
- ✅ Both audit files load successfully
- ✅ Externally-visible sequences are byte-identical (event for event)
- ✅ Exit code 0

### Pass criteria (Phase 2 — after agent instrumentation)

- ✅ All of the above, AND
- ✅ Script reports `Phase 2 instrumentation present`
- ✅ Ordering key used is `envelopeCounter` (not the timestamp fallback)

### Known divergences (acceptable, deliberately excluded from the invariant)

These are NOT bugs — they are agent-internal log entries that exist on one
side but never travel over the wire, so the counterparty never sees them.
The test excludes them so the invariant focuses on what really matters:
the order of events both sides observed.

- **Round labels** can differ between BUYER and SELLER perspectives (e.g.
  ACCEPT message lives in R2 in seller's view, R3 in buyer's). The
  invariant excludes `round` from the projected tuple, so this divergence
  does not fail the test. **Round-label divergence is documented behavior,
  not a bug.**

- **SELLER's bilateral-accept echo** — when the buyer's ACCEPT message
  closes the deal, the seller's code logs an internal entry confirming the
  acceptance (`reasoning: "bilateral acceptance rule"`), but does not send a
  message back to the buyer (deal is already closed). The test excludes any
  log entry where `decision === "ACCEPT"` AND `reasoning` includes
  `"bilateral"`, matching the suppression heuristic used by `logger.ts`'s
  terminal printer. **Filtering is `reasoning`-based, NOT type-based** — the
  entry's `messageType` is `"ACCEPT"`, which is correctly in `EXTERNAL_TYPES`;
  only the reasoning field tells us it's the internal echo.

- **TREASURY_OVERRIDE entries** — the seller's pre-decision treasury check
  log entry. Internal to seller; never sent. `messageType` is not in
  `EXTERNAL_TYPES`, so excluded automatically.

### Fail criteria

- ❌ Externally-visible sequences disagree at any position
- ❌ Audit file missing the `logs[]` array
- ❌ Script exits with code 1 (invariant violation) or 2 (missing audit pair)

### What we verified on first run (2026-05-17)

`NEG-1779035441619` audit pair (generated earlier today at 16:30 UTC) was the
first test target. The test correctly caught one bug — in the test script
itself, not in the audits:

- BUYER's externally-visible sequence had 5 events
- SELLER's externally-visible sequence appeared to have 6 events (one extra
  at position 5: the bilateral-accept echo)
- The test reported `INVARIANT VIOLATED` because the v1.0 filter only checked
  `messageType`, which couldn't distinguish the bilateral echo from a real
  ACCEPT (both have `messageType: "ACCEPT"`)
- Fix in v1.1: filter now ALSO excludes entries where `reasoning` includes
  `"bilateral"`, matching `logger.ts:printLog()`'s existing convention
- After the fix, both sequences have 5 events and match byte-for-byte ✓

The bug-find counts as a passing first test: the invariant test detected an
inconsistency that needed explaining, and the explanation correctly led to a
clarification of what counts as "externally-visible." Same workflow will
catch real protocol bugs in future.

---

## T3. Tamper / replay protection (already shipping in iter-2)

**Goal:** confirm iter-2's envelope tamper-detection still works. This is the
foundation Guarantee C builds on.

### Procedure

```bash
cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js\
npx tsx scripts/test-tamper.ts
```

### Pass criteria

- ✅ All 7 tamper tests pass (happy path, payload tamper, replay, stale,
  future, wrong receiver, missing envelope)

---

## T4. Multi-dimensional negotiation (Phase 2+, after ADVANCED tier lands)

**Goal:** verify the new 6-field opening form produces multi-dimensional
counters, all 4 sub-agents consult correctly, and the audit reflects
multi-dimensional state.

*Procedure TBD — drafted when tier framework + sub-agent code lands.*

---

## T5. Demo dry-run

**Goal:** rehearse the 6-minute demo end-to-end and confirm all three scenes
work as scripted in `AGENTIC-PROCUREMENT-ARCHITECTURE.md` §7.3.

*Procedure TBD — drafted when UI + sub-agents are wired.*

---

## Running the full test suite (post-WEDGE1)

```bash
# Pure automated tests — no agents needed (~3 sec total)
npx tsx scripts/test-cli-parser.ts                # T1.5
npx tsx scripts/test-tamper.ts                    # T3
npx tsx scripts/test-envelope-ordering.ts         # T2 (latest audit pair)

# Full check including a fresh negotiation (~60 sec)
# 1. Start agents (T1 setup)
# 2. Run `start negotiation 300` in CLI
# 3. Run T1.5 + T2 + T3 as above
```

---

## Pre-ship checklist (May 19 AM)

Before declaring WEDGE1 shipped:

- [ ] T1 passes — legacy CLI works end-to-end (manual)
- [ ] **T1.5 passes — CLI parser unit test (automated)**
- [ ] T2 passes — message ordering invariant holds (Phase 2 ideally; Phase 1 minimum)
- [ ] T3 passes — tamper protection unchanged
- [ ] T4 passes — multi-dimensional negotiation works (when implemented)
- [ ] T5 passes — demo dry-run clean 3 times in a row
- [ ] Existing dashboard at `/deal-quality` and `/settings` opens and renders
      unchanged (Guarantee B visual check)
- [ ] `npx tsx scripts/test-cli-parser.ts` exits 0
- [ ] `npx tsx scripts/test-tamper.ts` exits 0
- [ ] `npx tsx scripts/test-envelope-ordering.ts` exits 0

If any of the above fails, **WEDGE1 does not ship**.
</content>