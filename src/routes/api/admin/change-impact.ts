import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import { ChangeImpactTracker } from "@/lib/change-impact.server";
import { ALL_PRESETS, type Preset } from "@/lib/bot-engine.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/change-impact")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const url = new URL(request.url);
        const userId = Number(url.searchParams.get("userId"));
        const presetParam = url.searchParams.get("preset");
        const versionId = url.searchParams.get("versionId");
        const windowSize = Number(url.searchParams.get("window")) || 20;

        if (!Number.isFinite(userId) || !presetParam || !versionId) {
          return json({ error: "Paramètres requis: userId, preset, versionId." }, 400);
        }

        if (!ALL_PRESETS.includes(presetParam as Preset)) {
          return json({ error: "Preset invalide." }, 400);
        }

        const result = ChangeImpactTracker.analyzeImpact({
          userId,
          preset: presetParam as Preset,
          versionId,
          windowSize: Math.min(100, Math.max(5, windowSize)),
        });

        if (!result) {
          return json({ error: "Version introuvable." }, 404);
        }

        return json(result);
      },
    },
  },
});
