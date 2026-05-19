# DESIGN2 — Changelog

> **Document under change-control:** `DESIGN2/design-2-detailed-design.md`
> **Predecessor:** `DESIGN1/design-1-detailed-design.md`
> **Codebase reference:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\`
> **Identity substrate reference:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\vLEIEnh1\legentvLEI\`
> **Convention:** newest revision at the top.

---

## Revision 2 — 2026-05-15

### Headline

**Added a fourth orthogonal abstraction axis — `MessageSigner` — and made the system honest about what it does and doesn't cryptographically protect.** DESIGN1 had three axes (Strategy, LLM, Credential); DESIGN2 has four. The added axis covers per-message envelope signing on the A2A wire, which was completely absent in DESIGN1 because the gap had not yet been confirmed by full reads of the buyer and api-server code.

### Why this revision was needed

DESIGN1 was extracted from chat history before the detailed code reads. Two questions surfaced during stakeholder review that DESIGN1 could not answer with confidence:

1. **"Where is the code that sets up the system WITH or WITHOUT vLEI?"** — DESIGN1 referenced an `enabled` flag in `shared/vlei-verification-client.ts` but did not document that the flag is **dead code** (no env-var wiring), **dishonest** (returns `verified: true` with hardcoded identities when disabled), and **incomplete** (does not cover the four IPEX call sites).
2. **"How does message signing behave WITH and WITHOUT vLEI?"** — DESIGN1 did not address this. After full reads of `buyer-agent/index.ts` and `vLEIEnh1/legentvLEI/api-server/server.js`, the answer became visible: **message signing does not exist today at all**, in either mode. The cryptographic surface is identity-verification at session start plus ACDC issuance at session end; the wire between is plain HTTP.

DESIGN2 makes both answers explicit, adds the architectural primitive (`MessageSigner`) that closes the gap, and reframes the system as a **four-axis matrix** of 16 valid runtime configurations.

### Files changed

| File | Change |
|---|---|
| `entAgentProject11/DESIGN/DESIGN2/design-2-detailed-design.md` | **Rewritten (revision 2)**. Was a placeholder in revision 1. |
| `entAgentProject11/DESIGN/DESIGN2/CHANGELOG.md` | **Created** (this file). |
| `entAgentProject11/DESIGN/README.md` | **Created** as the design folder index. |

No files in `DESIGN1/` were modified. DESIGN1 is preserved as the historical record.

### Architecture deltas (DESIGN1 → DESIGN2)

#### 1. Four axes instead of three

| Axis | DESIGN1 | DESIGN2 |
|---|---|---|
| A — `NegotiationStrategy` | rules vs autonomous | rules vs autonomous (unchanged) |
| B — `LLMProvider` | groq vs gemini | groq vs gemini (unchanged) |
| C — `CredentialProvider` | plain vs vlei (covered touchpoints 1–3 only) | plain vs vlei (**now covers all six touchpoints**) |
| **D — `MessageSigner`** | **(did not exist)** | **plain vs vlei (NEW — per-message envelope signing on the A2A wire)** |

**Why the new axis was carved out separately rather than merged into Axis C:** identity verification (Axis C, touchpoints 1-2) is one-time and pre-negotiation. ACDC credential issuance (Axis C, touchpoints 3-6) is post-negotiation. Message envelope signing (Axis D) happens **on every A2A message between the two**. The three responsibilities have different call sites, different state (per-message nonce vs per-session AID vs per-deal SAID), and different failure semantics. Merging them would create a single bloated interface; separating them allows the May 18 build to run `CREDENTIAL_MODE=vlei` (real KERI identity verification) with `SIGNING_MODE=plain` (hash-only envelopes) as a valid intermediate configuration if needed.

#### 2. Six vLEI touchpoints inventoried (was three)

DESIGN1 named three vLEI-related call sites. DESIGN2 §2.1 contains the **complete inventory** of six, verified by full reads of both agent files:

| # | New in DESIGN2? | Site | File:line |
|---|---|---|---|
| 1 | (DESIGN1) | Buyer verifies seller pre-negotiation | `buyer-agent/index.ts:128` |
| 2 | (DESIGN1) | Seller verifies buyer on first OFFER | `seller-agent/index.ts:311` |
| 3 | (DESIGN1) | Seller issues invoice ACDC | `seller-agent/index.ts:562` |
| **4** | **NEW** | **Buyer admits invoice ACDC** | `buyer-agent/index.ts:220` |
| **5** | **NEW** | **Seller issues DD-invoice ACDC** | `seller-agent/index.ts:712` |
| **6** | **NEW** | **Buyer admits DD-invoice ACDC** | `buyer-agent/index.ts:364` |

This matters because the `CredentialProvider` abstraction now has to cover all six (one `verifyCounterparty` method, one `issueInvoiceCredential` method, one `admitInvoiceCredential` method), not just the verification half.

#### 3. The `MessageSigner` abstraction added

New file in the design: `shared/message-signer.ts`.

| Concept | Detail |
|---|---|
| Interface | `sign(message, session): Promise<Message>` and `verify(message, session): Promise<VerifyResult>` |
| Envelope shape | `secure-passport`-style metadata block on the A2A `Message`. Contains `clientId`, `sessionId`, `signature`, and a signed `state` object with `envelopeHash`, `negotiationId`, `round`, `fromAID`, `toAID`, `messageType`, `timestamp`, `nonce` |
| Implementation A — `PlainHashSigner` | Signature = `"PLAIN_HASH:" + sha256(canonicalJson(state))`. Protects against in-flight tampering and replay within a session. **Does not protect against identity forgery.** Pure JS, zero external dependencies. |
| Implementation B — `VleiSignifySigner` | Signature = `"KERI_ED25519:" + cesrSig` produced by **signify-ts** calling KERIA at `127.0.0.1:3902`. Keys come from the agent's `BRAN` seed (already present in `Legent/A2A/js/src/agents/JupiterTreasuryAgent/.env`). Closes identity forgery in addition to tampering and replay. |
| Integration points in code | Two per agent: outbound `sendToBuyer`/`sendToSeller` (one-line wrap), inbound top of `execute(ctx, bus)` (one block before dispatch switch) |

The design specifies that the signify-ts integration is a **Phase 2** task — Phase 1 (May 18) ships only `PlainHashSigner` wired in. The `VleiSignifySigner` class is scaffolded with `throw new NotImplementedError("Phase 2")` so the runtime selection mechanism exists end-to-end on May 18.

#### 4. Operating Principles expanded from 6 to 8

DESIGN1 had six operating principles. DESIGN2 adds two:

- **Principle 7 — Extensibility before fidelity.** The system MUST run end-to-end with `CREDENTIAL_MODE=plain` (no vLEI) and the same code MUST run with `CREDENTIAL_MODE=vlei`. The choice is an env-var, never a code edit. This formalizes the requirement that drove the original "Where is the code that sets up WITH/WITHOUT vLEI?" question.
- **Principle 8 — Honesty over convenience.** A `plain`-mode credential record MUST be labeled as such in the audit trail. It MUST NOT claim cryptographic verification it does not have. This replaces the existing `verificationType: "DISABLED"` returning `verified: true` pattern, which is dishonest.

#### 5. Defaults flipped from production to demo

| Variable | DESIGN1 default | DESIGN2 default | Why changed |
|---|---|---|---|
| `CREDENTIAL_MODE` | `vlei` | `plain` | Phase 1 ships May 18. Production default should be the one that always works on a laptop. Operators flip to `vlei` for full deployments. |
| `SIGNING_MODE` | (did not exist) | `plain` | New axis; demo-safe default. |
| `STRATEGY_MODE` | `autonomous` | `autonomous` | Unchanged. |
| `LLM_PROVIDER` | `gemini` | `gemini` | Unchanged. |

A startup-time constraint is also added: **`SIGNING_MODE=vlei` requires `CREDENTIAL_MODE=vlei`** (signing keys live in the same KERIA wallet as the delegation chain). The agent refuses inconsistent combinations and exits with a clear error — no silent coercion.

#### 6. Phasing plan expanded from 2 phases to 3

| Phase | DESIGN1 | DESIGN2 |
|---|---|---|
| Phase 1 (May 18) | "Treasury-only consultation, all axes wired" | "All four abstractions wired; only `plain` implementations active; `vlei` classes scaffolded with NotImplementedError" |
| Phase 2 (Jun 1) | "Three new sub-agents, GS1 schemas, full 4-way consultation" | Same — plus the actual `VleiProvider` and `VleiSignifySigner` implementations (signify-ts integration) |
| Phase 3 (post-Jun 1) | (did not exist as a separate phase) | "Hardening and standards alignment — formalize `secure-passport/v1` URI, `traceability/v1` schema, replay-window enforcement, KERIA HA" |

Splitting hardening into Phase 3 keeps the May 18 submission focused.

#### 7. Audit record extended

DESIGN1 specified two new optional fields on `NegotiationAudit`: `strategyTraces` and `consultations`. DESIGN2 adds a third:

```typescript
signingEvents?: Array<{
  timestamp:   string;
  direction:   "inbound" | "outbound";
  messageType: string;
  result:      VerifyResult;
  schemeLabel: "PLAIN_HASH" | "KERI_ED25519" | "NONE";
}>;
```

Every A2A message exchanged in the negotiation produces one entry. The audit reviewer can replay the wire and see exactly which scheme was in force per message.

#### 8. Security posture table added (§8)

DESIGN1's security section was a placeholder pointer to the 16-attack enumeration. DESIGN2 §8 contains a four-column threat × mode matrix:

| Threat | `plain+plain` | `vlei+plain` | `vlei+vlei` |
|---|---|---|---|
| Identity forgery | ❌ | ✅ | ✅ |
| In-flight tampering | ✅ (hash) | ✅ (hash) | ✅ (signature) |
| Replay within session | ✅ (nonce) | ✅ (nonce) | ✅ (nonce) |
| Message forgery claiming to be from verified counterparty | ❌ | ❌ | ✅ |
| Invoice ACDC inauthentic | ❌ | ✅ | ✅ |

This makes the limits of each mode explicit — so a reviewer or auditor can know exactly what `plain+plain` protects against and what it does not.

#### 9. Configuration banner formalized

DESIGN2 §5 specifies the agent startup banner that extends the existing Treasury config banner pattern:

```
🏪  Seller Agent  →  http://localhost:8080
    Strategy     : AUTONOMOUS   (LLM: gemini)
    Credentials  : PLAIN        (vLEI api-server NOT consulted)
    Signing      : PLAIN_HASH   (envelopes hashed, not KERI-signed)
    Treasury     : ✓ consulting http://localhost:7070/consult
```

Operators always know which mode is in force. Audit replay can cross-check the banner against the recorded `signingEvents`.

### Open questions resolved between DESIGN1 and DESIGN2

DESIGN1 §7 listed seven open questions. DESIGN2 resolved three of them:

| # | Question | Resolution |
|---|---|---|
| #2 | `extensions/` (agp, secure-passport, timestamp, traceability) — unread | Inspected in this session. `agp` deferred to Phase 3. `secure-passport` is the wire shape for `MessageSigner` envelopes. `timestamp` and `traceability` are alignment targets, not Phase 1 work. |
| #4 | Treasury `consultTreasury(...)` returning `null` on failure — silent fallback | Resolved by §4.6: `consultAdvisors(...)` returns a typed `ConsultationResult { ok: false, error: ... }` instead of silently dropping the failure. The strategy sees the failure explicitly and the audit records it. |
| #7 | `Legent/.../JupiterTreasuryAgent/.env` purpose | Resolved by reading the file. KERIA sub-delegation config — `BRAN`, `KERIA_URL`, `KERIA_BOOT_URL`, `SCOPE`, `CAN_DELEGATE`. Pattern for Phase 2 sub-agents. |

Items still open in DESIGN2 §7:

- signify-ts exact API surface (`.sign`/`.verify` method shapes vs lower-level `signers/verfers` accessors) — Phase 2 binding question.
- Production audit-JSON storage location — deploy-config issue, not design.
- `CAN_DELEGATE=false` enforcement — verify it is enforced inside the issuing script `subagent-delegate-with-unique-bran-FIXED.sh` at the KERIA layer, not by agent code. Phase 2 verification task.

### What stayed the same

To make explicit what DESIGN2 did NOT change:

- **The product story** — DESIGN1's problem/solution/impact framing is unchanged. CPO/CISO/CFO/General Counsel personas, the 2×2 adoption story, the market sizing, the track fit — all intact.
- **The conceptual diagrams** — bow-tie pattern, 5-layer delegation chain, end-to-end deal flow — unchanged.
- **The 7-node agent graph** — Buyer, Seller, Treasury, Inventory, Credit, Logistics, CredentialProvider, Memory — unchanged. (DESIGN2 adds `MessageSigner` as an on-wire interceptor, not a new node in the graph.)
- **The 13 MCP tools + 2 new Phase-2 tools** — unchanged.
- **The 16-attack enumeration** — unchanged (DESIGN2 §8 references it).
- **`shared/strategy.ts`** spec — unchanged from DESIGN1 §4.1.
- **`shared/llm-client.ts`** spec — unchanged from DESIGN1 §4.3.
- **Phase 2 sub-agent specs** (Inventory, Credit, Logistics) — unchanged in shape; DESIGN2 only adds the requirement that sub-agents also use `MessageSigner` for their `/consult` request/response envelopes.

### What's now needed from the implementer

Per DESIGN2 §6 step 1: tag the codebase before any work begins.

```
cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1
git tag v0.9-pre-autonomous
git checkout -b phase-1-autonomous
```

Then proceed with steps 2–12 in §6.

---

## Revision 1 — 2026-05-15 (earlier the same day)

### Headline

Initial extraction from chat "Long FIN Agents-Team-1" into four versioned design files under `DESIGN1/`.

### Files created

- `DESIGN1/design-1-problem-solution-impact.md`
- `DESIGN1/design-1-conceptual-design.md`
- `DESIGN1/design-1-detailed-design.md`
- `DESIGN1/design-1-files-on-disk.md`

### Source

Extracted from chat `https://claude.ai/chat/a0d16ca6-e71f-4eb7-84b5-5eee99c81124` titled "Long FIN Agents-Team-1." Captured the latest authoritative product framing from that chat.

### Scope and limits

Revision 1 was a **product-level extraction**, written before full code reads. It identified three abstraction axes (Strategy, LLM, Credential) and three vLEI touchpoints. It pre-dates the discovery of the IPEX admit call sites (touchpoints 4, 6), the discovery that the `enabled` flag is dead code, the discovery that A2A wire signing does not exist today, and the inspection of the four `extensions/` specs.

These gaps are all closed in revision 2.

---

**End of CHANGELOG.md**
