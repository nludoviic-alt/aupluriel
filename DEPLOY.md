# Déploiement sur le VPS OVH (aupluriel.com)

Cette app est un **full-stack TanStack Start + Nitro** avec une base **SQLite**.
Elle tourne en production sur un **VPS OVH** derrière nginx, servie sur
**https://aupluriel.com**.

> ⚠️ **Le domaine réel est `aupluriel.com`, pas `lio23.com`.** Le DNS de
> `lio23.com` pointe désormais vers un tout autre serveur (un site vitrine
> Apache sans rapport avec cette app) — ne pas s'y fier pour vérifier un
> déploiement. Le nom `lio23` survit uniquement dans des identifiants internes
> historiques (repo GitHub `lio23-vortex` avant renommage en `aupluriel`,
> service systemd `lio23.service`, fichier `lio23.db`) : ce sont des artefacts
> de nommage, pas des indices sur le vrai domaine public.

## Architecture du serveur

| Élément | Valeur |
|---------|--------|
| Hôte | `51.79.70.153` (OVH, hostname `vps-37f2b441`) |
| Accès SSH | `ssh ubuntu@51.79.70.153` (clé publique) |
| Domaine public | `https://aupluriel.com` (vhost nginx `aupluriel`, PAS `lio23.com`) |
| Code | `/home/ubuntu/app` (clone du dépôt GitHub, remote `github-lio23:nludoviic-alt/lio23-vortex.git` — alias historique, GitHub redirige vers le repo renommé `aupluriel`) |
| Base SQLite | `/home/ubuntu/data/lio23.db` (hors du dépôt — survit aux déploiements) |
| Service | `lio23.service` (systemd, `Restart=always`) → `node .output/server/index.mjs` sur le port 3000 |
| Reverse proxy | nginx (`/etc/nginx/sites-enabled/aupluriel`) → proxy vers `127.0.0.1:3000`, WebSocket activé |
| HTTPS | Let's Encrypt via certbot (renouvellement automatique) |
| Node | v22 (aligné sur `engines` du package.json) |
| Env | `/home/ubuntu/app/.env` : `JWT_SECRET`, `DB_PATH`, `ADMIN_EMAIL`, `INVITE_CODE`, `APP_URL` (=`https://aupluriel.com`), `GROQ_API_KEY`, `NODE_ENV`, `PORT`, `RESEND_API_KEY`, `EMAIL_FROM` |

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
curl -s -o /dev/null -w "%{http_code}\n" https://aupluriel.com/
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
- **Le health check du script de déploiement ne détecte pas tout.** `health_check()`
  vérifie `systemctl is-active`, `/api/health` et `sqlite3 PRAGMA quick_check` (CLI),
  mais n'appelle jamais le binding natif `better-sqlite3` utilisé par l'app elle-même.
  Le 2026-08-06, un déploiement a installé un binaire **macOS** pour
  `better-sqlite3` au lieu d'un binaire Linux (`ERR_DLOPEN_FAILED: invalid ELF
  header`) — le service est resté "actif" et `/api/health` répondait `ok:true`,
  mais **toute route touchant la DB renvoyait 500** (auto-trader, price-alerts,
  backtest, health-monitor…). Cause exacte non confirmée (probablement un cache
  npm corrompu côté VPS). Si ça se reproduit :
  ```sh
  ssh ubuntu@51.79.70.153 'file /home/ubuntu/app/.output/server/node_modules/better-sqlite3/build/Release/better_sqlite3.node'
  # doit afficher "ELF 64-bit ... x86-64 ... GNU/Linux", pas "Mach-O"
  ```
  Correctif rapide : copier le binaire valide d'une release précédente dans
  `/home/ubuntu/releases/` (même version de `better-sqlite3`) puis
  `sudo systemctl restart lio23`. Correctif durable : vider `~/.npm` sur le VPS
  avant un `npm ci` si le problème persiste.
