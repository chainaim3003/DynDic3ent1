# Project 1 — LegentPro: Design Folder Index

> **Project:** LegentPro · Accountable Enterprise Agentic Procurement
> **Folder:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\entAgentProject11\DESIGN\`
> **Codebase under design:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\`
> **Identity substrate:** `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\vLEIEnh1\legentvLEI\`
> **Last updated:** 2026-05-15

---

## 1. Purpose of this folder

This folder holds the **design documentation** for Project 1 of the Long FIN Agents-Team-1 hackathon submission. The actual code lives in `DynDic3ent1/`. The vLEI/KERI substrate lives in `vLEIEnh1/legentvLEI/`. This folder is documentation only — no code, no tests, no fixtures.

It is organised as a series of revisions, each in its own subfolder (`DESIGN1/`, `DESIGN2/`, ...). Each revision is a complete snapshot of the design as it stood at a point in time. Later revisions *supersede* earlier ones for design decisions, but the earlier revisions are preserved as the historical record of what was decided when and why.

**If you only have time to read one thing**, read **DESIGN2/design-2-detailed-design.md**. It is the current authoritative detailed design.

---

## 2. Folder map

```
entAgentProject11/DESIGN/
│
├── README.md                                         ← you are here
│
├── DESIGN1/                                          ← May 18 reference baseline (historical, extracted)
│   ├── design-1-problem-solution-impact.md          ← The "what & why" — problem, refined solution, impact, audience
│   ├── design-1-conceptual-design.md                ← The "shape" — bow-tie diagram, 5-layer delegation chain, end-to-end deal flow
│   ├── design-1-detailed-design.md                  ← The "blueprint" — 7-node agent graph, edges, invariants, 13 MCP tools, 16-attack enumeration
│   └── design-1-files-on-disk.md                    ← Inventory of where the live LegentPro codebase actually lives
│
└── DESIGN2/                                          ← CURRENT authoritative detailed design
    ├── design-2-detailed-design.md                  ← Four-axis architecture: Strategy × LLM × Credential × Signing (NEW)
    └── CHANGELOG.md                                  ← What changed in revision 2 and why
```

---

## 3. What each revision contains and when to read it

### DESIGN1 — original extraction (May 18 reference baseline)

DESIGN1 was extracted from the source chat "Long FIN Agents-Team-1" before the detailed code reads of revision 2. It captures the **product-level design**: what LegentPro is, why it matters, who buys it, how it fits the hackathon, what's already live, what changes for the hackathon submission. The detailed-design file in DESIGN1 (`design-1-detailed-design.md`) is the *first pass* — it specifies the agent graph, attack-vector enumeration, and 13 MCP tools, but it pre-dates the full code inspection that revealed the six concrete vLEI touchpoints and the un-signed A2A wire.

**Read DESIGN1 when:**
- You want the product story for a pitch, slide deck, or judge submission.
- You want the conceptual diagrams of who talks to whom.
- You want the original problem framing and impact analysis (CPO, CISO, CFO, General Counsel personas).
- You want the historical baseline to compare what the design *was* vs what it is *now*.
- You are writing a Phase-3 hardening retrospective and need to cite where the 16-attack enumeration first appeared.

**Do NOT read DESIGN1 when:**
- You are implementing the autonomous-negotiation refactor. Use DESIGN2.
- You want the current decision on how `MessageSigner` and `CredentialProvider` are abstracted. Use DESIGN2.
- You want to know which files in `DynDic3ent1/` to modify. Use DESIGN2 §4.

### DESIGN2 — current detailed design with four-axis architecture

DESIGN2 is a single file, `design-2-detailed-design.md`, that is **the implementation-ready design**. It was written after full reads of `seller-agent/index.ts`, `buyer-agent/index.ts`, `vlei-verification-client.ts`, `llm-client.ts`, `treasury-agent/index.ts`, `negotiation-types.ts`, `vLEIEnh1/legentvLEI/api-server/server.js`, and `Legent/A2A/js/src/agents/JupiterTreasuryAgent/.env`. Every claim in DESIGN2 is rooted in a specific file and line.

The core difference vs DESIGN1: DESIGN2 separates the system into **four orthogonal axes** — Strategy (rules vs autonomous), LLM (groq vs gemini), Credential (plain vs vlei), and the brand-new **MessageSigner** axis (plain vs vlei). Sixteen runtime configurations, all valid env-var-switchable options on the same build.

**Read DESIGN2 when:**
- You are about to modify code in `DynDic3ent1/`.
- You want to know exactly which file/line to change for which feature.
- You want to understand what runs WITH vLEI vs WITHOUT vLEI, and what the audit trail looks like in each mode.
- You want to understand the per-message envelope signing plan (`secure-passport`-shaped, hash in plain mode, KERI Ed25519 via signify-ts in vlei mode).
- You want the Phase 1 (May 18) / Phase 2 (Jun 1) / Phase 3 (post-Jun 1) split.

**Companion document in DESIGN2:**
- `CHANGELOG.md` documents every change DESIGN2 made vs DESIGN1, with motivation for each.

---

## 4. Reading order recommendations

### For an implementer about to write code (the primary case)

1. `DESIGN2/CHANGELOG.md` — three minutes — orients you to what's current.
2. `DESIGN2/design-2-detailed-design.md` §0 (Operating Principles), §2 (As-Implemented Behavior), §3 (Target Architecture), §4 (Detailed Component Designs) — this is the work.
3. `DESIGN2/design-2-detailed-design.md` §6 (Phasing Plan) — confirms what's May 18 vs Jun 1 vs later.
4. `DESIGN2/design-2-detailed-design.md` §7 (Open Questions) — the items to confirm BEFORE editing files.
5. `DESIGN1/design-1-files-on-disk.md` only if confused about where the live codebase actually is.

### For a reviewer or stakeholder (product / judge / exec)

1. `DESIGN1/design-1-problem-solution-impact.md` — the pitch.
2. `DESIGN1/design-1-conceptual-design.md` — the picture.
3. `DESIGN2/design-2-detailed-design.md` §8 (Security Posture by Mode) — the maturity story per configuration.

### For a security reviewer

1. `DESIGN1/design-1-detailed-design.md` §5 (the 16-attack enumeration).
2. `DESIGN2/design-2-detailed-design.md` §2 (the six vLEI touchpoints inventoried), §4.4 (`MessageSigner` interface), §8 (security posture table by mode).

### For someone resuming work after a gap

1. This README.
2. `DESIGN2/CHANGELOG.md`.
3. `DESIGN2/design-2-detailed-design.md` §6 (where we are in the phasing plan).

---

## 5. Status — what's done vs what's open

### Documentation (this folder)

| Item | Status |
|---|---|
| Problem / solution / impact (DESIGN1) | ✅ Complete |
| Conceptual diagrams (DESIGN1) | ✅ Complete |
| First-pass detailed design (DESIGN1) | ✅ Complete |
| Files-on-disk inventory (DESIGN1) | ✅ Complete |
| Revised detailed design with 4 axes + MessageSigner (DESIGN2) | ✅ Complete |
| Changelog explaining DESIGN1 → DESIGN2 deltas | ✅ Complete (see DESIGN2/CHANGELOG.md) |
| Phase 2 design refinements (Inventory/Credit/Logistics sub-agents) | ◻️ DESIGN3 folder, post-Jun 1 |
| Phase 3 hardening notes (secure-passport URI, traceability schema, replay window) | ◻️ DESIGN3+ folder, post-Jun 1 |

### Code (in `DynDic3ent1/` — outside this folder, listed here only for context)

| Component | Status per DESIGN2 |
|---|---|
| Buyer + Seller A2A agents (live, ~100 NEG-* runs in escalations/) | ✅ Live; awaiting refactor per DESIGN2 §4.6, §4.7 |
| Treasury sub-agent | ✅ Live; small wrapper change per DESIGN2 §4.8 |
| Groq LLM client | ✅ Live; refactor to `GroqProvider` per DESIGN2 §4.3 |
| Gemini LLM client | ◻️ New (`GeminiProvider`) per DESIGN2 §4.3 |
| Strategy abstraction (`shared/strategy.ts`) | ◻️ New per DESIGN2 §4.1 |
| Credential abstraction (`shared/credential-provider.ts`) | ◻️ New per DESIGN2 §4.2 |
| Message signing abstraction (`shared/message-signer.ts`) | ◻️ New per DESIGN2 §4.4 |
| Inbound envelope verify hook in agents | ◻️ New per DESIGN2 §4.5 |
| Outbound envelope sign hook in agents | ◻️ New per DESIGN2 §4.5 |
| Audit pipeline extensions (`strategyTraces`, `consultations`, `signingEvents`) | ◻️ New per DESIGN2 §4.8 |
| UI `StrategyTracePanel.tsx` | ◻️ New per DESIGN2 Phase 1 step 10 |
| Phase 2 sub-agents (Inventory, Credit, Logistics) | ◻️ New per DESIGN2 §4.9 (Jun 1) |
| `VleiProvider` / `VleiSignifySigner` implementations | ◻️ Specified, implemented Phase 2 |

✅ = exists on disk and runs · ◻️ = specified in DESIGN2, not yet implemented

---

## 6. Conventions used in the design documents

These conventions appear throughout DESIGN1 and DESIGN2:

- **`[verified]`** — claim is rooted in a file read directly on disk in this session, with the path cited.
- **`[unread]`** — claim is plausible but the underlying file was not read in this session and must be confirmed before code change.
- **`[new]`** — new file or new behavior introduced by the design; does not exist today.
- **✅ / ◻️ / ⚠️** — emoji status markers: implemented / specified-but-unimplemented / pre-existing issue requiring decision.
- **§N** — section reference within the same document (e.g. "see §4.4").
- **Touchpoint N** — one of the six concrete vLEI/IPEX call sites inventoried in DESIGN2 §2.1.

---

## 7. Project naming — clarifying a thing that will confuse a reader

The Long FIN Agents-Team-1 chat ran three project routes (1, 2, 3). This folder is named `entAgentProject11` and documents **Project 1 only**. The double-1 in the folder name has no special meaning — it is a project-numbering quirk and should not be read as "two ones." If you see references to Project 2 (ACTUS Hedge Advisor) or Project 3 elsewhere, those are different routes that are not designed here.

**To find Project 2 design**, look in `LEGENT-PROC/PROJECT2_BOWTIE_REFRAMED.md` (per DESIGN1/design-1-files-on-disk.md).

---

## 8. How to extend this folder

When a new design revision is needed (e.g. Jun 1 Phase 2 closes out, post-Jun 1 Phase 3 starts):

1. Create `DESIGN3/`, write `design-3-detailed-design.md` and `CHANGELOG.md` inside it.
2. Update this `README.md`:
   - Add `DESIGN3/` to the folder map (§2).
   - Add a "Read DESIGN3 when..." paragraph (§3).
   - Update the status table (§5).
3. **Do NOT delete or modify earlier revisions** (`DESIGN1/`, `DESIGN2/`). They are the historical record. Each revision is a frozen snapshot.

This append-only revisioning makes the design folder its own change history without needing a separate VCS layer for documentation.

---

**End of README.md**
