import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/signal-history")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);
        const rows = getDb()
          .prepare(`
            SELECT time, pair, direction AS dir, confidence AS conf, tf
            FROM signal_history WHERE user_id = ? ORDER BY time DESC LIMIT 100
          `)
          .all(auth.userId);
        return json(rows);
      },
      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);
        const body = await request.json() as {
          time?: number;
          pair?: string;
          dir?: string;
          conf?: number;
          tf?: string;
        };
        if (!body.pair || !body.dir || !body.tf) return json({ error: "Signal incomplet" }, 400);
        getDb().prepare(`
          INSERT INTO signal_history (user_id, time, pair, direction, confidence, tf)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(auth.userId, body.time ?? Date.now(), body.pair, body.dir, body.conf ?? 0, body.tf);
        return json({ ok: true });
      },
      DELETE: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);
        getDb().prepare("DELETE FROM signal_history WHERE user_id = ?").run(auth.userId);
        return json({ ok: true });
      },
    },
  },
});
