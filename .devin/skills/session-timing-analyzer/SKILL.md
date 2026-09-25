---
name: session-timing-analyzer
description: Analyse quelles heures/sessions de trading sont les plus rentables historiquement (London, New York, Asia) et recommande d'activer/désactiver le bot selon l'heure. Utiliser quand l'utilisateur demande "à quelle heure trader", "quelles sont les meilleures sessions", "le bot devrait-il tourner la nuit", ou pour optimiser le timing.
triggers:
  - user
  - model
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Session Timing Analyzer — Optimisation des plages horaires

Analyser l'historique des trades par heure et par session de marché pour
identifier les plages horaires les plus rentables et recommander des fenêtres
de trading optimales.

## Procédure — EXCLUSIVEMENT SUR VPS

**RÈGLE ABSOLUE**: Ce skill tourne TOUJOURS sur le VPS, JAMAIS en local.

### Wrapper local (recommandé)

```bash
bash .devin/skills/session-timing-analyzer/scripts/run-on-vps.sh
bash .devin/skills/session-timing-analyzer/scripts/run-on-vps.sh --user-id=11
bash .devin/skills/session-timing-analyzer/scripts/run-on-vps.sh --mode=live --preset=crash
bash .devin/skills/session-timing-analyzer/scripts/run-on-vps.sh --json
```

### SSH direct

```bash
ssh ubuntu@51.79.70.153 "cd /home/ubuntu/app && node .devin/skills/session-timing-analyzer/scripts/timing-analyze.mjs /home/ubuntu/data/lio23.db"
```

3. Lire les résultats:
   - **Par heure UTC**: P&L, win rate, trades pour chaque heure de la journée
   - **Par session**: Asia (00-08 UTC), London (08-16 UTC), New York (13-21 UTC)
   - **Par jour de la semaine**: quels jours sont les plus rentables
   - **Heatmap heure × jour**: les meilleures combinaisons
   - **Fenêtres recommandées**: heures à activer/désactiver

4. Formuler des recommandations:
   - **Activer**: heures avec P&L positif et échantillon suffisant (≥20 trades)
   - **Désactiver**: heures avec P&L négatif et échantillon suffisant
   - **Surveiller**: heures avec échantillon insuffisant

## Sessions de marché

| Session | Heures UTC | Caractéristiques |
|---------|-----------|------------------|
| Asia | 00:00 - 08:00 | Faible volatilité, sauf BOOM/CRASH |
| London | 08:00 - 16:00 | Haute volatilité, forex actif |
| New York | 13:00 - 21:00 | Chevauchement London/NY = pic de volatilité |
| Off-hours | 21:00 - 00:00 | Faible liquidité, spreads larges |

## Règles de décision

- Exiger au moins 20 trades par heure pour qu'une recommandation soit fiable.
- Ne jamais recommander de trader pendant les heures avec un profit factor < 0.8.
- Considérer le type de symbole: BOOM/CRASH peuvent performer en session Asia
  (synthétique, pas de session de marché réel).
- Forex (frxEURUSD etc.) performe mieux pendant le chevauchement London/NY.
- Vérifier la cohérence: une heure rentable sur 7 jours doit l'être sur 30 jours aussi.
- Les symboles OTC ont leurs propres patterns — les analyser séparément.

## Compte rendu attendu

1. **Tableau par heure**: P&L, win rate, trades, profit factor pour chaque heure
2. **Tableau par session**: résumé Asia/London/NY/Off-hours
3. **Tableau par jour de semaine**: quels jours sont les plus/moins rentables
4. **Heatmap**: top 5 et bottom 5 combinaisons heure × jour
5. **Fenêtres recommandées**: heures à activer et heures à désactiver
6. **Recommandations par type de symbole**: forex vs BOOM/CRASH vs OTC
