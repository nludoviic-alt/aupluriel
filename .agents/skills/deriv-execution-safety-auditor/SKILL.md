---
name: deriv-execution-safety-auditor
description: Audits the complete Deriv execution workflow: contracts_for -> proposal -> validation -> buy -> confirmation -> portfolio/journal. Enforces the absolute rule NO VALID PROPOSAL = NO BUY. Verifies symbol/multiplier/stake validity, error cooldowns, error logging, and portfolio reconciliation.
---

# Deriv Execution Safety Auditor Skill

Rôle : Auditer l'intégralité du pipeline d'exécution des ordres avec l'API Deriv.

## Workflow d'Exécution Obligatoire

```
┌─────────────────┐     ┌───────────┐     ┌────────────┐     ┌─────┐     ┌──────────────┐     ┌───────────────────┐
│  contracts_for  │ ──► │  proposal │ ──► │ validation │ ──► │ buy │ ──► │ confirmation │ ──► │ portfolio/journal │
└─────────────────┘     └───────────┘     └────────────┘     └─────┘     └──────────────┘     └───────────────────┘
```

## Règle Absolue d'Exécution

> # NO VALID PROPOSAL = NO BUY
> Aucun achat de contrat ne peut être soumis sans l'obtention préalable d'un objet `proposal` valide, vérifié et actif auprès de l'API Deriv.

## Grille de Contrôle d'Exécution

- [ ] **Symbole & Type de contrat** : Vérifier que le symbole est actif et que le type de contrat (CALL/PUT/MULTIPLIER) est supporté.
- [ ] **Multiplier & Stake** : Contrôler que le multiplicateur et la mise sont conformes aux spécifications de Deriv.
- [ ] **Devise** : S'assurer que la devise du contrat correspond exactement à la devise du compte Deriv (`USD`).
- [ ] **Validation de Proposal** : Vérifier l'ID de la proposition (`proposal.id`), le prix de proposition et l'absence d'erreurs avant l'appel à `buy`.
- [ ] **Prévention des Boucles sur Erreur** : Vérifier qu'une erreur API ne déclenche pas de boucle infinie de retry.
- [ ] **Cooldown d'Erreur** : Appliquer un cooldown automatique après des erreurs répétées de l'API Deriv.
- [ ] **Journalisation Complète** : Consigner `error.code` et `error.message` dans SQLite (`signal_rejections` / `alerts`).
- [ ] **Confirmation Réelle & Synchronisation** : Vérifier la confirmation explicite de l'achat (`contract_id`) et la mise à jour immédiate du journal et du portefeuille.
