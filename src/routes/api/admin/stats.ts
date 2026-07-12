// Admin-only: per-user trading recap (gains/losses/journal) across every
// account, plus the shared component-weight breakdown that the server bot
// actually learns from — this is the "what did our users' trading teach the
// app" view (see indicator-weights.server.ts for how it's used).
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import { getComponentBreakdownServer } from "@/lib/indicator-weights.server";

// Prediction from the offline replay harness (52 days, 2717 trades, exact live
// pipeline, neutral weights, no lookahead — commit 3629f36). Live trades are
// only compared from the moment that config went to production.
const BACKTEST_REFERENCE = {
  evPerDollar: 0.013,        // at minTfAgreement 3 (the deployed setting)
  binaryNote: "hors commissions/swap — l'EV réel attendu est un peu plus bas",
  windowDays: 52,
  simulatedTrades: 2717,
  measuredFromMs: 1783690000000, // 2026-07-10 ~13:26 UTC — deploy of minTfAgreement 3
};

interface UserStatsRow {
  user_id: number;
  trades: number;
  wins: number;
  losses: number;
  open: number;
  net_pnl: number;
  gross_win: number;
  gross_loss: number;
  avg_confidence: number;
  last_trade_at: number | null;
}

export const Route = createFileRoute("/api/admin/stats")({
  server: {
    handlers: {
      // GET /api/admin/stats           -> recap for every user
      // GET /api/admin/stats?userId=42 -> that user's recent trade journal
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const url = new URL(request.url);
        const userIdParam = url.searchParams.get("userId");
        const db = getDb();

        if (userIdParam) {
          const userId = Number(userIdParam);
          if (!Number.isFinite(userId)) return json({ error: "userId invalide." }, 400);
          const trades = db
            .prepare(
              `SELECT id, time, symbol, direction, stake, payout, status, profit, confidence,
                      tf_agreement, closed_at, note
               FROM bot_trades WHERE user_id = ? ORDER BY time DESC LIMIT 200`,
            )
            .all(userId);
          return json({ trades });
        }

        const rows = db
          .prepare(
            `SELECT
               user_id,
               COUNT(*) FILTER (WHERE status IN ('won','lost')) AS trades,
               COUNT(*) FILTER (WHERE status = 'won') AS wins,
               COUNT(*) FILTER (WHERE status = 'lost') AS losses,
               COUNT(*) FILTER (WHERE status = 'open') AS open,
               COALESCE(SUM(profit) FILTER (WHERE status IN ('won','lost')), 0) AS net_pnl,
               COALESCE(SUM(profit) FILTER (WHERE status = 'won'), 0) AS gross_win,
               COALESCE(-SUM(profit) FILTER (WHERE status = 'lost'), 0) AS gross_loss,
               COALESCE(AVG(confidence) FILTER (WHERE status IN ('won','lost')), 0) AS avg_confidence,
               MAX(time) AS last_trade_at
             FROM bot_trades
             GROUP BY user_id`,
          )
          .all() as UserStatsRow[];

        const users = db.prepare("SELECT id, username, email FROM users").all() as {
          id: number; username: string; email: string;
        }[];
        const statsByUser = new Map(rows.map((r) => [r.user_id, r]));

        const recap = users.map((u) => {
          const s = statsByUser.get(u.id);
          const trades = s?.trades ?? 0;
          return {
            userId: u.id,
            username: u.username,
            email: u.email,
            trades,
            wins: s?.wins ?? 0,
            losses: s?.losses ?? 0,
            open: s?.open ?? 0,
            winRate: trades ? Math.round(((s?.wins ?? 0) / trades) * 1000) / 10 : 0,
            netPnl: Math.round((s?.net_pnl ?? 0) * 100) / 100,
            profitFactor: (s?.gross_loss ?? 0) > 0 ? Math.round(((s?.gross_win ?? 0) / (s?.gross_loss ?? 1)) * 100) / 100 : null,
            avgConfidence: Math.round(s?.avg_confidence ?? 0),
            lastTradeAt: s?.last_trade_at ?? null,
          };
        }).sort((a, b) => b.trades - a.trades);

        // Shared learning data — what the friends' trades have actually taught
        // the app so far (see indicator-weights.server.ts).
        const componentBreakdown = getComponentBreakdownServer();

        // Backtest-vs-real: live EV per $ staked (fees included, since Deriv's
        // profit already nets them) against the 52-day harness prediction
        // (scratchpad/backtest-honest.ts, 2717 trades, neutral weights) so the
        // demo period can be judged objectively instead of by feel.
        const live = db
          .prepare(
            `SELECT COUNT(*) AS trades,
                    COALESCE(SUM(profit), 0) AS pnl,
                    COALESCE(SUM(stake), 0) AS staked,
                    COUNT(*) FILTER (WHERE status = 'won') AS wins
             FROM bot_trades WHERE status IN ('won','lost') AND time >= ?`,
          )
          .get(BACKTEST_REFERENCE.measuredFromMs) as { trades: number; pnl: number; staked: number; wins: number };
        const backtestVsReal = {
          reference: BACKTEST_REFERENCE,
          live: {
            trades: live.trades,
            evPerDollar: live.staked > 0 ? Math.round((live.pnl / live.staked) * 10000) / 10000 : null,
            winRate: live.trades > 0 ? Math.round((live.wins / live.trades) * 1000) / 10 : null,
            netPnl: Math.round(live.pnl * 100) / 100,
          },
        };

        // Confidence calibration: does a higher confidence score actually win
        // more often? Buckets closed trades by their confidence at entry —
        // if win rate doesn't rise with the bucket, the score isn't informative
        // regardless of how good the backtest EV looks in aggregate.
        const calibrationRows = db
          .prepare(
            `SELECT
               CASE
                 WHEN confidence < 60 THEN '<60'
                 WHEN confidence < 70 THEN '60-69'
                 WHEN confidence < 80 THEN '70-79'
                 WHEN confidence < 90 THEN '80-89'
                 ELSE '90-100'
               END AS bucket,
               COUNT(*) AS trades,
               COUNT(*) FILTER (WHERE status = 'won') AS wins,
               AVG(confidence) AS avg_confidence
             FROM bot_trades
             WHERE status IN ('won','lost')
             GROUP BY bucket`,
          )
          .all() as { bucket: string; trades: number; wins: number; avg_confidence: number }[];
        const bucketOrder = ["<60", "60-69", "70-79", "80-89", "90-100"];
        const byBucket = new Map(calibrationRows.map((r) => [r.bucket, r]));
        const calibration = bucketOrder
          .map((bucket) => {
            const r = byBucket.get(bucket);
            const trades = r?.trades ?? 0;
            return {
              bucket,
              trades,
              winRate: trades ? Math.round((r!.wins / trades) * 1000) / 10 : null,
              avgConfidence: trades ? Math.round(r!.avg_confidence) : null,
            };
          })
          .filter((b) => b.trades > 0);

        return json({ recap, componentBreakdown, backtestVsReal, calibration });
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
