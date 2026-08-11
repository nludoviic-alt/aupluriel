---
name: spike-detection
description: Analyse et valide la détection de spikes Boom/Crash du bot Au Pluriel. Utiliser pour examiner Spike Hunter, les entrées Boom ou Crash, les faux signaux, le délai post-spike, les filtres M1/M5, ou avant de modifier `spike-hunter-signal.server.ts` et les paramètres associés.
---

# Détection de spikes

Contrôler le module `src/lib/spike-hunter-signal.server.ts` et son intégration dans `src/lib/bot-engine.server.ts`. Traiter le score de probabilité comme un classement de signaux, jamais comme une probabilité de gain garantie.

## Procédure

1. Confirmer le périmètre : symbole Boom ou Crash, mode démo ou réel, preset, période et nombre de trades fermés.
2. Vérifier les données nécessaires : au moins 30 bougies M1 et 15 M5, cohérence OHLC et absence de trous de récupération.
3. Relever les conditions du signal : délai depuis le dernier spike, RSI M1/M5, accumulation ou distribution, proximité support/résistance, direction et durée suggérée.
4. Comparer les trades Spike Hunter aux autres entrées Boom/Crash selon P&L, espérance, profit factor, drawdown et délai d'entrée. Segmenter par symbole et ne pas conclure sous 30 trades.
5. Vérifier que le signal passe encore les garde-fous généraux : `minConfidence`, plafond de confiance, positions ouvertes, perte journalière, série de pertes, cooldown et taille de position.
6. Si un changement de seuil, TP/SL, levier ou confiance est envisagé, utiliser `tune-boom-preset` ou `tune-crash-preset` selon le symbole avant toute modification.

## Règles

- Ne pas augmenter la mise à partir du seul `suggestedStakeMultiplier`; les limites de risque du preset restent prioritaires.
- Ne pas confondre une grande bougie passée avec un spike prédictible : contrôler les faux positifs et les entrées tardives.
- Conserver le signal seulement si son avantage subsiste hors échantillon et après coûts, pas sur une poignée de trades exceptionnels.
- Ne pas modifier le moteur ou déployer sans demande explicite et sans `production-trading-guardian`.

## Compte rendu

Présenter les conditions observées, les segments performants et défaillants, les limites de données, puis une action : conserver, surveiller, suspendre ou tester en démo.
