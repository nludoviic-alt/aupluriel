# Incident Scalping — 13 septembre 2026

## Constat et décision

Six clôtures Démo depuis le déploiement 8578fae : cinq BOOM500 (-4,30 USD), une CRASH900 (-0,65 USD), total -4,95 USD. Chaque mise était de 5 USD. Les six contrats consultés directement via `proposal_open_contract` sur le compte strictement Démo confirment les P&L locaux et un ordre stop-loss de -0,50 USD. Cinq pertes dépassent ce seuil ; la cause exacte de l'exécution reste non démontrée. Aucun ordre d'achat n'a été envoyé pour cette vérification. Portefeuille Deriv Démo vide.

Scalping arrêté par l'API authentifiée le 13 septembre à 12:28 UTC, `enabled=0`, réponse HTTP 200. Aucun trade depuis cet arrêt lors du contrôle préalable au déploiement. Les sept autres presets activés sont conservés. Aucune reprise Scalping autorisée par ce correctif.

## Exigences avant implémentation

Le résultat doit mettre à jour le même compteur Démo/Réel que le Risk Manager ; la première perte et un résultat rejoué ne doivent compter qu'une fois ; résultat et risque doivent être atomiques ; une perte de récupération manquée doit être reconstruite ; l'API doit afficher le mode sélectionné. Aucun seuil, mise ou signal n'est modifié.

## Rapport obligatoire

1. **Fichiers modifiés** : [moteur](../src/lib/bot-engine.server.ts), [circuit breaker](../src/lib/loss-streak-circuit-breaker.server.ts), [API](../src/routes/api/bot.ts), [tests](../src/lib/__tests__/trade-outcome-persistence.test.ts), présent rapport.
2. **Fonction ajoutée** : `persistTradeAndRiskOutcome`, utilisée par `emit`. Initialisation avant insertion du résultat ; transaction SQLite pour journal et résultat de risque ; statut/mode persistants pour rejeu et attribution.
3. **Fonctions supprimées** : aucune. Ancien enregistrement non scindé par mode remplacé dans `emit`.
4. **Migrations** : aucune. Le scan préflight signale deux faux positifs existants : reconstruction `safety_alerts_new` sous contrôle de FK et transaction ; commentaire contenant `CREATE TABLE`. Vérification manuelle effectuée.
5. **YES** : isolation Démo/Réel ; première perte comptée une fois ; pause à trois pertes ; rejeu sans incrément ; annulation atomique sur panne ; API par mode ; perte en récupération ; reconstruction et compteur au-delà de cinq pertes.
6. **PARTIAL** : cause des dépassements de stop. Ordres et P&L confirmés chez Deriv, chronologie détaillée d'exécution non établie. Robustesse multi-processus non certifiée : service moteur unique présumé et PID principal vérifié.
7. **NO** : aucune démonstration de rentabilité ni validation de reprise Scalping ; aucune certification générale Live.
8. **Tests ajoutés** : cinq tests d'intégration, couvrant les exigences ci-dessus et une panne SQLite injectée par trigger.
9. **Tests réussis** : 71/71 sur SQLite mémoire ; TypeScript sans erreur ; build production et préflight terminés avec code 0. Revue indépendante : 17/17 tests dédiés lors de sa passe, APPROVED pour le correctif avec Scalping désactivé.
10. **Tests échoués** : zéro assertion. ESLint des fichiers modifiés n'est pas vert : huit `any` préexistants dans le moteur (reproduits sur HEAD), plus des écarts Prettier. Ce n'est pas une validation lint globale.
11. **Risques** : stop de 0,50 USD dépassé jusqu'à 1,33 USD dans cet échantillon ; la réduction de risque agit sur le plafond et ne garantit pas une réduction de la mise si la mise demandée est déjà inférieure au plafond. Scalping reste arrêté.
12. **Régressions possibles** : attribution des résultats et affichage des pauses de tous les presets ; protégés par tests de mode, rejeu, récupération et suites existantes. Les achats/propositions et paramètres ne changent pas.
13. **Erreurs connues** : dette lint existante ; avertissements bundler existants. Le correctif n'efface pas les pauses de performance des autres presets.
14. **Statut** : correctif testé et approuvé indépendamment ; arrêt Scalping vérifié ; contrôle post-déploiement à consigner séparément après exécution.
15. **Verdict** : **READY WITH WARNINGS pour le correctif ciblé, Scalping désactivé**. **NOT READY pour une reprise Scalping ou une certification générale de trading** (exécution des stops et critères globaux non validés).
16. **Retour arrière** : maintenir Scalping désactivé ; vérifier absence de positions ; revenir à la release `/home/ubuntu/releases/20260912T213943Z-8578fae/.output` avec le mécanisme atomique établi, puis redémarrer `lio23` et vérifier santé, sept presets restaurés, Scalping arrêté et portefeuille. Ne pas restaurer la base pour un retour de code sans migration : cela effacerait les transactions récentes. Sauvegardes : `/home/ubuntu/backups/scalping-stop-20260913T122800Z.db` et `/home/ubuntu/backups/scalping-fix-20260913T123416Z.db` ; état complet sauvegardé dans le fichier `-state.json` associé.

Les comparaisons à 20/50/100 nouveaux trades ne sont pas disponibles : Scalping est arrêté. Aucun résultat futur n'est annoncé.
