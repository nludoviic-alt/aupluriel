// Adaptive per-indicator weight learning — the "learns from its mistakes" layer.
//
// generateSignal() (indicators.ts) scores each trade candidate as a fixed sum of
// hand-tuned indicator points (RSI, MACD, ADX...), calibrated once by a human and
// never revisited. This module tracks, per symbol and per scoring component, how
// often that component has actually been on the winning side of a REAL closed
// trade, and derives a bounded multiplier from it — components that have
// historically been right more often get proportionally more say in future
// signals for that symbol; components that are frequently wrong get down-weighted.
// It does not replace generateSignal's logic, it recalibrates its existing weights
// from realized outcomes instead of leaving them static forever.

import type { SignalComponent, SignalComponentName } from "./indicators";

interface ComponentStats {
  wins: number;
  losses: number;
}

type SymbolStats = Partial<Record<SignalComponentName, ComponentStats>>;
type WeightStore = Record<string, SymbolStats> & { _global?: SymbolStats };

const STORAGE_KEY = "lio23.indicator_weights";
const GLOBAL_KEY = "_global";

// Bounds keep a single noisy/overfit component from ever dominating or being
// zeroed out entirely — this stays a recalibration, not an on/off switch.
const MIN_WEIGHT = 0.6;
const MAX_WEIGHT = 1.5;
// How many "virtual" global-prior trades to blend in before a symbol's own
// sample is trusted on its own — simple shrinkage so 2-3 lucky/unlucky trades
// on a thinly-traded symbol can't swing its weights wildly.
const PRIOR_STRENGTH = 10;
// Recency decay: without this, a component's win/loss tally accumulates
// forever, so a component that worked for its first 500 trades but has been
// wrong for the last 50 (a regime change) is barely moved — the stale
// majority drowns out the recent signal. Every new outcome first decays the
// existing tally by this factor, giving old trades exponentially less say.
// Half-life ~200 trades: DECAY^200 = 0.5.
const DECAY = Math.pow(0.5, 1 / 200);

function loadStore(): WeightStore {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveStore(store: WeightStore) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

/**
 * Records the outcome of a closed trade: each scoring component that was
 * decisive in that trade's signal gets a win/loss tally, both for this specific
 * symbol and in the global cross-symbol pool used to stabilize thin samples.
 */
export function recordComponentOutcomes(symbol: string, components: SignalComponent[] | undefined, won: boolean) {
  if (!components?.length) return;
  const store = loadStore();
  const symbolStats: SymbolStats = store[symbol] ?? {};
  const globalStats: SymbolStats = store[GLOBAL_KEY] ?? {};

  for (const c of components) {
    const sym = symbolStats[c.name] ?? { wins: 0, losses: 0 };
    const glob = globalStats[c.name] ?? { wins: 0, losses: 0 };
    sym.wins *= DECAY; sym.losses *= DECAY;
    glob.wins *= DECAY; glob.losses *= DECAY;
    if (won) { sym.wins++; glob.wins++; } else { sym.losses++; glob.losses++; }
    symbolStats[c.name] = sym;
    globalStats[c.name] = glob;
  }

  store[symbol] = symbolStats;
  store[GLOBAL_KEY] = globalStats;
  saveStore(store);
}

function weightFor(sym: ComponentStats | undefined, glob: ComponentStats | undefined): number {
  const symTotal = (sym?.wins ?? 0) + (sym?.losses ?? 0);
  const globTotal = (glob?.wins ?? 0) + (glob?.losses ?? 0);
  if (symTotal + globTotal < 3) return 1; // no data anywhere yet — original fixed behavior

  const priorWinRate = globTotal > 0 ? (glob!.wins) / globTotal : 0.5;
  const blendedWinRate = ((sym?.wins ?? 0) + priorWinRate * PRIOR_STRENGTH) / (symTotal + PRIOR_STRENGTH);
  const w = 0.5 + blendedWinRate; // 0% winrate -> 0.5x, 50% -> 1.0x (neutral), 100% -> 1.5x
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, w));
}

/** Learned weight multipliers for this symbol, ready to pass as generateSignal's `options.weights`. */
export function getLearnedWeights(symbol: string): Partial<Record<SignalComponentName, number>> {
  const store = loadStore();
  const symbolStats = store[symbol] ?? {};
  const globalStats = store[GLOBAL_KEY] ?? {};
  const names = new Set<SignalComponentName>([
    ...(Object.keys(symbolStats) as SignalComponentName[]),
    ...(Object.keys(globalStats) as SignalComponentName[]),
  ]);
  const weights: Partial<Record<SignalComponentName, number>> = {};
  for (const name of names) {
    weights[name] = weightFor(symbolStats[name], globalStats[name]);
  }
  return weights;
}

/** For the Strategies/Journal UI: readable win-rate-per-component breakdown for a symbol. */
export function getComponentBreakdown(symbol: string): { name: SignalComponentName; wins: number; losses: number; weight: number }[] {
  const store = loadStore();
  const symbolStats = store[symbol] ?? {};
  const globalStats = store[GLOBAL_KEY] ?? {};
  return (Object.keys(symbolStats) as SignalComponentName[])
    .map((name) => ({
      name,
      wins: symbolStats[name]?.wins ?? 0,
      losses: symbolStats[name]?.losses ?? 0,
      weight: weightFor(symbolStats[name], globalStats[name]),
    }))
    .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
}
