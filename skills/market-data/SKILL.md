---
name: market-data
description: Module de collecte, normalisation et agrégation des données de marché pour AU PLURIEL TRADING ENGINE.
---

# Market Data Analyst Skill

## Objectif
Collecter, normaliser et distribuer les prix, bougies OHLC, ticks, spreads et données multi-timeframes.

## Responsabilités
- Agrégation des prix en temps réel (ticks & bougies).
- Calcul du spread et de la volatilité moyenne.
- Ingestion multi-timeframes (M1, M5, M15, H1, H4).
- Ne prend **AUCUNE** décision de trading.

## Entrées / Sorties
- **Input** : Ingestion via `BrokerAdapter` (ticks WS / bougies REST).
- **Output** : `MARKET_DATA_READY` | `MARKET_DATA_INVALID`.
