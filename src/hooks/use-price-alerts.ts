/**
 * Hook qui surveille les ticks Deriv en temps réel et déclenche
 * les alertes prix/drawdown dès que les conditions sont remplies.
 */
import { useEffect, useRef } from "react";
import { subscribeTicks, SYMBOLS } from "@/lib/deriv";
import { loadTradeLog, todayPnl } from "@/lib/autotrader";
import { toast } from "sonner";

export interface PriceAlert {
  id: string;
  type: "price" | "signal" | "drawdown";
  pair: string;
  condition: string;
  value: number;
  enabled: boolean;
}

const ALERTS_KEY = "lio23.alerts";
const FIRED_KEY = "lio23.alerts_fired";
const COOLDOWN_MS = 15 * 60_000; // ne pas re-déclencher avant 15 min

function loadAlerts(): PriceAlert[] {
  try {
    return JSON.parse(localStorage.getItem(ALERTS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function loadFired(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveFired(f: Record<string, number>) {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(f));
  } catch {}
}

function sendNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || Notification.permission !== "granted") return;
  const n = new Notification(title, { body, icon: "/favicon.ico", tag, requireInteraction: false });
  setTimeout(() => n.close(), 10_000);
}

function derivSymbol(pair: string): string {
  return SYMBOLS.find((s) => s.label === pair)?.deriv ?? "";
}

export function usePriceAlerts() {
  const firedRef = useRef<Record<string, number>>(loadFired());

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Subscribe to ticks for each unique pair in enabled price alerts
    const alerts = loadAlerts().filter((a) => a.enabled && a.type === "price");
    const pairs = [...new Set(alerts.map((a) => derivSymbol(a.pair)).filter(Boolean))];

    const unsubs = pairs.map((deriv) =>
      subscribeTicks(deriv, (tick) => {
        const now = Date.now();
        const currentAlerts = loadAlerts().filter(
          (a) => a.enabled && a.type === "price" && derivSymbol(a.pair) === deriv,
        );

        for (const alert of currentAlerts) {
          const lastFired = firedRef.current[alert.id] ?? 0;
          if (now - lastFired < COOLDOWN_MS) continue;

          const triggered =
            (alert.condition === ">" && tick.quote > alert.value) ||
            (alert.condition === "<" && tick.quote < alert.value);

          if (triggered) {
            firedRef.current[alert.id] = now;
            saveFired(firedRef.current);

            const emoji = alert.condition === ">" ? "📈" : "📉";
            const msg = `${alert.pair} ${alert.condition === ">" ? "a dépassé" : "est passé sous"} ${alert.value.toLocaleString()}`;
            toast.success(`${emoji} Alerte prix — ${msg}`, { duration: 8000 });
            sendNotification(
              `${emoji} LIO23 — Alerte prix ${alert.pair}`,
              `Prix actuel: ${tick.quote.toLocaleString()} · Condition: ${alert.condition} ${alert.value.toLocaleString()}`,
              `alert-price-${alert.id}`,
            );
          }
        }
      }),
    );

    // Drawdown alerts — check every minute against today's P&L
    const drawdownInterval = setInterval(() => {
      const now = Date.now();
      const currentAlerts = loadAlerts().filter((a) => a.enabled && a.type === "drawdown");
      if (!currentAlerts.length) return;

      const logs = loadTradeLog();
      const pnl = todayPnl(logs);

      for (const alert of currentAlerts) {
        const lastFired = firedRef.current[alert.id] ?? 0;
        if (now - lastFired < COOLDOWN_MS) continue;

        const drawdownPct = pnl < 0 ? Math.abs(pnl) : 0;
        if (drawdownPct > alert.value) {
          firedRef.current[alert.id] = now;
          saveFired(firedRef.current);
          toast.warning(`🛑 Drawdown ${drawdownPct.toFixed(2)}% dépassé (seuil: ${alert.value}%)`, { duration: 10_000 });
          sendNotification(
            "🛑 LIO23 — Drawdown dépassé",
            `Perte journalière: $${Math.abs(pnl).toFixed(2)} · Seuil: ${alert.value}%`,
            `alert-drawdown-${alert.id}`,
          );
        }
      }
    }, 60_000);

    return () => {
      unsubs.forEach((u) => u());
      clearInterval(drawdownInterval);
    };
  }, []);
}
