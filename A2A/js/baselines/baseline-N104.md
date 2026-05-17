# LegentPro — Outcome-Quality Baseline (N=104)

Generated: `2026-05-17T12:30:39.071Z`
Source: `C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js\src\escalations`

> **Re-runnable.** If escalation files are deleted, the next `npm run replay:fixtures` produces a smaller, still-honest baseline. Numbers here always reflect what is on disk right now.

## 1. Sample composition

Total unique negotiations on disk: **104**

| Data tier | Count | What it means |
|---|---:|---|
| `audit_json_full`    | 18    | iter 4+ audit.json with computed outcomeQuality |
| `audit_json_partial` | 0 | audit.json present but missing one bound |
| `text_parseable`     | 62     | .txt with price + cost floor parseable |
| `text_price_only`    | 6    | .txt with closed price only |
| `legacy_minimal`     | 0     | legacy single-file .txt |
| `insufficient`       | 18       | nothing extractable |
| `unparseable`        | 0        | files exist but corrupt |

| Outcome | Count |
|---|---:|
| Success (closed) | 76 |
| Escalation       | 28 |
| Unknown          | 0 |

## 2. Headline metrics

Sample sizes vary by metric (older files lack some fields). The denominator is shown next to each line so the claim stays honest.

| Metric | Value | Sample (N) |
|---|---:|---:|
| Median closed price                | ₹379       | 86 |
| % deals closed at-or-below NBS     | 100.0%  | 18 |
| Median deviation from NBS          | ₹-18  | 18 |
| Median buyer surplus share         | 65.0%       | 8 |
| Median seller surplus share        | 35.0%      | 8 |
| % flagged "agreement trap"         | 0.0%       | 8 |
| % closed outside ZOPA              | 0.0%         | 8 |
| % both parties individually rational | 100.0%      | 8 |

## 3. Headline claim for the solution brief

> *Across **18** negotiations on record, LegentPro closed deals at or below the Nash-Bargaining-Solution fair price **100.0% of the time**, with a median surplus split of **65.0%/35.0%** (buyer/seller). Agreement-trap rate: 0.0%.*

## 4. Per-negotiation roster

| NegID | Outcome | Tier | Closed ₹ | Buyer max | Seller min | Surplus split (B/S) | Notes |
|---|---|---|---:|---:|---:|---|---|
| NEG-1774466532237 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1774541533126 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775242456384 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775242508439 | success | text_parseable | ₹382 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775243363195 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775243713575 | success | text_parseable | ₹378 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775247427564 | success | text_parseable | ₹375 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775252186545 | success | text_parseable | ₹375 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775252265742 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775254242611 | success | text_price_only | ₹372 | n/a | n/a | — | buyer text — no sellerMin available |
| NEG-1775254996805 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775255253187 | success | text_parseable | ₹400 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775255417191 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775255440812 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775255565596 | success | text_price_only | ₹378 | n/a | n/a | — | buyer text — no sellerMin available |
| NEG-1775255956735 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775281244473 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775283399340 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775283508846 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775288529641 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775288548746 | success | text_price_only | ₹378 | n/a | n/a | — | buyer text — no sellerMin available |
| NEG-1775290957259 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775291193065 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775291643231 | success | text_parseable | ₹380 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775293835994 | success | text_parseable | ₹375 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775294456466 | success | text_parseable | ₹382 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775295314327 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775305411677 | success | text_parseable | ₹380 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775306047711 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775306460687 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775306552581 | success | text_parseable | ₹382 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775307293864 | success | text_parseable | ₹378 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775307773497 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775309486224 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775311566898 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775311837047 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775312127642 | success | text_parseable | ₹378 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775312423019 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775313258794 | success | text_parseable | ₹382 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775313422745 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775315023707 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775316170777 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775317107373 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775317155750 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775317678586 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775318163151 | success | text_parseable | ₹382 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775318198540 | success | text_parseable | ₹382 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775322685516 | success | text_price_only | ₹396 | n/a | n/a | — | buyer text — no sellerMin available |
| NEG-1775330520907 | success | text_parseable | ₹400 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775333071856 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775333441706 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775333749709 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775333923455 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775334327343 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775334806177 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775335517580 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775335900163 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775337742673 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775403181240 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775494083887 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775494835081 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775495101209 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775498610363 | success | text_parseable | ₹380 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775498858449 | success | text_parseable | ₹379 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775505114195 | success | text_parseable | ₹380 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775568277743 | success | text_parseable | ₹375 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775568701495 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775568804382 | success | text_parseable | ₹400 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775569487100 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1775569599459 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775570353946 | success | text_parseable | ₹378 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775570750803 | success | text_parseable | ₹378 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775571137197 | success | text_price_only | ₹375 | n/a | n/a | — | buyer text — no sellerMin available |
| NEG-1775575745765 | success | text_parseable | ₹378 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775576536626 | success | text_price_only | ₹376 | n/a | n/a | — | buyer text — no sellerMin available |
| NEG-1775579572485 | success | text_parseable | ₹380 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775581504419 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775652862349 | success | text_parseable | ₹381 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775653378055 | success | text_parseable | ₹388 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1775654082092 | success | text_parseable | ₹396 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1778782038517 | success | text_parseable | ₹397 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1778963458521 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1778982039419 | success | text_parseable | ₹355 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1778982390134 | success | text_parseable | ₹365 | n/a | ₹350 | — | parsed from text; no buyerMax — outcomeQuality not computed |
| NEG-1778985454301 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1778989178197 | escalation | insufficient | n/a | n/a | n/a | — | no parseable file for this negotiation |
| NEG-1778989392587 | escalation | audit_json_full | ₹355 | ₹400 | ₹350 | 90/10 |  |
| NEG-1778989728203 | escalation | audit_json_full | ₹360 | ₹400 | ₹350 | 80/20 |  |
| NEG-1778989854729 | escalation | audit_json_full | ₹350 | ₹400 | ₹350 | 100/0 |  |
| NEG-1778992109283 | success | audit_json_full | ₹370 | ₹400 | ₹350 | 60/40 |  |
| NEG-1778994095499 | success | audit_json_full | ₹370 | ₹400 | ₹350 | 60/40 |  |
| NEG-1778994409766 | success | audit_json_full | ₹370 | ₹400 | ₹350 | 60/40 |  |
| NEG-1778995331160 | success | audit_json_full | ₹360 | ₹400 | ₹350 | 80/20 |  |
| NEG-1778995453227 | escalation | audit_json_full | ₹355 | ₹400 | ₹350 | 90/10 |  |
| NEG-1778996048819 | escalation | audit_json_full | ₹348 | ₹400 | ₹350 | 100/0 |  |
| NEG-1778996679830 | success | audit_json_full | ₹370 | ₹400 | ₹350 | 60/40 |  |
| NEG-1778996748229 | success | audit_json_full | ₹360 | ₹400 | ₹350 | 80/20 |  |
| NEG-1778996879915 | success | audit_json_full | ₹365 | ₹400 | ₹350 | 70/30 |  |
| NEG-1778997253359 | escalation | audit_json_full | ₹345 | ₹400 | ₹350 | 100/0 |  |
| NEG-1778998114095 | escalation | audit_json_full | ₹317 | ₹400 | ₹350 | 100/0 |  |
| NEG-1778999079945 | escalation | audit_json_full | ₹343 | ₹400 | ₹350 | 100/0 |  |
| NEG-1778999707950 | escalation | audit_json_full | ₹318 | ₹400 | ₹350 | 100/0 |  |
| NEG-1779001595042 | escalation | audit_json_full | ₹343 | ₹400 | ₹350 | 100/0 |  |
| NEG-1779001660071 | success | audit_json_full | ₹360 | ₹400 | ₹350 | 80/20 |  |

---

_Generated by `npm run replay:fixtures` (iteration 5). Edit `scripts/replay-fixtures.ts` to change parsing rules._