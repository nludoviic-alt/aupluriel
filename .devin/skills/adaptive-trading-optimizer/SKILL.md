---
name: adaptive-trading-optimizer
description: Cerveau adaptatif du bot — apprend des erreurs de trades, classifie les pertes par cause racine, découvre les patterns gagnants, optimise automatiquement les paramètres (confiance, TP/SL, levier, symboles, sessions), se documente dans un journal persistant, et cherche en continu à approcher 90% de win rate. Utiliser quand l'utilisateur demande "apprends des erreurs", "optimise tout", "trouve la meilleure stratégie", "ajuste automatiquement", "pourquoi on perd", ou "améliore le bot".
triggers:
  - user
  - model
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Adaptive Trading Optimizer — Le cerveau qui apprend et s'optimise

Ce skill est le système nerveux central du bot. Il analyse TOUTES les données
de trading, apprend des erreurs, découvre les patterns gagnants, optimise les
paramètres, et se documente dans un journal persistant. Son objectif: approcher
90% de win rate avec un P&L positif durable.

## Architecture en 7 phases

### Phase 1: Collecte exhaustive des données
- Tous les trades fermés (won/lost) de la DB de production
- Toutes les configs actives par preset et par utilisateur
- L'historique des changements de config (table `config_changes`)
- L'état du backtest automatique (table `auto_backtest_state`)
- L'historique des signaux (table `signal_history`)

### Phase 2: Classification des erreurs
Chaque trade perdant est classifié par cause racine:
- **BAD_SYMBOL**: symbole systématiquement perdant (win rate < 40% sur 20+ trades)
- **BAD_TIMING**: trade ouvert pendant une heure/session défavorable
- **BAD_CONFIDENCE**: confiance trop basse ou trop haute (zone non rentable)
- **BAD_STAKE**: mise inadaptée au bankroll (trop élevée → Kelly négatif)
- **BAD_PRESET**: preset non rentable en conditions réelles
- **BAD_TF_AGREEMENT**: accord multi-timeframe insuffisant
- **BAD_DIRECTION**: signal contraire à la tendance dominante
- **HIGH_VOLATILITY**: trade ouvert pendant pic de volatilité
- **CONFIG_DRIFT**: config modifiée récemment, performance dégradée
- **INSUFFICIENT_SAMPLE**: pas assez de données pour conclure

### Phase 3: Découverte de patterns gagnants
- Mining des combinaisons gagnantes: symbole × heure × confiance × preset
- Identification des "zones d'or": segments avec win rate > 75% et P&L > 0
- Détection des corrélations: quels paramètres sont associés aux gains?
- Analyse des streaks: sequences de gains et leur contexte

### Phase 4: Optimisation des paramètres
Pour chaque preset, balayer les paramètres clés:
- **minConfidence**: balayer 70-95 par pas de 5
- **minTfAgreement**: balayer 1-6 par pas de 1
- **stopLossPctOfStake**: balayer 5-50 par pas de 5
- **takeProfitPctOfStake**: balayer 5-100 par pas de 5
- **multiplierLevel**: balayer 20-200 par pas de 20
- **durationMinutes**: balayer 1-30 par pas de 5
- **tradingSessions**: tester asia/london/newyork seules vs combinées
- **symbols**: tester chaque symbole seul vs combiné

Pour chaque combinaison, calculer le win rate simulé sur les trades historiques
qui correspondent aux critères. Garder les top 10 combinaisons.

### Phase 5: Génération de stratégies
À partir des patterns gagnants et des paramètres optimisés:
- Proposer une stratégie complète par preset
- Inclure: symboles, confiance, TF agreement, TP/SL, levier, sessions, stake
- Calculer le win rate projeté, l'espérance, le profit factor
- Comparer avec la stratégie actuelle (delta)

### Phase 6: Auto-ajustement sécurisé
Si `--apply` est passé:
- Appliquer uniquement les changements qui améliorent le win rate ET le P&L
- Jamais augmenter la mise de plus de 50% d'un coup
- Jamais changer plus de 3 paramètres à la fois par preset
- Toujours sauvegarder la config précédente (table `config_changes`)
- Demander confirmation avant d'appliquer (sauf `--auto`)
- Après application, programmer une réévaluation après 50 nouveaux trades

Sans `--apply`: mode lecture seule, propose seulement les changements.

### Phase 7: Documentation persistante
À chaque exécution, écrire un rapport dans:
```
.devin/skills/adaptive-trading-optimizer/journal/YYYY-MM-DD-HHMM.md
```

Le journal contient:
- Date et contexte d'exécution
- Métriques actuelles (win rate, P&L, PF, espérance)
- Erreurs classifiées (top 5 causes de pertes)
- Patterns gagnants découverts
- Paramètres optimisés proposés
- Changements appliqués (si --apply)
- Prochains seuils de réévaluation
- Comparaison avec l'exécution précédente (amélioration?)

## Procédure d'exécution — EXCLUSIVEMENT SUR VPS

**RÈGLE ABSOLUE**: Ce skill tourne TOUJOURS sur le VPS en production, JAMAIS en local.
La base de données de production (`/home/ubuntu/data/lio23.db`) ne quitte jamais le VPS.
Le script `optimize.mjs` est conçu pour s'exécuter sur le VPS avec accès direct à la DB.

### Option A — Wrapper local (recommandé)

Un wrapper local `run-on-vps.sh` SSH automatiquement sur le VPS et exécute le script:

```bash
# Analyse complète (lecture seule) — depuis local
bash .devin/skills/adaptive-trading-optimizer/scripts/run-on-vps.sh

# Avec options
bash .devin/skills/adaptive-trading-optimizer/scripts/run-on-vps.sh --user-id=11
bash .devin/skills/adaptive-trading-optimizer/scripts/run-on-vps.sh --preset=crash
bash .devin/skills/adaptive-trading-optimizer/scripts/run-on-vps.sh --target-winrate=0.90
bash .devin/skills/adaptive-trading-optimizer/scripts/run-on-vps.sh --apply
bash .devin/skills/adaptive-trading-optimizer/scripts/run-on-vps.sh --apply --auto
bash .devin/skills/adaptive-trading-optimizer/scripts/run-on-vps.sh --json
```

### Option B — SSH direct

```bash
# Analyse complète (lecture seule)
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/adaptive-trading-optimizer/scripts/optimize.mjs /home/ubuntu/data/lio23.db"

# Avec options (mêmes flags que le wrapper)
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/adaptive-trading-optimizer/scripts/optimize.mjs /home/ubuntu/data/lio23.db --preset=crash"
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/adaptive-trading-optimizer/scripts/optimize.mjs /home/ubuntu/data/lio23.db --apply"
```

### Synchronisation du script

Le script `optimize.mjs` est commité dans le repo git. Après chaque modification:
```bash
git add .devin/skills/adaptive-trading-optimizer/
git commit -m "update adaptive-trading-optimizer"
git push
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && git pull"
```

**NE JAMAIS** exécuter `optimize.mjs` en local avec une DB copiée — les résultats
seraient obsolètes et les changements appliqués sur une copie n'auraient aucun effet.

## Règles de sécurité

1. **Jamais de changement sans échantillon suffisant** (50+ trades par preset)
2. **Jamais augmenter la mise de plus de 50%** en une fois
3. **Jamais changer plus de 3 paramètres** par preset en une fois
4. **Toujours documenter** ce qui a été changé et pourquoi
5. **Toujours programmer une réévaluation** après 50 nouveaux trades
6. **Si le win rate projeté < 60%**, ne pas recommander de changement
7. **Si le P&L projeté < 0**, ne pas appliquer même si win rate > 90%
8. **Séparer démo et live** — optimiser sur les données du mode concerné
9. **Ne jamais optimiser sur moins de 7 jours** de données
10. **Vérifier la cohérence** — un pattern gagnant sur 7 jours doit l'être sur 30 jours

## Objectif: 90% de win rate

Le skill cherche en permanence à approcher 90% de win rate. Pour y arriver:
- Identifier les zones de confiance où le win rate dépasse 90%
- Restreindre les symboles à ceux qui ont > 80% de win rate
- Restreindre les sessions aux heures avec > 85% de win rate
- Augmenter le minTfAgreement pour exiger plus de consensus
- Ajuster le TP/SL pour favoriser les gains fréquents (TP bas, SL large)
- Si 90% n'est pas atteignable avec les paramètres actuels, le signaler
  et recommander les changements qui s'en rapprochent le plus

## Compte rendu attendu

1. **État actuel**: win rate, P&L, PF, espérance, drawdown — global et par preset
2. **Top 5 erreurs**: causes racines des pertes avec nombre de trades impactés
3. **Zones d'or**: top 5 patterns gagnants découverts (symbole × heure × confiance)
4. **Paramètres optimisés**: table de comparaison avant/après par preset
5. **Stratégies proposées**: une par preset avec win rate projeté et P&L projeté
6. **Changements appliqués**: si --apply, liste des configs modifiées
7. **Journal persistant**: chemin du fichier de documentation
8. **Prochains seuils**: quand réévaluer (après N trades ou N jours)
9. **Progression vs objectif 90%**: où en est-on et que manque-t-il
