# Métriques et contrôles

## Formules

- `P&L net = somme(profit)` sur les trades `won` et `lost`.
- `Profit factor = gains bruts / pertes brutes absolues`.
- `Espérance par trade = P&L net / nombre de trades fermés`.
- `Gain moyen = gains bruts / nombre de gains`.
- `Perte moyenne = pertes brutes absolues / nombre de pertes`.
- `Win rate de rentabilité = perte moyenne / (gain moyen + perte moyenne)`.
- `Drawdown maximal` : plus forte baisse entre un sommet du P&L cumulé et le creux suivant, dans l'ordre chronologique.

## Lecture

| Indicateur | Surveiller | Solide |
|---|---:|---:|
| Profit factor | 1,00 à 1,20 | supérieur à 1,20 |
| Espérance | proche de 0 | positive et stable |
| Échantillon | moins de 30 | 30 minimum, 100 préférable |
| Drawdown | en hausse | stable ou en baisse |

Un profit factor infini signifie qu'aucune perte n'est observée. Le considérer comme non fiable sur un petit échantillon.

## Contrôles obligatoires

- Filtrer `mode = 'demo'` séparément de `mode = 'live'`; traiter les anciennes lignes `NULL` comme démo.
- Utiliser uniquement `status IN ('won','lost')` pour les métriques de rendement.
- Comparer les totaux détaillés et résumés sur exactement le même périmètre.
- Vérifier que les symboles exclus ne reçoivent plus de nouvelles entrées.
- Distinguer une position ouverte avant le changement d'une nouvelle entrée hors filtre.
- Vérifier `symbols`, `excludedSymbols`, `minConfidence`, `maxConfidence`, `minTfAgreement`, `maxOpenPositions` et `enabled` dans `bot_state`.
- Signaler un bot `enabled` mais non restauré, un dernier scan ancien ou une erreur moteur.
- Signaler une recommandation positive dont le résultat provient majoritairement d'un seul trade exceptionnel.
