// Apprentissage adaptatif PARTAGÉ — le pendant serveur d'indicator-weights.ts.
//
// La version navigateur apprend dans le localStorage de chaque utilisateur :
// chacun apprend seul, et le moteur serveur 24/7 n'en profite pas. Ici les
// statistiques win/loss par (symbole, composant) vivent dans SQLite et sont
// agrégées sur les trades réels de TOUS les utilisateurs — 4-5 comptes qui
// tradent en démo entraînent donc le même cerveau, et le moteur serveur
// applique ces poids appris à chaque scan.
//
// Même formule que la version navigateur (mêmes bornes, même lissage) pour que
// les deux moteurs restent comparables.

import { getDb } from "./db.server";
import type { SignalComponent, SignalComponentName } from "./indicators";

const GLOBAL_KEY = "_global";

// Bounds keep a single noisy/overfit component from ever dominating or being
// zeroed out entirely — this stays a recalibration, not an on/off switch.
const MIN_WEIGHT = 0.6;
const MAX_WEIGHT = 1.5;
// Virtual global-prior trades blended in before a symbol's own sample is
// trusted — 2-3 lucky trades on a thin symbol can't swing its weights wildly.
const PRIOR_STRENGTH = 10;
// Recency decay — same reasoning as the browser version (indicator-weights.ts):
// old outcomes fade so a component that stops working recently is down-weighted
// faster than a huge stale history would otherwise allow. Half-life ~200 trades.
const DECAY = Math.pow(0.5, 1 / 200);

interface StatRow {
  component: string;
  wins: number;
  losses: number;
}

/**
 * Records the outcome of a closed trade: each scoring component that was
 * decisive gets a win/loss tally, for the symbol and in the global pool.
 * Shared across every user — this is the "train it together" surface.
 */
export function recordComponentOutcomesServer(
  symbol: string,
  components: SignalComponent[] | undefined,
  won: boolean,
): void {
  if (!components?.length) return;
  const db = getDb();
  const select = db.prepare(`SELECT wins, losses FROM indicator_stats WHERE symbol = ? AND component = ?`);
  const upsert = db.prepare(`
    INSERT INTO indicator_stats (symbol, component, wins, losses, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT(symbol, component) DO UPDATE SET
      wins = excluded.wins,
      losses = excluded.losses,
      updated_at = unixepoch()
  `);
  // Decay-then-add instead of a pure SQL increment — old outcomes need to fade
  // (see DECAY above), which requires reading the current tally first.
  const decayAndAdd = (key: string, component: string) => {
    const row = select.get(key, component) as { wins: number; losses: number } | undefined;
    const wins = (row?.wins ?? 0) * DECAY + (won ? 1 : 0);
    const losses = (row?.losses ?? 0) * DECAY + (won ? 0 : 1);
    upsert.run(key, component, wins, losses);
  };
  const run = db.transaction(() => {
    for (const c of components) {
      decayAndAdd(symbol, c.name);
      decayAndAdd(GLOBAL_KEY, c.name);
    }
  });
  run();
}

function weightFor(
  sym: { wins: number; losses: number } | undefined,
  glob: { wins: number; losses: number } | undefined,
): number {
  const symTotal = (sym?.wins ?? 0) + (sym?.losses ?? 0);
  const globTotal = (glob?.wins ?? 0) + (glob?.losses ?? 0);
  if (symTotal + globTotal < 3) return 1; // no data anywhere yet — original fixed behavior

  const priorWinRate = globTotal > 0 ? glob!.wins / globTotal : 0.5;
  const blendedWinRate = ((sym?.wins ?? 0) + priorWinRate * PRIOR_STRENGTH) / (symTotal + PRIOR_STRENGTH);
  const w = 0.5 + blendedWinRate; // 0% winrate -> 0.5x, 50% -> 1.0x (neutral), 100% -> 1.5x
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w));
}

/** Learned weight multipliers for this symbol, from the shared cross-user stats. */
export function getLearnedWeightsServer(symbol: string): Partial<Record<SignalComponentName, number>> {
  const db = getDb();
  const rows = db
    .prepare("SELECT symbol, component, wins, losses FROM indicator_stats WHERE symbol IN (?, ?)")
    .all(symbol, GLOBAL_KEY) as (StatRow & { symbol: string })[];

  const symStats = new Map<string, StatRow>();
  const globStats = new Map<string, StatRow>();
  for (const r of rows) {
    (r.symbol === GLOBAL_KEY ? globStats : symStats).set(r.component, r);
  }

  const names = new Set<string>([...symStats.keys(), ...globStats.keys()]);
  const weights: Partial<Record<SignalComponentName, number>> = {};
  for (const name of names) {
    weights[name as SignalComponentName] = weightFor(symStats.get(name), globStats.get(name));
  }
  return weights;
}

/** Readable breakdown for the UI: per-component win rates and learned weights. */
export function getComponentBreakdownServer(
  symbol?: string,
): { symbol: string; component: string; wins: number; losses: number; weight: number }[] {
  const db = getDb();
  const rows = (
    symbol
      ? db.prepare("SELECT symbol, component, wins, losses FROM indicator_stats WHERE symbol = ?").all(symbol)
      : db.prepare("SELECT symbol, component, wins, losses FROM indicator_stats ORDER BY symbol").all()
  ) as (StatRow & { symbol: string })[];

  const globRows = db
    .prepare("SELECT component, wins, losses FROM indicator_stats WHERE symbol = ?")
    .all(GLOBAL_KEY) as StatRow[];
  const glob = new Map(globRows.map((r) => [r.component, r]));

  return rows.map((r) => ({
    symbol: r.symbol,
    component: r.component,
    wins: r.wins,
    losses: r.losses,
    weight: weightFor(r, glob.get(r.component)),
  }));
}
