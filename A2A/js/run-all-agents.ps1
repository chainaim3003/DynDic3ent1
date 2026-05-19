# ============================================================================
# run-all-agents.ps1 — Launch all 6 agents in separate PowerShell windows
# ============================================================================
#
# Each agent runs in its own PowerShell window so you can see live console
# output for each one. Windows stay open after the agent stops (so you can
# read any error). Closing a window kills that agent only.
#
# Startup order:
#   1. Sub-agents first (treasury, credit, inventory, logistics)
#   2. 3-second pause so ports are listening
#   3. Seller, then buyer (which fetches seller's agent card on startup)
#
# Ports (all on localhost):
#   buyer       9090
#   seller      8080
#   treasury    7070
#   credit      7071
#   inventory   7072
#   logistics   7073
#
# To stop everything: run stop-all-agents.ps1, or close each window.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\run-all-agents.ps1
#   .\run-all-agents.ps1                    # if execution policy allows
#
# ============================================================================

# Resolve the A2A/js directory from this script's own location so the script
# works regardless of where it's invoked from.
$ScriptDir = $PSScriptRoot
$JsRoot    = $ScriptDir
if (-not (Test-Path (Join-Path $JsRoot "package.json"))) {
    Write-Host "ERROR: package.json not found in $JsRoot" -ForegroundColor Red
    Write-Host "       run-all-agents.ps1 must live in A2A/js/" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Launching all 6 agents (each in its own PowerShell window)"  -ForegroundColor Cyan
Write-Host "  Working directory: $JsRoot"                                   -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ----------------------------------------------------------------------------
# Function: launch one agent in its own PowerShell window.
#   $Name        — display name in the window title
#   $NpmScript   — npm script name (e.g. "agents:treasury")
#   $Port        — port this agent listens on (for the title bar)
# ----------------------------------------------------------------------------
function Start-AgentWindow {
    param(
        [Parameter(Mandatory=$true)] [string] $Name,
        [Parameter(Mandatory=$true)] [string] $NpmScript,
        [Parameter(Mandatory=$true)] [int]    $Port
    )

    $title   = "$Name (port $Port)"

    # Build the command the new window will run. We use Set-Location instead
    # of cd so the script works on Windows PowerShell 5.x and PowerShell 7+.
    # The Write-Host at the top makes it clear which agent is in this window.
    $cmd = @"
`$host.UI.RawUI.WindowTitle = '$title'
Set-Location -Path '$JsRoot'
Write-Host ''
Write-Host '====================================================' -ForegroundColor Yellow
Write-Host '  $Name  (port $Port)' -ForegroundColor Yellow
Write-Host '  Press Ctrl+C to stop this agent.' -ForegroundColor Yellow
Write-Host '  Closing this window also stops this agent.' -ForegroundColor Yellow
Write-Host '====================================================' -ForegroundColor Yellow
Write-Host ''
npm run $NpmScript
Write-Host ''
Write-Host '*** Agent stopped. Press any key to close this window. ***' -ForegroundColor Red
`$null = `$host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
"@

    # -NoExit so the window stays open after the agent stops/errors.
    Start-Process -FilePath "powershell.exe" `
                  -ArgumentList "-NoExit", "-Command", $cmd `
                  -WindowStyle Normal

    Write-Host "  [OK] Spawned window: $title" -ForegroundColor Green
}

# ----------------------------------------------------------------------------
# Phase 1: sub-agents (treasury + credit + inventory + logistics)
# ----------------------------------------------------------------------------
Write-Host "Phase 1: Launching sub-agents..." -ForegroundColor Cyan
Start-AgentWindow -Name "Jupiter Treasury Agent"  -NpmScript "agents:treasury"  -Port 7070
Start-AgentWindow -Name "Jupiter Credit Agent"    -NpmScript "agents:credit"    -Port 7071
Start-AgentWindow -Name "Jupiter Inventory Agent" -NpmScript "agents:inventory" -Port 7072
Start-AgentWindow -Name "Jupiter Logistics Agent" -NpmScript "agents:logistics" -Port 7073
Write-Host ""

# Pause to let sub-agent ports come up. Seller calls treasury immediately
# on first negotiation, so all four must be listening before seller starts.
$WaitSeconds = 3
Write-Host "Waiting $WaitSeconds seconds for sub-agent ports to come up..." -ForegroundColor Cyan
Start-Sleep -Seconds $WaitSeconds
Write-Host ""

# ----------------------------------------------------------------------------
# Phase 2: main agents (seller, then buyer)
# ----------------------------------------------------------------------------
Write-Host "Phase 2: Launching main agents..." -ForegroundColor Cyan
Start-AgentWindow -Name "Jupiter Seller Agent" -NpmScript "agents:seller" -Port 8080
Start-Sleep -Seconds 2
Start-AgentWindow -Name "Tommy Buyer Agent"    -NpmScript "agents:buyer"  -Port 9090
Write-Host ""

Write-Host "============================================================" -ForegroundColor Green
Write-Host "  All 6 agent windows have been spawned."                      -ForegroundColor Green
Write-Host ""
Write-Host "  Verify with: " -NoNewline; Write-Host ".\check-agents.ps1"   -ForegroundColor Yellow
Write-Host "  Stop all   : " -NoNewline; Write-Host ".\stop-all-agents.ps1" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Health URLs:" -ForegroundColor Cyan
Write-Host "    http://localhost:7070/health   (treasury)"  -ForegroundColor Gray
Write-Host "    http://localhost:7071/health   (credit)"    -ForegroundColor Gray
Write-Host "    http://localhost:7072/health   (inventory)" -ForegroundColor Gray
Write-Host "    http://localhost:7073/health   (logistics)" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
