// Admin control endpoint for the SERVER auto-trader (bot-engine.server.ts) —
// lets an admin activate/deactivate a user's bot(s) and see who's actually
// live. A user can have one independent bot_state row per preset — this returns one status entry per row
// that actually exists, not one per user.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import { ACTIVE_PRESETS, getBotRuntime, loadBotConfig, startBotForUser, stopBotForUser, type Preset } from "@/lib/bot-engine.server";
import { DEFAULT_CONFIG } from "@/lib/signal-core";
import { BOOM_PRESET, BOOM900_PRESET, BOOM_V2_PRESET, CRASH_PRESET, CRASH900_V2_PRESET, GOLD_PRESET, GOLD_V2_PRESET, LIQUIDITY_PRESET, LIQUIDITY_V2_PRESET, SCALPING_PRESET, SCALPING_V2_PRESET } from "@/lib/autotrader";

function canonicalConfig(preset: Preset) {
  if (preset === "boom") return { ...DEFAULT_CONFIG, ...BOOM_PRESET };
  if (preset === "boom900") return { ...DEFAULT_CONFIG, ...BOOM900_PRESET, mode: "demo" as const };
  if (preset === "crash") return { ...DEFAULT_CONFIG, ...CRASH_PRESET };
  if (preset === "scalping") return { ...DEFAULT_CONFIG, ...SCALPING_PRESET, mode: "demo" as const };
  if (preset === "liquidity") return { ...DEFAULT_CONFIG, ...LIQUIDITY_PRESET, mode: "demo" as const };
  if (preset === "gold") return { ...DEFAULT_CONFIG, ...GOLD_PRESET, mode: "demo" as const };
  if (preset === "crash900") return { ...DEFAULT_CONFIG, ...CRASH900_V2_PRESET, mode: "demo" as const };
  if (preset === "boomv2") return { ...DEFAULT_CONFIG, ...BOOM_V2_PRESET, mode: "demo" as const };
  if (preset === "scalpingv2") return { ...DEFAULT_CONFIG, ...SCALPING_V2_PRESET, mode: "demo" as const };
  if (preset === "liquidityv2") return { ...DEFAULT_CONFIG, ...LIQUIDITY_V2_PRESET, mode: "demo" as const };
  if (preset === "goldv2") return { ...DEFAULT_CONFIG, ...GOLD_V2_PRESET, mode: "demo" as const };
  return DEFAULT_CONFIG;
}

export const Route = createFileRoute("/api/admin/bot")({
  server: {
    handlers: {
      // Per-(user, preset) activation + live status, for every non-admin account.
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const rows = getDb()
          .prepare(
            `SELECT u.id AS userId, bs.preset AS preset, bs.enabled AS enabled, bs.config AS config,
                    CASE WHEN us.deriv_token IS NOT NULL AND us.deriv_token != '' THEN 1 ELSE 0 END AS hasToken,
                    COALESCE(us.auto_backtest_enabled, 0) AS autoBacktestEnabled
             FROM users u
             LEFT JOIN bot_state bs ON bs.user_id = u.id
             LEFT JOIN user_settings us ON us.user_id = u.id
             WHERE u.is_admin = 0`,
          )
          .all() as { userId: number; preset: Preset | null; enabled: number | null; config: string | null; hasToken: number; autoBacktestEnabled: number }[];

        const statuses = rows
          .filter((r) => r.preset !== null) // LEFT JOIN: users who never started any bot have no bot_state row
          .map((r) => {
            const runtime = getBotRuntime(r.userId, r.preset!);
            let mode: "demo" | "live" | null = null;
            if (r.config) {
              try {
                mode = (JSON.parse(r.config).mode === "live") ? "live" : "demo";
              } catch { /* config malformé — mode inconnu, on n'affiche rien plutôt que de deviner. */ }
            }
            return {
              userId: r.userId,
              preset: r.preset,
              enabled: !!r.enabled,
              running: runtime.running,
              hasToken: !!r.hasToken,
              mode,
              lastError: runtime.lastError,
              autoBacktestEnabled: !!r.autoBacktestEnabled,
            };
          });

        return json({ statuses });
      },

      // Force-start / force-stop a user's bot for one preset / toggle auto backtest (admin only).
      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          userId?: number;
          preset?: Preset;
          action?: "start" | "stop" | "toggle-backtest";
          autoBacktestEnabled?: boolean;
        };
        const { userId, action } = body;
        if (!userId || !action) return json({ error: "userId et action requis." }, 400);

        const db = getDb();

        if ((action === "start" || action === "stop") && (!body.preset || !ACTIVE_PRESETS.includes(body.preset))) {
          return json({ error: "Preset inconnu." }, 400);
        }
        const preset = body.preset as Preset;

        if (action === "start") {
          // Reprend la config du dernier run de CE preset (mise, mode…) — à
          // défaut, la config canonique du preset (mode "demo") pour ne
          // jamais activer du live sans que l'utilisateur l'ait lui-même
          // déjà choisi une fois.
          const saved = loadBotConfig(userId, preset);
          const config = { ...canonicalConfig(preset), ...saved, mode: preset === "boom900" || preset === "scalping" || preset === "liquidity" || preset === "gold" || preset === "crash900" || preset.endsWith("v2") ? "demo" as const : saved?.mode ?? canonicalConfig(preset).mode };
          try {
            await startBotForUser(userId, preset, config);
          } catch (e) {
            return json({ error: (e as Error).message }, 400);
          }
          return json({ ok: true, running: true, preset, mode: config.mode });
        }

        if (action === "stop") {
          stopBotForUser(userId, preset, "Arrêté par l'administrateur depuis la console");
          return json({ ok: true, running: false, preset });
        }

        if (action === "toggle-backtest") {
          const { autoBacktestEnabled } = body;
          if (autoBacktestEnabled === undefined) return json({ error: "autoBacktestEnabled requis." }, 400);
          db.prepare("UPDATE user_settings SET auto_backtest_enabled = ? WHERE user_id = ?").run(autoBacktestEnabled ? 1 : 0, userId);
          return json({ ok: true, autoBacktestEnabled });
        }

        return json({ error: "action start|stop|toggle-backtest requise" }, 400);
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
