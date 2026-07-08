// Control endpoint for the SERVER auto-trader (bot-engine.server.ts) — the
// engine that keeps trading with the app closed / phone locked.
import { createFileRoute } from "@tanstack/react-router";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { getDb } from "@/lib/db.server";
import {
  getBotRuntime,
  getBotTrades,
  getTodayStats,
  startBotForUser,
  stopBotForUser,
} from "@/lib/bot-engine.server";
import { DEFAULT_CONFIG, type AutoTraderConfig } from "@/lib/signal-core";

export const Route = createFileRoute("/api/bot")({
  server: {
    handlers: {
      // Status + recent server trades.
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const state = getDb()
          .prepare("SELECT enabled, config FROM bot_state WHERE user_id = ?")
          .get(user.id) as { enabled: number; config: string } | undefined;
        const runtime = getBotRuntime(user.id);
        const trades = getBotTrades(user.id, 20);
        // SQL over ALL of today's rows — summing the 20-trade window instead
        // made early wins vanish from the display as new events pushed them out.
        const today = getTodayStats(user.id);

        return json({
          enabled: !!state?.enabled,
          running: runtime.running,
          pausedUntil: runtime.pausedUntil,
          lastScan: runtime.lastScan,
          lastError: runtime.lastError,
          todayPnl: today.pnl,
          todayCount: today.count,
          trades,
        });
      },

      // start / stop.
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          action?: "start" | "stop";
          config?: Partial<AutoTraderConfig>;
        };

        if (body.action === "start") {
          // Config verrouillée : la stratégie (symboles forex, premiumOnly,
          // minConfidence…) est fixée par DEFAULT_CONFIG pour tout le monde —
          // pendant la phase d'entraînement collectif, seule la mise est
          // réglable par l'utilisateur. Mode forcé en démo.
          const requested = body.config ?? {};
          const stakeUsd = clamp(Number(requested.stakeUsd) || DEFAULT_CONFIG.stakeUsd, 1, 100);
          const maxDailyLossUsd = clamp(
            Number(requested.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd,
            1,
            500,
          );
          const config: AutoTraderConfig = { ...DEFAULT_CONFIG, stakeUsd, maxDailyLossUsd, mode: "demo" };
          try {
            await startBotForUser(user.id, config);
          } catch (e) {
            return json({ error: (e as Error).message }, 400);
          }
          return json({ ok: true, running: true });
        }

        if (body.action === "stop") {
          stopBotForUser(user.id);
          return json({ ok: true, running: false });
        }

        return json({ error: "action start|stop requise" }, 400);
      },
    },
  },
});

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
