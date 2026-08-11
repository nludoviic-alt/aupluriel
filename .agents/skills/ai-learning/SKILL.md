---
name: ai-learning
description: Contrôle l'apprentissage adaptatif du bot Au Pluriel à partir des statistiques d'indicateurs. Utiliser pour expliquer les poids appris, vérifier leur fiabilité, détecter le surapprentissage, analyser `indicator_stats` ou `/api/learning`, et formuler des recommandations de calibration sans modifier automatiquement les stratégies.
---

# Apprentissage adaptatif

Auditer l'apprentissage existant : les résultats clôturés alimentent `indicator_stats`, puis `src/lib/indicator-weights.server.ts` calcule des multiplicateurs bornés utilisés par l'analyse serveur. Il ne s'agit pas d'un modèle qui prédit le marché.

## Procédure

1. Lire `src/lib/indicator-weights.server.ts`, `src/lib/analyze-opts.server.ts` et `src/routes/api/learning.ts` pour confirmer la source, le lissage, les bornes et le point d'application des poids.
2. Mesurer le volume par composant et symbole : gains, pertes, taux de réussite, ancienneté et part des données démo/réelles lorsqu'elle est disponible.
3. Comparer le poids appris au poids neutre `1`. Un écart ne constitue pas une décision tant que l'échantillon n'est pas suffisant et que le profit factor, l'espérance et le drawdown ne confirment pas l'effet.
4. Rechercher les biais : composant présent dans peu de trades, dépendance à un seul symbole, résultat dominé par une anomalie, mélange de régimes de marché ou fuite de données entre test et validation.
5. Proposer des recommandations, puis les valider en backtest et démo hors échantillon. Une seule dimension à la fois.

## Garde-fous

- Qualifier moins de 30 observations pertinentes comme exploratoire; préférer 100 avant une conclusion forte.
- Séparer démo et réel dans l'interprétation. Ne pas additionner leurs P&L.
- Ne jamais présenter un poids supérieur à 1 comme une preuve de prédiction ou une garantie de gains.
- Ne pas transformer une recommandation en modification automatique de seuils, mise, levier, TP/SL ou liste de symboles sans demande explicite, validation et plan de rollback.
- Pour un changement du moteur ou du schéma, appliquer `production-trading-guardian`; pour une modification de preset, utiliser le skill de tuning concerné.

## Compte rendu

Donner les données d'entraînement, les poids et leur niveau de confiance, les risques de surapprentissage, puis une recommandation classée : ne rien faire, surveiller, tester en démo ou proposer un changement réversible.
