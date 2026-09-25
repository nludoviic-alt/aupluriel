---
name: risk-manager
description: Audite et renforce la gestion du risque du bot Au Pluriel en lecture seule. Utiliser pour évaluer les limites de pertes, drawdown, exposition, taille de position, séries de pertes, pauses, positions ouvertes ou avant de proposer un changement de risque ou d'activer le trading réel.
---

# Gestion du risque

Évaluer les protections existantes avant de recommander un changement. Ne jamais promettre un rendement ni modifier une configuration ou déployer sans demande explicite.

## Procédure

1. Séparer les résultats `demo` et `live`, puis limiter les métriques aux trades `won` et `lost`.
2. Partir de `audit-trading-production` pour le profit factor, l'espérance, le drawdown et la taille de l'échantillon. Traiter moins de 30 trades comme exploratoire.
3. Vérifier dans la configuration réellement chargée : `maxDailyLossUsd`, `maxDailyProfitUsd`, `maxTradesPerDay`, `maxOpenPositions`, `maxConsecutiveLosses`, `cooldownMinutes`, `trailingStopUsd`, `trailingStopPct`, `progressiveStakeReduction`, `stopOnRisk`, `excludedSymbols` et `autoRollbackEnabled`.
4. Vérifier dans `src/lib/bot-engine.server.ts` que les limites portent aussi sur les pertes flottantes, qu'une pause survit au redémarrage et qu'une position ouverte reste suivie.
5. Isoler les risques par preset, symbole, instrument et session. Ne pas masquer une perte structurelle d'un segment par les gains d'un autre.
6. Classer chaque constat : conserver, surveiller ou suspendre. Proposer une seule modification réversible à la fois et indiquer le seuil de réévaluation à 20, 50 puis 100 nouveaux trades.

## Règles de décision

- Ne jamais fonder une recommandation sur le seul win rate.
- Exiger une espérance positive, un profit factor supérieur à 1 et un drawdown acceptable avant d'augmenter fréquence, levier ou mise.
- Préférer réduire l'exposition, suspendre un segment ou allonger un cooldown plutôt qu'augmenter la mise pour compenser des pertes.
- Ne jamais activer `autoRollbackEnabled` ou modifier des plafonds de risque sans expliquer ce qui sera automatiquement réverti ou suspendu.
- Toute modification de `src/lib/bot-engine.server.ts`, `src/lib/signal-core.ts`, `src/lib/autotrader.ts` ou du schéma doit suivre `production-trading-guardian` avant déploiement.

## Compte rendu

Donner le périmètre et l'échantillon, les métriques clés, les protections actives et manquantes, puis une recommandation prudente et réversible. Distinguer clairement faits, inférences et données insuffisantes.
