import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import { ReviewEngine } from "@/lib/review-engine.server";
import { ALL_PRESETS, type Preset } from "@/lib/bot-engine.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/review-reports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const url = new URL(request.url);
        const userId = Number(url.searchParams.get("userId"));
        const presetParam = url.searchParams.get("preset");
        const periodType = (url.searchParams.get("period") as "daily" | "weekly") || undefined;

        if (!Number.isFinite(userId) || !presetParam || !ALL_PRESETS.includes(presetParam as Preset)) {
          return json({ error: "userId et preset valides requis." }, 400);
        }

        const reports = ReviewEngine.getReports(userId, presetParam as Preset, periodType, 30);
        return json({ reports });
      },

      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        try {
          const body = await request.json();
          const { userId, preset, periodType } = body;

          if (!Number.isFinite(userId) || !preset || !periodType) {
            return json({ error: "Paramètres invalides (userId, preset, periodType requis)." }, 400);
          }

          const report = ReviewEngine.generateReport({
            userId: Number(userId),
            preset: preset as Preset,
            periodType: periodType === "weekly" ? "weekly" : "daily",
          });

          return json({ success: true, report });
        } catch (err: any) {
          return json({ error: err?.message || "Erreur lors de la génération du rapport." }, 500);
        }
      },
    },
  },
});
