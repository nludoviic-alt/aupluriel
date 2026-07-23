// Server-safe replay of the live multi-timeframe pipeline, used by the
// periodic auto-backtest scheduler (auto-backtest.server.ts). Mirrors
// backtestMultiTf() in autotrader.ts but swaps every browser-only dependency
// for its server-side equivalent, since this runs unattended in a background
// Node process rather than a signed-in browser tab:
//   - fetchCandles (browser WS)        -> fetchCandlesServer
//   - getLearnedWeights (localStorage) -> getLearnedWeightsServer (DB)
//   - fetchRealPayoutRatio (live quote via an authenticated session)
//       -> fixed 0.85 fallback, the same value backtestMultiTf() itself
//          falls back to whenever a live quote isn't available.
import { fetchCandlesServer, type ServerCandle } from "./deriv.server";
import { generateSignal } from "./indicators";
import { aggregateTfSignals, GRANULARITY_SECONDS, TIMEFRAMES, type TfSignalMap, type Veto4hMode } from "./signal-core";
import { getLearnedWeightsServer } from "./indicator-weights.server";

const GRAN_MINUTES: Record<string, number> = { "5m": 5, "15m": 15, "1H": 60, "4H": 240 };
const LOOKBACK = 250;
const FALLBACK_PAYOUT_PCT = 0.85;

/** Binary search: the trailing `lookback` candles that were already closed as of `epoch`. */
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

export interface ServerBacktestResult {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  breakEvenWinRate: number;
  payoutPct: number;
}

export async function backtestMultiTfServer(
  symbolDeriv: string,
  {
    minConfidence = 72,
    minTfAgreement = 4,
    durationMinutes = 15,
    testCandles = 150,
    veto4h = "strong-only",
    vetoDaily = "strong-only",
  }: {
    minConfidence?: number;
    minTfAgreement?: number;
    durationMinutes?: number;
    testCandles?: number;
    veto4h?: Veto4hMode;
    vetoDaily?: Veto4hMode;
  } = {},
): Promise<ServerBacktestResult> {
  const durationCandles = Math.max(1, Math.round(durationMinutes / 15));
  const testSpanMinutes = testCandles * 15;

  let weights: ReturnType<typeof getLearnedWeightsServer> | undefined;
  try { weights = getLearnedWeightsServer(symbolDeriv); } catch { /* base weights */ }

  const countFor = (tf: (typeof TIMEFRAMES)[number], margin = 20) =>
    Math.ceil((testSpanMinutes + LOOKBACK * GRAN_MINUTES[tf]) / GRAN_MINUTES[tf]) + margin;

  const [c5m, c15m, c1h, c4h] = await Promise.all([
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["5m"], countFor("5m")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["15m"], countFor("15m") + durationCandles),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["1H"], countFor("1H")),
    fetchCandlesServer(symbolDeriv, GRANULARITY_SECONDS["4H"], countFor("4H")),
  ]);
  const bySrc: Record<string, ServerCandle[]> = { "5m": c5m, "15m": c15m, "1H": c1h, "4H": c4h };

  let wins = 0, losses = 0;
  const start = Math.max(LOOKBACK, c15m.length - testCandles - durationCandles);
  const end = c15m.length - durationCandles;

  for (let i = start; i < end; i++) {
    const asOfEpoch = c15m[i - 1].epoch;
    const tfSignals: TfSignalMap = {};
    for (const tf of TIMEFRAMES) {
      const slice = sliceAsOf(bySrc[tf], asOfEpoch, LOOKBACK);
      if (slice.length >= 60) tfSignals[tf] = generateSignal(slice, { weights });
    }
    const analysis = aggregateTfSignals(tfSignals, 0, 1, veto4h, 0, undefined, vetoDaily);
    if (!analysis.direction) continue;
    if (analysis.confidence < minConfidence) continue;
    if (analysis.agreement < minTfAgreement) continue;

    const entry = c15m[i - 1].close;
    const exit = c15m[i - 1 + durationCandles].close;
    const won = analysis.direction === "CALL" ? exit > entry : exit < entry;
    if (won) wins++; else losses++;
  }

  const trades = wins + losses;
  const winRate = trades > 0 ? wins / trades : 0;
  return {
    trades, wins, losses, winRate,
    breakEvenWinRate: 1 / (1 + FALLBACK_PAYOUT_PCT),
    payoutPct: FALLBACK_PAYOUT_PCT,
  };
}
