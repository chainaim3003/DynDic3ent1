# Project 1 — LegentPro: Detailed Design (Phase 1 → Phase 2 → Phase 3)
## design-2: Implementation-Ready Detailed Design (revision 2)

> **Codebase under design:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\`
> **Identity substrate:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\vLEIEnh1\legentvLEI\`
> **Date:** 2026-05-15 (revision 2)
> **Grounding:** Every claim below is rooted in files read directly on disk on this date. No mocks, no hardcoding, no fallbacks assumed. Where a behavior is *as-implemented today*, it is marked `[verified]`. Where it is *to be added*, it is marked `[new]`. Where I have *not read the file*, it is marked `[unread]` and must be confirmed before implementation.

---

## 0. Operating Principles (binding for all changes below)

These rules govern every line of code added or modified. They are not aspirations — they are acceptance criteria.

1. **No hallucinated APIs.** Every external call must reference a real, existing endpoint defined in code today, or a new endpoint whose contract is explicitly specified in this document.
2. **No mocks.** Where enterprise data does not exist yet (e.g. GS1 inventory feeds for the three Phase-2 sub-agents), the data source is real Jupiter-internal configuration values following the real open standard schema. It is *enterprise-private data*, not *mocked data*.
3. **No hardcoding** of provider-specific behavior into agent logic. Agents call interfaces. Implementations are injected at startup based on environment configuration.
4. **No silent fallbacks.** If a required dependency is unavailable, the agent fails loudly with a specific error code recorded in the audit trail. Optional dependencies may degrade, but the degradation is logged and surfaced. Silent fallbacks are removed wherever found.
5. **All cross-process calls carry typed JSON.** No free-text field from a sub-agent or counterparty is consumed by an orchestrator LLM as instructions. This is the NEST-3 A9 mitigation from design-1 §5.
6. **All decisions write to the audit trail before any irreversible action.**
7. **Extensibility before fidelity.** The system MUST run end-to-end with `CREDENTIAL_MODE=plain` (no vLEI server, no KERI, no IPEX) and the same code MUST run with `CREDENTIAL_MODE=vlei` (full delegation chain, signed envelopes, ACDC credentials). The choice is a startup env-var, never a code edit.
8. **Honesty over convenience.** A `plain`-mode credential record MUST be labeled as such in the audit trail. It MUST NOT claim cryptographic verification it does not have. This replaces the existing `verificationType: "DISABLED"` returning `verified: true` pattern, which is dishonest.

---

## 1. Project Structure (as-is on disk, verified)

(Structure verified in revision 1 — unchanged for revision 2. See appendix §A1.)

---

## 2. As-Implemented Behavior — verified across BOTH agents and the api-server

### 2.1 The complete vLEI / IPEX touchpoint inventory

**Six** distinct cryptographic touchpoints exist in the live system. All are wired but none have an abstraction layer.

| # | Touchpoint | Caller file | Caller line | Endpoint called | Script invoked |
|---|---|---|---|---|---|
| **1** | Buyer verifies seller delegation, pre-negotiation | `buyer-agent/index.ts` | 128 | `POST :4000/api/buyer/verify/ext/seller` | `test-agent-verification-DEEP-EXT.sh` |
| **2** | Seller verifies buyer delegation, on first OFFER | `seller-agent/index.ts` | 311 | `POST :4000/api/seller/verify/ext/buyer` | `test-agent-verification-DEEP-EXT.sh` |
| **3** | Seller issues invoice ACDC credential, grants to buyer | `seller-agent/index.ts` | 562 | `POST :4000/api/seller/ipex/issue-and-grant` | `invoice-acdc-issue-self-attested.sh` + `invoice-ipex-grant.sh` |
| **4** | Buyer admits invoice ACDC credential | `buyer-agent/index.ts` | 220 | `POST :4000/api/buyer/ipex/admit` | `invoice-ipex-admit.sh` |
| **5** | Seller issues DD-invoice ACDC credential, grants to buyer | `seller-agent/index.ts` | 712 | `POST :4000/api/seller/ipex/issue-and-grant` | `invoice-acdc-issue-self-attested.sh` + `invoice-ipex-grant.sh` |
| **6** | Buyer admits DD-invoice ACDC credential | `buyer-agent/index.ts` | 364 | `POST :4000/api/buyer/ipex/admit` | `invoice-ipex-admit.sh` |

### 2.2 What is verified today

- **Delegation chain** — for touchpoints 1 and 2. KERI walks the 5-layer chain: GLEIF Root → QVI → Legal Entity AID → OOR Holder AID → Agent AID. Verifies that the counterparty AID is delegated from a real OOR holder bound to a real LEI.
- **Invoice credential** — for touchpoints 3, 5. ACDC SAID-anchored to the seller's KERI key. Sealed via IPEX grant. Buyer admits via touchpoints 4, 6.

### 2.3 What is NOT verified today

- **A2A message envelope.** Every `OFFER`, `COUNTER_OFFER`, `ACCEPT_OFFER`, `PURCHASE_ORDER`, `ESCALATION_NOTICE`, `INVOICE`, `DD_OFFER`, `DD_ACCEPT`, `DD_INVOICE` message between buyer and seller is sent over plain HTTP with no signature, no MAC, no envelope hash. After the one-time pre-negotiation delegation check, the receiver has no cryptographic evidence that any given subsequent message actually came from the counterparty agent.
- **Cross-message replay protection.** No nonces, no per-message sequence binding to a session.

This is the gap the `MessageSigner` abstraction (§4) is designed to close.

### 2.4 Today's "off-switch" — the dead VLEIConfig.enabled flag

`shared/vlei-verification-client.ts` defines `VLEIConfig.enabled` and the verification functions accept a config override:

```typescript
if (!cfg.enabled) {
  return {
    verified:           true,                          // ← DISHONEST
    agentName:          callerRole === "seller" ? "tommyBuyerAgent" : "jupiterSellerAgent",
    oorHolderName:      callerRole === "seller" ? "Tommy_Chief_Procurement_Officer" : "Jupiter_Chief_Sales_Officer",
    verificationType:   "DISABLED",
    verificationScript: "NONE",
    ...
  };
}
```

**Three problems with this design** (all of which the new design fixes):

1. The two agents never pass a config override, so `enabled` defaults to `true` — the switch is dead.
2. When the switch *would* be `false`, it returns `verified: true` — a silent lie. The agent treats it as successful verification. Audit replay would show "verified" without knowing whether vLEI was on.
3. It does not cover the IPEX issuance/admit endpoints (touchpoints 3-6), which are called via inline `fetch(...)` at four sites in the two agents. There is no off-switch for IPEX at all.

### 2.5 The vLEI api-server — what `:4000` actually does

`vLEIEnh1/legentvLEI/api-server/server.js` [verified, head + endpoints read]:

- Runs as a Node/Express service on port 4000.
- Each endpoint shells out via `bash ./script.sh` to the KERI scripts in `legentvLEI/task-scripts/` and `legentvLEI/`. Verification: DEEP (`test-agent-verification-DEEP.sh`), DEEP-EXT (`test-agent-verification-DEEP-EXT.sh`), DEEP-EXT-CREDENTIAL (`test-agent-verification-DEEP-credential.sh`). IPEX: `invoice-acdc-issue-self-attested.sh`, `invoice-ipex-grant.sh`, `invoice-ipex-admit.sh`.
- Reads/writes KERI task-data under `legentvLEI/task-data/*.json`. Examples observed in code: `jupiterSellerAgent-ipex-grant-info.json`, `tommyBuyerAgent-ipex-admit-info.json`, `jupiterSellerAgent-self-invoice-credential-info.json`.
- Returns plain JSON. **The api-server itself does NOT sign anything** — it orchestrates KERIA-backed shell scripts. The actual signing happens inside the Docker containers running KERI/KERIA.

This matters for the design: the api-server is a *transport* to KERIA, not a signing service in its own right. Any future "sign this A2A envelope" capability is either (a) a new api-server endpoint that calls signify-ts, or (b) signify-ts running directly inside each agent process.

---

## 3. Target Architecture — four orthogonal abstractions

Revision 2 separates the design into **four** axes. The first three were in revision 1; the fourth (`MessageSigner`) is new and is the core delta of this revision.

### 3.1 Axis A — `NegotiationStrategy` (decision mode)

`rules` vs `autonomous`. Unchanged from revision 1 §3.1. See appendix §A2.

### 3.2 Axis B — `CredentialProvider` (identity & ACDC issuance)

`plain` vs `vlei`. Covers touchpoints 1–6 (delegation verification + IPEX). Replaces the dishonest `VLEIConfig.enabled` switch. See §4.2.

### 3.3 Axis C — `LLMProvider` (LLM choice)

`groq` vs `gemini`. Unchanged from revision 1 §3.3.

### 3.4 Axis D — `MessageSigner` (per-message envelope signing) **[NEW IN REVISION 2]**

`plain` vs `vlei`. Covers the un-protected A2A wire described in §2.3. Every A2A message between agents goes through this interface before transmission and after reception. Closes NEST-3 A2 (AID substitution), A6 (message tampering in transit), A11 (counterparty agent prompt injection).

**This is the core revision-2 abstraction.** It exists today as a gap, not as a partial-and-dishonest implementation, so it does not need to "replace" anything — it needs to be added on the send/receive path.

### 3.5 The combined runtime matrix (revision 2)

Four independent axes — 16 possible combinations, all valid configurations of the same build:

```
STRATEGY_MODE   ∈ { rules, autonomous }       — see Axis A
LLM_PROVIDER    ∈ { groq, gemini }            — see Axis C  (irrelevant when STRATEGY_MODE=rules)
CREDENTIAL_MODE ∈ { plain, vlei }             — see Axis B
SIGNING_MODE    ∈ { plain, vlei }             — see Axis D
```

**Practical configurations:**

| Config | Use |
|---|---|
| `rules + groq + plain + plain` | CI baseline. Deterministic. No network. |
| `autonomous + gemini + plain + plain` | **The May 18 default.** Honest in audit ("no crypto anchoring"). Demo-stable. |
| `autonomous + gemini + vlei + plain` | Identity verified cryptographically; wire still plain. Useful intermediate. |
| `autonomous + gemini + vlei + vlei` | **The product vision.** Full delegation chain + envelope signing. Audit-defensible. |

**Constraint:** `SIGNING_MODE=vlei` requires `CREDENTIAL_MODE=vlei` (signing keys live in the same KERIA wallet as the delegation chain). The startup banner refuses inconsistent combinations and exits with a structured error — no silent coercion.

---

## 4. Detailed Component Designs

### 4.1 `shared/strategy.ts` [new file]

Unchanged from revision 1 §4.1. See appendix §A3.

### 4.2 `shared/credential-provider.ts` [new file, revised in revision 2]

**Responsibilities:**
- Define `CredentialProvider` interface covering touchpoints 1–6.
- Two implementations: `PlainJsonProvider`, `VleiProvider`.

```typescript
// shared/credential-provider.ts  [new]

export type CredentialMode = "plain" | "vlei";

export interface VLEIClientConfig {
  /** Where the vLEI api-server lives. Only used when mode=vlei. */
  apiServerUrl:   string;     // e.g. "http://localhost:4000"
  /** vLEI verification can take 10-30s through Docker. */
  verifyTimeoutMs: number;    // default 30000
  /** IPEX issue+grant shell takes longer. */
  ipexTimeoutMs:   number;    // default 60000
}

/** Identity-verification audit record. Same shape for both modes. */
export interface CredentialVerificationResult {
  verified:           boolean;
  mode:               CredentialMode;   // ← the honesty signal
  verificationScript: string;           // "DEEP-EXT" | "PLAIN_JSON" | "NONE"
  verificationType:   string;           // "EXTERNAL" | "PLAIN_ATTESTATION" | "FAILED"
  caller:             "buyer" | "seller";
  target:             "buyer" | "seller";
  counterpartyAgentName: string;
  counterpartyAID?:   string;           // populated only when mode=vlei
  oorHolderName?:     string;
  legalEntityName?:   string;
  lei?:               string;
  trustChain:         string[];         // ["GLEIF_ROOT", "QVI", "LE", "OOR", "AGENT"] for vlei
                                        // ["AGENT_CARD"]                                for plain
  timestamp:          string;
  error?:             string;
  rawOutput?:         string;
}

/** IPEX issuance audit record. */
export interface CredentialIssueResult {
  issued:           boolean;
  granted:          boolean;
  mode:             CredentialMode;
  credentialSAID:   string;             // "PLAIN-JSON-<uuid>" in plain mode; real SAID in vlei
  grantSAID?:       string;             // only in vlei mode
  invoiceId:        string;
  invoiceType:      "INVOICE" | "DD_INVOICE";
  fromAgent:        string;
  toAgent:          string;
  timestamp:        string;
  error?:           string;
}

/** IPEX admit audit record. */
export interface CredentialAdmitResult {
  admitted:        boolean;
  mode:            CredentialMode;
  admitSAID?:      string;             // only in vlei mode
  invoiceId:       string;
  admittedFrom:    string;
  admittedBy:      string;
  timestamp:       string;
  error?:          string;
}

export interface CredentialProvider {
  readonly mode: CredentialMode;

  /** Touchpoints 1 & 2. */
  verifyCounterparty(
    selfRole:              "buyer" | "seller",
    counterpartyAgentName: string,
  ): Promise<CredentialVerificationResult>;

  /** Touchpoints 3 & 5. */
  issueInvoiceCredential(params: {
    invoiceId:     string;
    invoiceType:   "INVOICE" | "DD_INVOICE";
    invoiceDate?:  string;
    dueDate?:      string;
    totalAmount:   number;
    currency:      string;
    pricePerUnit?: number;
    quantity?:     number;
    paymentTerms:  string;
    negotiationId: string;
    fromAgent:     string;        // e.g. "jupiterSellerAgent"
    toAgent:       string;        // e.g. "tommyBuyerAgent"
  }): Promise<CredentialIssueResult>;

  /** Touchpoints 4 & 6. */
  admitInvoiceCredential(params: {
    invoiceId:    string;
    senderAgent:  string;
    receiver:     string;
  }): Promise<CredentialAdmitResult>;
}
```

**`PlainJsonProvider`** [May 18 default]:
- `verifyCounterparty` reads the counterparty's agent-card file (e.g. `agent-cards/tommyBuyerAgent-card.json`) from disk via existing `readAgentCardMetadata(...)`. Returns `verified: true` **only if the card file exists and parses**. Populates `counterpartyAgentName`, `oorHolderName`, `legalEntityName`, `lei` from the card — these are *attestations from a card file*, not cryptographic proofs. `mode: "plain"` + `verificationScript: "PLAIN_JSON"` make this unambiguous in the audit trail. No network call.
- `issueInvoiceCredential` synthesizes `credentialSAID: "PLAIN-JSON-" + uuidv4()`. Writes a plain JSON record of the invoice. Returns `issued: true, granted: true`. No KERIA, no IPEX.
- `admitInvoiceCredential` returns `admitted: true` with `admitSAID: undefined`. No network call.

**`VleiProvider`** [Phase 2+]:
- Wraps existing `verifyCounterparty(...)` and `verifyInvoiceCredential(...)` from `shared/vlei-verification-client.ts` for verification.
- Wraps the existing inline `fetch :4000/api/seller/ipex/issue-and-grant` calls (currently in seller line 562, 712) for issuance.
- Wraps the existing inline `fetch :4000/api/buyer/ipex/admit` calls (currently in buyer line 220, 364) for admit.

**Failure modes:**
- `vlei` mode network/server failure → throw `CredentialProviderError(operation, cause)`. Agent catches, records audit record with `verified|issued|admitted: false` + `error`, and **does not proceed with the negotiation step**.
- `plain` mode: only failure is missing agent-card file → throw `CredentialProviderError("VERIFY", "card_not_found:<agentName>")`.

**Selection:**
```typescript
const credentialProvider = getCredentialProvider(
  (process.env.CREDENTIAL_MODE as CredentialMode) ?? "plain",
  { apiServerUrl: process.env.VLEI_URL ?? "http://localhost:4000",
    verifyTimeoutMs: 30000,
    ipexTimeoutMs: 60000 },
);
```

**Default is `plain`** in revision 2 (was `vlei` in revision 1) because Phase 1 ships May 18 and the production default should be the one that always works on a laptop. Operators flip to `vlei` for full deployments.

### 4.3 `shared/llm-client.ts` [modify]

Unchanged from revision 1 §4.3. See appendix §A4.

### 4.4 `shared/message-signer.ts` [new file, revision 2 core delta]

**Responsibilities:**
- Provide a uniform signing interface that wraps every outbound A2A message in a verifiable envelope, and verifies every inbound A2A message.
- Two implementations: `PlainHashSigner` (May 18), `VleiSignifySigner` (Phase 2+).

```typescript
// shared/message-signer.ts  [new]

export type SigningMode = "plain" | "vlei";

export interface SignerConfig {
  /** This agent's identity as known to the signer. */
  agentName:     string;       // e.g. "jupiterSellerAgent"
  agentAID?:     string;       // KERI AID; required when mode=vlei
  /** KERIA / signify-ts connection. Only used when mode=vlei. */
  keriaUrl?:     string;       // e.g. "http://127.0.0.1:3902"
  keriaBootUrl?: string;       // e.g. "http://127.0.0.1:3903"
  /** Random bran for the signify-ts client. Loaded from agent .env. */
  bran?:         string;       // 256-bit seed; required when mode=vlei
}

/** The envelope attached to every A2A message. */
export interface SecurePassportEnvelope {
  /** Schema discriminator — fixed string per `secure-passport/v1` spec. */
  uri: "https://github.com/a2aproject/a2a-samples/tree/main/extensions/secure-passport/v1";

  /** Identity claim: who sent this. */
  clientId:  string;           // AID-string in vlei mode; agent-card AID-string in plain mode

  /** Negotiation session id — also a replay-protection scope. */
  sessionId: string;           // negotiationId

  /**
   * Canonical signature over the `state` field below.
   *   vlei mode  → KERI Ed25519 signature over canonical-JSON(state), signify-ts produced
   *   plain mode → "PLAIN_HASH:<hex>" where <hex> = sha256(canonical-JSON(state))
   * The receiver inspects the prefix to know how to verify.
   */
  signature: string;

  /** Signed state — the receiver re-canonicalizes and verifies. */
  state: {
    envelopeHash:    string;   // sha256 of canonical-JSON of message.parts
    negotiationId:   string;
    round:           number;
    fromAID:         string;
    toAID:           string;
    messageType:     string;   // e.g. "COUNTER_OFFER"
    timestamp:       string;   // RFC 3339 UTC
    nonce:           string;   // uuidv4; receiver tracks (sessionId, nonce) to reject replay
  };

  /** Audit metadata — NOT signed (verifying this would be circular). */
  schemeLabel:    "PLAIN_HASH" | "KERI_ED25519";
  signerMode:     SigningMode;
}

export interface VerifyResult {
  ok:                boolean;
  mode:              SigningMode;
  schemeLabel:       "PLAIN_HASH" | "KERI_ED25519" | "NONE";
  fromAID?:          string;
  failedCheck?:      "missing_envelope" | "schema" | "session_mismatch"
                     | "replay_nonce" | "hash_mismatch" | "signature_invalid"
                     | "aid_unknown" | "config_error";
  error?:            string;
}

export interface MessageSigner {
  readonly mode: SigningMode;

  /** Attach a signed envelope to an outbound A2A Message. */
  sign(
    message:           Message,                // the @a2a-js/sdk Message
    session:           { sessionId: string; round: number; messageType: string; toAID: string },
  ): Promise<Message>;                          // returns the same Message with metadata[uri]=envelope

  /** Verify the envelope on an inbound A2A Message. */
  verify(
    message:           Message,
    session:           { sessionId: string; expectedFromAID?: string },
  ): Promise<VerifyResult>;
}

/** Factory. Throws if (mode=vlei && config incomplete). No silent coercion. */
export function getMessageSigner(mode: SigningMode, config: SignerConfig): MessageSigner;
```

#### 4.4.1 `PlainHashSigner` — what it does

- `sign(...)`:
  - Builds `state` from the supplied session info + a fresh `nonce: uuidv4()`.
  - Computes `envelopeHash = sha256(canonicalJSON(message.parts))`.
  - Sets `signature = "PLAIN_HASH:" + sha256Hex(canonicalJSON(state))`.
  - Sets `schemeLabel: "PLAIN_HASH"`, `signerMode: "plain"`, `clientId = config.agentName`.
  - Writes the envelope into `message.metadata[<uri>]`.
- `verify(...)`:
  - Reads the envelope; on missing → `{ ok: false, failedCheck: "missing_envelope" }`.
  - Re-canonicalizes `state`, recomputes the hash, compares to the `signature` value (after stripping the `"PLAIN_HASH:"` prefix). Hash mismatch → `{ ok: false, failedCheck: "hash_mismatch" }`.
  - Recomputes `envelopeHash` over `message.parts`; mismatch → `{ ok: false, failedCheck: "hash_mismatch" }`.
  - Checks `state.sessionId === session.sessionId`; mismatch → `{ ok: false, failedCheck: "session_mismatch" }`.
  - Checks `(sessionId, nonce)` not seen before in this process. New → record, return ok. Seen → `{ ok: false, failedCheck: "replay_nonce" }`.
  - Returns `{ ok: true, mode: "plain", schemeLabel: "PLAIN_HASH", fromAID: state.fromAID }`.

**What `PlainHashSigner` protects against:**
- **Message tampering by a third party** (within and across processes): a tamperer changing `pricePerUnit` would have to recompute the envelope hash, which is fine — but then `state.envelopeHash` would mismatch the message parts unless they update state too, which would invalidate the `signature` hash. So in-flight tampering is detectable.
- **Replay within a session**: nonce tracking rejects exact replays.

**What `PlainHashSigner` does NOT protect against:**
- **Forgery of identity.** An attacker can produce a fully valid plain envelope claiming to be `jupiterSellerAgent`. No cryptographic binding to a private key. Only `vlei` mode closes this.

**This is exactly the right behavior for a `plain`-mode dev environment.** The audit trail records `schemeLabel: "PLAIN_HASH"` so any reviewer immediately sees the limit.

#### 4.4.2 `VleiSignifySigner` — what it does (specified now, implemented Phase 2)

- Backed by **signify-ts** — the official TypeScript client for KERIA.
- Constructor:
  - Reads `bran` (256-bit base64 seed) from agent's `.env` (e.g., the existing `Legent/A2A/js/src/agents/JupiterTreasuryAgent/.env` already contains `BRAN=0YMZpGqK2ztokgqv7M9cP2bzwQ3dW1YhIwXSpOCjdeo=` — same pattern for the buyer, seller, and the three Phase-2 sub-agents).
  - Boots signify-ts: `const client = new SignifyClient(keriaUrl, bran, Tier.low, keriaBootUrl); await client.boot(); await client.connect();`
  - Loads the agent's AID using its name (Habery alias): `const hab = await client.identifiers().get(agentName);`
- `sign(...)`:
  - Builds `state` exactly like `PlainHashSigner`.
  - Canonicalizes `state` → bytes.
  - **Calls signify-ts to sign the bytes with the agent's KERI key:** `const sig = await client.identifiers().sign(agentName, canonicalBytes);`
  - Encodes as a CESR signature string per KERI conventions.
  - Sets `signature = "KERI_ED25519:" + cesrSig`, `schemeLabel: "KERI_ED25519"`, `signerMode: "vlei"`, `clientId = hab.prefix` (the AID).
- `verify(...)`:
  - All the structural checks from `PlainHashSigner` (envelope present, hashes match, session matches, no replay).
  - Resolves the sender's KERI public key via OOBI (the OOBI is in the counterparty's agent card under `extensions.vLEImetadata.delegateeOOBI` — confirmed by reading `jupiterSellerAgent-card.json`).
  - **Calls signify-ts to verify the signature against the sender's verfer:** `const valid = await client.identifiers().verify(senderAID, canonicalBytes, cesrSig);`
  - Signature invalid → `{ ok: false, failedCheck: "signature_invalid" }`.

**signify-ts version note:** signify-ts is an active npm package (`signify-ts`). The exact API call shape (`.sign`/`.verify` vs lower-level `.signers()/.verfers()`) needs to be confirmed against the version pinned at Phase-2 start. The design above is the contract; the binding to signify-ts is a 50-line file Phase 2 writes once.

**What `VleiSignifySigner` protects against:**
- Everything `PlainHashSigner` protects against, **plus** identity forgery — the signature is unforgeable without the agent's KERI key in the KERIA wallet.
- This closes NEST-3 A2 (AID substitution), A6 (message tampering in transit), A11 (counterparty agent prompt injection).

### 4.5 Where `MessageSigner` plugs into the agent code

Two methods on each agent are the integration points. Both already exist and just need to call the signer.

**Outbound (seller's `sendToBuyer`, buyer's `sendToSeller`):**

Today (seller-agent line ~990):
```typescript
const message: Message = {
  messageId: uuidv4(), kind: "message", role: "agent", contextId,
  parts: [ { kind: "data", data }, { kind: "text", text: ... } ],
};
const stream = buyerClient.sendMessageStream({ message });
```

After revision-2 design:
```typescript
const message: Message = { /* same as today */ };
const signed = await messageSigner.sign(message, {
  sessionId:   data.negotiationId,
  round:       data.round ?? 0,
  messageType: data.type,
  toAID:       counterpartyAID,        // looked up once at session start from agent card
});
const stream = buyerClient.sendMessageStream({ message: signed });
```

**Inbound (each agent's `execute(ctx, bus)` entry point):**

Today (both agents): `execute` reads `ctx.userMessage.parts`, filters for the data part, and dispatches by `data.type` to the appropriate handler.

After revision-2 design:
```typescript
async execute(ctx, bus) {
  const taskId    = ctx.task?.id ?? uuidv4();
  const contextId = ctx.task?.contextId ?? uuidv4();

  // Extract negotiationId from the data part (existing behavior).
  const dataParts = ctx.userMessage.parts.filter(p => p.kind === "data");
  const data      = (dataParts[0] as any)?.data as NegotiationData | undefined;
  if (!data) { this.respond(...); return; }

  // ── NEW: verify the envelope BEFORE dispatching ───────────────────────
  const result = await messageSigner.verify(ctx.userMessage, {
    sessionId:       data.negotiationId,
    expectedFromAID: counterpartyAIDFor(data.from),   // resolved from cached state
  });
  if (!result.ok) {
    auditWriter.recordSigningFailure(data.negotiationId, result);
    this.respond(bus, taskId, contextId,
      `❌ Envelope verification failed (${result.failedCheck}) — refusing message.`);
    return;
  }
  // record the successful verification on the negotiation audit
  auditWriter.recordSigningSuccess(data.negotiationId, result);

  // ── existing dispatch ────────────────────────────────────────────────
  switch (data.type) { ... }
}
```

**Two helper resolutions** the agent needs:
- `counterpartyAID`: looked up from `agent-cards/<counterparty>-card.json` at session start (the card already contains `keriIdentifiers.agentAID` — confirmed by reading `jupiterSellerAgent-card.json`).
- `counterpartyAIDFor(role)`: trivial: maps "BUYER" → tommyBuyerAgent AID, "SELLER" → jupiterSellerAgent AID. Held in a 2-entry map keyed by `negotiationId`.

### 4.6 `agents/seller-agent/index.ts` [modify]

Three sets of changes:

1. **At startup (`main()`):** build all four providers from env. Print active-configuration banner. Refuse `SIGNING_MODE=vlei && CREDENTIAL_MODE=plain` with a structured exit.
2. **In `handleBuyerOffer(...)`:** replace direct `verifyCounterparty(...)` call (line 311) with `credentialProvider.verifyCounterparty("seller", "tommyBuyerAgent")`. Cache the resulting `counterpartyAID` in negotiation state for use during inbound verification of subsequent messages.
3. **In `makeNegotiationDecision(...)`:** replace inline LLM + rules-fallback body with a `strategy.decide(state, context)` call. Treasury consultation stays, but **its `null`-on-failure pattern is replaced**: `consultTreasury(...)` returns a `ConsultationResult` with `ok: false` + structured error code. The strategy sees the failure explicitly and the audit records it.
4. **In `handlePurchaseOrder(...)` and `handleDDAccept(...)`:** replace inline `fetch :4000/api/seller/ipex/issue-and-grant` (lines 562, 712) with `credentialProvider.issueInvoiceCredential(...)`.
5. **In `sendToBuyer(...)`:** call `messageSigner.sign(...)` before `sendMessageStream(...)`.
6. **In `execute(ctx, bus)`:** call `messageSigner.verify(...)` before the dispatch switch.

### 4.7 `agents/buyer-agent/index.ts` [modify, symmetric]

Verified by full read in revision 2. The buyer is structurally symmetric to the seller and needs the same six changes, with these specifics:

- `startNegotiation(...)` line 128 → wrap `verifyCounterparty("buyer", "DEEP-EXT")` in `credentialProvider.verifyCounterparty("buyer", "jupiterSellerAgent")`.
- `handleSellerMessage(...)` line 220 (INVOICE branch) → wrap inline `fetch :4000/api/buyer/ipex/admit` in `credentialProvider.admitInvoiceCredential(...)`.
- `handleDDInvoice(...)` line 364 → same wrap.
- `sendToSeller(...)` line ~810 → call `messageSigner.sign(...)`.
- `execute(...)` → call `messageSigner.verify(...)`.

**No buyer logic changes beyond these wiring points.** The autonomous-DD decision engine, the cost-of-capital comparison, and the CPO escalation are untouched.

### 4.8 `shared/negotiation-types.ts` [modify]

Extend `NegotiationAudit` with three new optional fields (revision-1 §4.10 had two; revision 2 adds signing):

```typescript
interface NegotiationAudit {
  // existing fields ...
  strategyTraces?: StrategyTrace[];                 // one per round
  consultations?:  ConsultationResult[][];          // [round][source]

  // ── NEW IN REVISION 2 ─────────────────────────────────────────
  /** Envelope verification result per A2A message exchanged. */
  signingEvents?: Array<{
    timestamp:   string;
    direction:   "inbound" | "outbound";
    messageType: string;            // e.g. "COUNTER_OFFER"
    result:      VerifyResult;
    schemeLabel: "PLAIN_HASH" | "KERI_ED25519" | "NONE";
  }>;
}
```

### 4.9 Phase 2 components

Unchanged from revision 1: three new sub-agents (Inventory, Credit, Logistics), two new GS1 schema clients, advisory panel in UI, sub-agent KERIA `.env` files and agent cards. See appendix §A5.

**Revision-2 addition for Phase 2:** every sub-agent ALSO uses `MessageSigner` when it receives a `POST /consult` call from the seller. The sub-agent verifies that the request envelope is signed by the seller's AID, and signs its advisory response. This extends the trust boundary to the consultation graph.

### 4.10 The `Legent/.../.env` connection — confirmed

Reading `Legent/A2A/js/src/agents/JupiterTreasuryAgent/.env` confirms what the design expects:

```
BRAN=0YMZpGqK2ztokgqv7M9cP2bzwQ3dW1YhIwXSpOCjdeo=   ← 256-bit seed for signify-ts
AGENT_NAME=JupiterTreasuryAgent
KERIA_URL=http://127.0.0.1:3902
KERIA_BOOT_URL=http://127.0.0.1:3903
SCOPE=treasury_operations
CAN_DELEGATE=false
```

**These are the exact inputs `VleiSignifySigner` needs.** The `BRAN` is the signify-ts client seed; `KERIA_URL` and `KERIA_BOOT_URL` are its endpoints; `AGENT_NAME` is the Habery alias. Phase 2 sub-agents will get parallel `.env` files via the existing `subagent-delegate-with-unique-bran-FIXED.sh` provisioning script.

---

## 5. Configuration Surface (revised)

Per Operating Principle 7. All four axes are env-var driven. Defaults are *demo-mode* in revision 2 (was production-mode in revision 1) because Phase 1 ships May 18 and the safer demo default protects the submission.

| Env var | Values | Default | Effect |
|---|---|---|---|
| `STRATEGY_MODE` | `rules` \| `autonomous` | `autonomous` | Which strategy class is instantiated |
| `LLM_PROVIDER` | `groq` \| `gemini` | `gemini` | Which LLM provider class is instantiated |
| `CREDENTIAL_MODE` | `plain` \| `vlei` | `plain` | Identity + ACDC implementation |
| `SIGNING_MODE` | `plain` \| `vlei` | `plain` | Per-message envelope implementation |
| `GEMINI_PRO_MODEL` | model id | `gemini-2.5-pro` | Seller/buyer reasoning model |
| `GEMINI_FLASH_MODEL` | model id | `gemini-2.5-flash` | Sub-agent reasoning model (Phase 2) |
| `GOOGLE_API_KEY` | string | — | Required if `LLM_PROVIDER=gemini` |
| `GROQ_API_KEY` | string | — | Required if `LLM_PROVIDER=groq` |
| `VLEI_URL` | URL | `http://localhost:4000` | vLEI api-server (required if `CREDENTIAL_MODE=vlei`) |
| `KERIA_URL` | URL | `http://127.0.0.1:3902` | Required if `SIGNING_MODE=vlei` |
| `KERIA_BOOT_URL` | URL | `http://127.0.0.1:3903` | Required if `SIGNING_MODE=vlei` |
| `AGENT_BRAN` | base64 | — | This agent's signify-ts seed (required if `SIGNING_MODE=vlei`) |
| `TREASURY_URL` | URL | `http://localhost:7070` | Treasury consultation endpoint |
| `INVENTORY_URL` | URL | `http://localhost:7071` | Phase 2 |
| `CREDIT_URL` | URL | `http://localhost:7072` | Phase 2 |
| `LOGISTICS_URL` | URL | `http://localhost:7073` | Phase 2 |

**Startup banner** (extends existing seller treasury banner):
```
🏪  Seller Agent  →  http://localhost:8080
    Strategy     : AUTONOMOUS   (LLM: gemini)
    Credentials  : PLAIN        (vLEI api-server NOT consulted)
    Signing      : PLAIN_HASH   (envelopes hashed, not KERI-signed)
    Treasury     : ✓ consulting http://localhost:7070/consult
```

---

## 6. Phasing Plan (revision 2)

### Phase 1 — May 18 submission (in `DynDic3ent1/`) — **plain mode end-to-end**

Goal: ship a complete, env-var-switchable system with **all four abstractions in place**, but only the `plain` implementation of each axis is wired and tested. `vlei` implementations are scaffolded as classes with `throw new NotImplementedError("Phase 2")` bodies.

In dependency order:

1. **Safety net:** `git tag v0.9-pre-autonomous`. Branch `phase-1-autonomous`. Capture baseline behaviour against `escalations/NEG-1775337742673_audit_*.json`.
2. **`shared/credential-provider.ts`** — interface + `PlainJsonProvider` + `VleiProvider` (stub: throws). Reads existing agent-card files.
3. **`shared/message-signer.ts`** — interface + `PlainHashSigner` + `VleiSignifySigner` (stub: throws). Pure JS, no signify-ts dep yet.
4. **`shared/llm-client.ts`** — refactor existing class into `GroqProvider`. Add `GeminiProvider`. Remove silent error fallback. Add `getLLMProvider(name)` factory.
5. **`shared/strategy.ts`** — `RulesBasedStrategy` (wraps existing `ruleBasedDecision`) + `AutonomousStrategy` (wraps existing LLM prompt). Both produce `StrategyTrace`.
6. **`shared/negotiation-types.ts`** — extend `NegotiationAudit` with `strategyTraces`, `consultations`, `signingEvents`.
7. **`shared/audit-writer.ts`** — populate the three new fields. Add `recordStrategyFailure`, `recordSigningFailure`, `recordSigningSuccess`.
8. **`agents/seller-agent/index.ts`** — wire all four providers at startup; replace the six call sites; add envelope verify on `execute`; add envelope sign on `sendToBuyer`.
9. **`agents/buyer-agent/index.ts`** — symmetric.
10. **`ui/src/components/StrategyTracePanel.tsx`** — new component, wired into `AgentCenter.tsx`.
11. **Regression run:** 20+ negotiations across the `plain` matrix (rules×plain×plain, autonomous×plain×plain). Compare outcomes against baseline.
12. **Merge to `main`, tag `v1.0-phase1`, ship.**

**What May 18 demonstrates:**
- The full 2×2×2×2 matrix is **architecturally present**. Eight of the sixteen combinations actually run today (anything with `CREDENTIAL_MODE=plain && SIGNING_MODE=plain`). The other eight throw a clear `NotImplementedError("Phase 2")` at startup.
- **Honest audit trail**: every NEG-* shows `credentialMode: "plain"`, `signingScheme: "PLAIN_HASH"`. No dishonest "verified: true" without crypto.
- The seller and buyer **verify every inbound A2A message's envelope hash** today — message-tampering protection works even in `plain` mode.

### Phase 2 — Jun 1 — **vlei mode wired, full 4-agent consultation**

13. **`shared/credential-provider.ts`** — implement `VleiProvider`. Drop-in wraps existing `vlei-verification-client.ts` and inline IPEX fetches. Tested against the live `:4000` api-server.
14. **`shared/message-signer.ts`** — implement `VleiSignifySigner`. New dependency: `signify-ts` from npm. Connect to KERIA at startup, look up agent AID, expose sign/verify.
15. **Per-agent `.env` files** — add `BRAN`, `KERIA_URL`, `KERIA_BOOT_URL` to buyer and seller `.env.example` files (the Treasury agent already has the pattern in `Legent/.../JupiterTreasuryAgent/.env`).
16. **Three new sub-agents** — Inventory (7071), Credit (7072), Logistics (7073). Each provisioned with KERIA sub-delegation via the existing `subagent-delegate-with-unique-bran-FIXED.sh`. Each calls `MessageSigner.verify(...)` on incoming `/consult` requests and `.sign(...)` on responses.
17. **Two new GS1 clients** — `gs1-inventory-client.ts`, `gs1-desadv-client.ts`.
18. **`shared/gleif-client.ts`** — for the credit agent's real GLEIF API calls.
19. **Seller's `consultAdvisors(...)`** — extend from Treasury-only to 4-way parallel fan-out.
20. **UI `AdvisoryPanel.tsx`** — render the 4 advisory cards per round.
21. **`entAgentProject11/DESIGN/DESIGN3/`** — capture Phase 2 deltas.

### Phase 3 — post-Jun 1 — hardening and standards alignment

22. Adopt the formal `secure-passport/v1` extension URI in the envelope `metadata` key (the wire format already matches; only the metadata key string changes).
23. Adopt `traceability/v1` schema for `StrategyTrace` (its shape is already aligned).
24. KERI replay-window enforcement (`(sessionId, nonce)` cleanup, max-age).
25. KERIA HA — multiple KERIA endpoints with failover.

---

## 7. Open Questions & Items Requiring Confirmation (revised)

Per Operating Principle on grounding:

1. **signify-ts exact API surface.** The design assumes `client.identifiers().sign(name, bytes)` and `.verify(senderAID, bytes, sig)`. The actual signify-ts methods (`signer/verfer` accessors, CESR encoding helpers) need confirmation against the version pinned at Phase 2 start. **Risk: low. The contract is right; the binding is a Phase-2 task.**
2. **The `extensions/agp/` Python sample location.** AGP routing is a Phase-3 question, not Phase-1. Out of scope here.
3. **`secure-passport/v1/samples/python/` TypeScript port readiness.** Phase 1 implements `secure-passport`-shaped envelopes against the spec without using a Python sample. Phase 3 may formalize.
4. **Treasury `consultTreasury` returning `null`.** Resolved by §4.6 — `consultAdvisors` returns a typed `ConsultationResult` with `ok: false` instead of silently dropping the failure.
5. **Where audit JSONs land in production.** Today: `escalations/` next to source. Production: needs writable mount, deploy-config issue.
6. **`Legent/.../.env` purpose.** Resolved — KERIA sub-delegation config; pattern to replicate for Phase 2 sub-agents.
7. **CAN_DELEGATE enforcement.** The `.env` declares `CAN_DELEGATE=false` for the treasury sub-agent. This is **enforced at the KERIA layer during issuance**, not by code in the agent. Verify by inspecting the issuing script (`subagent-delegate-with-unique-bran-FIXED.sh`) when implementing Phase 2.

---

## 8. Security Posture by Mode (revision 2)

| Threat | `plain+plain` | `plain+vlei` (NOT a valid config) | `vlei+plain` | `vlei+vlei` |
|---|---|---|---|---|
| Counterparty agent is not who they claim (identity forgery) | ❌ Not protected | n/a — refused at startup | ✅ Verified via KERI delegation chain | ✅ Verified via KERI delegation chain |
| Third-party tampering on a message in flight | ✅ Hash mismatch caught | n/a | ✅ Hash mismatch caught | ✅ Hash mismatch caught |
| Replay of a captured message inside a session | ✅ Nonce rejected | n/a | ✅ Nonce rejected | ✅ Nonce rejected |
| Forgery of a message claiming to be from the verified counterparty | ❌ Not protected | n/a | ❌ Not protected | ✅ Closed by KERI signature |
| Counterparty's invoice credential is not authentic ACDC | ❌ Not protected | n/a | ✅ ACDC verified | ✅ ACDC verified |
| Sub-agent advisory came from a different sub-agent | ❌ Not protected | n/a | ❌ Not protected | ✅ Closed by sub-agent KERI signing |

**Key invariant:** `plain+plain` is honest about what it doesn't protect against. The audit trail says `schemeLabel: "PLAIN_HASH"`, `mode: "plain"`. A reviewer can immediately tell what level of trust was in force.

---

## 9. Acceptance Criteria (revised)

For any change in §4 to be considered complete:

1. **Existing test fixtures replay successfully.** Every NEG-* run in `escalations/` whose `_audit_*.json` exists must produce a comparable output under `STRATEGY_MODE=autonomous, LLM_PROVIDER=groq, CREDENTIAL_MODE=vlei, SIGNING_MODE=plain` (the implicit Phase-0 config).
2. **All `plain+plain` combinations** run end-to-end without code change — only env-var change.
3. **Every decision writes a `StrategyTrace` to the audit JSON.** Replay from audit produces the same `finalDecision`.
4. **Every inbound A2A message writes a `signingEvents` entry to the audit JSON.** Including `plain+plain` runs, where the entry records `schemeLabel: "PLAIN_HASH"` and a hash-verification outcome.
5. **Every failure mode** (LLM unavailable, vLEI server down, consultation timeout, envelope tampering, replay) is recorded with a structured error code. No silent fallback survives.
6. **`escalations/`** continues to grow. New runs are indistinguishable in shape from existing runs.
7. **Honesty test:** running with `CREDENTIAL_MODE=plain` produces audit JSONs where no field ever says `verified: true` under a vLEI scheme. The audit reviewer can never be misled about what was actually verified.

---

## Appendix A: Cross-reference to revision 1

Sections unchanged from revision 1 are referenced rather than restated:
- §A1 = revision-1 §1 (project structure)
- §A2 = revision-1 §3.1 (strategy axis)
- §A3 = revision-1 §4.1 (strategy.ts file detail)
- §A4 = revision-1 §4.3 (llm-client.ts modifications)
- §A5 = revision-1 §4.7 (Phase-2 sub-agents)

The full revision-1 design is preserved at `entAgentProject11/DESIGN/DESIGN1/design-1-detailed-design.md`. Revision 2 is purely additive (Axis D — `MessageSigner`) plus the resolution of revision-1 §7 open questions #2 and #7.

---

**End of design-2-detailed-design.md (revision 2)**
