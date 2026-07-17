import { useEffect } from "react";
import { api } from "@/lib/api";

const HEARTBEAT_INTERVAL_MS = 20_000;

/** Pings the server periodically so other users can see this account as online. */
export function useHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const ping = () => api.post("/api/presence", {}).catch(() => {});
    ping();
    const interval = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enabled]);
}
