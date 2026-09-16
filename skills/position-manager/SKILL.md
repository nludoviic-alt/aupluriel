---
name: position-manager
description: Surveillance temps réel des positions ouvertes pour AU PLURIEL TRADING ENGINE.
---

# Position Manager Skill

## Objectif
Suivi continu de toutes les positions en cours (PnL floatant, excursion favorable/défavorable MAE/MFE, durée d'ouverture, maintien de la thèse).

## Reconstitution après crash
Capacité de restaurer l'état des positions en mémoire depuis SQLite et l'API courtier en cas de redémarrage du serveur.
