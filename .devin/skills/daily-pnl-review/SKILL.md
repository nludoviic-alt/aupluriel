---
name: daily-pnl-review
description: Analyse quotidienne des trades de la veille — identifie les pertes évitables, les symboles à suspendre, et recommande les ajustements pour aujourd'hui (seuil de confiance, mise, symboles). Utiliser chaque matin ou quand l'utilisateur demande "comment s'est passé hier" ou "analyse d'hier".
triggers:
  - user
  - model
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Daily P&L Review — Revue quotidienne de performance

Produire un diagnostic de la journée écoulée à partir des trades réels enregistrés
dans la base SQLite de production, puis formuler des recommandations actionnables
pour la journée en cours.

## Procédure — EXCLUSIVEMENT SUR VPS

**RÈGLE ABSOLUE**: Ce skill tourne TOUJOURS sur le VPS, JAMAIS en local.
La DB de production ne quitte jamais le VPS.

### Wrapper local (recommandé)

```bash
bash .devin/skills/daily-pnl-review/scripts/run-on-vps.sh
bash .devin/skills/daily-pnl-review/scripts/run-on-vps.sh --date=2026-08-05
bash .devin/skills/daily-pnl-review/scripts/run-on-vps.sh --mode=live
bash .devin/skills/daily-pnl-review/scripts/run-on-vps.sh --json
```

### SSH direct

```bash
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/daily-pnl-review/scripts/daily-review.mjs /home/ubuntu/data/lio23.db"
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/daily-pnl-review/scripts/daily-review.mjs /home/ubuntu/data/lio23.db --date=2026-08-05"
```

3. Lire les résultats dans cet ordre:
   - **Résumé global**: P&L, trades, win rate, espérance de la journée
   - **Par preset**: Boom / Crash / Multi — lequel a gagné/perdu
   - **Par symbole**: identifier les symboles qui ont perdu (à suspendre?)
   - **Par heure**: identifier les plages horaires perdantes
   - **Trades perdants**: analyser les plus grosses pertes (mise trop élevée? mauvais symbole?)
   - **Streaks**: séries de pertes consécutives (risque de tilt?)
   - **Comparaison vs 7 derniers jours**: la journée est-elle meilleure ou pire que la moyenne?

4. Formuler des recommandations en trois catégories:
   - **Suspendre**: symboles ou presets qui ont perdu aujourd'hui avec un échantillon suffisant
   - **Ajuster**: changements de mise, confiance, ou timing pour aujourd'hui
   - **Surveiller**: éléments à surveiller mais pas encore actionnables

## Règles de décision

- Ne jamais recommander de changement sur la base d'un seul trade.
- Un symbole doit avoir au moins 5 trades dans la journée pour être jugé.
- Comparer toujours la journée à la moyenne des 7 derniers jours pour contextualiser.
- Si le P&L est positif, ne pas recommander de changements majeurs — "if it ain't broke, don't fix it".
- Si le P&L est négatif, identifier la cause principale (symbole? heure? mise? preset?) avant de recommander.
- Ne jamais recommander d'augmenter la mise après une perte (risque de revenge trading).
- Vérifier si les pertes correspondent à un changement de config récent (table `config_changes`).

## Compte rendu attendu

Présenter:

1. **Verdict du jour**: positif/négatif/neutre avec le P&L et le nombre de trades
2. **Ce qui a marché**: symboles/presets/heures gagnants
3. **Ce qui a perdu**: symboles/presets/heures perdants avec analyse de cause
4. **Comparaison vs 7 jours**: meilleure/pire que la moyenne?
5. **Recommandations pour aujourd'hui**: 1-3 actions concrètes (suspendre X, ajuster Y, surveiller Z)
6. **Alertes**: séries de pertes, mises anormales, config changes récents
