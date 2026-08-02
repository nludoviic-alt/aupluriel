---
name: config-change-impact
description: Compare en lecture seule les performances de trading juste avant et juste après chaque changement de configuration (mise, limites, confiance, accord TF, TP/SL, levier, symboles), en s'appuyant sur la table config_changes journalisée automatiquement par le serveur (src/lib/bot-engine.server.ts, 2026-08-02). Utiliser pour vérifier si une modification récente a réellement aidé, avant d'en tirer une conclusion à l'œil.
---

# Impact des changements de config

Répond à une seule question par changement : est-ce que ce réglage a réellement amélioré le rendement, ou est-ce qu'on l'a juste supposé ? Ne jamais présenter un verdict comme définitif si l'échantillon est trop petit.

## Pourquoi ça existe

Chaque édition de mise/limites/confiance/TP/SL/levier/symboles (par l'utilisateur ou par un admin) est désormais journalisée automatiquement dans `config_changes`, avec l'horodatage exact et les valeurs avant/après (voir `logConfigChange` dans `src/lib/bot-engine.server.ts`). Avant cette table (ajoutée le 2026-08-02), il n'existait aucun moyen fiable de savoir QUAND un réglage avait changé — comparer "les 20 derniers trades" ne veut rien dire sans savoir si le réglage a bougé entre-temps.

## Procédure

1. Confirmer la base ciblée. Pour Au Pluriel en production : `/home/ubuntu/data/lio23.db` sur le VPS.
2. Exécuter le script depuis la racine du projet :

```bash
node .agents/skills/config-change-impact/scripts/config-impact.mjs /home/ubuntu/data/lio23.db
```

Options :

```bash
node .agents/skills/config-change-impact/scripts/config-impact.mjs DB_PATH --user=ludovic --preset=boom
node .agents/skills/config-change-impact/scripts/config-impact.mjs DB_PATH --window=50 --min-sample=20 --json
```

Sur le VPS, passer par SSH et exécuter le script dans `/home/ubuntu/app`. Ne jamais copier ni afficher les jetons Deriv ou les variables d'environnement.

3. Pour chaque changement listé, lire dans cet ordre : les champs modifiés (from → to), puis le tableau avant/après (trades, win rate, P&L, espérance, profit factor), puis le verdict.
4. Le verdict n'est calculé que si les DEUX côtés (avant et après) atteignent `--min-sample` (10 par défaut) — en dessous, il affiche "échantillon insuffisant" et doit être traité comme tel, pas comme un résultat neutre.
5. Le verdict compare l'espérance ET le profit factor, jamais le win rate seul (même règle que `audit-trading-production`) — un win rate en hausse avec une espérance en baisse (TP resserré, par exemple) n'est pas une amélioration.
6. Si plusieurs changements se succèdent rapidement sur le même preset, la fenêtre "après" du premier chevauche potentiellement l'entrée en vigueur du second — le signaler explicitement plutôt que de l'ignorer.

## Règles de décision

- Ne jamais conclure "ça a marché" sur un verdict "échantillon insuffisant" — dire clairement qu'il faut attendre plus de trades.
- Une dégradation confirmée (échantillon suffisant des deux côtés) doit être signalée même si personne ne la demande — c'est le but du skill.
- Ne jamais modifier une configuration depuis ce skill : il est strictement en lecture seule, il informe une décision, il ne l'exécute pas.
- Croiser avec `audit-trading-production` quand plusieurs changements se sont accumulés sur la même période — ce skill regarde changement par changement, `audit-trading-production` regarde l'état global actuel.
