import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import { listUnresolvedOrderIntents, resolveOrderIntent } from "@/lib/order-intent.server";

export const Route = createFileRoute("/api/admin/order-intents")({
  server: { handlers: {
    GET: async ({ request }) => {
      if (!(await requireAdmin(request))) return Response.json({ error: "Admin requis" }, { status: 403 });
      return Response.json({ intents: listUnresolvedOrderIntents() });
    },
    POST: async ({ request }) => {
      if (!(await requireAdmin(request))) return Response.json({ error: "Admin requis" }, { status: 403 });
      const body = await request.json().catch(() => ({})) as { id?: string; reference?: string; contractId?: number | null; noPurchaseConfirmed?: boolean };
      if (!body.id || !body.reference) return Response.json({ error: "id et preuve requis" }, { status: 400 });
      try {
        resolveOrderIntent(body.id, { reference: body.reference, contractId: body.contractId ?? null, noPurchaseConfirmed: body.noPurchaseConfirmed === true });
        return Response.json({ success: true });
      } catch (error) {
        return Response.json({ error: (error as Error).message }, { status: 400 });
      }
    },
  }},
});
