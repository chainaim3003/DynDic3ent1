# vLEI Enhancement Design 1 — Detailed Design

**Author:** Sathya Bala
**Date:** 2026-05-24
**Status:** Draft for review (DESIGN-2 iteration)
**Companion to:**
- `vLEI-ENH-Design-1-Sathya-Bala.md` (parent, locked decisions in §11)
- `vLEI-ENH-Design-1-Sathya-Bala-Hybrid.md` (light/heavy auth split)
- `vLEI-ENH-Design-1-Sathya-Bala-EndpointBucketing.md` (per-endpoint bucket)
- `vLEI-ENH-Design-1-Sathya-Bala-MCP-Consolidation.md` (2-tool MCP + Bearer auth)

This doc extends the three completed design docs into **project structure + code-level design + integration points across `vLEIEnh1` and `DynDic3ent1`**. It does not re-litigate locked decisions; it operationalises them.

---

## §0 — Grounding (what was actually read this turn)

Direct reads (filesystem) on 2026-05-24:

| File | What was verified |
|---|---|
| `vLEIEnh1\legentvLEI\api-server\server.js` | 15 routes; Express ES-modules; binds `0.0.0.0:4000`; `runVerification` shells out to bash scripts; IPEX endpoints write temp config and call shell scripts; A2A-style logger middleware runs first |
| `vLEIEnh1\legentvLEI\api-server\package.json` | `express ^4.18.2`, `cors ^2.8.5`; ES modules (`"type": "module"`); no other deps |
| `vLEIEnh1\legentvLEI\.env` | Bare — only `UID=1000` and `GID=1000`. No vLEI-specific env vars yet |
| `DynDic3ent1\A2A\js\src\messaging\MessageSigner.ts` | Interface: `mode()`, `seal<T>()`, `verify<T>()`, optional `resetCounters()` |
| `DynDic3ent1\A2A\js\src\messaging\PlainHashSigner.ts` | SHA-256 envelope + counter + 5-min staleness + 30-s future-skew. Replay-protected. Counters per `(sender, receiver)` pair |
| `DynDic3ent1\A2A\js\src\messaging\signed-message.ts` | `SigningMode = "plain" \| "vlei"`; envelope schema; `VerificationFailureReason` enum |
| `DynDic3ent1\A2A\js\src\messaging\index.ts` | Factory: `getMessageSigner()`; selects on `SIGNING_MODE` env var; `"vlei"` throws today (deferred to "Phase 2 / iteration 14") |
| `DynDic3ent1\A2A\js\package.json` | Has `@a2a-js/sdk ^0.3.3`, `express ^4.21.2`, `dotenv`, `uuid`. **No `signify-ts` dependency yet.** Uses tsx + pnpm |

Files referenced by inference, **not read this turn** — claims about them carry uncertainty:

| File | Why it matters | Inference flag |
|---|---|---|
| `vLEIEnh1\legentvLEI\sig-wallet\src\client\resolve-env.ts` | Where `aws` network preset gets added (parent doc §11) | Out of Phase 1 scope; flagged for Phase 1c |
| `DynDic3ent1\A2A\js\src\agents\buyer-agent\index.ts` | Has the fetch calls into `:4000` that need Bearer headers | Read before applying Phase-1 step 4 diff |
| `DynDic3ent1\A2A\js\src\agents\seller-agent\index.ts` | Same | Same |
| `DynDic3ent1\A2A\js\src\api\onboarding-server.ts` | Express :6060 routes | Affected only when KRAM verify middleware ships (Phase 1b) |
| `signify-ts/src/keri/core/authing.ts` | `Authenticater.DefaultFields` body-integrity question | **READ 2026-05-24** by Q1 deep-dive. `DefaultFields = ['@method', '@path', 'signify-resource', 'signify-timestamp']`. Body NOT covered. Resolution: RFC 9530 `Content-Digest` header pattern. **Q1 RESOLVED.** |
| `@modelcontextprotocol/typescript-sdk` README/source | Exact `Server` and tool registration API for MCP | **UNREAD this turn; verify against current SDK docs before MCP scaffold** |

Per Rule 4 ("Official docs only"), the code skeletons in §3 and §4 below cite official URLs (`weboftrust.github.io/signify-ts/`, `vlei.wiki`, `keria/docs/protocol.md`, `modelcontextprotocol/typescript-sdk`) rather than reproducing API surface from memory. Skeletons explicitly marked `// STUB` are not safe to run as-is.

---

## §1 — Scope of this doc

**In scope:**
- Project structure (file tree) for `vLEIEnh1` and `DynDic3ent1` after Phase 1–3 land
- Code design for new files (auth middleware, KRAM stub, MCP server skeleton, KramSigner skeleton)
- Modifications to existing files (server.js, .env, messaging/index.ts, signed-message.ts, agent index.ts files)
- Integration sequences across the two projects
- A live "verified vs inferred" tracker

**Out of scope (already locked or deferred):**
- The light/heavy decision matrix itself (Hybrid §5 is canonical)
- The per-endpoint role assignments (EndpointBucketing §3 + MCP-Consolidation §8 are canonical)
- The 2-tool MCP design (MCP-Consolidation §4 is canonical)
- KRAM body-integrity (Hybrid §7-Q1, **RESOLVED 2026-05-24** — use RFC 9530 `Content-Digest` pattern; see §3.2 and §4.3)

---

## §1.5 — Responsibility split: what belongs on which side

### 1.5.1 Conceptual line

**`vLEIEnh1` (the vLEI side)** owns cryptographic operations on identities and credentials. It holds KERI key material in shell-script-invoked paths, runs verification scripts, and issues/admits ACDCs via the existing IPEX endpoints. It is intentionally *unaware* of business logic — it doesn't know what a "negotiation" is, what a "discount curve" means, or what payment terms apply.

**`DynDic3ent1` (the dynamic discounting side)** owns A2A negotiation business logic. It runs buyer, seller, treasury, and other agent processes; manages offer/counter/accept flow; computes prices and discount curves. Each agent process is the *edge* for its own AID — it imports `signify-ts` and holds its own BRAN to sign messages on its own behalf. It calls vLEI's REST endpoints over HTTP+Bearer for verification and ACDC issuance, but does not call vLEI for routine cryptographic operations on its own AID.

This split is grounded in two architectural facts:

1. **KERI's "Key At The Edge" (KATE) principle.** Per [keria/README](https://github.com/WebOfTrust/keria) — *"All client tasks/calls are signed 'at the edge', not in the hosted KERIA instance"* — and the [Finema KERI tutorial](https://medium.com/finema/keri-tutorial-sign-and-verify-with-signify-keria-833dabfd356b), the process that *uses* an AID is the process that *holds* the BRAN. There is no published KERI pattern of "trusted backend microservice signs on behalf of other trusted backend microservices."
2. **Parent doc §7 commits each DD agent process to its own in-process signify-ts client.** `VleiSignifySigner.ts` is declared NEW under `DynDic3ent1/A2A/js/src/messaging/`. KRAM signing uses the same secret (the agent's controller key from the same BRAN), so placement follows.

### 1.5.2 What lives where

| Responsibility | Side | File / endpoint |
|---|---|---|
| KERI key material storage | vLEI | `legentvLEI\task-data\{alias}-bran.txt` (and DD-local copy per Q10 below) |
| AID provisioning | vLEI | `task-scripts/agent/`, `task-scripts/subagent/` |
| Verification scripts (DEEP, DEEP-EXT, DEEP-EXT-CREDENTIAL) | vLEI | `task-scripts/` invoked by api-server |
| ACDC issuance + IPEX grant | vLEI | `POST /api/seller/ipex/issue-and-grant` |
| ACDC admit | vLEI | `POST /api/buyer/ipex/admit` |
| Bearer API key middleware (`requireRole`) | vLEI | `api-server/lib/auth-middleware.js` |
| `vlei-llms.txt` catalog | vLEI | `api-server/vlei-llms.txt` |
| `mcp-vlei` MCP server (LLM-facing) | vLEI | `vLEIEnh1\mcp-vlei\` |
| A2A negotiation logic | DD | `agents/buyer-agent/`, `agents/seller-agent/`, etc. |
| Business rules (price, terms, discount curves) | DD | `agents/*/index.ts` |
| Light-tier message signing (KRAM) | DD | `messaging/KramSigner.ts` (Phase 1b) |
| Plain-mode signing (today's MVP) | DD | `messaging/PlainHashSigner.ts` |
| `MessageSigner` interface | DD | `messaging/MessageSigner.ts` |
| Bearer header on outbound fetch | DD | `agents/buyer-agent/index.ts`, `seller-agent/index.ts` |
| Heavy-tier message signing (ACDC + IPEX) | **vLEI** | API call via `POST /api/seller/ipex/issue-and-grant`; DD never signs ACDCs in-process |

Note the last row: **the heavy tier deliberately stays on vLEI side**, because ACDC issuance is low-frequency (per-commitment, not per-message) and the existing shell-script infrastructure (`invoice-acdc-issue-self-attested.sh`, `invoice-ipex-grant.sh`) is already in place. DD agents call vLEI for ACDC issuance; they do not duplicate the issuance logic in their own processes.

### 1.5.3 What crosses the boundary

**DD → vLEI** (HTTP, Bearer-authenticated, 5 verified endpoints in `server.js`):

| Endpoint | Purpose | Frequency |
|---|---|---|
| `POST /api/buyer/verify/ext/seller` | Buyer verifies seller's vLEI chain | Per first contact + per dispute |
| `POST /api/seller/verify/ext/buyer` | Seller verifies buyer's vLEI chain | Per first contact + per dispute |
| `POST /api/buyer/verify/sellerInvoice` | Buyer verifies a received invoice ACDC | Per ACDC received |
| `POST /api/seller/ipex/issue-and-grant` | Seller issues invoice/PO ACDC + grants to buyer | Per commitment |
| `POST /api/buyer/ipex/admit` | Buyer admits a granted ACDC | Per commitment |

**vLEI → DD: nothing.** The vLEI side is a service. No callbacks. (The api-server's A2A-style colour logger is display-only — it does not initiate outbound calls.)

### 1.5.4 Dependencies

| Side | Existing (verified this session) | New (this design) |
|---|---|---|
| vLEI api-server (`legentvLEI/api-server/`) | `express ^4.18.2`, `cors ^2.8.5` | None for Phase 1; `dotenv` optional |
| vLEI MCP server (`mcp-vlei/`) | — (new project) | `@modelcontextprotocol/sdk`, `undici`, `typescript`, `tsx` (versions TBD via current README check) |
| vLEI sig-wallet (`sig-wallet/`) | `signify-ts` (already used by `getOrCreateClient` for AID provisioning + verification flows) | None new |
| DD A2A package (`A2A/js/`) | `@a2a-js/sdk ^0.3.3`, `express ^4.21.2`, `dotenv ^17.2.3`, `uuid ^11.0.3` | **`signify-ts`** (Phase 1b only — Phase 1 ships without it) |

Phase 1 (auth scaffold) adds zero new npm dependencies on either side — just the middleware file, env vars, and *optional* Bearer headers on the 4 fetch call sites (keys can be deferred to graduation phase per Q8 revision; see §3.5). `signify-ts` becomes a DD dependency only when KramSigner ships in Phase 1b.

### 1.5.5 Why not "vLEI as signing oracle" (rejected alternative)

The earlier framing of "Option 2 — DD calls vLEI for signing" was researched against published KERI patterns and rejected on three grounds:

- **No KERI-ecosystem precedent for a trusted-backend signing oracle.** The published patterns for "where signify-ts runs" are: in your own process (the default, e.g., `sig-wallet/src/client/identifiers.ts:getOrCreateClient`), in a browser extension ([polaris-web](https://github.com/WebOfTrust/polaris-web) + [signify-browser-extension](https://github.com/WebOfTrust/signify-browser-extension) — justified because webpages cannot be trusted with KERI keys), in a desktop daemon ([healthKERI Locksmith](https://docs.healthkeri.com/) — for end-user wallets), or in a sidecar gateway ([healthKERI RACK](https://docs.healthkeri.com/quickstart.md) — for KERI-unaware applications like Mirth Connect being retrofitted). None of these models is "trusted-backend-microservice signs on behalf of other trusted-backend-microservices."
- **Doesn't reduce attack surface.** `VleiSignifySigner` (already pinned to DD side per parent doc §7) needs the same secret (the BRAN-derived controller key) as KRAM. Moving KRAM to vLEI while leaving VleiSignifySigner on DD side just adds an HTTP roundtrip per chatter message without removing the BRAN from DD's memory.
- **Centralizes risk.** A vLEI signing service holding BRANs for every DD agent identity would be a "super-edge" — compromise of vLEI process would compromise every agent identity. KATE-aligned per-agent BRANs limit blast radius to one identity at a time.

The polaris-web pattern is structurally similar (webpage asks extension for signed headers), but it exists specifically because webpages run untrusted code from arbitrary origins. DD agent processes are not in that category.

---

## §2 — Project structure

### 2.1 `vLEIEnh1\` — additions and modifications

Legend: `NEW` = create; `MOD` = modify existing; `−` = unchanged in this iteration.

```
vLEIEnh1\
├── DESIGN\                                       −  (Bucketing.md + MCP-Consolidation.md already on disk)
├── DESIGN-2\                                     NEW
│   ├── vLEI-ENH-Design-1-Sathya-Bala-Hybrid.md
│   └── vLEI-ENH-Design-1-Sathya-Bala-DetailedDesign.md
│
├── legentvLEI\
│   ├── api-server\
│   │   ├── server.js                             MOD  insert requireRole middleware before each route
│   │   ├── package.json                          −    no new deps for Phase 1
│   │   ├── README.md                             −
│   │   ├── lib\                                  NEW directory
│   │   │   ├── auth-middleware.js                NEW  requireRole(minRole)
│   │   │   ├── kram-verify-middleware.js         NEW  STUB until Hybrid §7-Q1 resolved
│   │   │   └── catalog-loader.js                 NEW  Phase 2 — parses vlei-llms.txt
│   │   └── vlei-llms.txt                         NEW  Phase 2 — endpoint catalog
│   │
│   ├── .env                                      MOD  add AUTH_MODE + 3 API keys
│   ├── sig-wallet\                               −    (Phase 1c: resolve-env.ts → add aws preset)
│   └── ... (everything else)                     −
│
└── mcp-vlei\                                     NEW project, Phase 3
    ├── package.json                              NEW
    ├── tsconfig.json                             NEW
    ├── README.md                                 NEW
    ├── .env.example                              NEW  VLEI_API_KEY, VLEI_API_BASE_URL, ...
    └── src\
        ├── server.ts                             NEW  MCP entry, registers 2 tools
        ├── tools\
        │   ├── search-endpoints.ts               NEW  vlei_search_endpoints implementation
        │   └── call-endpoint.ts                  NEW  vlei_call_endpoint implementation
        ├── catalog\
        │   ├── parser.ts                         NEW  parses vlei-llms.txt → in-memory index
        │   └── index.ts                          NEW  EndpointIndex class
        ├── http-client.ts                        NEW  Bearer-authenticated fetch to api-server
        └── env.ts                                NEW  env-var loader + validation
```

### 2.2 `DynDic3ent1\` — additions and modifications

```
DynDic3ent1\
├── DESIGN\                                       −  unchanged (this is DynDic3ent1's own design history)
├── DESIGN-2\                                     NEW
│   ├── vLEI-ENH-Design-1-Sathya-Bala-Hybrid.md
│   └── vLEI-ENH-Design-1-Sathya-Bala-DetailedDesign.md
│
└── A2A\js\
    ├── package.json                              MOD  Phase 1b: add signify-ts dependency
    └── src\
        ├── messaging\
        │   ├── MessageSigner.ts                  −    interface unchanged
        │   ├── PlainHashSigner.ts                −    unchanged
        │   ├── signed-message.ts                 MOD  extend SigningMode to "plain" \| "kram" \| "vlei"
        │   ├── index.ts                          MOD  register "kram" mode in factory
        │   └── KramSigner.ts                     NEW  Phase 1b SKELETON (Hybrid §7-Q1 blocked)
        │
        ├── agents\
        │   ├── buyer-agent\
        │   │   ├── index.ts                      MOD  send Bearer header on 4 fetch calls into :4000
        │   │   └── .env                          MOD  add VLEI_API_KEY_AGENT + VLEI_API_BASE_URL
        │   ├── seller-agent\
        │   │   ├── index.ts                      MOD  same
        │   │   └── .env                          MOD  same
        │   ├── treasury-agent\                   −    no Phase-1 changes (:7070 is internal microservice)
        │   ├── credit-agent\                     −    out of Design 1 scope
        │   ├── inventory-agent\                  −    out of Design 1 scope
        │   └── logistics-agent\                  −    out of Design 1 scope
        │
        └── api\
            └── onboarding-server.ts              MOD  Phase 1b: KRAM verify middleware (blocked on §7-Q1)
```

### 2.3 Cross-project call graph

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│  DynDic3ent1 buyer-agent    │         │  DynDic3ent1 seller-agent   │
│  (port 9090, A2A handler)   │         │  (port 8080, A2A handler)   │
│                             │         │                             │
│  fetch:4000 + Bearer        │         │  fetch:4000 + Bearer        │
└────────────┬────────────────┘         └────────────┬────────────────┘
             │                                       │
             │ HTTPS, Authorization: Bearer <agent-key>
             │                                       │
             ▼                                       ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │  vLEIEnh1 legentvLEI\api-server (port 4000)                      │
   │  ─ Express logger (existing)                                     │
   │  ─ requireRole(minRole) middleware (NEW)                         │
   │  ─ requireKram() middleware (NEW, stub; activated after §7-Q1)   │
   │  ─ 15 REST endpoints                                             │
   │  ─ GET /llms.txt (Phase 2, no auth)                              │
   └──────────────────────────────────────────────────────────────────┘
             ▲                                       ▲
             │ HTTPS, Authorization: Bearer <agent-key>
             │                                       │
   ┌─────────┴────────────────┐         ┌────────────┴──────────────────┐
   │  vLEIEnh1 mcp-vlei       │         │  Browser / React UI           │
   │  (MCP server, Phase 3)   │         │  (direct REST today)          │
   │  2 tools, reads          │         │                               │
   │  vlei-llms.txt           │         │                               │
   └─────────┬────────────────┘         └───────────────────────────────┘
             ▲
             │ stdio / SSE / streamable-http
             │
   ┌─────────┴────────────────┐
   │  LLM agent (Claude, etc) │
   └──────────────────────────┘
```

---

## §3 — Code design inside `vLEIEnh1`

### 3.1 Phase 1: API key middleware on the api-server

**Goal:** Every request to port 4000 (except `/health` and the future `/llms.txt`) carries `Authorization: Bearer <key>`; the server rejects without one.

**New file:** `vLEIEnh1\legentvLEI\api-server\lib\auth-middleware.js`

Refined from MCP-Consolidation §6.3 against the actual server.js shape (ES modules, no body-parser variant of express.json):

```javascript
// lib/auth-middleware.js
// Reads keys from process.env at module load; restart api-server to rotate.
const AUTH_MODE = (process.env.AUTH_MODE || 'none').toLowerCase();
const KEYS = {
  operator: process.env.VLEI_API_KEY_OPERATOR,
  agent:    process.env.VLEI_API_KEY_AGENT,
  viewer:   process.env.VLEI_API_KEY_VIEWER,
};
const ROLE_ORDER = { viewer: 0, agent: 1, operator: 2 };

/**
 * Returns Express middleware that enforces a minimum role.
 * AUTH_MODE=none           → passthrough (must be combined with loopback bind)
 * AUTH_MODE=api_key        → requires Bearer header matching one of the 3 keys
 * AUTH_MODE=signed         → reserved for Phase 1b (KRAM); not handled here
 */
export function requireRole(minRole) {
  return (req, res, next) => {
    if (AUTH_MODE === 'none') return next();
    if (AUTH_MODE !== 'api_key') {
      return res.status(500).json({
        success: false,
        error: `Unsupported AUTH_MODE=${AUTH_MODE} (expected one of: none, api_key)`,
      });
    }
    const hdr = req.headers.authorization || '';
    const m = hdr.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return res.status(401).json({ success: false, error: 'Missing or malformed Bearer token' });
    }
    const presented = m[1].trim();
    let presentedRole = null;
    for (const [role, key] of Object.entries(KEYS)) {
      if (key && presented === key) { presentedRole = role; break; }
    }
    if (!presentedRole) {
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }
    if (ROLE_ORDER[presentedRole] < ROLE_ORDER[minRole]) {
      return res.status(403).json({
        success: false,
        error: `Endpoint requires role >= ${minRole}; presented role: ${presentedRole}`,
      });
    }
    req.authRole = presentedRole;
    next();
  };
}

/**
 * Startup-time check. Call from server.js right before app.listen():
 *   - AUTH_MODE=none  : warn loudly if bind isn't loopback (Q8 revised: warn, don't throw)
 *   - AUTH_MODE=api_key : throw if any of the 3 keys is missing
 */
export function validateAuthConfig(bindHost) {
  if (AUTH_MODE === 'none') {
    if (bindHost !== '127.0.0.1') {
      console.warn('');
      console.warn('  ╔═════════════════════════════════════════════════════════════════╗');
      console.warn('  ║  ⚠  WARNING: AUTH_MODE=none with bind ' + bindHost.padEnd(28) + ' ║');
      console.warn('  ║  This server is UNAUTHENTICATED and reachable on all interfaces.   ║');
      console.warn('  ║  Suitable for development/testing only.                            ║');
      console.warn('  ║  Set AUTH_MODE=api_key + 3 keys before customer-facing deployment. ║');
      console.warn('  ╚═════════════════════════════════════════════════════════════════╝');
      console.warn('');
    } else {
      console.log('[auth] AUTH_MODE=none (loopback bind, safe for local development)');
    }
    return;
  }
  if (AUTH_MODE === 'api_key') {
    const missing = Object.entries(KEYS).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) {
      throw new Error(
        `[auth] AUTH_MODE=api_key but missing keys: ${missing.join(', ')}. ` +
        `Either set the 3 VLEI_API_KEY_* env vars or switch back to AUTH_MODE=none.`
      );
    }
    console.log('[auth] AUTH_MODE=api_key (3 keys loaded, role-based access enforced)');
    return;
  }
  throw new Error(`[auth] Unknown AUTH_MODE=${AUTH_MODE} (expected: none | api_key)`);
}
```

**Modifications to `server.js`** (additions only; existing code preserved):

```javascript
// Near the top, after existing imports:
import { requireRole, validateAuthConfig } from './lib/auth-middleware.js';

// ... existing logger middleware ...

// Apply requireRole to each route per MCP-Consolidation §8 role matrix.
// Health endpoint stays unauthenticated (operational probes).
app.get('/health', (req, res) => { ... });                                       // unchanged

app.get('/api/status',         requireRole('viewer'),  (req, res) => { ... });
app.get('/api/ipex-status',    requireRole('viewer'),  (req, res) => { ... });

app.post('/api/buyer/verify/seller',         requireRole('agent'), async (req, res) => { ... });
app.post('/api/seller/verify/buyer',         requireRole('agent'), async (req, res) => { ... });
app.post('/api/buyer/verify/ext/seller',     requireRole('agent'), async (req, res) => { ... });
app.post('/api/seller/verify/ext/buyer',     requireRole('agent'), async (req, res) => { ... });
app.post('/api/buyer/verify/sellerInvoice',  requireRole('agent'), async (req, res) => { ... });

app.post('/api/seller/ipex/issue-and-grant', requireRole('agent'), async (req, res) => { ... });
app.post('/api/buyer/ipex/admit',            requireRole('agent'), async (req, res) => { ... });

// Legacy /api/verify/* endpoints (deprecated): same agent role for backward compat
app.post('/api/verify/seller',     requireRole('agent'), async (req, res) => { ... });
app.post('/api/verify/buyer',      requireRole('agent'), async (req, res) => { ... });
app.post('/api/verify/ext/seller', requireRole('agent'), async (req, res) => { ... });
app.post('/api/verify/ext/buyer',  requireRole('agent'), async (req, res) => { ... });
app.post('/api/verify/:agentType', requireRole('agent'), async (req, res) => { ... });

// Right before app.listen():
validateAuthConfig('0.0.0.0');

app.listen(PORT, '0.0.0.0', () => { ... }); // unchanged
```

**Note on the bind host (Q8 revised 2026-05-24 per your direction "test without keys first, add later"):** server.js currently listens on `'0.0.0.0'` (verified). When `AUTH_MODE=none` (the default) and the bind isn't loopback, `validateAuthConfig` emits a loud boxed startup WARNING but does **not** throw — the server boots, prints the warning, and accepts unauthenticated traffic. This preserves the dev-friendly "no keys needed to test" workflow while making it operationally obvious that auth is off. When `AUTH_MODE=api_key`, missing-key misconfig still throws (correct — if you turn auth on but forget to provide keys, you'd otherwise refuse all traffic silently). Closes the EndpointBucketing §5.4 gap with awareness rather than enforcement.

### 3.2 Phase 1b: KRAM verify middleware (STUB; Q1 resolved 2026-05-24)

**New file:** `vLEIEnh1\legentvLEI\api-server\lib\kram-verify-middleware.js`

Currently a 501 stub. The Q1 research blocker is resolved by direct read of `signify-ts/src/keri/core/authing.ts`: `DefaultFields = ['@method', '@path', 'signify-resource', 'signify-timestamp']` — body NOT covered by the default signed-fields set. The middleware uses the **RFC 9530 `Content-Digest`** pattern: include `'content-digest'` in the signed-fields list at sign time, and compare the recomputed body digest at verify time.

```javascript
// lib/kram-verify-middleware.js — STUB until Phase 1b implementation lands.
// Q1 resolved 2026-05-24 by direct read of signify-ts authing.ts:
//   DefaultFields = ['@method', '@path', 'signify-resource', 'signify-timestamp']
//   Body NOT covered. Use RFC 9530 Content-Digest pattern.
//
// When implemented this middleware will (Q2 + Q5 locks 2026-05-24 incorporated):
//   1. Parse Signify-Resource header → sender AID; reject if missing
//   2. Parse Signify-Timestamp header → ISO timestamp; reject if missing/unparseable
//   3. Staleness check (Q2): |now - timestamp| <= KRAM_MAX_SKEW_MS (default 30s).
//      Reject KRAM_TIMESTAMP_STALE if outside window.
//   4. Dedup check (Q2): key = sha256(senderAID || timestamp || signature). If
//      key already in cache, reject KRAM_REPLAY. Else add to cache with TTL =
//      KRAM_MAX_SKEW_MS. In-memory LRU sufficient for single-process api-server;
//      Redis required if scaling beyond one process.
//   5. Fallback policy check (Q5): if envelope claims plain mode, consult
//      KRAM_FALLBACK_MODE. If 'strict', reject MODE_MISMATCH. If 'require_optin',
//      check sender AID against KRAM_FALLBACK_AIDS allowlist. If 'allow', accept
//      but log degraded session for audit.
//   6. Resolve sender AID's KEL via OOBI cache; get current key state
//   7. Construct Authenticater(signer=null, verfer=publicKey) for that AID
//   8. authenticater.verify(req.headers, req.method, req.path) — confirms
//      signature covers (@method, @path, signify-resource, signify-timestamp,
//      content-digest)
//   9. For methods with body: recompute sha-256 of req.rawBody, base64-encode,
//      compare to value in Content-Digest header. Reject on mismatch.
//   10. For GET/no-body methods: skip step 9.
//   11. Optionally re-verify trust chain via existing vlei-verification-client.
//
// Server-side body capture note: Express's default express.json() consumes the
// stream. Insert express.raw({ type: '*/*' }) (or a small middleware that
// stashes req.rawBody) BEFORE express.json() so this middleware can recompute
// the digest from raw bytes.
//
// References:
//   - signify-ts authing.ts (read 2026-05-24): https://github.com/WebOfTrust/signify-ts/blob/main/src/keri/core/authing.ts
//   - RFC 9421 (HTTP Message Signatures)
//   - RFC 9530 (Digest Fields)
//   - https://www.vlei.wiki/concept/keri-request-authentication-method (KRAM)
//   - https://github.com/WebOfTrust/keria/blob/main/docs/protocol.md (SKRAP)
export function requireKram() {
  return (req, res, next) => {
    return res.status(501).json({
      success: false,
      error: 'KRAM verification not yet implemented; Phase 1b deliverable (Q1 resolved, implementation pending)',
    });
  };
}
```

Activation plan: once the Phase 1b implementation lands (Q1 resolved, no longer a blocker), wire `requireKram()` *after* `requireRole(...)` on routes that require both layers. Bearer identifies the *deployed identity*; KRAM identifies the *AID controlling the request*. These are orthogonal.

### 3.3 Phase 2: `vlei-llms.txt` catalog + serving route

**New file:** `vLEIEnh1\legentvLEI\api-server\vlei-llms.txt`

Format per MCP-Consolidation §5.2. One markdown section per non-deprecated endpoint (10 entries: routes #1–8 + #14 + #15). Each section includes path, description, minimum role, state-changing flag, body schema, response sample.

**New file:** `vLEIEnh1\legentvLEI\api-server\lib\catalog-loader.js`

Parses `vlei-llms.txt` into an in-memory index. Used (a) by a startup CI test that asserts every Express route in `server.js` has a catalog entry, and (b) by future health endpoints that surface the catalog count. The MCP server (§3.4) does its own parsing client-side.

**Modifications to `server.js`** — add the catalog route:

```javascript
import fs from 'fs';
import path from 'path';

const LLMS_TXT_PATH = path.join(__dirname, 'vlei-llms.txt');

// Public documentation file — no auth.
app.get('/llms.txt', (req, res) => {
  try {
    const content = fs.readFileSync(LLMS_TXT_PATH, 'utf8');
    res.type('text/markdown').send(content);
  } catch (err) {
    res.status(500).json({ error: 'Catalog file not found' });
  }
});
```

**CI test (separate file, framework TBD):** parse `vlei-llms.txt` for `**Path:**` lines, parse `server.js` for `app.{get,post,...}('...')` definitions, fail if any non-deprecated route lacks a catalog entry. Without this gate the catalog will drift; MCP-Consolidation §5.3 names this discipline explicitly.

### 3.4 Phase 3: `mcp-vlei\` TypeScript project skeleton

**New project at:** `vLEIEnh1\mcp-vlei\`

Stack rationale (recommended for confirmation D in MCP-Consolidation §12): TypeScript, matching DynDic3ent1's stack and sig-wallet's stack so anyone touching the vLEI tree has a unified toolchain. Following massive's *structure* (2 tools + catalog) does not require matching their *language* (Python).

**`package.json`** (skeleton):

```json
{
  "name": "mcp-vlei",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev":   "tsx src/server.ts",
    "inspect": "npx @modelcontextprotocol/inspector node dist/server.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "*",
    "undici": "*"
  },
  "devDependencies": {
    "@types/node": "^22",
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

Version pins deliberately left as `"*"` — the actual `@modelcontextprotocol/sdk` version must be verified against the current README at `https://github.com/modelcontextprotocol/typescript-sdk` before install. Same for `undici`.

**`src/server.ts`** (skeleton — exact MCP SDK API verified against the current SDK README before implementation):

```typescript
// src/server.ts — SKELETON; exact API surface depends on
// @modelcontextprotocol/sdk current version. See:
//   https://github.com/modelcontextprotocol/typescript-sdk
// for current Server class, tool registration, and transport setup.
//
// At a high level, this file:
//   1. Loads env (env.ts)
//   2. Parses vlei-llms.txt on startup (catalog/parser.ts) into EndpointIndex
//   3. Registers two tools: vlei_search_endpoints, vlei_call_endpoint
//      (input schemas per MCP-Consolidation §4.2, §4.3)
//   4. Starts the chosen transport (stdio default; MCP_TRANSPORT env override)
//
// Do not write the registration calls without verifying the current SDK API.
```

**`src/tools/search-endpoints.ts`** — implements MCP-Consolidation §4.2 schema:
- Input: `{ query, detail?, max_results? }`
- Output: ranked list with title/method/path/description; adds bodySchema when `detail >= "more"`; adds responseSample when `detail = "verbose"`
- Pure read from in-memory `EndpointIndex`; no HTTPS calls

**`src/tools/call-endpoint.ts`** — implements MCP-Consolidation §4.3 schema:
- Input: `{ path, method?, body?, params?, confirm_state_change? }`
- Steps:
  1. Strip path; reject `..`, `\`, `?`, `#` (massive's perimeter rules per `mcp_massive/server.py`)
  2. Look up path in `EndpointIndex.isPathAllowed(path)` — reject `Error [NOT_FOUND]` if not in catalog
  3. If catalog flags `stateChanging: true` and `confirm_state_change !== true` → `Error [STATE_CHANGE_GUARD]`
  4. Validate body against catalog's JSON schema — reject with field-level errors
  5. Build request via `http-client.ts` with `Authorization: Bearer ${VLEI_API_KEY}` header
  6. Map HTTP codes to massive-style category prefixes: `Error [AUTH]:` 401/403, `Error [RATE_LIMIT]:` 429, `Error [SERVER]:` 5xx, `Error [HTTP]:` other 4xx

**`src/catalog/parser.ts`** — parses `vlei-llms.txt` markdown format from §5.2 of MCP-Consolidation. Extracts per-section: `Path`, `Description`, `Minimum role`, `State changing`, `Body schema` (JSON block), `Response sample` (JSON block). Returns array of `EndpointSpec`.

**`src/catalog/index.ts`** — `EndpointIndex` class. Public methods:
- `search(query: string, opts: {detail, maxResults}): EndpointMatch[]` — simple token + substring match for the current scale (10–100 entries); BM25 if it ever grows beyond
- `isPathAllowed(path: string): boolean` — exact-match allowlist
- `getSpec(path: string): EndpointSpec | undefined`

**`src/http-client.ts`** — single function `callApiServer(path, method, body, params, params): Promise<...>`. Uses `undici` fetch, attaches Bearer header from env, applies massive's defensive query-string handling (`_extract_pagination_hint` equivalent — strip any `apiKey`/`apikey` keys if they appear, never include the key in URL).

**`src/env.ts`** — loads and validates:
- `VLEI_API_KEY` (required) — Bearer token for upstream calls
- `VLEI_API_BASE_URL` (default `http://localhost:4000`)
- `VLEI_LLMS_TXT_URL` (default `${VLEI_API_BASE_URL}/llms.txt`)
- `MCP_TRANSPORT` (default `stdio`; values: `stdio` | `sse` | `streamable-http`)

### 3.5 `.env` additions at `vLEIEnh1\legentvLEI\.env`

Current verified content:
```
UID=1000
GID=1000
```

Add (Phase 1; Q8 revised 2026-05-24 — keys optional for test phase):
```
# Phase 1: API key auth on the api-server (port 4000)
#
# AUTH_MODE values:
#   none    = no authentication (default; suitable for dev/test)
#             A boxed startup warning prints if bind is not loopback.
#   api_key = require Bearer header matching one of the 3 keys below
#             Switch to this mode + uncomment the 3 keys before customer-facing deployment.
AUTH_MODE=none

# Only required when AUTH_MODE=api_key (generate via: openssl rand -hex 32)
# VLEI_API_KEY_OPERATOR=<generate value>
# VLEI_API_KEY_AGENT=<generate value>
# VLEI_API_KEY_VIEWER=<generate value>
```

When you're ready to move from test to customer-facing deployment, the **graduation steps** are:

1. Generate 3 keys: `openssl rand -hex 32` × 3
2. Uncomment the 3 `VLEI_API_KEY_*` lines and paste in the values
3. Change `AUTH_MODE=none` → `AUTH_MODE=api_key`
4. Add `VLEI_API_KEY_AGENT=<agent value>` to both agent `.env` files (§4.2)
5. Restart api-server and agents
6. Smoke test: curl with and without keys; confirm 401/403/200 per role matrix

No code changes between test and production — just env config. Operator generates the key values out-of-band; no random crypto material is produced by Claude or committed to source.

Add (Phase 1b — KRAM tier, Q2 + Q5 locked 2026-05-24):
```
# Q2: KRAM clock-skew window (default 30s; tighten to 10s only after measurement)
KRAM_MAX_SKEW_MS=30000

# Q5: Plain-mode fallback policy
#   strict        = never accept plain envelopes (production default)
#   allow         = accept plain from any counterparty (migration only)
#   require_optin = accept plain only from KRAM_FALLBACK_AIDS or session-negotiated
KRAM_FALLBACK_MODE=strict

# Per-counterparty allowlist (comma-separated AID prefixes)
# Only consulted when KRAM_FALLBACK_MODE=require_optin
KRAM_FALLBACK_AIDS=
```

Phase 5 — Production network preset (PD-3 locked 2026-05-24; see §3.7 for full design):

```
# Network preset selector
#   docker     = local witness pool (default; what dev/CI use today)
#   testnet    = GLEIF testnet (existing)
#   gleif-prod = GLEIF production network (requires GLEIF_PROD_* env vars below)
WORKSHOP_ENV=docker

# Only required when WORKSHOP_ENV=gleif-prod — values from GLEIF onboarding docs
# GLEIF_PROD_ADMIN_URL=https://...
# GLEIF_PROD_BOOT_URL=https://...
# GLEIF_PROD_VLEI_SERVER_URL=https://...
# GLEIF_PROD_VERIFIER_URL=https://...
# GLEIF_PROD_WEBHOOK_URL=https://...
# GLEIF_PROD_WITNESS_URLS=https://wit1...,https://wit2...,...
# GLEIF_PROD_WITNESS_IDS=B...,B...,...
```

---

### 3.6 PD-2 lock: extensible revocation design (2026-05-24)

The parent doc §5 currently has a binary `revoke=true|false` flag on DELETE endpoints. **Locked 2026-05-24:** replaced with an extensible `revocationMode` enum + `cascade` + `scheduledAt` + `confirmationToken` design. **Immediate revocation is fully preserved** (current `revoke=true` maps to `revocationMode="immediate"` + token); the new modes add `soft` (recoverable) and `scheduled` (cancellable) for operations that don't need an irreversible TEL event.

#### 3.6.1 Request shape

```http
DELETE /api/lifecycle/officer/:alias
Content-Type: application/json
Authorization: Bearer <operator key>

{
  "revocationMode": "soft|scheduled|immediate",
  "cascade": false,
  "scheduledAt": "2026-06-23T00:00:00Z",                // required if mode=scheduled
  "confirmationToken": "REVOKE-{alias}-{YYYY-MM-DD}",   // required if mode=immediate
  "cascade_immediate_confirmed": true,                   // required if cascade=true AND mode=immediate
  "reason": "free-text, logged for audit"
}
```

#### 3.6.2 Mode matrix

| Mode | KERI TEL change | Reversible | Extra confirmation | Use when |
|---|---|---|---|---|
| `soft` (default) | None | Yes — flip the flag back | None | Routine deactivation; reorganization; entity may be reactivated |
| `scheduled` | None until `scheduledAt`; auto-fires immediate at that time | Yes, until scheduled time | None to schedule; explicit DELETE to cancel | Planned offboarding with notice period |
| `immediate` | TEL revocation issued now; permanent | **No** | `confirmationToken` must equal `REVOKE-{alias}-{YYYY-MM-DD}` | Compromised key; legal mandate; emergency |

The current binary `revoke=true` maps cleanly to `revocationMode: "immediate"` + `confirmationToken`. The current binary `revoke=false` (or absent) maps to `revocationMode: "soft"` (default). **No capability is lost** — immediate revocation works exactly as today; the foot-gun is moved one keystroke away.

#### 3.6.3 Cascade semantics

`cascade: false` (default): only the named entity is affected. Delegates of a soft-revoked officer keep their AIDs valid; verifier-side policy decides whether to honor them via `entity_status.status`.

`cascade: true`: apply same `revocationMode` to all dependents (officer's agents, agent's sub-agents). Safe for `soft` and `scheduled`. For `immediate`, requires the additional `cascade_immediate_confirmed: true` parameter. **Three deliberate signals required to wreck a whole subtree:** `revocationMode=immediate`, `confirmationToken`, `cascade_immediate_confirmed=true`.

#### 3.6.4 SQLite schema additions

Two new tables (extending parent doc §10):

```sql
CREATE TABLE revocations (
  id                    TEXT PRIMARY KEY,         -- ulid
  entity_alias          TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK (mode IN ('soft','scheduled','immediate')),
  cascade               INTEGER NOT NULL,
  cascade_confirmed     INTEGER,                  -- 1 if cascade+immediate confirmed
  scheduled_at          TEXT,                     -- null for soft/immediate
  executed_at           TEXT,                     -- null until executed
  cancelled_at          TEXT,                     -- if scheduled and later cancelled
  confirmation_token    TEXT,                     -- the token used (for immediate)
  tel_anchor_said       TEXT,                     -- KEL/TEL SAID of the revocation event (immediate only)
  reason                TEXT,
  requested_by          TEXT NOT NULL,            -- operator role from auth context
  on_behalf_of          TEXT,                     -- X-On-Behalf-Of header (PD-1 / Phase 1c)
  created_at            TEXT NOT NULL
);

CREATE TABLE entity_status (
  entity_alias        TEXT PRIMARY KEY,
  status              TEXT NOT NULL CHECK (status IN ('active','inactive','revoked')),
  inactive_since      TEXT,
  revoked_since       TEXT,
  pending_revocation  TEXT,                       -- ISO timestamp of scheduled revocation
  updated_at          TEXT NOT NULL
);
```

`tel_anchor_said` makes the audit trail link directly to the on-chain revocation event in KERI — invaluable for forensic "did we actually revoke this?" queries.

#### 3.6.5 Defaults that minimize accidents

- `revocationMode` defaults to `soft`. Operator must explicitly type `"immediate"` to make anything permanent.
- `cascade` defaults to `false`.
- `confirmationToken` format `REVOKE-{alias}-{YYYY-MM-DD}` is self-documenting; mismatched token → 400, never a partial action.
- All three signals required for cascading immediate revocation: explicit mode, explicit token, explicit cascade-confirmed flag.

#### 3.6.6 Verifier-side honoring policy

Verifiers (Sally, `vlei-verification-client`) read `entity_status.status` when checking credentials issued by an entity. If `status='inactive'`, the credential is cryptographically valid but flagged "issued by an inactive entity" — the consuming application decides whether to honor it. If `status='revoked'`, the TEL revocation is authoritative regardless of local DB state.

Keeps the cryptographic layer clean: KERI revocations are global and final; local "inactive" is policy.

#### 3.6.7 Cancellation endpoint (scheduled mode only)

```http
DELETE /api/lifecycle/revocation/:revocationId
Authorization: Bearer <operator key>
```

Cancels a pending scheduled revocation. Refuses if mode is not `scheduled`, or if `executed_at` is already set. Logs `cancelled_at` and `requested_by`.

---

### 3.7 PD-3 lock: extensible network-preset design (2026-05-24)

The current `vLEIEnh1\legentvLEI\sig-wallet\src\client\resolve-env.ts` (read 2026-05-24) supports two presets: `docker` (default, local witness pool of WAN/WIL/WES/WIT/WUB/WYZ) and `testnet` (GLEIF testnet, hardcoded `*.testnet.gleif.org` URLs). PD-3 asked what production looks like.

**Locked 2026-05-24** (per your direction "make it similar to local docker, as default, configurable to GLEIF instance and other later"):

- Keep `docker` as the default. Unchanged.
- Add `gleif-prod` preset selected via the existing `WORKSHOP_ENV` env var.
- All `gleif-prod` URLs/witness IDs read from `GLEIF_PROD_*` env vars — **no hardcoded defaults**. Operator supplies them from GLEIF production network onboarding docs.
- Future production-network presets (private KERIA cluster, alternate regions) follow the same pattern: add a new `case` arm + a new env-var family. No architecture change.

#### 3.7.1 Updated EnvType and switch

```typescript
// resolve-env.ts — updates only; existing docker/testnet cases unchanged.
export type EnvType = 'docker' | 'testnet' | 'gleif-prod';

export function resolveEnvironment(input?: EnvType): WorkshopEnv {
    const preset = input ?? process.env.WORKSHOP_ENV ?? 'docker';
    switch (preset) {
        case 'docker':    return { /* existing case unchanged */ };
        case 'testnet':   return { /* existing case unchanged */ };
        case 'gleif-prod': return resolveGleifProd(preset);
        default:
            throw new Error(`Unknown test environment preset '${preset}'`);
    }
}

function resolveGleifProd(preset: EnvType): WorkshopEnv {
    const fromEnv = {
        adminUrl:       process.env.GLEIF_PROD_ADMIN_URL,
        bootUrl:        process.env.GLEIF_PROD_BOOT_URL,
        vleiServerUrl:  process.env.GLEIF_PROD_VLEI_SERVER_URL,
        verifierUrl:    process.env.GLEIF_PROD_VERIFIER_URL,
        webhookUrl:     process.env.GLEIF_PROD_WEBHOOK_URL,
        witnessUrlsCsv: process.env.GLEIF_PROD_WITNESS_URLS,
        witnessIdsCsv:  process.env.GLEIF_PROD_WITNESS_IDS,
    };
    const missing = Object.entries(fromEnv)
        .filter(([, v]) => !v)
        .map(([k]) => 'GLEIF_PROD_' + k.replace(/([A-Z])/g, '_$1').toUpperCase());
    if (missing.length) {
        throw new Error(
            'gleif-prod preset requires env vars: ' + missing.join(', ') +
            '. Values must be obtained from GLEIF production onboarding docs.'
        );
    }
    return {
        preset,
        adminUrl:      fromEnv.adminUrl!,
        bootUrl:       fromEnv.bootUrl!,
        vleiServerUrl: fromEnv.vleiServerUrl!,
        verifierUrl:   fromEnv.verifierUrl!,
        webhookUrl:    fromEnv.webhookUrl!,
        witnessUrls:   fromEnv.witnessUrlsCsv!.split(',').map(s => s.trim()),
        witnessIds:    fromEnv.witnessIdsCsv!.split(',').map(s => s.trim()),
    };
}
```

#### 3.7.2 Selection model

| Preset | Selection | URL source | Operator action |
|---|---|---|---|
| `docker` (default) | `WORKSHOP_ENV` unset or `=docker` | Hardcoded (`http://keria:3901`, local witness pool) | None |
| `testnet` | `WORKSHOP_ENV=testnet` | Hardcoded (`*.testnet.gleif.org`) | None |
| `gleif-prod` | `WORKSHOP_ENV=gleif-prod` | All from `GLEIF_PROD_*` env vars | Set the 7 env vars before starting |

#### 3.7.3 Why env vars (not hardcoded) for gleif-prod

Unlike testnet (well-known stable URLs shared across the community), GLEIF production endpoints may be operator-specific (per-org KERIA agent assignments, internal vs. external admin endpoints, regional routing) and are not known to this design without consulting GLEIF onboarding docs. Reading from env vars:

- Avoids hallucinated URLs being committed to source.
- Lets the operator configure without code changes (one `.env` edit, no recompile).
- The mandatory-env-vars throw prevents silent fallback to wrong endpoints.

When GLEIF production URLs are confirmed against authoritative GLEIF docs, the team can optionally hardcode them in a follow-up commit; the env-var override remains as a fallback for non-standard deployments.

#### 3.7.4 Adding future presets

The pattern for any future production topology (private KERIA cluster, alternate region, partner federation, etc.):

1. Add the literal to `EnvType`: e.g., `| 'private-aws'`
2. Add a `case 'private-aws':` arm to the switch in `resolveEnvironment`
3. Either hardcode URLs (if stable across deployments) or read from a new env-var family like `PRIVATE_AWS_*` (if operator-specific)
4. Document the env vars in `.env.example`

No architecture change at any step. The `WorkshopEnv` interface stays the same; only the resolver expands.

#### 3.7.5 Relationship to parent doc §11 `aws` preset

Parent doc §11 locked an `aws` preset as Phase 5; that lock predated PD-3 and was ambiguous about what `aws` named (deployment infrastructure vs. KERIA network endpoint). Under this PD-3 resolution, the network-endpoint dimension is handled by `gleif-prod` (and any future production-network presets via §3.7.4). If a private KERIA cluster on AWS is later required, it becomes a separate preset — e.g., `private-aws` — following §3.7.4. The deployment-infrastructure dimension (AWS vs. on-prem) is orthogonal to the preset name and lives in deployment configs (`docker-compose.yml`, Terraform, etc.), not in `resolve-env.ts`.

---

## §4 — Code design inside `DynDic3ent1`

### 4.1 Phase 1: Bearer header on agent fetch calls into `:4000`

Per SessionContinuation §8, four call sites today:
- `buyer-agent\index.ts`: fetch to `/api/buyer/verify/ext/seller`
- `seller-agent\index.ts`: fetch to `/api/seller/verify/ext/buyer`
- `seller-agent\index.ts`: fetch to `/api/seller/ipex/issue-and-grant`
- `buyer-agent\index.ts`: fetch to `/api/buyer/ipex/admit`

Per-call-site change pattern (illustrative — exact line numbers and surrounding code must be read before applying):

```typescript
// Before
const resp = await fetch(`${VLEI_API_BASE_URL}/api/buyer/verify/ext/seller`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
});

// After (Q8 revised 2026-05-24: Bearer header is optional — sent only when key is configured)
const headers: Record<string, string> = { "Content-Type": "application/json" };
const apiKey = process.env.VLEI_API_KEY_AGENT;
if (apiKey) {
  headers["Authorization"] = `Bearer ${apiKey}`;
}
const resp = await fetch(`${VLEI_API_BASE_URL}/api/buyer/verify/ext/seller`, {
  method: "POST",
  headers,
});
```

The `VLEI_API_BASE_URL` constant may already exist; if not, read it from `process.env.VLEI_API_BASE_URL ?? "http://localhost:4000"` once at module scope.

### 4.2 `.env` additions at agent .env files

`DynDic3ent1\A2A\js\src\agents\buyer-agent\.env` (Q8 revised 2026-05-24 — key optional):
```
# Base URL for the vLEI api-server (always set)
VLEI_API_BASE_URL=http://localhost:4000

# Only required when api-server is in AUTH_MODE=api_key
# VLEI_API_KEY_AGENT=<same value as set in vLEIEnh1\legentvLEI\.env>
```

Same for `seller-agent\.env`. When you graduate to `AUTH_MODE=api_key` on the api-server (see §3.5 graduation steps), uncomment `VLEI_API_KEY_AGENT` in both agent `.env` files and paste in the matching key value.

Phase 1b additions (Q2 + Q5 locked 2026-05-24, applies to both agent .env files):
```
# Q2: KRAM clock-skew window (match vLEI side for consistent verification)
KRAM_MAX_SKEW_MS=30000

# Q5: Plain-mode fallback policy (production default: strict)
KRAM_FALLBACK_MODE=strict
KRAM_FALLBACK_AIDS=
```

### 4.3 Phase 1b: messaging-layer KramSigner (SKELETON)

**Placement rationale (resolved Q9 — see §8).** KramSigner runs **inside each DD agent process**, imports `signify-ts`, and reads the agent's own BRAN file (BRAN path resolution: see Q10 in §8). It does NOT delegate signing to a vLEI-side HTTP endpoint. Three reasons:

1. KERI's "Key At The Edge" principle — the process that signs as AID X holds AID X's BRAN.
2. Parent doc §7.1 already pins `VleiSignifySigner.ts` as in-process on DD side; KRAM uses the same controller key, so placement follows.
3. The rejected alternative ("vLEI as signing oracle") is detailed in §1.5.5.

**Modification to `signed-message.ts`**:

```typescript
export type SigningMode = "plain" | "kram" | "vlei";

export type VerificationFailureReason =
  | "PAYLOAD_HASH_MISMATCH"
  | "ENVELOPE_HASH_MISMATCH"
  | "COUNTER_REPLAY"
  | "COUNTER_GAP"
  | "TIMESTAMP_STALE"
  | "TIMESTAMP_FUTURE"
  | "MISSING_ENVELOPE"
  | "MODE_MISMATCH"
  | "VLEI_SIGNATURE_INVALID"
  | "KRAM_SIGNATURE_INVALID";   // ← NEW
```

The `SignedEnvelope.signature?` field already exists and carries opaque signature material; KRAM mode populates it with the serialized signed-headers blob.

**Modification to `messaging/index.ts`** — add a case to the factory:

```typescript
import { KramSigner } from "./KramSigner.js";

export function getMessageSigner(): MessageSigner {
  if (cached) return cached;
  const raw = (process.env.SIGNING_MODE ?? "plain").toLowerCase().trim();

  if (raw === "kram") {
    cached = new KramSigner();   // throws today until §7-Q1 resolved
    console.log(`[messaging] Signer initialized: mode=kram (KRAM-signed HTTP envelope)`);
    return cached;
  }

  if (raw === "vlei") {
    throw new Error("[messaging] SIGNING_MODE=vlei still deferred (Phase 2 / iteration 14)");
  }
  // ... existing plain path ...
}
```

**New file:** `DynDic3ent1\A2A\js\src\messaging\KramSigner.ts` — **SKELETON only**:

```typescript
// KramSigner.ts — Phase 1b SKELETON.
//
// Q1 resolved 2026-05-24 by direct read of signify-ts authing.ts:
//   DefaultFields = ['@method', '@path', 'signify-resource', 'signify-timestamp']
//   Body NOT covered. Use RFC 9530 Content-Digest pattern.
//
// Implementation plan for seal():
//   1. const bodyBytes = Buffer.from(JSON.stringify(payload), 'utf8');
//   2. const digest = createHash('sha256').update(bodyBytes).digest('base64');
//   3. Construct outbound headers:
//        Signify-Resource:  <senderAID>
//        Signify-Timestamp: <ISO 8601 now>
//        Content-Digest:    sha-256=:<digest>:
//   4. authenticater.sign(headers, method, path,
//          [...Authenticater.DefaultFields, 'content-digest']);
//   5. Serialize the signed Headers into SignedEnvelope.signature (concrete
//      serialization shape is a Phase 1b design decision — JSON of header
//      map, or CESR-style structured attachment).
//
// Implementation plan for verify():
//   1. Deserialize signature → Headers object.
//   2. Reconstruct Authenticater(signer=null, verfer=senderPubKey) where
//      senderPubKey comes from client.keyStates().get(senderAID).k[0].
//   3. authenticater.verify(headers, method, path).
//   4. Recompute sha-256 of canonicalized payload, base64-encode, compare
//      to value in Content-Digest header. Reject KRAM_SIGNATURE_INVALID
//      on either signature or digest mismatch.
//
// References:
//   - signify-ts authing.ts (read 2026-05-24): https://github.com/WebOfTrust/signify-ts/blob/main/src/keri/core/authing.ts
//   - https://weboftrust.github.io/signify-ts/classes/Authenticater.html
//   - RFC 9421 (HTTP Message Signatures), RFC 9530 (Digest Fields)
//   - https://www.vlei.wiki/concept/keri-request-authentication-method

import { MessageSigner } from "./MessageSigner.js";
import { SealedMessage, SignedEnvelope, VerificationResult, SigningMode } from "./signed-message.js";
// import { createHash } from "node:crypto";
// import { Authenticater } from "signify-ts";  // Phase 1b: enable when implementing

export class KramSigner implements MessageSigner {
  constructor() {
    throw new Error(
      "[KramSigner] Not yet implemented. Phase 1b deliverable; " +
      "Q1 resolved (use Content-Digest pattern, see source comments)."
    );
  }
  mode(): SigningMode { return "kram"; }
  seal<T>(payload: T, senderAgentId: string, receiverAgentId: string): SealedMessage<T> {
    throw new Error("[KramSigner.seal] Not yet implemented");
  }
  verify<T>(sealed: SealedMessage<T>, expectedReceiver: string): VerificationResult {
    throw new Error("[KramSigner.verify] Not yet implemented");
  }
}
```

### 4.4 `package.json` dependency addition (Phase 1b)

`DynDic3ent1\A2A\js\package.json` currently has no signify-ts. KRAM and future ACDC paths both require it. Phase 1b adds:

```json
"signify-ts": "<current published version>"
```

The current version is to be verified at `https://www.npmjs.com/package/signify-ts` before installing — no version pinned in this doc to avoid stale claims.

Phase 1 (Bearer headers only) does NOT need signify-ts; it can ship first.

---

## §5 — Integration sequences

### 5.1 Today (no auth, baseline)

```
buyer-agent → POST /api/buyer/verify/ext/seller (no headers)
api-server  → runs DEEP-EXT shell script
api-server  → 200 OK with verification JSON
```

### 5.2 After Phase 1 (Bearer auth)

```
buyer-agent → POST /api/buyer/verify/ext/seller
              Authorization: Bearer <VLEI_API_KEY_AGENT>
              Content-Type:  application/json

api-server  → requireRole('agent')
              ✓ Bearer present, ✓ matches VLEI_API_KEY_AGENT, ✓ agent >= agent
              req.authRole = 'agent'; next()
api-server  → runs DEEP-EXT shell script
api-server  → 200 OK

If Bearer missing → 401 "Missing or malformed Bearer token"
If wrong key     → 401 "Invalid API key"
If viewer key on agent endpoint → 403 "Endpoint requires role >= agent"
```

### 5.3 After Phase 2 + 3 (Bearer + LLM via MCP)

```
User → LLM: "Verify the seller before negotiating."

LLM → vlei_search_endpoints(query="verify seller", detail="more")
mcp-vlei → reads in-memory EndpointIndex (parsed from vlei-llms.txt at startup)
mcp-vlei → returns: [
            { title:"Verify Seller (DEEP-EXT)",
              method:"POST", path:"/api/buyer/verify/ext/seller",
              minRole:"agent", stateChanging:false,
              bodySchema:{...} } ]

LLM → vlei_call_endpoint(path="/api/buyer/verify/ext/seller")
mcp-vlei → ✓ path in catalog
mcp-vlei → stateChanging=false, no confirm guard needed
mcp-vlei → body schema validates empty body ✓
mcp-vlei → fetch http://localhost:4000/api/buyer/verify/ext/seller
            Authorization: Bearer <VLEI_API_KEY from env>

api-server → requireRole('agent') ✓ → runs DEEP-EXT → 200 OK

mcp-vlei → returns formatted result to LLM
LLM → "Seller verified. Steps 1-5 all passed."

User → LLM: "Issue the invoice for INV-001, total ₹50000."

LLM → vlei_search_endpoints(query="issue invoice credential", detail="verbose")
mcp-vlei → returns: { path:"/api/seller/ipex/issue-and-grant", stateChanging:true,
                      bodySchema:{required:["invoiceId","totalAmount","type"], ...} }

LLM → vlei_call_endpoint(
        path="/api/seller/ipex/issue-and-grant",
        body={invoiceId:"INV-001", totalAmount:50000, type:"INVOICE"},
        confirm_state_change=true)

mcp-vlei → ✓ path in catalog, ✓ body schema, ✓ stateChanging + confirm
mcp-vlei → fetch ... Bearer ...
api-server → requireRole('agent') ✓ → IPEX issue+grant → 200 OK with credentialSAID

mcp-vlei → returns SAID to LLM
LLM → "Done. Credential SAID is E_abc..."
```

### 5.4 Future, Phase 1b active (Bearer + KRAM, illustrative)

Once KRAM stub is replaced, both layers run:

```
agent      → POST /api/buyer/verify/ext/seller
              Authorization:    Bearer <key>            ← who deployed me
              Signify-Resource: E<senderAID>            ← which AID controls me
              Signify-Timestamp: 2026-05-24T...Z
              Signature-Input:   ...
              Signature:         ...

api-server → requireRole('agent') ✓
             requireKram() ✓
             ... handler runs ...
```

The two are orthogonal: Bearer answers *which deployment is calling*; KRAM answers *which KERI identity is asserting the request body*. Audit trails can carry both.

---

## §6 — Verified vs inferred (Rule 3 tracker)

| Claim in this doc | Source | Confidence |
|---|---|---|
| api-server has 15 routes, binds 0.0.0.0:4000, ES modules | Direct read of `server.js` + `package.json` this turn | High |
| `.env` at `vLEIEnh1\legentvLEI` is bare (UID/GID only) | Direct read this turn | High |
| MessageSigner interface: `mode/seal/verify/resetCounters?` | Direct read of `MessageSigner.ts` this turn | High |
| PlainHashSigner: SHA-256 + per-pair counter + 5-min/30-s windows | Direct read of `PlainHashSigner.ts` this turn | High |
| Current `SigningMode = "plain" \| "vlei"`; `"vlei"` throws | Direct read of `index.ts` + `signed-message.ts` this turn | High |
| DynDic3ent1 A2A has `@a2a-js/sdk`, `express`, `dotenv`, `uuid`; no signify-ts | Direct read of `package.json` this turn | High |
| Buyer/seller fetch call sites are 4 (per SessionContinuation §8) | SessionContinuation §8 (not re-read this turn) | Medium — verify before applying Phase 1 step 4 diff |
| `requireRole` middleware shape | MCP-Consolidation §6.3 + standard Express middleware patterns | High |
| `Authenticater.DefaultFields` body-integrity coverage | Direct read of `signify-ts/src/keri/core/authing.ts` (2026-05-24): `['@method', '@path', 'signify-resource', 'signify-timestamp']`. Body NOT covered. Fix via RFC 9530 `Content-Digest` header pattern. | High |
| `Authenticater(signer, verfer)` constructor wiring from SignifyClient | TypeDoc only (Hybrid §8) | Inferred |
| Exact `@modelcontextprotocol/sdk` registration API for tools | NOT VERIFIED this turn — verify against current README | Inferred |
| Current published `signify-ts` version on npm | NOT VERIFIED this turn — verify before install | Inferred |
| `resolve-env.ts` `aws` preset wiring | Not read this turn; parent doc §11 locked decision | Deferred |

---

## §7 — Build order (consolidated)

Cross-references Hybrid §6 and MCP-Consolidation §9. Phases 1, 2, 3 ship first; Phase 1b (KRAM) is now unblocked (Q1 resolved 2026-05-24) and can run in parallel with Phase 2/3.

**Phase 1 — Auth scaffold (Q8 revised 2026-05-24: test without keys first; graduate to keys when ready). No signify-ts dependency.**

*Test phase (no keys needed):*
1. Author `vLEIEnh1\legentvLEI\api-server\lib\auth-middleware.js` (§3.1) — defaults to `AUTH_MODE=none`
2. Modify `server.js`: import + apply `requireRole` per role matrix; call `validateAuthConfig` before `app.listen`
3. Add `AUTH_MODE=none` to `vLEIEnh1\legentvLEI\.env` (keys commented out)
4. Add `VLEI_API_BASE_URL` to buyer-agent and seller-agent `.env` files (key line commented out)
5. Read `buyer-agent\index.ts` and `seller-agent\index.ts`; apply optional-Bearer-header diff to the 4 fetch call sites (§4.1) — header is sent only when `VLEI_API_KEY_AGENT` is set
6. Smoke test: curl every endpoint; confirm 200 responses (no auth required); confirm the unauthenticated-on-network warning prints at api-server startup

*Graduation phase (when ready for customer-facing deployment):*
7. Generate 3 API keys: `openssl rand -hex 32` × 3
8. Update `vLEIEnh1\legentvLEI\.env`: set `AUTH_MODE=api_key`, paste in 3 keys
9. Update buyer-agent and seller-agent `.env`: paste in `VLEI_API_KEY_AGENT` value matching vLEI's
10. Restart api-server + agents
11. Smoke test: curl every endpoint with and without keys; confirm 401/403/200 per role matrix

**Phase 2 — `vlei-llms.txt` catalog**
8. Author `vlei-llms.txt` (10 non-deprecated endpoints)
9. Add `GET /llms.txt` route to `server.js` (§3.3)
10. Author CI test: catalog ↔ Express route drift detection

**Phase 3 — mcp-vlei TypeScript scaffold**
11. Verify current `@modelcontextprotocol/sdk` API against its README
12. Scaffold `mcp-vlei\` per §3.4 file layout
13. Implement `EndpointIndex` + `parser.ts`
14. Implement `search-endpoints.ts` (§4.2 of MCP-Consolidation)
15. Implement `call-endpoint.ts` (§4.3 of MCP-Consolidation) including state-change guard
16. Test with `npx @modelcontextprotocol/inspector`
17. Register with Claude Desktop / Claude Code

**Phase 1b — KRAM tier (Q1 resolved 2026-05-24; Phase 1b deliverable)**
18. ~~Read `signify-ts/src/keri/core/authing.ts`. Resolve `DefaultFields` body-integrity question.~~ **DONE 2026-05-24** — see §3.2 / §4.3 for resolution.
19. Implement `KramSigner.ts` in DynDic3ent1 (§4.3)
20. Implement `requireKram()` in api-server (replace stub)
21. Add `signify-ts` to DynDic3ent1 `package.json`
22. End-to-end test KRAM-signed offers buyer ↔ seller

**Phase 4 — Heavy commitments (Hybrid §6 day 6–11)**
23. Author 3 commitment ACDC schemas (`A2AAccept`, `A2APurchaseOrder`, `A2ADDAccept`)
24. Implement `VleiAcdcSigner` (wraps `/api/seller/ipex/issue-and-grant` + `/api/buyer/ipex/admit`)
25. End-to-end test: full negotiation Jupiter ↔ Tommy producing one ACDC verifiable by Sally

**Phase 5 — Production network preset (PD-3 locked 2026-05-24)**
26. Add `gleif-prod` case to `vLEIEnh1\legentvLEI\sig-wallet\src\client\resolve-env.ts` per §3.7.1
27. Document the `GLEIF_PROD_*` env-var family in `.env.example`; document the `toad=1` unsafe-for-production warning
28. (Optional, when topology is known) add `private-aws` or other production-network preset following the §3.7.4 pattern

---

## §8 — Open questions tracker

From Hybrid §7:
- **Q1** Body integrity in `Authenticater.DefaultFields` — **RESOLVED 2026-05-24** by direct source read. `DefaultFields = ['@method', '@path', 'signify-resource', 'signify-timestamp']`; body NOT covered. Fix: RFC 9530 `Content-Digest` pattern, included in signed-fields list via `[...DefaultFields, 'content-digest']`. See §3.2 (verify middleware), §4.3 (KramSigner), §6 (verified row).
- **Q2** KRAM clock-skew window. **RESOLVED 2026-05-24.** Default 30 s via `KRAM_MAX_SKEW_MS` env var on both sides. Mandatory dedup cache keyed on `sha256(senderAID || timestamp || signature)` with TTL = window. Cache, not window, is primary replay defense. Tighten to 10 s only after production clock-skew measurement; never below. See §3.2 steps 3+4 and §3.5 / §4.2 env additions.
- **Q3** Which AID signs A2A messages — RESOLVED (agent AID, per Hybrid §7-Q3).
- **Q4** Sub-agent signing AID — RESOLVED (sub-agent's own AID).
- **Q5** Plain-mode fallback. **RESOLVED 2026-05-24** (configurable, per your direction). Three-level config: `KRAM_FALLBACK_MODE` env (`strict` default | `allow` | `require_optin`); per-counterparty allowlist `KRAM_FALLBACK_AIDS`; per-session negotiation at handshake. Receiver logs negotiated mode in `authenticated_sessions` audit row. Production default `strict`. See §3.2 step 5 and §3.5 / §4.2 env additions.

From MCP-Consolidation §12 (this session, recommendations):
- **A** 2-tool MCP design (`vlei_search_endpoints` + `vlei_call_endpoint`). **LOCKED 2026-05-24.** Scales without bloating registered tools as endpoints grow; matches massive.com pattern. Canonical implementation in MCP-Consolidation §4 + DetailedDesign §3.4.
- **B** `vlei-llms.txt` at `legentvLEI/api-server/`, served at `GET /llms.txt` (no auth). **LOCKED 2026-05-24.** Catalog co-located with `server.js` so a single CI test asserts no route↔catalog drift. Public discovery follows llmstxt.org convention. See §3.3.
- **C** `stateChanging` catalog flag + `confirm_state_change` tool parameter as state-change guard. **LOCKED 2026-05-24.** Catalog declares each endpoint as state-changing or not; `vlei_call_endpoint` rejects state-changing calls unless LLM passes `confirm_state_change: true`. Cheap guard against runaway agents firing irreversible operations. See MCP-Consolidation §4.3.
- **D** mcp-vlei in TypeScript. **LOCKED 2026-05-24.** Matches sig-wallet + DD agent stacks (npm/tsx/pnpm); keeps the vLEI tree on one toolchain. MCP SDK is first-class in TypeScript. See §3.4.
- **E** Fetch `massive.com/docs/rest/llms.txt` for byte-compat sanity check. **LOCKED 2026-05-24** (not blocking). One-time exercise to confirm header names, section structure, and code-block conventions match. Do before Phase 3 lands; Phase 2 can ship without it.

New (this turn):
- **Q6** `SigningMode` enum extended to `"plain" | "kram" | "vlei"`. **LOCKED 2026-05-24.** Three-mode split mirrors the Hybrid light/heavy/legacy tier model. Factory in `messaging/index.ts` adds a `kram` case alongside the existing `plain` and `vlei` (the latter still throws as deferred). See §4.3 and signed-message.ts modification in §4.3.
- **Q7** Legacy `/api/verify/*` endpoints under `requireRole('agent')`, excluded from `vlei-llms.txt`. **LOCKED 2026-05-24.** Backward compat preserved; canonical new shapes (`/api/buyer/verify/...`, `/api/seller/verify/...`) are what the MCP layer exposes to AI agents. Legacy endpoints still callable for existing clients. See §3.1 server.js modifications.
- **Q8** `validateAuthConfig` behavior with `AUTH_MODE=none`. **LOCKED 2026-05-24, REVISED 2026-05-24** (per your direction "test without keys first, add later"). Original lock: throw on `AUTH_MODE=none` + non-loopback bind. **Revised:** emit a loud boxed startup warning instead of throwing. Server boots and accepts unauthenticated traffic on `0.0.0.0`; warning makes the state operationally obvious. When `AUTH_MODE=api_key`, missing-key misconfig still throws (correct). Defaults: `AUTH_MODE=none` (test, default), `0.0.0.0` bind allowed but warned; `AUTH_MODE=api_key` (graduation, opt-in) requires all 3 keys present. Graduation = one env-var flip + 3 key values; no code change. See §3.1 (validateAuthConfig), §3.5 (.env shape + graduation steps), §4.1 (optional-Bearer fetch shape), §7 (test-phase + graduation-phase build order).

Resolved (signify-ts placement deep-dive, this turn):
- **Q9** KRAM signing placement. DD process imports `signify-ts` and holds the BRAN; signs locally. Confirmed by KATE principle (keria README + Finema tutorial), parent doc §7 commitment, and absence of any KERI-ecosystem precedent for a "trusted backend signing oracle" pattern (researched against healthKERI RACK, polaris-web, signify-browser-extension, KERIA architecture docs). See §1.5.5 for the rejected alternative and §4.3 for the placement rationale in code.

New (signify-ts placement deep-dive, this turn):
- **Q10** BRAN file location for DD agent processes. Parent doc places BRANs at `vLEIEnh1\legentvLEI\task-data\{alias}-bran.txt` for the existing shell-script pipeline; DD agent processes now also need read access. Two options:
  - **10a** DD agent reads BRAN directly from `vLEIEnh1\legentvLEI\task-data\`. Requires DD process to have filesystem access into the vLEI tree. Works on single host; awkward when DD and vLEI live in separate containers/pods.
  - **10b** At agent provisioning, write BRAN to two locations: vLEIEnh1's task-data (for shell-script IPEX issuance) **and** the DD agent's own config dir (e.g., `DynDic3ent1\A2A\js\src\agents\buyer-agent\.secret\agent-bran.txt`, `chmod 600`). DD reads its local copy.

  **LOCKED 2026-05-24: 10b.** DD processes shouldn't reach across project trees; duplicating to a sibling location doesn't materially change the threat model (BRAN already exists as a file on the same host). Provisioning script gains one extra `cp` + `chmod 600` per agent. Phase 1b `buyer-agent/index.ts` and `seller-agent/index.ts` diffs read from the DD-local path (e.g., `DynDic3ent1\A2A\js\src\agents\{alias}\.secret\agent-bran.txt`).

From parent doc §14 (raised when the original design was written; surfaced here for completeness, not all yet addressed):
- **PD-1** Operator authentication. **RESOLVED 2026-05-24.** Calls come from UI **and** AI agents. Both map to existing `agent` role with the same Bearer key — api-server treats them as indistinguishable callers. UI server holds the key (never browser JS); mcp-vlei holds the key for AI-agent calls. Phase 1c follow-up: add optional `X-On-Behalf-Of: <scheme>:<id>` header (e.g., `ui:user@example.com`, `mcp:claude/session-abc`) for audit-log identity. Header logged but never used for authorization (Bearer key already did that). ~30 lines of code in Phase 1c.
- **PD-2** Revocation semantics. **RESOLVED 2026-05-24.** Replace binary `revoke=true|false` with `revocationMode` enum (`soft` default | `scheduled` | `immediate`) + `cascade` + `scheduledAt` + `confirmationToken` (required for immediate) + `cascade_immediate_confirmed` (required for cascade+immediate). Two new SQLite tables (`revocations`, `entity_status`). **Immediate revocation fully preserved**; current binary `revoke=true` maps cleanly to `revocationMode=immediate` + token. See §3.6 for full spec.
- **PD-3** Network preset for production. **RESOLVED 2026-05-24.** Keep `docker` as default (unchanged). Add `gleif-prod` preset to `resolve-env.ts` for GLEIF production network. All `gleif-prod` URLs/witness IDs read from `GLEIF_PROD_*` env vars — no hardcoded defaults (operator supplies values from GLEIF onboarding docs; throws on missing). Future production-network presets (private KERIA cluster, alternate regions) added as additional `case` arms — no architecture change. Parent doc §11's `aws` preset reinterpreted: deployment-infrastructure dimension stays orthogonal to the preset name and lives in deployment configs, not `resolve-env.ts`. See §3.7 for the full spec.
- **PD-4** Sub-agent A2A messaging. Parent doc assumed sub-agents do NOT send A2A messages (they're REST-only consultees, e.g., treasury-agent's `/consult`). Permanent design or interim? If sub-agents will later send A2A, §4.3 KramSigner extends to them as-is, and their BRANs follow the same Q10 placement decision.
