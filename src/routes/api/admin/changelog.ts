// Admin bug/changelog tracker — durable record of what was found, fixed, and
// improved, plus items currently open or under watch. Lets the admin console
// answer "didn't we already deal with this?" instead of re-litigating it.
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";

type EntryType = "fix" | "improvement" | "watch";
type EntryStatus = "open" | "monitoring" | "resolved";

const TYPES: EntryType[] = ["fix", "improvement", "watch"];
const STATUSES: EntryStatus[] = ["open", "monitoring", "resolved"];

export const Route = createFileRoute("/api/admin/changelog")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const entries = getDb()
          .prepare(
            `SELECT ce.id, ce.type, ce.title, ce.description, ce.status,
                    ce.created_at AS createdAt, u.username AS createdBy
             FROM changelog_entries ce
             LEFT JOIN users u ON u.id = ce.created_by
             ORDER BY ce.created_at DESC`,
          )
          .all();

        return json({ entries });
      },

      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          type?: string;
          title?: string;
          description?: string;
          status?: string;
        };
        const type = body.type as EntryType;
        const status = (body.status as EntryStatus) ?? "open";
        const title = body.title?.trim();

        if (!title) return json({ error: "Titre requis." }, 400);
        if (!TYPES.includes(type)) return json({ error: "type doit être fix|improvement|watch." }, 400);
        if (!STATUSES.includes(status)) return json({ error: "status doit être open|monitoring|resolved." }, 400);

        const result = getDb()
          .prepare(
            "INSERT INTO changelog_entries (type, title, description, status, created_by) VALUES (?, ?, ?, ?, ?)",
          )
          .run(type, title, body.description?.trim() ?? "", status, admin.id);

        return json({ ok: true, id: result.lastInsertRowid });
      },

      PATCH: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as { id?: number; status?: string };
        if (!body.id) return json({ error: "id requis." }, 400);
        const status = body.status as EntryStatus;
        if (!STATUSES.includes(status)) return json({ error: "status doit être open|monitoring|resolved." }, 400);

        getDb().prepare("UPDATE changelog_entries SET status = ? WHERE id = ?").run(status, body.id);
        return json({ ok: true });
      },

      DELETE: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as { id?: number };
        if (!body.id) return json({ error: "id requis." }, 400);

        getDb().prepare("DELETE FROM changelog_entries WHERE id = ?").run(body.id);
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
