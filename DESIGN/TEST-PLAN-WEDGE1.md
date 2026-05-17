# WEDGE1 — Test Plan

**Doc version:** v1.2 (M1 landed)
**Codebase root:** _(local clone of DynDic3ent1)_
**Last updated:** 2026-05-17

> Path convention used throughout this doc: every shell example starts at the
> repo root (the directory containing `A2A/`, `DESIGN/`, `ui/`, etc.). Adjust
> the initial `cd` to wherever you cloned the repo on your machine.

---

## Purpose

A single source of truth for the verification gates each WEDGE1 milestone
must clear before the next one starts. Each test is a runnable script under
`A2A/js/scripts/` (backend) or a manual UI check (frontend). Tests are
additive — once green, they must stay green for every subsequent milestone.

## Three non-negotiable WEDGE1 guarantees

These are the invariants every test below is ultimately defending:

- **Guarantee A** — `start negotiation 300` produces a byte-identical
  on-the-wire conversation to the prior product. Adding the tier framework
  must not change the legacy bare-number form's behavior.
- **Guarantee B** — Existing UI screens are untouched. Only `/negotiations/new`
  and additive cards on `/settings` are introduced for WEDGE1.
- **Guarantee C** — Message ordering is canonical: every saved audit
  references the same envelope counter and payload hash on both sides.

---

## Test inventory

| ID    | Name                                  | Type     | Owner    | Script / Procedure                       | First introduced |
|-------|---------------------------------------|----------|----------|------------------------------------------|------------------|
| T1    | Manual `start negotiation 300` deal   | manual   | operator | CLI command via /agents chat             | pre-WEDGE1       |
| T1.5  | CLI parser unit test                  | unit     | dev      | `scripts/test-cli-parser.ts`             | Guarantee A      |
| T2    | Message-ordering invariant            | unit     | dev      | `scripts/test-envelope-ordering.ts`      | Guarantee C      |
| T3    | Tamper protection                     | unit     | dev      | `scripts/test-tamper.ts`                 | pre-WEDGE1       |
| T6    | **Tier resolver invariants** (NEW)    | unit     | dev      | `scripts/test-tier-resolver.ts`          | **M1**           |
| T7    | (reserved) ADV2 audit-shape check     | unit     | dev      | (M2)                                     | M2               |
| T8    | (reserved) Defensive branch — outage  | manual   | operator | (M2)                                     | M2               |
| T9    | (reserved) /negotiations/new UI flow  | manual   | operator | (M3)                                     | M3               |

T4 and T5 are placeholder IDs reserved for future test categories so existing
numbering stays stable.

---

## T1 — Manual `start negotiation 300` deal

**Purpose:** End-to-end smoke test that the prior product still works after each milestone.

**Setup:**
1. Three terminals — start seller (`:8080`), buyer (`:9090`), treasury (`:7070`) agents:
   ```bash
   cd A2A/js   # from repo root
   npx tsx src/agents/seller-agent/index.ts
   npx tsx src/agents/buyer-agent/index.ts
   npx tsx src/agents/treasury-agent/index.ts
   ```
2. Fourth terminal — start UI:
   ```bash
   cd ui   # from repo root
   npm run dev
   ```
3. Open http://localhost:5173/agents

**Procedure:**
1. Type `start negotiation 300` in the buyer chat.
2. Verify identity check passes (or skip with confirmation if vLEI off).
3. Watch negotiation proceed through ≤ 3 rounds.

**Pass criteria:**
- Deal closes at a finite price (typically ₹370 with current LLM/fallback).
- Pair of audit JSON files written: `src/escalations/NEG-*_success_{BUYER,SELLER}.audit.json`.
- DD auto-accept fires at invoice date and ACTUS reports SUCCESS.

**Reference run:** `NEG-1779046320818` (2026-05-17) closed at ₹370, savings ₹23,599.98, ACTUS SUCCESS.

---

## T1.5 — CLI parser unit test

**Purpose:** Guard the dual-parser invariant — legacy `start negotiation 300`
form continues to route exactly as before; flagged multi-dim form is
recognized and routed to a stub; invalid forms produce explicit errors
instead of silent random-price fall-through.

**Run:**
```bash
cd A2A/js   # from repo root
npx tsx scripts/test-cli-parser.ts
```

**Pass criteria:** `17 passed, 0 failed`, exit 0.

---

## T2 — Message-ordering invariant

**Purpose:** Verify the envelope counter is monotone and that buyer/seller
audit pairs agree on counter values and payload hashes for the same logical
events. This is the wire-level statement of Guarantee C.

**Run:**
```bash
cd A2A/js   # from repo root
npx tsx scripts/test-envelope-ordering.ts
```

**Pass criteria:** All 5 logical events match between BUYER and SELLER audit
JSONs by `(envelopeCounter, envelopeHash)`. Exit 0.

**Run-after rule:** Re-run any time `T1` is re-run, against the newest audit
pair, before declaring a milestone done.

---

## T3 — Tamper protection

**Purpose:** Verify any byte-level modification of a sealed message is
rejected by the receiver.

**Run:**
```bash
cd A2A/js   # from repo root
npx tsx scripts/test-tamper.ts
```

**Pass criteria:** `20 passed, 0 failed`, exit 0.

---

## T6 — Tier resolver invariants  *(NEW in M1)*

**Purpose:** Verify the tier framework's resolver behaves correctly across
every supported env permutation, before any agent code consumes it. Pure
unit-level — no agents needed.

**Background:** M1 introduces `src/shared/negotiation-mode.ts` which exposes:
- `resolveTier()` — reads `NEGOTIATION_MODE`, defaults to `BASIC1` if unset.
- `validateTier()` — adds the shippability gate (`BASIC1 | ADV1 | ADV2` only).
- `getResolvedCapabilities(tier)` — returns the per-tier boolean cap matrix.
- `resolveProviderModes()` — reads `INVENTORY_MODE`, `LOGISTICS_MODE`, `CREDIT_MODE` (default `demo`).
- `resolveEvaluationContext()` — reads `EVALUATION_CONTEXT` (default `live`).
- `buildNegotiationModeBlock()` — assembles the audit-JSON block embedded by `logger.saveAuditJson()`.

All env reads are **lazy** (not at module load), because agents call
`dotenv.config()` *after* their imports. Reading at module load would see
pre-dotenv values.

**Run:**
```bash
cd A2A/js   # from repo root
npx tsx scripts/test-tier-resolver.ts
```

**Test bands inside the script:**

| §  | Subject                                                            | Key assertions                                                                                       |
|----|--------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| §1 | Default env (everything unset) — backward compat with prior product | `resolveTier({}) === "BASIC1"`, providers all `demo`, eval context `live`, BASIC1 caps as expected   |
| §2 | Each shippable tier value resolves correctly                       | `BASIC1`, `ADVANCED1`, `ADVANCED2` (incl. case-insensitive); ADV1/ADV2 cap-matrix sanity             |
| §3 | Post-WEDGE1 tiers (ADV3 / ADV4) rejected by `validateTier`         | `validateTier` throws `/not yet supported/i`; `resolveTier` still returns the value (audit can record) |
| §4 | Invalid `NEGOTIATION_MODE` rejected with helpful error             | Error message contains `Invalid NEGOTIATION_MODE` and mentions `BASIC1`                              |
| §5 | Provider modes default to `demo`, reject unknown                   | mixed values resolve; uppercase `REAL` accepted; `mock`/`sandbox` throw                              |
| §6 | Evaluation context default `live`, rejects unknown                 | `paper-trade`, `replay` accepted; `prod` throws                                                      |
| §7 | `buildNegotiationModeBlock` end-to-end shape                       | full block populated; `resolvedFromEnv` echoes raw env values incl. `null` for unset                 |

**Pass criteria:** All assertions pass; banner reads `Tier resolver invariants
hold. M1 foundation green.`; exit 0.

**Failure-mode catalog (what to suspect if a section fails):**

| Failing section | Likely root cause |
|-----------------|-------------------|
| §1 | Default-tier accidentally changed away from `BASIC1` — Guarantee A break. |
| §2 | Cap matrix in `getResolvedCapabilities` modified; check ADV1/ADV2 booleans. |
| §3 | Shippability gate widened — should remain `{BASIC1, ADV1, ADV2}` for WEDGE1. |
| §4 | Validation removed or message reworded; tighten the test or restore message. |
| §5 / §6 | New value added without matching the validator set. |
| §7 | `resolvedFromEnv` shape changed; downstream UI may break too. |

---

## M1 gate procedure

Run in order. **Stop at the first failure** and fix before continuing.

```bash
cd A2A/js   # from repo root

# 1) Backend unit tests
npx tsx scripts/test-cli-parser.ts        # T1.5
npx tsx scripts/test-tamper.ts            # T3
npx tsx scripts/test-tier-resolver.ts     # T6  (NEW)

# 2) Kill orphans (Windows; Linux/Mac use `pkill -f tsx`)
taskkill //F //IM node.exe

# 3) Start 3 agents in 3 terminals (see T1 above) and verify buyer startup
#    banner prints a "── WEDGE1 tier framework ──" section listing tier=BASIC1
#    by default.

# 4) Run T1 (manual): `start negotiation 300` in the UI chat. Confirm deal closes.

# 5) Inspect the new audit JSON. Open the freshest:
#      src/escalations/NEG-<id>_success_BUYER.audit.json
#    Expect a top-level negotiationMode block:
#      "negotiationMode": {
#        "tier": "BASIC1",
#        "resolvedCapabilities": { ... 10 booleans ... },
#        "providerModes": { "inventory": "demo", "logistics": "demo", "credit": "demo" },
#        "evaluationContext": "live",
#        "resolvedFromEnv": { "NEGOTIATION_MODE": null, ... }
#      }

# 6) T2 against the new audit
npx tsx scripts/test-envelope-ordering.ts

# 7) UI verification
cd ../../ui   # from A2A/js, go up to repo root then into ui
npm install && npm run dev
#   open http://localhost:5173/settings
#   expected on the page (top to bottom):
#     - existing "Trust posture" 2×2 matrix card
#     - NEW "Negotiation tier framework" card with:
#         * Active badge: "BASIC1 (default)"
#         * 5 tier rows; ADV3/ADV4 grayed with "post-WEDGE1"
#         * Provider modes mini-table (3 cells: inventory/logistics/credit = demo)
#         * Evaluation context badge: "live (default)"
#         * Change-instructions footer
#     - existing Baseline panel
```

**M1 is GREEN** when all 7 steps pass without operator intervention.

---

## Test running rules

- **Re-run T1.5 + T3 + T6** before declaring any milestone done. They take
  ~3 seconds combined.
- **Re-run T2** after every fresh T1, against the newest audit pair.
- **Never modify** a test to make it pass. If a test goes red after a code
  change, the code is wrong, not the test (unless the test itself was
  documenting a deliberately-changed behavior, in which case both code AND
  test changes land in the same commit with a `[BEHAVIOR-CHANGE]` tag).

---

## Future test slots (placeholders)

| ID  | Will land in | Subject |
|-----|--------------|---------|
| T7  | M2           | ADV2 audit shape — every closed deal at ADV2 must carry `consultations[]`, `tacticsTrace`, `roundOutcome`. |
| T8  | M2           | Defensive-branch behavior under simulated EDGAR outage — must produce `defensiveAction: "refused-deferred-terms"` rather than silently failing. |
| T9  | M3           | Manual: `/negotiations/new` 6-field form opens a real negotiation, round timeline streams, drill-down panel renders. |
| T10 | M3           | PDF Section 9 contains provenance for each consultation + tactics chain. |
| T11 | M4           | Full 6-minute demo runs 3 consecutive times from clean state with no manual fix-ups. |
