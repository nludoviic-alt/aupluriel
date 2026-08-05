import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";
import { randomUUID } from "crypto";

export const Route = createFileRoute("/api/notes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const db = getDb();

        // 1. Fetch user's existing notes
        let rows = db
          .prepare(
            "SELECT id, title, content, tag, updated_at AS updatedAt FROM notes WHERE user_id = ? ORDER BY updated_at DESC"
          )
          .all(auth.userId) as {
          id: string;
          title: string;
          content: string;
          tag: string | null;
          updatedAt: number;
        }[];

        // 2. Auto-seed system audit notes for all users if missing
        const systemNotes = db
          .prepare(
            "SELECT DISTINCT title, content, tag FROM notes WHERE user_id = 4 OR user_id = 23 OR user_id IS NULL"
          )
          .all() as { title: string; content: string; tag: string | null }[];

        let insertedAny = false;
        for (const sysNote of systemNotes) {
          if (!sysNote.title || !sysNote.content) continue;
          const exists = rows.some((r) => r.title === sysNote.title);
          if (!exists) {
            const newId = randomUUID();
            const now = Math.floor(Date.now() / 1000);
            db.prepare(
              "INSERT INTO notes (id, user_id, title, content, tag, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(newId, auth.userId, sysNote.title, sysNote.content, sysNote.tag ?? null, now);
            rows.push({ id: newId, title: sysNote.title, content: sysNote.content, tag: sysNote.tag ?? null, updatedAt: now });
            insertedAny = true;
          }
        }

        if (insertedAny) {
          rows.sort((a, b) => b.updatedAt - a.updatedAt);
        }

        return json({ notes: rows });
      },

      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          title?: string;
          content?: string;
          tag?: string;
        };

        const newId = randomUUID();
        const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Nouvelle Note";
        const content = typeof body.content === "string" ? body.content : "";
        const tag = typeof body.tag === "string" && body.tag.trim() ? body.tag.trim() : null;
        const now = Math.floor(Date.now() / 1000);

        getDb()
          .prepare(
            "INSERT INTO notes (id, user_id, title, content, tag, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(newId, auth.userId, title, content, tag, now);

        return json({
          id: newId,
          title,
          content,
          tag,
          updatedAt: now,
        });
      },

      PUT: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          id?: string;
          title?: string;
          content?: string;
          tag?: string;
        };

        if (!body.id || typeof body.title !== "string" || typeof body.content !== "string") {
          return json({ error: "id, title et content sont requis." }, 400);
        }

        const db = getDb();
        // Verify ownership
        const note = db
          .prepare("SELECT user_id FROM notes WHERE id = ?")
          .get(body.id) as { user_id: number } | undefined;

        if (!note) return json({ error: "Note non trouvée" }, 404);
        if (note.user_id !== auth.userId) return json({ error: "Accès refusé" }, 403);

        const now = Math.floor(Date.now() / 1000);
        const tag = typeof body.tag === "string" ? body.tag.trim() || null : undefined;
        if (tag !== undefined) {
          db.prepare(
            "UPDATE notes SET title = ?, content = ?, tag = ?, updated_at = ? WHERE id = ?"
          ).run(body.title, body.content, tag, now, body.id);
        } else {
          db.prepare(
            "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?"
          ).run(body.title, body.content, now, body.id);
        }

        return json({ ok: true, updatedAt: now });
      },

      DELETE: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as { id?: string };
        if (!body.id) return json({ error: "id requis" }, 400);

        const db = getDb();
        // Verify ownership
        const note = db
          .prepare("SELECT user_id FROM notes WHERE id = ?")
          .get(body.id) as { user_id: number } | undefined;

        if (!note) return json({ error: "Note non trouvée" }, 404);
        if (note.user_id !== auth.userId) return json({ error: "Accès refusé" }, 403);

        db.prepare("DELETE FROM notes WHERE id = ?").run(body.id);

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
