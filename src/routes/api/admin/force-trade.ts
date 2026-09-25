// Admin force-trade endpoint — lets an admin manually execute a trade on
// behalf of a user via their running bot engine's Deriv connection.
import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import { forceTradeForUser, ALL_PRESETS, type Preset } from "@/lib/bot-engine.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/force-trade")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          userId: number;
          preset: string;
          symbol: string;
          direction: "CALL" | "PUT" | "MULTUP" | "MULTDOWN";
          stake: number;
          durationMinutes: number;
        };

        const { userId, preset, symbol, direction, stake, durationMinutes } = body;
        if (!userId || !preset || !ALL_PRESETS.includes(preset as Preset)) {
          return json({ error: "userId et preset valides requis." }, 400);
        }
        if (!symbol || !direction) return json({ error: "symbol et direction requis." }, 400);
        if (!stake || stake <= 0) return json({ error: "stake doit être positif." }, 400);
        if (!durationMinutes || durationMinutes < 1) return json({ error: "durationMinutes doit être ≥ 1." }, 400);

        try {
          const log = await forceTradeForUser(userId, preset as Preset, { symbol, direction, stake, durationMinutes });
          return json({ success: true, trade: log });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
