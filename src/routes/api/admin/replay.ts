import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import { ReplayEngine } from "@/lib/replay-engine.server";
import { ALL_PRESETS, type Preset } from "@/lib/bot-engine.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/replay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        try {
          const body = await request.json();
          const { userId, preset, versionId, symbol, granularity, startTime, endTime } = body;

          if (!Number.isFinite(userId) || !preset || !versionId || !symbol) {
            return json({ error: "Paramètres requis: userId, preset, versionId, symbol." }, 400);
          }

          if (!ALL_PRESETS.includes(preset as Preset)) {
            return json({ error: "Preset invalide." }, 400);
          }

          const result = ReplayEngine.runReplay({
            userId: Number(userId),
            preset: preset as Preset,
            versionId: String(versionId),
            symbol: String(symbol),
            granularity: Number(granularity) || 60,
            startTime: startTime ? Number(startTime) : undefined,
            endTime: endTime ? Number(endTime) : undefined,
          });

          return json({ success: true, replay: result });
        } catch (err: any) {
          return json({ error: err?.message || "Erreur lors de l'exécution du replay." }, 500);
        }
      },
    },
  },
});
