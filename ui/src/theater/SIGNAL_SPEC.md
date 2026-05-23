# Agent Theater — Signal Spec for Backend (Piece B)

> **Status:** Proposal for the A2A backend agents. Theater UI is signal-ready
> per Phase 9 (`/agents-2`). Implementing this spec brings the back-row sub-
> agent consult animations to life on real scenarios.
>
> **Audience:** Whoever owns the A2A js agents at
> `C:\CHAINAIM3003\mcp-servers\DynDic3ent1\A2A\js\src\agents\`.
>
> **Scope:** Backend-only. No Theater UI changes are required if the strings
> below are followed exactly. If wording diverges, the Theater's regex in
> `src/theater/stage/useBackOfficeConsult.ts` is the single edit point.

---

## 0. Findings recap

Verified by reading the A2A source on 2026-05-23:

- **Buyer agent already auto-verifies + auto-fetches** on `start negotiation`.
  No chat-command chaining is needed. The buyer's `startNegotiation` method
  unconditionally calls `verifyCounterparty()` + `readAgentCardMetadata()`
  before sending the first offer, in both plain and vLEI modes.
- **Buyer broadcasts its identity-check messages via SSE** (`this.respond()`).
  Plain-mode success: `✓ Seller plain-mode identity check passed (NOT vLEI
  — GLEIF + agent card only) — proceeding`. vLEI-mode success: `✅ Seller
  vLEI delegation chain verified (…) — proceeding`. Phase A of this work
  taught the Theater to detect these patterns and play the
  VerificationRiver in plain mode too. **Done. No backend change needed.**
- **Seller's identity check of the buyer is `logInternal`-only.** It does
  NOT broadcast via SSE. This is asymmetric. See §3 for the optional fix.
- **Credit / inventory / logistics agents are REST-only.** They expose
  `POST /consult`, `GET /health`, `GET /fixture`. No SSE broadcaster.
- **Treasury agent has SSE.** It broadcasts on its `/consult` REST handler:
  one message on receipt (`📨 Seller → Treasury …`) and one on response
  (`🏦 Treasury → Seller …`). This is the template to copy.

---

## 1. The change in one sentence

Each of the three sub-agents (`credit-agent`, `inventory-agent`,
`logistics-agent`) should add an SSE endpoint and broadcast on `POST
/consult` exactly the way `treasury-agent` does today, using the exact
strings in §2.4 below.

That's the entire Piece B. The Theater needs **zero changes** if the
strings match.

---

## 2. Per-sub-agent spec

For each of the three sub-agents below, the change is the same shape — add
SSEBroadcaster, broadcast on `/consult` start, broadcast on `/consult`
response. Each sub-agent has a different emoji + color, listed per agent.

### 2.1 Files to touch

- `A2A/js/src/agents/credit-agent/index.ts`
- `A2A/js/src/agents/inventory-agent/index.ts`
- `A2A/js/src/agents/logistics-agent/index.ts`

### 2.2 Imports to add

Match the treasury-agent's existing pattern:

```ts
import { SSEBroadcaster } from "../../shared/sse-broadcaster.js";

const sseBroadcaster = new SSEBroadcaster("credit");      // or "inventory" / "logistics"
```

The channel name (`"credit"` / `"inventory"` / `"logistics"`) becomes the
SSE path segment. Default is `/negotiate-events` on each agent's port; the
broadcaster handles that internally — no manual route wiring needed beyond
what treasury already does.

### 2.3 Broadcast placement

Inside each agent's `POST /consult` handler, broadcast TWICE:

**(A) On receipt** — first thing after the input validation that today
exists in each agent's file. Before any fixture load or computation.

**(B) On response** — immediately before `res.json(result)`. After the
verdict is computed, before the HTTP response goes out.

This mirrors treasury's existing structure (verified in
`A2A/js/src/agents/treasury-agent/index.ts` lines ~330–400). Keep the
`logInternal` and `console.log` server-side debug output untouched; SSE is
additive, not replacing them.

### 2.4 Exact strings

Theater regex matches these via tolerant case-insensitive patterns, so
small wording variations are OK. But following these exact strings means
**zero Theater changes**. Each string is one SSE broadcast call.

**Credit agent — port 7071:**

```ts
// (A) On receipt
sseBroadcaster.broadcast(
  `📨 Seller → Credit\n` +
  `Consultation request\n` +
  `Neg    : ${input.negotiationId}\n` +
  `LEI    : ${input.lei}\n` +
  `Round  : ${input.round ?? "?"}`
);

// (B) On response — after result is computed
const verdictLine = result.success
  ? `${result.creditGrade} ✓ ${result.recommendation}`   // e.g. "AAA ✓ GOOD"
  : `FLAG ✗ ${result.reason ?? "credit check failed"}`;  // e.g. "FLAG ✗ HIGH RISK"

sseBroadcaster.broadcast(
  `💳 Credit → Seller\n` +
  `Neg    : ${input.negotiationId}\n` +
  `${verdictLine}`
);
```

**Inventory agent — port 7072:**

```ts
// (A) On receipt
sseBroadcaster.broadcast(
  `📨 Seller → Inventory\n` +
  `Consultation request\n` +
  `Neg     : ${input.negotiationId}\n` +
  `Product : ${input.productCode}\n` +
  `Qty     : ${input.quantity.toLocaleString()}`
);

// (B) On response
const verdictLine = result.success && result.availableQty >= input.quantity
  ? `RESERVED ${input.quantity.toLocaleString()}`
  : `OUT OF STOCK — only ${result.availableQty ?? 0} available`;

sseBroadcaster.broadcast(
  `📦 Inventory → Seller\n` +
  `Neg     : ${input.negotiationId}\n` +
  `${verdictLine}`
);
```

**Logistics agent — port 7073:**

```ts
// (A) On receipt
sseBroadcaster.broadcast(
  `📨 Seller → Logistics\n` +
  `Consultation request\n` +
  `Neg    : ${input.negotiationId}\n` +
  `Route  : ${input.originPort} → ${input.destinationPort}\n` +
  `Qty    : ${input.quantity.toLocaleString()}`
);

// (B) On response
const verdictLine = result.success
  ? `OK ${result.transitDays} DAYS — ${result.carrier ?? "carrier"}`
  : `UNAVAILABLE — ${result.reason ?? "no route"}`;

sseBroadcaster.broadcast(
  `🚚 Logistics → Seller\n` +
  `Neg    : ${input.negotiationId}\n` +
  `${verdictLine}`
);
```

### 2.5 Pattern requirements for the Theater regex

The Theater's `useBackOfficeConsult.ts` matches:

| Direction | Theater regex |
|---|---|
| Start | `Seller → <Agent>` (or `->` / `-->`) without a matching `<Agent> → Seller` in same text |
| End | `<Agent> → Seller` (case-insensitive) |
| Approved keywords | `✓`, `APPROVED`, `OK`, `AVAILABLE`, `RESERVED`, `GOOD`, `A`/`AA`/`AAA[+-]?` |
| Rejected keywords | `✗`, `REJECTED`, `FAIL`, `OUT OF STOCK`, `INSUFFICIENT`, `FLAG`, `HIGH RISK`, `UNAVAILABLE`, `POOR` |

As long as the start broadcast contains `Seller → Credit` (etc.) and the
end broadcast contains `Credit → Seller` plus a recognizable approved or
rejected keyword, animation will fire. The emoji is decorative — Theater
ignores it for matching but displays it in the chip text where relevant.

### 2.6 Agent-card / vLEI verification (per Q3)

Currently the buyer's vLEI verification covers only the seller's main
agent card (`jupiterSellerAgent`). It does not verify the sub-agents
individually. Per Q3 ("Yes — verify both sides automatically (full trust
chain visible)"), the spec aspires to extend that, but **this is a
scope-expansion item, not part of Piece B's minimum**:

- **Minimum (Piece B):** broadcasts as in §2.4. Sub-agents appear as
  internal modules; their LEI in the Theater is `—` (no separate identity).
- **Optional follow-up:** give each sub-agent its own agent card under
  `A2A/js/agent-cards/jupiter<Credit|Inventory|Logistics>Agent-card.json`
  with the same LEI as the seller and a sub-delegated AID. Update
  `IDENTITIES` in `src/theater/shared/identities.ts` to fill in the real
  AIDs. This is the same pattern treasury uses today.

Recommend **deferring** the optional follow-up to a later iteration; it
adds complexity to the agent-card resolution paths without changing
visualization.

---

## 3. Optional: Seller's verify-of-buyer should also broadcast (asymmetry fix)

**Current behavior** (verified, seller-agent/index.ts §handleBuyerOffer):

```ts
const mode = (process.env.CREDENTIAL_MODE ?? "plain").toLowerCase();
logInternal(`[identity] mode=${mode} — verifying tommyBuyerAgent`);
const vLEIResult = await verifyCounterparty("seller", "DEEP-EXT");
// ...
const proceedMsg = vLEIResult.verificationType === "DISABLED"
  ? `[identity] Buyer plain-mode check passed (NOT vLEI — GLEIF + agent card only) — proceeding`
  : `[identity] Buyer vLEI delegation verified (...) — proceeding`;
logInternal(proceedMsg);    // ← only terminal log, NOT SSE
```

Note `logInternal()` instead of `this.respond()`. So the seller's
identity-check of the buyer is invisible to anyone watching the SSE
stream.

**Suggested change:** replace `logInternal(proceedMsg)` with both
`logInternal(proceedMsg)` and `this.respond(bus, taskId, contextId,
proceedMsg.replace(/^\[identity\]\s*/, ''))`. Two lines.

**Why it matters:** the Theater's VerificationRiver fires on `identity
check passed` / `delegation chain verified` patterns. Today it only sees
the BUYER's verify of the seller. With this two-line change, the river
plays TWICE per negotiation start — once when the buyer verifies the
seller, once when the seller verifies the buyer. The existing 5-second
Theater-side debounce will prevent double-play; in practice the two
verifies happen ~hundreds of ms apart, well inside the debounce window,
so the user sees one river play backed by both directions of verification
happening underneath.

Verdict: **safe to do, makes the trust chain bidirectional in the SSE
record**, but cosmetic for the Theater's visualization given the debounce.

---

## 4. Verification procedure

After implementing Piece B, you can verify with the Theater's existing
debug panel — the debug buttons (`▶ Test credit consult (approve)`, etc.)
already construct the exact patterns the new broadcasts will produce. So:

1. Run a real scenario in `/agents-2` with seller mode set to
   `L1_DELEGATED_ADVISORS` or higher (so credit/inventory/logistics are
   actually consulted).
2. Watch for the same spotlight + thinking ring + verdict chip animations
   that the debug buttons trigger today.
3. Cross-check that the chip text matches what the sub-agent actually
   broadcast in step (B) above.

If animations don't fire on real consults but the debug buttons still
work, the regex isn't matching the broadcast text. Open the Debug panel
in the Theater and look at the SSE event log — the raw broadcast text is
visible there. Compare against the patterns in §2.5 and adjust either the
backend text or the regex in `useBackOfficeConsult.ts`.

---

## 5. Estimated effort

Pure backend, no Theater changes if §2.4 strings are followed exactly:

| Task | Files | Lines |
|---|---|---|
| Add SSEBroadcaster to credit-agent + broadcast (A) and (B) | 1 | ~12 |
| Same for inventory-agent | 1 | ~12 |
| Same for logistics-agent | 1 | ~12 |
| Optional §3: seller's verify-of-buyer broadcast | 1 | 2 |
| **Total** | **3–4** | **~38–40 lines** |

Per-agent rough time: 15 minutes if you copy the pattern from
treasury-agent's `/consult` handler verbatim.

---

## 6. What this does NOT cover

- **Per-sub-agent identity / LEI display.** The Inspector shows the new
  sub-agents with `lei: '—'` and `agentAID: undefined`. To give them real
  identities, see §2.6 — deferred.
- **DD invoice involvement.** The post-deal DD flow (IPEX grant/admit,
  ACTUS) is treasury-driven and already works. Sub-agents have no role
  there.
- **Per-round consult history in the Inspector.** Today clicking a
  sub-agent in the Theater shows only its identity card. Showing a list
  of past consults for that agent (with timestamps, prices queried,
  verdicts) is a Phase-10-or-later UI feature, not a backend dependency.
- **Parallel-consult ordering on the wire.** The seller's `consultAll`
  already runs sub-agent consults via `Promise.all` (verified in
  consultation-router.ts). So the three sub-agents' broadcasts will land
  interleaved in their natural completion order. The Theater renders them
  per-agent, no ordering coordination needed.

---

## 7. Sign-off checklist for backend implementer

- [ ] credit-agent broadcasts on `/consult` start AND response (§2.4)
- [ ] inventory-agent broadcasts on `/consult` start AND response
- [ ] logistics-agent broadcasts on `/consult` start AND response
- [ ] All three broadcast strings contain `Seller → <Agent>` (start)
      and `<Agent> → Seller` (end), spelled exactly that way
- [ ] End broadcasts contain at least one recognizable
      approved/rejected keyword from §2.5
- [ ] (Optional §3) seller's identity-check messages broadcast via SSE
- [ ] Theater `/agents-2` plays back-office animations on a real
      L1_DELEGATED_ADVISORS+ scenario without touching its code

Once all items check, Phase 9's signal-ready scaffold becomes fully live.

---

_Last updated: 2026-05-23 (Phase 9 Piece A + spec for Piece B)._
