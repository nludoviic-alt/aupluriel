import { api } from "./api";

/**
 * Relays a client-computed event through the real Web Push channel (see
 * /api/notify-me) instead of a bare `new Notification(...)`, which only
 * fires while the tab is open and focused — this arrives as a proper OS
 * notification even with the screen off or another app in front.
 */
export function relayPush(title: string, body: string, url?: string): void {
  api.post("/api/notify-me", { title, body, url }).catch(() => {});
}
