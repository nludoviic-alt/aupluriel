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

const REFRESH_RETRY_MS = 3000;
const MAX_REFRESH_RETRIES = 5;

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(attempt = 0) {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: User }>("/api/auth/me");
      setUser(data.user);
      setLoading(false);
    } catch {
      // api.ts already clears the token and redirects to /login itself for a
      // REAL 401 — by the time we're here, getToken() being null means that
      // already happened. Any other failure (network blip, timeout, a 5xx)
      // is not proof the session is invalid; mobile connections drop this
      // way constantly (weak signal, a SW-triggered reload racing the
      // network coming back). Treating it as "logged out" used to bounce
      // users back to /login mid-session on a normal flaky moment — retry
      // a few times before actually giving up on a still-valid token.
      if (!getToken()) {
        setUser(null);
        setLoading(false);
        return;
      }
      if (attempt < MAX_REFRESH_RETRIES) {
        setTimeout(() => { refresh(attempt + 1); }, REFRESH_RETRY_MS);
        return; // stay "loading" — don't flash a logged-out state mid-retry
      }
      setUser(null);
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  function logout() {
    clearToken();
    setUser(null);
    window.location.href = "/login";
  }

  return { user, loading, logout, refresh };
}
