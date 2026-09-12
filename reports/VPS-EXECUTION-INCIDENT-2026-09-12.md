# Incident VPS — 12 septembre 2026

## Diagnostic et correction

Deux achats réussis puis ContractBuyValidationError sur Boom900 donnent 66,7 %
de réussite. Le moniteur assimilait ce refus contractuel à une panne globale.
La latence totale proposition/achat était également utilisée comme latence
de proposition. Le Kill Switch verrouillait les entrées et la santé restait verte.

Les refus contractuels explicites restent comptés et visibles, avec cooldown
du symbole. Ils ne déclenchent plus l'arrêt global. Les erreurs techniques et
achats incertains conservent leur protection. Une latence élevée sur une opération
réussie signale POOR, sans établir seule une panne de tous les marchés.
La santé et l'API affichent le Kill Switch et les pauses de risque.

Boom900 reste arrêté : la mise configurée de 0,90 USD est refusée par le courtier
(minimum 1 USD). Aucune augmentation automatique de mise n'est effectuée.

## Rapport de livraison (16 points)

1. Fichiers modifiés : `execution-quality-monitor.server.ts`, `health-monitor.server.ts`,
   `risk-manager.server.ts`, `loss-streak-circuit-breaker.server.ts`, `routes/api/bot.ts`,
   `routes/autotrader.tsx`, `autotrader-status-bar.tsx`, `trade-journal-section.tsx`,
   `__tests__/safety-architecture.test.ts` (sous `src/lib`, `src` ou `src/components`).
2. Fonctions ajoutées : aucune ; classe ExecutionMonitorStore exportée pour tests isolés.
3. Fonctions supprimées : aucune.
4. Migrations : aucune.
5. YES : refus contractuel isolé, protection technique conservée, santé non verte sous
   Kill Switch, affichage desktop/mobile du blocage, types UI corrigés.
6. PARTIAL : exactitude des métriques de latence (mesure totale existante conservée).
7. NO : certification complète LIVE, rapprochement direct portefeuille Deriv.
8. Tests ajoutés : quatre scénarios dans `execution-incident.test.ts`.
9. Tests passés : 66/66, base SQLite mémoire ; même résultat en revue indépendante.
10. Échecs : aucun dans la suite finale. Deux échecs initiaux corrigés (historique NULL
    absent du risque Démo et utilisateur manquant dans la fixture).
11. Risques : compteurs techniques cumulatifs et arrêt conservateur après erreur inconnue
    inchangés. NULL est interprété Démo conformément à la convention historique du projet,
    sans prouver à lui seul le type du compte d'origine.
12. Régressions potentielles : des pauses Démo supplémentaires peuvent être justifiées
    par la réintégration des anciens trades NULL. Aucun seuil ni mise modifié.
13. Erreurs connues : avertissements Vite de découpage/directives de dépendances.
14. Statut : correctif ciblé implémenté et revu indépendamment ; vérification VPS après
    activation indispensable. Le projet global n'est pas déclaré terminé.
15. Verdict : READY WITH WARNINGS pour ce correctif de l'incident Démo uniquement.
16. Retour arrière : vérifier positions/intentions, puis utiliser `ops/ROLLBACK.md`
    vers `/home/ubuntu/releases/20260912T120717Z-e39d8f7/.output`. Ne pas restaurer une
    ancienne base si des trades ont eu lieu depuis ; aucune migration ne le nécessite.

Sauvegarde pré-déploiement : `/home/ubuntu/backups/incident-20260912T213851Z.db`,
intégrité OK ; configurations dans `incident-configs-20260912T213851Z.json`.
Huit presets activés en Démo, zéro position ouverte/en attente dans SQLite à la capture.
