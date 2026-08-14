# OANDA & Gold-family presets — archivé le 2026-08-14

Le compte trade désormais **uniquement sur les indices synthétiques Deriv**
(Boom/Crash/Vol/Range Break). OANDA et les 4 presets qui en dépendaient ont
été retirés en deux temps :

1. **Retrait fonctionnel** (commit `feat: retire OANDA and the gold-family
   presets`) : `gold`, `goldv2`, `liquidity`, `liquidityv2` retirés de
   `ACTIVE_PRESETS` (ils ne peuvent plus démarrer), kill switch
   `OANDA_ENABLED = false` dans `src/lib/bot-engine.server.ts`, UI OANDA
   retirée (Réglages, badges admin, tuile solde).
2. **Nettoyage UI + fond de tiroir** (ce commit) : les onglets/cartes de ces
   4 presets ont été retirés des pickers utilisateur (Auto-Trader, Piste,
   Stratégies, Opportunités) pour qu'un utilisateur ne tombe plus sur une
   impasse ("Ce preset est désactivé") en cliquant dessus. Le scheduler
   auto-backtest et le scanner Opportunités ont aussi été corrigés pour ne
   plus jamais tenter de démarrer `liquidity` en tâche de fond.

**Rien n'a été supprimé côté moteur ou côté définitions de config** — tout
reste dans le code, juste débranché de l'UI et des boucles automatiques. Ce
document sert de carte pour tout réactiver.

## Comment réactiver (si un jour on reprend OANDA/Gold)

### 1. Réactiver le moteur
- `src/lib/bot-engine.server.ts` : repasser `OANDA_ENABLED` à `true`.
- `src/lib/bot-engine.server.ts` : `ACTIVE_PRESETS` — retirer le filtre
  `!isGoldPreset(p)`, ou ajouter explicitement `gold`, `goldv2`, `liquidity`,
  `liquidityv2` à la liste.
- `src/lib/signal-core.ts` et `src/lib/signal-core.server.ts` :
  `DEFAULT_CONFIG.enableOanda` — repasser à `true` si on veut le fallback
  OANDA actif par défaut pour les autres presets aussi (pas obligatoire pour
  Gold, qui force `enableOanda: true` lui-même via `lockGoldOanda`).

### 2. Réactiver l'UI Réglages (identifiants OANDA)
Le formulaire complet (état `oandaKey`/`oandaAccountId`/`oandaPractice`,
`saveOanda()`, la carte "OANDA API", le switch `enableOanda` dans
`toggleBroker`) a été retiré de `src/routes/settings.tsx`. Voir l'historique
git du commit `feat: retire OANDA and the gold-family presets` pour la
version complète à réintégrer — c'était une carte autonome, calquée sur les
cartes Kraken/Binance juste au-dessus dans le même fichier.

### 3. Réactiver les badges admin / soldes
- `src/routes/admin.tsx`, `src/routes/admin.users.$userId.tsx` : réajouter
  le badge/dot OANDA (retiré dans le même commit — même historique git).
  Restaurer aussi la colonne `has_oanda` dans
  `src/routes/api/admin/users.ts`.
- `src/routes/portfolio.tsx`, `src/routes/index.tsx` : réajouter la tuile de
  solde OANDA et le calcul "Balance Total (Deriv + OANDA)".
- `src/components/kpi-card.tsx` : réajouter la tonalité `"oanda"` au type
  `Tone` et à `TONE_STYLES`.

### 4. Réactiver les 4 presets dans l'UI de trading
Les définitions de config canoniques (`LIQUIDITY_PRESET`, `GOLD_PRESET`,
`LIQUIDITY_V2_PRESET`, `GOLD_V2_PRESET`) sont **toujours exportées** depuis
`src/lib/autotrader.ts` (lignes ~748, ~810, ~887, ~901 au 2026-08-14) — elles
n'ont jamais bougé, seul leur câblage dans les pickers a été retiré :

- `src/routes/autotrader.tsx` : réajouter `liquidity`/`gold`/`liquidityv2`/
  `goldv2` au type `PresetKey`, à `presetLabels`, `PRESET_PRESENTATION`,
  `PRESET_META_MAP`, `PRESET_ORDER`, et aux branches de `selectPresetView()`
  (réimporter `LIQUIDITY_PRESET`/`GOLD_PRESET`/`LIQUIDITY_V2_PRESET`/
  `GOLD_V2_PRESET` depuis `@/lib/autotrader`).
- `src/components/trade-journal-section.tsx` : même élargissement du type
  `PresetKey` local.
- `src/routes/piste.tsx` : réajouter la catégorie `"gold"`, le bouton de
  filtre "Or (XAU)", et les 4 entrées dans `TRACKS` (contenu exact dans
  l'historique git du même commit).
- `src/routes/opportunities.tsx` : réélargir le type `Preset` et
  `PRESET_STYLE`.
- `src/lib/opportunities.server.ts` : le filtre
  `.filter((p) => ACTIVE_PRESETS.includes(p))` sur `PRESETS` redevient un
  no-op automatiquement dès que `ACTIVE_PRESETS` réinclut ces presets — rien
  à toucher ici.

### 5. Réactiver le template de stratégie "SMC — Liquidité Externe & AVG 50-60%"
Retiré de `src/lib/preset-strategies.ts` (`OFFICIAL_PRESET_STRATEGIES`),
remplacé par un commentaire d'archivage à son emplacement d'origine (juste
avant le commentaire de retrait de `"multi-balanced"`). La définition
complète (`id: "smc-liquidity-avg"`, `targetPreset: "liquidity"`, params,
`configOverride`) est dans l'historique git de ce commit — copier-coller
telle quelle, elle n'a pas changé.

`src/lib/strategies.ts` (`Strategy["targetPreset"]`) et le sélecteur dans
`src/routes/strategies.tsx` (`<option value="liquidity">`/`<option
value="gold">`) doivent aussi réintégrer `"liquidity"` et `"gold"` pour que
les utilisateurs puissent recréer des stratégies custom ciblant ces presets.

### 6. Réactiver le scheduler auto-backtest
`src/lib/auto-backtest.server.ts` : la garde
`if (ACTIVE_PRESETS.includes("liquidity")) { ... }` autour du bloc
verdict/sweep liquidity redevient active automatiquement dès que
`ACTIVE_PRESETS` réinclut `"liquidity"` — rien à toucher ici non plus.

## Ce qui n'a PAS été touché (déjà inerte, pas de nettoyage nécessaire)

- `src/lib/oanda.server.ts` — le client OANDA lui-même (classe
  `OandaTradingConnection`, `isOandaSymbol`, `fetchOandaCandles`,
  `closeOandaSocket`) est resté intact. Toujours importé par
  `bot-engine.server.ts` pour le typage ; jamais instancié tant que
  `OANDA_ENABLED` est `false`.
- `src/lib/bot-engine.server.ts` — `isGoldPreset()`, `lockGoldOanda()`,
  `hasOpenGoldExposure()`, le hard-gate dans `startBotForUser()` (lignes
  ~4567-4572 au 2026-08-14) : tout est resté en place. Devenu du code mort
  une fois `ACTIVE_PRESETS` filtré (la fonction ne peut plus être atteinte
  pour un preset gold), mais sans risque à laisser — c'est le même style de
  garde défensive que le résidu "mode simulation" déjà présent dans ce
  fichier.
- `src/routes/api/bot.ts`, `src/routes/api/admin/user-config.ts`,
  `src/routes/api/admin/bot.ts` — la logique qui verrouille
  `broker:"oanda"`/`enableOanda:true` pour un preset gold à la
  sauvegarde/reset de config. Purement interactif (pas de boucle de fond),
  donc pas de risque de spam de logs ; laissé tel quel.
- Colonnes `oanda_api_key`/`oanda_account_id`/`oanda_is_practice` dans
  `user_settings` (schéma DB) — les identifiants déjà enregistrés par
  user 2 restent en base, juste plus jamais lus tant qu'OANDA_ENABLED est
  faux.

## Pourquoi ce n'était pas un simple `git revert`

Deux commits séparés ont touché OANDA (retrait fonctionnel puis nettoyage
UI), chacun mélangé avec d'autres changements du même jour — un revert
brut aurait aussi défait des corrections sans rapport. Cette page sert de
liste de contrôle manuelle à la place.
