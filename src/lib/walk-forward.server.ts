// Genuine out-of-sample validation for the strategy-tournament's Track B
// (Multiplier/path-dependent) engines — every backtest run so far this week
// (this codebase's history included: "Bon Jour Crash", "Best Day Boom", and
// today's own first tournament pass) has been a SINGLE window: sweep a grid,
// report whichever combo did best ON THAT SAME WINDOW. That's an in-sample
// number — it always looks better than reality, because the combo was
// chosen BECAUSE it fit that data, not because it has a genuine edge. This
// module answers a different, harder question: if you had re-optimized
// periodically and only ever traded on data you hadn't seen yet, what would
// you actually have made?
//
// Method: split entries chronologically into `folds` equal chunks. For fold
// i (2..folds), pick the best combo using ONLY entries from folds before it
// (expanding window — more realistic than a fixed-size rolling window given
// how little data most of these engines have), then score that fixed combo
// against fold i's entries, which the selection step never saw. Sum only
// the out-of-sample folds — that total is the walk-forward result. The
// in-sample "best combo over everything" is reported alongside it
// specifically so the GAP between the two numbers is visible: a strategy
// whose in-sample and out-of-sample numbers are close is far more trustworthy
// than one where in-sample looks great and out-of-sample doesn't.
import type { ServerCandle } from "./deriv.server";
import type { RawEntry, SweepSimResult } from "./boom-sweep.server";

export interface WalkForwardFoldResult<C> {
  fold: number;
  trainEntries: number;
  testEntries: number;
  chosenCombo: C | null; // null if no training data qualified any combo
  result: SweepSimResult | null;
}

export interface WalkForwardResult<C> {
  folds: number;
  usableFolds: number; // folds that actually had training data available
  outOfSample: { trades: number; wins: number; winRate: number; totalPnlUsd: number };
  inSampleBest: { combo: C | null; totalPnlUsd: number; trades: number };
  overfitGapUsd: number; // inSampleBest.totalPnlUsd - outOfSample.totalPnlUsd — larger = less trustworthy
  perFold: WalkForwardFoldResult<C>[];
}

/**
 * Generic over both simulateCombo() (percentage-of-stake engines: confluence,
 * liquidity-sweep, spike-hunter) and simulateComboStructural() (scalping,
 * which prices its own riskAbs/rewardAbs) — both already share compatible
 * (entries, candles, combo) -> SweepSimResult shapes, just close over
 * whichever one applies at the call site.
 */
export function walkForwardEvaluate<E extends RawEntry, C>(
  entries: E[],
  candles: ServerCandle[],
  grid: C[],
  simulate: (entries: E[], candles: ServerCandle[], combo: C) => SweepSimResult,
  folds = 3,
): WalkForwardResult<C> {
  const sorted = [...entries].sort((a, b) => a.entryEpoch - b.entryEpoch);
  const foldSize = Math.ceil(sorted.length / folds);
  const foldEntries: E[][] = [];
  for (let i = 0; i < folds; i++) foldEntries.push(sorted.slice(i * foldSize, (i + 1) * foldSize));

  const perFold: WalkForwardFoldResult<C>[] = [];
  let oosTrades = 0, oosWins = 0, oosPnl = 0;

  for (let i = 1; i < folds; i++) {
    const train = foldEntries.slice(0, i).flat();
    const test = foldEntries[i];
    if (train.length === 0 || test.length === 0) {
      perFold.push({ fold: i + 1, trainEntries: train.length, testEntries: test.length, chosenCombo: null, result: null });
      continue;
    }
    let best: { combo: C; pnl: number } | null = null;
    for (const combo of grid) {
      const r = simulate(train, candles, combo);
      if (!best || r.totalPnlUsd > best.pnl) best = { combo, pnl: r.totalPnlUsd };
    }
    const chosenCombo = best!.combo;
    const testResult = simulate(test, candles, chosenCombo);
    perFold.push({ fold: i + 1, trainEntries: train.length, testEntries: test.length, chosenCombo, result: testResult });
    oosTrades += testResult.trades;
    oosWins += testResult.wins;
    oosPnl += testResult.totalPnlUsd;
  }

  // In-sample baseline: best combo evaluated on the SAME full data it was
  // chosen from — the number every backtest in this codebase reported before
  // today. Deliberately computed the naive way for the comparison to mean
  // something.
  let inSampleBest: { combo: C | null; totalPnlUsd: number; trades: number } = { combo: null, totalPnlUsd: -Infinity, trades: 0 };
  for (const combo of grid) {
    const r = simulate(sorted, candles, combo);
    if (r.totalPnlUsd > inSampleBest.totalPnlUsd) inSampleBest = { combo, totalPnlUsd: r.totalPnlUsd, trades: r.trades };
  }
  if (inSampleBest.totalPnlUsd === -Infinity) inSampleBest = { combo: null, totalPnlUsd: 0, trades: 0 };

  const usableFolds = perFold.filter((f) => f.result !== null).length;
  return {
    folds,
    usableFolds,
    outOfSample: {
      trades: oosTrades,
      wins: oosWins,
      winRate: oosTrades > 0 ? (oosWins / oosTrades) * 100 : 0,
      totalPnlUsd: Math.round(oosPnl * 100) / 100,
    },
    inSampleBest: { combo: inSampleBest.combo, totalPnlUsd: Math.round(inSampleBest.totalPnlUsd * 100) / 100, trades: inSampleBest.trades },
    overfitGapUsd: Math.round((inSampleBest.totalPnlUsd - oosPnl) * 100) / 100,
    perFold,
  };
}
