#!/usr/bin/env bash
# ============================================================================
# run-all-agents.sh — Launch all 6 agents in separate terminal windows
# ============================================================================
#
# Linux/Mac equivalent of run-all-agents.ps1. Each agent runs in its own
# terminal window so you can see live console output.
#
# Platform detection:
#   macOS  → uses osascript to open new Terminal.app tabs
#   Linux  → tries gnome-terminal, then konsole, then xterm
#
# Ports:
#   buyer       9090
#   seller      8080
#   treasury    7070
#   credit      7071
#   inventory   7072
#   logistics   7073
#
# Usage:
#   chmod +x run-all-agents.sh   # one time
#   ./run-all-agents.sh
# ============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JS_ROOT="$SCRIPT_DIR"

if [ ! -f "$JS_ROOT/package.json" ]; then
    echo "ERROR: package.json not found in $JS_ROOT" >&2
    echo "       run-all-agents.sh must live in A2A/js/" >&2
    exit 1
fi

echo ""
echo "============================================================"
echo "  Launching all 6 agents (each in its own terminal window)"
echo "  Working directory: $JS_ROOT"
echo "============================================================"
echo ""

# Detect the platform (macOS vs Linux) and the terminal we'll spawn into.
PLATFORM="$(uname -s)"
SPAWN_KIND=""
case "$PLATFORM" in
    Darwin)
        SPAWN_KIND="mac"
        ;;
    Linux)
        if command -v gnome-terminal >/dev/null 2>&1; then
            SPAWN_KIND="gnome-terminal"
        elif command -v konsole >/dev/null 2>&1; then
            SPAWN_KIND="konsole"
        elif command -v xterm >/dev/null 2>&1; then
            SPAWN_KIND="xterm"
        else
            echo "ERROR: no supported terminal emulator found." >&2
            echo "       Install gnome-terminal, konsole, or xterm." >&2
            exit 1
        fi
        ;;
    *)
        echo "ERROR: unsupported platform: $PLATFORM" >&2
        echo "       This script targets macOS and Linux. On Windows use run-all-agents.ps1." >&2
        exit 1
        ;;
esac
echo "Detected platform: $PLATFORM   (spawning via: $SPAWN_KIND)"
echo ""

# ----------------------------------------------------------------------------
# Function: launch one agent in its own terminal.
#   $1 — display name
#   $2 — npm script (e.g. "agents:treasury")
#   $3 — port (for display)
# ----------------------------------------------------------------------------
launch_agent() {
    local name="$1"
    local npm_script="$2"
    local port="$3"
    local title="$name (port $port)"
    local inner_cmd="cd '$JS_ROOT' && echo '====================================================' && echo '  $name (port $port)' && echo '  Ctrl+C to stop. Close window to kill.' && echo '====================================================' && npm run $npm_script; echo ''; echo '*** Agent stopped. Press Enter to close. ***'; read"

    case "$SPAWN_KIND" in
        mac)
            # Open a new Terminal.app window with the title set.
            osascript <<EOF
tell application "Terminal"
    activate
    do script "$inner_cmd"
    set custom title of front window to "$title"
end tell
EOF
            ;;
        gnome-terminal)
            gnome-terminal --title="$title" -- bash -c "$inner_cmd; exec bash" >/dev/null 2>&1 &
            ;;
        konsole)
            konsole --new-tab -p "tabtitle=$title" -e bash -c "$inner_cmd; exec bash" >/dev/null 2>&1 &
            ;;
        xterm)
            xterm -T "$title" -e bash -c "$inner_cmd; exec bash" >/dev/null 2>&1 &
            ;;
    esac

    echo "  [OK] Spawned: $title"
}

# ----------------------------------------------------------------------------
# Phase 1: sub-agents
# ----------------------------------------------------------------------------
echo "Phase 1: Launching sub-agents..."
launch_agent "Jupiter Treasury Agent"  "agents:treasury"  7070
launch_agent "Jupiter Credit Agent"    "agents:credit"    7071
launch_agent "Jupiter Inventory Agent" "agents:inventory" 7072
launch_agent "Jupiter Logistics Agent" "agents:logistics" 7073
echo ""

WAIT_SECONDS=3
echo "Waiting $WAIT_SECONDS seconds for sub-agent ports to come up..."
sleep "$WAIT_SECONDS"
echo ""

# ----------------------------------------------------------------------------
# Phase 2: main agents
# ----------------------------------------------------------------------------
echo "Phase 2: Launching main agents..."
launch_agent "Jupiter Seller Agent" "agents:seller" 8080
sleep 2
launch_agent "Tommy Buyer Agent"    "agents:buyer"  9090
echo ""

echo "============================================================"
echo "  All 6 agent windows spawned."
echo ""
echo "  Verify with: ./check-agents.sh"
echo "  Stop all   : ./stop-all-agents.sh"
echo ""
echo "  Health URLs:"
echo "    http://localhost:7070/health   (treasury)"
echo "    http://localhost:7071/health   (credit)"
echo "    http://localhost:7072/health   (inventory)"
echo "    http://localhost:7073/health   (logistics)"
echo "============================================================"
echo ""
