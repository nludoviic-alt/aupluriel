import { atr, bollinger, ema, macd, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export type Crash500Strategy = "CRASH500_SPIKE_HUNTER_SELL" | "CRASH500_DRIFT_SCALPER_BUY";
export interface Crash500Signal { strategy: Crash500Strategy; direction: "CALL" | "PUT"; confidence: number; volatilityPct: number; riskAbs: number; rewardAbs: number; reason: string; }

function values(c: ServerCandle[]) { return { close: c.map(x => x.close), high: c.map(x => x.high), low: c.map(x => x.low) }; }
function last<T>(a: T[]): T { return a[a.length - 1]; }

/** Dedicated CRASH500 model.  Tick *direction* is a confirmation only; tick
 * count is deliberately never a predictor or an entry trigger. */
export function generateCrash500Signals(m15: ServerCandle[], m5: ServerCandle[], m1: ServerCandle[], ticks: number[] = []): Crash500Signal[] {
  if (m15.length < 55 || m5.length < 55 || m1.length < 35) return [];
  const a15 = values(m15), a5 = values(m5), a1 = values(m1);
  const e15_20 = last(ema(a15.close, 20)), e15_50 = last(ema(a15.close, 50));
  const e5_20 = last(ema(a5.close, 20)), e5_50 = last(ema(a5.close, 50));
  const e1_20 = last(ema(a1.close, 20));
  const r15 = last(rsi(a15.close, 14)), r5 = last(rsi(a5.close, 14)), r1 = last(rsi(a1.close, 14));
  const m = macd(a1.close); const hist = last(m.histogram) ?? 0; const prevHist = m.histogram[m.histogram.length - 2] ?? 0;
  const current = last(m1); const a = last(atr(a1.high, a1.low, a1.close, 14));
  const bb = bollinger(a5.close, 20, 2); const width = ((last(bb.upper) ?? 0) - (last(bb.lower) ?? 0)) / Math.max(current.close, Number.EPSILON);
  if ([e15_20,e15_50,e5_20,e5_50,e1_20,r15,r5,r1,a].some(v => v === null)) return [];
  const atrValue = a as number; const recentHigh = Math.max(...m1.slice(-8,-1).map(c => c.high)); const recentLow = Math.min(...m1.slice(-8,-1).map(c => c.low));
  const range = current.high - current.low; const bearishReject = current.close < current.open && current.high - Math.max(current.open,current.close) > range * .35;
  const bullishReject = current.close > current.open && Math.min(current.open,current.close) - current.low > range * .35;
  const postCrash = m1.slice(-4).some(c => c.open - c.close >= atrValue * 2.2);
  const recentTicks = ticks.slice(-24);
  const tickMomentum = recentTicks.length >= 12 ? recentTicks[recentTicks.length - 1] - recentTicks[0] : 0;
  const tickDown = tickMomentum < -atrValue * .03;
  const tickUp = tickMomentum > atrValue * .03;
  const out: Crash500Signal[] = [];
  let spike = 0;
  if ((e15_20 as number) <= (e15_50 as number) || r15! < 55) spike += 5;
  if (current.close >= Math.max(...m5.slice(-12).map(c => c.close)) * .998) spike += 5;
  if ((e5_20 as number) <= (e5_50 as number) || current.close < (e5_20 as number)) spike += 10;
  if (width < .003) spike += 10;
  if (bearishReject) spike += 10;
  if (current.close < recentLow) spike += 15;
  if ((r1 as number) < 50) spike += 10;
  if (hist < 0 && hist < prevHist) spike += 10;
  if (tickDown) spike += 5;
  if (!postCrash && spike >= 88) out.push({ strategy:"CRASH500_SPIKE_HUNTER_SELL", direction:"PUT", confidence:Math.min(100, spike), volatilityPct:atrValue/current.close*100, riskAbs:atrValue*1.1, rewardAbs:atrValue*1.8, reason:`Crash500 Spike SELL score ${spike}/100, structure baissière et compression` });
  let drift = 0;
  if ((e5_20 as number) > (e5_50 as number)) drift += 20;
  if (current.low > Math.min(...m1.slice(-8,-1).map(c => c.low))) drift += 25;
  if ((r5 as number) > 50 && (r1 as number) > 50) drift += 20;
  if (hist > 0 && hist > prevHist) drift += 15;
  if (tickUp) drift += 5;
  if (!postCrash && width < .012) drift += 10;
  if (bullishReject && current.close > (e1_20 as number)) drift += 10;
  if (drift >= 90 && spike < 95) out.push({ strategy:"CRASH500_DRIFT_SCALPER_BUY", direction:"CALL", confidence:Math.min(100, drift), volatilityPct:atrValue/current.close*100, riskAbs:atrValue*.9, rewardAbs:atrValue*1.2, reason:`Crash500 Drift BUY score ${drift}/100, structure haussière M5/M1` });
  return out;
}
