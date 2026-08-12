import { adx, atr, bollinger, ema, macd, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export type Vol75Strategy = "VOL75_1S_TREND_PULLBACK" | "VOL75_1S_BREAKOUT_RETEST" | "VOL75_1S_BREAKOUT_DIRECT";
export type Vol75RejectReason =
  | "NO_TREND"
  | "LOW_ADX"
  | "LOW_VOLATILITY"
  | "EXTREME_VOLATILITY"
  | "OVEREXTENDED"
  | "NO_PULLBACK"
  | "NO_CONFIRMATION"
  | "OPPOSING_TICK_MOMENTUM"
  | "LOW_SCORE";

export interface Vol75Signal {
  strategy: Vol75Strategy;
  direction: "CALL" | "PUT";
  confidence: number;
  riskAbs: number;
  rewardAbs: number;
  riskPct: number;
  volatilityPct: number;
  reason: string;
  diagnostics: Record<string, number | string>;
}

export interface Vol75Decision {
  signal?: Vol75Signal;
  rejection?: {
    reason: Vol75RejectReason;
    score: number;
    diagnostics: Record<string, number | string>;
  };
}

const last = <T,>(x: T[]) => x[x.length - 1];
const n = (x: number | null | undefined) => x ?? NaN;
const data = (c: ServerCandle[]) => ({ close: c.map(x => x.close), high: c.map(x => x.high), low: c.map(x => x.low) });
const slopeUp = (values: (number | null)[]) => n(last(values)) > n(values.at(-4));
const slopeDown = (values: (number | null)[]) => n(last(values)) < n(values.at(-4));

/** Dedicated Volatility 75 (1s) engine V2.
 * Softened combinatory score model with Hard Guards (ADX >= 15, ATR < 1.80, Pullback <= 0.35 ATR). */
export function generateVol75Signal(m15: ServerCandle[], m5: ServerCandle[], m1: ServerCandle[], ticks: number[] = []): Vol75Decision {
  if (m15.length < 210 || m5.length < 210 || m1.length < 55) {
    return { rejection: { reason: "NO_TREND", score: 0, diagnostics: { detail: "Historique insuffisant" } } };
  }

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

  const tail = ticks.slice(-30), tickMove = tail.length >= 12 ? tail.at(-1)! - tail[0] : 0;
  const range = Math.max(current.high - current.low, Number.EPSILON);

  // Rejection wicks (proportion of candle range)
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWickPct = lowerWick / range;
  const upperWickPct = upperWick / range;

  // 1. M15 Trend Direction & Context
  const isUp15 = n(last(e15[0])) > n(last(e15[1])) && current.close > n(last(e15[1]));
  const isDown15 = n(last(e15[0])) < n(last(e15[1])) && current.close < n(last(e15[1]));
  const direction: "CALL" | "PUT" | null = isUp15 ? "CALL" : isDown15 ? "PUT" : null;

  const diagnostics = {
    regime: direction === "CALL" ? "UPTREND" : direction === "PUT" ? "DOWNTREND" : "RANGE",
    adx: +adx5.toFixed(2),
    atrRatio: +atrRatio.toFixed(2),
    rsiM5: +r5.toFixed(2),
    rsiM1: +r1.toFixed(2),
    macdHist: +hist.toFixed(5),
    tickMove: +tickMove.toFixed(5),
  };

  // HARD GUARD 1: Trend non-opposé M15
  if (!direction) return { rejection: { reason: "NO_TREND", score: 0, diagnostics } };

  // HARD GUARD 2: ADX >= 15
  if (adx5 < 15) return { rejection: { reason: "LOW_ADX", score: 15, diagnostics } };

  // HARD GUARD 3: ATR Bounds (0.50 <= ATR <= 1.80)
  if (atrRatio < 0.50) return { rejection: { reason: "LOW_VOLATILITY", score: 20, diagnostics } };
  if (atrRatio > 1.80) return { rejection: { reason: "EXTREME_VOLATILITY", score: 25, diagnostics } };

  // HARD GUARD 4: Extension max 1.5 ATR from EMA20
  const distanceEma20 = Math.abs(current.close - n(last(e1[0]))) / Math.max(atrNow, Number.EPSILON);
  if (distanceEma20 > 1.5) return { rejection: { reason: "OVEREXTENDED", score: 35, diagnostics: { ...diagnostics, distanceEma20Atr: +distanceEma20.toFixed(2) } } };

  // HARD GUARD 5: Pullback distance <= 0.35 ATR
  const distEma20 = direction === "CALL" ? (current.low - n(last(e1[0]))) / atrNow : (n(last(e1[0])) - current.high) / atrNow;
  const distEma50 = direction === "CALL" ? (current.low - n(last(e1[1]))) / atrNow : (n(last(e1[1])) - current.high) / atrNow;
  const pullbackDistanceAtr = Math.min(Math.abs(distEma20), Math.abs(distEma50));
  if (pullbackDistanceAtr > 0.35) return { rejection: { reason: "NO_PULLBACK", score: 40, diagnostics: { ...diagnostics, pullbackDistanceAtr: +pullbackDistanceAtr.toFixed(2) } } };

  // HARD GUARD 6: Opposing tick momentum
  if ((direction === "CALL" && tickMove < -atrNow * 0.1) || (direction === "PUT" && tickMove > atrNow * 0.1)) {
    return { rejection: { reason: "OPPOSING_TICK_MOMENTUM", score: 45, diagnostics: { ...diagnostics, tickMove: +tickMove.toFixed(5) } } };
  }

  // ── SCORE CALCULATION (Total Max 100) ──

  // Component 1: M15 Trend/Context (Max 20)
  let m15Score = 10; // Base valid alignment
  const ema200Side = direction === "CALL" ? current.close > n(last(e15[2])) : current.close < n(last(e15[2]));
  if (ema200Side) m15Score += 10; // Bonus EMA200

  // Component 2: M5 Trend Strength / ADX (Max 20)
  let m5Score = 5; // ADX 15-18
  if (adx5 >= 22) m5Score = 20;
  else if (adx5 >= 18) m5Score = 12;

  // Component 3: M1 Pullback Quality (Max 20)
  let pullbackScore = 10; // <= 0.35 ATR
  if (pullbackDistanceAtr <= 0.15) pullbackScore = 20;
  else if (pullbackDistanceAtr <= 0.25) pullbackScore = 15;

  // Component 4: M1 Confirmation Wicks (Max 15)
  const wickPct = direction === "CALL" ? lowerWickPct : upperWickPct;
  let wickScore = 0;
  if (wickPct >= 0.45) wickScore = 15;
  else if (wickPct >= 0.30) wickScore = 10;
  else if (wickPct >= 0.20) wickScore = 5;

  // Component 5: Momentum (RSI + MACD + Ticks) (Max 15)
  let momentumScore = 0;
  // RSI soft filter
  const rsiOk = direction === "CALL" ? r5 >= 45 : r5 <= 55;
  const rsiPreferred = direction === "CALL" ? r5 > 50 : r5 < 50;
  if (rsiPreferred) momentumScore += 5;
  else if (rsiOk) momentumScore += 2;

  // MACD favorable or improving
  const macdImproving = direction === "CALL" ? (hist > prevHist || hist > 0) : (hist < prevHist || hist < 0);
  if (macdImproving) momentumScore += 5;

  // Tick momentum
  const tickFavorable = direction === "CALL" ? tickMove > 0 : tickMove < 0;
  if (tickFavorable) {
    if (Math.abs(tickMove) > atrNow * 0.05) momentumScore += 5; // Strong
    else momentumScore += 3; // Normal
  } else {
    momentumScore += 1; // Weak neutral
  }

  // Component 6: Risk / Volatility / Extension (Max 10)
  let riskScore = 0;
  if (atrRatio >= 0.50 && atrRatio <= 1.40) riskScore += 5;
  else if (atrRatio > 1.40 && atrRatio <= 1.80) riskScore += 2;
  if (distanceEma20 <= 1.0) riskScore += 5;

  const totalScore = m15Score + m5Score + pullbackScore + wickScore + momentumScore + riskScore;

  const finalDiagnostics = {
    ...diagnostics,
    totalScore,
    m15Score,
    m5Score,
    pullbackScore,
    wickScore,
    momentumScore,
    riskScore,
    pullbackDistanceAtr: +pullbackDistanceAtr.toFixed(2),
    distanceEma20Atr: +distanceEma20.toFixed(2),
    wickPct: +(wickPct * 100).toFixed(1),
  };

  // TARGET MIN_SCORE = 74
  if (totalScore >= 74) {
    return {
      signal: {
        strategy: "VOL75_1S_TREND_PULLBACK",
        direction,
        confidence: totalScore,
        riskAbs: atrNow * 1.1,
        rewardAbs: atrNow * 1.8,
        riskPct: 0.25,
        volatilityPct: (atrNow / current.close) * 100,
        reason: `Trend pullback ${direction === "CALL" ? "BUY" : "SELL"} · score ${totalScore}/100`,
        diagnostics: finalDiagnostics,
      },
    };
  }

  return {
    rejection: {
      reason: "LOW_SCORE",
      score: totalScore,
      diagnostics: finalDiagnostics,
    },
  };
}
