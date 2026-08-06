#!/usr/bin/env bash
# Wrapper local — exécute backtest-vs-live-validator sur le VPS via SSH.
# Usage: bash run-on-vps.sh [OPTIONS]
# Tous les arguments sont transmis au script sur le VPS.

set -euo pipefail

VPS_HOST="ubuntu@51.79.70.153"
VPS_APP_DIR="/home/ubuntu/app"
VPS_DB="/home/ubuntu/data/lio23.db"
SCRIPT_PATH=".devin/skills/backtest-vs-live-validator/scripts/validate.mjs"

ARGS="$*"

echo "→ Exécution sur VPS ($VPS_HOST)..."
echo "→ Script: $SCRIPT_PATH"
echo "→ Args: ${ARGS:-<aucune>}"
echo ""

ssh "$VPS_HOST" "cd $VPS_APP_DIR && node $SCRIPT_PATH $VPS_DB $ARGS"
