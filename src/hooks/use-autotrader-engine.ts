/**
 * Module-level Auto-Trader engine store.
 *
 * Holds client-local trade logs (manual trades, reconciled positions) and
 * risk-stop/scan state, independent of which route is mounted — same
 * pattern as use-deriv-session.ts, so navigating away and back doesn't lose
 * state. Actual auto-execution runs server-side (see /api/bot); this store
 * no longer owns a trading loop of its own.
 */
import { useEffect, useState } from "react";
import { loadTradeLogCached, type TradeLog, type ScanResult } from "@/lib/autotrader";

export interface AutoTraderEngineState {
  logs: TradeLog[];
  lastScan: ScanResult | null;
  riskStopReasons: string[];
  /** Epoch ms until which the engine is risk-paused (auto-resumes) — null when not paused. */
  pausedUntil: number | null;
}

type LogsUpdater = TradeLog[] | ((prev: TradeLog[]) => TradeLog[]);

let _state: AutoTraderEngineState = {
  logs: loadTradeLogCached(),
  lastScan: null,
  riskStopReasons: [],
  pausedUntil: null,
};
const _listeners = new Set<(s: AutoTraderEngineState) => void>();

function dispatch(patch: Partial<AutoTraderEngineState>) {
  _state = { ..._state, ...patch };
  for (const l of _listeners) l(_state);
}

/** Same value-or-updater signature as React's setState, so existing callers stay a drop-in swap. */
export function setEngineLogs(updater: LogsUpdater) {
  const next = typeof updater === "function" ? updater(_state.logs) : updater;
  dispatch({ logs: next });
}

export function setEngineRiskStopReasons(reasons: string[]) {
  dispatch({ riskStopReasons: reasons });
}

export function useAutoTraderEngine(): AutoTraderEngineState {
  const [state, setState] = useState(_state);
  useEffect(() => {
    _listeners.add(setState);
    setState(_state); // pick up any change that happened between render and this effect
    return () => {
      _listeners.delete(setState);
    };
  }, []);
  return state;
}
