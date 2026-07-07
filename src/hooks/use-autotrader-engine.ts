/**
 * Module-level Auto-Trader engine store.
 *
 * `startAutoTrader` used to be invoked and owned entirely by AutoTraderPage's
 * local state (`running`, `logs`, a `useRef` stop handle). Unmounting that
 * page — which happens on ANY route navigation, since it's just another
 * screen in the SPA — reset `running` to false with no reference left to
 * the still-ticking interval: from the UI's perspective the bot "stopped",
 * and hitting Start again after navigating back span a SECOND parallel loop
 * placing duplicate trades. Tracking the engine here (same pattern as
 * use-deriv-session.ts) lets it keep running, and any mounted page pick up
 * its live state, independent of which route is on screen.
 */
import { useEffect, useState } from "react";
import {
  startAutoTrader,
  loadTradeLogCached,
  type AutoTraderConfig,
  type TradeLog,
  type ScanResult,
  type TradeEventHandler,
  type RiskStopHandler,
} from "@/lib/autotrader";

export interface AutoTraderEngineState {
  running: boolean;
  logs: TradeLog[];
  lastScan: ScanResult | null;
  riskStopReasons: string[];
  /** Epoch ms until which the engine is risk-paused (auto-resumes) — null when not paused. */
  pausedUntil: number | null;
}

type LogsUpdater = TradeLog[] | ((prev: TradeLog[]) => TradeLog[]);

let _stop: (() => void) | null = null;
let _state: AutoTraderEngineState = {
  running: false,
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

export function isAutoTraderEngineRunning(): boolean {
  return _stop !== null;
}

/** Same value-or-updater signature as React's setState, so existing callers stay a drop-in swap. */
export function setEngineLogs(updater: LogsUpdater) {
  const next = typeof updater === "function" ? updater(_state.logs) : updater;
  dispatch({ logs: next });
}

export function setEngineRiskStopReasons(reasons: string[]) {
  dispatch({ riskStopReasons: reasons });
}

/**
 * Starts the engine if one isn't already running (no-ops and returns false
 * otherwise, so navigating back to the page and pressing Start can't spawn a
 * second parallel loop). `onEvent`/`onRiskStop` should only perform side
 * effects (toasts, sounds, notifications) — log/running state is owned here
 * and read via `useAutoTraderEngine()`.
 */
export function startAutoTraderEngine(
  config: AutoTraderConfig,
  onEvent: TradeEventHandler,
  onRiskStop: RiskStopHandler | undefined,
  balanceUsd?: number | (() => number | undefined),
): boolean {
  if (_stop) return false;
  dispatch({ riskStopReasons: [], pausedUntil: null });
  _stop = startAutoTrader(
    config,
    (log, meta) => {
      setEngineLogs((prev) => {
        const exists = prev.find((l) => l.id === log.id);
        return exists ? prev.map((l) => (l.id === log.id ? log : l)) : [log, ...prev].slice(0, 50);
      });
      onEvent(log, meta);
    },
    (reasons, pausedUntil) => {
      // Risk events now PAUSE the engine (it auto-resumes) instead of killing
      // it — keep running=true and surface the pause window to the UI.
      dispatch({ riskStopReasons: reasons, pausedUntil: pausedUntil ?? null });
      onRiskStop?.(reasons, pausedUntil);
    },
    (scan) => dispatch({ lastScan: scan, pausedUntil: _state.pausedUntil && Date.now() >= _state.pausedUntil ? null : _state.pausedUntil }),
    balanceUsd,
  );
  dispatch({ running: true });
  return true;
}

export function stopAutoTraderEngine() {
  _stop?.();
  _stop = null;
  dispatch({ running: false, pausedUntil: null, riskStopReasons: [] });
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
