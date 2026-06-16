# Déploiement sur Railway

Cette app est un **full-stack TanStack Start + Nitro** avec une base **SQLite**.
Elle a besoin d'un serveur **Node.js avec un disque persistant** (pas Vercel/Netlify/Cloudflare).

## Prérequis
- Le code est sur GitHub (dépôt **privé** recommandé).
- Un compte [Railway](https://railway.app) (connecte-toi avec GitHub).

## Étapes

### 1. Créer le projet
1. Railway → **New Project** → **Deploy from GitHub repo**.
2. Choisis ce dépôt. Railway détecte Node, lance `npm run build` puis `npm run start`.

### 2. Ajouter un volume persistant (pour la base SQLite)
1. Sur le service → onglet **Variables**/**Settings** → **Volumes** → **New Volume**.
2. Mount path : `/data`
   > Sans volume, la base (comptes, réglages) serait effacée à chaque redéploiement.

### 3. Définir les variables d'environnement
Service → **Variables** → ajoute :

| Variable | Valeur |
|----------|--------|
| `JWT_SECRET` | une longue valeur aléatoire (`openssl rand -hex 32`) |
| `DB_PATH` | `/data/lio23.db` |
| `INVITE_CODE` | un code secret pour l'inscription (optionnel mais conseillé) |

> `PORT` et `NODE_ENV=production` sont fournis automatiquement par Railway.

### 4. Déployer
Railway build et déploie automatiquement. Une URL publique HTTPS est générée
(`https://<nom>.up.railway.app`) — c'est l'adresse à partager.

### 5. (Optionnel) Domaine perso
Service → **Settings → Domains → Custom Domain**, puis crée le `CNAME` indiqué
chez ton fournisseur de domaine (OVH, Cloudflare…). HTTPS automatique.

## Notes sécurité
- Le dépôt doit rester **privé** : il contient la logique de trading.
- Ne commite jamais `.env` ni `*.db` (déjà dans `.gitignore`).
- Les tokens API Deriv des utilisateurs sont stockés en base : garde `JWT_SECRET`
  secret et le dépôt privé. Recommande à chacun de rester en **DEMO**.
- En production, l'app **refuse de démarrer** l'authentification sans `JWT_SECRET` fort.
