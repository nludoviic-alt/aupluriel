import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/chat/messages")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const groupId = url.searchParams.get("groupId");

        if (!groupId) return json({ error: "groupId requis" }, 400);

        const db = getDb();

        // Verify user has access to this group. Non-admins get an identical
        // "not found" for both a nonexistent group and one they're just not
        // in — distinguishing the two (404 vs 403) would let someone confirm
        // a group exists without ever being able to see it.
        const group = db
          .prepare("SELECT is_direct, recipient_id FROM chat_groups WHERE id = ?")
          .get(groupId) as { is_direct: number; recipient_id: number | null } | undefined;

        if (user.is_admin === 0) {
          const hasAccess =
            !!group &&
            (group.is_direct === 1
              ? group.recipient_id === user.id
              : !!db.prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?").get(groupId, user.id));
          if (!hasAccess) return json({ error: "Groupe de chat non trouvé." }, 404);
        } else if (!group) {
          return json({ error: "Groupe de chat non trouvé." }, 404);
        }

        const rows = db
          .prepare(`
            SELECT m.id, m.group_id AS groupId, m.sender_id AS senderId, m.content, m.created_at AS createdAt, m.read_at AS readAt,
                   u.username AS senderUsername, u.is_admin AS senderIsAdmin
            FROM chat_messages m
            JOIN users u ON m.sender_id = u.id
            WHERE m.group_id = ?
            ORDER BY m.created_at ASC
            LIMIT 200
          `)
          .all(groupId) as {
          id: string;
          groupId: string;
          senderId: number;
          content: string;
          createdAt: number;
          readAt: number | null;
          senderUsername: string;
          senderIsAdmin: number;
        }[];

        return json({ messages: rows });
      },

      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          groupId?: string;
          content?: string;
        };

        if (!body.groupId || !body.content || typeof body.content !== "string" || body.content.trim() === "") {
          return json({ error: "groupId et content requis." }, 400);
        }

        const db = getDb();

        // Verify group exists and check access (same non-existence vs no-access
        // ambiguity as GET above — a non-admin gets one uniform 404 either way).
        const group = db
          .prepare("SELECT name, is_direct, recipient_id FROM chat_groups WHERE id = ?")
          .get(body.groupId) as { name: string; is_direct: number; recipient_id: number | null } | undefined;

        if (user.is_admin === 0) {
          const hasAccess =
            !!group &&
            (group.is_direct === 1
              ? group.recipient_id === user.id
              : !!db.prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?").get(body.groupId, user.id));
          if (!hasAccess) return json({ error: "Groupe de chat non trouvé." }, 404);
        } else if (!group) {
          return json({ error: "Groupe de chat non trouvé." }, 404);
        }

        const newId = randomUUID();
        const now = Math.floor(Date.now() / 1000);

        db.prepare(
          "INSERT INTO chat_messages (id, group_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(newId, body.groupId, user.id, body.content.trim(), now);

        // Send Push Notifications to recipient(s)
        try {
          const recipientIds: number[] = [];

          if (group.is_direct === 1) {
            if (user.is_admin === 1) {
              if (group.recipient_id) {
                recipientIds.push(group.recipient_id);
              }
            } else {
              const admins = db
                .prepare("SELECT id FROM users WHERE is_admin = 1")
                .all() as { id: number }[];
              recipientIds.push(...admins.map((a) => a.id));
            }
          } else {
            const members = db
              .prepare("SELECT user_id FROM chat_group_members WHERE group_id = ? AND user_id != ?")
              .all(body.groupId, user.id) as { user_id: number }[];
            recipientIds.push(...members.map((m) => m.user_id));
          }

          const pushTitle = group.is_direct === 1
            ? `Message de ${user.username}`
            : `Groupe ${group.name || "Messagerie"}`;

          const pushBody = body.content.trim().startsWith("data:image/")
              ? "📷 Photo"
              : body.content.trim().length > 60
                ? body.content.trim().substring(0, 60) + "..."
                : body.content.trim();

          const { sendPushToUser } = await import("@/lib/push.server");
          for (const recipientId of recipientIds) {
            sendPushToUser(recipientId, {
              title: pushTitle,
              body: pushBody,
              url: "/messenger",
            }).catch((err) => console.error("[push] error sending chat notification:", err));
          }
        } catch (pushErr) {
          console.error("[push] error sending push notifications:", pushErr);
        }

        return json({
          id: newId,
          groupId: body.groupId,
          senderId: user.id,
          content: body.content.trim(),
          createdAt: now,
          readAt: null,
          senderUsername: user.username,
          senderIsAdmin: user.is_admin,
        });
      },

      PUT: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          groupId?: string;
          messageId?: string;
        };

        if (!body.groupId || !body.messageId) {
          return json({ error: "groupId et messageId requis." }, 400);
        }

        const db = getDb();

        // Verify message exists and user has access to the group
        const message = db
          .prepare(`
            SELECT m.sender_id, g.recipient_id, g.is_direct
            FROM chat_messages m
            JOIN chat_groups g ON m.group_id = g.id
            WHERE m.id = ? AND m.group_id = ?
          `)
          .get(body.messageId, body.groupId) as { sender_id: number; recipient_id: number | null; is_direct: number } | undefined;

        if (!message) return json({ error: "Message non trouvé." }, 404);

        // Only the recipient can mark messages as read
        if (message.sender_id === user.id) {
          return json({ error: "Vous ne pouvez pas marquer vos propres messages comme lus." }, 400);
        }

        // Check if user is the recipient (for direct messages) or a member (for group chats)
        if (message.is_direct === 1 && message.recipient_id !== user.id && user.is_admin === 0) {
          return json({ error: "Accès refusé." }, 403);
        }

        if (message.is_direct === 0) {
          const membership = db
            .prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?")
            .get(body.groupId, user.id);
          if (!membership && user.is_admin === 0) return json({ error: "Accès refusé." }, 403);
        }

        const now = Math.floor(Date.now() / 1000);
        db.prepare("UPDATE chat_messages SET read_at = ? WHERE id = ?").run(now, body.messageId);

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
