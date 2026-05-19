# ============================================================================
# stop-all-agents.ps1 -- Stop all 6 agents by killing whoever owns their port
# ============================================================================
#
# Finds the process holding each known agent port and stops it. This kills
# the Node process for the agent but does NOT close the spawned PowerShell
# windows themselves (they remain open showing "Agent stopped -- press any
# key to close").
#
# Usage:
#   .\stop-all-agents.ps1
# ============================================================================

$AgentPorts = @{
    "buyer"     = 9090
    "seller"    = 8080
    "treasury"  = 7070
    "credit"    = 7071
    "inventory" = 7072
    "logistics" = 7073
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Stopping all agents by port"                                 -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

foreach ($name in $AgentPorts.Keys) {
    $port = $AgentPorts[$name]

    # Get-NetTCPConnection returns one or more entries per listening port.
    $conn = $null
    try {
        $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    } catch {
        Write-Host "  [skip] $name on port $port -- no listener" -ForegroundColor DarkGray
        continue
    }

    # OwningProcess is the PID. There can be multiple connection rows for
    # the same listener; dedupe by PID.
    $pids = @($conn | Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($targetPid in $pids) {
        try {
            $proc = Get-Process -Id $targetPid -ErrorAction Stop
            Stop-Process -Id $targetPid -Force -ErrorAction Stop
            Write-Host "  [OK]   stopped $name (pid $targetPid, $($proc.ProcessName)) on port $port" -ForegroundColor Green
        } catch {
            Write-Host "  [warn] could not stop $name pid $targetPid on port $port -- $_" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "Done. The agent PowerShell windows themselves remain open -- close them manually." -ForegroundColor Cyan
Write-Host ""
