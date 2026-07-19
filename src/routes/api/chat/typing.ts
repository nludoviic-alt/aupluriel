import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest, type FullUser } from "@/lib/auth.server";
import { markTyping, getTypingUserIds } from "@/lib/typing.server";

export const Route = createFileRoute("/api/chat/typing")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const groupId = url.searchParams.get("groupId");
        if (!groupId) return json({ error: "groupId requis" }, 400);

        if (!hasGroupAccess(groupId, user)) return json({ error: "Accès refusé." }, 403);

        return json({ typingUserIds: getTypingUserIds(groupId, user.id) });
      },

      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as { groupId?: string };
        if (!body.groupId) return json({ error: "groupId requis" }, 400);

        if (!hasGroupAccess(body.groupId, user)) return json({ error: "Accès refusé." }, 403);

        markTyping(body.groupId, user.id);
        return json({ success: true });
      },
    },
  },
});

function hasGroupAccess(groupId: string, user: FullUser): boolean {
  if (user.is_admin === 1) return true;
  const db = getDb();
  const group = db
    .prepare("SELECT is_direct, recipient_id FROM chat_groups WHERE id = ?")
    .get(groupId) as { is_direct: number; recipient_id: number | null } | undefined;
  if (!group) return false;
  if (group.is_direct === 1) return group.recipient_id === user.id;
  const membership = db
    .prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?")
    .get(groupId, user.id);
  return !!membership;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
