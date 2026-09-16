---
name: exit-engine
description: Prise de décision de fermeture de position selon 10 règles stricts pour AU PLURIEL TRADING ENGINE.
---

# Exit Engine Skill

## Objectif
Décider du moment exact de clôture d'une position selon des déclencheurs explicites et mesurables.

## Déclencheurs de Sortie (10)
1. Take Profit atteint.
2. Stop Loss atteint.
3. Trailing Stop déclenché.
4. Invalidation de setup.
5. Changement de régime défavorable.
6. Signal opposé émis.
7. Temps maximal en position écoulé.
8. Dégradation du ratio Risk/Reward.
9. Dépassement de seuil de risque.
10. Déclenchement d'urgence du Circuit Breaker.

## Règle Absolue
**Ne JAMAIS fermer un trade uniquement parce qu'il est en gain.**
