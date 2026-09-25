---
name: backtest-vs-live-validator
description: Compare les promesses du backtest avec les résultats réels en production — détecte si le bot sous-performe vs ses backtests et pourquoi (slippage, spread, exécution, timing). Utiliser quand l'utilisateur demande "le backtest est-il fiable", "pourquoi le live est pire que le backtest", ou pour valider un preset avant de le déployer en live.
triggers:
  - user
  - model
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Backtest vs Live Validator — Validation des promesses de backtest

Comparer les résultats des backtests avec les trades réels en production pour
détecter les écarts de performance et identifier leurs causes. Un backtest qui
promet +80% de win rate mais qui livre 55% en live indique un problème
(surapprentissage, slippage, conditions de marché différentes, exécution).

## Procédure — EXCLUSIVEMENT SUR VPS

**RÈGLE ABSOLUE**: Ce skill tourne TOUJOURS sur le VPS, JAMAIS en local.

### Wrapper local (recommandé)

```bash
bash .devin/skills/backtest-vs-live-validator/scripts/run-on-vps.sh
bash .devin/skills/backtest-vs-live-validator/scripts/run-on-vps.sh --user-id=11
bash .devin/skills/backtest-vs-live-validator/scripts/run-on-vps.sh --preset=crash --sample=200
bash .devin/skills/backtest-vs-live-validator/scripts/run-on-vps.sh --json
```

### SSH direct

```bash
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/backtest-vs-live-validator/scripts/validate.mjs /home/ubuntu/data/lio23.db"
```

4. Lire les résultats:
   - **Backtest**: win rate, espérance, profit factor annoncés
   - **Live**: win rate, espérance, profit factor réels
   - **Écart**: différence entre backtest et live pour chaque métrique
   - **Causes possibles**: analyse des écarts (slippage, timing, symboles, confiance)
   - **Verdict**: le backtest est-il fiable?

5. Formuler des recommandations:
   - Si l'écart est < 5%: backtest fiable, continuer
   - Si l'écart est 5-15%: backtest partiellement fiable, ajuster
   - Si l'écart est > 15%: backtest non fiable, investiguer

## Métriques comparées

| Métrique | Backtest | Live | Écart acceptable |
|----------|----------|------|------------------|
| Win rate | annoncé | réel | < 5% |
| Espérance/trade | annoncée | réelle | < 1$ |
| Profit factor | annoncé | réel | < 0.3 |
| Trades/jour | annoncé | réel | < 50% |
| Symboles gagnants | annoncés | réels | cohérence |

## Causes d'écart possibles

1. **Surapprentissage**: le backtest est optimisé sur des données passées qui
   ne se reproduisent pas
2. **Slippage**: différence entre le prix d'entrée du backtest et le prix réel
3. **Spread**: le backtest ne tient pas compte du spread bid/ask
4. **Exécution**: délai entre le signal et l'exécution réelle
5. **Conditions de marché**: volatilité différente entre la période de backtest
   et la période live
6. **Config drift**: la config live a changé depuis le backtest
7. **Échantillon insuffisant**: le live n'a pas assez de trades pour être comparé

## Règles de décision

- Exiger au moins 30 trades live pour qu'une comparaison soit valide.
- Si le backtest n'a pas de date, signaler qu'il est impossible de comparer.
- Comparer sur la même période: les trades live doivent être postérieurs au
  backtest pour qu'une comparaison ait du sens.
- Ne jamais conclure que le bot est "cassé" sur la base d'un écart unique —
  vérifier la cohérence sur plusieurs fenêtres (50, 100, 200 trades).
- Si le live est meilleur que le backtest, ne pas recommander de changements.

## Compte rendu attendu

1. **Métriques backtest**: win rate, espérance, PF, date du backtest
2. **Métriques live**: win rate, espérance, PF, nombre de trades
3. **Tableau de comparaison**: écart pour chaque métrique
4. **Analyse des causes**: 1-3 causes probables de l'écart
5. **Verdict**: fiable / partiellement fiable / non fiable
6. **Recommandations**: ajustements si nécessaire
