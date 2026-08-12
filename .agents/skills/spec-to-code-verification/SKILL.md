---
name: spec-to-code-verification
description: Verifies that implemented trading engine code, API routes, and database schemas strictly align with architectural specifications and target requirements. Produces a detailed requirement verification matrix (Requirement, Implemented YES/NO/PARTIAL, File, Function/Class, Test exists YES/NO, Status, Notes). Use when verifying features against specifications before release.
---

# Spec-To-Code Verification Skill

Rôle : Comparer la spécification fonctionnelle avec le code réellement présent dans le projet **Au Pluriel**.

Aucune fonctionnalité ne doit être considérée comme terminée uniquement parce qu'elle existe dans l'interface UI. La validation doit vérifier le backend, la base de données SQLite, l'API Deriv et le comportement réel en exécution.

## Matrice d'Audit Obligatoire

Pour chaque exigence de la spécification, produire la table suivante :

| Requirement | Implemented | File | Function/Class | Test exists | Status | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Risk per trade 0.25 % | YES | `src/lib/bot-engine.server.ts` | `computeKellyStakeServer` | YES | PASS | Strictement borné à 0.25% du capital |
| Daily DD 2 % | YES | `src/lib/bot-engine.server.ts` | `checkDailyRiskLimits` | YES | PASS | Pause automatique enregistrée en DB |
| Granular Time Filter | PARTIAL | `src/lib/time-filter.server.ts` | `isTimeWindowActive` | YES | WARN | Filtre horaire actif, manque les exceptions jours fériés |
| Shadow Mode | NO | N/A | N/A | NO | FAIL | En cours de spécification |
| Strategy Versioning | YES | `src/lib/config-registry.server.ts` | `ConfigRegistry.saveConfigVersion` | YES | PASS | Versioning immutable vX.Y.Z et hash SHA-256 |
| Deriv Proposal Validation | YES | `src/lib/deriv.server.ts` | `fetchProposalServer` | YES | PASS | Déclenchement buy uniquement si proposal valide |
| Reconciliation Engine | NO | N/A | N/A | NO | FAIL | À implémenter |

## Critères de Validation
1. **Traçabilité Code** : Chaque `YES` doit être justifié par un lien exact vers le fichier et la fonction.
2. **Backend Real-world Checks** : Ne jamais se fier aux rendus UI front-end sans avoir inspecté les routes API et moteurs serveur.
3. **Zéro Changement Silencieux** : Vérifier que tous les paramètres critiques passent par le registre de configuration versionné.
