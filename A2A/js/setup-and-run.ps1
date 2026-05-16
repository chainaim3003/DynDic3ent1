# Quick Setup and Run Script — updated for DynDic3ent1
# Location: C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js\setup-and-run.ps1
# Updated:  2026-05-15

$ProjectRoot = "C:\SATHYA\CHAINAIM3003\mcp-servers\FINAGENTS\FINAGENTS1\DynDic3ent1\A2A\js"

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  A2A Agentic Negotiation System - Setup" -ForegroundColor Cyan
Write-Host "  Project: $ProjectRoot" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Navigate to project directory
Set-Location -Path $ProjectRoot

# ── Root .env ────────────────────────────────────────────────────────────────
if (-not (Test-Path ".env")) {
    Write-Host "⚠️  Root .env file not found!" -ForegroundColor Yellow
    Write-Host "Creating .env from template..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "✓ Created .env file" -ForegroundColor Green
    Write-Host ""
    Write-Host "⚠️  IMPORTANT: Edit .env and add your Groq API key!" -ForegroundColor Yellow
    Write-Host "   Get a free key at https://console.groq.com/keys" -ForegroundColor Yellow
    Write-Host "   File location: $ProjectRoot\.env" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press any key to open .env file in notepad..." -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    notepad ".env"
    Write-Host ""
    Write-Host "After adding your API key, press any key to continue..." -ForegroundColor Cyan
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# ── Per-agent .env files (each agent's index.ts loads its own via dotenv) ────
$AgentEnvs = @(
    "src\agents\seller-agent\.env",
    "src\agents\buyer-agent\.env",
    "src\agents\treasury-agent\.env"
)
foreach ($envPath in $AgentEnvs) {
    if (-not (Test-Path $envPath)) {
        $examplePath = "$envPath.example"
        if (Test-Path $examplePath) {
            Copy-Item $examplePath $envPath
            Write-Host "✓ Created $envPath" -ForegroundColor Green
        }
    }
}

Write-Host ""
Write-Host "Installing dependencies (pnpm)..." -ForegroundColor Cyan
pnpm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Error installing dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Dependencies installed" -ForegroundColor Green
Write-Host ""

Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Ready to start negotiation!" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting agents in separate windows..." -ForegroundColor Cyan
Write-Host "(Order matters: Treasury → Seller → Buyer → CLI)" -ForegroundColor DarkGray
Write-Host ""

# ── Start Treasury Agent FIRST (seller consults it every round) ──────────────
Write-Host "🏦 Starting Treasury Agent (Port 7070)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ProjectRoot`"; pnpm run agents:treasury"
Start-Sleep -Seconds 4

# ── Start Seller Agent ───────────────────────────────────────────────────────
Write-Host "🏪 Starting Seller Agent (Port 8080)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ProjectRoot`"; pnpm run agents:seller"
Start-Sleep -Seconds 3

# ── Start Buyer Agent ────────────────────────────────────────────────────────
Write-Host "🛒 Starting Buyer Agent (Port 9090)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ProjectRoot`"; pnpm run agents:buyer"
Start-Sleep -Seconds 3

# ── Start CLI ────────────────────────────────────────────────────────────────
Write-Host "💬 Starting CLI..." -ForegroundColor Green
Start-Sleep -Seconds 2
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$ProjectRoot`"; npx tsx src/cli.ts http://localhost:9090"

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  All agents started!" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "In the CLI window, type: start negotiation" -ForegroundColor Yellow
Write-Host ""
Write-Host "NOTE: The seller hard-calls vLEI verification at http://localhost:4000" -ForegroundColor DarkGray
Write-Host "before each negotiation. Start the vLEI stack first, or expect verification" -ForegroundColor DarkGray
Write-Host "failures until DESIGN2 Phase 1 lands the CREDENTIAL_MODE=plain switch." -ForegroundColor DarkGray
Write-Host ""
Write-Host "Watch the negotiation unfold across all windows!" -ForegroundColor Cyan
Write-Host ""
