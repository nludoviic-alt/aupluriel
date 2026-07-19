// Server-side checker for user-configured price/drawdown alerts (`alerts`
// table) — replaces the old localStorage + live-WebSocket-tick version,
// which only ever fired while its tab was open. Polling once a minute trades
// a little latency for actually working with the app closed.
import { getDb } from "./db.server";
import { fetchCandlesServer } from "./deriv.server";

const CHECK_INTERVAL_MS = 60_000;
const COOLDOWN_MS = 15 * 60_000;

interface PriceAlertRow {
  id: string;
  user_id: number;
  type: string;
  pair: string;
  symbol: string | null;
  condition: string;
  value: number;
  last_fired_at: number | null;
}

function withinCooldown(lastFiredAtSec: number | null, nowMs: number): boolean {
  if (!lastFiredAtSec) return false;
  return nowMs - lastFiredAtSec * 1000 < COOLDOWN_MS;
}

async function checkPriceAlerts(): Promise<void> {
  const db = getDb();
  const alerts = db
    .prepare("SELECT * FROM alerts WHERE type = 'price' AND enabled = 1")
    .all() as PriceAlertRow[];
  if (!alerts.length) return;

  const symbols = [...new Set(alerts.map((a) => a.symbol).filter((s): s is string => !!s))];
  const prices = new Map<string, number>();
  for (const symbol of symbols) {
    try {
      const candles = await fetchCandlesServer(symbol, 60, 1);
      const last = candles[candles.length - 1];
      if (last) prices.set(symbol, last.close);
    } catch (e) {
      console.error(`[price-alerts] Échec prix pour ${symbol}:`, (e as Error).message);
    }
  }

  const now = Date.now();
  const { sendPushToUser } = await import("./push.server");

  for (const alert of alerts) {
    if (!alert.symbol) continue;
    const price = prices.get(alert.symbol);
    if (price === undefined) continue;
    if (withinCooldown(alert.last_fired_at, now)) continue;

    const triggered =
      (alert.condition === ">" && price > alert.value) || (alert.condition === "<" && price < alert.value);
    if (!triggered) continue;

    db.prepare("UPDATE alerts SET last_fired_at = ? WHERE id = ?").run(Math.floor(now / 1000), alert.id);
    sendPushToUser(alert.user_id, {
      title: `Au Pluriel — Alerte prix ${alert.pair}`,
      body: `Prix actuel : ${price.toLocaleString()} · Condition : ${alert.condition} ${alert.value.toLocaleString()}`,
      url: "/alerts",
    }).catch(() => {});
  }
}

async function checkDrawdownAlerts(): Promise<void> {
  const db = getDb();
  const alerts = db
    .prepare("SELECT * FROM alerts WHERE type = 'drawdown' AND enabled = 1")
    .all() as PriceAlertRow[];
  if (!alerts.length) return;

  const now = Date.now();
  const { sendPushToUser } = await import("./push.server");
  // Checks the SERVER bot's real P&L (bot_trades) — the old client version
  // read the browser-engine's local trade log, which is empty/irrelevant for
  // anyone actually trading through the 24/7 server bot.
  const { getTodayStats } = await import("./bot-engine.server");

  for (const alert of alerts) {
    if (withinCooldown(alert.last_fired_at, now)) continue;

    const { pnl } = getTodayStats(alert.user_id);
    const drawdown = pnl < 0 ? Math.abs(pnl) : 0;
    if (drawdown <= alert.value) continue;

    db.prepare("UPDATE alerts SET last_fired_at = ? WHERE id = ?").run(Math.floor(now / 1000), alert.id);
    sendPushToUser(alert.user_id, {
      title: "Au Pluriel — Drawdown dépassé",
      body: `Perte journalière : $${drawdown.toFixed(2)} · Seuil configuré : ${alert.value}`,
      url: "/alerts",
    }).catch(() => {});
  }
}

async function tick(): Promise<void> {
  await checkPriceAlerts();
  await checkDrawdownAlerts();
}

export function startPriceAlertsScheduler(): void {
  setTimeout(() => tick().catch((e) => console.error("[price-alerts] Tick échoué:", (e as Error).message)), 20_000);
  setInterval(() => tick().catch((e) => console.error("[price-alerts] Tick échoué:", (e as Error).message)), CHECK_INTERVAL_MS);
  console.log("[price-alerts] Scheduler démarré.");
}
