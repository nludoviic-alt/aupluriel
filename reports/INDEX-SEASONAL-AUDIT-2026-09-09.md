# Index Seasonal (piste A) — audit, 9 septembre 2026

## Accès

Audit fait en SSH sur le VPS OVH de production (`ubuntu@51.79.70.153`, service `lio23` actif),
lecture de `/home/ubuntu/data/lio23.db` et de `journalctl -u lio23`. Je n'ai pas de tunnel
VPN ; l'audit porte sur l'état réel de la prod et sur les offres Deriv vues par le serveur.
Aucun bot armé, aucune écriture.

## Verdict

**Index Seasonal ne peut pas exprimer l'edge de RESEARCH-A sur Deriv.** Ce n'est pas un bug à
patcher : Deriv ne propose sur les indices OTC ni multiplicateur, ni contrat Rise/Fall assez
long pour tenir la séance. Le scheduler retombe silencieusement sur un binaire **60 min**, or
la recherche dit noir sur blanc que l'effet lundi n'existe pas heure par heure (~52 %).

## État actuel

| Élément | Valeur |
|---|---|
| `idx_seasonal_state.enabled` | **0 — désarmé** depuis 2026-09-07 16:57 UTC |
| Trades idxseasonal en base | 10, tous le lundi 7 sept. |
| Résultat | **−22,96 $** (3 gagnants +12,04 $ / 7 perdants −35,00 $), WR 30 % |
| Durée effective | **60 min sur les 10 trades** (config demandait 240–420 min) |
| Règlement | 10/10 via `expiry` propre, aucun `settle-timeout`, aucun kill-switch |
| Erreurs journal | aucune |

Le bot a donc tourné une seule séance (lundi 7), puis a été désarmé le soir même.

## Cause racine

1. **Pas de hold longue durée sur les indices OTC.** Le ladder de repli
   `[300, 240, 180, 120, 60, 30, 15]` est descendu jusqu'à **60** pour *les 10 symboles*
   (US, Europe, Asie — sessions différentes, même plafond). Corroboré par le preset `default` :
   ses trades binaires sur `OTC_*` plafonnent aussi à 60 min (26 trades à 60, rien au-dessus).
   Deriv accepte l'unité *jour* (`contracts_for` annonce jusqu'à 525 600 min = 365 j) mais un
   contrat en jours dépasse la clôture → « Contract must expire during trading hours ». En
   unité *minute*, le plafond pratique est ~60 min.

2. **60 min ≠ l'edge.** RESEARCH-A : « L'effet n'existe PAS heure par heure (~52 % à chaque
   heure) — il faut tenir toute la séance. » Payout observé 9,01 pour 5,00 de mise →
   seuil de rentabilité = 5,00 / 9,01 ≈ **55,5 % de WR**. Un hold de 60 min tape ~52 %.
   Espérance **structurellement négative**. Les −22,96 $ du lundi 7 ne sont pas de la
   malchance, c'est le régime attendu.

3. **Pas de multiplicateur** sur ces indices (déjà connu, commit #5) — donc pas de
   contournement par une position sans expiration.

## Défauts de code (secondaires — à corriger seulement si la piste est relancée)

| # | Fichier | Problème |
|---|---|---|
| 1 | `idx-seasonal.server.ts:239-245` | `getRiseFallDurationBounds` fusionne les entrées CALL/PUT toutes unités confondues → log trompeur « 15min .. 525600min ». La valeur n'est de toute façon jamais utilisée pour borner la durée réelle. |
| 2 | `idx-seasonal.server.ts:260-287` | La dégradation du ladder est **silencieuse**. Quand le bot entre à 60 min au lieu de 300–420, rien ne le signale (ni log `warn`, ni champ dans `/api/idx-seasonal`, ni bandeau panneau). Le panneau affiche « 60 min » sans dire que c'est hors specs. |
| 3 | `idx-seasonal.server.ts:182-186` | `realizedProfit` lit `getProfitTable(50)` — table **compte entier**, partagée avec crash/boom/vol75/rb100 tous actifs. Un lundi chargé, le contrat idxseasonal peut sortir du top 50 avant lecture → au bout de 30 min `closeTrade(pos, -STAKE_USD, "settle-timeout")` : perte forcée **mal classée**, qui peut faire tomber le kill-switch PF<1. Latent (pas déclenché le 7). Corriger via `proposal_open_contract` par `contract_id`. |
| 4 | `deriv.server.ts:452` | `getMarketState` : symbole inconnu → `{open:true}`. Le WS public (app_id 1089) depuis l'IP du VPS répond « no contract available for this symbol » sur `OTC_NDX`. Le garde-fou marché-ouvert est donc un no-op pour ces symboles ; seule la proposition authentifiée filtre réellement. |
| 5 | `idx-seasonal.server.ts:226,250` | Lundi uniquement + une seule heure d'entrée par symbole, sans rattrapage. Un restart pendant le tick de 5 min de cette heure = symbole sauté pour la semaine. |

## Recommandation

**Ne pas réarmer en l'état.** Cohérent avec le verdict no-edge de septembre et la discipline
de config gelée : la seule anomalie statistique jamais trouvée sur ce projet (l'effet lundi
indices) n'est pas tradable sur Deriv avec les instruments disponibles.

Deux issues seulement :

- **Étagère.** Documenter que piste A est bloquée par l'offre Deriv, retirer le panneau ou le
  passer en « recherche / non exécutable », et se concentrer sur les corrections d'exécution
  CRASH900 / Vol75 déjà priorisées.
- **Changer d'instrument** (si un jour on veut vraiment la piste A) : il faut un CFD indice
  réel ou un contrat « fin de journée » qui tienne l'open→close — donc un autre courtier, pas
  un réglage. Hors périmètre actuel.
