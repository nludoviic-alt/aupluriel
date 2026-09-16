# Plan — bascule vers les Multiplicateurs Deriv sur instruments réels

**Date :** 2026-09-07
**Auteur :** Claude (à valider par Ludovic avant toute exécution)
**Statut :** BROUILLON — rien n'est lancé tant que ce fichier n'est pas approuvé.

Ce plan fait suite à [DECISION-2026-09-03.md](DECISION-2026-09-03.md) (« on arrête
l'optimisation P&L »). Il ne l'annule pas : il propose **une piste
catégoriquement différente**, avec des garde-fous plus stricts que tout ce qui a
été fait jusqu'ici. Si tu l'approuves, c'est une nouvelle décision qui remplace
la clause d'arrêt du 3 septembre.

---

## 1. Constat de départ (court)

Tout ce qui a été testé depuis juillet — synthétiques Boom/Crash/Vol75, forex
binaire, Index Seasonal — partage **une seule structure de pari** :

> contrat **binaire** (CALL/PUT à échéance fixe) → gain ≈ +0,85–0,90 × mise,
> perte = −1,00 × mise.

Cette asymétrie impose un taux de réussite directionnel **> 53–55 %, soutenu**.
Aucun moteur de signal du dépôt ne l'atteint durablement (audit 30 j : PF 0,71,
espérance −0,55 $/trade). Ce n'est pas un problème de réglage, c'est la
structure du produit.

**Le multiplicateur Deriv (`MULTUP`/`MULTDOWN`) est un produit différent :**

| | Binaire (testé 4×) | Multiplicateur (jamais testé sur réels) |
|---|---|---|
| Gain | +0,85 × mise (plafonné) | mise × multi × Δ% prix (non plafonné) |
| Perte | −1,00 × mise | mise × multi × Δ% prix, bornée par le stop-out |
| Sortie | échéance fixe imposée | libre : TP/SL absolus, ou vente manuelle, pas d'expiration |
| Coût | asymétrie de payout (avantage maison structurel) | commission **symétrique** (% de mise×multi) + frais overnight |
| Seuil de rentabilité | réussite > ~53–55 % | **un edge modeste (réussite 51–52 % OU ratio gain/perte > 1) suffit** |

Code déjà présent : `proposeAndBuyMultiplier()` dans
[src/lib/deriv.server.ts:775](src/lib/deriv.server.ts) — validation → proposal →
buy, avec `limit_order` (stop_loss / take_profit en montants absolus). L'échec de
septembre (`"Multiplier is not in acceptable range. Accepts 100,200,300,500,800"`)
était **un bug de config** (on envoyait x10, invalide) — pas un refus du produit.

**Ce que ça ne résout pas :** il faut toujours un edge réel. Le multiplicateur
ne crée pas d'edge, il **abaisse le seuil à partir duquel un edge devient
rentable**. C'est toute la différence entre « mathématiquement impossible » et
« difficile mais possible ».

---

## 2. Hypothèse à tester (falsifiable, écrite AVANT les résultats)

> Au moins un des moteurs de signal existants (`confluence`, `scalping`
> structurel, `liquidity-sweep`), évalué avec un **modèle de coût
> multiplicateur réaliste** sur des instruments réels (forex majors, indices
> OTC, or), présente une espérance positive **hors échantillon** ; et cet edge
> se confirme sur un échantillon de trades démo Deriv fixé à l'avance.

Réfutation : si Phase 0 ou Phase 1 ne sort aucun moteur avec espérance OOS > 0
après coûts, OU si l'essai démo (Phase 2) donne PF < 1,0 sur l'échantillon
engagé → l'hypothèse est fausse, on applique la clause d'arrêt du 3 septembre
(le projet reste un livrable d'ingénierie).

---

## 3. Règles qui NE changent pas

1. **Une seule piste à la fois.** Pas de test parallèle de 3 presets.
2. **Taille d'échantillon fixée AVANT de lancer** chaque essai. Jamais
   redimensionnée après avoir vu les résultats.
3. **Aucune retouche de paramètre sur un moteur déjà éliminé.** S'il échoue, on
   passe au suivant, on ne le « re-tune » pas.
4. **Validation hors échantillon obligatoire** (walk-forward) avant toute
   démo. Un chiffre en échantillon seul ne compte pas.
5. **Démo → argent réel** seulement après un verdict démo positif documenté.
6. **La table `config_changes` reste la source de vérité** des modifications ;
   chaque changement de config de production y est journalisé.
7. **Backup DB avant chaque déploiement** (procédure `production-trading-guardian`).
8. **Argent réel : mise minimale, montée en taille par paliers** conditionnés à
   des résultats, jamais d'un coup.

---

## 4. Ce que je NE ferai PAS

- Pas d'objectif « 90 % de win rate ».
- Pas de nouveau moteur de signal inventé de zéro (on teste l'existant d'abord).
- Pas de balayage de paramètres appliqué en prod sans walk-forward.
- Pas de MT5 / terminal Windows / serveur supplémentaire (hors périmètre : tu
  n'as ni cloud ni serveur local pour ça).
- Pas de crypto / Binance / Bybit (hors de ta contrainte broker Europe+Afrique).
- Pas de réactivation des bots binaires existants.
- Pas de déploiement pendant une session de marché ouverte sans backup + fenêtre
  calme.

---

## 5. Phases

### Phase 0 — Modèle de coût multiplicateur exact + re-scoring hors-ligne

**Objectif :** savoir si un edge existe AVANT de trader quoi que ce soit, même
en démo.

**Aucune connexion de trading. Lecture seule. Données historiques uniquement.**

Tâches :

0.1 **Récupérer les specs multiplicateur réelles de Deriv** (via l'API
`contracts_for` sur un compte démo, en lecture) pour chaque symbole candidat :
   - multiplicateurs autorisés (100/200/300/500/800… variables selon symbole) ;
   - **commission** exacte (Deriv la facture en % de mise×multiplicateur à
     l'entrée — c'est LE coût qui manque à tous les backtests précédents) ;
   - frais overnight / de détention (« swap » multiplicateur) et heure de coupe ;
   - niveau de stop-out ;
   - montant de mise minimum par symbole.
   → livrable : `docs/deriv-multiplier-specs.json` + note lisible.

0.2 **Ajouter un modèle de coût au simulateur** du tournoi
   ([.claude/skills/strategy-tournament/scripts/tournament.ts](.claude/skills/strategy-tournament/scripts/tournament.ts),
   fonction `simulateCombo` / `simulateComboStructural`) :
   - déduire la commission d'entrée (et de sortie si applicable) de chaque trade ;
   - déduire les frais overnight au prorata du temps de détention ;
   - vérifier le déclenchement du stop-out sur le chemin de prix.
   → aujourd'hui Track B simule mise×levier + stop/cible **sans aucun coût par
     trade** : c'est optimiste, c'est le point à corriger.

0.3 **Étendre le tournoi aux instruments réels** en mode multiplicateur
   (actuellement Track B est pensé pour les synthétiques). Vérifier que la
   source de bougies (`historical_candles` + fetch Deriv) couvre bien
   `frxEURUSD`, `frxGBPUSD`, `frxUSDJPY`, `frxAUDUSD`, `frxUSDCAD`, `frxXAUUSD`,
   `OTC_NDX`, `OTC_SPC`, `OTC_DJI` sur une fenêtre suffisante (≥ 60 jours de
   5-min si possible, sinon documenter la limite).

**Porte de sortie Phase 0 (GO / NO-GO) :**
- GO si le modèle de coût est en place, validé sur 2–3 trades réels connus
  (comparer P&L simulé vs P&L réel d'anciens trades multiplicateur en base), et
  que les données réelles sont disponibles.
- NO-GO si les données réelles sont trop courtes pour un walk-forward honnête →
  on documente et on s'arrête là (ou on se rabat sur la Phase de repli cTrader).

**Effort estimé :** 1 à 2 jours.

---

### Phase 1 — Tournoi multiplicateur sur instruments réels + walk-forward

**Objectif :** classer les moteurs existants sur données réelles, avec coûts,
hors échantillon.

Tâches :

1.1 Lancer le tournoi corrigé, mode multiplicateur, sur les 9 symboles réels,
   grille de combos `--quick` d'abord, puis grille complète sur les 2–3
   meilleurs (moteur × symbole).

1.2 **Walk-forward obligatoire** (`--walkforward --folds=3` minimum, 4 si les
   données le permettent). Le résultat qui compte = total OOS après coûts.
   Reporter le « Gap » (promesse en échantillon − réalité OOS).

1.3 Analyser par **profit factor** et **espérance $/trade**, jamais par win
   rate seul. Écarter tout couple (moteur, symbole) sous 30 trades OOS
   (exploratoire).

1.4 Produire un tableau de décision : pour chaque moteur, sur chaque symbole —
   trades OOS, P&L OOS après coûts, PF OOS, Gap, verdict.

**Porte de sortie Phase 1 (GO / NO-GO) :**
- GO si **au moins un** couple (moteur, symbole) a : ≥ 30 trades OOS, PF OOS
  ≥ 1,15, espérance OOS > 0 après coûts, et Gap raisonnable (< ~40 % de la
  promesse en échantillon).
- NO-GO sinon → **clause d'arrêt du 3 septembre appliquée.** On documente que
  le multiplicateur ne sauve pas un edge inexistant, et le projet reste un
  livrable d'ingénierie.

**Effort estimé :** 1 jour de calcul + analyse.

---

### Phase 2 — Essai démo Deriv (multiplicateur, mise minimale)

**Objectif :** confirmer en direct ce que le backtest promet. C'est l'étape
qui a toujours manqué (« Bon Jour Crash » : bon en backtest, jamais revalidé
en aveugle).

Pré-requis : Phase 1 = GO, backup DB pris, fenêtre de déploiement calme.

Tâches :

2.1 Configurer **un seul** slot de preset (celui qui correspond au moteur
   gagnant — ex. `default`/confluence, `scalping`/structurel) sur le compte
   admin (user 2) **uniquement** :
   - `instrumentType: "multiplier"`, `broker: "deriv"`, `mode: "demo"` ;
   - multiplicateur = valeur valide la plus basse pour le symbole (souvent 100) ;
   - **mise minimale** ($1, ou le minimum du symbole) ;
   - symbole(s) = uniquement le(s) gagnant(s) de Phase 1 ;
   - TP/SL absolus dérivés du ratio gain/perte validé en Phase 1 ;
   - garde-fous : `maxDailyLossUsd` serré, `maxConsecutiveLosses` 3–4,
     `maxTradesPerDay` cohérent avec la fréquence observée en backtest ;
   - `tradingSessions` alignées sur la fenêtre où l'edge existe (Phase 1 le dira).
   - Config écrite en **SQL brut + restart** (jamais `updateConfigForUser` — il
     cross-écrit tous les autres users, cf. [DEPLOY.md](DEPLOY.md) / mémoire projet).

2.2 **Taille d'échantillon fixée maintenant : 50 trades résolus.** Une seule
   extension possible à 100 si le PF atterrit dans la zone ambiguë 1,0–1,2.
   Aucune décision avant 50 trades.

2.3 Watchdog de surveillance (comme `trial-watch.sh` déjà utilisé) : e-mail à
   chaque alarme, tally toutes les 3 h, réconciliation des orphelins,
   **ne touche jamais à la config**.

2.4 Comparer promesse backtest vs réalité live avec la méthodo
   `backtest-vs-live-validator` (seuils déjà définis, ne pas réinventer).

**Porte de sortie Phase 2 (GO / NO-GO) :**
- GO si sur l'échantillon engagé : **PF ≥ 1,2 ET espérance > 0** après coûts
  réels démo.
- ZONE GRISE (PF 1,0–1,2) : une seule extension à 100 trades, même critère.
- NO-GO si PF < 1,0 → moteur éliminé. Si un autre moteur avait passé la
  Phase 1, on le teste (retour 2.1). Sinon → clause d'arrêt.

**Durée calendaire estimée :** 1 à 2 semaines pour 50 trades (dépend de la
fréquence du moteur ; le backtest Phase 1 donnera une estimation trades/jour).

---

### Phase 3 — Observation étendue démo

**Objectif :** vérifier la stabilité hors de la fenêtre d'essai initiale
(régimes de marché différents, semaine complète, événements macro).

Tâches :

3.1 Laisser tourner la même config démo, **inchangée**, 2 semaines
   supplémentaires (≈ 100–200 trades de plus).

3.2 Suivre la dérive : PF glissant 20 / 50 / 100, drawdown max, comportement
   pendant les news, comportement pendant les heures creuses.

3.3 Vérifier les mécanismes d'exécution : taux de `error` / `cooldown` /
   `risk-stop` sur les signaux (l'audit du 3 sept montrait 59 % de déchet —
   ça doit être < 10 % pour que les chiffres soient fiables).

**Porte de sortie Phase 3 (GO / NO-GO) :**
- GO si PF reste ≥ 1,15 sur la période étendue ET taux d'échec d'exécution
  < 10 % ET drawdown max acceptable (< ~15 % du capital simulé).
- NO-GO si l'edge se dégrade (PF < 1,0 sur les 50 derniers) → élimination,
  retour Phase 1 ou clause d'arrêt.

**Durée calendaire :** ~2 semaines.

---

### Phase 4 — Argent réel, montée en taille par paliers

**Objectif :** transposer au réel sans exposer un capital significatif à un
edge encore fragile.

Pré-requis : Phases 2 et 3 = GO documentés. **Décision explicite de Ludovic**
de passer au réel (montant, broker, compte).

Paliers (chacun conditionné au précédent) :

| Palier | Capital exposé | Mise | Critère de passage au palier suivant |
|---|---|---|---|
| P4.0 | compte réel financé, **bot à l'arrêt** | — | virement effectué, KYC OK, API réelle testée en lecture |
| P4.1 | mise minimale réelle ($1) | min | 50 trades réels, PF ≥ 1,1, exécution < 10 % d'échec |
| P4.2 | mise ×2–3 | petite | 100 trades réels cumulés, PF ≥ 1,15, espérance > 0 |
| P4.3 | montée progressive (Kelly fractionné ≤ 0,25, ou palier fixe) | modérée | revue mensuelle : PF ≥ 1,15 sur 200 trades glissants |

**Critère d'arrêt réel (tripwire, non négociable) :**
- drawdown réel > 20 % du capital du palier → arrêt, retour en démo ;
- PF réel < 0,9 sur 50 trades → arrêt, moteur éliminé ;
- 3 jours consécutifs à la perte max journalière → pause 1 semaine + revue.

---

## 6. Calendrier et articulation avec la deadline du 1er octobre

[DECISION-2026-09-03.md](DECISION-2026-09-03.md) fixe un **verdict dur au
2026-10-01**. Aujourd'hui = 2026-09-07. Articulation proposée :

| Période | Phase |
|---|---|
| ~7–12 sept | Phase 0 (modèle de coût + données) |
| ~12–14 sept | Phase 1 (tournoi + walk-forward) → **1ère porte GO/NO-GO** |
| ~15–26 sept | Phase 2 (essai démo, 50 trades) |
| ~26 sept – 1 oct | Analyse Phase 2 → **verdict du 1er octobre = résultat démo** |
| après 1 oct | Phase 3 (si GO), puis Phase 4 (argent réel) sur ta décision |

Donc : **aucun argent réel avant le 1er octobre.** Le 1er octobre, la décision
n'est plus « on arrête ou pas dans le vide » mais « les chiffres démo
multiplicateur sont-ils positifs, oui ou non ». Si tu veux décaler la deadline
pour laisser Phase 3 se dérouler avant le go/no-go réel, c'est un point à
trancher maintenant (voir §9).

---

## 7. Risques et inconnues

1. **Données réelles trop courtes.** `historical_candles` pourrait ne pas
   couvrir 60 j de 5-min sur tous les symboles → walk-forward moins robuste.
   Mitigation : backfill via l'API Deriv en Phase 0 ; sinon réduire le nombre
   de symboles et le documenter.
2. **Commission multiplicateur plus lourde que prévu.** Deriv facture une
   commission non triviale ; sur des mouvements intraday petits, elle peut
   manger tout l'edge. C'est précisément ce que Phase 0 doit chiffrer — et
   c'est un résultat valide en soi (« pas rentable après coûts »).
3. **Frais overnight.** Si le moteur gagnant tient des positions > 1 jour, le
   swap multiplicateur peut être punitif. Mitigation : privilégier les moteurs
   intraday, modéliser le swap explicitement.
4. **L'edge backtest ne survit pas au live** (déjà vu). C'est exactement ce que
   Phase 2 teste ; le risque est géré par la mise minimale et l'échantillon
   fixé d'avance.
5. **Exécution cassée** (auth Deriv, préparation d'ordre). L'audit du 3 sept
   montrait 59 % de déchet. Le retry OTP (PR #1) en a corrigé une partie ;
   Phase 3 vérifie que le taux est retombé < 10 %. Si non → travail
   d'exécution avant tout passage au réel.
6. **`getMarketState` inerte** (le socket public renvoie `active_symbols`
   vide) — le garde-fou calendrier ne bloque pas réellement. À réparer si on
   trade des instruments avec heures d'ouverture (indices) — sinon risque de
   trades hors séance rejetés.
7. **Régime de marché.** Un edge validé en septembre peut disparaître en
   octobre. D'où Phase 3 (observation étendue) et la revue mensuelle en P4.3.
8. **Odds globales.** Estimation honnête : ~25–35 % de chance qu'un moteur
   existant passe toutes les portes jusqu'à la Phase 3. Le plan est conçu pour
   que le coût d'un échec soit du temps de calcul, pas de l'argent.

---

## 8. Livrables par phase (ce que tu pourras analyser)

- **Phase 0 :** `docs/deriv-multiplier-specs.json` + note ; patch du simulateur
  (diff lisible) ; validation coût simulé vs réel sur trades connus.
- **Phase 1 :** tableau de décision (moteur × symbole × trades/PF/P&L OOS/Gap/
  verdict) ; recommandation du/des moteur(s) à essayer.
- **Phase 2 :** config démo exacte déployée (SQL) ; backup DB ; suivi live vs
  backtest ; verdict sur l'échantillon engagé.
- **Phase 3 :** rapport de stabilité (PF glissant, drawdown, taux d'exécution).
- **Phase 4 :** plan de paliers chiffré au capital réel que tu auras décidé.

Chaque porte GO/NO-GO fait l'objet d'une note écrite **avant** de regarder la
suite, et attend ton feu vert.

---

## 9. Points de décision pour toi (à trancher avant que je lance quoi que ce soit)

1. **Tu valides l'approche multiplicateur** comme nouvelle piste (remplace la
   clause d'arrêt du 3 sept par ce plan) ? oui / non
2. **Deadline du 1er octobre :** on la garde comme date du verdict démo
   (Phase 2), ou on la décale à ~15 octobre pour inclure Phase 3 avant tout
   go/no-go réel ?
3. **Périmètre symboles :** forex majors + indices OTC + or, ou tu veux
   restreindre (ex. forex seulement, ou or seulement) ?
4. **Broker réel cible** (pour Phase 4, pas maintenant) : Deriv en réel, ou tu
   veux que j'évalue aussi Exness via cTrader Open API en parallèle comme repli ?
5. **Compte d'essai :** on reste sur le compte admin user 2 en démo, ou tu veux
   un compte démo Deriv dédié à cet essai (plus propre pour isoler les
   statistiques) ?
6. **Rythme de reporting :** note à chaque porte de phase seulement, ou point
   d'étape tous les X jours ?

---

## 10. Repli si NO-GO en Phase 1 (multiplicateur Deriv insuffisant)

Si le multiplicateur Deriv ne dégage aucun edge après coûts, l'option
technique suivante — sans MT5, sans serveur en plus — est le **cTrader Open
API** (Exness ou autre broker cTrader Europe+Afrique) :
- API cloud OAuth2 + protobuf, **pas de terminal de bureau** ;
- vrais CFD ECN, spreads bruts + commission (encore plus symétrique que le
  multiplicateur Deriv) ;
- tourne comme un adaptateur broker dans l'app Node existante sur le VPS OVH ;
- coût : nouvel adaptateur broker (~3–5 j) + compte cTrader démo.

Ce n'est pas dans le périmètre de ce plan — c'est la porte de sortie n°2 si la
porte n°1 se ferme. À décider à ce moment-là, pas avant.

---

## 11. Ce qui a déjà été fait aujourd'hui (2026-09-07)

- Analyse VPS complète : infra saine, service up 3 j, 0 restart, disque 19 %,
  cert 36 j, `better-sqlite3` = binaire Linux OK.
- **Index Seasonal coupé** (`idx_seasonal_state.enabled = 0`, backup
  `lio23.db.backup-20260907-*-pre-idxseasonal-off`) — il perdait −58 $ démo en
  14 j (3 gagnants / 10), hors de tout plan validé. Aucune position ouverte.
- Bots principaux : toujours à l'arrêt (`bot_state.enabled = 0` pour les 7
  users), conforme au 3 septembre.
- Housekeeping VPS relevé, non traité : reboot noyau en attente, 38 paquets à
  jour, erreur `alerts.title` (stoppée depuis le 1er sept), `auto-backtest`
  qui renvoie 0 trade à chaque run, cert mort `lio23.com` encore renouvelé.
