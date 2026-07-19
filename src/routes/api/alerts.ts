import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/alerts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const db = getDb();
        const rows = db
          .prepare("SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC")
          .all(auth.userId);
        return json(rows);
      },

      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json()) as {
          id?: string;
          type: string;
          pair: string;
          condition: string;
          value?: number;
          enabled?: number;
        };

        if (!body.type || !body.pair || !body.condition) {
          return json({ error: "Champs requis manquants" }, 400);
        }

        const id = body.id ?? randomUUID();
        const db = getDb();
        db.prepare(`
          INSERT OR REPLACE INTO alerts
            (id, user_id, type, pair, condition, value, enabled)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          auth.userId,
          body.type,
          body.pair,
          body.condition,
          body.value ?? 0,
          body.enabled ?? 1,
        );

        return json({ id });
      },

      DELETE: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id requis" }, 400);

        const db = getDb();
        db.prepare("DELETE FROM alerts WHERE id = ? AND user_id = ?").run(id, auth.userId);
        return json({ ok: true });
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
