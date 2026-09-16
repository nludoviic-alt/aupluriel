---
name: entry-execution
description: Exécution sécurisée des ordres d'entrée validés pour AU PLURIEL TRADING ENGINE.
---

# Entry Execution Engine Skill

## Objectif
Transmission des ordres au courtier via `BrokerAdapter` et vérification de la confirmation de remplissage (*fill*).

## Responsabilités
- Contrôle de la péremption de proposition (proposal expiration).
- Buffering de slippage max 1.05x.
- Retries propres sur erreurs réseau éphémères.
- Enregistrement de l'identifiant de contrat / position.
- Aucun ordre transmis sans approbation explicite du Risk Manager.
