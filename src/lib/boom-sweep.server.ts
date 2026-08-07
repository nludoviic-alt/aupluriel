// Parameter sweep for the Boom preset (BOOM_PRESET in autotrader.ts) — same
// path-dependent stop-loss/take-profit walk-forward logic as
// backtestOandaSlTpServer (backtest.server.ts), restructured to fetch candles
// and generate signals ONCE per symbol, then replay every TP/SL/confidence/TF
// combo against that cached data in memory. backtestOandaSlTpServer refetches
// candles on every call, which is fine for a single backtest but far too slow
// for a grid sweep (measured: naive per-combo refetch made a 288-run sweep
// take hours; fetch-once brings the whole thing under a few seconds).
//
// Shared by the /api/backtest/boom-sweep route (used by the Backtest page)
// and the tune-boom-preset Claude Code skill (.claude/skills/tune-boom-preset).
import { fetchCandlesServer, type ServerCandle } from "./deriv.server";
import { atr, generateSignal } from "./indicators";
import { aggregateTfSignals, GRANULARITY_SECONDS, TIMEFRAMES, type TfSignalMap, type Veto4hMode } from "./signal-core";
import { getLearnedWeightsServer } from "./indicator-weights.server";

const GRAN_MINUTES: Record<string, number> = { "5m": 5, "15m": 15, "1H": 60, "4H": 240 };
const LOOKBACK = 250;

/** Mirrors sliceAsOf() in backtest.server.ts (not exported there). */
function sliceAsOf(candles: ServerCandle[], epoch: number, lookback: number): ServerCandle[] {
  let lo = 0, hi = candles.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].epoch <= epoch) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (idx < 0) return [];
  return candles.slice(Math.max(0, idx - lookback + 1), idx + 1);
}

export interface SweepCombo {
  takeProfitPctOfStake: number;
  stopLossPctOfStake: number;
  minConfidence: number;
  minTfAgreement: number;
}

export function defaultSweepGrid(quick: boolean): SweepCombo[] {
  const TP = quick ? [5, 10] : [5, 8, 10];
  const SL = quick ? [10, 20] : [10, 15, 20, 30];
  const CONF = quick ? [55] : [50, 55, 60];
  const TF = quick ? [2] : [2, 3];
  const combos: SweepCombo[] = [];
  for (const takeProfitPctOfStake of TP) {
    for (const stopLossPctOfStake of SL) {
      for (const minConfidence of CONF) {
        for (const minTfAgreement of TF) {
          combos.push({ takeProfitPctOfStake, stopLossPctOfStake, minConfidence, minTfAgreement });
        }
      }
    }
  }
  return combos;
}

export interface RawEntry {
  entryEpoch: number;
  entryPrice: number;
  direction: "CALL" | "PUT";
  confidence: number;
  agreement: number;
  volatilityPct: number;
}

export interface AnalyzedSymbol {
  entries: RawEntry[];
  c5m: ServerCandle[];
}

/** Fetches all 4 timeframes ONCE and generates a signal for every historical
 * entry point — independent of minConfidence/minTfAgreement, which are just
 * a threshold applied AFTER the fact (confirmed in backtestOandaSlTpServer:
 * the filter happens outside aggregateTfSignals). This is the expensive part
 * (network + indicator math) and it only needs to run once per symbol. */
export async function fetchAndAnalyzeSymbol(
  symbolDeriv: string,
  testCandles: number,
  maxHoldMinutes: number,
  veto4h: Veto4hMode = "off",
  vetoDaily: Veto4hMode = "off",
): Promise<AnalyzedSymbol> {
  const testSpanMinutes = testCandles * 15;
  const holdCandleMargin = Math.ceil(maxHoldMinutes / 5) + 20;

  let weights: ReturnType<typeof getLearnedWeightsServer> | undefined;
  try { weights = getLearnedWeightsServer(symbolDeriv); } catch { /* base weights */ }

  const countFor = (tf: (typeof TIMEFRAMES)[number], margin = 20) =>
    Math.ceil((testSpanMinutes + LOOKBACK * GRAN_MINUTES[tf]) / GRAN_MINUTES[tf]) + margin;

  const [c5m, c15m, c1h, c4h] = await Promise.all([
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["5m"], countFor("5m") + holdCandleMargin),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["15m"], countFor("15m")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["1H"], countFor("1H")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["4H"], countFor("4H")),
  ]);
  const bySrc: Record<string, ServerCandle[]> = { "5m": c5m, "15m": c15m, "1H": c1h, "4H": c4h };

  const start = Math.max(LOOKBACK, c15m.length - testCandles);
  const end = c15m.length;
  const maxHoldSec = maxHoldMinutes * 60;
  const lastAvailableEpoch = c5m.length ? c5m[c5m.length - 1].epoch : 0;

  const entries: RawEntry[] = [];
  for (let i = start; i < end; i++) {
    const asOfEpoch = c15m[i - 1].epoch;
    const tfSignals: TfSignalMap = {};
    let slice15m: ServerCandle[] = [];
    for (const tf of TIMEFRAMES) {
      const slice = sliceAsOf(bySrc[tf], asOfEpoch, LOOKBACK);
      if (tf === "15m") slice15m = slice;
      if (slice.length >= 60) tfSignals[tf] = generateSignal(slice, { weights });
    }
    let volatilityPct = 0;
    if (slice15m.length >= 15) {
      const atrSeries = atr(slice15m.map((c) => c.high), slice15m.map((c) => c.low), slice15m.map((c) => c.close), 14);
      const atrNow = atrSeries[atrSeries.length - 1];
      const price = slice15m[slice15m.length - 1].close;
      if (atrNow !== null && price > 0) volatilityPct = (atrNow / price) * 100;
    }
    const analysis = aggregateTfSignals(tfSignals, volatilityPct, 1, veto4h, 0, undefined, vetoDaily);
    if (!analysis.direction) continue;

    const entryEpoch = c15m[i - 1].epoch;
    if (entryEpoch + maxHoldSec > lastAvailableEpoch) continue; // not enough forward data yet

    entries.push({
      entryEpoch, entryPrice: c15m[i - 1].close, direction: analysis.direction,
      confidence: analysis.confidence, agreement: analysis.agreement, volatilityPct: analysis.volatilityPct,
    });
  }
  return { entries, c5m };
}

export interface SweepSimResult {
  trades: number;
  wins: number;
  winRate: number;
  breakEvenWinRate: number;
  totalPnlUsd: number;
  avgHoldMinutes: number;
  stopHits: number;
  targetHits: number;
  timeExits: number;
}

/** Cheap part: filter cached entries by the combo's confidence/TF threshold,
 * then walk forward through already-fetched 5m candles to see which barrier
 * (stop or target) gets hit first — no network calls, pure in-memory loop. */
export function simulateCombo(
  entries: AnalyzedSymbol["entries"],
  c5m: AnalyzedSymbol["c5m"],
  combo: SweepCombo,
  stakeUsd: number,
  leverage: number,
  maxHoldMinutes: number,
): SweepSimResult {
  const maxHoldSec = maxHoldMinutes * 60;
  const leveredNotional = stakeUsd * leverage;
  const stopLossUsd = stakeUsd * (combo.stopLossPctOfStake / 100);
  const takeProfitUsd = stakeUsd * (combo.takeProfitPctOfStake / 100);
  const stopFrac = stopLossUsd / leveredNotional;
  const tpFrac = takeProfitUsd / leveredNotional;

  let wins = 0, losses = 0, stopHits = 0, targetHits = 0, timeExits = 0;
  let totalPnlUsd = 0, totalHoldMinutes = 0;

  for (const e of entries) {
    if (e.confidence < combo.minConfidence || e.agreement < combo.minTfAgreement) continue;

    const slPrice = e.direction === "CALL" ? e.entryPrice * (1 - stopFrac) : e.entryPrice * (1 + stopFrac);
    const tpPrice = e.direction === "CALL" ? e.entryPrice * (1 + tpFrac) : e.entryPrice * (1 - tpFrac);
    const forward = c5m.filter((c) => c.epoch > e.entryEpoch && c.epoch <= e.entryEpoch + maxHoldSec);

    let outcome: "stop" | "target" | "time" = "time";
    let exitPrice = forward.length ? forward[forward.length - 1].close : e.entryPrice;
    let exitEpoch = e.entryEpoch + maxHoldSec;
    for (const c of forward) {
      const hitStop = e.direction === "CALL" ? c.low <= slPrice : c.high >= slPrice;
      const hitTarget = e.direction === "CALL" ? c.high >= tpPrice : c.low <= tpPrice;
      if (hitStop) { outcome = "stop"; exitPrice = slPrice; exitEpoch = c.epoch; break; }
      if (hitTarget) { outcome = "target"; exitPrice = tpPrice; exitEpoch = c.epoch; break; }
    }

    const pctMove = e.direction === "CALL" ? (exitPrice - e.entryPrice) / e.entryPrice : (e.entryPrice - exitPrice) / e.entryPrice;
    const pnlUsd = outcome === "stop" ? -stopLossUsd : outcome === "target" ? takeProfitUsd : leveredNotional * pctMove;
    const won = pnlUsd > 0;

    if (outcome === "stop") stopHits++;
    else if (outcome === "target") targetHits++;
    else timeExits++;
    won ? wins++ : losses++;
    totalPnlUsd += pnlUsd;
    totalHoldMinutes += (exitEpoch - e.entryEpoch) / 60;
  }

  const trades = wins + losses;
  const effectiveRR = combo.takeProfitPctOfStake / combo.stopLossPctOfStake;
  return {
    trades, wins,
    winRate: trades > 0 ? (wins / trades) * 100 : 0,
    breakEvenWinRate: (1 / (1 + effectiveRR)) * 100,
    totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    avgHoldMinutes: trades > 0 ? Math.round(totalHoldMinutes / trades) : 0,
    stopHits, targetHits, timeExits,
  };
}

export interface SweepArgs {
  symbols: string[];
  candles: number;
  stake: number;
  leverage: number;
  hold: number;
  quick: boolean;
}

export interface SweepComboReport {
  combo: SweepCombo;
  trades: number;
  totalPnlUsd: number;
  winRate: number;
  breakEvenWinRate: number;
  stopHits: number;
  targetHits: number;
  timeExits: number;
  perSymbol: (SweepCombo & { symbol: string } & SweepSimResult)[];
}

export interface SweepReport {
  args: SweepArgs;
  signalCountsBySymbol: Record<string, number>;
  ranked: SweepComboReport[]; // sorted best (highest total $ P&L) first
}

/** Runs the full grid across every symbol and returns combos ranked by total
 * $ P&L across all symbols combined — BOOM_PRESET is one shared config, so
 * that combined total is the only number that maps onto a real change,
 * unlike per-symbol "best" answers which can't each be applied separately. */
export async function sweepBoomPreset(args: SweepArgs): Promise<SweepReport> {
  const grid = defaultSweepGrid(args.quick);
  type Row = SweepCombo & { symbol: string } & SweepSimResult;
  const allRows: Row[] = [];
  const signalCountsBySymbol: Record<string, number> = {};

  for (const symbol of args.symbols) {
    const { entries, c5m } = await fetchAndAnalyzeSymbol(symbol, args.candles, args.hold);
    signalCountsBySymbol[symbol] = entries.length;
    for (const combo of grid) {
      const r = simulateCombo(entries, c5m, combo, args.stake, args.leverage, args.hold);
      allRows.push({ ...combo, symbol, ...r });
    }
  }

  const byCombo = new Map<string, Row[]>();
  for (const r of allRows) {
    const key = `TP${r.takeProfitPctOfStake}_SL${r.stopLossPctOfStake}_C${r.minConfidence}_TF${r.minTfAgreement}`;
    if (!byCombo.has(key)) byCombo.set(key, []);
    byCombo.get(key)!.push(r);
  }

  const ranked: SweepComboReport[] = Array.from(byCombo.values()).map((rows) => {
    const trades = rows.reduce((s, r) => s + r.trades, 0);
    const totalPnlUsd = Math.round(rows.reduce((s, r) => s + r.totalPnlUsd, 0) * 100) / 100;
    const wins = rows.reduce((s, r) => s + r.wins, 0);
    const winRate = trades > 0 ? (wins / trades) * 100 : 0;
    const stopHits = rows.reduce((s, r) => s + r.stopHits, 0);
    const targetHits = rows.reduce((s, r) => s + r.targetHits, 0);
    const timeExits = rows.reduce((s, r) => s + r.timeExits, 0);
    const combo: SweepCombo = { takeProfitPctOfStake: rows[0].takeProfitPctOfStake, stopLossPctOfStake: rows[0].stopLossPctOfStake, minConfidence: rows[0].minConfidence, minTfAgreement: rows[0].minTfAgreement };
    return { combo, trades, totalPnlUsd, winRate, breakEvenWinRate: rows[0].breakEvenWinRate, stopHits, targetHits, timeExits, perSymbol: rows };
  });

  ranked.sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);

  return { args, signalCountsBySymbol, ranked };
}
