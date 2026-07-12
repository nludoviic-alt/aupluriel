// Admin control endpoint for the SERVER auto-trader (bot-engine.server.ts) —
// lets an admin activate/deactivate a user's bot and see who's actually live.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import { getBotRuntime, loadBotConfig, startBotForUser, stopBotForUser } from "@/lib/bot-engine.server";
import { DEFAULT_CONFIG } from "@/lib/signal-core";

export const Route = createFileRoute("/api/admin/bot")({
  server: {
    handlers: {
      // Per-user activation + live status, for every non-admin account.
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const rows = getDb()
          .prepare(
            `SELECT u.id AS userId, bs.enabled AS enabled, bs.config AS config,
                    CASE WHEN us.deriv_token IS NOT NULL AND us.deriv_token != '' THEN 1 ELSE 0 END AS hasToken
             FROM users u
             LEFT JOIN bot_state bs ON bs.user_id = u.id
             LEFT JOIN user_settings us ON us.user_id = u.id
             WHERE u.is_admin = 0`,
          )
          .all() as { userId: number; enabled: number | null; config: string | null; hasToken: number }[];

        const statuses = rows.map((r) => {
          const runtime = getBotRuntime(r.userId);
          let mode: "demo" | "live" | null = null;
          if (r.config) {
            try {
              mode = JSON.parse(r.config).mode === "live" ? "live" : "demo";
            } catch {
              // config malformé — mode inconnu, on n'affiche rien plutôt que de deviner.
            }
          }
          return {
            userId: r.userId,
            enabled: !!r.enabled,
            running: runtime.running,
            hasToken: !!r.hasToken,
            mode,
            lastError: runtime.lastError,
          };
        });

        return json({ statuses });
      },

      // Force-start / force-stop a user's bot (admin only).
      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          userId?: number;
          action?: "start" | "stop";
        };
        const { userId, action } = body;
        if (!userId || !action) return json({ error: "userId et action requis." }, 400);

        if (action === "start") {
          // Reprend la config du dernier run de CET utilisateur (mise, mode…) —
          // à défaut, DEFAULT_CONFIG (mode "demo") pour ne jamais activer du live
          // sans que l'utilisateur l'ait lui-même déjà choisi une fois.
          const config = loadBotConfig(userId) ?? DEFAULT_CONFIG;
          try {
            await startBotForUser(userId, config);
          } catch (e) {
            return json({ error: (e as Error).message }, 400);
          }
          return json({ ok: true, running: true, mode: config.mode });
        }

        if (action === "stop") {
          stopBotForUser(userId);
          return json({ ok: true, running: false });
        }

        return json({ error: "action start|stop requise" }, 400);
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
