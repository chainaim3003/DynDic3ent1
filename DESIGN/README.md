# DESIGN — Navigation

This folder contains all design artifacts for LegentPro / DynDic3ent1.
Consolidated from the parallel `entAgentProject11\DESIGN\` folder on 2026-05-18.

---

## Folder layout

```
DESIGN/
├── README.md                              ← you are here
├── current/                               ← live, authoritative design
├── historical/                            ← superseded versions, kept for reference
└── revamp-2026-05-18-framework/           ← in-progress redesign (agentic-procurement framework v2)
```

## current/ — the live design

These docs describe the system as it exists on `main` today (post-WEDGE1 M2-γ).
When something is built, this is the doc that describes it.

| File | Purpose |
|---|---|
| `AGENTIC-PROCUREMENT-ARCHITECTURE.md` | Master design v1.2. The authoritative spec. |
| `MAY19-RELEASE.md` | Iteration tracker (what's built, what's next, hour budgets). |
| `RESEARCH-CITATIONS.md` | Bibliography for every claim in the master design. |
| `TEST-PLAN-WEDGE1.md` | Verification gates for each WEDGE1 milestone. |
| `BACKLOG.md` | Post-WEDGE1 work items. |
| `README.md` | Local navigation note (from the original DESIGN folder). |

## historical/ — superseded versions

Earlier design folders, preserved for context. **Do not edit.** These are
snapshots in time, not living documents.

| Folder/File | What it was |
|---|---|
| `DESIGN1-earliest/` | The pre-WEDGE1 first-pass design (4 files: conceptual, detailed, files-on-disk, problem-solution-impact). |
| `DESIGN2-intermediate/` | The second-pass design + research notes (consultation, game theory). |
| `ITER-8-13-superseded.md` | Earlier iteration design draft. Now superseded by the master in `current/`. |
| `TEST-PLAN-WEDGE1-DynDic3ent1-snapshot.md` | A snapshot of the test plan from the DynDic3ent1-side copy (the canonical one is now in `current/`). |

## revamp-2026-05-18-framework/ — in-progress redesign

The next-version design that will eventually supersede `current/`. **Work-in-progress.**

Once locked, this folder's contents will move to `current/` and the previous
`current/` will be archived to `historical/v1.2-may-17-pre-framework-revamp/`.

Theme of the revamp:
- Reposition tiers around **measurable ROI in dollars** (not feature ladder)
- Rename `NEGOTIATION_MODE` → `SELLER_RESPONSE_MODE` (honest scope)
- Rename tiers to function names (`BASIC_SALES_QUOTING_1`, `L1_DELEGATED_ADVISORS`, `L2_EXECUTIVE_REASONER`, etc.)
- Add **delegation accountability** (every decision pinned to a role authority that rolls up to a human; vLEI-ready)
- Add **simulation harness** for measuring framework value across pressure settings and deal mixes
- Clean up the audit JSON to surface per-round LLM call traces (currently only the most recent is exposed)

## Sunsetting entAgentProject11/

The parallel folder `entAgentProject11\DESIGN\` was the prior home of these docs.
After consolidation (2026-05-18) it remains as a backup. Sunset plan:
1. Verify the consolidation by comparing file counts and key contents (done).
2. Leave `entAgentProject11/` untouched for one week.
3. Once the team confirms nothing is missing from the consolidation, rename
   `entAgentProject11/` to `entAgentProject11-DEPRECATED/`.
4. After another week of no-issues, archive or delete.

## Editing rules

- **`current/`** — edit when committing a design change that matches code on `main`.
- **`historical/`** — never edit. Add new subfolders if archiving more.
- **`revamp-*/`** — edit freely while work-in-progress; promote to `current/` when locked.
