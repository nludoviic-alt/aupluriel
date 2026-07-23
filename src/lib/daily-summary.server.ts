// Server-side daily summary & win-rate alert scheduler.
// Sends a push notification to every approved user with an active server bot
// at the end of their trading day, and a separate alert if their 7-day rolling
// win rate falls below the breakeven threshold.

import { getDb } from "./db.server";

const CHECK_INTERVAL_MS = 15 * 60_000; // every 15 min — fires once per day per user
const SUMMARY_HOUR_UTC = 22; // 22:00 UTC = end of NY session → daily recap
const MIN_TRADES_FOR_ALERT = 10; // don't alert on tiny samples
const BREAKEVEN_WIN_RATE = 0.571; // 1/(1+0.75) — matches minPayoutRatio 0.75

const notifiedSummary = new Set<string>(); // `${userId}-${dateKey}`

function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

interface DailyStats {
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
}

function getDailyStats(userId: number): DailyStats {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS wins,
         COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses,
         COALESCE(SUM(CASE WHEN status IN ('won','lost') THEN profit ELSE 0 END), 0) AS pnl
       FROM bot_trades WHERE user_id = ? AND time >= ? AND stake > 0`,
    )
    .get(userId, start.getTime()) as { wins: number; losses: number; pnl: number };
  return { trades: row.wins + row.losses, wins: row.wins, losses: row.losses, pnl: row.pnl };
}

function get7DayStats(userId: number): { trades: number; wins: number; winRate: number } {
  const since = Date.now() - 7 * 24 * 60 * 60_000;
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS wins,
         COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses
       FROM bot_trades WHERE user_id = ? AND time >= ? AND stake > 0 AND status IN ('won','lost')`,
    )
    .get(userId, since) as { wins: number; losses: number };
  const trades = row.wins + row.losses;
  return { trades, wins: row.wins, winRate: trades > 0 ? row.wins / trades : 0 };
}

const notifiedWinRateAlert = new Set<string>(); // `${userId}-${weekKey}`

function weekKey(): string {
  const d = new Date();
  const week = Math.floor(d.getTime() / (7 * 24 * 60 * 60_000));
  return `${d.getUTCFullYear()}-W${week}`;
}

async function tick(): Promise<void> {
  const now = new Date();
  const hour = now.getUTCHours();
  const dateKey = todayKey();

  // Only run the summary check near end of trading day
  const isSummaryTime = hour >= SUMMARY_HOUR_UTC && hour < SUMMARY_HOUR_UTC + 1;

  const db = getDb();
  const users = db
    .prepare("SELECT id FROM users WHERE status = 'approved'")
    .all() as { id: number }[];

  const { sendPushToUser } = await import("./push.server");

  await Promise.allSettled(
    users.map(async (u) => {
      // ── Daily summary push (once per day per user, after 22:00 UTC) ──
      if (isSummaryTime) {
        const summaryKey = `${u.id}-${dateKey}`;
        if (notifiedSummary.has(summaryKey)) return;
        const stats = getDailyStats(u.id);
        if (stats.trades === 0) return; // no trades today — don't spam
        notifiedSummary.add(summaryKey);
        if (notifiedSummary.size > 200) {
          const [oldest] = notifiedSummary;
          notifiedSummary.delete(oldest);
        }

        const pnlStr = stats.pnl >= 0 ? `+$${stats.pnl.toFixed(2)}` : `-$${Math.abs(stats.pnl).toFixed(2)}`;
        await sendPushToUser(u.id, {
          title: "Au Pluriel — Résumé du jour",
          body: `${stats.trades} trade${stats.trades > 1 ? "s" : ""} · ${stats.wins}W / ${stats.losses}L · P&L ${pnlStr}`,
          url: "/stats",
        });
      }

      // ── 7-day win rate alert (once per week per user) ──
      const wkKey = weekKey();
      const alertKey = `${u.id}-${wkKey}`;
      if (notifiedWinRateAlert.has(alertKey)) return;
      const week = get7DayStats(u.id);
      if (week.trades < MIN_TRADES_FOR_ALERT) return;
      if (week.winRate >= BREAKEVEN_WIN_RATE) return;
      notifiedWinRateAlert.add(alertKey);
      if (notifiedWinRateAlert.size > 200) {
        const [oldest] = notifiedWinRateAlert;
        notifiedWinRateAlert.delete(oldest);
      }

      const pct = Math.round(week.winRate * 100);
      await sendPushToUser(u.id, {
        title: "Au Pluriel — Alerte win rate",
        body: `Win rate 7 jours : ${pct}% — en dessous du breakeven (${Math.round(BREAKEVEN_WIN_RATE * 100)}%). Le bot perd de l'argent sur la semaine.`,
        url: "/stats",
      });
    }),
  );
}

export function startDailySummaryScheduler(): void {
  setTimeout(() => tick().catch((e) => console.error("[daily-summary] Tick échoué:", (e as Error).message)), 10_000);
  setInterval(() => tick().catch((e) => console.error("[daily-summary] Tick échoué:", (e as Error).message)), CHECK_INTERVAL_MS);
  console.log("[daily-summary] Scheduler démarré.");
}
