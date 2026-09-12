/**
 * Market Regime Router (Section 4 - Spécification V3).
 * Classifie la structure de marché (STRONG_UPTREND, UPTREND, STRONG_DOWNTREND, DOWNTREND, RANGE, COMPRESSION, EXPANSION, HIGH_VOLATILITY, EXTREME_VOLATILITY, CHOPPY, POST_SPIKE)
 * et détermine dynamiquement l'autorisation des sous-stratégies selon le régime.
 */

import { adx, bollinger, ema } from "./indicators";
import { FEATURE_FLAGS } from "./feature-flags.server";

export type MarketRegime =
  | "UNKNOWN"
  | "STRONG_UPTREND"
  | "UPTREND"
  | "STRONG_DOWNTREND"
  | "DOWNTREND"
  | "RANGE"
  | "COMPRESSION"
  | "EXPANSION"
  | "HIGH_VOLATILITY"
  | "EXTREME_VOLATILITY"
  | "CHOPPY"
  | "POST_SPIKE";

export interface MarketRegimeClassification {
  symbol: string;
  regime: MarketRegime;
  adx: number;
  atrRatio: number;
  bbWidth: number;
  trendAlignmentScore: number; // 0 à 4
  recentSpikeDetected: boolean;
}

export function classifyMarketRegime(params: {
  symbol: string;
  adx?: number;
  atrRatio?: number;
  bbWidth?: number;
  trendAlignmentScore?: number;
  ema20?: number;
  ema50?: number;
  recentSpike?: boolean;
}): MarketRegimeClassification {
  const validInputs = [params.adx, params.atrRatio, params.bbWidth,
    params.trendAlignmentScore, params.ema20, params.ema50]
    .every(value => typeof value === "number" && Number.isFinite(value)) &&
    params.adx! >= 0 && params.adx! <= 100 && params.atrRatio! > 0 &&
    params.bbWidth! >= 0 && params.trendAlignmentScore! >= 0 &&
    params.trendAlignmentScore! <= 4 && params.ema20! > 0 && params.ema50! > 0;
  const adx = params.adx ?? NaN;
  const atrRatio = params.atrRatio ?? NaN;
  const bbWidth = params.bbWidth ?? NaN;
  const tas = params.trendAlignmentScore ?? NaN;
  const ema20 = params.ema20 ?? NaN;
  const ema50 = params.ema50 ?? NaN;
  const recentSpike = params.recentSpike ?? false;

  let regime: MarketRegime = "RANGE";

  if (!validInputs) {
    regime = "UNKNOWN";
  } else if (recentSpike && (params.symbol.startsWith("BOOM") || params.symbol.startsWith("CRASH"))) {
    regime = "POST_SPIKE";
  } else if (atrRatio > 2.50) {
    regime = "EXTREME_VOLATILITY";
  } else if (atrRatio > 1.80) {
    regime = "HIGH_VOLATILITY";
  } else if (atrRatio < 0.70 && bbWidth < 0.0015) {
    regime = "COMPRESSION";
  } else if (atrRatio > 1.40) {
    regime = "EXPANSION";
  } else if (adx < 15 && tas === 2) {
    regime = "CHOPPY";
  } else if (adx < 20 && bbWidth < 0.003) {
    regime = "RANGE";
  } else if (ema20 > ema50 && adx >= 30 && tas >= 3) {
    regime = "STRONG_UPTREND";
  } else if (ema20 > ema50) {
    regime = "UPTREND";
  } else if (ema20 < ema50 && adx >= 30 && tas <= 1) {
    regime = "STRONG_DOWNTREND";
  } else if (ema20 < ema50) {
    regime = "DOWNTREND";
  }

  return {
    symbol: params.symbol,
    regime,
    adx,
    atrRatio,
    bbWidth,
    trendAlignmentScore: tas,
    recentSpikeDetected: recentSpike,
  };
}

export function isStrategyAllowedInRegime(
  strategy: string,
  regime: MarketRegime
): { allowed: boolean; reason?: string } {
  if (regime === "UNKNOWN") {
    return { allowed: false, reason: "REGIME_NOT_ALLOWED: Indicateurs requis absents ou invalides" };
  }
  let allowed = true;
  let reason: string | undefined;

  const stratUpper = strategy.toUpperCase();

  if (stratUpper.includes("PULLBACK") || stratUpper.includes("TREND")) {
    if (regime === "CHOPPY") {
      allowed = false;
      reason = "Régime CHOPPY défavorable aux stratégies de tendance Pullback";
    } else if (regime === "EXTREME_VOLATILITY") {
      allowed = false;
      reason = "Sur-volatilité extrême défavorable au Pullback";
    }
  } else if (stratUpper.includes("RANGE_TRADER")) {
    if (regime === "STRONG_UPTREND" || regime === "STRONG_DOWNTREND" || regime === "EXPANSION") {
      allowed = false;
      reason = `Régime ${regime} incompatible avec le Range Trading (nécessite RANGE/COMPRESSION)`;
    }
  } else if (stratUpper.includes("BREAKOUT")) {
    if (regime === "CHOPPY" || regime === "RANGE") {
      allowed = false;
      reason = `Régime ${regime} sujet aux faux breakouts`;
    }
  } else if (stratUpper.includes("SPIKE")) {
    if (regime === "POST_SPIKE") {
      allowed = false;
      reason = "Délai de réflexion post-spike actif (évite le sur-trading immédiat)";
    }
  }

  return { allowed, reason };
}

/** Derive the regime from actual indicator inputs, never a proxy ADX or EMA. */
export function classifyRegimeFromCandles(
  symbol: string,
  candles: readonly { open: number; high: number; low: number; close: number; epoch: number }[],
  atrRatio: number,
  trendAlignmentScore: number,
): MarketRegimeClassification {
  if (candles.length < 50 || candles.some((c, index) =>
    ![c.open, c.high, c.low, c.close, c.epoch].every(Number.isFinite) ||
    c.low <= 0 || c.high < c.low || c.open < c.low || c.open > c.high ||
    c.close < c.low || c.close > c.high || c.epoch <= 0 ||
    (index > 0 && c.epoch <= candles[index - 1].epoch))) {
    return classifyMarketRegime({ symbol });
  }
  const closes = candles.map(c => c.close);
  const bands = bollinger(closes);
  const last = candles.length - 1;
  const middle = bands.middle[last];
  const upper = bands.upper[last];
  const lower = bands.lower[last];
  return classifyMarketRegime({
    symbol, atrRatio, trendAlignmentScore,
    adx: adx(candles.map(c => c.high), candles.map(c => c.low), closes).adx[last] ?? undefined,
    ema20: ema(closes, 20)[last] ?? undefined,
    ema50: ema(closes, 50)[last] ?? undefined,
    bbWidth: middle && upper !== null && lower !== null ? (upper - lower) / middle : undefined,
  });
}
