import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface BotTradeRow {
  id: string;
  user_id: number;
  time: number;
  symbol: string;
  direction: string;
  stake: number;
  payout: number;
  status: string;
  profit: number;
  confidence: number;
  tf_agreement: number;
  closed_at: number | null;
  mode: string | null;
  entry_price: number | null;
  duration_minutes: number | null;
}

export const Route = createFileRoute("/api/stats")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const db = getDb();
        const rows = db
          .prepare(
            `SELECT id, user_id, time, symbol, direction, stake, payout, status, profit, confidence, tf_agreement, closed_at, mode, entry_price, duration_minutes
             FROM bot_trades WHERE user_id = ? AND stake > 0 AND status IN ('won','lost')
             ORDER BY time ASC LIMIT 2000`,
          )
          .all(auth.userId) as BotTradeRow[];

        // Equity curve (cumulative P&L)
        let cum = 0;
        const equity = rows.map((r) => {
          cum += r.profit;
          return { t: r.closed_at ?? r.time, pnl: cum };
        });

        // By symbol
        const symbolMap = new Map<string, { trades: number; wins: number; pnl: number }>();
        for (const r of rows) {
          const e = symbolMap.get(r.symbol) ?? { trades: 0, wins: 0, pnl: 0 };
          e.trades++;
          if (r.status === "won") e.wins++;
          e.pnl += r.profit;
          symbolMap.set(r.symbol, e);
        }
        const bySymbol = [...symbolMap.entries()].map(([symbol, s]) => ({
          symbol,
          trades: s.trades,
          wins: s.wins,
          winRate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
          pnl: s.pnl,
        })).sort((a, b) => b.trades - a.trades);

        // By hour (UTC)
        const hourMap = new Map<number, { trades: number; wins: number; pnl: number }>();
        for (const r of rows) {
          const h = new Date(r.time).getUTCHours();
          const e = hourMap.get(h) ?? { trades: 0, wins: 0, pnl: 0 };
          e.trades++;
          if (r.status === "won") e.wins++;
          e.pnl += r.profit;
          hourMap.set(h, e);
        }
        const byHour = [...Array(24).keys()].map((h) => {
          const s = hourMap.get(h);
          return {
            hour: h,
            trades: s?.trades ?? 0,
            wins: s?.wins ?? 0,
            winRate: s && s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
            pnl: s?.pnl ?? 0,
          };
        });

        // By day
        const dayMap = new Map<string, { trades: number; wins: number; pnl: number }>();
        for (const r of rows) {
          const d = new Date(r.closed_at ?? r.time).toISOString().slice(0, 10);
          const e = dayMap.get(d) ?? { trades: 0, wins: 0, pnl: 0 };
          e.trades++;
          if (r.status === "won") e.wins++;
          e.pnl += r.profit;
          dayMap.set(d, e);
        }
        const byDay = [...dayMap.entries()].map(([date, s]) => ({
          date,
          trades: s.trades,
          wins: s.wins,
          winRate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
          pnl: s.pnl,
        })).sort((a, b) => a.date.localeCompare(b.date));

        // By session (london 07-16, newyork 13-22, asia 23-08)
        const sessionMap = new Map<string, { trades: number; wins: number; pnl: number }>();
        for (const r of rows) {
          const h = new Date(r.time).getUTCHours();
          let session = "other";
          if (h >= 7 && h < 16) session = "london";
          else if (h >= 13 && h < 22) session = "newyork";
          else if (h >= 23 || h < 8) session = "asia";
          const e = sessionMap.get(session) ?? { trades: 0, wins: 0, pnl: 0 };
          e.trades++;
          if (r.status === "won") e.wins++;
          e.pnl += r.profit;
          sessionMap.set(session, e);
        }
        const bySession = ["asia", "london", "newyork", "other"]
          .map((s) => {
            const e = sessionMap.get(s);
            return {
              session: s,
              trades: e?.trades ?? 0,
              wins: e?.wins ?? 0,
              winRate: e && e.trades > 0 ? (e.wins / e.trades) * 100 : 0,
              pnl: e?.pnl ?? 0,
            };
          })
          .filter((s) => s.trades > 0);

        // Demo vs live
        const modeMap = new Map<string, { trades: number; wins: number; pnl: number }>();
        for (const r of rows) {
          const m = r.mode ?? "demo";
          const e = modeMap.get(m) ?? { trades: 0, wins: 0, pnl: 0 };
          e.trades++;
          if (r.status === "won") e.wins++;
          e.pnl += r.profit;
          modeMap.set(m, e);
        }
        const byMode = ["demo", "live"]
          .map((m) => {
            const e = modeMap.get(m);
            return {
              mode: m,
              trades: e?.trades ?? 0,
              wins: e?.wins ?? 0,
              winRate: e && e.trades > 0 ? (e.wins / e.trades) * 100 : 0,
              pnl: e?.pnl ?? 0,
            };
          })
          .filter((m) => m.trades > 0);

        // Summary
        const totalTrades = rows.length;
        const totalWins = rows.filter((r) => r.status === "won").length;
        const totalPnl = rows.reduce((s, r) => s + r.profit, 0);
        const avgWin = rows.filter((r) => r.status === "won").reduce((s, r) => s + r.profit, 0) / Math.max(1, totalWins);
        const avgLoss = rows.filter((r) => r.status === "lost").reduce((s, r) => s + r.profit, 0) / Math.max(1, totalTrades - totalWins);
        const profitFactor = Math.abs(avgLoss * (totalTrades - totalWins)) > 0
          ? Math.abs(avgWin * totalWins) / Math.abs(avgLoss * (totalTrades - totalWins))
          : Infinity;

        return json({
          summary: {
            trades: totalTrades,
            wins: totalWins,
            losses: totalTrades - totalWins,
            winRate: totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0,
            netPnl: totalPnl,
            avgWin: totalWins > 0 ? avgWin : 0,
            avgLoss: totalTrades - totalWins > 0 ? avgLoss : 0,
            profitFactor,
            expectancy: totalTrades > 0 ? totalPnl / totalTrades : 0,
          },
          equity,
          bySymbol,
          byHour,
          byDay,
          bySession,
          byMode,
        });
      },
    },
  },
});
