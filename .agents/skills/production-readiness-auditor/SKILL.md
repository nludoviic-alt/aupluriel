---
name: production-readiness-auditor
description: Final gatekeeper audit before activating Demo or Live trading. Evaluates 19 mandatory criteria and issues a formal verdict: READY, NOT READY, or READY WITH WARNINGS. If any critical component is missing, verdict MUST be NOT READY.
---

# Production Readiness Auditor Skill

Rôle : Dernier contrôle d'étanchéité et de sécurité avant l'activation en mode Démo ou Réel.

## Verdict Obligatoire

Le rapport d'audit de production doit se conclure par l'un des trois statuts :
- **`READY`** : Tous les critères sont validés à 100 %.
- **`READY WITH WARNINGS`** : Fonctionnel avec des avertissements mineurs non critiques.
- **`NOT READY`** : Bloqué. Une fonction critique ou un test est manquant.

## Matrice de Contrôle Obligatoire (19 Critères)

| Critère | Statut | Remarques |
| :--- | :--- | :--- |
| Build OK | `PASS` / `FAIL` | Compilation `npm run build` propre |
| TypeScript / Typing OK | `PASS` / `FAIL` | 0 erreur `tsc --noEmit` |
| Lint OK | `PASS` / `FAIL` | Syntaxe et règles respectées |
| Unit Tests OK | `PASS` / `FAIL` | Tests unitaires validés |
| Integration Tests OK | `PASS` / `FAIL` | Flux complet d'exécution testé |
| Regression Tests OK | `PASS` / `FAIL` | Préservation des stratégies existantes |
| DB Migrations OK | `PASS` / `FAIL` | Migrations SQLite idempotentes |
| Risk Manager OK | `PASS` / `FAIL` | Isolation totale et caps de risque vérifiés |
| Deriv Execution OK | `PASS` / `FAIL` | Workflow `proposal -> buy` et NO VALID PROPOSAL = NO BUY |
| Portfolio Reconciliation OK | `PASS` / `FAIL` | Synchronisation avec l'API Deriv |
| Logging OK | `PASS` / `FAIL` | Journalisation explicite des erreurs et rejets |
| No Silent Errors | `PASS` / `FAIL` | Aucun bloc catch vide ou masqué |
| Feature Flags OK | `PASS` / `FAIL` | Isolation des fonctionnalités expérimentales |
| Rollback Possible | `PASS` / `FAIL` | Restauration de version fonctionnelle |
| Data Quality Guard OK | `PASS` / `FAIL` | Détection des ticks stale et bougies aberrantes |
| Circuit Breakers OK | `PASS` / `FAIL` | Arrêt d'urgence fonctionnel |
| Strategy Versioning OK | `PASS` / `FAIL` | Stratégie enregistrée avec version immutable |
| Shadow Mode OK | `PASS` / `FAIL` | Mode simulation sans risque opérationnel |
| Monitoring OK | `PASS` / `FAIL` | Alertes Telegram / Webhook prêtes |

> **RÈGLE STRICTE** : Si une seule fonction critique échoue ou manque, le statut global est impérativement **NOT READY**.
