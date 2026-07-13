import { useEffect } from "react";
import { toast } from "sonner";
import { currentActiveSessions, SESSION_HOURS, type TradingSession } from "@/lib/autotrader";

const CHECK_INTERVAL_MS = 30_000; // cheap local check — no network calls
const NOTIFIED_KEY = "lio23.market_open_notified";
// A session just opened if we're within this many minutes of its start —
// covers the case where the app loads right after the transition happened.
const FRESH_OPEN_WINDOW_MIN = 5;

function todayKey(session: TradingSession): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}_${session}`;
}

function loadNotified(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

function saveNotified(set: Set<string>) {
  try {
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set].slice(-20)));
  } catch {}
}

/** Minutes elapsed since this session's opening bell (wraps past midnight). */
function minutesSinceOpen(session: TradingSession): number {
  const { open } = SESSION_HOURS[session];
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const diff = utcMins - open * 60;
  return diff < 0 ? diff + 24 * 60 : diff;
}

function notifyMarketOpen(session: TradingSession) {
  const label = SESSION_HOURS[session].label;
  toast.info(`🔔 Marché ouvert — session ${label}`, {
    description: "Nouvelle fenêtre de trading disponible.",
  });
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    const n = new Notification(`🔔 PLURIEL — Session ${label} ouverte`, {
      body: "Une nouvelle session de marché vient de démarrer.",
      icon: "/favicon.ico",
      tag: `lio23-market-open-${session}`,
    });
    setTimeout(() => n.close(), 10000);
  }
}

/**
 * Fires a notification (toast + browser Notification) whenever a trading
 * session transitions from closed to open — once per session per UTC day.
 * Reuses the same browser notification permission as the signal-alert bell.
 */
export function useMarketOpenNotify(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const notified = loadNotified();

    function maybeNotify(session: TradingSession) {
      const key = todayKey(session);
      if (notified.has(key)) return;
      notified.add(key);
      saveNotified(notified);
      notifyMarketOpen(session);
    }

    // Catch a session that opened just before the app loaded.
    for (const s of currentActiveSessions()) {
      if (minutesSinceOpen(s) <= FRESH_OPEN_WINDOW_MIN) maybeNotify(s);
    }

    let prevActive = new Set(currentActiveSessions());
    const id = setInterval(() => {
      const nowActive = new Set(currentActiveSessions());
      for (const s of nowActive) {
        if (!prevActive.has(s)) maybeNotify(s);
      }
      prevActive = nowActive;
    }, CHECK_INTERVAL_MS);

    return () => clearInterval(id);
  }, [enabled]);
}
