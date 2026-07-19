// CRUD for user-configured price/drawdown alerts — server-side storage so
// price-alerts.server.ts can check them on a schedule and push even with the
// app closed (the old client version lived only in localStorage, invisible
// to the server).
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { randomUUID } from "crypto";

interface AlertRow {
  id: string;
  user_id: number;
  type: string;
  pair: string;
  symbol: string | null;
  condition: string;
  value: number;
  enabled: number;
  last_fired_at: number | null;
  created_at: number;
}

function toApi(r: AlertRow) {
  return {
    id: r.id,
    type: r.type,
    pair: r.pair,
    symbol: r.symbol,
    condition: r.condition,
    value: r.value,
    enabled: r.enabled === 1,
    lastFiredAt: r.last_fired_at,
    createdAt: r.created_at,
  };
}

export const Route = createFileRoute("/api/alerts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const rows = getDb()
          .prepare("SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC")
          .all(user.id) as AlertRow[];

        return json({ alerts: rows.map(toApi) });
      },

      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          type?: string;
          pair?: string;
          symbol?: string | null;
          condition?: string;
          value?: number;
        };

        if (!body.type || !["price", "drawdown"].includes(body.type)) {
          return json({ error: "type doit être 'price' ou 'drawdown'." }, 400);
        }
        if (!body.pair || typeof body.pair !== "string") {
          return json({ error: "pair requis." }, 400);
        }
        if (!body.condition || typeof body.condition !== "string") {
          return json({ error: "condition requise." }, 400);
        }
        if (typeof body.value !== "number" || !Number.isFinite(body.value)) {
          return json({ error: "value doit être un nombre." }, 400);
        }
        if (body.type === "price" && !body.symbol) {
          return json({ error: "symbol requis pour une alerte de type price." }, 400);
        }

        const id = randomUUID();
        getDb()
          .prepare(
            "INSERT INTO alerts (id, user_id, type, pair, symbol, condition, value, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
          )
          .run(id, user.id, body.type, body.pair, body.symbol ?? null, body.condition, body.value);

        const row = getDb().prepare("SELECT * FROM alerts WHERE id = ?").get(id) as AlertRow;
        return json({ alert: toApi(row) });
      },

      PATCH: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as { id?: string; enabled?: boolean };
        if (!body.id || typeof body.enabled !== "boolean") {
          return json({ error: "id et enabled requis." }, 400);
        }

        const result = getDb()
          .prepare("UPDATE alerts SET enabled = ? WHERE id = ? AND user_id = ?")
          .run(body.enabled ? 1 : 0, body.id, user.id);

        if (result.changes === 0) return json({ error: "Alerte introuvable." }, 404);
        return json({ success: true });
      },

      DELETE: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        let id = url.searchParams.get("id");
        if (!id) {
          const body = (await request.json().catch(() => ({}))) as { id?: string };
          id = body.id ?? null;
        }
        if (!id) return json({ error: "id requis." }, 400);

        const result = getDb().prepare("DELETE FROM alerts WHERE id = ? AND user_id = ?").run(id, user.id);
        if (result.changes === 0) return json({ error: "Alerte introuvable." }, 404);
        return json({ success: true });
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
