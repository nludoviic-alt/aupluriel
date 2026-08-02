// Admin-only: for one user+preset, list every logged config_changes row
// (see logConfigChange in bot-engine.server.ts) alongside the trading
// performance right before vs. right after that exact edit — "did this
// actually help" answered from real trades instead of judged by feel.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import type { Preset } from "@/lib/bot-engine.server";
import { summarize, type Summary } from "@/lib/analytics";
import type { TradeLog } from "@/lib/autotrader";

interface ConfigChangeRow {
  id: string;
  user_id: number;
  preset: string;
  changed_at: number;
  changed_by: number | null;
  fields: string;
  source: "user" | "admin" | "auto-rollback";
}

const DEFAULT_WINDOW = 20;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/config-changes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const url = new URL(request.url);
        const userId = Number(url.searchParams.get("userId"));
        const presetParam = url.searchParams.get("preset");
        const windowSize = Math.min(200, Math.max(5, Number(url.searchParams.get("window")) || DEFAULT_WINDOW));
        if (!Number.isFinite(userId)) return json({ error: "userId requis." }, 400);
        if (presetParam !== "default" && presetParam !== "boom" && presetParam !== "crash" && presetParam !== "scalping") {
          return json({ error: "preset doit être 'default', 'boom', 'crash' ou 'scalping'." }, 400);
        }
        const preset = presetParam as Preset;

        const db = getDb();
        const changes = db
          .prepare("SELECT * FROM config_changes WHERE user_id = ? AND preset = ? ORDER BY changed_at ASC")
          .all(userId, preset) as ConfigChangeRow[];

        if (changes.length === 0) return json({ changes: [] });

        // Scoped by the trade's own explicit `preset` column, not symbol
        // inference — Scalping and Boom can both trade BOOM500.
        const closedTrades = db
          .prepare(
            `SELECT id, time, symbol, direction, stake, payout, status, profit, confidence, tf_agreement, closed_at, note
             FROM bot_trades
             WHERE user_id = ? AND status IN ('won','lost') AND preset = ?
             ORDER BY time ASC`,
          )
          .all(userId, preset) as TradeLog[];

        const changedByIds = [...new Set(changes.map((c) => c.changed_by).filter((id): id is number => id !== null))];
        const usernames = changedByIds.length
          ? new Map(
              (db.prepare(`SELECT id, username FROM users WHERE id IN (${changedByIds.map(() => "?").join(",")})`).all(...changedByIds) as { id: number; username: string }[])
                .map((u) => [u.id, u.username]),
            )
          : new Map<number, string>();

        const result = changes.map((c) => {
          const before = closedTrades.filter((t) => t.time < c.changed_at).slice(-windowSize);
          const after = closedTrades.filter((t) => t.time >= c.changed_at).slice(0, windowSize);
          const beforeSummary: Summary | null = before.length > 0 ? summarize(before) : null;
          const afterSummary: Summary | null = after.length > 0 ? summarize(after) : null;
          return {
            id: c.id,
            changedAt: c.changed_at,
            source: c.source,
            changedBy: c.source === "auto-rollback"
              ? "rollback automatique"
              : c.changed_by !== null ? (usernames.get(c.changed_by) ?? `user#${c.changed_by}`) : "compte lui-même",
            fields: JSON.parse(c.fields) as Record<string, { from: unknown; to: unknown }>,
            before: beforeSummary,
            beforeSampleSize: before.length,
            after: afterSummary,
            afterSampleSize: after.length,
          };
        });

        return json({ changes: result, windowSize });
      },
    },
  },
});
