# Audit des presets et reconstitution Scalping — 13 septembre 2026

Audit SQLite de production en lecture seule, utilisateur 2, résultats Démo uniquement (`NULL` historique traité Démo). Positions ouvertes/pending : zéro au contrôle. Aucun achat, changement de configuration ou déploiement effectué pendant cet audit. Scalping reste désactivé.

## Dernières clôtures par preset

Fenêtre : jusqu'à 50 dernières clôtures par preset, pas 50 trades depuis le dernier déploiement. Les historiques mélangent parfois plusieurs versions/configurations : ils évaluent le passé enregistré, pas la performance de la version actuellement déployée.

| Preset | Nombre | P&L USD | Profit factor | Drawdown cumulé USD | Dernière entrée UTC | Décision proposée |
|---|---:|---:|---:|---:|---|---|
| Boom | 50 | -32,65 | 0,492 | 38,65 | 12 août | Maintenir la protection ; suspension explicite à envisager |
| Multi/default | 50 | -197,09 | 0,559 | 367,59 | 2 septembre | Maintenir la protection ; suspension explicite à envisager |
| Crash | 50 | -7,06 | 0,891 | 13,36 | 17 août | Observation sans promotion |
| Crash500 | 30 | -9,42 | 0,529 | 12,48 | 12 août | Observation sans promotion |
| Vol75 | 50 | -70,83 | 0,616 | 94,21 | 26 août | Maintenir la protection ; suspension explicite à envisager |
| Vol50 | 14 | -7,45 | 0,453 | 8,38 | 13 août | Insuffisant, défavorable ; pas de reprise validée |
| RB100 | 50 | -1,22 | 0,712 | 2,60 | 20 août | Pas d'avantage démontré |
| Scalping | 10 | -6,54 | 0,071 | 6,54 | 13 septembre | Maintenir arrêté |

Un PF inférieur à 1 signifie que les gains bruts ne couvrent pas les pertes brutes. Le drawdown est celui du P&L réalisé cumulé, sans pertes flottantes intra-trade. Le faible montant de perte de RB100 ne prouve pas sa rentabilité. Vol50 et Scalping sont sous 30 observations.

L'ensemble historique de Crash est positif (+136,22 USD, 365 trades, PF 1,193), comme Vol75 (+48,97 USD, 111 trades, PF 1,072), mais leurs dernières fenêtres sont négatives. Aucun des huit presets ne présente un PF supérieur à 1 sur la fenêtre du tableau. Les sept presets autres que Scalping restent activés en Démo ; les protections et modes d'observation observés précédemment ne sont pas une certification de rentabilité. Les autres presets sauvegardés (Boom900, variantes v2, Gold, Liquidity, Crash900) restent désactivés. Les anciens journaux `idxseasonal` et `scalping-legacy` sont séparés des presets actuels.

## Les six pertes Scalping

Les valeurs de stop en prix viennent des contrats Deriv consultés précédemment. Nouvelle lecture publique `ticks_history` entre l'entrée et la clôture :

| Contrat | Position | Stop prix Deriv | Tick avant → après traversée | Saut | P&L USD |
|---|---|---:|---|---:|---:|
| 12716711499 | BOOM500 vente | 4700,996 | 4695,210 → 4703,377 | +8,167 | -0,75 |
| 12717993279 | CRASH900 achat | 15408,798 | 15423,164 → 15404,136 | -19,028 | -0,65 |
| 12718167079 | BOOM500 vente | 4703,973 | 4699,252 → 4711,759 | +12,507 | -1,33 |
| 12719093639 | BOOM500 achat | 4705,365 | 4705,378 → 4705,363 | -0,015 | -0,50 |
| 12725333879 | BOOM500 vente | 4702,426 | 4694,175 → 4703,217 | +9,042 | -0,58 |
| 12727609699 | BOOM500 vente | 4701,247 | 4693,913 → 4707,301 | +13,388 | -1,14 |

Les cinq dépassements de stop correspondent à cinq sauts de prix adverses traversant le seuil. Les traversées sont à proximité immédiate des clôtures enregistrées. La perte de 0,50 USD correspond au franchissement progressif. Cela étaye fortement l'explication par saut de prix ; cela ne reconstitue pas l'intégralité du calcul de cotation, de commission et d'exécution interne du courtier.

Les signaux enregistrés ont une confiance de 76 à 90 et un accord TF de 4. Ces scores ne sont pas des probabilités de gain calibrées. Quatre ventes BOOM et l'achat CRASH ont été exposés aux sauts adverses observés. L'achat BOOM a perdu sur un mouvement graduel. La journalisation montre des mises finales de 5 USD malgré `REDUCED_RISK` : le plafond réduit restait supérieur à 5 USD. Le défaut de comptage corrigé précédemment est distinct de cette sémantique de plafond.

## Backtest exécuté, mais non recevable pour autoriser une reprise

Commande : `DB_PATH=:memory: node_modules/.bin/tsx .agents/skills/strategy-tournament/scripts/tournament.ts --market=synthetics --symbols=BOOM500,CRASH900 --candles=3000 --stake=5 --leverage=100 --hold=60 --walkforward --folds=3 --quick`.

Exécution terminée avec code 0. Résultats affichés hors échantillon : Scalping 1502 observations +247,61 USD ; confluence 2297 +59,52 USD ; liquidity-sweep 163 -42,50 USD ; spike-hunter 1273 -348,04 USD. **Ces montants sont des sorties du simulateur existant, pas des gains attendus ni des trades exécutables validés.**

Constats dans `simulateComboStructural` :

- Le P&L de sortie au stop est exactement `-stopLossUsd`, sans prix d'exécution après saut ni commission explicite.
- Le franchissement est testé aux distances structurelles `riskAbs/rewardAbs`, tandis que les montants sont arrondis et soumis au plancher de 0,50 USD par `computeStructuralStopUsd`. Les niveaux de déclenchement et les montants simulés peuvent donc diverger.
- Chaque signal est simulé indépendamment ; les pauses, positions déjà ouvertes et limites du moteur ne sont pas reproduites ici.
- La fin de la fenêtre peut fournir un horizon incomplet aux dernières entrées. Les bougies ne donnent pas l'ordre réel de tous les ticks ; stop prioritaire si stop et cible sont touchés dans la même bougie.

Exemple réel : premier trade, risque structurel 2,938 points, entrée 4696,765, notionnel 500 USD : risque théorique environ 0,313 USD, cible environ 0,469 USD ; les deux deviennent 0,50 USD. Le ratio structurel annoncé de 1,5 n'est donc pas conservé dans les montants envoyés.

## Verdict et travail restant

**NOT READY pour reprendre Scalping ou promouvoir les autres presets.** L'audit et la reconstitution des six clôtures sont effectués ; le test exploratoire est exécuté et ses limites identifiées. La validation réaliste et la simulation prospective ne sont pas réalisées.

Prochaine étape technique : aligner le simulateur sur les montants effectivement proposés, modéliser les franchissements au prochain tick disponible et les frais vérifiables, reproduire l'exposition et les pauses, exclure les horizons incomplets, puis passer revue indépendante et tests de régression. Seulement ensuite : comparaison sur fenêtres historiques distinctes et simulation sans achat. Aucun changement de paramètres ne doit être déduit des seuls six trades perdants.
