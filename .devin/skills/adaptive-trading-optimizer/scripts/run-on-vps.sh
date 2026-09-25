#!/usr/bin/env bash
# Wrapper local — exécute l'adaptive optimizer sur le VPS via SSH.
# Usage: bash run-on-vps.sh [OPTIONS]
# Options transmises telles quelles à optimize.mjs sur le VPS:
#   --user-id=N         Analyse par utilisateur
#   --preset=X          Analyse par preset (crash, boom, default, scalping, liquidity)
#   --target-winrate=0.90  Objectif de win rate (défaut: 0.90)
#   --apply             Applique les changements (avec confirmation)
#   --auto              Mode全自动 (applique sans confirmation — DANGEREUX)
#   --json              Sortie JSON

set -euo pipefail

VPS_HOST="ubuntu@51.79.70.153"
VPS_APP_DIR="/home/ubuntu/app"
VPS_DB="/home/ubuntu/data/lio23.db"
SCRIPT_PATH=".devin/skills/adaptive-trading-optimizer/scripts/optimize.mjs"

# Transmet tous les arguments au script sur le VPS
ARGS="$*"

echo "→ Exécution sur VPS ($VPS_HOST)..."
echo "→ DB: $VPS_DB"
echo "→ Args: ${ARGS:-<aucune>}"
echo ""

ssh "$VPS_HOST" "cd $VPS_APP_DIR && node $SCRIPT_PATH $VPS_DB $ARGS"
