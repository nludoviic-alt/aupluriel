// Toggle an emoji reaction on a message — WhatsApp-style: one reaction per
// (message, user), tapping the same emoji again removes it, tapping a
// different one replaces it.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { getReactions } from "@/lib/chat-reactions.server";

export const Route = createFileRoute("/api/chat/reactions")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as { messageId?: string; emoji?: string };
        if (!body.messageId || !body.emoji) return json({ error: "messageId et emoji requis." }, 400);

        const db = getDb();

        // Same non-existence vs no-access ambiguity guarded against as the
        // other chat routes — a non-admin gets one uniform 404 either way.
        const message = db
          .prepare(`
            SELECT m.group_id AS groupId, g.is_direct AS isDirect, g.recipient_id AS recipientId
            FROM chat_messages m
            JOIN chat_groups g ON m.group_id = g.id
            WHERE m.id = ?
          `)
          .get(body.messageId) as { groupId: string; isDirect: number; recipientId: number | null } | undefined;

        if (user.is_admin === 0) {
          const hasAccess =
            !!message &&
            (message.isDirect === 1
              ? message.recipientId === user.id
              : !!db.prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?").get(message.groupId, user.id));
          if (!hasAccess) return json({ error: "Message non trouvé." }, 404);
        } else if (!message) {
          return json({ error: "Message non trouvé." }, 404);
        }

        const existing = db
          .prepare("SELECT emoji FROM chat_message_reactions WHERE message_id = ? AND user_id = ?")
          .get(body.messageId, user.id) as { emoji: string } | undefined;

        if (existing?.emoji === body.emoji) {
          db.prepare("DELETE FROM chat_message_reactions WHERE message_id = ? AND user_id = ?").run(body.messageId, user.id);
        } else {
          db.prepare(`
            INSERT INTO chat_message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)
            ON CONFLICT(message_id, user_id) DO UPDATE SET emoji = excluded.emoji, created_at = unixepoch()
          `).run(body.messageId, user.id, body.emoji);
        }

        return json({ reactions: getReactions(db, body.messageId, user.id) });
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
