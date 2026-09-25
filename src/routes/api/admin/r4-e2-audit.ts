import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import {
  getPostR4E2Performance,
  checkVersioningIntegrity,
  getRiskStopAuditReport,
  getShadowSavingsSummary,
  R4_E2_DEPLOYED_AT,
} from "../../../lib/r4-e2-audit.server";

export const Route = createFileRoute("/api/admin/r4-e2-audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        try {
          const performanceMatrix = getPostR4E2Performance();
          const versioningHealth = checkVersioningIntegrity();
          const riskStopAudit = getRiskStopAuditReport();
          const shadowSavings = getShadowSavingsSummary();

          return json({
            deployedAt: R4_E2_DEPLOYED_AT,
            performanceMatrix,
            versioningHealth,
            riskStopAudit,
            shadowSavings,
            status: "SUCCESS",
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Failed to fetch R4/E2 audit data";
          return json({ error: msg, status: "ERROR" }, 500);
        }
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
