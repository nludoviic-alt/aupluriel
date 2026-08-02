import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "@/lib/auth.server";
import { buildOpportunities } from "@/lib/opportunities.server";

export const Route = createFileRoute("/api/opportunities")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);
        try {
          return json(await buildOpportunities(auth.userId));
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
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
