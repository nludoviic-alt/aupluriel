import { adx, atr, bollinger, ema, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export type Rb100Strategy = "RB100_RANGE_TRADER" | "RB100_BREAKOUT_RETEST" | "RB100_BREAKOUT_DIRECT";
export type Rb100Reject =
  | "INVALID_RANGE"
  | "REJECTED_MID_RANGE"
  | "REJECTED_RSI"
  | "REJECTED_BOUNDARY"
  | "REJECTED_REJECTION"
  | "REJECTED_BREAKOUT"
  | "REJECTED_RETEST"
  | "EXTREME_VOLATILITY"
  | "LOW_SCORE";

export interface Rb100Signal {
  strategy: Rb100Strategy;
  direction: "CALL" | "PUT";
  confidence: number;
  riskAbs: number;
  rewardAbs: number;
  riskPct: number;
  volatilityPct: number;
  reason: string;
  diagnostics: Record<string, number | string>;
}

export interface Rb100Decision {
  signal?: Rb100Signal;
  rejection?: {
    reason: Rb100Reject;
    score: number;
    diagnostics: Record<string, number | string>;
  };
}

const last = <T,>(x: T[]) => x[x.length - 1];
const num = (x: number | null | undefined) => x ?? NaN;

/** RB100 Engine V2.
 * Softened dual engine: RB100_RANGE_TRADER (MIN_SCORE=72) and RB100_BREAKOUT_RETEST (MIN_SCORE=76 / Direct=88). */
export function generateRb100Signal(m15: ServerCandle[], m5: ServerCandle[], m1: ServerCandle[], ticks: number[] = []): Rb100Decision {
  if (m15.length < 55 || m5.length < 55 || m1.length < 45) {
    return { rejection: { reason: "INVALID_RANGE", score: 0, diagnostics: { detail: "Historique insuffisant" } } };
  }

  const close5 = m5.map((x) => x.close), high5 = m5.map((x) => x.high), low5 = m5.map((x) => x.low);
  const close1 = m1.map((x) => x.close), high1 = m1.map((x) => x.high), low1 = m1.map((x) => x.low);
  const current = last(m1);

  // Consolidation check (MIN_CONSOLIDATION_BARS = 5, preference 5-12 bars M5)
  const rangeBars = m5.slice(-12, -1);
  const hi = Math.max(...rangeBars.map((x) => x.high));
  const lo = Math.min(...rangeBars.map((x) => x.low));
  const width = hi - lo;

  const atrs = atr(high1, low1, close1, 14);
  const a = num(last(atrs));
  const avg = atrs.slice(-30, -1).filter((x): x is number => x !== null).reduce((s, x, _, ar) => s + x / ar.length, 0);
  const ratio = a / Math.max(avg, Number.EPSILON);
  const ad = num(last(adx(high5, low5, close5, 14).adx));
  const rr = num(last(rsi(close1, 14)));
  const e20 = num(last(ema(close1, 20)));

  const bb = bollinger(close1, 20, 2);
  const bbw = (num(last(bb.upper)) - num(last(bb.lower))) / Math.max(current.close, Number.EPSILON);

  const tail = ticks.slice(-30);
  const momentum = tail.length > 10 ? tail.at(-1)! - tail[0] : 0;
  const candleRange = Math.max(current.high - current.low, Number.EPSILON);

  const zone = (current.close - lo) / Math.max(width, Number.EPSILON);
  const lowerWickPct = (Math.min(current.open, current.close) - current.low) / candleRange;
  const upperWickPct = (current.high - Math.max(current.open, current.close)) / candleRange;

  const diagnostics = {
    rangeHigh: +hi.toFixed(5),
    rangeLow: +lo.toFixed(5),
    rangeWidth: +width.toFixed(5),
    zonePct: +(zone * 100).toFixed(1),
    adx: +ad.toFixed(2),
    atrRatio: +ratio.toFixed(2),
    bbWidth: +bbw.toFixed(5),
    rsiM1: +rr.toFixed(2),
    tickMomentum: +momentum.toFixed(5),
  };

  // HARD GUARD 1: Extreme Volatility
  if (ratio > 1.8) return { rejection: { reason: "EXTREME_VOLATILITY", score: 0, diagnostics } };

  // ── ENGINE 1: BREAKOUT / RETEST (Evaluated first if price has left the range) ──
  const isUpBreak = current.close > hi && momentum > 0;
  const isDownBreak = current.close < lo && momentum < 0;

  if (isUpBreak || isDownBreak) {
    const direction = isUpBreak ? "CALL" : "PUT";
    // Retest tolerance = 0.25 ATR M1
    const retestUp = isUpBreak && current.low <= hi + a * 0.25 && lowerWickPct >= 0.20;
    const retestDown = isDownBreak && current.high >= lo - a * 0.25 && upperWickPct >= 0.20;

    let breakoutScore = 40; // Base breakout
    if (rangeBars.length >= 5) breakoutScore += 15;
    if (Math.abs(momentum) > a * 0.05) breakoutScore += 15;
    if (retestUp || retestDown) breakoutScore += 15;
    if (ratio <= 1.4) breakoutScore += 10;

    // Retest execution (MIN_SCORE_RETEST = 76)
    if ((retestUp || retestDown) && breakoutScore >= 76) {
      return {
        signal: {
          strategy: "RB100_BREAKOUT_RETEST",
          direction,
          confidence: breakoutScore,
          riskAbs: a * 1.1,
          rewardAbs: a * 1.8,
          riskPct: 0.25,
          volatilityPct: (a / current.close) * 100,
          reason: `RB100 breakout retest ${direction}`,
          diagnostics: { ...diagnostics, breakoutScore, boundaryZone: "RETEST" },
        },
      };
    }

    // Direct breakout execution (DIRECT_MIN_SCORE = 88)
    const directScore = breakoutScore + 10;
    if (!retestUp && !retestDown && directScore >= 88 && ratio <= 1.7) {
      return {
        signal: {
          strategy: "RB100_BREAKOUT_DIRECT",
          direction,
          confidence: directScore,
          riskAbs: a * 1.1,
          rewardAbs: a * 1.8,
          riskPct: 0.15,
          volatilityPct: (a / current.close) * 100,
          reason: `RB100 breakout direct ${direction}`,
          diagnostics: { ...diagnostics, directScore, boundaryZone: "BREAKOUT" },
        },
      };
    }

    return { rejection: { reason: "REJECTED_RETEST", score: breakoutScore, diagnostics } };
  }

  // ── ENGINE 2: RANGE TRADER (Mean Reversion) ──

  // HARD GUARD 2: Mid-Zone 30% - 70% NO TRADE
  if (zone > 0.30 && zone < 0.70) {
    return { rejection: { reason: "REJECTED_MID_RANGE", score: 0, diagnostics: { ...diagnostics, boundaryZone: "MID" } } };
  }

  const isLowerZone = zone <= 0.30;
  const isUpperZone = zone >= 0.70;
  const direction: "CALL" | "PUT" = isLowerZone ? "CALL" : "PUT";

  // RSI Soft Filter (BUY <= 42 acceptable, SELL >= 58 acceptable)
  const rsiAcceptable = isLowerZone ? rr <= 42 : rr >= 58;
  const rsiBonus = isLowerZone ? rr <= 35 : rr >= 65;

  if (!rsiAcceptable) {
    return { rejection: { reason: "REJECTED_RSI", score: 30, diagnostics: { ...diagnostics, rsiM1: +rr.toFixed(2) } } };
  }

  // Bollinger & Rejection
  const nearBbLower = Math.abs(current.low - num(last(bb.lower))) <= a * 0.25;
  const nearBbUpper = Math.abs(current.high - num(last(bb.upper))) <= a * 0.25;
  const nearBand = isLowerZone ? nearBbLower : nearBbUpper;

  const wickValid = isLowerZone ? lowerWickPct >= 0.20 : upperWickPct >= 0.20;
  const momentumReversal = isLowerZone ? momentum > 0 : momentum < 0;
  const rejectionValid = wickValid || momentumReversal || nearBand;

  if (!rejectionValid) {
    return { rejection: { reason: "REJECTED_REJECTION", score: 40, diagnostics } };
  }

  // ── RANGE SCORE CALCULATION (Total Max 100) ──
  // Boundary position: 25
  // Range validity: 20
  // M1 rejection/structure: 20
  // RSI: 10
  // Tick Momentum: 10
  // Volatility: 5
  // RR/Risk: 10

  let score = 25; // Base boundary zone valid (0-30% or 70-100%)
  if (width >= a * 2.5 && ad <= 25) score += 20; // Range validity
  if (rejectionValid) score += 20; // M1 rejection/structure
  if (rsiBonus) score += 10;
  else if (rsiAcceptable) score += 6;
  if (momentumReversal) score += 10;
  if (ratio >= 0.50 && ratio <= 1.40) score += 5;
  if (nearBand) score += 10;

  const finalDiagnostics = {
    ...diagnostics,
    totalScore: score,
    boundaryZone: isLowerZone ? "LOWER" : "UPPER",
    ema20: e20,
  };

  // TARGET MIN_SCORE = 72
  if (score >= 72) {
    return {
      signal: {
        strategy: "RB100_RANGE_TRADER",
        direction,
        confidence: score,
        riskAbs: a * 1.25,
        rewardAbs: Math.max(a * 1.63, width * 0.45),
        riskPct: 0.20,
        volatilityPct: (a / current.close) * 100,
        reason: `RB100 range ${direction === "CALL" ? "BUY borne basse" : "SELL borne haute"} · score ${score}/100`,
        diagnostics: finalDiagnostics,
      },
    };
  }

  return { rejection: { reason: "LOW_SCORE", score, diagnostics: finalDiagnostics } };
}
