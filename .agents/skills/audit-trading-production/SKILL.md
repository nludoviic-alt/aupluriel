---
name: audit-trading-production
description: Audite en lecture seule les performances et la cohérence du bot Au Pluriel à partir de la base SQLite de production. Utiliser pour analyser le rendement réel, comparer Boom/Crash/Multi, trouver les symboles ou plages de confiance à suspendre, vérifier les configurations actives, expliquer des chiffres contradictoires entre pages, contrôler le profit factor, l'espérance, le drawdown et la taille des échantillons, ou préparer une recommandation avant toute modification du bot.
---

# Audit trading production

Produire un diagnostic reproductible à partir des données réellement enregistrées par le moteur serveur. Ne jamais présenter un réglage comme une garantie de gains.

## Procédure

1. Confirmer la base et l'environnement ciblés. Pour Au Pluriel en production, utiliser `/home/ubuntu/data/lio23.db` sur le VPS.
2. Créer une sauvegarde seulement si une modification est ensuite demandée. Un audit seul reste strictement en lecture seule.
3. Exécuter le script depuis la racine du projet :

```bash
node .agents/skills/audit-trading-production/scripts/audit-production.mjs /home/ubuntu/data/lio23.db
```

Options :

```bash
node .agents/skills/audit-trading-production/scripts/audit-production.mjs DB_PATH --mode=demo --min-sample=30
node .agents/skills/audit-trading-production/scripts/audit-production.mjs DB_PATH --mode=live --json
```

Sur le VPS, passer par SSH et exécuter le script dans `/home/ubuntu/app`. Ne jamais copier ni afficher les jetons Deriv ou les variables d'environnement.

4. Lire les résultats dans cet ordre :
   - total fermé, P&L, profit factor, espérance, gain/perte moyens et win rate de rentabilité ;
   - comparaison Boom, Crash et Multi ;
   - symboles, confiance, accord TF et heures ;
   - configurations réellement sauvegardées dans `bot_state` ;
   - avertissements d'intégrité ou d'échantillon.
5. Comparer les recommandations à la configuration active. Signaler explicitement toute différence entre le filtre recommandé et celui réellement chargé.
6. Formuler les conclusions en trois catégories : conserver, surveiller, suspendre.

## Règles de décision

- Ne jamais recommander avec le seul win rate.
- Considérer en priorité une espérance positive et un profit factor supérieur à 1.
- Marquer tout segment de moins de `min-sample` trades comme exploratoire.
- Exiger une amélioration visible du profit factor, de l'espérance et du drawdown avant d'augmenter la fréquence.
- Séparer démo et réel. Ne jamais additionner leurs P&L.
- Ne pas optimiser simultanément trop de dimensions sur un petit historique.
- Ne jamais modifier la production sans demande explicite de l'utilisateur.
- Après une modification autorisée, comparer les fenêtres avant/après à 20, 50 et 100 nouveaux trades.

Lire [references/metrics.md](references/metrics.md) pour les formules, seuils et contrôles d'intégrité.

## Compte rendu attendu

Présenter :

1. Le verdict global avec la taille de l'échantillon.
2. Les meilleurs et pires segments avec P&L, espérance et profit factor.
3. Les incohérences entre données, configuration et interface.
4. Une recommandation prudente et réversible.
5. Les limites de l'analyse et les prochains seuils de réévaluation.
