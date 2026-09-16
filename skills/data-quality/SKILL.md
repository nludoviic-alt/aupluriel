---
name: data-quality
description: Verrou de contrôle de la qualité des données de marché pour AU PLURIEL TRADING ENGINE.
---

# Data Quality Guard Skill

## Objectif
Empêcher le moteur d'exécuter la moindre analyse ou transaction sur des données corrompues, périmées ou anormales.

## Vérifications
- Ticks manquants ou doublons.
- Timestamps incohérents ou non chronologiques.
- Prix aberrants (spikes parasites hors marché).
- Latence réseau > 1500ms.
- Spread anormalement élevé par rapport au max autorisé.

## Règle Absolue
Si une anomalie est détectée → émission de `MARKET_DATA_INVALID` et **INTERDICTION DE TRADER**.
