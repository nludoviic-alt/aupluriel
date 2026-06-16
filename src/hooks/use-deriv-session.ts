/**
 * Hook global de session Deriv.
 * Lit le token depuis localStorage, appelle authorize() une seule fois,
 * puis subscribe au solde en temps réel.
 * Exposé dans le root pour alimenter tout le layout (header balance, badge mode).
 */
import { useEffect, useState } from "react";
import { authorize, subscribeBalance } from "@/lib/deriv";

export interface DerivSession {
  connected: boolean;       // authorize() réussie
  loginId: string;
  balance: number | null;
  currency: string;
  accountType: "demo" | "live" | null;
  connecting: boolean;
  error: string | null;
}

const SESSION_KEY = "lio23.deriv_token";
const ACCOUNT_KEY = "lio23.account_type";

// Singleton — on ne veut authorizer qu'une fois par session navigateur
let _authorized = false;

export function useDerivSession(): DerivSession {
  const [state, setState] = useState<DerivSession>({
    connected: false,
    loginId: "",
    balance: null,
    currency: "USD",
    accountType: null,
    connecting: false,
    error: null,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const token = localStorage.getItem(SESSION_KEY);
    if (!token) return;

    if (_authorized) return;

    setState((s) => ({ ...s, connecting: true, error: null }));

    authorize(token)
      .then((res) => {
        _authorized = true;
        const auth = res.authorize;
        const accountType = (localStorage.getItem(ACCOUNT_KEY) as "demo" | "live") ?? "demo";
        setState({
          connected: true,
          loginId: auth?.loginid ?? "",
          balance: auth?.balance ?? null,
          currency: auth?.currency ?? "USD",
          accountType,
          connecting: false,
          error: null,
        });
      })
      .catch((e: Error) => {
        setState((s) => ({
          ...s,
          connecting: false,
          error: e.message ?? "Connexion Deriv échouée",
        }));
      });
  }, []);

  // Subscribe au solde live une fois connecté
  useEffect(() => {
    if (!state.connected) return;
    const unsub = subscribeBalance((bal, cur) => {
      setState((s) => ({ ...s, balance: bal, currency: cur }));
    });
    return unsub;
  }, [state.connected]);

  return state;
}
