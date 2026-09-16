---
name: risk-manager
description: Contrôle strict du risque et droit de VETO absolu pour AU PLURIEL TRADING ENGINE.
---

# Risk Manager Skill

## Objectif
Valider chaque transaction AVANT son exécution. Possède un **droit de VETO ABSOLU**.

## Contrôles
- Risque maximal par trade.
- Taille de position maximale.
- Exposition totale du portefeuille.
- Limite de perte journalière (Daily Drawdown).
- Drawdown global maximal.
- Nombre maximal de positions ouvertes simultanées.
- État du Circuit Breaker.

## Sorties
- `APPROVED` (avec taille de mise ajustée).
- `REJECTED` (avec raison explicite).
