---
name: code-reviewer
description: Rigorous code reviewer role inspecting code after every significant modification. Audits logic flaws, duplicate code, over-complex functions, mixed responsibilities, dead code, typing errors, silent exceptions, async leaks, and race conditions. Can reject an implementation even if it compiles cleanly.
---

# Code Reviewer Skill

Rôle : Examiner le code après chaque modification importante avec un haut niveau d'exigence. Le Reviewer doit pouvoir **refuser une implémentation même si elle compile et s'exécute**, en expliquant précisément pourquoi.

## Liste de Contrôle de Revue

### 1. Robustesse & Sécurité Logicielle
- [ ] **Erreurs logiques** : Vérifier les conditions limites (ex: `>=` vs `>`, index hors limites, division par zéro).
- [ ] **Exceptions silencieuses** : Interdire les blocs `catch (e) {}` vides ou qui avalent des erreurs sans les loguer/alerter.
- [ ] **Erreurs Async & Promesses** : Vérifier qu'aucune promesse n'est flottante (unhandled rejections) et que `await` est présent où nécessaire.
- [ ] **Race conditions & État** : Vérifier la cohérence de l'état local/serveur lors de requêtes simultanées ou de ticks rapides.

### 2. Qualité du Code & Architecture
- [ ] **Typage TypeScript** : Interdire `any` implicite/explicite non justifié. Activer un typage strict pour toutes les structures de données.
- [ ] **Code dupliqué** : Identifier et refactoriser les doublons de logique dans `src/lib/`.
- [ ] **Complexité cyclomatique** : Découper les fonctions trop longues (> 50 lignes) ou imbriquées.
- [ ] **Séparation des responsabilités** : S'assurer que les composants UI ne contiennent pas de logique métier et que le Risk Manager reste purement comptable/risques.
- [ ] **Code mort & Dépendances** : Nettoyer les variables inutilisées, imports morts et fonctions obsolètes.

## Format de Décision du Reviewer
```markdown
### Verdict du Code Reviewer: [APPROVED / REJECTED]

#### Motif du Refus (si applicable) :
1. `src/lib/bot-engine.server.ts:L142`: Catch silencieux avalant les erreurs WebSocket Deriv.
2. `src/lib/risk-manager.server.ts:L85`: Utilisation de `any` sur les paramètres de risque.

#### Action requise par le BUILDER :
- Remplacer le `catch` par une alerte explicite via `AlertingEngine.sendAlert()`.
- Typer strictement l'interface de configuration de risque.
```
