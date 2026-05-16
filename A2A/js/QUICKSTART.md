# A2A Agentic Negotiation - Quick Start

## ✅ Prerequisites Check

Before you start, make sure you have:
- Node.js v18+
- `npm` (comes with Node.js)
- A **Gemini API key** (free dev tier) from https://aistudio.google.com/apikey
- `node_modules` installed (`npm install` from `A2A/js/`)

See `GEMINI_SETUP.md` for model tiers, cost control, and the `GEMINI_FORCE_MODEL` dev override.

> Note: `package.json` carries a `packageManager: pnpm` field from earlier
> setup. npm prints a warning when it sees it but installs normally. The
> field can be removed once the team standardizes on npm.

## 🚀 Running the System

You need **4 separate terminal windows** (3 agents + 1 CLI). Open them all in:
```
C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js
```

### Terminal 1: Treasury Agent (Port 7070) — start FIRST

The seller calls the treasury on every round, so Treasury must be up before the Seller receives an OFFER.

```bash
npm run agents:treasury
```

Wait for:
```
🏦  Jupiter Treasury Agent  →  http://localhost:7070
    Available Liquidity: ₹11,00,000
    Safety Threshold   : ₹3,00,000
    REST endpoint      : POST http://localhost:7070/consult
```

### Terminal 2: Seller Agent (Port 8080) — start SECOND

```bash
npm run agents:seller
```

Wait for:
```
✅ Initializing Gemini with API key: AIza...  pro=gemini-2.5-pro  flash=gemini-2.5-flash
🏪  Seller Agent  →  http://localhost:8080
💰 Margin Price: ₹350/unit (PROTECTED)
```

### Terminal 3: Buyer Agent (Port 9090) — start THIRD

```bash
npm run agents:buyer
```

Wait for:
```
✅ Initializing Gemini with API key: AIza...  pro=gemini-2.5-pro  flash=gemini-2.5-flash
🛒  Buyer Agent  →  http://localhost:9090
💰 Max Budget: ₹400/unit
```

### Terminal 4: CLI to Start Negotiation

```bash
npx tsx src/cli.ts http://localhost:9090
```

When CLI loads, type:
```
start negotiation
```
or to seed an opening price:
```
start negotiation 280
```

## ⚙️ Configuration

### Set Your Gemini API Key

The system uses **Google's Gemini API** with Gemini 2.5 Pro for seller/buyer main decisions and Gemini 2.5 Flash for treasury. Get a key at https://aistudio.google.com/apikey (starts with `AIza`).

You need the key in **four places** — one root `.env` and one per agent. The per-agent `.env` files are what `dotenv.config({ path: ... .env })` loads in each agent's `index.ts`.

```bash
# 1. Copy templates
copy .env.example .env
copy src\agents\seller-agent\.env.example   src\agents\seller-agent\.env
copy src\agents\buyer-agent\.env.example    src\agents\buyer-agent\.env
copy src\agents\treasury-agent\.env.example src\agents\treasury-agent\.env

# 2. Edit each .env, set:
#    GEMINI_API_KEY=AIzaYour_real_key_here
```

See `GEMINI_SETUP.md` for tier selection (Pro vs Flash vs Flash-Lite), free-tier quotas, and the `GEMINI_FORCE_MODEL` override for cheap dev runs.

### Cost Control for Dev Runs

Want to burn through demo runs without thinking about cost? Set in every `.env`:
```
GEMINI_FORCE_MODEL=gemini-2.5-flash-lite
```
This forces all LLM calls to the cheapest model (~$0.001 per negotiation). Clear the override for production Pro-quality runs.

### Honest Fallback Labels (Iteration 0.5)

If Gemini is unreachable (rate-limited, bad key, JSON parse failure), the rule-based fallback runs and the audit records one of:
- `GEMINI_OK` — LLM call succeeded
- `GEMINI_RATE_LIMITED_RULES_FALLBACK` — 429 after all retries
- `GEMINI_INVALID_JSON_RULES_FALLBACK` — output couldn't parse
- `GEMINI_ERROR_RULES_FALLBACK` — other error
- `GEMINI_TOKEN_CEILING_REACHED` — per-negotiation token cap hit

This replaces the silent fallback from the Groq era. No deal closes invisibly on rules anymore — the audit shows which path was taken.

## 🎲 Test Different Scenarios

Run the negotiation multiple times — the buyer's starting price is randomized between ₹250-₹320, so every negotiation will be different. Records of past runs (100+) live in `src/escalations/`.

## 🐛 Troubleshooting

### Error: "Cannot find module"
**Cause**: agents resolve agent-card paths relative to `process.cwd()`.
**Solution**: always run from `A2A/js/`:
```bash
cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js
```

### Error: "Address already in use"
**Solution**: Close previous agent instances. To find the holder:
```bash
netstat -ano | findstr :7070
netstat -ano | findstr :8080
netstat -ano | findstr :9090
```

### Error: vLEI verification fails (`Cannot reach http://localhost:4000`)
**Cause**: The seller hard-calls `verifyCounterparty(...)` against the vLEI api-server on port 4000.
**Solution**: Either start the vLEI stack (see `vLEIEnh1/legentvLEI/START-vLEI.bat`), or stub `:4000` locally. This will be a `CREDENTIAL_MODE=plain` env-var once iteration 1 lands.

### Error: "GEMINI_API_KEY is required"
**Solution**: per-agent `.env` files must each contain `GEMINI_API_KEY=AIza...`. See "Set Your Gemini API Key" above.

### Error: "GEMINI_API_KEY format invalid"
**Cause**: Key doesn't start with `AIza` and is shorter than 20 characters.
**Solution**: Re-copy from https://aistudio.google.com/apikey without surrounding quotes.

### Warning: "Gemini rate-limited (attempt 1/4), backing off..."
**Cause**: Free Gemini tier quota exceeded (Pro = 50/day, Flash = 1,500/day).
**Solution**: Wait, or switch tier via `GEMINI_FORCE_MODEL=gemini-2.5-flash` or `gemini-2.5-flash-lite`.

### Error: "Negotiation failed - Max rounds exceeded"
**Cause**: Agents couldn't reach agreement in 3 rounds.
**Result**: `_escalation_BUYER.txt` and `_escalation_SELLER.txt` written to `src/escalations/`.
**Solution**: Re-run (randomized start) or adjust `BUYER_CONFIG`/`SELLER_CONFIG` in agent files.

## 📊 Advanced Usage

### Monitor Seller's View (Terminal 5 - Optional)
```bash
npx tsx src/cli.ts http://localhost:8080
```

### Run the UI Dashboard (Terminal 6 - Optional)
```bash
cd C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\ui
npm install   # first run only
npm run dev
# Vite dev server on http://localhost:5173
```

The UI subscribes to SSE feeds from each agent and renders the negotiation live.

## 🎉 Success Indicators

- ✅ All three agents started on correct ports (7070, 8080, 9090)
- ✅ `✅ Initializing Gemini with API key: AIza...` appears at seller + buyer startup
- ✅ Negotiation progresses through rounds (logged in all terminals)
- ✅ Treasury logs ACTUS PAM events per round
- ✅ Deal closes with invoice + DD offer + (optional) DD acceptance
- ✅ Success reports written to `src/escalations/`

---

**Ready to negotiate! 🤝**

Updated 2026-05-16 — Iteration 0+0.5 complete: Gemini replaces Groq; npm replaces pnpm in docs.
