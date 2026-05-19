# Project 1 — LegentPro: Accountable Enterprise Agentic Procurement
## design-4: Files on Disk (Inventory from Long FIN Agents-Team-1)

> **Source:** Extracted from chat "Long FIN Agents-Team-1"
> (https://claude.ai/chat/a0d16ca6-e71f-4eb7-84b5-5eee99c81124)
> **Date of inventory:** 2026-05-15
> **Method:** Direct `list_directory` reads of candidate folders, cross-checked against `Filesystem:write_file` calls visible in the source chat snippets.

---

## 1. Honest finding upfront

**Project 1 (LegentPro) is fundamentally different from Project 2 in one important way:**

- **Project 2 (ACTUS Hedge Advisor)** produced *design documents on disk* in `LEGENT-PROC` (the `PROJECT2_BOWTIE_REFRAMED.md` etc.) because it was a *new* design.
- **Project 1 (LegentPro)** is a **live, deployed production system**. The "files on disk" are the *actual codebase*, not freshly-written design docs. The source chat referenced existing files (agent code, vLEI client, NEST-3 design docs) but did not generate Project-1-specific design files in `LEGENT-PROC` the same way it did for Project 2.

---

## 2. Files verified ON DISK related to Project 1

### 2.1 In `C:\SATHYA\CHAINAIM3003\mcp-servers\LEGENT-PROC\`

| File | Project 1 relevance | Status |
|---|---|---|
| `PROJ1.txt` | Contains the **user's prompt** that generated this DESIGN folder (the exact wording of the request to extract Project 1 details into `entAgentProject11\DESIGN\`). NOT design content. | ✅ EXISTS (prompt only, ~10 lines) |
| `Agentic Procurement.pptx` | Original procurement pitch deck — predates the Long FIN Agents-Team-1 chat, but topic-aligned with LegentPro | ✅ EXISTS |
| `DEMO video - agent negotiation.mp4` | Recorded demo of the existing live A2A negotiation | ✅ EXISTS |
| `LegentPRO-V2.mp4` | LegentPro V2 demo video | ✅ EXISTS |
| `VLEI_Documentation.docx` | vLEI/KERI documentation — directly relevant to Project 1's trust layer | ✅ EXISTS |
| `FULL DOCUMENTATION PROJECT OVERVIEW.docx` | Overall project overview | ✅ EXISTS |
| `REVIEW_1.pptx` | Review presentation | ✅ EXISTS |
| `DRAPS_Narration_Script - v1.md` | DRAPS narration (Project 2 context, not Project 1) | ✅ EXISTS (not Project 1) |

**None of these were generated specifically by the Long FIN Agents-Team-1 chat as Project 1 design docs.** They are pre-existing assets for the LegentPro project.

### 2.2 Live codebase paths (the actual Project 1 system)

These are the directories where the running LegentPro system lives — verified by `list_directory` reads in the source chat and again now:

| Path | What it contains |
|---|---|
| `C:\SATHYA\CHAINAIM3003\mcp-servers\DynDisc\DynDiscNEST\` | NEST-target deployment of LegentPro (the "DynDiscNEST" / NANDA submission) |
| `C:\SATHYA\CHAINAIM3003\mcp-servers\DynDisc\DynDiscMiniProject1\` | Mini-project 1 codebase |
| `C:\SATHYA\CHAINAIM3003\mcp-servers\DynDisc\DynDiscMiniProject2\` | Mini-project 2 codebase (Dynamic Discounting + vLEI + A2A) — the **primary Project 1 reference codebase** |
| `C:\SATHYA\CHAINAIM3003\mcp-servers\DynDisc\NANDA_DynDisc\` | NANDA-targeted variant |

Key files inside `DynDiscMiniProject2`:
- `A2A/js/src/agents/buyer-agent/index.ts` — Tommy buyer agent (port 9090)
- `A2A/js/src/agents/seller-agent/index.ts` — Jupiter seller agent (port 8080)
- `A2A/js/src/agents/treasury-agent/index.ts` — Treasury sub-agent (port 7070)
- `A2A/js/src/shared/dd-calculator.ts` — Dynamic discount math
- `A2A/js/src/shared/llm-client.ts` — LLM client (Groq → Gemini swap target)
- `A2A/js/src/shared/negotiation-types.ts` — Type definitions
- `A2A/js/src/shared/vlei-verification-client.ts` — vLEI verification client
- `A2A/js/src/mcp/server.ts` — MCP server with 13 tools
- `legentvLEI/api-server/server.js` — IPEX issue-and-grant endpoint
- `A2A/agent-cards/jupiterSellerAgent-card.json` — Jupiter agent card with KERI chain

### 2.3 Other Project-1-related repos (also live)

- `C:\SATHYA\CHAINAIM3003\mcp-servers\stellarboston\vLEI1\vLEIWorkLinux1\` — vLEI Linux workshop scripts (KERI/KERIA setup)
- `C:\SATHYA\CHAINAIM3003\mcp-servers\stellarboston\LegentAlgoTITANV61\algoTITANV6\` — Algorand variant of LegentPro
- `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\ACTUS-MENTOR-MCP\` — ACTUS-Mentor (this is Project 2's reference codebase, but referenced in Project 1's ecosystem)

### 2.4 Documentation files referenced by the source chat

- `SUBMISSION-ARTICULATION.md` — submission writeup (read in source chat)
- `NEST-3-sathya-nisha-DESIGN.md` — NEST-3 production-hardening design
- `NEST-3-PART-1.5-MESSAGE-SIGNING.md` — full 16-attack-vector enumeration + message signing design
- `DESIGN_CITATIONS.md` — liability literature references (NeurIPS 2024, Interface EU 2025)

These are likely inside `DynDisc\NANDA_DynDisc\` or `DynDisc\DynDiscNEST\docs\` — not re-verified path by path in this extraction.

---

## 3. Files that the source chat *attempted* to write but were NOT found on disk

| File path | Status |
|---|---|
| `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\ACTUS-MENTOR-MCP\HACKATHON_IDEATION.md` | ❌ NOT present at this path as of 2026-05-15 |

**What was meant to be in it (per source-chat content):**
- Project 1 — LegentPro: Trustworthy Autonomous Procurement
- Project 2 — ACTUS Hedge Advisor
- Project 3 — (Midstream-based evaluation/value-attribution route)
- Hackathon framing: lablab.ai · Transforming Enterprise Through AI · Tracks 1, 2, 4
- Three-project comparison: problem / solution / impact / architecture for each route

**Honest read (per Rule 3):** The source chat shows a `Filesystem:write_file` call to this path, but the file is not at that location today. Either:
- (a) It was written but later moved/deleted
- (b) The write call did not persist
- (c) It is stored in a different path

I have *not* verified which of (a)/(b)/(c) is correct — would require git-log inspection.

---

## 4. Files in this DESIGN folder (the present extraction)

Folder: `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\entAgentProject11\DESIGN\`

| File | Contents |
|---|---|
| `design-1-problem-solution-impact.md` | Refined problem statement, refined solution, impact (audience + theme fit + 2×2 adoption story + track fit + market sizing) |
| `design-2-conceptual-design.md` | Bow-tie conceptual design + full textual visual diagram + 5-layer delegation chain + end-to-end deal flow |
| `design-3-detailed-design.md` | 2 axes (strategy × credential), 7-node agent graph, edges/invariants, shared-memory protocol, 13 MCP tools, 16-attack enumeration, build state |
| `design-4-files-on-disk.md` | This file — inventory of what was on disk from the source chat |

---

## 5. Cross-reference: where the originals live vs. where this extraction lives

```
LIVE CODEBASES (from Long FIN Agents-Team-1):
  C:\SATHYA\CHAINAIM3003\mcp-servers\DynDisc\
    ├── DynDiscNEST\          << NEST submission variant
    ├── DynDiscMiniProject1\
    ├── DynDiscMiniProject2\  << PRIMARY Project 1 reference codebase
    └── NANDA_DynDisc\        << NANDA submission variant
  C:\SATHYA\CHAINAIM3003\mcp-servers\stellarboston\vLEI1\vLEIWorkLinux1\
  C:\SATHYA\CHAINAIM3003\mcp-servers\stellarboston\LegentAlgoTITANV61\algoTITANV6\

EXISTING ASSETS (in LEGENT-PROC, predate the source chat):
  C:\SATHYA\CHAINAIM3003\mcp-servers\LEGENT-PROC\
    ├── PROJ1.txt                      (just the user's prompt, ~10 lines)
    ├── Agentic Procurement.pptx
    ├── DEMO video - agent negotiation.mp4
    ├── LegentPRO-V2.mp4
    ├── VLEI_Documentation.docx
    └── FULL DOCUMENTATION PROJECT OVERVIEW.docx

THIS EXTRACTION (clean, versioned design docs):
  C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\entAgentProject11\DESIGN\
    ├── design-1-problem-solution-impact.md
    ├── design-2-conceptual-design.md
    ├── design-3-detailed-design.md
    └── design-4-files-on-disk.md     (this file)
```

---

## 6. Important note on "the latest refined version"

The user (in the Project 2 follow-up) flagged that for Project 2, an *older* draft was on disk (`PROJECT2_ACTUS_HEDGE_ADVISOR.md` — cross-border framing) and a *newer* draft was also on disk (`PROJECT2_BOWTIE_REFRAMED.md` — demo-to-prod, US-business framing). The newer one was authoritative.

**For Project 1, this concern does NOT apply the same way** because:
- There is no `PROJECT1_ACTUS_*.md` or `PROJECT1_BOWTIE_REFRAMED.md` on disk.
- Project 1's content was not refactored into a freshly-written design doc; it was always *in the chat* as the "Three Hackathon Project Routes" comparison section.
- The content extracted into `design-1`, `design-2`, `design-3` here is from the **latest authoritative answer** in the source chat that compares all three routes (the section that begins "PROJECT 1 — LegentPro: Trustworthy Autonomous Procurement").

**If the user later identifies an even more refined framing** (analogous to how Project 2 had a demo-to-prod / US-business rewrite that superseded the cross-border framing), this extraction would need to be revisited. The current extraction is grounded in the latest visible Project 1 content from the source chat — but does not preclude the existence of an even later refinement that did not surface in the conversation searches.

---

## 7. What to do next

1. **Read these four design files** as the authoritative Project 1 extraction.
2. **Cross-reference against the live codebase** in `DynDisc\DynDiscMiniProject2\` and `DynDisc\NANDA_DynDisc\` for any divergence.
3. **If a more refined Project 1 framing exists** that did not surface in the conversation searches, point me to where (which chat / which file) and I will regenerate the extraction.
4. **Optional:** Read `NEST-3-PART-1.5-MESSAGE-SIGNING.md` and `SUBMISSION-ARTICULATION.md` to get the full security and submission context.

---

**End of design-4-files-on-disk.md**
