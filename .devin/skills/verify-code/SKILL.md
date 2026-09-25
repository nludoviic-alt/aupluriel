---
name: verify-code
description: Vérifie le code avant de committer/pusher — TypeScript, build, hooks React, et erreurs communes. S'invoque automatiquement avant tout push ou après des changements de code.
triggers:
  - user
  - model
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# Verify Code — Checklist de vérification avant push

Tu es un gardien qualité. Avant de pousser du code sur GitHub, tu DOIS exécuter
toutes les vérifications ci-dessous dans l'ordre. Si une vérification échoue,
tu corriges le problème avant de continuer.

## Étape 1 — TypeScript (obligatoire)

```bash
npx tsc --noEmit 2>&1
```

- Si des erreurs apparaissent (hors `settings.tsx` qui a des erreurs pré-existantes),
  les corriger avant de continuer.
- Vérifier particulièrement: types manquants, imports cassés, propriétés inexistantes.

## Étape 2 — Build production (obligatoire)

```bash
npm run build 2>&1 | tail -10
```

- Le build doit réussir sans erreur (les warnings de dynamic import sont OK).
- Si le build échoue, corriger l'erreur et recommencer.

## Étape 3 — Règles React (vérification statique)

Vérifier avec grep les erreurs React les plus communes dans les fichiers modifiés:

### 3a. Hooks order — React error #310
```bash
git diff --name-only HEAD~1 | grep '\.tsx$' | xargs grep -l 'use[A-Z]' 2>/dev/null
```
Pour chaque fichier trouvé, vérifier que TOUS les hooks (useState, useEffect,
useCallback, useMemo, useRef, useNavigate, useRouterState, etc.) sont appelés:
- AVANT tout return conditionnel
- AVANT toute logique qui pourrait court-circuiter le render
- TOUJOURS dans le même ordre à chaque render

Si un hook est appelé après un `if (...) return ...`, c'est un bug — le déplacer
en haut du composant.

### 3b. Optional chaining sur les réponses API
Vérifier que les accès aux propriétés des réponses API utilisent `?.` ou des
guards `&&`:
- `data.config?.symbols` au lieu de `data.config.symbols`
- `data.insights?.demo?.recommendations` au lieu de `data.insights.demo.recommendations`
- `(array ?? []).map()` au lieu de `array.map()` si l'array peut être undefined

### 3c. Imports circulaires
Vérifier qu'aucun fichier dans `src/routes/` n'importe depuis un autre fichier
dans `src/routes/` (ça crée des dépendances circulaires dans le bundler).
Les composants partagés doivent vivre dans `src/lib/` ou `src/components/`.

## Étape 4 — Vérification des routes TanStack

Si des fichiers dans `src/routes/` ont été ajoutés ou renommés:

### 4a. Convention de nommage
- Route simple: `src/routes/admin.tsx` → `/admin`
- Route enfant: `src/routes/admin.users.$userId.tsx` → `/admin/users/:userId`
- Les paramètres utilisent `$param`, pas `:param`

### 4b. Outlet pour les routes enfants
Si une route parent (ex: `admin.tsx`) a des routes enfants, elle DOIT rendre
`<Outlet />` quand on est sur une route enfant, sinon la page enfant ne
s'affichera pas. Vérifier avec:
```bash
grep -l 'Outlet' src/routes/admin.tsx
```

### 4c. RouteTree généré
Vérifier que `src/routeTree.gen.ts` contient bien la nouvelle route:
```bash
grep 'NomDeLaRoute' src/routeTree.gen.ts
```

## Étape 5 — Vérification des API routes

Si des fichiers dans `src/routes/api/` ont été ajoutés:

### 5a. Convention d'import
- Utiliser `createFileRoute` de `@tanstack/react-router` (PAS `createAPIFileRoute`)
- Définir une fonction `json()` locale (pas d'import depuis `@tanstack/start`)
- Le handler va dans `server.handlers.GET` ou `server.handlers.POST`

### 5b. Auth admin
Toutes les routes `/api/admin/*` doivent vérifier `requireAdmin(request)` et
retourner 403 si non admin.

## Étape 6 — Résumé

Après toutes les vérifications, afficher un résumé:

```
✓ TypeScript: OK (0 erreurs)
✓ Build: OK (26s)
✓ React hooks: OK (aucun hook après return conditionnel)
✓ Routes: OK (Outlet présent, routeTree généré)
✓ API: OK (auth admin vérifiée)
```

Si une vérification échoue, afficher:
```
✗ TypeScript: 3 erreurs
  → src/routes/admin.tsx:512 — Type 'string' not assignable to 'number'
  → src/lib/bot-engine.ts:89 — Property 'foo' does not exist
  → ...
```

## Invocation automatique

Ce skill DOIT être invoqué automatiquement par l'agent:
- Avant tout `git push`
- Après avoir modifié des fichiers `.tsx` ou `.ts`
- Quand l'utilisateur demande "vérifie le code" ou "pousse sur github"
