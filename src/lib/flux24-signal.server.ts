import { atr, ema } from "./indicators";
import type { ServerCandle } from "./deriv.server";

/**
 * FLUX24 — high-frequency DEMO measurement preset for 24/7 synthetic indices.
 *
 * Purpose: produce many trades (target 20-40/day) to measure real execution
 * cost (spread, commission, slippage) and exercise the pipeline. It is NOT
 * expected to be profitable: 1HZ synthetic indices were measured as a pure
 * random walk (autocorr ~0, variance ratio ~1.0, no volatility clustering),
 * so any price rule has ~0R expectancy before costs. Kill criterion: stop if
 * PF < 1.0 after 100 closed trades.
 *
 * Rule: M1 micro-pullback in the direction of the EMA9/EMA21 trend. Stop and
 * target are derived by the engine from the ATR stop mode (SL = 1×ATR,
 * TP = 0.8R) — see FLUX24_PRESET in autotrader.ts.
 */
export type Flux24Strategy = "FLUX24_M1_MICRO_PULLBACK";
export type Flux24RejectReason = "INSUFFICIENT_DATA" | "NO_TREND" | "NO_PULLBACK" | "LOW_VOLATILITY";

export interface Flux24Signal {
  strategy: Flux24Strategy;
  direction: "CALL" | "PUT";
  confidence: number;
  volatilityPct: number;
  reason: string;
  diagnostics: Record<string, number | string>;
}

export interface Flux24Decision {
  signal?: Flux24Signal;
  rejection?: { reason: Flux24RejectReason; score: number; diagnostics: Record<string, number | string> };
}

/** Base score of an accepted setup. Must stay >= FLUX24_PRESET.minConfidence. */
export const FLUX24_BASE_SCORE = 80;
export const FLUX24_MIN_CANDLES = 40;

/** `candles` is the raw Deriv response: its LAST element is the still-forming
 * minute. It is dropped so the setup is evaluated on closed candles only
 * (otherwise the signal repaints within the minute). */
export function generateFlux24Signal(candles: ServerCandle[]): Flux24Decision {
  const m1 = candles.slice(0, -1);
  if (m1.length < FLUX24_MIN_CANDLES) {
    return { rejection: { reason: "INSUFFICIENT_DATA", score: 0, diagnostics: { candles: m1.length } } };
  }
  const close = m1.map((c) => c.close);
  const high = m1.map((c) => c.high);
  const low = m1.map((c) => c.low);
  const e9 = ema(close, 9);
  const e21 = ema(close, 21);
  const a = atr(high, low, close, 14);
  const n = m1.length - 1;
  const cur = m1[n];
  const e9n = e9[n], e21n = e21[n], e9p = e9[n - 1], an = a[n];
  if (e9n == null || e21n == null || e9p == null || an == null || !Number.isFinite(an) || an <= 0) {
    return { rejection: { reason: "INSUFFICIENT_DATA", score: 0, diagnostics: { detail: "indicator warm-up" } } };
  }
  const volatilityPct = (an / cur.close) * 100;
  const diagnostics = {
    ema9: +e9n.toFixed(5),
    ema21: +e21n.toFixed(5),
    atr: +an.toFixed(5),
    close: cur.close,
  };
  if (volatilityPct <= 0) return { rejection: { reason: "LOW_VOLATILITY", score: 0, diagnostics } };

  const up = e9n > e21n;
  const down = e9n < e21n;
  if (!up && !down) return { rejection: { reason: "NO_TREND", score: 0, diagnostics } };

  // Micro-pullback: the candle dipped to/through EMA9 and closed back on the trend side.
  const pullbackUp = up && cur.low <= e9n && cur.close > e9n && cur.close > m1[n - 1].close;
  const pullbackDown = down && cur.high >= e9n && cur.close < e9n && cur.close < m1[n - 1].close;
  if (!pullbackUp && !pullbackDown) {
    return { rejection: { reason: "NO_PULLBACK", score: 40, diagnostics } };
  }
  const direction = pullbackUp ? "CALL" : "PUT";
  return {
    signal: {
      strategy: "FLUX24_M1_MICRO_PULLBACK",
      direction,
      confidence: FLUX24_BASE_SCORE,
      volatilityPct,
      reason: `Micro-pullback M1 sur EMA9 (${direction === "CALL" ? "haussier" : "baissier"})`,
      diagnostics,
    },
  };
}
