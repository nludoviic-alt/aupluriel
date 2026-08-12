import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import { ConfigRegistry } from "@/lib/config-registry.server";
import { ALL_PRESETS, type Preset, updateConfigForUser } from "@/lib/bot-engine.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/admin/config-registry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const url = new URL(request.url);
        const userId = Number(url.searchParams.get("userId"));
        const presetParam = url.searchParams.get("preset");

        if (!Number.isFinite(userId)) return json({ error: "userId requis." }, 400);
        if (!presetParam || !ALL_PRESETS.includes(presetParam as Preset)) {
          return json({ error: "Preset invalide." }, 400);
        }

        const preset = presetParam as Preset;
        const versions = ConfigRegistry.getVersionHistory(userId, preset, 50);
        const auditEvents = ConfigRegistry.getAuditEvents(userId, preset, 100);
        const latest = ConfigRegistry.getLatestVersion(userId, preset);

        return json({
          preset,
          userId,
          latestVersion: latest?.version_tag ?? "v1.0.0",
          versions,
          auditEvents,
        });
      },

      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        try {
          const body = await request.json();
          const { userId, preset, targetVersionId } = body;

          if (!Number.isFinite(userId) || !preset || !targetVersionId) {
            return json({ error: "Paramètres invalides (userId, preset, targetVersionId requis)." }, 400);
          }

          // Execute rollback in registry
          const result = ConfigRegistry.rollbackToVersion(
            Number(userId),
            preset as Preset,
            String(targetVersionId),
            admin.id
          );

          // Hot swap newly restored config into active engine
          const restoredConfig = JSON.parse(result.version.config_json);
          updateConfigForUser(Number(userId), preset as Preset, restoredConfig, admin.id, "auto-rollback");

          return json({
            success: true,
            restoredVersion: result.version,
            auditEvents: result.auditEvents,
          });
        } catch (err: any) {
          return json({ error: err?.message || "Erreur lors de la restauration de la version." }, 500);
        }
      },
    },
  },
});
