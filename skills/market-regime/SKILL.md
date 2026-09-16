---
name: market-regime
description: Analyse et classification déterministe du régime de marché actuel pour AU PLURIEL TRADING ENGINE.
---

# Market Regime Analyst Skill

## Objectif
Classifier de façon déterministe le régime de marché sans prendre de décision de positionnement.

## Régimes Supportés
- `TRENDING_UP` : Tendance haussière établie.
- `TRENDING_DOWN` : Tendance baissière établie.
- `RANGE` : Consolidation horizontale.
- `HIGH_VOLATILITY` : Forte expansion de volatilité.
- `LOW_VOLATILITY` : Contraction extrême.
- `BREAKOUT` : Cassure imminente ou en cours.
- `REVERSAL` : Structure de retournement potentielle.
- `UNCERTAIN` : Indécision du marché (No Trade).

## Sortie Structurée
```json
{
  "regime": "TRENDING_UP",
  "confidence": 85,
  "volatility": 1.25,
  "trendDirection": "UP",
  "marketState": "Strong bullish trend"
}
```
