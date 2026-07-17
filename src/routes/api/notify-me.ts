// Lets the client relay a notification it just computed locally (a client-
// engine trade result, a UI-driven event) through the real Web Push channel
// instead of a page-lifetime-bound `new Notification()` — the latter only
// fires while the tab is open and focused, so on mobile it routinely misses
// events that happen while the screen is off or another app is in front.
import { createFileRoute } from "@tanstack/react-router";
import { getFullUserFromRequest } from "@/lib/auth.server";

export const Route = createFileRoute("/api/notify-me")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as { title?: string; body?: string; url?: string };
        if (!body.title || !body.body) return json({ error: "title et body requis." }, 400);

        const { sendPushToUser } = await import("@/lib/push.server");
        await sendPushToUser(user.id, { title: body.title, body: body.body, url: body.url ?? "/" });

        return json({ success: true });
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
