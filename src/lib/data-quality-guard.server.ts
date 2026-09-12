/**
 * Data Quality Guard (Section 3 - Spécification V3).
 * Vérifie l'intégrité et la fraîcheur des données de marché avant toute analyse de signal :
 * WebSocket connecté, Ticks récents, Timestamps cohérents, Absence de gaps, Bougies complètes M1/M5/M15.
 */

import { FEATURE_FLAGS } from "./feature-flags.server";

export type DataStatus = "HEALTHY" | "DEGRADED" | "STALE" | "INVALID";

export interface DataQualityCheckResult {
  symbol: string;
  status: DataStatus;
  isBlocked: boolean;
  reason?: string;
  diagnostics: {
    lastTickAgeMs: number | null;
    m1CandleCount: number;
    m5CandleCount: number;
    m15CandleCount: number;
    wsConnected: boolean;
  };
  observationMode: boolean;
}
type Candle = { epoch: number; open: number; high: number; low: number; close: number };

export function evaluateDataQuality(params: {
  symbol: string;
  lastTickTimestamp?: number;
  m1Candles?: Candle[];
  m5Candles?: Candle[];
  m15Candles?: Candle[];
  wsConnected?: boolean;
}): DataQualityCheckResult {
  const observationMode = FEATURE_FLAGS.OBSERVATION_MODE;
  const now = Date.now();
  const wsConnected = params.wsConnected === true;
  // Tick timestamps are milliseconds; candle epochs are seconds. Never substitute
  // candle opening times for ticks (a healthy M15 candle may be 15 minutes old).
  const tickTimestamp = params.lastTickTimestamp;
  const lastTickAgeMs = typeof tickTimestamp === "number" && Number.isFinite(tickTimestamp)
    ? now - tickTimestamp : null;
  const m1Count = params.m1Candles?.length ?? 0;
  const m5Count = params.m5Candles?.length ?? 0;
  const m15Count = params.m15Candles?.length ?? 0;
  let status: DataStatus = "HEALTHY";
  let reason: string | undefined;
  const reject = (failure: DataStatus, detail: string) => {
    status = failure;
    reason = `DATA_QUALITY_BLOCK: ${detail}`;
  };

  if (!wsConnected) {
    reject("INVALID", "WebSocket déconnecté ou état inconnu");
  } else if (tickTimestamp !== undefined && (lastTickAgeMs === null || !tickTimestamp || lastTickAgeMs < -5000)) {
    reject("INVALID", "Timestamp du dernier tick absent ou invalide");
  } else if (lastTickAgeMs !== null && lastTickAgeMs > 180000) {
    reject("STALE", "Dernier tick périmé (> 180s)");
  } else {
    for (const [label, interval, candles] of [
      ["M1", 60, params.m1Candles],
      ["M5", 300, params.m5Candles],
      ["M15", 900, params.m15Candles],
    ] as const) {
      if (!Array.isArray(candles) || candles.length < 15) {
        reject("DEGRADED", `Historique ${label} incomplet (< 15 bougies)`);
        break;
      }
      let previousEpoch: number | undefined;
      for (const candle of candles) {
        if (!candle || ![candle.epoch, candle.open, candle.high, candle.low, candle.close]
          .every(value => typeof value === "number" && Number.isFinite(value)) ||
          candle.epoch <= 0 || candle.epoch * 1000 > now + 5000 ||
          candle.low <= 0 || candle.high < candle.low ||
          candle.open < candle.low || candle.open > candle.high ||
          candle.close < candle.low || candle.close > candle.high) {
          reject("INVALID", `Bougie ${label} invalide (OHLC ou timestamp)`);
          break;
        }
        if (previousEpoch !== undefined && candle.epoch - previousEpoch !== interval) {
          reject("INVALID", `Historique ${label} non chronologique ou discontinu`);
          break;
        }
        previousEpoch = candle.epoch;
      }
      if (status !== "HEALTHY") break;
      // Accept both a current candle and a most-recent closed candle, with
      // 30 seconds delivery tolerance. Freshness is specific to each timeframe.
      if (now - candles[candles.length - 1].epoch * 1000 > interval * 2000 + 30000) {
        reject("STALE", `Dernière bougie ${label} périmée`);
        break;
      }
      if (candles.slice(-5).every(candle => candle.high === candle.low)) {
        reject("STALE", `Flux ${label} figé sur 5 bougies`);
        break;
      }
    }
  }
  // Observation flags cannot authorize trades against invalid market data.
  const isBlocked = status !== "HEALTHY";

  return {
    symbol: params.symbol,
    status,
    isBlocked,
    reason: status !== "HEALTHY" ? reason : undefined,
    diagnostics: {
      lastTickAgeMs,
      m1CandleCount: m1Count,
      m5CandleCount: m5Count,
      m15CandleCount: m15Count,
      wsConnected,
    },
    observationMode,
  };
}
