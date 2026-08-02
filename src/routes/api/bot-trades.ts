// Persistent trade journal — reads from bot_trades (server DB), which never
// resets. Unlike the browser localStorage log (lio23.autotrader_log, capped
// at 200 entries and clearable), this endpoint returns the full history.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";
import { logFromRow } from "@/lib/bot-engine.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/bot-trades")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);

        const db = getDb();
        const rows = db
          .prepare(
            "SELECT * FROM bot_trades WHERE user_id = ? ORDER BY time DESC LIMIT ?",
          )
          .all(auth.userId, limit) as Record<string, unknown>[];

        const trades = rows.map((r) => logFromRow(r as unknown as Parameters<typeof logFromRow>[0]));
        return json(trades);
      },
    },
  },
});
