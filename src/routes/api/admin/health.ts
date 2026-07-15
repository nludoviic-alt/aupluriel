// Feature health status endpoint — read-only view of health-monitor.server.ts's
// latest check results, for the admin panel.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";

export const Route = createFileRoute("/api/admin/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const checks = getDb()
          .prepare(
            `SELECT check_key AS checkKey, label, status, detail, checked_at AS checkedAt
             FROM health_status ORDER BY
               CASE status WHEN 'error' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
               label ASC`,
          )
          .all();

        return json({ checks });
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
