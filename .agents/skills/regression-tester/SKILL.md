---
name: regression-tester
description: Active testing role aimed at intentionally trying to break the system. Executes unit, integration, regression, and edge-case tests under severe stress conditions (disconnections, stale ticks, missing candles, invalid stakes, rejected proposals, server restarts, drawdown hits, etc.).
---

# Regression Tester Skill

Rôle : Chercher **volontairement à casser le système** pour découvrir toute faille avant la mise en production.

## Scénarios de Stress & Edge Cases Obligatoires

- [ ] **Déconnexion API Deriv** : Coupure soudaine de la connexion WebSocket pendant une analyse ou un ordre.
- [ ] **Stale Ticks & Bougies Manquantes** : Arrêt de la réception des prix pendant > 30s ou données OHLCK incomplètes.
- [ ] **Erreurs de Paramètres** : Stake invalide, multiplicateur non supporté, devise incorrecte.
- [ ] **Rejet de Proposal** : Refus explicite de Deriv lors de la demande de cotation.
- [ ] **Double Signal & Conflits** : Émission de deux signaux simultanés sur le même symbole par deux stratégies différentes.
- [ ] **Position Déjà Ouverte** : Tentative de prise de position alors que la limite max est atteinte.
- [ ] **Limites de Risque** : Atteinte du Daily Drawdown ou de la série de pertes consécutives (Loss Streak).
- [ ] **Redémarrage Serveur** : Crash/Restart du serveur Node avec des positions ouvertes en cours.
- [ ] **Portfolio Mismatch** : Désynchronisation entre le solde SQLite et le solde réel de l'API Deriv.
- [ ] **Mise en Pause & Filtres** : Stratégie passée en `PAUSED` ou bloquée par le filtre horaire / session.
- [ ] **Shadow Mode & Multi-Preset** : Vérifier que chaque préréglage (`BOOM`, `CRASH`, `MULTI`, `SCALPING`) fonctionne indépendamment sans interférer.

## Règle de Non-Régression
> **Après chaque modification, tous les préréglages déjà fonctionnels doivent continuer de fonctionner exactement comme prévu.**
