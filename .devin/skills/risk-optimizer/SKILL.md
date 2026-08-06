---
name: risk-optimizer
description: Optimise la taille de position et les limites de perte quotidienne selon le bankroll et l'historique de win rate — utilise le critère de Kelly fractionnel pour maximiser la croissance tout en limitant le drawdown. Utiliser quand l'utilisateur demande "quelle mise utiliser", "optimise le risque", "combien je devrais miser", ou avant d'augmenter/diminuer les stakes.
triggers:
  - user
  - model
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Risk Optimizer — Optimisation de la taille de position et des limites

Calculer la taille de position optimale pour chaque preset/symbole à partir de
l'historique réel des trades, en utilisant le critère de Kelly fractionnel.
L'objectif est de maximiser la croissance du capital tout en limitant le drawdown
à un niveau acceptable.

## Procédure — EXCLUSIVEMENT SUR VPS

**RÈGLE ABSOLUE**: Ce skill tourne TOUJOURS sur le VPS, JAMAIS en local.

### Wrapper local (recommandé)

```bash
bash .devin/skills/risk-optimizer/scripts/run-on-vps.sh --bankroll=100
bash .devin/skills/risk-optimizer/scripts/run-on-vps.sh --bankroll=500 --kelly-fraction=0.5
bash .devin/skills/risk-optimizer/scripts/run-on-vps.sh --mode=live --user-id=11
bash .devin/skills/risk-optimizer/scripts/run-on-vps.sh --json
```

### SSH direct

```bash
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/risk-optimizer/scripts/risk-optimize.mjs /home/ubuntu/data/lio23.db --bankroll=100"
```

4. Lire les résultats:
   - **Kelly optimal par preset**: la formule Kelly pour chaque preset basée sur son win rate et son payout
   - **Mise recommandée**: Kelly × fraction × bankroll
   - **Limites de perte quotidiennes**: basées sur le drawdown historique et la volatilité
   - **Stress test**: que se passe-t-il avec 5, 10, 20 pertes consécutives?
   - **Comparaison avec la mise actuelle**: est-on sous-misé ou sur-misé?

5. Formuler des recommandations:
   - Si la mise actuelle > mise recommandée: réduire (sur-risque)
   - Si la mise actuelle < mise recommandée: peut augmenter (sous-risque)
   - Si le Kelly est négatif: le preset n'est pas rentable, arrêter

## Formules

### Critère de Kelly
```
f* = (p × b - q) / b
```
où:
- f* = fraction optimale du bankroll à miser
- p = probabilité de gain (win rate)
- q = 1 - p (probabilité de perte)
- b = ratio gain/perte (payout moyen / stake moyen pour les binaires,
  ou take_profit / stop_loss pour les multipliers)

### Kelly fractionnel
```
mise = f* × kelly_fraction × bankroll
```
- kelly_fraction = 0.25 (quart de Kelly, conservateur — recommandé)
- kelly_fraction = 0.50 (demi-Kelly, modéré)
- kelly_fraction = 1.00 (Kelly plein, agressif — déconseillé)

### Limite de perte quotidienne
```
daily_limit = max_drawdown_historique × 1.5
```
Basée sur le pire jour historique, avec une marge de 50%.

## Règles de décision

- Ne jamais recommander Kelly plein (f* × 1.0) — trop volatile.
- Si le win rate < seuil de rentabilité, f* est négatif → recommander d'arrêter.
- Exiger au moins 50 trades fermés pour qu'un preset soit jugé fiable.
- Le risque maximum par trade ne doit jamais dépasser 5% du bankroll.
- La limite de perte quotidienne ne doit jamais dépasser 15% du bankroll.
- Si le drawdown actuel > 20% du bankroll, recommander de réduire la mise de 50%.
- Séparer démo et live — le Kelly se calcule sur les données live si disponibles.

## Compte rendu attendu

1. **Bankroll actuel** et paramètres utilisés (fraction Kelly, mode)
2. **Tableau par preset**: win rate, payout ratio, Kelly %, mise recommandée, mise actuelle
3. **Limites recommandées**: perte quotidienne, perte hebdomadaire, nombre max de trades/jour
4. **Stress tests**: impact de séries de pertes (5, 10, 20) sur le bankroll
5. **Verdict**: sous-misé / bien calibré / sur-misé pour chaque preset
6. **Recommandations**: ajustements spécifiques avec les chiffres exacts
