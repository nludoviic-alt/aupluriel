import { adx, atr, bollinger, ema, macd, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export type Vol75Strategy = "VOL75_1S_TREND_PULLBACK" | "VOL75_1S_BREAKOUT_RETEST" | "VOL75_1S_BREAKOUT_DIRECT";
export type Vol75RejectReason = "NO_TREND" | "LOW_ADX" | "NO_PULLBACK" | "NO_CONFIRMATION" | "EXTREME_VOLATILITY" | "OVEREXTENDED" | "CHOPPY" | "LOW_SCORE" | "NO_BREAKOUT";
export interface Vol75Signal {
  strategy: Vol75Strategy; direction: "CALL" | "PUT"; confidence: number; riskAbs: number; rewardAbs: number;
  riskPct: number; volatilityPct: number; reason: string; diagnostics: Record<string, number | string>;
}
export interface Vol75Decision { signal?: Vol75Signal; rejection?: { reason: Vol75RejectReason; score: number; diagnostics: Record<string, number | string> }; }

const last = <T,>(x: T[]) => x[x.length - 1];
const n = (x: number | null | undefined) => x ?? NaN;
const data = (c: ServerCandle[]) => ({ close: c.map(x => x.close), high: c.map(x => x.high), low: c.map(x => x.low) });
const slopeUp = (values: (number | null)[]) => n(last(values)) > n(values.at(-4));
const slopeDown = (values: (number | null)[]) => n(last(values)) < n(values.at(-4));

/** Dedicated Volatility 75 (1s) engine. It deliberately does not reuse the
 * Boom/Crash spike hunter: M15 regime → M5 trend → M1 pullback/breakout → ticks. */
export function generateVol75Signal(m15: ServerCandle[], m5: ServerCandle[], m1: ServerCandle[], ticks: number[] = []): Vol75Decision {
  if (m15.length < 210 || m5.length < 210 || m1.length < 55) return { rejection: { reason: "NO_TREND", score: 0, diagnostics: { detail: "Historique insuffisant" } } };
  const a15 = data(m15), a5 = data(m5), a1 = data(m1), current = last(m1);
  const e15 = [ema(a15.close, 20), ema(a15.close, 50), ema(a15.close, 200)];
  const e5 = [ema(a5.close, 20), ema(a5.close, 50), ema(a5.close, 200)];
  const e1 = [ema(a1.close, 20), ema(a1.close, 50), ema(a1.close, 200)];
  const r5 = n(last(rsi(a5.close, 14))), r1 = n(last(rsi(a1.close, 14)));
  const m = macd(a1.close), hist = n(last(m.histogram)), prevHist = n(m.histogram.at(-2));
  const atrs = atr(a1.high, a1.low, a1.close, 14), atrNow = n(last(atrs)), atrAvg = atrs.slice(-35, -1).filter((x): x is number => x !== null).reduce((s, x, _, a) => s + x / a.length, 0);
  const atrRatio = atrNow / Math.max(atrAvg, Number.EPSILON);
  const adx5 = n(last(adx(a5.high, a5.low, a5.close, 14).adx));
  const bb = bollinger(a1.close, 20, 2), bbWidth = (n(last(bb.upper)) - n(last(bb.lower))) / Math.max(current.close, Number.EPSILON);
  const priorWidth = bb.upper.slice(-35, -2).map((u, i) => u === null || bb.lower.slice(-35, -2)[i] === null ? 0 : (u - bb.lower.slice(-35, -2)[i]!) / current.close).reduce((s, x, _, a) => s + x / Math.max(a.length, 1), 0);
  const tail = ticks.slice(-30), tickMove = tail.length >= 12 ? tail.at(-1)! - tail[0] : 0, tickVelocity = tail.length >= 12 ? tickMove / tail.length : 0;
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const bullishReject = current.close > current.open && Math.min(current.open, current.close) - current.low >= range * .30;
  const bearishReject = current.close < current.open && current.high - Math.max(current.open, current.close) >= range * .30;
  const up15 = current.close > n(last(e15[2])) && n(last(e15[0])) > n(last(e15[1])) && n(last(e15[1])) > n(last(e15[2]));
  const down15 = current.close < n(last(e15[2])) && n(last(e15[0])) < n(last(e15[1])) && n(last(e15[1])) < n(last(e15[2]));
  const up5 = n(last(e5[0])) > n(last(e5[1])) && n(last(e5[1])) > n(last(e5[2])) && slopeUp(e5[0]) && r5 > 50;
  const down5 = n(last(e5[0])) < n(last(e5[1])) && n(last(e5[1])) < n(last(e5[2])) && slopeDown(e5[0]) && r5 < 50;
  const direction = up15 && up5 ? "CALL" : down15 && down5 ? "PUT" : null;
  const diagnostics = { regime: direction === "CALL" ? "UPTREND" : direction === "PUT" ? "DOWNTREND" : "RANGE", adx: +adx5.toFixed(2), atrRatio: +atrRatio.toFixed(2), rsi: +r1.toFixed(2), macd: +hist.toFixed(5), bbWidth: +bbWidth.toFixed(5), tickMomentum: +tickMove.toFixed(5), tickVelocity: +tickVelocity.toFixed(5) };
  if (!direction) return { rejection: { reason: "NO_TREND", score: 0, diagnostics } };
  if (adx5 < 20) return { rejection: { reason: "LOW_ADX", score: 20, diagnostics } };
  if (atrRatio > 1.8) return { rejection: { reason: "EXTREME_VOLATILITY", score: 25, diagnostics } };
  const crosses = [e1[0].at(-1)! > e1[1].at(-1)!, e1[0].at(-2)! > e1[1].at(-2)!, e1[0].at(-3)! > e1[1].at(-3)!].filter(Boolean).length;
  if (crosses > 0 && crosses < 3 && adx5 < 22) return { rejection: { reason: "CHOPPY", score: 30, diagnostics } };
  const distance = Math.abs(current.close - n(last(e1[0]))) / Math.max(atrNow, Number.EPSILON);
  if (distance > 1.5) return { rejection: { reason: "OVEREXTENDED", score: 45, diagnostics: { ...diagnostics, distanceEma20Atr: +distance.toFixed(2) } } };
  const pullback = direction === "CALL"
    ? current.low <= n(last(e1[0])) + atrNow * .20 && current.low >= n(last(e1[1])) - atrNow * .30
    : current.high >= n(last(e1[0])) - atrNow * .20 && current.high <= n(last(e1[1])) + atrNow * .30;
  const confirm = direction === "CALL" ? bullishReject && r1 > 50 && hist > prevHist && tickMove > 0 : bearishReject && r1 < 50 && hist < prevHist && tickMove < 0;
  let score = 20 + 25 + (pullback ? 20 : 0) + (confirm ? 20 : 0) + (Math.abs(tickMove) > atrNow * .03 ? 10 : 0) + (atrRatio >= .6 ? 5 : 0);
  if (pullback && confirm && score >= 80) return { signal: { strategy: "VOL75_1S_TREND_PULLBACK", direction, confidence: score, riskAbs: atrNow * 1.1, rewardAbs: atrNow * 1.8, riskPct: .25, volatilityPct: atrNow / current.close * 100, reason: `Trend pullback ${direction === "CALL" ? "BUY" : "SELL"} · score ${score}/100`, diagnostics: { ...diagnostics, distanceEma20Atr: +distance.toFixed(2), setup: "TREND_PULLBACK" } } };
  // Breakout is secondary and only admitted after a relative compression + real body close.
  const hi = Math.max(...m5.slice(-10, -1).map(c => c.high)), lo = Math.min(...m5.slice(-10, -1).map(c => c.low));
  const breakout = direction === "CALL" ? current.close > hi && current.close - current.open > range * .55 : current.close < lo && current.open - current.close > range * .55;
  const compressed = bbWidth < priorWidth * .80 && atrRatio <= 1.4;
  const retest = direction === "CALL" ? current.low <= hi + atrNow * .25 && bullishReject : current.high >= lo - atrNow * .25 && bearishReject;
  if (compressed && breakout && retest && Math.max(score, 82) >= 82) return { signal: { strategy: "VOL75_1S_BREAKOUT_RETEST", direction, confidence: Math.max(score, 82), riskAbs: atrNow * 1.1, rewardAbs: atrNow * 1.8, riskPct: .22, volatilityPct: atrNow / current.close * 100, reason: `Breakout retest ${direction === "CALL" ? "BUY" : "SELL"}`, diagnostics: { ...diagnostics, compressionScore: 82, setup: "BREAKOUT_RETEST" } } };
  const directScore = 20 + 25 + (compressed ? 20 : 0) + (breakout ? 20 : 0) + (Math.abs(tickMove) > atrNow * .08 ? 10 : 0) + (atrRatio >= .6 ? 5 : 0);
  if (compressed && breakout && !retest && directScore >= 90 && distance <= 1.5) return { signal: { strategy: "VOL75_1S_BREAKOUT_DIRECT", direction, confidence: directScore, riskAbs: atrNow * 1.1, rewardAbs: atrNow * 1.8, riskPct: .17, volatilityPct: atrNow / current.close * 100, reason: `Breakout direct ${direction === "CALL" ? "BUY" : "SELL"} · score ${directScore}/100`, diagnostics: { ...diagnostics, compressionScore: directScore, setup: "BREAKOUT_DIRECT" } } };
  if (!pullback) return { rejection: { reason: "NO_PULLBACK", score, diagnostics } };
  if (!confirm) return { rejection: { reason: "NO_CONFIRMATION", score, diagnostics } };
  return { rejection: { reason: "LOW_SCORE", score, diagnostics } };
}
