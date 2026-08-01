// Control endpoint for the SERVER auto-trader (bot-engine.server.ts) — the
// engine that keeps trading with the app closed / phone locked.
import { createFileRoute } from "@tanstack/react-router";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { getDb } from "@/lib/db.server";
import {
  getAllTimeStats,
  getBotRuntime,
  getBotTrades,
  getBrokerBalances,
  getTodayStats,
  loadBotConfig,
  startBotForUser,
  stopBotForUser,
  updateConfigForUser,
} from "@/lib/bot-engine.server";
import { DEFAULT_CONFIG, type AutoTraderConfig } from "@/lib/signal-core";
import { BOOM_PRESET, BOOM_SYMBOLS } from "@/lib/autotrader";

/** True when this saved config is the Boom preset (same test as the admin console). */
function isBoomConfig(cfg: Partial<AutoTraderConfig>): boolean {
  return cfg.symbolMode === "watchlist"
    && Array.isArray(cfg.symbols)
    && cfg.symbols.length === BOOM_SYMBOLS.length
    && BOOM_SYMBOLS.every((s) => cfg.symbols!.includes(s));
}

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
        // Scope stats to the account currently configured (demo vs live) —
        // otherwise demo test trades and real-money trades summed into the
        // same total, making the numbers look wrong/inconsistent to the user.
        const savedConfig = (() => {
          if (!state?.config) return null;
          try {
            const saved = JSON.parse(state.config) as Partial<AutoTraderConfig>;
            return {
              stakeUsd: Number(saved.stakeUsd) || DEFAULT_CONFIG.stakeUsd,
              maxDailyLossUsd: Number(saved.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd,
              mode: saved.mode === "live" ? "live" as const : "demo" as const,
            };
          } catch {
            return null;
          }
        })();
        const mode: "demo" | "live" = savedConfig?.mode ?? "demo";
        // Which preset this account currently runs — lets the Auto-Trader page
        // show the active preset instead of guessing from the browser's own
        // localStorage draft (which the server never reads for strategy).
        const preset: "boom" | "default" = (() => {
          if (!state?.config) return "default";
          try {
            return isBoomConfig(JSON.parse(state.config)) ? "boom" : "default";
          } catch {
            return "default";
          }
        })();
        // SQL over ALL of today's rows — summing the 20-trade window instead
        // made early wins vanish from the display as new events pushed them out.
        const today = getTodayStats(user.id, mode);
        // All-time record — shown before a live-mode start so that decision is
        // informed by this user's actual track record, not a guess.
        const allTime = getAllTimeStats(user.id, mode);
        const brokerBalances = await getBrokerBalances(user.id);

        return json({
          enabled: !!state?.enabled,
          running: runtime.running,
          mode,
          preset,
          savedConfig,
          pausedUntil: runtime.pausedUntil,
          lastScan: runtime.lastScan,
          lastError: runtime.lastError,
          todayPnl: today.pnl,
          todayCount: today.count,
          trades,
          allTimeStats: allTime,
          brokerBalances,
        });
      },

      // start / stop.
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          action?: "start" | "stop" | "preset";
          config?: Partial<AutoTraderConfig>;
          preset?: "default" | "boom";
        };

        if (body.action === "start") {
          // Config: on reprend la config sauvegardée en DB (via loadBotConfig
          // qui fusionne avec DEFAULT_CONFIG) puis on override avec les champs
          // que l'utilisateur peut ajuster au démarrage (mise, mode).
          const requested = body.config ?? {};
          const stakeUsd = clamp(Number(requested.stakeUsd) || DEFAULT_CONFIG.stakeUsd, 1, 100);
          const savedConfig = loadBotConfig(user.id) ?? { ...DEFAULT_CONFIG };
          // Plancher : une mise relevée sans relever maxDailyLossUsd en même
          // temps piège le bot après ~1 perte (constaté en prod : mise $18 vs
          // plafond $15, pause jusqu'à minuit après une seule perte normale —
          // même classe d'incohérence que le trailing stop du preset Boom,
          // voir le commentaire sur BOOM_PRESET.trailingStopMinPeakUsd). Le
          // plafond doit couvrir au moins maxConsecutiveLosses pertes à mise
          // pleine, sinon une série normale — pas une dérive — tue la journée.
          const lossFloor = stakeUsd * (savedConfig.maxConsecutiveLosses || DEFAULT_CONFIG.maxConsecutiveLosses);
          const maxDailyLossUsd = clamp(
            Math.max(Number(requested.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd, lossFloor),
            1,
            500,
          );
          const mode = requested.mode === "live" ? "live" : "demo";
          const config: AutoTraderConfig = {
            ...savedConfig,
            stakeUsd,
            maxDailyLossUsd,
            mode,
          };
          try {
            await startBotForUser(user.id, config);
          } catch (e) {
            return json({ error: (e as Error).message }, 400);
          }
          return json({
            ok: true, running: true, mode, maxDailyLossUsd,
            adjustedLossCap: maxDailyLossUsd !== clamp(Number(requested.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd, 1, 500),
          });
        }

        if (body.action === "stop") {
          stopBotForUser(user.id, "Arrêté manuellement par l'utilisateur");
          return json({ ok: true, running: false });
        }

        // Switch THIS user's own bot between the Default and Boom presets.
        // Strategy fields sent with "start" are deliberately ignored (only
        // stake/mode are honored there), so a preset change has to be
        // persisted here to actually reach the server engine. The stake, the
        // daily loss cap and demo/live are always preserved — a preset switch
        // must never silently move money settings.
        if (body.action === "preset") {
          if (body.preset !== "boom" && body.preset !== "default") {
            return json({ error: "preset doit être 'boom' ou 'default'." }, 400);
          }
          const current = loadBotConfig(user.id) ?? { ...DEFAULT_CONFIG };
          const { stakeUsd, maxDailyLossUsd, mode } = current;
          const next: AutoTraderConfig = body.preset === "boom"
            ? { ...current, ...BOOM_PRESET, stakeUsd, maxDailyLossUsd, mode }
            : { ...current, ...DEFAULT_CONFIG, stakeUsd, maxDailyLossUsd, mode };

          // updateConfigForUser only UPDATEs — a user who never started the
          // bot has no bot_state row yet, so the switch would silently no-op.
          getDb().prepare(`
            INSERT INTO bot_state (user_id, enabled, config, updated_at) VALUES (?, 0, ?, unixepoch())
            ON CONFLICT(user_id) DO NOTHING
          `).run(user.id, JSON.stringify(next));
          updateConfigForUser(user.id, next);

          return json({ ok: true, preset: body.preset, config: next });
        }

        return json({ error: "action start|stop|preset requise" }, 400);
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
