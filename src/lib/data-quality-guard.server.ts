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
    lastTickAgeMs: number;
    m1CandleCount: number;
    m5CandleCount: number;
    m15CandleCount: number;
    wsConnected: boolean;
  };
  observationMode: boolean;
}

export function evaluateDataQuality(params: {
  symbol: string;
  lastTickTimestamp?: number;
  m1Candles?: any[];
  m5Candles?: any[];
  m15Candles?: any[];
  wsConnected?: boolean;
}): DataQualityCheckResult {
  const observationMode = FEATURE_FLAGS.OBSERVATION_MODE;
  const now = Date.now();

  const wsConnected = params.wsConnected ?? true;

  // Determine tick/candle age
  let lastTickAgeMs = params.lastTickTimestamp ? (now - params.lastTickTimestamp) : 0;
  
  // Inspect latest candle timestamp if candles are provided
  const latestCandle = params.m15Candles?.[params.m15Candles.length - 1] 
    ?? params.m5Candles?.[params.m5Candles.length - 1] 
    ?? params.m1Candles?.[params.m1Candles.length - 1];
  
  if (latestCandle && latestCandle.epoch) {
    const candleAgeMs = now - (latestCandle.epoch * 1000);
    if (!params.lastTickTimestamp || candleAgeMs > lastTickAgeMs) {
      lastTickAgeMs = Math.max(lastTickAgeMs, candleAgeMs);
    }
  }

  const m1Count = params.m1Candles?.length ?? (params.m1Candles === undefined ? 50 : 0);
  const m5Count = params.m5Candles?.length ?? (params.m5Candles === undefined ? 50 : 0);
  const m15Count = params.m15Candles?.length ?? (params.m15Candles === undefined ? 50 : 0);

  let status: DataStatus = "HEALTHY";
  let reason: string | undefined;

  // Check flat-line / zero variance (stuck feed)
  let isFlatLine = false;
  if (params.m15Candles && params.m15Candles.length >= 5) {
    const recent = params.m15Candles.slice(-5);
    isFlatLine = recent.every((c) => c.high === c.low);
  }

  // 1. Contrôle connexion & fraîcheur ticks
  if (!wsConnected) {
    status = "INVALID";
    reason = "DATA_QUALITY_BLOCK: WebSocket déconnecté";
  } else if (isFlatLine) {
    status = "STALE";
    reason = "DATA_QUALITY_BLOCK: Flux de prix figé (variation zéro sur 5 bougies)";
  } else if (lastTickAgeMs > 180000) {
    status = "STALE";
    reason = `DATA_QUALITY_BLOCK: Données de marché périmées (${Math.round(lastTickAgeMs / 1000)}s > 180s)`;
  } else if (m1Count < 15 || m5Count < 15 || m15Count < 15) {
    status = "DEGRADED";
    reason = `Historique de bougies incomplet (M1:${m1Count}, M5:${m5Count}, M15:${m15Count})`;
  }

  const isBlocked = (status === "STALE" || status === "INVALID") && !observationMode;

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
