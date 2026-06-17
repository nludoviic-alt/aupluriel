/**
 * Hook global de session Deriv.
 * Module-level store partagé entre tous les composants — un seul appel HTTP,
 * tous les appelants reçoivent les mises à jour.
 */
import { useEffect, useState } from "react";
import { setDerivSession, subscribeBalance } from "@/lib/deriv";
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

function dispatch(update: Partial<DerivSession> | ((s: DerivSession) => DerivSession)) {
  _state = typeof update === "function" ? update(_state) : { ..._state, ...update };
  for (const l of _listeners) l(_state);
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
        _initStarted = false; // allow retry
        return;
      }
      setDerivSession(res.wsUrl);
      dispatch({
        connected: true,
        loginId: res.loginId ?? "",
        balance: res.balance ?? null,
        currency: res.currency ?? "USD",
        accountType: res.accountType ?? accountType,
        connecting: false,
        error: null,
      });
      // Subscribe to live balance updates
      _balanceUnsub?.();
      _balanceUnsub = subscribeBalance((bal, cur) => {
        dispatch({ balance: bal, currency: cur });
      });
    })
    .catch((e: Error) => {
      dispatch({ connecting: false, error: e.message ?? "Connexion Deriv échouée" });
      _initStarted = false; // allow retry
    });
}

export function useDerivSession(): DerivSession {
  const [state, setLocal] = useState<DerivSession>(_state);

  useEffect(() => {
    const listener = (s: DerivSession) => setLocal(s);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    initSession();
  }, []);

  return state;
}
