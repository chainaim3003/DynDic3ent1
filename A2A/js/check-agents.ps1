# ============================================================================
# check-agents.ps1 -- Probe /health on all sub-agents and TCP-listen for the
# buyer/seller (which don't expose a standard /health endpoint).
# ============================================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Checking agent health"                                       -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$HealthAgents = @(
    @{ Name = "treasury";  Port = 7070; Url = "http://localhost:7070/health" }
    @{ Name = "credit";    Port = 7071; Url = "http://localhost:7071/health" }
    @{ Name = "inventory"; Port = 7072; Url = "http://localhost:7072/health" }
    @{ Name = "logistics"; Port = 7073; Url = "http://localhost:7073/health" }
)

foreach ($a in $HealthAgents) {
    try {
        $resp = Invoke-RestMethod -Uri $a.Url -TimeoutSec 3 -ErrorAction Stop
        $status = $resp.status
        if ($status -eq "ok") {
            Write-Host "  [OK]   $($a.Name) on port $($a.Port) -- status=$status" -ForegroundColor Green
        } else {
            Write-Host "  [warn] $($a.Name) on port $($a.Port) -- status=$status" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  [DOWN] $($a.Name) on port $($a.Port) -- $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Buyer + seller -- TCP-listen check only (their /health endpoint, if any,
# isn't standardized; we just confirm the port is bound).
$TcpAgents = @(
    @{ Name = "seller"; Port = 8080 }
    @{ Name = "buyer";  Port = 9090 }
)

foreach ($a in $TcpAgents) {
    $tnc = Test-NetConnection -ComputerName "localhost" -Port $a.Port -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($tnc) {
        Write-Host "  [OK]   $($a.Name) on port $($a.Port) -- TCP listening" -ForegroundColor Green
    } else {
        Write-Host "  [DOWN] $($a.Name) on port $($a.Port) -- not listening" -ForegroundColor Red
    }
}

Write-Host ""
