# AgentFlow UI

React + Vite frontend for the A2A Negotiation & vLEI verification system.

## Prerequisites

All backend services must be running before starting the UI.

---

## Step 1 — Start vLEI Infrastructure (WSL)

```bash
cd /mnt/c/Users/WELCOME/Documents/chainaim/mcp\ server/DynDiscMiniProject2/legentvLEI

# First time only — run the full vLEI workflow
./stop.sh
./setup.sh
./deploy.sh
./saidify-and-restart.sh
./run-all-buyerseller-4D-with-subdelegation.sh
./DEEP-EXT-subagent.sh JupiterTreasuryAgent jupiterSellerAgent
```

## Step 2 — Start vLEI API Server (WSL)

```bash
cd 'c:\Users\WELCOME\Documents\chainaim\mcp server\DynDiscMiniProject2\legentvLEI\api-server'  
node server.js
# Runs on http://localhost:4000
```

## Step 3 — Start A2A Agents (Windows — 3 terminals)

```powershell
cd "C:\Users\WELCOME\Documents\chainaim\mcp server\DynDiscMiniProject2\A2A\js"

# Terminal 1 — Treasury Agent (port 7070)
npm run agents:treasury

# Terminal 2 — Seller Agent (port 8080)
npm run agents:seller

# Terminal 3 — Buyer Agent (port 9090)
npm run agents:buyer
```

## Step 4 — Start the UI

```powershell
cd "C:\Users\WELCOME\Documents\chainaim\mcp server\DynDiscMiniProject2\ui"
npm run dev
# Opens at http://localhost:5173
```

---

## Service Ports

| Service | Port | Purpose |
|---|---|---|
| vLEI API Server | 4000 | Agent verification, IPEX status |
| Seller Agent | 8080 | Negotiation, invoice, DD |
| Buyer Agent | 9090 | Negotiation, PO, DD accept |
| Treasury Agent | 7070 | ACTUS simulation, cash flow |
| UI | 5173 | Frontend |

---

## Usage Flow in UI

1. Go to **Agents** tab
2. In Buyer Chat: type `fetch seller agent` — fetches agent card from :8080
3. Type `verify agent` — verifies seller vLEI delegation via :4000 (needs vLEI running)
4. After verification passes: type `start negotiation 300` (or any opening price)
5. Watch negotiation, treasury consultation, invoice, IPEX grant/admit, and DD flow

---

## Data Sources

All data is real — no mock data:

| UI Section | Data Source |
|---|---|
| Agent cards | `:8080` / `:9090` / `:7070` live agents |
| vLEI verification pipeline | `:4000/api/status` → task-data files |
| IPEX grant / admit | `:4000/api/ipex-status` → task-data files |
| Treasury verification | `:4000/api/status` + `:7070` agent card |
| Negotiation chat | SSE streams from `:8080` and `:9090` |
| Treasury chat | SSE stream from `:7070` |
| Dashboard cash flow | `:7070/actus-contracts` |
| Contract Management | `:7070/actus-contracts` |
| Risk & Analytics | `:7070/actus-contracts` |
