# Piste A — saisonnalité : résultat

**Verdict : il y a un edge. L'effet lundi haussier sur les indices actions.**
Premier signal réellement positif du projet.

## Méthode

- Bougies Deriv (les instruments qu'on tradera), ~1 an, split 50/50 in-sample / out-of-sample.
- Testé : heure du jour (24 buckets), jour de semaine, turn-of-month.
- Sélection : significatif in-sample **puis confirmé out-of-sample**, net de coûts.

## Ce qui ne marche pas

- **Saisonnalité horaire pure (FX + indices)** : 0 bucket. Les biais in-sample s'effondrent en OOS (facteur ~8). Rien d'exploitable.
- **Turn-of-month** : incohérent (IS à plat, OOS +19 %). Pas fiable seul.
- **Jour de semaine sur le FX** : marginal. GBPUSD lundi (+0.09 % OOS, hit 65 %) est le seul à peu près net, trop faible pour porter une stratégie.

## Ce qui marche : LONG indice à l'ouverture du lundi → clôture du lundi

Net d'un coût estimé 0.03 %/trade. `open→close` : pas de risque de gap week-end.

| indice | OOS n | OOS WR | OOS PF | OOS net |
|---|--:|--:|--:|--:|
| OTC_N225 (Nikkei) | 23 | 74 % | 3.49 | +17.4 % |
| OTC_GDAXI (DAX) | 25 | 60 % | 2.91 | +10.6 % |
| OTC_SPC (S&P) | 25 | 56 % | 2.87 | +6.9 % |
| OTC_HSI (Hang Seng) | 24 | 67 % | 2.85 | +7.5 % |
| OTC_NDX (Nasdaq) | 25 | 60 % | 2.37 | +7.9 % |
| OTC_SX5E (Euro Stoxx) | 25 | 64 % | 2.14 | +7.9 % |
| OTC_AS51 (ASX) | 24 | 50 % | 2.13 | +5.3 % |
| OTC_SSMI (SMI) | 24 | 54 % | 1.71 | +4.4 % |
| OTC_DJI (Dow) | 25 | 72 % | 3.59 | +7.7 % |
| OTC_FCHI (CAC) | 25 | 52 % | 1.60 | +4.5 % |

**10 marchés sur 10, tous nets positifs, tous PF OOS > 1.5.** WR agrégé ~60 %, PF OOS ~2.3.

## Pourquoi ce n'est probablement pas du bruit

- **Cohérence transversale** : 10 marchés indépendants (USA, Europe, Japon, HK, Australie) montrent le même biais. Data-mining sur 1 marché → non reproductible ; 10/10 → structurel.
- **Médiane ≈ moyenne** sur NDX/SPC → pas porté par 2 lundis (contraire du piège `crash`). Retirer les 2 meilleurs lundis NDX : +17.4 % restants sur 23 %.
- **Tiers le plus récent encore positif** : NDX +0.35 %, DAX +0.32 %.
- **Rationale connue** : « weekend effect » qui s'est inversé en positif sur les marchés électroniques modernes (flux de rééquilibrage institutionnels, digestion des nouvelles du week-end, biais haussier séculaire). Anomalie publiée, pas une trouvaille.
- L'essentiel du mouvement est **intraday lundi** (open→close +0.40 % NDX, 34/49 positifs), pas le gap → exécutable proprement.

## Caveats à ne pas oublier

1. ~1 an de données, ~25 lundis OOS par indice. La preuve, c'est la cohérence 10/10, pas un échantillon individuel.
2. Anomalie connue → l'edge peut se comprimer. Il tient encore aujourd'hui, à surveiller.
3. **Long-only béta actions** : vulnérable à un vrai marché baissier prolongé (l'effet était négatif dans les années 80-90). → kill-switch obligatoire (PF 4 semaines glissantes < 1 → pause).
4. Backtest = open/close journalier Deriv. Exécution réelle : définir « open » / « close » par indice (chaque bourse a sa session), slippage vs bougie.
5. Pas encore vérifié : conditions de contrat Deriv (durée mini, binaire vs multiplicateur, dispo par session).

## Proposition : preset `idxseasonal`

- **Signal** : chaque lundi, à l'ouverture de session de chaque indice, ouvrir LONG (CALL binaire ~8 h d'expiration, ou multiplicateur x20-x50 avec TP/SL larges).
- **Univers** : les 10 indices ci-dessus (fréquence ~10 trades/semaine).
- **Sortie** : clôture de session du lundi (ou expiration binaire).
- **Kill-switch** : PF glissant 4 semaines < 1.0 → pause auto ; reprise supervisée.
- **Validation** : démo, 200 trades (~20 semaines), critère PF borne basse > 1.3.
- **Mise** : petite et fixe au début (pas de Kelly/adaptatif — on mesure d'abord).

## Turn-of-month — garder en réserve

À re-tester quand on aura plus de données. Pas dans la V1.

---

# Piste B — structure de spike Boom/Crash : DEAD END

**Verdict : pas exploitable.** Confirme la retraite des synthétiques du 1er sept.

- **Structure réelle** : Boom drift baissier −0.11 %/phase + spikes haussiers rares
  (~tous les 1000 ticks BOOM1000, ~500 BOOM500) ; Crash l'inverse. Amplitude spike
  ~0.09 %, soit ~800× un tick normal.
- **Mais le drift compense exactement le spike** — c'est un martingale à EV nulle
  par construction. Deriv conçoit ces instruments comme ça.
- **Capturer le drift** (short Boom pendant la phase calme, sortie avant spike) :
  WR très élevé (78–97 %) mais gain brut minuscule (0.002–0.011 %/trade). Net de
  coût (~0.02 % A/R multiplicateur) : **négatif partout**. Piège « ramasser des
  pièces devant le rouleau compresseur ».
- **Timer le spike** (entrer à ~intervalle médian, attendre le spike) : incohérent
  — BOOM500 +2.4 %, CRASH1000 +0.6 %, mais BOOM1000 −0.7 % et CRASH500 −0.9 % sur
  le même test. 2 positifs / 2 négatifs sur 4 symboles qui devraient être
  identiques → bruit, pas edge. Échantillon minuscule (~11 h de ticks). Et c'est
  le trade le plus évident de la plateforme — Deriv le price.

**Conclusion : on ne construit pas B.** Piste A seule.
