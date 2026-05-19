#!/usr/bin/env bash
# ============================================================================
# stop-all-agents.sh — Stop all 6 agents by killing whoever owns their port
# ============================================================================

set -u

declare -A AGENT_PORTS=(
    ["buyer"]=9090
    ["seller"]=8080
    ["treasury"]=7070
    ["credit"]=7071
    ["inventory"]=7072
    ["logistics"]=7073
)

echo ""
echo "============================================================"
echo "  Stopping all agents by port"
echo "============================================================"
echo ""

for name in "${!AGENT_PORTS[@]}"; do
    port="${AGENT_PORTS[$name]}"

    # lsof is the most portable way to find a port's owning PID on
    # macOS + Linux. Fall back to fuser if lsof isn't installed.
    pids=""
    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti :"$port" 2>/dev/null || true)"
    elif command -v fuser >/dev/null 2>&1; then
        pids="$(fuser -n tcp "$port" 2>/dev/null || true)"
    else
        echo "  [warn] neither lsof nor fuser available; cannot stop $name on port $port"
        continue
    fi

    if [ -z "$pids" ]; then
        echo "  [skip] $name on port $port — no listener"
        continue
    fi

    for target_pid in $pids; do
        if kill "$target_pid" 2>/dev/null; then
            echo "  [OK]   stopped $name (pid $target_pid) on port $port"
        elif kill -9 "$target_pid" 2>/dev/null; then
            echo "  [OK]   force-stopped $name (pid $target_pid) on port $port"
        else
            echo "  [warn] could not stop $name pid $target_pid on port $port"
        fi
    done
done

echo ""
echo "Done. The terminal windows themselves remain open — close them manually."
echo ""
