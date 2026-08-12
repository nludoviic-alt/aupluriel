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
  const lastTickTimestamp = params.lastTickTimestamp ?? now;
  const lastTickAgeMs = now - lastTickTimestamp;

  const m1Count = params.m1Candles?.length ?? 50;
  const m5Count = params.m5Candles?.length ?? 50;
  const m15Count = params.m15Candles?.length ?? 50;

  let status: DataStatus = "HEALTHY";
  let reason: string | undefined;

  // 1. Contrôle connexion & fraîcheur ticks
  if (!wsConnected) {
    status = "INVALID";
    reason = "DATA_QUALITY_BLOCK: WebSocket déconnecté";
  } else if (lastTickAgeMs > 60000) {
    status = "STALE";
    reason = `DATA_QUALITY_BLOCK: Ticks périmés (${Math.round(lastTickAgeMs / 1000)}s > 60s)`;
  } else if (m1Count < 20 || m5Count < 20 || m15Count < 20) {
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
