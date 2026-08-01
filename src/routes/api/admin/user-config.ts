// Admin-only: apply a targeted adjustment to one user's AutoTraderConfig —
// the "ajuster leurs stratégies au besoin" surface for the per-user insights
// panel. Deliberately a narrow whitelist of fields (symbols, minConfidence,
// excludedSymbols), not a free-form config overwrite: this is meant for
// admin-reviewed suggestions, not a backdoor to silently rewrite someone's
// whole strategy.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import { updateConfigForUser } from "@/lib/bot-engine.server";
import { DEFAULT_CONFIG, type AutoTraderConfig } from "@/lib/signal-core";
import { BOOM_PRESET, CRASH_PRESET } from "@/lib/autotrader";

interface PatchBody {
  userId?: number;
  symbols?: string[];
  minConfidence?: number;
  excludedSymbols?: string[];
  preset?: "default" | "boom" | "crash";
}

export const Route = createFileRoute("/api/admin/user-config")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as PatchBody;
        if (!body.userId || !Number.isFinite(body.userId)) {
          return json({ error: "userId requis." }, 400);
        }
        if (body.symbols === undefined && body.minConfidence === undefined && body.excludedSymbols === undefined && body.preset === undefined) {
          return json({ error: "Aucun champ à appliquer (symbols, minConfidence, excludedSymbols ou preset requis)." }, 400);
        }

        const db = getDb();
        const row = db.prepare("SELECT config FROM bot_state WHERE user_id = ?").get(body.userId) as
          | { config: string }
          | undefined;
        if (!row) return json({ error: "Aucune configuration trouvée pour cet utilisateur." }, 404);

        const config = JSON.parse(row.config) as AutoTraderConfig;
        if (body.symbols !== undefined) {
          if (!Array.isArray(body.symbols) || body.symbols.some((s) => typeof s !== "string")) {
            return json({ error: "symbols doit être un tableau de chaînes." }, 400);
          }
          config.symbols = body.symbols;
        }
        if (body.minConfidence !== undefined) {
          if (typeof body.minConfidence !== "number" || body.minConfidence < 0 || body.minConfidence > 100) {
            return json({ error: "minConfidence doit être un nombre entre 0 et 100." }, 400);
          }
          config.minConfidence = body.minConfidence;
        }
        if (body.excludedSymbols !== undefined) {
          if (!Array.isArray(body.excludedSymbols) || body.excludedSymbols.some((s) => typeof s !== "string")) {
            return json({ error: "excludedSymbols doit être un tableau de chaînes." }, 400);
          }
          config.excludedSymbols = body.excludedSymbols;
        }
        if (body.preset === "boom") {
          Object.assign(config, BOOM_PRESET);
        } else if (body.preset === "crash") {
          Object.assign(config, CRASH_PRESET);
        } else if (body.preset === "default") {
          const { stakeUsd, maxDailyLossUsd, mode } = config;
          Object.assign(config, DEFAULT_CONFIG, { stakeUsd, maxDailyLossUsd, mode });
        }

        updateConfigForUser(body.userId, config);

        return json({ success: true, config });
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
