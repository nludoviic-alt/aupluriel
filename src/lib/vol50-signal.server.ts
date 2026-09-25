import { adx, atr, bollinger, ema, macd, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export type Vol50Strategy = "VOL50_1S_TREND_PULLBACK" | "VOL50_1S_BREAKOUT_RETEST" | "VOL50_1S_BREAKOUT_DIRECT";
export type Vol50RejectReason =
  | "NO_TREND"
  | "ADX_TOO_LOW"
  | "LOW_VOLATILITY"
  | "EXTREME_VOLATILITY"
  | "OVEREXTENDED"
  | "NO_PULLBACK"
  | "NO_CONFIRMATION"
  | "OPPOSING_TICK_MOMENTUM"
  | "LOW_SCORE"
  | "LOW_RR"
  | "CHOPPY"
  | "FAKE_BREAKOUT"
  | "REJECTED_RETEST";

export interface Vol50Signal {
  strategy: Vol50Strategy;
  direction: "CALL" | "PUT";
  confidence: number;
  riskAbs: number;
  rewardAbs: number;
  riskPct: number;
  volatilityPct: number;
  reason: string;
  diagnostics: Record<string, number | string>;
}

export interface Vol50Decision {
  signal?: Vol50Signal;
  rejection?: {
    reason: Vol50RejectReason;
    score: number;
    diagnostics: Record<string, number | string>;
  };
}

const last = <T,>(x: T[]) => x[x.length - 1];
const num = (x: number | null | undefined) => x ?? NaN;
const data = (c: ServerCandle[]) => ({ close: c.map(x => x.close), high: c.map(x => x.high), low: c.map(x => x.low) });
const slopeUp = (values: (number | null)[]) => num(last(values)) > num(values.at(-4));
const slopeDown = (values: (number | null)[]) => num(last(values)) < num(values.at(-4));

/** Dedicated Volatility 50 (1s) Engine V1 (`1HZ50V`).
 * Two independent engines:
 * 1. VOL50_1S_TREND_PULLBACK (MIN_SCORE = 76, STRONG = 84, PREMIUM = 91)
 * 2. VOL50_1S_BREAKOUT_RETEST (MIN_SCORE = 78, STRONG = 85, PREMIUM = 92, Direct = 88)
 */
export function generateVol50Signal(
  m15: ServerCandle[],
  m5: ServerCandle[],
  m1: ServerCandle[],
  ticks: number[] = []
): Vol50Decision {
  if (m15.length < 210 || m5.length < 210 || m1.length < 55) {
    return { rejection: { reason: "NO_TREND", score: 0, diagnostics: { detail: "Historique insuffisant" } } };
  }

  const a15 = data(m15), a5 = data(m5), a1 = data(m1), current = last(m1);
  const e15 = [ema(a15.close, 20), ema(a15.close, 50), ema(a15.close, 200)];
  const e5 = [ema(a5.close, 20), ema(a5.close, 50), ema(a5.close, 200)];
  const e1 = [ema(a1.close, 20), ema(a1.close, 50), ema(a1.close, 200)];

  const r5 = num(last(rsi(a5.close, 14))), r1 = num(last(rsi(a1.close, 14)));
  const m = macd(a1.close), hist = num(last(m.histogram)), prevHist = num(m.histogram.at(-2));
  const atrs = atr(a1.high, a1.low, a1.close, 14), atrNow = num(last(atrs)), atrAvg = atrs.slice(-35, -1).filter((x): x is number => x !== null).reduce((s, x, _, a) => s + x / a.length, 0);
  const atrRatio = atrNow / Math.max(atrAvg, Number.EPSILON);
  const adx5 = num(last(adx(a5.high, a5.low, a5.close, 14).adx));
  const bb = bollinger(a1.close, 20, 2), bbWidth = (num(last(bb.upper)) - num(last(bb.lower))) / Math.max(current.close, Number.EPSILON);

  // Tick calculations
  const tail = ticks.slice(-30);
  const tickMove = tail.length >= 12 ? tail.at(-1)! - tail[0] : 0;
  const tickVelocity = tail.length >= 12 ? tickMove / tail.length : 0;

  const range = Math.max(current.high - current.low, Number.EPSILON);
  const lowerWickPct = (Math.min(current.open, current.close) - current.low) / range;
  const upperWickPct = (current.high - Math.max(current.open, current.close)) / range;

  // 1. M15 CONTEXT & REGIME
  const isUp15 = num(last(e15[0])) > num(last(e15[1])) && current.close > num(last(e15[1]));
  const isDown15 = num(last(e15[0])) < num(last(e15[1])) && current.close < num(last(e15[1]));
  const direction: "CALL" | "PUT" | null = isUp15 ? "CALL" : isDown15 ? "PUT" : null;

  // Anti-Chop Check: Frequent EMA crosses + low ADX + RSI ~50
  const crossesCount = [
    e1[0].at(-1)! > e1[1].at(-1)!,
    e1[0].at(-2)! > e1[1].at(-2)!,
    e1[0].at(-3)! > e1[1].at(-3)!,
    e1[0].at(-4)! > e1[1].at(-4)!,
  ].filter(Boolean).length;
  const isChoppy = (crossesCount === 2 || crossesCount === 3) && adx5 < 20 && Math.abs(r1 - 50) < 5;

  const diagnostics = {
    regime: isChoppy ? "CHOPPY" : direction === "CALL" ? "UPTREND" : direction === "PUT" ? "DOWNTREND" : "RANGE",
    adx: +adx5.toFixed(2),
    atrRatio: +atrRatio.toFixed(2),
    rsiM5: +r5.toFixed(2),
    rsiM1: +r1.toFixed(2),
    macdHist: +hist.toFixed(5),
    tickMove: +tickMove.toFixed(5),
    tickVelocity: +tickVelocity.toFixed(5),
  };

  // HARD GUARD 1: Anti-Chop
  if (isChoppy) return { rejection: { reason: "CHOPPY", score: 0, diagnostics } };

  // HARD GUARD 2: Extreme Volatility (ATR Ratio > 1.75)
  if (atrRatio > 1.75) return { rejection: { reason: "EXTREME_VOLATILITY", score: 0, diagnostics } };
  if (atrRatio < 0.50) return { rejection: { reason: "LOW_VOLATILITY", score: 0, diagnostics } };

  // ── ENGINE 2: VOL50_1S_BREAKOUT_RETEST (Evaluated if compression + level breakout detected) ──
  const rangeBars5 = m5.slice(-12, -1);
  const hi5 = Math.max(...rangeBars5.map((x) => x.high));
  const lo5 = Math.min(...rangeBars5.map((x) => x.low));

  const isUpBreak = current.close > hi5 && tickMove > 0;
  const isDownBreak = current.close < lo5 && tickMove < 0;

  if (isUpBreak || isDownBreak) {
    const breakoutDir = isUpBreak ? "CALL" : "PUT";
    const retestUp = isUpBreak && current.low <= hi5 + atrNow * 0.30 && lowerWickPct >= 0.20;
    const retestDown = isDownBreak && current.high >= lo5 - atrNow * 0.30 && upperWickPct >= 0.20;

    let breakoutScore = 35;
    if (rangeBars5.length >= 5) breakoutScore += 15;
    if (Math.abs(tickMove) > atrNow * 0.05) breakoutScore += 15;
    if (retestUp || retestDown) breakoutScore += 20;
    if (atrRatio <= 1.40) breakoutScore += 15;

    // Retest execution (MIN_SCORE = 78)
    if ((retestUp || retestDown) && breakoutScore >= 78) {
      return {
        signal: {
          strategy: "VOL50_1S_BREAKOUT_RETEST",
          direction: breakoutDir,
          confidence: breakoutScore,
          riskAbs: atrNow * 1.0,
          rewardAbs: atrNow * 1.8,
          riskPct: 0.25,
          volatilityPct: (atrNow / current.close) * 100,
          reason: `Breakout retest ${breakoutDir} · score ${breakoutScore}/100`,
          diagnostics: { ...diagnostics, breakoutScore, setup: "BREAKOUT_RETEST" },
        },
      };
    }

    // Direct breakout execution (MIN_SCORE = 88)
    const directScore = breakoutScore + 10;
    if (!retestUp && !retestDown && directScore >= 88 && atrRatio <= 1.60) {
      return {
        signal: {
          strategy: "VOL50_1S_BREAKOUT_DIRECT",
          direction: breakoutDir,
          confidence: directScore,
          riskAbs: atrNow * 1.0,
          rewardAbs: atrNow * 1.8,
          riskPct: 0.15,
          volatilityPct: (atrNow / current.close) * 100,
          reason: `Breakout direct ${breakoutDir} · score ${directScore}/100`,
          diagnostics: { ...diagnostics, directScore, setup: "BREAKOUT_DIRECT" },
        },
      };
    }
  }

  // ── ENGINE 1: VOL50_1S_TREND_PULLBACK ──

  // HARD GUARD 3: M15 Trend Direction
  if (!direction) return { rejection: { reason: "NO_TREND", score: 0, diagnostics } };

  // HARD GUARD 4: ADX >= 15
  if (adx5 < 15) return { rejection: { reason: "ADX_TOO_LOW", score: 15, diagnostics } };

  // HARD GUARD 5: Extension Max 1.40 ATR from EMA20
  const distanceEma20Atr = Math.abs(current.close - num(last(e1[0]))) / Math.max(atrNow, Number.EPSILON);
  if (distanceEma20Atr > 1.40) {
    return { rejection: { reason: "OVEREXTENDED", score: 30, diagnostics: { ...diagnostics, distanceEma20Atr: +distanceEma20Atr.toFixed(2) } } };
  }

  // HARD GUARD 6: Pullback distance <= 0.40 ATR M1
  const distEma20 = direction === "CALL" ? (current.low - num(last(e1[0]))) / atrNow : (num(last(e1[0])) - current.high) / atrNow;
  const distEma50 = direction === "CALL" ? (current.low - num(last(e1[1]))) / atrNow : (num(last(e1[1])) - current.high) / atrNow;
  const pullbackDistanceAtr = Math.min(Math.abs(distEma20), Math.abs(distEma50));
  if (pullbackDistanceAtr > 0.40) {
    return { rejection: { reason: "NO_PULLBACK", score: 35, diagnostics: { ...diagnostics, pullbackDistanceAtr: +pullbackDistanceAtr.toFixed(2) } } };
  }

  // HARD GUARD 7: Opposing Tick Momentum
  if ((direction === "CALL" && tickMove < -atrNow * 0.1) || (direction === "PUT" && tickMove > atrNow * 0.1)) {
    return { rejection: { reason: "OPPOSING_TICK_MOMENTUM", score: 40, diagnostics: { ...diagnostics, tickMove: +tickMove.toFixed(5) } } };
  }

  // ── SCORE CALCULATION (Total 100) ──

  // 1. M15 Context (Max 15)
  let m15Score = 10; // Base valid
  const isEma200Side = direction === "CALL" ? current.close > num(last(e15[2])) : current.close < num(last(e15[2]));
  if (isEma200Side) m15Score += 5; // Bonus EMA200

  // 2. M5 Trend (Max 25)
  let m5Score = 10; // ADX 15-18
  if (adx5 >= 25) m5Score = 25;
  else if (adx5 >= 18) m5Score = 18;

  // 3. M1 Pullback (Max 20)
  let pullbackScore = 10; // <= 0.40 ATR
  if (pullbackDistanceAtr <= 0.15) pullbackScore = 20;
  else if (pullbackDistanceAtr <= 0.25) pullbackScore = 15;

  // 4. M1 Structure / Rejection (Max 15)
  const wickPct = direction === "CALL" ? lowerWickPct : upperWickPct;
  let wickScore = 0;
  if (wickPct >= 0.45) wickScore = 15;
  else if (wickPct >= 0.30) wickScore = 10;
  else if (wickPct >= 0.20) wickScore = 5;

  // Micro BOS check M1
  const m1SwingHigh = Math.max(...m1.slice(-6, -1).map(c => c.high));
  const m1SwingLow = Math.min(...m1.slice(-6, -1).map(c => c.low));
  const microBos = direction === "CALL" ? current.close > m1SwingHigh : current.close < m1SwingLow;
  if (microBos) wickScore = Math.min(15, wickScore + 5);

  // 5. Momentum (RSI + MACD) (Max 10)
  let momentumScore = 0;
  const rsiOk = direction === "CALL" ? r5 >= 45 : r5 <= 55;
  const rsiPreferred = direction === "CALL" ? r5 > 50 : r5 < 50;
  if (rsiPreferred) momentumScore += 5;
  else if (rsiOk) momentumScore += 3;

  const macdImproving = direction === "CALL" ? (hist > prevHist || hist > 0) : (hist < prevHist || hist < 0);
  if (macdImproving) momentumScore += 5;

  // 6. Tick Engine (Max 10)
  let tickScore = 0;
  const tickFavorable = direction === "CALL" ? tickMove > 0 : tickMove < 0;
  if (tickFavorable) {
    if (Math.abs(tickMove) > atrNow * 0.05) tickScore = 10; // Strong
    else tickScore = 6; // Normal
  } else {
    tickScore = 2; // Weak
  }

  // 7. Risk / Volatility (Max 5)
  let riskScore = 0;
  if (atrRatio >= 0.50 && atrRatio <= 1.40) riskScore += 3;
  else if (atrRatio > 1.40 && atrRatio <= 1.75) riskScore += 1;
  if (distanceEma20Atr <= 1.0) riskScore += 2;

  const totalScore = m15Score + m5Score + pullbackScore + wickScore + momentumScore + tickScore + riskScore;

  const finalDiagnostics = {
    ...diagnostics,
    totalScore,
    m15Score,
    m5Score,
    pullbackScore,
    wickScore,
    momentumScore,
    tickScore,
    riskScore,
    pullbackDistanceAtr: +pullbackDistanceAtr.toFixed(2),
    distanceEma20Atr: +distanceEma20Atr.toFixed(2),
    wickPct: +(wickPct * 100).toFixed(1),
  };

  // TARGET MIN_SCORE = 76
  if (totalScore >= 76) {
    return {
      signal: {
        strategy: "VOL50_1S_TREND_PULLBACK",
        direction,
        confidence: totalScore,
        riskAbs: atrNow * 1.0,
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
