# Transformation de l'agent existant — spécification et suivi

## Périmètre

Corriger le bot existant sans créer un deuxième bot. Aucun déploiement, ordre réel,
changement de credentials ou réglage des stratégies pendant les travaux locaux.
Les données de test utilisent une base temporaire distincte. Les observations
simulées ne constituent jamais une preuve de performance réelle.

## Exigences de sécurité prioritaires

- S1 : chaque achat serveur doit obtenir une autorisation déterministe ; les
  commandes administrateur et les schedulers ne contournent pas le risque.
- S2 : aucune répétition automatique d'un achat dont le résultat est inconnu ;
  un verrou persistant bloque les achats ultérieurs jusqu'à réconciliation.
- S3 : proposition et confirmation valides, prix finis, identifiants non vides.
- S4 : données cohérentes, finies, ordonnées et suffisamment récentes par horizon.
  Aucune valeur fictive de solde, connexion ou indicateur.
- S5 : risque démo/live séparé ; les entrées en attente occupent une réservation.
- S6 : un kill switch actif bloque réellement les entrées, y compris en observation.
- S7 : une absence au portefeuille ne prouve ni la clôture ni un P/L nul.
- S8 : aucune reprise après échec de synchronisation.
- S9 : journal et interface distinguent réalité, simulation et état incertain.
- S10 : validation indépendante du constructeur, tests adverses et rapport final.

## Architecture cible

Données → qualité → régime/horizons → stratégies existantes → score explicable
→ validation → risque → autorisation → exécution → positions/sorties
→ journal → performances/supervision. L'IA demeure consultative.

## Ordre de réalisation

1. Corrections S1–S8 et tests de reproduction.
2. Intégration des protections sur tous les points d'entrée.
3. Isolation PAPER/SIMULATION/LIVE et analyse des lacunes restantes.
4. Revue indépendante, régressions, compilation et matrice de conformité.
5. Validation PAPER observée puis approbation explicite avant activation LIVE.

## Critères de preuve

Un module présent ne suffit pas : ses appels réels et ses blocages doivent être
testés. Aucune promesse de rentabilité. Un verdict LIVE exige des preuves de
fonctionnement sur le compte et le courtier ; les tests locaux ne les remplacent pas.
