import { adx, atr, bollinger, ema, rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export const STRATEGY_VERSION = "RB100_V3.1_DIAGNOSTIC";
export const PRESET_CONFIG_HASH = "rb100_sha256_v3_default";

export type Rb100Strategy = "RB100_RANGE_TRADER" | "RB100_BREAKOUT_RETEST" | "RB100_BREAKOUT_DIRECT";
export type MarketState = "RANGE" | "BREAKOUT" | "RETEST" | "NO_STATE";
export type FilterType = "HARD_FILTER" | "SOFT_FILTER" | "SCORE_COMPONENT";

export type NoTradeFinalReason =
  | "NO_MARKET_STATE"
  | "ROUTER_REJECTED"
  | "TECHNICAL_REJECTED"
  | "SCORE_REJECTED"
  | "TIME_FILTER_REJECTED"
  | "RISK_REJECTED"
  | "CONTRACT_REJECTED"
  | "EXECUTION_FAILED";

export interface Rb100FilterResult {
  name: string;
  type: FilterType;
  passed: boolean;
  reasonIfFailed?: string;
  impactScore?: number;
}

export interface BreakoutEvent {
  eventId: string;
  symbol: string;
  level: number;
  direction: "CALL" | "PUT";
  timestamp: number;
  retestStatus: "PENDING" | "CONFIRMED" | "EXPIRED";
  expiresAt: number;
}

export interface Rb100DiagnosticSnapshot {
  snapshotId: string;
  timestamp: number;
  symbol: string;
  strategy: Rb100Strategy | "UNROUTED";
  strategyVersion: string;
  presetConfigHash: string;
  marketState: MarketState;
  marketStateScore: number;
  marketStateScores: Record<MarketState, number>;
  direction: "CALL" | "PUT" | null;
  rawScore: number;
  finalScore: number;
  requiredScore: number;
  hardFiltersPassed: boolean;
  hardFilters: Rb100FilterResult[];
  softFilters: Rb100FilterResult[];
  scoreComponents: Rb100FilterResult[];
  indicatorValues: {
    rsi: number;
    adx: number;
    atr: number;
    atrRatio: number;
    bbWidth: number;
    zonePct: number;
    lowerWickPct: number;
    upperWickPct: number;
    bodyRatio: number;
    tickMomentum: number;
    displacement: number;
  };
  rangeHigh: number;
  rangeLow: number;
  rangeWidth: number;
  breakoutLevel: number | null;
  retestLevel: number | null;
  retestStatus?: "PENDING" | "CONFIRMED" | "EXPIRED" | "NONE";
  breakoutEventId?: string;
  primaryReason: string;
  allRejectionReasons: string[];
  noTradeFinalReason: NoTradeFinalReason | "TRADE_EXECUTED";
  finalDecision: "TAKE" | "REJECT";
}

export interface Rb100Signal {
  strategy: Rb100Strategy;
  direction: "CALL" | "PUT";
  confidence: number;
  rawScore: number;
  finalScore: number;
  riskAbs: number;
  rewardAbs: number;
  riskPct: number;
  volatilityPct: number;
  reason: string;
  breakoutEventId?: string;
  snapshot: Rb100DiagnosticSnapshot;
  diagnostics: Record<string, number | string>;
}

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

export interface Rb100Decision {
  signal?: Rb100Signal;
  rejection?: {
    reason: Rb100Reject;
    score: number;
    rawScore: number;
    finalScore: number;
    primaryReason: string;
    allRejectionReasons: string[];
    noTradeFinalReason: NoTradeFinalReason;
    filterStatuses: Record<string, "PASS" | "FAIL">;
    snapshot: Rb100DiagnosticSnapshot;
    diagnostics: Record<string, number | string>;
  };
}

const last = <T,>(x: T[]) => x[x.length - 1];
const num = (x: number | null | undefined) => x ?? NaN;

/** In-memory stateful breakout memory (symbol -> BreakoutEvent) */
const activeBreakouts = new Map<string, BreakoutEvent>();

export function getActiveBreakoutEvent(symbol: string): BreakoutEvent | undefined {
  const ev = activeBreakouts.get(symbol);
  if (!ev) return undefined;
  if (Date.now() > ev.expiresAt) {
    ev.retestStatus = "EXPIRED";
    activeBreakouts.delete(symbol);
    return undefined;
  }
  return ev;
}

export function clearActiveBreakoutEvent(symbol: string): void {
  activeBreakouts.delete(symbol);
}

/**
 * Market State Detector V3
 * Evaluates Market State and Market State Confidence Score (0-100).
 */
export function detectMarketState(params: {
  close: number;
  high: number;
  low: number;
  rangeHigh: number;
  rangeLow: number;
  rangeWidth: number;
  momentum: number;
  atr: number;
  activeEvent?: BreakoutEvent;
}): {
  state: MarketState;
  confidence: number;
  scores: Record<MarketState, number>;
} {
  const { close, high, low, rangeHigh, rangeLow, rangeWidth, momentum, atr, activeEvent } = params;
  
  const isUpBreak = close > rangeHigh && momentum > 0;
  const isDownBreak = close < rangeLow && momentum < 0;
  const isBreakout = isUpBreak || isDownBreak;

  let retestScore = 0;
  if (activeEvent && activeEvent.retestStatus === "PENDING") {
    const isUpRetest = activeEvent.direction === "CALL" && low <= rangeHigh + atr * 0.35;
    const isDownRetest = activeEvent.direction === "PUT" && high >= rangeLow - atr * 0.35;
    if (isUpRetest || isDownRetest) {
      retestScore = 85;
    }
  }

  let breakoutScore = 0;
  if (isBreakout) {
    const disp = Math.abs(close - (isUpBreak ? rangeHigh : rangeLow));
    breakoutScore = Math.min(100, 60 + Math.round((disp / Math.max(atr, Number.EPSILON)) * 30));
  }

  let rangeScore = 0;
  const zone = (close - rangeLow) / Math.max(rangeWidth, Number.EPSILON);
  if (zone >= -0.05 && zone <= 1.05 && !isBreakout) {
    const edgeDist = Math.min(zone, 1 - zone);
    rangeScore = Math.min(100, Math.round(50 + (0.30 - Math.min(edgeDist, 0.30)) * 133));
  }

  const scores: Record<MarketState, number> = {
    BREAKOUT: breakoutScore,
    RETEST: retestScore,
    RANGE: rangeScore,
    NO_STATE: 0,
  };

  if (retestScore >= 75) {
    return { state: "RETEST", confidence: retestScore, scores };
  }
  if (breakoutScore >= 60) {
    return { state: "BREAKOUT", confidence: breakoutScore, scores };
  }
  if (rangeScore >= 50) {
    return { state: "RANGE", confidence: rangeScore, scores };
  }

  return { state: "NO_STATE", confidence: 0, scores };
}

/**
 * RB100 Engine V3.1 — Full Specification Implementation with Stateful Retest Memory & Diagnostic Analytics.
 */
export function generateRb100Signal(
  m15: ServerCandle[],
  m5: ServerCandle[],
  m1: ServerCandle[],
  ticks: number[] = [],
  opts: { symbol?: string; diagnosticMode?: boolean } = {}
): Rb100Decision {
  const symbol = opts.symbol ?? "RB100";
  const now = Date.now();
  const snapshotId = `snap_${now}_${Math.random().toString(36).slice(2, 7)}`;

  // Insufficient history check
  if (m15.length < 55 || m5.length < 55 || m1.length < 45) {
    const snapshot: Rb100DiagnosticSnapshot = {
      snapshotId,
      timestamp: now,
      symbol,
      strategy: "UNROUTED",
      strategyVersion: STRATEGY_VERSION,
      presetConfigHash: PRESET_CONFIG_HASH,
      marketState: "NO_STATE",
      marketStateScore: 0,
      marketStateScores: { RANGE: 0, BREAKOUT: 0, RETEST: 0, NO_STATE: 0 },
      direction: null,
      rawScore: 0,
      finalScore: 0,
      requiredScore: 72,
      hardFiltersPassed: false,
      hardFilters: [{ name: "DATA_QUALITY", type: "HARD_FILTER", passed: false, reasonIfFailed: "INSUFFICIENT_HISTORY" }],
      softFilters: [],
      scoreComponents: [],
      indicatorValues: { rsi: 0, adx: 0, atr: 0, atrRatio: 0, bbWidth: 0, zonePct: 0, lowerWickPct: 0, upperWickPct: 0, bodyRatio: 0, tickMomentum: 0, displacement: 0 },
      rangeHigh: 0, rangeLow: 0, rangeWidth: 0,
      breakoutLevel: null, retestLevel: null,
      primaryReason: "DATA_QUALITY_INSUFFICIENT_HISTORY",
      allRejectionReasons: ["DATA_QUALITY_INSUFFICIENT_HISTORY"],
      noTradeFinalReason: "TECHNICAL_REJECTED",
      finalDecision: "REJECT",
    };

    return {
      rejection: {
        reason: "INVALID_RANGE",
        score: 0,
        rawScore: 0,
        finalScore: 0,
        primaryReason: "DATA_QUALITY_INSUFFICIENT_HISTORY",
        allRejectionReasons: ["DATA_QUALITY_INSUFFICIENT_HISTORY"],
        noTradeFinalReason: "TECHNICAL_REJECTED",
        filterStatuses: { data_quality: "FAIL", zone: "FAIL", atr: "FAIL", rsi: "FAIL", adx: "FAIL", wick: "FAIL", score: "FAIL" },
        snapshot,
        diagnostics: { detail: "Historique insuffisant" },
      },
    };
  }

  const close5 = m5.map((x) => x.close), high5 = m5.map((x) => x.high), low5 = m5.map((x) => x.low);
  const close1 = m1.map((x) => x.close), high1 = m1.map((x) => x.high), low1 = m1.map((x) => x.low);
  const current = last(m1);

  // Range boundary calculation
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
  const candleBody = Math.abs(current.close - current.open);
  const bodyRatio = candleBody / candleRange;

  const zone = (current.close - lo) / Math.max(width, Number.EPSILON);
  const lowerWickPct = (Math.min(current.open, current.close) - current.low) / candleRange;
  const upperWickPct = (current.high - Math.max(current.open, current.close)) / candleRange;

  // Active stateful breakout memory check
  const activeEvent = getActiveBreakoutEvent(symbol);

  // Market State Detection
  const marketStateRes = detectMarketState({
    close: current.close,
    high: current.high,
    low: current.low,
    rangeHigh: hi,
    rangeLow: lo,
    rangeWidth: width,
    momentum,
    atr: a,
    activeEvent,
  });

  const indicatorValues = {
    rsi: +rr.toFixed(2),
    adx: +ad.toFixed(2),
    atr: +a.toFixed(5),
    atrRatio: +ratio.toFixed(2),
    bbWidth: +bbw.toFixed(5),
    zonePct: +(zone * 100).toFixed(1),
    lowerWickPct: +lowerWickPct.toFixed(2),
    upperWickPct: +upperWickPct.toFixed(2),
    bodyRatio: +bodyRatio.toFixed(2),
    tickMomentum: +momentum.toFixed(5),
    displacement: +(Math.abs(current.close - (current.close > hi ? hi : lo))).toFixed(5),
  };

  // HARD GUARD 1: Extreme Volatility
  if (ratio > 1.8) {
    const snapshot: Rb100DiagnosticSnapshot = {
      snapshotId,
      timestamp: now,
      symbol,
      strategy: "UNROUTED",
      strategyVersion: STRATEGY_VERSION,
      presetConfigHash: PRESET_CONFIG_HASH,
      marketState: marketStateRes.state,
      marketStateScore: marketStateRes.confidence,
      marketStateScores: marketStateRes.scores,
      direction: null,
      rawScore: 0,
      finalScore: 0,
      requiredScore: 72,
      hardFiltersPassed: false,
      hardFilters: [{ name: "EXTREME_VOLATILITY", type: "HARD_FILTER", passed: false, reasonIfFailed: `ATR Ratio ${ratio.toFixed(2)} > 1.8` }],
      softFilters: [],
      scoreComponents: [],
      indicatorValues,
      rangeHigh: hi, rangeLow: lo, rangeWidth: width,
      breakoutLevel: null, retestLevel: null,
      primaryReason: "EXTREME_VOLATILITY",
      allRejectionReasons: ["EXTREME_VOLATILITY"],
      noTradeFinalReason: "TECHNICAL_REJECTED",
      finalDecision: "REJECT",
    };

    return {
      rejection: {
        reason: "EXTREME_VOLATILITY",
        score: 0,
        rawScore: 0,
        finalScore: 0,
        primaryReason: "EXTREME_VOLATILITY",
        allRejectionReasons: ["EXTREME_VOLATILITY"],
        noTradeFinalReason: "TECHNICAL_REJECTED",
        filterStatuses: { data_quality: "PASS", zone: "PASS", atr: "FAIL", rsi: "PASS", adx: "PASS", wick: "PASS", score: "FAIL" },
        snapshot,
        diagnostics: { ...indicatorValues },
      },
    };
  }

  const isUpBreak = current.close > hi && momentum > 0;
  const isDownBreak = current.close < lo && momentum < 0;
  const isBreakout = isUpBreak || isDownBreak;

  // Track / Register Stateful Breakout
  let currentEvent = activeEvent;
  if (isBreakout && (!currentEvent || currentEvent.retestStatus === "EXPIRED")) {
    currentEvent = {
      eventId: `brk_${now}_${Math.random().toString(36).slice(2, 7)}`,
      symbol,
      level: isUpBreak ? hi : lo,
      direction: isUpBreak ? "CALL" : "PUT",
      timestamp: now,
      retestStatus: "PENDING",
      expiresAt: now + 10 * 60 * 1000, // 10 M1 candles window (600s)
    };
    activeBreakouts.set(symbol, currentEvent);
  }

  // ── ROUTE 1: BREAKOUT / RETEST ENGINE ──
  if (isBreakout || (currentEvent && currentEvent.retestStatus === "PENDING")) {
    const direction: "CALL" | "PUT" = isBreakout
      ? (isUpBreak ? "CALL" : "PUT")
      : (currentEvent?.direction ?? "CALL");

    const targetLevel = isBreakout ? (isUpBreak ? hi : lo) : (currentEvent?.level ?? hi);
    const retestUp = currentEvent && currentEvent.direction === "CALL" && current.low <= targetLevel + a * 0.35;
    const retestDown = currentEvent && currentEvent.direction === "PUT" && current.high >= targetLevel - a * 0.35;
    const isRetestConfirmed = Boolean(retestUp || retestDown);

    if (isRetestConfirmed && currentEvent) {
      currentEvent.retestStatus = "CONFIRMED";
    }

    const targetStrategy: Rb100Strategy = isRetestConfirmed
      ? "RB100_BREAKOUT_RETEST"
      : "RB100_BREAKOUT_DIRECT";

    // --- RAW_SCORE vs FINAL_SCORE Calculation for Breakout Retest ---
    let rawRetestScore = 40;
    if (rangeBars.length >= 5) rawRetestScore += 15;
    if (isRetestConfirmed) rawRetestScore += 20;
    if (Math.abs(momentum) > a * 0.05) rawRetestScore += 15;
    if (ratio <= 1.5) rawRetestScore += 10;
    if (bodyRatio >= 0.35) rawRetestScore += 10;
    rawRetestScore = Math.min(100, rawRetestScore);

    // --- RAW_SCORE vs FINAL_SCORE Calculation for Breakout Direct ---
    const displacement = Math.abs(current.close - targetLevel);
    let rawDirectScore = 45;
    if (rangeBars.length >= 5) rawDirectScore += 15;
    if (Math.abs(momentum) > a * 0.08) rawDirectScore += 20;
    else if (Math.abs(momentum) > a * 0.04) rawDirectScore += 12;
    if (bodyRatio >= 0.50) rawDirectScore += 15;
    else if (bodyRatio >= 0.35) rawDirectScore += 8;
    if (displacement >= a * 0.15) rawDirectScore += 15;
    if (ratio <= 1.6) rawDirectScore += 10;
    rawDirectScore = Math.min(100, rawDirectScore);

    const evaluatedRawScore = isRetestConfirmed ? rawRetestScore : rawDirectScore;
    
    // Penalties / Hard Filter Check
    const hardFilters: Rb100FilterResult[] = [
      { name: "CLOSE_OUTSIDE_RANGE", type: "HARD_FILTER", passed: isBreakout || isRetestConfirmed, reasonIfFailed: "No breakout or retest active" },
      { name: "VOLATILITY_CAP", type: "HARD_FILTER", passed: ratio <= 1.7, reasonIfFailed: `ATR ratio ${ratio.toFixed(2)} > 1.7` },
    ];
    const hardFiltersPassed = hardFilters.every((f) => f.passed);

    let finalScore = evaluatedRawScore;
    if (!hardFiltersPassed) finalScore = Math.round(finalScore * 0.5);

    const requiredScore = isRetestConfirmed ? 76 : 88;

    const allRejectionReasons: string[] = [];
    if (!isRetestConfirmed && targetStrategy === "RB100_BREAKOUT_RETEST") allRejectionReasons.push("NO_RETEST_TOUCH");
    if (ratio > 1.7) allRejectionReasons.push("ATR_RATIO_HIGH");
    if (finalScore < requiredScore) allRejectionReasons.push("SCORE_LOW");
    if (Math.abs(momentum) <= a * 0.04) allRejectionReasons.push("MOMENTUM_WEAK");

    const primaryReason = allRejectionReasons[0] ?? "BREAKOUT_SCORE_LOW";
    const noTradeReason: NoTradeFinalReason = !hardFiltersPassed
      ? "TECHNICAL_REJECTED"
      : finalScore < requiredScore
      ? "SCORE_REJECTED"
      : "ROUTER_REJECTED";

    const snapshot: Rb100DiagnosticSnapshot = {
      snapshotId,
      timestamp: now,
      symbol,
      strategy: targetStrategy,
      strategyVersion: STRATEGY_VERSION,
      presetConfigHash: PRESET_CONFIG_HASH,
      marketState: isRetestConfirmed ? "RETEST" : "BREAKOUT",
      marketStateScore: isRetestConfirmed ? 85 : 80,
      marketStateScores: marketStateRes.scores,
      direction,
      rawScore: evaluatedRawScore,
      finalScore,
      requiredScore,
      hardFiltersPassed,
      hardFilters,
      softFilters: [{ name: "ATR_RATIO_SOFT", type: "SOFT_FILTER", passed: ratio <= 1.5 }],
      scoreComponents: [
        { name: "MOMENTUM", type: "SCORE_COMPONENT", passed: Math.abs(momentum) > a * 0.05 },
        { name: "BODY_RATIO", type: "SCORE_COMPONENT", passed: bodyRatio >= 0.35 },
        { name: "DISPLACEMENT", type: "SCORE_COMPONENT", passed: displacement >= a * 0.15 },
      ],
      indicatorValues,
      rangeHigh: hi, rangeLow: lo, rangeWidth: width,
      breakoutLevel: targetLevel, retestLevel: isRetestConfirmed ? targetLevel : null,
      retestStatus: currentEvent?.retestStatus ?? "NONE",
      breakoutEventId: currentEvent?.eventId,
      primaryReason,
      allRejectionReasons,
      noTradeFinalReason: finalScore >= requiredScore && hardFiltersPassed ? "TRADE_EXECUTED" : noTradeReason,
      finalDecision: finalScore >= requiredScore && hardFiltersPassed ? "TAKE" : "REJECT",
    };

    // EXECUTION CHECK 1: RETEST (MIN_SCORE = 76)
    if (isRetestConfirmed && finalScore >= 76 && hardFiltersPassed) {
      if (currentEvent) clearActiveBreakoutEvent(symbol);
      return {
        signal: {
          strategy: "RB100_BREAKOUT_RETEST",
          direction,
          confidence: finalScore,
          rawScore: evaluatedRawScore,
          finalScore,
          riskAbs: a * 1.1,
          rewardAbs: a * 1.8,
          riskPct: 0.25,
          volatilityPct: (a / current.close) * 100,
          reason: `RB100 breakout retest ${direction} · score ${finalScore}/100`,
          breakoutEventId: currentEvent?.eventId,
          snapshot,
          diagnostics: { ...indicatorValues, rawScore: evaluatedRawScore, finalScore, targetStrategy: "RB100_BREAKOUT_RETEST" },
        },
      };
    }

    // EXECUTION CHECK 2: DIRECT (MIN_SCORE = 88)
    if (!isRetestConfirmed && finalScore >= 88 && hardFiltersPassed) {
      return {
        signal: {
          strategy: "RB100_BREAKOUT_DIRECT",
          direction,
          confidence: finalScore,
          rawScore: evaluatedRawScore,
          finalScore,
          riskAbs: a * 1.1,
          rewardAbs: a * 1.8,
          riskPct: 0.15,
          volatilityPct: (a / current.close) * 100,
          reason: `RB100 breakout direct ${direction} · score ${finalScore}/100`,
          breakoutEventId: currentEvent?.eventId,
          snapshot,
          diagnostics: { ...indicatorValues, rawScore: evaluatedRawScore, finalScore, targetStrategy: "RB100_BREAKOUT_DIRECT" },
        },
      };
    }

    return {
      rejection: {
        reason: isRetestConfirmed ? "REJECTED_RETEST" : "REJECTED_BREAKOUT",
        score: finalScore,
        rawScore: evaluatedRawScore,
        finalScore,
        primaryReason,
        allRejectionReasons,
        noTradeFinalReason: noTradeReason,
        filterStatuses: { data_quality: "PASS", zone: "PASS", atr: ratio <= 1.7 ? "PASS" : "FAIL", rsi: "PASS", adx: "PASS", wick: "PASS", score: finalScore >= requiredScore ? "PASS" : "FAIL" },
        snapshot,
        diagnostics: { ...indicatorValues, rawScore: evaluatedRawScore, finalScore, targetStrategy },
      },
    };
  }

  // ── ROUTE 2: RANGE TRADER ENGINE (Mean Reversion) ──
  const isMidZone = zone > 0.30 && zone < 0.70;
  const isLowerZone = zone <= 0.30;
  const isUpperZone = zone >= 0.70;
  const direction: "CALL" | "PUT" = isLowerZone ? "CALL" : "PUT";

  // RSI Soft Filter
  const rsiAcceptable = isLowerZone ? rr <= 45 : rr >= 55;
  const rsiBonus = isLowerZone ? rr <= 35 : rr >= 65;

  // Bollinger & Rejection
  const nearBbLower = Math.abs(current.low - num(last(bb.lower))) <= a * 0.35;
  const nearBbUpper = Math.abs(current.high - num(last(bb.upper))) <= a * 0.35;
  const nearBand = isLowerZone ? nearBbLower : nearBbUpper;

  const wickValid = isLowerZone ? lowerWickPct >= 0.15 : upperWickPct >= 0.15;
  const momentumReversal = isLowerZone ? momentum > 0 : momentum < 0;
  const rejectionValid = wickValid || momentumReversal || nearBand;

  // RAW_SCORE calculation for Range Trader
  let rawRangeScore = 25; // Base boundary zone valid
  const adxValid = ad <= 33;
  const rangeWidthValid = width >= a * 2.0;
  if (rangeWidthValid && adxValid) rawRangeScore += 20;

  if (rejectionValid) rawRangeScore += 20;
  if (rsiBonus) rawRangeScore += 10;
  else if (rsiAcceptable) rawRangeScore += 6;
  if (momentumReversal) rawRangeScore += 10;
  if (ratio >= 0.40 && ratio <= 1.50) rawRangeScore += 5;
  if (nearBand) rawRangeScore += 10;
  rawRangeScore = Math.min(100, rawRangeScore);

  const hardFilters: Rb100FilterResult[] = [
    { name: "MID_RANGE_GUARD", type: "HARD_FILTER", passed: !isMidZone, reasonIfFailed: "Price in 30%-70% mid-range" },
    { name: "REJECTION_STRUCTURE", type: "HARD_FILTER", passed: rejectionValid, reasonIfFailed: "No wick, momentum reversal or BB touch" },
  ];
  const hardFiltersPassed = hardFilters.every((f) => f.passed);

  let finalRangeScore = rawRangeScore;
  if (!hardFiltersPassed) finalRangeScore = Math.round(finalRangeScore * 0.4);

  const requiredScore = 72;
  const allRejectionReasons: string[] = [];
  if (isMidZone) allRejectionReasons.push("ZONE_MID_RANGE");
  if (!rsiAcceptable) allRejectionReasons.push("RSI_FAIL");
  if (!adxValid) allRejectionReasons.push("ADX_HIGH");
  if (!rejectionValid) allRejectionReasons.push("REJECTION_STRUCTURE_FAIL");
  if (finalRangeScore < requiredScore) allRejectionReasons.push("SCORE_LOW");

  const primaryReason = allRejectionReasons[0] ?? "LOW_SCORE";
  const noTradeReason: NoTradeFinalReason = isMidZone
    ? "ROUTER_REJECTED"
    : !hardFiltersPassed
    ? "TECHNICAL_REJECTED"
    : finalRangeScore < requiredScore
    ? "SCORE_REJECTED"
    : "ROUTER_REJECTED";

  const snapshot: Rb100DiagnosticSnapshot = {
    snapshotId,
    timestamp: now,
    symbol,
    strategy: "RB100_RANGE_TRADER",
    strategyVersion: STRATEGY_VERSION,
    presetConfigHash: PRESET_CONFIG_HASH,
    marketState: "RANGE",
    marketStateScore: marketStateRes.scores.RANGE,
    marketStateScores: marketStateRes.scores,
    direction,
    rawScore: rawRangeScore,
    finalScore: finalRangeScore,
    requiredScore,
    hardFiltersPassed,
    hardFilters,
    softFilters: [{ name: "ADX_SOFT", type: "SOFT_FILTER", passed: adxValid }],
    scoreComponents: [
      { name: "RSI_BONUS", type: "SCORE_COMPONENT", passed: rsiBonus },
      { name: "MOMENTUM_REVERSAL", type: "SCORE_COMPONENT", passed: momentumReversal },
      { name: "NEAR_BOLLINGER", type: "SCORE_COMPONENT", passed: nearBand },
    ],
    indicatorValues,
    rangeHigh: hi, rangeLow: lo, rangeWidth: width,
    breakoutLevel: null, retestLevel: null,
    primaryReason,
    allRejectionReasons,
    noTradeFinalReason: finalRangeScore >= requiredScore && hardFiltersPassed && rsiAcceptable ? "TRADE_EXECUTED" : noTradeReason,
    finalDecision: finalRangeScore >= requiredScore && hardFiltersPassed && rsiAcceptable ? "TAKE" : "REJECT",
  };

  // TARGET MIN_SCORE = 72
  if (hardFiltersPassed && rsiAcceptable && finalRangeScore >= 72) {
    return {
      signal: {
        strategy: "RB100_RANGE_TRADER",
        direction,
        confidence: finalRangeScore,
        rawScore: rawRangeScore,
        finalScore: finalRangeScore,
        riskAbs: a * 1.25,
        rewardAbs: Math.max(a * 1.63, width * 0.45),
        riskPct: 0.20,
        volatilityPct: (a / current.close) * 100,
        reason: `RB100 range ${direction === "CALL" ? "BUY borne basse" : "SELL borne haute"} · score ${finalRangeScore}/100`,
        snapshot,
        diagnostics: { ...indicatorValues, rawScore: rawRangeScore, finalScore: finalRangeScore, targetStrategy: "RB100_RANGE_TRADER", ema20: e20 },
      },
    };
  }

  const rejectCode: Rb100Reject = isMidZone
    ? "REJECTED_MID_RANGE"
    : !rsiAcceptable
    ? "REJECTED_RSI"
    : !rejectionValid
    ? "REJECTED_REJECTION"
    : "LOW_SCORE";

  return {
    rejection: {
      reason: rejectCode,
      score: finalRangeScore,
      rawScore: rawRangeScore,
      finalScore: finalRangeScore,
      primaryReason,
      allRejectionReasons,
      noTradeFinalReason: noTradeReason,
      filterStatuses: { data_quality: "PASS", zone: isMidZone ? "FAIL" : "PASS", atr: ratio <= 1.5 ? "PASS" : "FAIL", rsi: rsiAcceptable ? "PASS" : "FAIL", adx: adxValid ? "PASS" : "FAIL", wick: rejectionValid ? "PASS" : "FAIL", score: finalRangeScore >= requiredScore ? "PASS" : "FAIL" },
      snapshot,
      diagnostics: { ...indicatorValues, rawScore: rawRangeScore, finalScore: finalRangeScore, targetStrategy: "RB100_RANGE_TRADER", ema20: e20 },
    },
  };
}
