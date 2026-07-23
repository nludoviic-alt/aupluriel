// Heartbeat + lookup for the "online" green dot in the messenger. Regular
// users may only ever query admins' presence (the only people they can DM),
// mirroring the trust boundary already enforced on /api/chat/* — admins can
// query any userId.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { markOnline, getOnlineUserIds, getLastSeenMap } from "@/lib/presence.server";
import { markMessagesDelivered } from "@/lib/chat-delivery.server";

export const Route = createFileRoute("/api/presence")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);
        
        // If the user (especially admin) has set their status to offline, 
        // we don't mark them as online in the ephemeral presence tracker.
        if (user.online_status !== 'offline') {
          markOnline(user.id);
        }
        
        markMessagesDelivered(getDb(), user.id, user.is_admin === 1);
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
        const db = getDb();
        
        if (user.is_admin === 0) {
          const admins = db.prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: number }[];
          const adminIds = new Set(admins.map((a) => a.id));
          allowedIds = requestedIds.filter((id) => adminIds.has(id));
        }

        // Filter out users who have manually set their status to 'offline'
        const offlineUsers = db.prepare(
          `SELECT id FROM users WHERE id IN (${allowedIds.join(',') || 'NULL'}) AND online_status = 'offline'`
        ).all() as { id: number }[];
        const offlineIds = new Set(offlineUsers.map(u => u.id));
        
        const filteredAllowedIds = allowedIds.filter(id => !offlineIds.has(id));

        const onlineUserIds = getOnlineUserIds(filteredAllowedIds);
        const lastSeenMap = getLastSeenMap(allowedIds);

        return json({ onlineUserIds, lastSeenMap });
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
