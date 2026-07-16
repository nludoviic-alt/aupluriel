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

        // Verify user has access to this group
        const group = db
          .prepare("SELECT is_direct, recipient_id FROM chat_groups WHERE id = ?")
          .get(groupId) as { is_direct: number; recipient_id: number | null } | undefined;

        if (!group) return json({ error: "Groupe de chat non trouvé." }, 404);

        // Security check: if group is direct, only admin or the recipient user can access
        if (group.is_direct === 1 && user.is_admin === 0 && group.recipient_id !== user.id) {
          return json({ error: "Accès refusé." }, 403);
        }

        const rows = db
          .prepare(`
            SELECT m.id, m.group_id AS groupId, m.sender_id AS senderId, m.content, m.created_at AS createdAt,
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

        // Verify group exists and check access
        const group = db
          .prepare("SELECT is_direct, recipient_id FROM chat_groups WHERE id = ?")
          .get(body.groupId) as { is_direct: number; recipient_id: number | null } | undefined;

        if (!group) return json({ error: "Groupe de chat non trouvé." }, 404);

        // Security check: if group is direct, only admin or the recipient user can post
        if (group.is_direct === 1 && user.is_admin === 0 && group.recipient_id !== user.id) {
          return json({ error: "Accès refusé." }, 403);
        }

        const newId = randomUUID();
        const now = Math.floor(Date.now() / 1000);

        db.prepare(
          "INSERT INTO chat_messages (id, group_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)"
        ).run(newId, body.groupId, user.id, body.content.trim(), now);

        return json({
          id: newId,
          groupId: body.groupId,
          senderId: user.id,
          content: body.content.trim(),
          createdAt: now,
          senderUsername: user.username,
          senderIsAdmin: user.is_admin,
        });
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
