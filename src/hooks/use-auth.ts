import { useEffect, useState } from "react";
import { api, getToken, clearToken } from "@/lib/api";

interface User {
  id: number;
  email: string;
  username: string;
  email_verified?: number;
  status?: string;
  is_admin?: number;
  created_at: number;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  logout: () => void;
  refresh: () => Promise<void>;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<{ user: User }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
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
