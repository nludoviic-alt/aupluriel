import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";

export const Route = createFileRoute("/api/chat/groups/members")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) {
          return json({ error: "Accès réservé aux administrateurs." }, 403);
        }

        const url = new URL(request.url);
        const groupId = url.searchParams.get("groupId");
        if (!groupId) return json({ error: "groupId requis" }, 400);

        const rows = getDb()
          .prepare("SELECT user_id AS userId FROM chat_group_members WHERE group_id = ?")
          .all(groupId) as { userId: number }[];

        return json({ userIds: rows.map((r) => r.userId) });
      },

      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) {
          return json({ error: "Accès réservé aux administrateurs." }, 403);
        }

        const body = (await request.json().catch(() => ({}))) as {
          groupId?: string;
          userIds?: number[];
        };

        if (!body.groupId || !Array.isArray(body.userIds)) {
          return json({ error: "groupId et userIds requis." }, 400);
        }

        const db = getDb();

        // Verify group exists
        const group = db.prepare("SELECT id, created_by FROM chat_groups WHERE id = ?").get(body.groupId) as
          | { id: string; created_by: number | null }
          | undefined;

        if (!group) return json({ error: "Groupe de chat non trouvé." }, 404);

        // Update members inside a transaction
        const updateAll = db.transaction((groupId: string, ids: number[]) => {
          // Delete existing members
          db.prepare("DELETE FROM chat_group_members WHERE group_id = ?").run(groupId);

          // Add creator admin if not in array
          const creatorId = group.created_by ?? admin.id;
          const finalIds = Array.from(new Set([creatorId, ...ids]));

          const insert = db.prepare("INSERT INTO chat_group_members (group_id, user_id) VALUES (?, ?)");
          for (const id of finalIds) {
            insert.run(groupId, id);
          }
        });

        updateAll(body.groupId, body.userIds);

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
