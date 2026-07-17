// Heartbeat + lookup for the "online" green dot in the messenger. Regular
// users may only ever query admins' presence (the only people they can DM),
// mirroring the trust boundary already enforced on /api/chat/* — admins can
// query any userId.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { markOnline, getOnlineUserIds } from "@/lib/presence.server";

export const Route = createFileRoute("/api/presence")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);
        markOnline(user.id);
        return json({ success: true });
      },

      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const requestedIds = (url.searchParams.get("userIds") ?? "")
          .split(",")
          .map((s) => Number(s))
          .filter((n) => Number.isFinite(n));

        let allowedIds = requestedIds;
        if (user.is_admin === 0) {
          const admins = getDb().prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: number }[];
          const adminIds = new Set(admins.map((a) => a.id));
          allowedIds = requestedIds.filter((id) => adminIds.has(id));
        }

        return json({ onlineUserIds: getOnlineUserIds(allowedIds) });
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
