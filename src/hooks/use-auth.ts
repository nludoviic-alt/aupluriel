/**
 * Shared module-level auth store — one /api/auth/me call per page load,
 * not one per component. Every one of __root.tsx, bottom-nav.tsx,
 * mobile-menu.tsx, app-sidebar.tsx, index.tsx, settings.tsx, piste.tsx,
 * journal.tsx, skills.tsx, messenger.tsx, admin.tsx and
 * admin.users.$userId.tsx used to call useAuth() as a plain per-instance
 * hook, each firing its own independent fetch on mount — confirmed live in
 * nginx access logs as 5-6 near-simultaneous /api/auth/me requests for a
 * single page load. Harmless on desktop, but on mobile every one of those
 * is a full round trip over a slower, higher-latency connection — mirrors
 * the shared-store pattern already used by use-deriv-session.ts.
 */
import { useEffect, useState } from "react";
import { api, getToken, clearToken } from "@/lib/api";

interface User {
  id: number;
  email: string;
  username: string;
  avatar?: string;
  online_status?: "online" | "offline";
  email_verified?: number;
  status?: string;
  is_admin?: number;
  chat_enabled?: number;
  created_at: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  logout: () => void;
  refresh: () => Promise<void>;
}

// Progressive backoff, not a flat 3s x 5 — that could block __root.tsx's
// full-screen loading spinner (blocks the ENTIRE app, not just this hook)
// for up to 15s on a run of transient failures, which is its own bad mobile
// experience ("tourne en rond") even though it correctly avoids a false
// logout. 4 retries, 1s/2s/3s/4s = 10s worst case, front-loaded so a single
// blip clears almost immediately.
const REFRESH_RETRY_DELAYS_MS = [1000, 2000, 3000, 4000];

const _initial = { user: null as User | null, loading: true };
let _state = { ..._initial };
const _listeners = new Set<(s: typeof _state) => void>();
let _refreshInFlight = false;

function dispatch(update: Partial<typeof _state>) {
  _state = { ..._state, ...update };
  for (const l of _listeners) l(_state);
}

async function refresh(attempt = 0): Promise<void> {
  if (attempt === 0) {
    if (_refreshInFlight) return; // a refresh is already running — don't stack another
    _refreshInFlight = true;
  }
  if (!getToken()) {
    dispatch({ user: null, loading: false });
    _refreshInFlight = false;
    return;
  }
  try {
    const data = await api.get<{ user: User }>("/api/auth/me");
    dispatch({ user: data.user, loading: false });
    _refreshInFlight = false;
  } catch {
    // api.ts already clears the token and redirects to /login itself for a
    // REAL 401 — by the time we're here, getToken() being null means that
    // already happened. Any other failure (network blip, timeout, a 5xx)
    // is not proof the session is invalid; mobile connections drop this
    // way constantly. Treating it as "logged out" used to bounce users back
    // to /login mid-session on a normal flaky moment — retry a few times
    // before actually giving up on a still-valid token.
    if (!getToken()) {
      dispatch({ user: null, loading: false });
      _refreshInFlight = false;
      return;
    }
    if (attempt < REFRESH_RETRY_DELAYS_MS.length) {
      setTimeout(() => { refresh(attempt + 1); }, REFRESH_RETRY_DELAYS_MS[attempt]);
      return; // stay "loading" — don't flash a logged-out state mid-retry
    }
    dispatch({ user: null, loading: false });
    _refreshInFlight = false;
  }
}

export function useAuth(): AuthState {
  const [state, setLocal] = useState(_state);

  useEffect(() => {
    const listener = (s: typeof _state) => setLocal(s);
    _listeners.add(listener);
    return () => { _listeners.delete(listener); };
  }, []);

  useEffect(() => {
    refresh();
  }, []);

  function logout() {
    clearToken();
    dispatch({ user: null, loading: false });
    window.location.href = "/login";
  }

  return { user: state.user, loading: state.loading, logout, refresh };
}
