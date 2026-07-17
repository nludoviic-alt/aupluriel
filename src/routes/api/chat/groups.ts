import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getFullUserFromRequest, requireAdmin } from "@/lib/auth.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/chat/groups")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const db = getDb();

        if (user.is_admin === 1) {
          // Admin sees all public groups + all direct message chats with other approved users
          const rows = db
            .prepare(`
              SELECT g.id, 
                     CASE WHEN g.is_direct = 1 THEN u.username ELSE g.name END AS name,
                     g.is_direct AS isDirect,
                     g.recipient_id AS recipientId,
                     g.created_by AS createdBy,
                     g.created_at AS createdAt
              FROM chat_groups g
              LEFT JOIN users u ON g.recipient_id = u.id
              WHERE g.is_direct = 0 OR (g.is_direct = 1 AND u.id IS NOT NULL)
              ORDER BY g.is_direct ASC, name ASC
            `)
            .all() as {
            id: string;
            name: string;
            isDirect: number;
            recipientId: number | null;
            createdBy: number | null;
            createdAt: number;
          }[];

          return json({ groups: rows });
        } else {
          // Regular user sees their DM conversation with Admin,
          // plus public groups where they have been added as a member.
          // Ensure DM exists first
          const userDm = db
            .prepare("SELECT id FROM chat_groups WHERE is_direct = 1 AND recipient_id = ?")
            .get(user.id);

          if (!userDm) {
            db.prepare(
              "INSERT INTO chat_groups (id, name, is_direct, recipient_id, created_at) VALUES (?, 'Chat avec l''Admin', 1, ?, unixepoch())"
            ).run(randomUUID(), user.id);
          }

          const rows = db
            .prepare(`
              SELECT id, name, is_direct AS isDirect, recipient_id AS recipientId, created_by AS createdBy, created_at AS createdAt
              FROM chat_groups
              WHERE is_direct = 1 AND recipient_id = ?
              
              UNION
              
              SELECT g.id, g.name, g.is_direct AS isDirect, g.recipient_id AS recipientId, g.created_by AS createdBy, g.created_at AS createdAt
              FROM chat_groups g
              JOIN chat_group_members m ON g.id = m.group_id
              WHERE g.is_direct = 0 AND m.user_id = ?
              
              ORDER BY isDirect ASC, createdAt ASC
            `)
            .all(user.id, user.id) as {
            id: string;
            name: string;
            isDirect: number;
            recipientId: number | null;
            createdBy: number | null;
            createdAt: number;
          }[];

          return json({ groups: rows });
        }
      },

      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) {
          return json({ error: "Seul l'administrateur peut créer un groupe." }, 403);
        }

        const body = (await request.json().catch(() => ({}))) as {
          name?: string;
          userIds?: number[];
        };

        if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
          return json({ error: "Le nom du groupe est requis." }, 400);
        }

        const newId = randomUUID();
        const now = Math.floor(Date.now() / 1000);
        const db = getDb();

        db.prepare(
          "INSERT INTO chat_groups (id, name, created_by, created_at, is_direct, recipient_id) VALUES (?, ?, ?, ?, 0, NULL)"
        ).run(newId, body.name.trim(), admin.id, now);

        // Add creator admin to the group members
        const insertMember = db.prepare(
          "INSERT OR IGNORE INTO chat_group_members (group_id, user_id) VALUES (?, ?)"
        );
        insertMember.run(newId, admin.id);

        // Add selected userIds to members list
        if (Array.isArray(body.userIds)) {
          const insertMany = db.transaction((ids: number[]) => {
            for (const id of ids) {
              insertMember.run(newId, id);
            }
          });
          insertMany(body.userIds);
        }

        return json({
          id: newId,
          name: body.name.trim(),
          isDirect: 0,
          recipientId: null,
          createdBy: admin.id,
          createdAt: now,
        });
      },

      DELETE: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        let groupId = url.searchParams.get("groupId");

        if (!groupId) {
          const body = (await request.json().catch(() => ({}))) as { groupId?: string };
          groupId = body.groupId ?? null;
        }

        if (!groupId) {
          return json({ error: "L'identifiant du groupe (groupId) est requis." }, 400);
        }

        const db = getDb();

        if (user.is_admin === 0) {
          // Non-admins can only fully delete their own direct conversation with the admin,
          // never a shared group salon — that stays admin-only to avoid one member
          // destroying it for everyone else without consent. A nonexistent group and an
          // inaccessible one get the identical response — no existence oracle either way.
          const group = db
            .prepare("SELECT is_direct, recipient_id FROM chat_groups WHERE id = ?")
            .get(groupId) as { is_direct: number; recipient_id: number | null } | undefined;

          if (!group || group.is_direct !== 1 || group.recipient_id !== user.id) {
            return json({ error: "Groupe ou discussion introuvable." }, 404);
          }
        }

        const result = db.prepare("DELETE FROM chat_groups WHERE id = ?").run(groupId);

        if (result.changes === 0) {
          return json({ error: "Groupe ou discussion introuvable." }, 404);
        }

        return json({ success: true, groupId });
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
