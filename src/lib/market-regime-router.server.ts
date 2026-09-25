/**
 * Market Regime Router (Section 4 - Spécification V3).
 * Classifie la structure de marché (STRONG_UPTREND, UPTREND, STRONG_DOWNTREND, DOWNTREND, RANGE, COMPRESSION, EXPANSION, HIGH_VOLATILITY, EXTREME_VOLATILITY, CHOPPY, POST_SPIKE)
 * et détermine dynamiquement l'autorisation des sous-stratégies selon le régime.
 */

import { FEATURE_FLAGS } from "./feature-flags.server";

export type MarketRegime =
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
  const adx = params.adx ?? 22;
  const atrRatio = params.atrRatio ?? 1.0;
  const bbWidth = params.bbWidth ?? 0.002;
  const tas = params.trendAlignmentScore ?? 2;
  const ema20 = params.ema20 ?? 100;
  const ema50 = params.ema50 ?? 99;
  const recentSpike = params.recentSpike ?? false;

  let regime: MarketRegime = "RANGE";

  if (recentSpike && (params.symbol.startsWith("BOOM") || params.symbol.startsWith("CRASH"))) {
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
  const observationMode = FEATURE_FLAGS.OBSERVATION_MODE;

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

  if (observationMode) {
    return {
      allowed: true, // Ne bloque jamais les ordres réels en Observation Mode
      reason: allowed ? undefined : `[OBSERVATION] REGIME_NOT_ALLOWED: ${reason}`,
    };
  }

  return { allowed, reason };
}
