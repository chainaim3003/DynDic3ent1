# Gemini API Setup Guide

LegentPro uses Google's Gemini API for the seller and buyer agents' negotiation
decisions. This guide gets you from zero to running negotiation in under 5 min.

## Why Gemini?

- **Strong reasoning** — Gemini 2.5 Pro is well-suited to game-theoretic
  negotiation prompts (action choice, structured JSON output, schema following)
- **Free dev tier** — Flash and Flash-Lite have generous free quotas; Pro is
  paid but cheap for low-volume work
- **Native JSON schema support** — `responseSchema` enforces structured output
  better than older `response_format` tricks
- **Tier flexibility** — Pro for high-stakes decisions, Flash for routing,
  Flash-Lite for cheap dev runs — all from the same SDK

## Step 1 — Get your API key

1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account
3. Click "Create API key"
4. Copy the key (starts with `AIza...`)

## Step 2 — Configure env files

Copy `.env.example` to `.env` in **four locations**:

```
DynDic3ent1/A2A/js/.env                                  (root)
DynDic3ent1/A2A/js/src/agents/seller-agent/.env          (port 8080)
DynDic3ent1/A2A/js/src/agents/buyer-agent/.env           (port 9090)
DynDic3ent1/A2A/js/src/agents/treasury-agent/.env        (port 7070)
```

In each `.env`, replace `your_gemini_api_key_here` with your real key.

## Step 3 — Choose your cost tier

The system supports three pricing levels. The default (Pro for seller/buyer)
gives the best reasoning; you can override globally for dev runs.

### Default — production-grade reasoning

Leave `GEMINI_FORCE_MODEL` blank. The system uses:
- **Seller + Buyer main decisions**: `gemini-2.5-pro` ($1.25/$10 per 1M tokens)
- **Treasury + future routing**: `gemini-2.5-flash` ($0.30/$2.50 per 1M tokens)

### Dev mode — cheap

Set in every `.env`:
```
GEMINI_FORCE_MODEL=gemini-2.5-flash-lite
```
This forces all calls to Flash-Lite ($0.10/$0.40 per 1M tokens). Roughly **10×
cheaper** than Pro, ~30× faster, somewhat less rational. Good for smoke tests
and burning through demo runs without thinking about cost.

### Mid — balanced

Set in every `.env`:
```
GEMINI_FORCE_MODEL=gemini-2.5-flash
```
Flash everywhere — ~4× cheaper than Pro, still strong reasoning.

## Step 4 — Cost ceiling (safety)

`PER_NEGOTIATION_TOKEN_CEILING=20000` in `.env` caps spend per negotiation
at ~$0.10 worst case on Pro. If a single negotiation accumulates more tokens
across all LLM calls, further calls return the rules-based fallback with
`decisionPath: "GEMINI_TOKEN_CEILING_REACHED"` recorded in the audit. This
prevents a runaway negotiation from costing $5 by accident.

Bump it higher if you want longer negotiations; set it lower for hard caps.

## Cost expectations

Rough per-negotiation cost (3 rounds, ~6 LLM calls, ~1K in + 500 out per call):

| Tier | Per negotiation | 100 demo runs |
|---|---|---|
| `gemini-2.5-pro` | ~$0.04 | ~$4 |
| `gemini-2.5-flash` | ~$0.009 | ~$0.90 |
| `gemini-2.5-flash-lite` | ~$0.001 | ~$0.10 |

Numbers are estimates; actual cost depends on prompt size and history length.

## Rate limits (free tier, as of May 2026)

- Pro: 50 requests/day on free tier (essentially dev-only)
- Flash: 1,500 requests/day on free tier
- Flash-Lite: generous free tier

The system handles 429s with exponential backoff up to `GEMINI_MAX_RETRIES`
(default 3). If all retries are exhausted, the call falls back to rules and
the audit records `decisionPath: "GEMINI_RATE_LIMITED_RULES_FALLBACK"`.

Verify your project's actual quota at https://aistudio.google.com (Settings).

## Troubleshooting

**`GEMINI_API_KEY is required`** — Key not set in the `.env` file the agent
reads. Check all 4 `.env` files exist and contain the key.

**`GEMINI_API_KEY format invalid`** — Key doesn't look like `AIza...`. Copy it
again from https://aistudio.google.com/apikey — don't paste with surrounding
quotes.

**`Gemini rate-limited (attempt 1/4), backing off`** — You're over quota. Wait
a minute, or switch to Flash/Flash-Lite via `GEMINI_FORCE_MODEL`.

**`Gemini returned invalid JSON`** — Rare; the parser strips code fences. If
this keeps happening, lower the temperature in `llm-client.ts` (currently 0.7).

**Audit shows `decisionPath: "GEMINI_*_RULES_FALLBACK"`** — Working as
intended. The LLM was unavailable, the rule-based decision ran, the audit
labels it honestly. No silent fallbacks.
