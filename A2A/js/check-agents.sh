#!/usr/bin/env bash
# ============================================================================
# check-agents.sh — Probe /health on sub-agents and TCP-listen on buyer/seller
# ============================================================================

echo ""
echo "============================================================"
echo "  Checking agent health"
echo "============================================================"
echo ""

probe_health() {
    local name="$1"
    local port="$2"
    local url="http://localhost:$port/health"
    local body
    body="$(curl -s --max-time 3 "$url" 2>/dev/null || true)"
    if [ -z "$body" ]; then
        echo "  [DOWN] $name on port $port — no response"
        return
    fi
    if echo "$body" | grep -q '"status":"ok"'; then
        echo "  [OK]   $name on port $port — status=ok"
    else
        echo "  [warn] $name on port $port — body: $body"
    fi
}

probe_tcp() {
    local name="$1"
    local port="$2"
    if command -v nc >/dev/null 2>&1; then
        if nc -z localhost "$port" 2>/dev/null; then
            echo "  [OK]   $name on port $port — TCP listening"
        else
            echo "  [DOWN] $name on port $port — not listening"
        fi
    else
        # Bash /dev/tcp fallback
        if (echo > /dev/tcp/localhost/"$port") 2>/dev/null; then
            echo "  [OK]   $name on port $port — TCP listening"
        else
            echo "  [DOWN] $name on port $port — not listening"
        fi
    fi
}

probe_health "treasury"  7070
probe_health "credit"    7071
probe_health "inventory" 7072
probe_health "logistics" 7073
probe_tcp    "seller"    8080
probe_tcp    "buyer"     9090

echo ""
