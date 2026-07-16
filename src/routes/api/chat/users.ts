import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/chat/users")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) {
          return json({ error: "Accès réservé aux administrateurs." }, 403);
        }

        const db = getDb();

        // Retrieve users with messaging activated for them (except the current admin) —
        // a user not yet enabled by the admin shouldn't appear as a chattable contact.
        const users = db
          .prepare(`
            SELECT u.id, u.username, u.email, g.id AS groupId
            FROM users u
            LEFT JOIN chat_groups g ON g.is_direct = 1 AND g.recipient_id = u.id
            WHERE u.id != ? AND u.chat_enabled = 1
            ORDER BY u.username ASC
          `)
          .all(admin.id) as {
          id: number;
          username: string;
          email: string;
          groupId: string | null;
        }[];

        // Guarantee that a direct chat group exists for each approved user
        for (const u of users) {
          if (!u.groupId) {
            const newGroupId = randomUUID();
            db.prepare(
              "INSERT INTO chat_groups (id, name, is_direct, recipient_id, created_at) VALUES (?, 'Chat avec l''Admin', 1, ?, unixepoch())"
            ).run(newGroupId, u.id);
            u.groupId = newGroupId;
          }
        }

        return json({ users });
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
