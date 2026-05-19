# LegentPro — Research Citations & Source Bibliography

**Purpose.** Pure bibliography for the design decisions and pitch claims in this project.
Organized by section. Each entry: source, year, URL, what it supports.
**Compiled 2026-05-17.** Update before any external pitch by re-verifying each URL is live.

This file is the reference for every external claim used in:
- `AGENTIC-PROCUREMENT-ARCHITECTURE.md` (master design)
- `MAY19-RELEASE.md` (iteration tracker)
- Slide decks and pitch materials
- Grant / funding applications

---

## Section 1 — Automated Negotiation Theory & Opponent Modeling

The foundational research underpinning the perceived-opponent-style design, the
patience-δ + NBS tactics engine, and the multi-issue α-weighted utility function.

### 1.1
**Baarslag, T., Hendrikx, M. J. C., Hindriks, K. V., & Jonker, C. M. (2016).**
*A Survey of Opponent Modeling Techniques in Automated Negotiation.*
AAMAS '16 Proceedings; expanded as JAAMAS 30(5).
https://link.springer.com/article/10.1007/s10458-015-9309-1

**Supports:** the design decision to maintain `selfStyle` (known) and
`perceivedOppStyle` (inferred from observation) as separate beliefs. Direct
quote we use: *"A negotiation between agents is typically an incomplete
information game, where the agents initially do not know their opponent's
preferences or strategy."* This is the foundational reference (30+ years of
follow-up literature, 136 citations as of last check) that validates the
operational/perceived split.

### 1.2
**Faratin, P., Sierra, C., & Jennings, N. R. (1998).**
*Negotiation decision functions for autonomous agents.*
Robotics and Autonomous Systems 24(3-4).

**Supports:** the time-dependent and concession-rate models behind the δ
discount factor and the α-weighted utility function in the iter 10 tactics
engine. Classical reference; the literature builds on this.

### 1.3
**Rubinstein, A. (1982).**
*Perfect Equilibrium in a Bargaining Model.*
Econometrica 50(1): 97–109.

**Supports:** the asymmetric NBS computation using each party's δ. The
"Rubinstein outcome" referenced in the seller's tactics module is the
subgame-perfect equilibrium from this paper.

### 1.4
**Nash, J. F. (1950).**
*The Bargaining Problem.*
Econometrica 18(2): 155–162.

**Supports:** the NBS midpoint computation used as the "fair" reference point
in the seller LLM's prompt context. The symmetric NBS formula
`(B_max + S_min) / 2` traces here.

### 1.5
**Thomas, K. W., & Kilmann, R. H. (1974).**
*Thomas-Kilmann Conflict Mode Instrument (TKI).*

**Supports:** the five-style negotiation framework (AGGRESSIVE, ASSERTIVE,
BALANCED, COOPERATIVE, WIN_WIN_SEEKING). TKI is the dominant pedagogical
framework for negotiation styles; we use it because it maps cleanly to the
assertiveness × cooperativeness axes that our α-weights operationalize.

---

## Section 2 — LLM Negotiation Capabilities & Limitations

Evidence that LLMs without scaffolding fail at negotiation. Used to justify
the math-derived counter-band override in iter 10 (LLM proposes within band;
math wins if it goes outside).

### 2.1
**Xia, T., He, Z., Ren, T., Miao, Y., Zhang, Z., Yang, Y., & Wang, R. (2024).**
*Measuring Bargaining Abilities of LLMs: A Benchmark and A Buyer-Enhancement
Method.* Findings of ACL 2024.
https://aclanthology.org/2024.findings-acl.213/

**Supports:** the most-cited claim in our pitch — *"all LLMs tested had
negative profit on the bargaining benchmark."* GPT-4 was strongest but still
negative. This is empirical evidence that pure-LLM negotiators leak money
without external constraint enforcement. It's the case for our iter 4
constraint-budget + iter 10 math-band-override architecture.

### 2.2
**Abdelnabi, S., et al. (2024).**
*Cooperation, Competition, and Maliciousness: LLM-Stakeholders Interactive
Negotiation.*
ICLR 2024 / NeurIPS 2024.

**Supports:** the Scoreable Games benchmark for multi-issue, multi-party
negotiation. Cited in subsequent benchmarks (AGORABENCH, BARGAINARENA).

### 2.3
**HAMBA / BARGAINARENA paper (2025).**
*LLM Agents for Bargaining with Utility-based Feedback.*
https://arxiv.org/pdf/2505.22998

**Supports:** the gap between simplified academic benchmarks and real-market
features. Direct quote: *"persistent shortcomings regarding immature Theory
of Mind (ToM), constrained strategic adaptability, and often shallow
reasoning… datasets largely ignore common market mechanisms such as
installment plans, monopolistic structures, or negative seller perception
sentiment."* This justifies our multi-issue + sub-agent-grounded design.

### 2.4
**MERIT paper (2026).**
*MERIT Feedback Elicits Better Bargaining in LLM Negotiators.*
https://arxiv.org/html/2602.10467v4

**Supports:** the case for utility-based feedback (i.e. α-weighted utility
over price, term, date, qty) in LLM negotiators. Confirms LLM-only fails;
external utility scaffolding helps.

### 2.5
**Davidson, T., et al. (2024).**
*Dynamic Benchmark for LLM Negotiation.*

**Supports:** dynamic, scaling-complexity benchmarks. Cited in our iter 13
A/B testing design.

---

## Section 3 — Theory of Mind in LLMs

Evidence that LLM ToM is shallow and doesn't adapt to new partners. Used to
justify our explicit `perceivedOppStyle` belief-tracking — we make ToM
mechanical and inspectable rather than implicit in the LLM.

### 3.1
**ICML 2025 Position Paper.**
*Theory of Mind Benchmarks are Broken for Large Language Models.*
https://openreview.net/forum?id=BCP8UU2BcU

**Supports:** the distinction between *literal* ToM (predicting behavior on
fixed tasks) and *functional* ToM (adapting to evolving partners). Direct
quote: *"the majority of theory of mind benchmarks are broken because of
their inability to directly test how large language models adapt to new
partners."* Our `perceivedOppStyle` + iter-13 perception-accuracy metric is a
functional-ToM benchmark in disguise — exactly the gap this paper identifies.

### 3.2
**Kosinski, M. (2024).**
*Evaluating large language models in theory of mind tasks.*

**Supports:** the (disputed) claim that GPT-4 exhibits emergent ToM. We cite
the dispute, not the claim — the dispute is what motivates our explicit
belief-tracking design.

### 3.3
**Strachan, J. W. A., et al. (2024).**
*LLMs achieve adult human performance on higher-order theory of mind tasks.*
PMC.
https://pmc.ncbi.nlm.nih.gov/articles/PMC12808479/

**Supports:** the *risk* side of LLM ToM — that high-ToM agents can
manipulate. Quote: *"reinforcement learning agents with higher-orders [of
ToM] outcompete their opponents or have a competitive advantage in
negotiations."* This is part of why we want explicit, inspectable
opponent-modeling rather than implicit LLM reasoning.

### 3.4
**Sotopia / TOMA papers (2024–2025).**
*Infusing Theory of Mind into Socially Intelligent LLM Agents.*
https://arxiv.org/pdf/2509.22887

**Supports:** the neuro-symbolic approach to combining LLMs with symbolic
belief tracking. Validates our architectural pattern of LLM-proposes /
math-decides.

---

## Section 4 — Agentic Commerce Market Size & Funding

The market context the project sits in. Used in the pitch deck's market-size
slide and the competitive-landscape section.

### 4.1
**Tracxn (2026).**
*Agentic AI — 2026 Market & Investments Trends.*
https://tracxn.com/d/sectors/agentic-ai/

**Supports:** the headline funding numbers. Specific facts: $24.2B total
funding over 10 years; $6.42B in 2025 alone (largest year ever); 2026 YTD
$2.66B across 44 rounds (142.6% rise vs same period 2025). US has $17.7B of
$22.1B total; 530 US agentic AI companies, 177 India, 66 UK. Stanford > Harvard
> MIT alumni founders by funding raised.

### 4.2
**AgentMarketCap (April 2026).**
*The Agentic Funding Shift: $6.42B in 2025, Fewer But Bigger Bets in 2026.*
https://agentmarketcap.ai/blog/2026/04/08/agentic-ai-funding-velocity-2026-sector-map-vertical-distribution

**Supports:** the concentration thesis. Direct quotes: *"144% more capital
across 39% fewer transactions… Average round size for the 15 agentic AI
startups that closed rounds in Q4 2025 or early 2026 reached $155 million,
nearly double the $82 million average from H1 2025."* Also: customer service
+ sales captured 37% of all agentic AI funding 2022–2025 (largest category).

### 4.3
**New Market Pitch / Agentic AI Startup Funding 2025–2026.**
https://newmarketpitch.com/blogs/news/agentic-ai-funding-analysis

**Supports:** the vertical-depth thesis. Vertical AI Agents = 54.8% of deals
and 57.2% of capital. *"Vertical depth is not a niche variant of agentic AI
but its default commercialization path."* Used in the pitch to justify the
US-SMB-exporter vertical focus.

### 4.4
**VCCafe (January 2026).**
*2026 AI Predictions: The Year of the "Agent Employee."*
https://www.vccafe.com/2026/01/08/2026-ai-predictions-the-year-of-the-agent-employee/

**Supports:** macro market context. Specific: global AI funding nearly
doubled to $225.8B in 2025, capturing 48% of all venture investment.
Up from 34% in 2024.

### 4.5
**McKinsey (October 2025).**
*The agentic commerce opportunity: How AI agents are ushering in a new era
for consumers and merchants.*
https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-agentic-commerce-opportunity-how-ai-agents-are-ushering-in-a-new-era-for-consumers-and-merchants

**Supports:** the $3–5T global opportunity estimate by 2030. Used cautiously
since it's consultancy-projected, not measured.

---

## Section 5 — Agentic Commerce Governance & Accountability Gap

The "no validated model exists" story that motivates the entire audit /
identity / constraint-budget stack.

### 5.1
**Liberis Consulting (December 2025).**
*Autonomous Procurement and the Question of Oversight.*
https://liberisconsulting.com/autonomous-procurement-and-the-question-of-oversight/

**Supports:** the killer pitch line. Direct quote: *"there is no validated
model today for governing procurement autonomy at scale."* Also: *"approvals,
audit trails, explainability — those controls were designed for systems where
humans initiate and complete discrete steps. They are less effective in
environments where intent triggers chains of autonomous action that persist
and adapt over time."*

### 5.2
**IBM Think (February 2026).**
*The Accountability Gap in Autonomous AI.*
https://www.ibm.com/think/insights/accountability-gap-autonomous-ai

**Supports:** the identity-delegation story. Direct quote: *"Most enterprises
still govern access by using identity models designed in the past two
decades — models built for human operators, not machines. As a result,
organizations are at risk of deploying autonomous agents without the ability
to confidently answer basic questions of accountability."* And the specific
flaw: *"many agents reuse user tokens instead of receiving delegated
authority… this method erases audit separation and shifts liability onto
individuals who never authorized the action."* This is exactly what our
vLEI / KERI delegated identity (iter 9 / 14) addresses.

### 5.3
**Center for Data Innovation (March 2026).**
*Agentic Commerce is Coming, but Regulation Meant for Humans Will Slow It Down.*
https://datainnovation.org/2026/03/agentic-commerce-is-coming-but-regulation-meant-for-humans-will-slow-it-down/

**Supports:** the regulatory-uncertainty pitch. Specific gaps cited: SOX §302
("it is unclear whether an AI agent's operating parameters would satisfy
that requirement"), Regulation E (consumer dispute rights), CFPB August 2025
ANPR on agent representation, SEC has offered little guidance on AI
procurement compliance. These are the gaps our audit format positions for.

### 5.4
**Jones Walker LLP (February 2026).**
*NIST's AI Agent Standards Initiative: Why Autonomous AI Just Became
Washington's Problem.*
https://www.joneswalker.com/en/insights/blogs/ai-law-blog/nists-ai-agent-standards-initiative-why-autonomous-ai-just-became-washingtons.html

**Supports:** NIST regulatory trajectory. Specific quote: *"NIST's AI Risk
Management Framework, released in January 2023, was explicitly voluntary.
Within 18 months, it appeared in executive orders, state AI laws, and
federal procurement requirements."* The implication: be early to defensible
audit format = be aligned with future regulation.

### 5.5
**a16z / Big Ideas 2026 (December 2025).**
*Big Ideas 2026: Part 1 — From "System of Record" to "System of Intelligence."*
https://a16z.com/newsletter/big-ideas-2026-part-1/

**Supports:** the system-of-record-loses-primacy thesis from Sarah Wang.
*"In 2026, the real disruption in enterprise software is that the system of
record will finally start to lose primacy."*

---

## Section 6 — Agentic Commerce Protocols (ACP, AP2, x402, vLEI, TAP)

The infrastructure layer the project must compose with.

### 6.1
**OpenAI + Stripe — Agentic Commerce Protocol (ACP).**
Spec: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
Announcement: https://openai.com/index/buy-it-in-chatgpt/
Stripe blog: https://stripe.com/blog/developing-an-open-standard-for-agentic-commerce

**Supports:** the ACP composition strategy (iter 18). Apache 2.0 licensed.
Spec versions: 2025-09-29 (initial), 2025-12-12 (fulfillment), 2026-01-16
(capability negotiation), 2026-01-30 (extensions, discount), 2026-04-17
(latest stable). Live in ChatGPT Instant Checkout (later retired March 2026
but protocol continues). Stripe Agentic Commerce Suite shipped Dec 11, 2025.
PayPal joined as payment provider October 28, 2025. **Critical fact:** ACP
*does not* handle agent identity attestation (that's AP2/TAP) or stablecoin
settlement (x402) — meaning our vLEI/KERI stack composes with ACP without
overlap.

### 6.2
**Google — Agent Payments Protocol (AP2).**
https://www.griddynamics.com/blog/agentic-payments

**Supports:** the cryptographic-mandate composition story. AP2 sits one step
earlier than ACP and provides the *authorization* signature. Our vLEI/KERI
delegation chain is mechanically similar but uses a more rigorous identity
standard. AP2 supports debit/credit/stablecoin/real-time payment types.

### 6.3
**Coinbase — x402 (now Linux Foundation).**
https://eco.com/support/en/articles/14845478-acp-agentic-commerce-protocol-explained

**Supports:** the M2M stablecoin settlement layer. Specific facts as of
April 2026: 69,000 active agents, 165 million transactions, ~$50 million in
cumulative volume. Uses HTTP 402 Payment Required + USDC for sub-cent
payments between agents and APIs. Donated to Linux Foundation as x402
Foundation.

### 6.4
**Visa — Trusted Agent Protocol (TAP).**
Launched October 14, 2025.

**Supports:** agent identity in HTTP headers from the card-network side.
Composes with ACP/AP2 — not a competitor to our identity stack but a
different layer of the same problem.

### 6.5
**Opascope (April 2026).**
*AI Shopping Assistant Guide 2026: Agentic Commerce Protocols.*
https://opascope.com/insights/ai-shopping-assistant-guide-2026-agentic-commerce-protocols/

**Supports:** the protocol-comparison summary used in pitch decks. Key fact:
OpenAI charges merchants a 4% transaction fee on every completed Instant
Checkout purchase, in addition to Stripe's standard payment processing fees
(~2.9% + $0.30). For a $100 order, total fees ≈ $7.20.

### 6.6
**ETSI / GLEIF — vLEI (Verifiable Legal Entity Identifier).**
ETSI TR 119 470 (Legal person identity in eIDAS).
https://www.gleif.org/en/vlei/introducing-the-verifiable-lei-vlei

**Supports:** the cryptographic identity moat (iter 9 / 14). vLEI is
GLEIF-issued, KERI-signed, ETSI/eIDAS-aligned. We're the only architecture in
this analysis that uses vLEI for agent identity. Differentiator vs. ACP's
basic auth.

---

## Section 7 — Direct Competitive Landscape (Procurement-Negotiation AI)

The funded comps. All serve the buyer side; our wedge is the supplier side.

### 7.1
**Arkestro** (San Francisco)
Crunchbase: https://www.crunchbase.com/organization/bid-ops
$36M strategic investment May 2025, Aramco Ventures + Altira Group leading.
https://arkestro.com/press-releases/arkestro-secures-36m-in-strategic-investment-to-accelerate-predictive-procurement-innovation/

**Customers (verified, named publicly):** Chevron, Nissan Americas, JLL,
Valvoline, Trinity Industries. **Claims:** 18.8% avg cost savings per $1M
spend; $410B spend processed; 400,000+ items quoted; 1,000+ pre-built API
integrations with ERPs; Capgemini partnership; Gartner 2024 Hype Cycle
sample vendor for Autonomous Sourcing. **Patented "three sciences":**
Negotiation Science, Supplier Science, Process Science.

### 7.2
**Pactum**
https://procurementmag.com/news/pactum-transforms-procurement-with-its-agentic-ai-platform

**Customers (publicly named):** AstraZeneca (Coupa Inspire 2026 stage),
Global 2000 / F500. **Claims:** 500% increase in negotiation volume; "leading
AI procurement negotiation tool." Founded 2019. Category: autonomous
tail-spend negotiator.

### 7.3
**Lio** (US + Tel Aviv)
$30M Series A from a16z March 2026 (total $33M).
https://ventureburn.com/lio-raises-30m-to-automate-enterprise-procurement-with-ai-agents/

**Customers (publicly named):** Munich Re, Brose, Novozymes. **Claims:** 95%
adoption rates; manual work reduced 85%; additional 10% savings via
real-time sourcing/negotiation. Verticals: chemicals, automotive, pharma,
retail, transport, postal.

### 7.4
**Oro Labs**
$100M Series C, Brighton Park Capital + Goldman Sachs Growth Equity leading,
March 2026. https://news.crunchbase.com/venture/biggest-funding-rounds-ai-robotics-ecommerce-quince/

**Claims:** 300% revenue growth in prior year. Enterprise procurement
platform.

### 7.5
**Whispor — comparative summary (April 2026).**
*The best AI negotiation platforms for procurement in 2026.*
https://www.whispor.com/best-ai-negotiation-platforms.html

**Supports:** the 9-vendor competitive landscape. Other vendors named:
Zycus Merlin ANA, nnamu/Beroe, Globality, LightSource, Keelvar, DeepStream.
Whispor's own positioning: "two-product intelligence layer — strategic
coaching plus autonomous tail on one platform."

### 7.6 (Adjacent — SMB Finance AI, not direct competitors)
**Lunos AI** — B2B accounts receivable agent for SMBs (Monitor / Suggest /
Act autonomy modes). https://www.lunos.ai/blog/ai-agents-for-finance-teams

**Taktile** — SMB credit underwriting AI for *lenders* (not SMBs themselves).
https://taktile.com/articles/introducing-taktile-smb-ai-agents

**LayerNext** — AI-CFO platform for SMBs. https://www.layernext.ai/

**Intuit Assist** for QuickBooks — embedded GenAI assistant.

**Supports:** the adjacent-market reference. None of these address
negotiation; they handle AR/collections/bookkeeping *after* the deal closes.
This is the SMB-side gap our wedge fills.

---

## Section 8 — US SMB Exporter Statistics

The TAM and pain-point evidence for the wedge.

### 8.1
**SBA Office of Advocacy (November 2024).**
*2024 Small Business Profile.*
https://advocacy.sba.gov/wp-content/uploads/2024/11/United_States.pdf

**Supports:** the verified exporter counts. *"States in 2022. Of those
exporters, 271,391 — or 97.2 percent — were small. Exports by small firms
reached $648.5 billion, making up 35.7 percent of exports by identified
firms."*

### 8.2
**SBA Press Release (March 14, 2023).**
*SBA Research Sheds New Light on Small Business Exporters.*
https://www.sba.gov/article/2023/mar/14/sba-research-sheds-new-light-small-business-exporters

**Supports:** the revised TAM figure used in the pitch. *"New data places the
number of exporting small businesses at 1.3 million — an almost fivefold
increase over previous federal estimates… total addressable market at over
2.6 million small businesses, representing 42 percent of all small employer
businesses."* Includes services + indirect exports the Census misses.

### 8.3
**SBA Office of Advocacy Issue Brief No. 19 (March 2024).**
*US Small Business Exports.*
https://advocacy.sba.gov/wp-content/uploads/2024/03/Issue-Brief-No.-19-Small-Business-Exports.pdf

**Supports:** the small-business export geography. Mexico (18.4%), Canada
(13.3%), China (8.3%) are top destinations. OECD (62.3%) and APEC (60.7%)
are top regions. Note: small businesses comprise 91.2% of transportation
service exports and 67.5% of non-durable goods wholesale exports.

### 8.4
**US Chamber of Commerce (2025).**
*The State of Small Business in America.*
https://www.uschamber.com/small-business/state-of-small-business-now

**Supports:** baseline economic facts. *"Small businesses represent 97.3% of
all exporters and 32.6% of known export value ($413.3 billion), employ 46%
of America's private sector workforce, and represent 43.5% of GDP."*

### 8.5
**SBA / Linda McMahon UN Speech (Jan 2025).**
*Only 1 Percent of America's Small Businesses Export Overseas.*
https://www.inc.com/associated-press/linda-mcmahon-small-business-administration-exports-only-1-percent-small-business.html

**Supports:** the trade-finance pain point. Direct quotes from SBA
Administrator: *"Globally over half of all declined trade finance requests
to banks were submitted by small businesses. In the United States, over
one-third of all of our small businesses find trade finance hard to obtain
for foreign sales."*

---

## Section 9 — Trade Finance, Credit Insurance, Cross-Border Payment Data

The specific quantified pain points the credit sub-agent addresses.

### 9.1
**EXIM Bank (2016, still current).**
*5 Reasons US Exporters Underutilize Trade Credit Insurance.*
https://grow.exim.gov/blog/5-reasons-us-exporters-underutilize-trade-credit-insurance

**Supports:** the credit-insurance gap. Direct quotes: *"Up to 80 percent of
global trade is supported by some sort of trade finance or credit insurance
covering transactions on open account terms. About half of European
exporters routinely use trade credit insurance to cover transactions but
only 10 percent of US exporters do."* Also: *"the World Trade Organization
reports that foreign companies offered open account terms will buy on
average 40 percent more!"*

### 9.2
**International Trade Administration / trade.gov.**
*Company and Partner Risk.*
https://www.trade.gov/company-and-partner-risk

**Supports:** the US government's own framing of the SMB exporter risk
problem. Includes Multi-Buyer Export Credit Insurance Policy details
(<$7.5M average export credit sales; free credit report on each foreign
buyer included).

### 9.3
**International Chamber of Commerce (cited via Credlix).**
*Top Export Finance Challenges and How to Overcome Them.*
https://www.credlix.com/blogs/top-export-finance-challenges-and-how-to-overcome-them

**Supports:** the rising non-payment rate. *"As per the International
Chamber of Commerce, the rate of non-payment has jumped from 3.8% in 2020 to
an estimated 4.5% in 2024."* Also: *"A 2024 World Bank survey found 45% of
exporters view cultural/language differences as a major challenge."*

### 9.4
**Federal Reserve Small Business Credit Survey (December 2024).**
*2024 Report on Payments: Findings from the 2023 Small Business Credit
Survey.* https://www.fedsmallbusiness.org/reports/survey/2024/2024-report-on-payments

**Supports:** the late-payment cash-flow pain. *"Roughly four of every five
small firms face challenges related to payments. The difficulties firms
encounter tend to differ based on their payment terms and arrangements."*

### 9.5
**Federal Reserve Small Business Credit Survey (March 2025).**
*2025 Report on Employer Firms: Findings from the 2024 Small Business
Credit Survey.*
https://www.fedsmallbusiness.org/reports/survey/2025/2025-report-on-employer-firms

**Supports:** the 2024 survey universe. 7,653 small employer firms surveyed
across all 50 states. Note: about 1 in 3 businesses sells mostly to other
businesses; among firms reporting customer types accounting for 10%+ of
sales, "other businesses" was second (45%), behind individuals (67%).

### 9.6
**Intuit QuickBooks (2025).**
*US Small Business Late Payments Report 2025.*
https://quickbooks.intuit.com/r/small-business-data/small-business-late-payments-report-2025

**Supports:** the unpaid-invoice cost statistic. *"Over half (56%) of small
businesses surveyed reported being owed money from unpaid invoices,
averaging $17.5K per business. 47% of businesses reported a portion of their
invoices were overdue by more than 30 days, with nearly 1 in 10 invoices
falling into this category on average. 50% reported issues with cash flow
— making them more than 1.4x more likely to encounter this obstacle than
those with fewer late payments."*

### 9.7
**Bank for International Settlements (cited via PaymentsJournal).**
https://www.paymentsjournal.com/solving-for-fraud-in-cross-border-payments-requires-better-counterparty-verification/

**Supports:** the cross-border TAM. *"Cross-border payment volumes are
projected to reach $250 trillion by 2027, in part due to this increased
participation."*

### 9.8
**Trustpair (May 2025).**
*B2B Cross-Border Payments: Streamline Your Global Transactions.*
https://trustpair.com/blog/b2b-cross-border-payments/

**Supports:** the cross-border fraud concrete example. *"A Singaporean firm
experienced when they were tricked into sending $42.3 million to a fake
supplier in Timor Leste. It was discovered four days later, when the real
supplier asked about their payment."*

### 9.9
**EastNets / Fraudio / Veriff (2024–2026).**
Multiple sources on cross-border fraud trends.
- https://www.eastnets.com/blog/the-increasing-complexities-of-cross-border-payment-fraud-in-e-mea-and-how-banks-can-strengthen-their-defenses
- https://www.fraudio.com/blog/cross-border-payment-fraud
- https://www.veriff.com/fraud/cross-border-fraud

**Supports:** the synthetic-identity threat. *"More than half of businesses
in E&MEA identify synthetic identity proliferation as a leading challenge in
customer verification. Generative AI exacerbates the threat, generating
strikingly realistic documents, photographs, and even deepfake videos."*

---

## Section 10 — Open Data Sources Used by the System

The actual API endpoints behind the credit / logistics / inventory
sub-agents. Every one is documented here so future engineers know where the
authoritative spec lives.

### 10.1 — Identity & Entity Status

**GLEIF API.**
https://api.gleif.org/api/v1/lei-records/{LEI}
- Free, no auth required.
- Returns entity status (active / lapsed / retired), registration date,
  jurisdiction, related entity hierarchy.
- Already used in iter 1 of LegentPro.

**GLEIF vLEI documentation.**
https://www.gleif.org/en/vlei/introducing-the-verifiable-lei-vlei
- The KERI-based verifiable credential standard for legal entity identity.
- Composes with W3C Verifiable Credentials.

### 10.2 — Public Financials (Credit Sub-Agent)

**SEC EDGAR Company Facts API.**
https://data.sec.gov/api/xbrl/companyfacts/CIK{padded_cik}.json
- Free, no auth. Requires User-Agent header with email per SEC fair-use.
- XBRL-tagged financial facts for every SEC-filing US public company.
- Used for US-domiciled counterparty credit signals.

**OpenCorporates API.**
https://api.opencorporates.com/companies/{jurisdiction}/{company_number}
- Free tier: 200 requests/month with API key, 50/day without.
- Officer history, incorporation date, status, related entities.
- Used for cross-jurisdiction counterparty verification.

**Companies House API (UK).**
https://api.company-information.service.gov.uk/company/{number}
- Free with API key (HTTP Basic auth).
- UK company filings, accounts, officers.
- Used for UK counterparty verification.

**World Bank Open Data API.**
https://api.worldbank.org/v2/country/{ISO}/indicator/{indicator}?format=json
- Free, no auth.
- Country-level indicators (governance, political stability, GDP).
- Used for country-risk band lookup in composite credit assessment.

### 10.3 — Logistics

**DCSA Track & Trace 2.2 Standard.**
https://dcsa.org/standards/track-trace/
- Open spec for container shipping events, ETAs, transport plans.

**Maersk DCSA T&T 2.2 implementation.**
https://api.maersk.com/track/v1/events?carrierBookingReference={ref}
- API key, free dev sandbox.

**ShipEngine.**
https://api.shipengine.com/v1/rates
- API key, free sandbox.

**17track API.**
https://api.17track.net/track/v2.2/gettrackinfo
- API key, 1,000 req/month free tier.

### 10.4 — Inventory / ERP

**ERPNext / Frappe REST API.**
https://frappeframework.com/docs/user/en/api/rest
- Self-host, open-source, free.
- Used for stock-on-hand, allocated, projected-qty queries.

**Odoo External API (JSON-RPC).**
https://www.odoo.com/documentation/master/developer/reference/external_api.html
- Self-host Community edition free.

### 10.5 — Standards Referenced (Not Hosted Endpoints)

- **UN/LOCODE.** Port codes for logistics.
- **GS1 DESADV (EDIFACT D.96A).** Despatch advice message format.
- **ACTUS Standard.** https://www.actusfrf.org/ — financial contract event
  algorithms. Used in our internal `shared/actus-client.ts` for cashflow PD
  simulation.

---

## Section 11 — VC Investment Theses & SaaS Disruption

The "why VCs care" framing.

### 11.1
**a16z — In Defense of Vertical Software (George Sivulka, February 2026).**
https://www.a16z.news/p/in-defense-of-vertical-software

**Supports:** the last-mile moat thesis. Direct quotes: *"The value of
enterprise software comes from understanding the process and the
organization well enough to make the software do exactly the right thing…
'Last mile' doesn't mean the final configuration step before a product
go-live, but a recognition that what you're deploying isn't just software
but an embodiment of how a specific team of specific people does their
specific job."* Used to justify the SMB-exporter vertical and the
EXIM-format audit pack.

### 11.2
**a16z — January 2025 SaaS Pricing Report.**
*Andreessen Horowitz declared SaaS golden rule "no longer valid."*

**Supports:** the consumption / outcome pricing model. Cited via:
https://medium.com/@rsaker/ai-is-eating-enterprise-saas-1259d352f193

### 11.3
**a16z Big Ideas 2026 podcast (December 2025).**
*The Agentic Interface.*
https://podcasts.apple.com/us/podcast/big-ideas-2026-the-agentic-interface/

**Supports:** the agent-employee thesis from Sarah Wang, Marc Andrusko,
Stephenie Zhang. Direct paraphrase: *"Interfaces shift from chat to action,
design shifts from human-first to agent-readable, and work shifts to agentic
execution."*

### 11.4
**IDC (December 2025).**
*Is SaaS Dead?*

**Supports:** the prediction that by 2028, 70% of software vendors will
refactor pricing away from pure seat-based.

### 11.5
**a16z Portfolio Tracker (January 2026).**
*A16z's AI Portfolio.*
https://www.feedtheai.com/a16zs-ai-startups-portfolio/

**Supports:** the portfolio composition signal. 40% healthcare, 25% infra,
20% vertical copilots, 15% entertainment/logistics in 2025. The shift from
copilots → autonomous agents.

---

## Section 12 — SMB Adoption & Willingness-to-Pay Data

The pricing validation.

### 12.1
**Salesforce Small & Medium Business Trends Report (cited via US Chamber,
December 2025).**
https://www.uschamber.com/co/good-company/launch-pad/execs-on-ai-solutions

**Supports:** SMB AI adoption signal. *"91% of SMBs with AI say it boosts
their revenue, and 90% say it makes operations more efficient."*

### 12.2
**IdeaSignals (October 2025).**
*Startup Idea: AI Agent for SMB Finance.*
https://ideasignals.substack.com/p/startup-idea-002-ai-agent-for-smb

**Supports:** SMB willingness-to-pay benchmarks. Direct quote: *"SMBs will
pay $99–$299/mo if they trust accuracy."* Competitors at price points:
Pilot $30/mo (bank automation), Docyt $49–$249/mo (end-to-end bookkeeping).

### 12.3
**SME Finance Forum + Biz2Credit (October 2025).**
*Credit Unlocked: Agentic AI's Role in Empowering Small Businesses.*
https://www.smefinanceforum.org/post/credit-unlocked-agentic-ais-role-empowering-small-businesses

**Supports:** the multilateral / SME-banking framing. Cites the
World Bank Group April 2025 handbook, IMF October 2025 AI supervisory
authority report, Citi GPS January 2025 "Do It For Me Economy" report —
all useful for policy / regulator-facing pitches.

---

## Footnotes on citation hygiene

**Verification protocol before any external pitch:**
1. For every citation used in a slide or written pitch, click the URL the
   day before the pitch. URLs decay.
2. For every statistic, confirm the year is current — replace 2023/2024
   statistics with newer if available.
3. For competitor funding rounds, check Crunchbase the morning of the pitch.
   Numbers move.
4. Quote text inside  blocks must be verbatim from the source — if
   paraphrased, drop the quotation marks and present as your own framing.

**What's stretch and what's grounded:**

GROUNDED (defensible in any meeting):
- All Section 1 negotiation theory
- All Section 2/3 LLM limitation citations
- All Section 4 funding numbers
- All Section 8/9 SMB statistics
- All Section 10 API endpoints

STRETCH (defensible as forward-looking, not as present fact):
- McKinsey $3–5T projection (Section 4.5)
- BIS $250T projection (Section 9.7)
- IDC 70% pricing refactor by 2028 (Section 11.4)
- a16z portfolio-composition percentages (Section 11.5) — based on tracker,
  not official a16z disclosure

OFF-LIMITS — DO NOT USE:
- Specific revenue / customer / margin numbers for competitors beyond what
  they have publicly stated.
- Any claim that this project outperforms a specific competitor without
  benchmark evidence.
- Specific percentages of credit-loss reduction or fraud prevention without
  pilot data.

---

*This file is maintained by hand. Last updated: 2026-05-17.*
*Source: chat sessions on LegentPro architecture design, May 2026.*
