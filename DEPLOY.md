# Déploiement sur le VPS OVH (lio23.com)

Cette app est un **full-stack TanStack Start + Nitro** avec une base **SQLite**.
Elle tourne en production sur un **VPS OVH** derrière nginx, servie sur
**https://lio23.com**.

## Architecture du serveur

| Élément | Valeur |
|---------|--------|
| Hôte | `51.79.70.153` (OVH, hostname `vps-37f2b441`) |
| Accès SSH | `ssh ubuntu@51.79.70.153` (clé publique) |
| Code | `/home/ubuntu/app` (clone du dépôt GitHub, remote `github-lio23:nludoviic-alt/lio23-vortex.git`) |
| Base SQLite | `/home/ubuntu/data/lio23.db` (hors du dépôt — survit aux déploiements) |
| Service | `lio23.service` (systemd, `Restart=always`) → `node .output/server/index.mjs` sur le port 3000 |
| Reverse proxy | nginx (`/etc/nginx/sites-enabled/lio23`) → proxy vers `127.0.0.1:3000`, WebSocket activé |
| HTTPS | Let's Encrypt via certbot (renouvellement automatique) |
| Node | v22 (aligné sur `engines` du package.json) |
| Env | `/home/ubuntu/app/.env` : `JWT_SECRET`, `DB_PATH`, `ADMIN_EMAIL`, `INVITE_CODE`, `APP_URL`, `GROQ_API_KEY`, `NODE_ENV`, `PORT`, `RESEND_API_KEY`, `EMAIL_FROM` |

## Déployer une nouvelle version — automatique ✅

**`git push origin main` suffit.** Un workflow GitHub Actions
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) se déclenche à
chaque push sur `main` et se connecte en SSH au VPS pour lancer
`~/app/deploy.sh`, qui fait `git reset --hard origin/main`, `npm ci`,
`npm run build`, puis `sudo systemctl restart lio23`.

Suivre le déploiement : onglet **Actions** du dépôt GitHub, ou
`gh run watch --repo nludoviic-alt/lio23-vortex`.

Déclencher manuellement sans nouveau commit :
`gh workflow run deploy.yml --repo nludoviic-alt/lio23-vortex`.

### Comment ça marche (sécurité)
- Une clé SSH dédiée (`DEPLOY_SSH_KEY`, secret GitHub Actions) est autorisée
  sur le VPS, mais **verrouillée** via `command="/home/ubuntu/deploy.sh"`
  dans `~/.ssh/authorized_keys` : même si cette clé fuite, elle ne peut
  rien exécuter d'autre que ce script — pas de shell, pas d'autre commande.
- Le compte GitHub Actions n'a jamais accès à la base SQLite ni aux
  secrets du VPS (`.env` reste local au serveur).

### Déploiement manuel (dépannage seulement)
Si le VPS refuse de puller à cause de modifications locales :

```sh
ssh ubuntu@51.79.70.153 'cd ~/app && git stash push -u -m "pre-deploy" && ~/deploy.sh'
```

> ⚠️ Ne jamais éditer les fichiers directement sur le VPS : tout passe par git.

## Vérifier après déploiement

```sh
ssh ubuntu@51.79.70.153 'systemctl is-active lio23 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/'
curl -s -o /dev/null -w "%{http_code}\n" https://lio23.com/
```

Logs applicatifs :

```sh
ssh ubuntu@51.79.70.153 'sudo journalctl -u lio23 -f'
```

## Notes importantes

- **Le bot serveur ne reprend au redémarrage que s'il était activé** (`bot_state.enabled = 1`).
  Après un restart, vérifier sur la page Auto-Trader qu'il tourne toujours.
- La base (`~/data/lio23.db`) contient les comptes et les **tokens API Deriv des
  utilisateurs** : ne jamais la copier hors du serveur, ne jamais la commiter.
- Le dépôt GitHub doit rester **privé** : il contient la logique de trading.
- Ne jamais commiter `.env` ni `*.db` (déjà dans `.gitignore`).
- En production, l'app **refuse de démarrer** l'authentification sans `JWT_SECRET` fort.
