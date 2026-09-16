---
name: circuit-breaker
description: Disjoncteur de sécurité et machine à états pour AU PLURIEL TRADING ENGINE.
---

# Trade Safety / Circuit Breaker Skill

## Objectif
Interrompre ou suspendre automatiquement le trading en cas de condition critique ou d'anomalie de marché.

## Machine à États
- `TRADING_ACTIVE` : Opération normale.
- `TRADING_PAUSED` : Pause temporaire (ex: perte max quotidienne atteinte, pause de 1h après série de pertes).
- `TRADING_DISABLED` : Arrêt total suite à une erreur système ou une violation majeure de sécurité.
