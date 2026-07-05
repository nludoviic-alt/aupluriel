/**
 * Hook global de session Deriv.
 * Module-level store partagé entre tous les composants — un seul appel HTTP,
 * tous les appelants reçoivent les mises à jour.
 */
import { useEffect, useState } from "react";
import { setDerivSession, subscribeBalance, getBalance, onDerivDisconnect } from "@/lib/deriv";
import { api } from "@/lib/api";

export interface DerivSession {
  connected: boolean;
  loginId: string;
  balance: number | null;
  currency: string;
  accountType: "demo" | "live" | null;
  connecting: boolean;
  error: string | null;
}

const ACCOUNT_KEY = "lio23.account_type";

// Shared module-level store
const _initial: DerivSession = {
  connected: false,
  loginId: "",
  balance: null,
  currency: "USD",
  accountType: null,
  connecting: false,
  error: null,
};
let _state: DerivSession = { ..._initial };
const _listeners = new Set<(s: DerivSession) => void>();
let _initStarted = false;
let _balanceUnsub: (() => void) | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function dispatch(update: Partial<DerivSession> | ((s: DerivSession) => DerivSession)) {
  _state = typeof update === "function" ? update(_state) : { ..._state, ...update };
  for (const l of _listeners) l(_state);
}

function startBalanceSubscription() {
  _balanceUnsub?.();
  _balanceUnsub = subscribeBalance((bal, cur) => {
    dispatch({ balance: bal, currency: cur });
  });
}

function initSession() {
  if (_initStarted) return;
  _initStarted = true;

  const accountType = (localStorage.getItem(ACCOUNT_KEY) as "demo" | "live") ?? "demo";
  dispatch({ connecting: true, error: null });

  api
    .post<{
      wsUrl?: string;
      loginId?: string;
      balance?: number;
      currency?: string;
      accountType?: "demo" | "live";
      error?: string;
    }>("/api/deriv-session", { account_type: accountType })
    .then((res) => {
      if (res.error || !res.wsUrl) {
        dispatch({ connecting: false, error: res.error ?? "Réponse invalide" });
        _initStarted = false;
        return;
      }
      setDerivSession(res.wsUrl, res.loginId, res.currency);
      dispatch({
        connected: true,
        loginId: res.loginId ?? "",
        balance: res.balance ?? null,
        currency: res.currency ?? "USD",
        accountType: res.accountType ?? accountType,
        connecting: false,
        error: null,
      });
      startBalanceSubscription();
      // Auto-reconnect when the WS session drops unexpectedly
      onDerivDisconnect(() => {
        if (_reconnectTimer) return; // already scheduled
        _balanceUnsub?.();
        _balanceUnsub = null;
        _initStarted = false;
        dispatch({ connected: false, balance: null, connecting: false, error: "Session expirée — reconnexion…" });
        _reconnectTimer = setTimeout(() => {
          _reconnectTimer = null;
          initSession();
        }, 4000);
      });
    })
    .catch((e: Error) => {
      dispatch({ connecting: false, error: e.message ?? "Connexion Deriv échouée" });
      _initStarted = false;
    });
}

/** Refresh balance from Deriv WS immediately (call after a trade settles). */
export async function refreshDerivBalance(): Promise<void> {
  if (!_state.connected) return;
  try {
    const bal = await getBalance();
    if (bal) dispatch({ balance: bal.balance, currency: bal.currency });
  } catch {
    // silent — balance will be updated by the subscription on next tick
  }
}

/** Force a full session re-init (use when OTP URL expired and WS is unauthenticated). */
export function reinitDerivSession(): void {
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _initStarted = false;
  _balanceUnsub?.();
  _balanceUnsub = null;
  onDerivDisconnect(null); // clear stale callback before reinit
  dispatch({ ..._initial });
  initSession();
}

export function useDerivSession(enabled = true): DerivSession {
  const [state, setLocal] = useState<DerivSession>(_state);

  useEffect(() => {
    const listener = (s: DerivSession) => setLocal(s);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !enabled) return;
    initSession();
  }, [enabled]);

  return state;
}
