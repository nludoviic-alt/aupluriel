import { createFileRoute } from "@tanstack/react-router";
import { getFullUserFromRequest } from "@/lib/auth.server";

// Fixed desktop-only access code gating the messenger UI. Override via env if ever needed.
const DESKTOP_CHAT_CODE = process.env.MESSENGER_DESKTOP_CODE || "0123";

export const Route = createFileRoute("/api/chat/verify-code")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as { code?: string };

        if (body.code !== DESKTOP_CHAT_CODE) {
          return json({ valid: false, error: "Code incorrect." }, 401);
        }

        return json({ valid: true });
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
