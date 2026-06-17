import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

// Helper to create JSON response
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/trades")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);

        const db = getDb();
        const trades = db
          .prepare(
            "SELECT * FROM trades WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
          )
          .all(auth.userId, limit);

        return json(trades);
      },

      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json()) as {
          id: string;
          time: number;
          symbol: string;
          direction: string;
          stake: number;
          payout?: number;
          status: string;
          profit?: number;
          confidence?: number;
          tf_agreement?: number;
          contract_id?: number;
          closed_at?: number;
        };

        if (!body.id || !body.symbol || !body.direction || !body.stake || !body.status) {
          return json({ error: "Champs requis manquants" }, 400);
        }

        const db = getDb();
        db.prepare(`
          INSERT OR REPLACE INTO trades
            (id, user_id, time, symbol, direction, stake, payout, status, profit, confidence, tf_agreement, contract_id, closed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          body.id,
          auth.userId,
          body.time ?? Date.now(),
          body.symbol,
          body.direction,
          body.stake,
          body.payout ?? 0,
          body.status,
          body.profit ?? 0,
          body.confidence ?? 0,
          body.tf_agreement ?? 0,
          body.contract_id ?? null,
          body.closed_at ?? null,
        );

        return json({ ok: true });
      },
    },
  },
});
