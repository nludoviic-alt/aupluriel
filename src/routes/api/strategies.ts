import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/strategies")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const db = getDb();
        const rows = db
          .prepare("SELECT * FROM strategies WHERE user_id = ? ORDER BY created_at DESC")
          .all(auth.userId);
        return json(rows);
      },

      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json()) as {
          id?: string;
          name: string;
          pair: string;
          indicator: string;
          buy_threshold?: number;
          sell_threshold?: number;
          stop_loss?: number;
          take_profit?: number;
          enabled?: number;
        };

        if (!body.name || !body.pair || !body.indicator) {
          return json({ error: "Champs requis manquants" }, 400);
        }

        const id = body.id ?? randomUUID();
        const db = getDb();
        db.prepare(`
          INSERT OR REPLACE INTO strategies
            (id, user_id, name, pair, indicator, buy_threshold, sell_threshold, stop_loss, take_profit, enabled)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          auth.userId,
          body.name,
          body.pair,
          body.indicator,
          body.buy_threshold ?? 30,
          body.sell_threshold ?? 70,
          body.stop_loss ?? 2,
          body.take_profit ?? 4,
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
        db.prepare("DELETE FROM strategies WHERE id = ? AND user_id = ?").run(id, auth.userId);
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
