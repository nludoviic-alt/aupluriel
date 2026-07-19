import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { getReactions } from "@/lib/chat-reactions.server";
import { markMessagesDelivered } from "@/lib/chat-delivery.server";
import { randomUUID } from "crypto";

interface MessageRow {
  id: string;
  groupId: string;
  senderId: number;
  content: string;
  createdAt: number;
  readAt: number | null;
  deliveredAt: number | null;
  editedAt: number | null;
  deletedAt: number | null;
  senderUsername: string;
  senderIsAdmin: number;
  replyToId: string | null;
  replyToContent: string | null;
  replyToSenderUsername: string | null;
  replyToDeletedAt: number | null;
}

// Shared access check: does `user` have access to `groupId`? Non-admins get
// an identical "not found" for both a nonexistent group and one they're just
// not in — distinguishing the two (404 vs 403) would let someone confirm a
// group exists without ever being able to see it.
function loadGroupWithAccess(
  db: ReturnType<typeof getDb>,
  groupId: string,
  user: { id: number; is_admin: number }
) {
  const group = db
    .prepare("SELECT id, name, is_direct, recipient_id FROM chat_groups WHERE id = ?")
    .get(groupId) as { id: string; name: string; is_direct: number; recipient_id: number | null } | undefined;

  if (user.is_admin === 0) {
    const hasAccess =
      !!group &&
      (group.is_direct === 1
        ? group.recipient_id === user.id
        : !!db.prepare("SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ?").get(groupId, user.id));
    return hasAccess ? group : null;
  }
  return group ?? null;
}

function serializeMessage(r: MessageRow) {
  const deleted = !!r.deletedAt;
  return {
    id: r.id,
    groupId: r.groupId,
    senderId: r.senderId,
    content: deleted ? "" : r.content,
    createdAt: r.createdAt,
    readAt: r.readAt,
    deliveredAt: r.deliveredAt,
    editedAt: r.editedAt,
    deletedAt: r.deletedAt,
    senderUsername: r.senderUsername,
    senderIsAdmin: r.senderIsAdmin,
    replyToId: r.replyToId,
    replyToContent: r.replyToDeletedAt ? null : r.replyToContent,
    replyToSenderUsername: r.replyToSenderUsername,
  };
}

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
        const group = loadGroupWithAccess(db, groupId, user);
        if (!group) return json({ error: "Groupe de chat non trouvé." }, 404);

        // Fetching this conversation's messages means this client has them —
        // deliver anything pending before reading, so the response already
        // reflects it.
        markMessagesDelivered(db, user.id, user.is_admin === 1);

        const rows = db
          .prepare(`
            SELECT m.id, m.group_id AS groupId, m.sender_id AS senderId, m.content, m.created_at AS createdAt,
                   m.read_at AS readAt, m.delivered_at AS deliveredAt, m.edited_at AS editedAt, m.deleted_at AS deletedAt,
                   u.username AS senderUsername, u.is_admin AS senderIsAdmin,
                   m.reply_to_id AS replyToId, p.content AS replyToContent, pu.username AS replyToSenderUsername,
                   p.deleted_at AS replyToDeletedAt
            FROM chat_messages m
            JOIN users u ON m.sender_id = u.id
            LEFT JOIN chat_messages p ON p.id = m.reply_to_id
            LEFT JOIN users pu ON pu.id = p.sender_id
            WHERE m.group_id = ?
            ORDER BY m.created_at ASC
            LIMIT 200
          `)
          .all(groupId) as MessageRow[];

        const messages = rows.map((r) => ({ ...serializeMessage(r), reactions: getReactions(db, r.id, user.id) }));

        return json({ messages });
      },

      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          groupId?: string;
          content?: string;
          replyToId?: string;
        };

        if (!body.groupId || !body.content || typeof body.content !== "string" || body.content.trim() === "") {
          return json({ error: "groupId et content requis." }, 400);
        }

        const db = getDb();
        const group = loadGroupWithAccess(db, body.groupId, user);
        if (!group) return json({ error: "Groupe de chat non trouvé." }, 404);

        // A reply target must exist, belong to the same group, and not be a
        // deleted tombstone — otherwise silently drop the reference.
        let replyToId: string | null = null;
        if (body.replyToId) {
          const parent = db
            .prepare("SELECT id FROM chat_messages WHERE id = ? AND group_id = ? AND deleted_at IS NULL")
            .get(body.replyToId, body.groupId) as { id: string } | undefined;
          if (parent) replyToId = parent.id;
        }

        const newId = randomUUID();
        const now = Math.floor(Date.now() / 1000);

        db.prepare(
          "INSERT INTO chat_messages (id, group_id, sender_id, content, created_at, reply_to_id) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(newId, body.groupId, user.id, body.content.trim(), now, replyToId);

        let replyToContent: string | null = null;
        let replyToSenderUsername: string | null = null;
        if (replyToId) {
          const parent = db
            .prepare(`
              SELECT m.content AS content, u.username AS senderUsername
              FROM chat_messages m JOIN users u ON u.id = m.sender_id
              WHERE m.id = ?
            `)
            .get(replyToId) as { content: string; senderUsername: string } | undefined;
          replyToContent = parent?.content ?? null;
          replyToSenderUsername = parent?.senderUsername ?? null;
        }

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
          deliveredAt: null,
          editedAt: null,
          deletedAt: null,
          senderUsername: user.username,
          senderIsAdmin: user.is_admin,
          replyToId,
          replyToContent,
          replyToSenderUsername,
          reactions: [],
        });
      },

      PATCH: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          groupId?: string;
          messageId?: string;
          content?: string;
        };

        if (!body.groupId || !body.messageId || !body.content || body.content.trim() === "") {
          return json({ error: "groupId, messageId et content requis." }, 400);
        }

        const db = getDb();
        const group = loadGroupWithAccess(db, body.groupId, user);
        if (!group) return json({ error: "Groupe de chat non trouvé." }, 404);

        const message = db
          .prepare("SELECT sender_id AS senderId, content, deleted_at AS deletedAt FROM chat_messages WHERE id = ? AND group_id = ?")
          .get(body.messageId, body.groupId) as { senderId: number; content: string; deletedAt: number | null } | undefined;

        if (!message) return json({ error: "Message non trouvé." }, 404);
        if (message.senderId !== user.id) return json({ error: "Vous ne pouvez modifier que vos propres messages." }, 403);
        if (message.deletedAt) return json({ error: "Ce message a été supprimé." }, 400);
        if (message.content.startsWith("data:image/")) return json({ error: "Impossible de modifier une image." }, 400);

        const now = Math.floor(Date.now() / 1000);
        db.prepare("UPDATE chat_messages SET content = ?, edited_at = ? WHERE id = ?").run(body.content.trim(), now, body.messageId);

        return json({ success: true, content: body.content.trim(), editedAt: now });
      },

      DELETE: async ({ request }) => {
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
        const group = loadGroupWithAccess(db, body.groupId, user);
        if (!group) return json({ error: "Groupe de chat non trouvé." }, 404);

        const message = db
          .prepare("SELECT sender_id AS senderId, deleted_at AS deletedAt FROM chat_messages WHERE id = ? AND group_id = ?")
          .get(body.messageId, body.groupId) as { senderId: number; deletedAt: number | null } | undefined;

        if (!message) return json({ error: "Message non trouvé." }, 404);
        if (message.senderId !== user.id) return json({ error: "Vous ne pouvez supprimer que vos propres messages." }, 403);
        if (message.deletedAt) return json({ success: true, deletedAt: message.deletedAt });

        const now = Math.floor(Date.now() / 1000);
        // Wipe the content server-side (privacy) rather than merely flagging
        // it — the tombstone marker is rendered client-side off deletedAt.
        db.prepare("UPDATE chat_messages SET content = '', deleted_at = ? WHERE id = ?").run(now, body.messageId);

        return json({ success: true, deletedAt: now });
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

        // Same "identical not-found for nonexistent vs inaccessible" rule as
        // loadGroupWithAccess() above — a non-admin must not be able to tell
        // a real message in a group they're not in apart from a bogus id.
        const group = loadGroupWithAccess(db, body.groupId, user);
        if (!group) return json({ error: "Message non trouvé." }, 404);

        const message = db
          .prepare("SELECT sender_id FROM chat_messages WHERE id = ? AND group_id = ?")
          .get(body.messageId, body.groupId) as { sender_id: number } | undefined;

        if (!message) return json({ error: "Message non trouvé." }, 404);

        // Only the recipient can mark messages as read
        if (message.sender_id === user.id) {
          return json({ error: "Vous ne pouvez pas marquer vos propres messages comme lus." }, 400);
        }

        const now = Math.floor(Date.now() / 1000);
        db.prepare("UPDATE chat_messages SET read_at = ?, delivered_at = COALESCE(delivered_at, ?) WHERE id = ?").run(now, now, body.messageId);

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
