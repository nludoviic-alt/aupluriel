// Statut + trades de la stratégie "Index Seasonal" (piste A, idx-seasonal.server.ts).
// Preset autonome hors ServerBotEngine — donc pas dans /api/bot ; sa propre route.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";

// Inliné plutôt qu'importé de idx-seasonal.server.ts : évite de tirer tout le
// module scheduler (DerivTradingConnection…) dans le bundle de cette route.
const IDX_SEASONAL_PRESET = "idxseasonal";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const KILL_SWITCH_WINDOW_MS = 28 * 24 * 3600_000;
const KILL_SWITCH_MIN_TRADES = 20;
const KILL_SWITCH_MIN_PF = 1.0;

interface TradeRow {
  id: string;
  symbol: string;
  direction: string;
  stake: number;
  payout: number;
  status: string;
  profit: number;
  duration_minutes: number;
  entry_price: number;
  time: number;
  closed_at: number | null;
  exit_reason: string | null;
}

function computeStats(rows: TradeRow[]) {
  const closed = rows.filter((r) => r.status === "won" || r.status === "lost");
  const wins = closed.filter((r) => r.profit > 0);
  const losses = closed.filter((r) => r.profit <= 0);
  const gp = wins.reduce((a, r) => a + r.profit, 0);
  const gl = -losses.reduce((a, r) => a + r.profit, 0);
  const pnl = closed.reduce((a, r) => a + r.profit, 0);
  return {
    count: closed.length,
    open: rows.filter((r) => r.status === "open").length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    profitFactor: gl === 0 ? (gp > 0 ? Infinity : 0) : gp / gl,
    expectancy: closed.length ? pnl / closed.length : 0,
    pnl,
  };
}

export const Route = createFileRoute("/api/idx-seasonal")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const db = getDb();
        const state = db
          .prepare("SELECT enabled, updated_at FROM idx_seasonal_state WHERE id = 1")
          .get() as { enabled: number; updated_at: number } | undefined;

        const rows = db
          .prepare(
            `SELECT id, symbol, direction, stake, payout, status, profit, duration_minutes,
                    entry_price, time, closed_at, exit_reason
               FROM bot_trades WHERE preset = ? ORDER BY time DESC LIMIT 100`,
          )
          .all(IDX_SEASONAL_PRESET) as TradeRow[];

        const windowRows = db
          .prepare(
            `SELECT profit FROM bot_trades
              WHERE preset = ? AND status IN ('won','lost') AND time >= ?`,
          )
          .all(IDX_SEASONAL_PRESET, Date.now() - KILL_SWITCH_WINDOW_MS) as { profit: number }[];
        let killSwitch: { active: boolean; pf: number; n: number } | null = null;
        if (windowRows.length >= KILL_SWITCH_MIN_TRADES) {
          let gp = 0, gl = 0;
          for (const r of windowRows) r.profit > 0 ? (gp += r.profit) : (gl += -r.profit);
          const pf = gl === 0 ? Infinity : gp / gl;
          killSwitch = { active: pf < KILL_SWITCH_MIN_PF, pf, n: windowRows.length };
        }

        return json({
          enabled: state?.enabled === 1,
          updatedAt: state?.updated_at ?? null,
          killSwitch,
          stats: computeStats(rows),
          trades: rows.map((r) => ({
            id: r.id,
            symbol: r.symbol,
            direction: r.direction,
            stake: r.stake,
            payout: r.payout,
            status: r.status,
            profit: r.profit,
            durationMinutes: r.duration_minutes,
            entryPrice: r.entry_price,
            time: r.time,
            closedAt: r.closed_at,
            exitReason: r.exit_reason,
          })),
        });
      },

      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);
        const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
        if (typeof body.enabled !== "boolean") return json({ error: "enabled (booléen) requis." }, 400);

        getDb()
          .prepare(
            `INSERT INTO idx_seasonal_state (id, enabled, updated_at) VALUES (1, ?, unixepoch())
             ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = unixepoch()`,
          )
          .run(body.enabled ? 1 : 0);
        return json({ enabled: body.enabled });
      },
    },
  },
});
