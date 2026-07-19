import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

export const Route = createFileRoute("/api/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const db = getDb();
        const settings = db
          .prepare("SELECT * FROM user_settings WHERE user_id = ?")
          .get(auth.userId) as Record<string, unknown> | undefined;

        return json(settings ?? {});
      },

      PUT: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json()) as {
          deriv_token?: string;
          account_type?: string;
          ai_provider?: string;
          ai_api_key?: string;
          risk_per_trade?: number;
          max_drawdown?: number;
          default_stake_usd?: number;
          auto_backtest_enabled?: boolean;
          avatar?: string;
          online_status?: "online" | "offline";
        };

        const db = getDb();
        if (body.avatar !== undefined) {
          db.prepare("UPDATE users SET avatar = ? WHERE id = ?").run(body.avatar, auth.userId);
        }
        if (body.online_status !== undefined) {
          db.prepare("UPDATE users SET online_status = ? WHERE id = ?").run(body.online_status, auth.userId);
        }

        db.prepare(`
          UPDATE user_settings
          SET deriv_token = COALESCE(?, deriv_token),
              account_type = COALESCE(?, account_type),
              ai_provider = COALESCE(?, ai_provider),
              ai_api_key = COALESCE(?, ai_api_key),
              risk_per_trade = COALESCE(?, risk_per_trade),
              max_drawdown = COALESCE(?, max_drawdown),
              default_stake_usd = COALESCE(?, default_stake_usd),
              auto_backtest_enabled = COALESCE(?, auto_backtest_enabled)
          WHERE user_id = ?
        `).run(
          body.deriv_token ?? null,
          body.account_type ?? null,
          body.ai_provider ?? null,
          body.ai_api_key ?? null,
          body.risk_per_trade ?? null,
          body.max_drawdown ?? null,
          body.default_stake_usd ?? null,
          body.auto_backtest_enabled === undefined ? null : (body.auto_backtest_enabled ? 1 : 0),
          auth.userId,
        );

        const updated = db
          .prepare("SELECT * FROM user_settings WHERE user_id = ?")
          .get(auth.userId);
        return json(updated);
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
