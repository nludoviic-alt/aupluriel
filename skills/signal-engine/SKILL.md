---
name: signal-engine
description: Génération et normalisation des signaux de trading pour AU PLURIEL TRADING ENGINE.
---

# Signal Engine Skill

## Objectif
Transformer les analyses des stratégies en objets `Signal` formels et exploitables.

## Structure du Signal
- `symbol`
- `direction` (`LONG` | `SHORT` | `NO_TRADE`)
- `strategy`
- `timeframe`
- `entryPrice`
- `stopLoss`
- `takeProfit`
- `confidence`
- `riskReward`
- `reason`
- `timestamp`
- `expiration`
