---
name: strategy-tournament
description: Compare plusieurs logiques de signal RÉELLEMENT différentes (confluence multi-TF, retournement de liquidité/SMC, price-action scalping, Spike Hunter) sur le même symbole et la même fenêtre — pas des variantes de seuils d'une seule stratégie. Utiliser quand l'utilisateur demande de tester plusieurs stratégies pour un marché (or, synthétiques Boom/Crash...), de comparer des approches de trading différentes, ou de décider laquelle adopter avant de la déployer en démo.
---

# Tournoi multi-stratégies

Compare 3 à 4 moteurs de signal déjà existants dans le code (pas de nouvelle
théorie de trading inventée) sur un symbole donné, en lecture seule, sans
toucher à la production. Corrige le piège qu'a déjà montré ce bot : une
stratégie retouchée sans fin au lieu d'être comparée à des alternatives
vraiment différentes, et un backtest jamais confirmé en direct avant d'être
appliqué (le scalping revendique PF 1.79 en backtest ponctuel ; la prod
réelle montre -$3.14 sur 36 trades — le backtest seul ne suffit jamais).

## Procédure

```bash
# Or — 3 moteurs en mode binaire à échéance fixe (Track A)
npx tsx .Codex/skills/strategy-tournament/scripts/tournament.ts --market=gold [--symbols=frxXAUUSD] [--candles=300] [--duration=15] [--quick]

# Synthétiques — 4 moteurs en mode Multiplier, marche-avant (Track B)
npx tsx .Codex/skills/strategy-tournament/scripts/tournament.ts --market=synthetics [--symbols=BOOM500,CRASH900,BOOM1000,CRASH1000] [--candles=250] [--hold=60] [--stake=5] [--leverage=20] [--quick]

# + validation hors échantillon (walk-forward) — Track B seulement
npx tsx .Codex/skills/strategy-tournament/scripts/tournament.ts --market=synthetics --walkforward [--folds=3] [mêmes options que ci-dessus]
```

`--quick` réduit la grille de combos testée (plus rapide, moins exhaustif) —
commencer par ça, surtout sur `synthetics` qui compare 4 moteurs × plusieurs
symboles × une grille de combos.

## `--walkforward` — la partie qui manquait

Sans ce drapeau, le tournoi reporte un chiffre **en échantillon** : le meilleur
combo, choisi et noté sur LA MÊME fenêtre de données. Ce chiffre est toujours
optimiste — c'est exactement le mécanisme qui a produit "Bon Jour Crash" (bon
sur 7 jours de backtest, jamais revalidé en aveugle avant d'être déployé à 10x
la mise).

`--walkforward` découpe la fenêtre en `--folds` tranches chronologiques
(3 par défaut). Pour chaque tranche (sauf la première), le meilleur combo est
choisi en ne regardant QUE les tranches précédentes, puis noté sur la tranche
suivante — qu'il n'a jamais vue. Le total de ces notes "hors échantillon"
(OOS) est le vrai résultat ; le "Gap" affiché = ce que l'échantillon complet
promettait moins ce que le hors-échantillon a réellement donné. Un grand écart
positif = le chiffre en échantillon était surtout du bruit ajusté après coup,
pas une edge réelle.

Premier run réel (BOOM500+CRASH900, 200 bougies, 3 tranches) :

| Moteur | OOS Trades | OOS P&L | En échantillon | Écart |
|---|---:|---:|---:|---:|
| scalping (structural) | 96 | +$19.49 | +$30.49 | +$11 (edge réelle, un peu gonflée en échantillon) |
| confluence | 185 | -$0.05 | -$1.53 | quasi nul (cohérent, mais cohérent autour de zéro) |
| liquidity-sweep | 13 | -$0.68 | -$0.31 | trop peu de trades pour conclure |
| spike-hunter | 93 | -$4.85 | -$7.33 | négatif des deux côtés — pas juste du bruit, vraiment pas d'edge seul |

C'est la confirmation que le scalping structurel n'est pas un artefact de
fenêtre unique — même testé sur des données qu'il n'a jamais vues au moment de
choisir ses seuils, il reste net positif.

N'utiliser que sur Track B (`synthetics`) pour l'instant — Track A (`gold`)
reste en fenêtre unique, les fonctions de backtest binaire n'exposent pas
encore les entrées individuelles nécessaires au découpage par tranches.

## Les deux volets — ne jamais les fusionner

- **Track A (`--market=gold`)** : contrats binaires CALL/PUT à échéance fixe.
  Résultat en **points d'edge au-dessus du seuil de rentabilité** (win rate -
  breakeven). `scalping-direction-only` n'exerce PAS son stop structurel dans
  ce mode — seule sa direction est jugée à échéance fixe, ce n'est donc pas
  une mesure de son edge réel.
- **Track B (`--market=synthetics`)** : positions Multiplier avec stop/target,
  jugées en marche-avant candle par candle (touche le stop ou la cible en
  premier). Résultat en **$ P&L** à une mise/effet de levier donnés — les deux
  volets ne sont jamais comparables entre eux (unités différentes).

## Ce que chaque moteur mesure vraiment

- **confluence** : la logique déjà utilisée par Multi/Boom/Crash (RSI/MACD/EMA/ADX multi-TF).
- **liquidity-sweep** : la logique du preset "liquidity" (balayage M15 + retour dans le range + RSI).
- **scalping** : stop/cible structurels (dernier plus haut/bas), RR fixe 1.5 — mesuré fidèlement seulement en Track B.
- **spike-hunter (standalone)** : mesure ce moteur comme s'il tradait CHAQUE setup qualifié — en production il ne sert qu'en filet de secours quand la confluence est faible (<75%) sur Boom/Crash. Son chiffre ici n'est PAS sa contribution live actuelle, seulement son edge propre s'il tradait seul. Ne jamais présenter ce chiffre comme "ce que Spike Hunter rapporte aujourd'hui."

## Règles de décision

- Moins de 30 trades pour un (moteur, symbole) = exploratoire, ne pas conclure.
- Comparer sur le profit factor / edge en points, jamais sur le seul win rate (Boom a 71.3% de réussite en prod et perd quand même de l'argent — le win rate seul ment).
- "0 trade" pour un combo veut dire qu'aucun signal n'a jamais qualifié sur cette fenêtre à ce seuil — pas la même chose que "testé et perdant." Vérifier avant de conclure à l'absence d'edge.
- Un bon résultat ici est une candidature à un essai en démo (Phase 2), jamais une promotion directe vers un stake réel ou vers le live.

## Après le tournoi — passage en essai réel

1. Choisir le(s) moteur(s) les mieux classés par marché.
2. Les essayer en démo, mise minimale ($1), sur le slot de preset existant
   pertinent (ex. `liquidity` pour tester le SMC sur l'or, `scalping` pour
   tester une logique structurelle sur les synthétiques).
3. Fixer la taille d'échantillon AVANT de lancer l'essai (50 trades, extension
   unique à 100 si zone ambiguë PF 1.0-1.2) — ne jamais choisir la taille
   après avoir regardé les résultats.
4. Comparer la promesse du backtest à la réalité live avec
   `.devin/skills/backtest-vs-live-validator` (méthodologie déjà écrite,
   seuils déjà définis — ne pas la réinventer).
5. Décider : garder (PF ≥ 1.2 ET espérance positive sur l'échantillon
   engagé) ou éliminer et documenter pourquoi (PF < 1.0 OU espérance ≤ 0) —
   pas de réglage supplémentaire sur un moteur déjà éliminé, on en teste un
   autre à la place.

## Ce qu'on rejette explicitement

Pas d'objectif "90% de win rate" (voir `.devin/skills/adaptive-trading-optimizer`
— objectif dangereux ici, le payout binaire découple win rate et rentabilité).
Pas de balayage de paramètres appliqué directement sans validation hors
échantillon — c'est exactement le mécanisme qui a produit "Bon Jour Crash" et
"Best Day Boom", deux stratégies dégradées depuis pour être des artefacts
d'une bonne fenêtre historique plutôt qu'une edge réelle.
