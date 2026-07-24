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

        // Also return bot config (for broker enable/disable toggles)
        const botState = db.prepare("SELECT config FROM bot_state WHERE user_id = ?").get(auth.userId) as { config?: string } | undefined;
        const result = { ...settings, bot_config: botState?.config ?? null };

        return json(result);
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
          kraken_api_key?: string;
          kraken_api_secret?: string;
          binance_api_key?: string;
          binance_api_secret?: string;
          oanda_api_key?: string;
          oanda_account_id?: string;
          oanda_is_practice?: boolean;
          enableDeriv?: boolean;
          enableKraken?: boolean;
          enableBinance?: boolean;
          enableOanda?: boolean;
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
              auto_backtest_enabled = COALESCE(?, auto_backtest_enabled),
              kraken_api_key = COALESCE(?, kraken_api_key),
              kraken_api_secret = COALESCE(?, kraken_api_secret),
              binance_api_key = COALESCE(?, binance_api_key),
              binance_api_secret = COALESCE(?, binance_api_secret),
              oanda_api_key = COALESCE(?, oanda_api_key),
              oanda_account_id = COALESCE(?, oanda_account_id),
              oanda_is_practice = COALESCE(?, oanda_is_practice)
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
          body.kraken_api_key ?? null,
          body.kraken_api_secret ?? null,
          body.binance_api_key ?? null,
          body.binance_api_secret ?? null,
          body.oanda_api_key ?? null,
          body.oanda_account_id ?? null,
          body.oanda_is_practice === undefined ? null : (body.oanda_is_practice ? 1 : 0),
          auth.userId,
        );

        const updated = db
          .prepare("SELECT * FROM user_settings WHERE user_id = ?")
          .get(auth.userId);

        // ── Broker toggles: stored in bot_state.config (JSON) ──
        const brokerToggles: Record<string, boolean | undefined> = {
          enableDeriv: body.enableDeriv,
          enableKraken: body.enableKraken,
          enableBinance: body.enableBinance,
          enableOanda: body.enableOanda,
        };
        const hasToggle = Object.values(brokerToggles).some((v) => v !== undefined);
        if (hasToggle) {
          const botState = db.prepare("SELECT config FROM bot_state WHERE user_id = ?").get(auth.userId) as { config?: string } | undefined;
          let config: Record<string, unknown> = {};
          try { config = botState?.config ? JSON.parse(botState.config) : {}; } catch { /* ignore */ }
          if (brokerToggles.enableDeriv !== undefined) config.enableDeriv = brokerToggles.enableDeriv;
          if (brokerToggles.enableKraken !== undefined) config.enableKraken = brokerToggles.enableKraken;
          if (brokerToggles.enableBinance !== undefined) config.enableBinance = brokerToggles.enableBinance;
          if (brokerToggles.enableOanda !== undefined) config.enableOanda = brokerToggles.enableOanda;
          db.prepare("UPDATE bot_state SET config = ?, updated_at = unixepoch() WHERE user_id = ?").run(JSON.stringify(config), auth.userId);
          // Hot-swap if bot is running
          try {
            const { updateConfigForUser } = await import("@/lib/bot-engine.server");
            updateConfigForUser(auth.userId, config as any);
          } catch { /* bot engine not available in browser */ }
        }

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
