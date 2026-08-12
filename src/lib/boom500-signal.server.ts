import { atr, bollinger, ema, macd, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export type Boom500Strategy = "BOOM500_SPIKE_HUNTER_BUY" | "BOOM500_DRIFT_SCALPER_SELL";
export interface Boom500Signal { strategy: Boom500Strategy; direction: "CALL" | "PUT"; confidence: number; volatilityPct: number; riskAbs: number; rewardAbs: number; reason: string; }
const last = <T,>(values: T[]) => values[values.length - 1];
const series = (candles: ServerCandle[]) => ({ close: candles.map(c => c.close), high: candles.map(c => c.high), low: candles.map(c => c.low) });

/** Two isolated BOOM500 engines. Tick direction confirms a setup; number of
 * ticks (including "ticks since spike") is intentionally never an entry rule. */
export function generateBoom500Signals(m15: ServerCandle[], m5: ServerCandle[], m1: ServerCandle[], ticks: number[] = []): Boom500Signal[] {
  if (m15.length < 55 || m5.length < 55 || m1.length < 35) return [];
  const s15 = series(m15), s5 = series(m5), s1 = series(m1);
  const e15_20 = last(ema(s15.close, 20)), e15_50 = last(ema(s15.close, 50));
  const e5_20 = last(ema(s5.close, 20)), e5_50 = last(ema(s5.close, 50)), e1_20 = last(ema(s1.close, 20));
  const r15 = last(rsi(s15.close, 14)), r5 = last(rsi(s5.close, 14)), r1 = last(rsi(s1.close, 14));
  const a = last(atr(s1.high, s1.low, s1.close, 14));
  if ([e15_20, e15_50, e5_20, e5_50, e1_20, r15, r5, r1, a].some(v => v === null)) return [];
  const current = last(m1), atrValue = a as number, macdValue = macd(s1.close);
  const hist = last(macdValue.histogram) ?? 0, previousHist = macdValue.histogram.at(-2) ?? 0;
  const bb = bollinger(s5.close, 20, 2), width = ((last(bb.upper) ?? 0) - (last(bb.lower) ?? 0)) / Math.max(current.close, Number.EPSILON);
  const recentLow = Math.min(...m1.slice(-8, -1).map(c => c.low)), recentHigh = Math.max(...m1.slice(-8, -1).map(c => c.high));
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const bullishReject = current.close > current.open && Math.min(current.open, current.close) - current.low > range * .35;
  const bearishReject = current.close < current.open && current.high - Math.max(current.open, current.close) > range * .35;
  const postSpike = m1.slice(-6).some(c => c.high - c.low >= atrValue * 2.0);
  const tail = ticks.slice(-24), tickMomentum = tail.length >= 12 ? tail.at(-1)! - tail[0] : 0;
  const tickUp = tickMomentum > atrValue * .03, tickDown = tickMomentum < -atrValue * .03;
  const out: Boom500Signal[] = [];

  let spike = 0;
  if (current.close <= Math.min(...m15.slice(-14).map(c => c.low)) * 1.003) spike += 5;
  if ((e15_20 as number) >= (e15_50 as number) || (r15 as number) > 45) spike += 10;
  if ((e5_20 as number) >= (e5_50 as number) || current.close > (e5_20 as number)) spike += 10;
  if (width < .003) spike += 10;
  if (bullishReject) spike += 10;
  if (current.close > recentHigh) spike += 15;
  if ((r1 as number) >= 42 && (r1 as number) <= 62) spike += 10;
  if ((r1 as number) > 65) spike -= 35; // Penalize overbought RSI M1 to avoid buying at post-spike peak
  if (hist > 0 && hist > previousHist) spike += 10;
  if (tickUp) spike += 5;
  if (!postSpike && spike >= 85) out.push({ strategy: "BOOM500_SPIKE_HUNTER_BUY", direction: "CALL", confidence: Math.min(100, spike), volatilityPct: atrValue / current.close * 100, riskAbs: atrValue * 1.1, rewardAbs: atrValue * 1.8, reason: `Boom500 Spike BUY score ${spike}/100, compression et structure haussière (RSI M1 ${(r1 as number).toFixed(1)})` });

  let drift = 0;
  if ((e5_20 as number) < (e5_50 as number)) drift += 20;
  if (current.high < Math.max(...m1.slice(-8, -1).map(c => c.high))) drift += 25;
  if ((r5 as number) < 50 && (r1 as number) < 50) drift += 20;
  if (hist < 0 && hist < previousHist) drift += 15;
  if (tickDown) drift += 15;
  if (!postSpike && width < .012) drift += 5;
  if (bearishReject && current.close < (e1_20 as number)) drift += 10;
  // A high spike setup makes a counter-trend SELL unsafe.
  if (drift >= 90 && spike < 60) out.push({ strategy: "BOOM500_DRIFT_SCALPER_SELL", direction: "PUT", confidence: Math.min(100, drift), volatilityPct: atrValue / current.close * 100, riskAbs: atrValue * .9, rewardAbs: atrValue * 1.2, reason: `Boom500 Drift SELL score ${drift}/100, dérive baissière M5/M1` });
  return out;
}
