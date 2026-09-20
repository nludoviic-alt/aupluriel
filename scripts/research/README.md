# Test de porte — à passer AVANT de construire une stratégie

Tout est en lecture seule (bougies publiques Deriv / Yahoo, aucun ordre, aucun token).
Lancer depuis un dossier de travail (les scripts lisent/écrivent `<SYMBOLE>-m5.json` dans le dossier courant) avec Node 22.

```bash
node scripts/research/fetch-candles.mjs 1HZ100V            # ~1 an de M5 -> 1HZ100V-m5.json
node scripts/research/premise-test.mjs 1HZ100V             # autocorrélation, variance ratio, ratio ATR
node scripts/research/gate-pullback.mjs 1HZ100V-m5.json 40 # pullback/flip, optimisation 70 % / validation 30 % + témoin nul (40 séries)
node scripts/research/gate-breakout.mjs 1HZ100V-m5.json 40 # cassure Donchian, même protocole
SWAP_L=6.03 SWAP_S=1.79 node scripts/research/trend-diversified.mjs  # tendance diversifiée, swap % annuel (long payé / short reçu)
node scripts/research/monday-effect-long.mjs               # effet lundi open->close, 10 indices, 2000-2026 (Yahoo)
```

## Règle du jeu

1. Le postulat doit tenir (`premise-test`) : sans autocorrélation, pas de stratégie de tendance.
2. L'optimisation se fait sur 70 % des données ; la validation (30 %) ne sert jamais à choisir.
3. Le résultat réel est comparé à un **témoin nul** (séries sans dépendance, même optimisation) :
   une espérance en échantillon sous le p95 du hasard n'est pas un signal.
4. Toujours tester avec les **coûts réels** (spread + swap). Sur Deriv MT5 Standard le swap long est de
   ~6 %/an du notionnel (compte Swap-Free : frais d'administration équivalents après 15 jours).

## Résultats de la session du 2026-09-20

| Cible | Verdict |
|---|---|
| V75, R_100, 1HZ100V, Step Index | Aucun edge net après coûts (volatilité constante, pas de tendance) |
| Tendance diversifiée (15 marchés) | Sharpe 0,65 sans coûts de financement ; 0,22 avec le swap MT5 Standard |
| Effet lundi (Nasdaq 100, S&P 500) | Positif depuis 2020 seulement ; exécutable en intraday sur MT5 (pas de swap) — en suivi |
