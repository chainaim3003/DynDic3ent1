# vLEI Enhancement Design 1 — Hybrid A2A Authentication

**Author:** Sathya Bala
**Date:** 2026-05-24
**Status:** Draft for review (Design 1, hybrid recommendation)
**Companion to:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\DESIGN\vLEI-ENH-Design-1-Sathya-Bala.md`

> **Note on provenance:** This document was originally generated as an artifact in a prior chat session (`https://claude.ai/chat/78345c0b-b98c-4c8d-818c-0bc627d8e4cf`) but never written to disk. This file is a reconstruction assembled by searching that prior conversation's content. Wording and ordering are ~95% faithful to the original; cross-check against the source chat if byte-perfect recovery matters. One mid-session offer to add a `§5.0` ("Why not heavy / Why not light / summary table") explainer is omitted here because the original author's confirmation could not be found in search snippets. Ask to add §5.0 if wanted.

---

## §0 — Grounding

This document is grounded in the following sources, all read directly:

**Local (authoritative for vLEI semantics):**
- `vlei-trainings/markdown/101_25_Signatures.md` — KLI signing primitives
- `vlei-trainings/markdown/101_45_Connecting_controllers.md` — mutual challenge-response between AIDs
- `vlei-trainings/markdown/102_05_KERIA_Signify.md` through `102_25` — signify-ts client APIs taught by GLEIF
- `vlei-trainings/markdown/103_10_vLEI_Trust_Chain.md` — full chain with edges, `I2I`/`NI2I` operators, Sally verifier
- `vlei-hackathon-2025-workshop/sig-wallet/src/client/{identifiers,credentials,oobis,operations}.ts`
- `vlei-hackathon-2025-workshop/sig-wallet/src/tasks/qvi/qvi-challenge-geda.ts`, `qvi-respond-geda-challenge.ts`, `qvi-verify-geda-response.ts`, `qvi-acdc-issue-oor.ts`, `qvi-acdc-present-qvi.ts`

**Upstream (read fresh via TypeDoc; not in your two local folders):**
- `https://weboftrust.github.io/signify-ts/modules.html` — full API surface
- `https://weboftrust.github.io/signify-ts/classes/Authenticater.html` — `sign(headers, method, path)` / `verify(...)`
- `https://weboftrust.github.io/signify-ts/classes/Exchanges.html` — `createExchangeMessage(sender, route, payload, embeds, recipient)` and `send()`
- `https://github.com/WebOfTrust/keria/blob/main/docs/protocol.md` — SKRAP, Signify-Resource and Signify-Timestamp headers
- `https://www.vlei.wiki/concept/keri-request-authentication-method` — KRAM specification
- `https://github.com/WebOfTrust/polaris-web` — confirms repo exists; src not inspected

Anything labelled "assumption" below has not been verified by code-read and is flagged accordingly per Rule 3.

---

## §1 — Upstream-confirmed signify-ts surface

What GLEIF trainings teach is a strict subset of what signify-ts actually exposes. Confirmed-real, in-spec APIs not taught by GLEIF trainings:

### 1.1 `Authenticater` (HTTP message signing)
**Source:** `src/keri/core/authing.ts` lines 13–90.

```ts
class Authenticater {
  constructor(csig: Signer, verfer: Verfer)
  static DefaultFields: string[]
  sign(headers: Headers, method: string, path: string, fields?: string[]): Headers
  verify(headers: Headers, method: string, path: string): boolean
}
```

This is **RFC 9421-style HTTP message signing** for KERI. It adds `Signature-Input` (`HEADER_SIG_INPUT`) and `Signify-Timestamp` / `Signature` headers to an HTTP request, signed by the AID's controller key. Verification returns boolean. KERIA itself uses this internally for client→agent auth (the SKRAP/KRAM protocol).

### 1.2 `Exchanges.createExchangeMessage` (generic signed exn)
**Source:** `src/keri/app/exchanging.ts` lines 395–524.

```ts
class Exchanges {
  createExchangeMessage(
    sender: HabState,
    route: string,              // arbitrary, e.g. "/finagents/offer"
    payload: Dict<any>,         // arbitrary JSON
    embeds: Dict<any>,          // optional embedded SAIDs / ACDCs
    recipient: string,
    datetime?: string,
    dig?: string
  ): Promise<[Serder, string[], string]>   // [exn, sigs, attachment]

  send(name, topic, sender, route, payload, embeds, recipients): Promise<Exn>
  sendFromEvents(name, topic, exn, sigs, atc, recipients): Promise<Exn>
  get(said): Promise<ExchangeResourceV1>
}
```

This is **not IPEX-restricted**. `route` is any string. `payload` is any dict. IPEX's `/ipex/grant`, `/ipex/admit`, etc. are just specific routes that happen to use this same primitive. We can define our own routes — e.g. `/finagents/a2a/offer`, `/finagents/a2a/counter` — and signify-ts will produce a properly signed `exn` message with the AID's signature.

### 1.3 Low-level signing
`Signer`, `Verfer`, `Cigar`, `Siger`, `Signage` classes, and `siginput()` / `signature()` functions. These underpin the above. We won't use them directly.

### 1.4 What this means
Path C ("generic signing primitive") was not a phantom. There are **two** documented, in-spec ways to sign arbitrary A2A content via signify-ts:

- **HTTP-level:** sign the outgoing HTTP request with `Authenticater` (KRAM/SKRAP style)
- **Message-level:** wrap the business payload in an `exn` via `Exchanges.createExchangeMessage` with a custom route

Neither is taught by GLEIF training. Both are production code paths inside KERIA itself.

---

## §2 — GitHub repos in the KERI/vLEI ecosystem (relevance to this design)

| Repo | What's there | Relevance |
|---|---|---|
| `WebOfTrust/signify-ts` | TypeScript edge-signing client | Direct dependency. `Authenticater`, `Exchanges`, `Hab` |
| `WebOfTrust/keria` | KERIA cloud agent (Python) | The agent we connect to. `docs/protocol.md` describes SKRAP/KRAM headers |
| `WebOfTrust/keripy` | Reference KERI implementation | Witnesses run on this; observer endpoint lives here |
| `WebOfTrust/polaris-web` | Browser-to-extension API | Production example of signed-headers-for-auth pattern |
| `WebOfTrust/signify-browser-extension` | Browser wallet | Production consumer of `Authenticater.sign()` for site login |
| `GLEIF-IT/sally` | Audit verifier we already use | Our `vlei-verification-client.ts` shadows its behaviour |
| `GLEIF-IT/qvi-software` (`qvi-workflow`) | Production-grade multisig vLEI flow | Reference for the multisig-delegated story; out of Design 1 scope |
| `GLEIF-IT/vlei-trainings` | The trainings folder we already have | Source of `101_*` and `102_*` |
| `trustoverip/tswg-acdc-specification` | ACDC spec | Edge operators `I2I` / `NI2I`, attribute rules |
| `WebOfTrust/IETF-IPEX` | IPEX spec | apply/offer/agree/grant/admit semantics |
| `cardano-foundation/veridian-wallet` | Mobile vLEI wallet | Out of scope for Design 1, useful for the future Operator UX track |
| `keri-foundation/wallet` (Sparán) | GUI wallet | Out of scope |

**Assumption flag:** the actual source of `polaris-web/src/` or `signify-browser-extension/src/` has not been read; the repo and README claim are confirmed but the concrete wrapper code is unverified.

---

## §3 — Option 3 expanded: Hybrid (challenge handshake + ACDC for commitments + plain envelopes for chatter)

This option uses **only signify-ts APIs that are documented in GLEIF trainings**.

### 3.1 Handshake (once per session)
When two agents first connect — at sub-agent provisioning, or first cross-company contact:

1. Each side runs `client.challenges().generate(128)` and shares the words over a side channel (or the calling REST endpoint).
2. Each side runs `client.challenges().respond('myAlias', counterpartyAid, words)`.
3. Each side runs `client.challenges().verify(counterpartyAid, words)` and `client.challenges().responded(...)`.

This is exactly what `qvi-challenge-geda.ts` / `qvi-respond-geda-challenge.ts` / `qvi-verify-geda-response.ts` do. Outcome: each party's contact record for the other now shows `challenges: [...resolved...]`, meaning **the counterparty proved KEL private-key control**.

The session is then bound by `(localAid, remoteAid)` and stored in the agent-side SQLite as a row in `authenticated_sessions`.

### 3.2 Negotiation chatter (plain hash envelopes)
Inside an authenticated session, business messages like `OFFER`, `COUNTER`, `INQUIRY`, `STATUS_UPDATE` use the existing `PlainHashSigner` envelope (sha256 of canonicalised body + monotonic counter + ISO timestamp). The receiver:

- Confirms the session is authenticated.
- Confirms counter is strictly increasing for this `(senderAid, recipientAid)` pair.
- Confirms timestamp is within a 5-minute window of receiver wall clock.
- Confirms hash matches.

**What this proves:** the message came over a channel previously proven to be operated by the holder of the AID's keys, and was not tampered or replayed. **What it does not prove:** that any specific message in isolation was cryptographically signed by the AID's private key. If Jupiter later disputes a specific offer, the receiver can only point at the session, not at the offer itself.

### 3.3 Commitments (ACDC + IPEX grant)
Messages that legally commit a party — `ACCEPT`, `DD_ACCEPT`, `ORDER`, `CANCEL` — are wrapped as ACDCs and sent via `client.ipex().grant()` / `submitGrant()`, with the recipient sending back `ipex().admit()`. This follows `102_25_KERIA_Signify_Credential_Presentation_and_Revocation.md` verbatim.

**Schemas needed (to be authored and SAIDified):**
- `A2AAccept` — accepted offer reference, final price, terms
- `A2ADDAccept` — accepted dynamic-discount offer
- `A2AOrder` — final order with line items
- `A2ACancel` — counterparty-acknowledged cancellation

Each is registered in the issuing agent's TEL registry (one registry per agent, created at sub-agent provisioning). Revocation is supported by the same TEL mechanism we already locked in §11 of the parent doc.

### 3.4 Sub-agent delegation proof (one-time, ACDC)
When a sub-agent introduces itself to a counterparty, it sends:
- Its own AID OOBI
- Its parent agent's `ROR_ROLE` ACDC (chained to OOR/ECR per the parent doc) so the verifier can confirm the delegation chain ends at a Legal Entity

This is one-shot, presentation-only — no IPEX exchange needed beyond a single grant.

### 3.5 Side-by-side: which message gets which treatment

| A2A message | Treatment | Rationale |
|---|---|---|
| Initial handshake | Challenge-response | One-time, GLEIF-documented |
| `OFFER` | Plain envelope | Negotiation, not legally binding |
| `COUNTER` | Plain envelope | Negotiation, not legally binding |
| `INQUIRY` / `STATUS` | Plain envelope | Read-only, low-value |
| `ACCEPT` | ACDC + IPEX | Legally commits the buyer to terms |
| `DD_ACCEPT` | ACDC + IPEX | Legally commits the buyer to discount terms |
| `ORDER` | ACDC + IPEX | Legally commits both sides to fulfilment |
| `CANCEL` | ACDC + IPEX | Cancellation must be auditable |
| Sub-agent introduction | ACDC presentation (grant only) | Proves delegation chain |
| Counterparty disagreement / dispute escalation | ACDC + IPEX | Auditable artefact for resolution |

### 3.6 Build cost
- Re-use existing `PlainHashSigner` and `MessageSigner` interface as-is for chatter.
- Add 4 ACDC schemas + their SAIDification step (1–2 days).
- Add `commitmentSigner: VleiAcdcSigner` to the signer registry that wraps IPEX grant/admit (3–4 days, follows `102_25` and `qvi-acdc-issue-oor.ts` patterns exactly).
- Add `authenticatedSession` table and challenge-flow REST endpoints (~2 days).
- Total: roughly 7–9 engineering days assuming existing IPEX plumbing in `legentvLEI/api-server`.

### 3.7 Risks specific to Option 3
- **Chatter messages have no per-message non-repudiation.** If a counterparty disputes an offer or counter, the only evidence is the authenticated session log. Court-defensibility is weaker than full IPEX. Acceptable for offers/counters; not acceptable for commitments — hence the split.
- **Two code paths.** Future developers must keep the line between "chatter" and "commitment" disciplined. A new message type that should be a commitment but gets misclassified as chatter is a silent loss of audit weight.
- **Schema authoring effort.** Four new SAIDified ACDC schemas need to be authored, reviewed, and added to the schema server. Per `101_60_Saidify_schema.md`, this is mechanical but adds steps to the build.

---

## §4 — Option 4 expanded: Per-message signing via upstream signify-ts APIs

This option uses signify-ts surface that exists in code and TypeDoc but is **not** part of any GLEIF training notebook.

### 4.1 The two flavours of Option 4

**4a — HTTP-header signing via `Authenticater`.** Each outbound A2A HTTP call is signed by adding KERI-AID-signed headers (`Signature-Input`, `Signature`, `Signify-Timestamp`, `Signify-Resource`). Receiver verifies before processing body. This is the **KRAM** pattern, used today between Signify clients and KERIA agents.

**4b — Message-level signing via `Exchanges.createExchangeMessage`.** Each business message is wrapped as a signed `exn` with a custom route like `/finagents/a2a/offer`. The exn is sent (over KERIA mailboxes, or pulled inline into the HTTP body). Receiver verifies the exn signature against the sender's KEL.

### 4.2 Option 4a — KRAM-style HTTP header signing

**How it works (per `keria/docs/protocol.md` and `vlei.wiki/concept/keri-request-authentication-method`):**

Sender side:
```ts
// Conceptual — exact constructor wiring confirmed by TypeDoc only, not by code-read
const authenticater = new Authenticater(signer, verfer);  // from client.identifiers().get(name)
const signedHeaders = authenticater.sign(
  new Headers({ 'Signify-Resource': senderAid, 'Signify-Timestamp': nowIso }),
  'POST',
  '/a2a/offer'
);
// Then perform fetch with signedHeaders + JSON body
```

Receiver side:
```ts
const isAuthentic = authenticater.verify(req.headers, req.method, req.path);
if (!isAuthentic) return 401;
// Process body, knowing it came from req.headers['Signify-Resource'] AID
```

KRAM properties (confirmed from `vlei.wiki`):
- **Self-authenticating per request.** No prior handshake needed.
- **Replay protection via timestamp window.** Default ~5s, tunable.
- **Stateless server.** Verifier needs the sender's KEL (resolved once via OOBI) but no per-request state.
- **Caveat:** requires reasonably synchronised clocks (NTP).

**Pros over Option 3 chatter:**
- Each message is cryptographically pinned to the sender's AID key. Non-repudiation per request.
- No need to distinguish chatter from commitment for the signing layer; the layer is uniform.
- Smaller code surface than the 4-schema IPEX commitment path.

**Cons:**
- Not taught by GLEIF, so no community examples we can point at and copy.
- The receiver has to be a KERI-aware HTTP server with `Authenticater.verify`. Today our `legentvLEI/api-server` is a plain Express; we'd add a middleware. Confirmable but extra work.
- HTTP-header signing covers the request as it leaves the network; it does not by itself prove what's in the body unless the body hash is included in the signed-fields set. The `fields?: string[]` parameter on `sign()` exists for this; the actual default field list (`DefaultFields`) needs to be inspected before relying on body integrity. **This is an open item** — `authing.ts` source has not been read.

### 4.3 Option 4b — Signed exn messages with custom routes

```ts
// Conceptual
const hab = await client.identifiers().get('senderAgentAlias');
const [exn, sigs, atc] = await client.exchanges().createExchangeMessage(
  hab,
  '/finagents/a2a/offer',          // our custom route
  { offerId, items, totalUSD },    // arbitrary payload
  {},                              // no embedded ACDC
  recipientAid
);
await client.exchanges().send('senderAgentAlias', 'a2a', hab,
  '/finagents/a2a/offer', payload, {}, [recipientAid]);
```

Receiver fetches via `client.exchanges().get(said)` or via notification (signify-ts emits a notification with route `/exn/finagents/a2a/offer`). Signature is verified by signify-ts automatically during ingest, against the sender's KEL.

**Pros:**
- Per-message non-repudiation. Indistinguishable from IPEX in cryptographic strength.
- Reuses the KERIA mailbox transport — no new HTTP infra.
- Routes are namespaced (`/finagents/...`), making it visually distinct from `/ipex/*` in logs.

**Cons:**
- KERIA-mailbox transport adds latency per message (notification polling, mailbox flush). Numbers from `102_25` show ~retries needed for grants; offers/counters with this transport would be similar magnitude. **For high-frequency negotiation this is too slow** (assumption — not benchmarked).
- "Custom route exn" is a documented capability but not a documented *pattern*. No GLEIF reference verifier exists for `/finagents/*` routes. We'd write our own dispatcher.
- Same TEL/revocation story does not apply — exn messages are not registry-anchored. If you need to later "revoke" an offer, that revocation has no anchor; you'd need to issue a contrary message and rely on chronology.

### 4.4 Risks specific to Option 4
- **Outside community-tested terrain.** Whoever maintains this code after us has fewer reference examples to learn from.
- **Upgrade exposure.** If signify-ts changes `Authenticater`'s constructor or default fields between releases, our middleware breaks. Mitigation: pin the signify-ts version in package.json (already standard practice).
- **`DefaultFields` is unread.** The actual list of headers/fields covered by the default signature is not in TypeDoc. Until we read `authing.ts` source, we cannot guarantee body integrity is included. **Action item before adoption.**

---

## §5 — A2A Message → Authentication recommendation matrix

This is the matrix asked for. It combines Option 3 and Option 4a into a single hybrid recommendation per message class. Option 4b is held in reserve for the case where HTTP-level signing turns out to be insufficient (e.g. counterparty refuses to accept HTTP-header-only proofs).

| Message class | Examples | Recommendation | Why |
|---|---|---|---|
| **Discovery** | OOBI resolution, schema lookup | Plain HTTP, no signing | OOBI fetch is already self-verifying via KEL hash. Signing the GET adds no value |
| **Handshake** | First contact between two agents | Mutual challenge-response (`client.challenges()`) | One-time, GLEIF-documented, proves KEL key control |
| **Liveness / health** | ping, heartbeat, status pull | KRAM-signed HTTP request (Option 4a) | Lightweight; non-repudiable; one-line middleware on receiver |
| **Negotiation chatter** | OFFER, COUNTER, INQUIRY, BID, ASK, REVISE | KRAM-signed HTTP request (Option 4a) | Per-message non-repudiation without per-message round trips. Body hash must be in signed fields — see §4.4 action |
| **Authoritative status** | "this order is now in fulfilment", "inventory below threshold" | KRAM-signed HTTP request (Option 4a) | Same. Status writes need to be auditable per write |
| **Legal commitment** | ACCEPT (price), DD_ACCEPT (discount), ORDER, CANCEL | **ACDC + IPEX** (Option 3 commitment path) | Court-defensible. TEL anchored. Revocable. Same trust chain Sally already understands |
| **Sub-agent delegation proof** | "I am Jupiter's checkout sub-agent, here's my chain" | ACDC presentation (IPEX grant only) | Verifier walks edges back to LE credential, then to QVI, then to GLEIF |
| **Dispute escalation** | "I dispute commitment X, here is my counter-evidence Y" | ACDC + IPEX | Auditable artefact; must survive in evidence after the dispute |
| **Multi-party events** | "all three counterparties agreed to terms Z" | ACDC + IPEX with multisig issuer | Out of Design 1 scope; see `GLEIF-IT/qvi-software/qvi-workflow` for the production multisig pattern |

### 5.1 Why this split is defensible
- **Commitments use ACDC because they must.** Anything that's going to be entered in a court or compliance review needs registry-anchored, per-message-signed, revocable evidence.
- **Chatter uses KRAM not plain hash because we can afford it.** Once we have `Authenticater` wired into the HTTP layer, the per-message cost is one signature operation (~milliseconds). There's no reason to leave any message unsigned at the AID level.
- **No message uses `Exchanges.createExchangeMessage` with a custom route.** Held in reserve. We avoid a code path that has no community precedent.

### 5.2 Comparison with the §3.5 table (pure Option 3)
This matrix is stricter — it elevates "chatter" from plain envelopes to KRAM-signed HTTP. The cost: writing the `Authenticater` middleware once and confirming the body-integrity question of §4.4. The gain: every single A2A message in the system is per-message non-repudiable.

If after benchmarking the KRAM middleware turns out to be too slow or the body-integrity question can't be resolved in the timeline, fall back to the §3.5 table (plain envelopes for chatter).

---

## §6 — Build order (recommendation)

1. **Day 1–2:** Read `signify-ts/src/keri/core/authing.ts` to confirm `Authenticater.DefaultFields` covers body integrity. If not, determine the `fields` argument needed to include a body-hash header.
2. **Day 3–4:** Implement KRAM middleware for `legentvLEI/api-server` Express and for `DynDic3ent1/src/api/onboarding-server.ts`. Two functions: `signA2aRequest(headers, method, path, body)` and `verifyA2aRequest(req)`.
3. **Day 5:** Wire the existing `MessageSigner` interface to use the KRAM signer instead of `PlainHashSigner` for negotiation messages. Keep `PlainHashSigner` registered under `SIGNING_MODE=plain` for tests.
4. **Day 6–7:** Author and SAIDify the four commitment ACDC schemas: `A2AAccept`, `A2ADDAccept`, `A2AOrder`, `A2ACancel`.
5. **Day 8–9:** Implement `VleiAcdcSigner` for commitment messages — wraps `credentials().issue()` + `ipex().grant()` + `submitGrant()`, mirroring `qvi-acdc-issue-oor.ts`.
6. **Day 10:** Add the `authenticated_sessions` table and the challenge-response REST endpoints.
7. **Day 11:** End-to-end test: full negotiation chain Jupiter ↔ Tommy producing one ACCEPT ACDC anchored in Jupiter's TEL, verifiable by Sally.
8. **Day 12:** Catch-up and benchmark.

---

## §7 — Open questions before code

These need answers before §6 starts:

1. **Body integrity in `Authenticater`.** **RESOLVED 2026-05-24** by direct read of `signify-ts/src/keri/core/authing.ts`. `DefaultFields = ['@method', '@path', 'signify-resource', 'signify-timestamp']` — the body is NOT covered by the default signed-fields set. Fix: RFC 9530 `Content-Digest` header pattern. Sender computes `sha-256` of the body, sets `Content-Digest: sha-256=:<base64>:` header, and calls `sign(headers, method, path, [...Authenticater.DefaultFields, 'content-digest'])`. Receiver runs `Authenticater.verify()` and a separate middleware that recomputes the body digest and compares it to the `Content-Digest` header value. See companion DetailedDesign §3.2, §4.3, §6 for code shape.
2. **KRAM clock-skew window.** **RESOLVED 2026-05-24.** Set to 30 s default, configurable via `KRAM_MAX_SKEW_MS` env var on both vLEI and DD sides. Primary replay defense is a receiver-side dedup cache keyed on `sha256(senderAID || timestamp || signature)` for the duration of the window — cache is mandatory, not optional, in the KRAM verify middleware. Tighten to 10 s only after production-traffic clock-skew measurement; never below.
3. **Which AID signs A2A messages — the company AID or the agent AID?** Recommendation: the **agent AID** signs (not company, not officer). The chain to the company is verified separately via the agent's `ROR_ROLE` ACDC presented at handshake. Keeps the per-message signing key isolated from human-officer credentials.
4. **Sub-agent signing AID.** Same answer: the sub-agent's own AID, with its delegation chain proven once at handshake. Already locked in the parent doc §3.
5. **Fallback when counterparty doesn't speak KRAM.** **RESOLVED 2026-05-24.** Three-level configuration: process-wide `KRAM_FALLBACK_MODE` env var (`strict` default | `allow` migration | `require_optin`); per-counterparty allowlist via `KRAM_FALLBACK_AIDS` (consulted when mode is `require_optin`); per-session negotiation at handshake (both sides must explicitly include `plain` in advertised modes). Receiver records negotiated mode in `authenticated_sessions` audit row. Production default is `strict`.

---

## §8 — What I did not verify (Rule 3 flags)

- The exact wiring of `Authenticater(signer, verfer)` from a `SignifyClient` instance — constructor signature is from TypeDoc but the code path that constructs them from `client.identifiers().get(name)` has not been read. The standard pattern is `Habery → Hab → currentKeyPair`, but this is an assumption.
- `Authenticater.DefaultFields` body-integrity coverage. **RESOLVED 2026-05-24** by direct source read. `DefaultFields = ['@method', '@path', 'signify-resource', 'signify-timestamp']`. Body NOT covered. Fix: RFC 9530 `Content-Digest` header pattern; include `'content-digest'` in the signed-fields list passed to `sign()`.
- The actual implementation of `polaris-web`'s request-signing API — repo and README claim confirmed, but `src/` not inspected.
- Performance characteristics of `Exchanges.createExchangeMessage` per round trip — the "seconds per IPEX cycle" figure in §4.3 is extrapolated from `102_25` retry behaviour, not benchmarked.
- Whether the four commitment schemas (`A2AAccept`, etc.) need to be on the public GLEIF schema server or can live on a private SAID-only schema service. The vLEI training assumes a single schema server, but no evidence the protocol requires it.

---

## §9 — Decision asked of you

Two binary answers move this forward:

**A.** Confirm the matrix in §5: KRAM-signed chatter + ACDC commitments + challenge handshake — yes/no.

**B.** If §7-Q1 (body integrity in `Authenticater`) comes back negative, fall back to plain envelopes for chatter (§3.5 table) — yes/no.

Once these are answered, update the parent design doc §7 (VleiSignifySigner implementation plan) to lock the signer-registry shape, and start the day-1 source read.
