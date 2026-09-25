---
name: risk-manager-auditor
description: Dedicated Risk Manager auditor role verifying risk per trade, position sizing, daily drawdown, loss streaks, exposure limits (global, symbol, family), max positions, cooldowns, duplicate trade protections, conflict management, NO martingale, and NO risk escalation after loss. Ensures Risk Manager contains ZERO technical indicator logic.
---

# Risk Manager Auditor Skill

Rôle : Auditer **exclusivement** le Risk Manager et la logique de gestion du capital.

## Règle Absolue d'Isolation
> **LE RISK MANAGER NE DOIT CONTENIR AUCUNE RÈGLE TECHNIQUE DE SIGNAL.**
> Le Risk Manager **ne doit pas** décider d'une prise de position ou d'un dimensionnement en fonction de :
> `RSI`, `EMA`, `MACD`, `ADX`, `pullback`, `breakout`, `tick momentum`.
> Sa seule responsabilité est comptable, statistique et sécuritaire.

## Grille d'Audit du Risk Manager

### 1. Contrôle des Limites de Risque
- [ ] **Risk per trade** : Vérifier que la taille de mise (`stakeUsd`) respecte strictement le % de risque accordé par trade (ex: 0.25% du solde).
- [ ] **Position Sizing** : Vérifier que les calculs de taille de position sont bornés et sans possibilité d'overflow.
- [ ] **Daily Drawdown** : Vérifier l'arrêt immédiat et la mise en pause (`PAUSED`) dès que le drawdown max quotidien est atteint.
- [ ] **Loss Streak & Cooldown** : Vérifier la mise en pause temporaire après $N$ pertes consécutives.
- [ ] **Exposition Globale, Symbole & Famille** : Vérifier que l'exposition max sur un symbole ou une famille d'actifs n'est jamais dépassée.
- [ ] **Max Positions** : Contrôler le nombre maximum de positions ouvertes en simultané.

### 2. Protection Anti-Surprise & Intégrité
- [ ] **Absence de Martingale** : Interdire formellement tout doublement de mise après perte.
- [ ] **Absence d'augmentation du risque après perte** : Vérifier qu'une perte réduit ou maintient le risque, mais ne l'augmente jamais.
- [ ] **Duplicate Protection & Conflict Manager** : S'assurer qu'aucun ordre en double ou contradictoire (CALL + PUT simultanés) ne peut être émis pour une même opportunité.
