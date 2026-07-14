// Web Push subscription management — the public VAPID key ships to the
// client via import.meta.env.VITE_VAPID_PUBLIC_KEY (see push.server.ts),
// so this endpoint only ever stores/removes the subscription itself.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

export const Route = createFileRoute("/api/push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => null)) as {
          endpoint?: string;
          keys?: { p256dh?: string; auth?: string };
        } | null;
        if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
          return json({ error: "Abonnement push invalide" }, 400);
        }

        getDb().prepare(`
          INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
          VALUES (@endpoint, @userId, @p256dh, @auth)
          ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth
        `).run({ endpoint: body.endpoint, userId: auth.userId, p256dh: body.keys.p256dh, auth: body.keys.auth });

        return json({ ok: true });
      },

      DELETE: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => null)) as { endpoint?: string } | null;
        if (!body?.endpoint) return json({ error: "endpoint requis" }, 400);

        // Scoped to this user — can't unsubscribe someone else's device.
        getDb()
          .prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
          .run(body.endpoint, auth.userId);

        return json({ ok: true });
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
