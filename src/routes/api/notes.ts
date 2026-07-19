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

        const rows = getDb()
          .prepare(
            "SELECT id, title, content, updated_at AS updatedAt FROM notes WHERE user_id = ? ORDER BY updated_at DESC"
          )
          .all(auth.userId) as {
          id: string;
          title: string;
          content: string;
          updatedAt: number;
        }[];

        return json({ notes: rows });
      },

      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const newId = randomUUID();
        const title = "Nouvelle Note";
        const content = "";
        const now = Math.floor(Date.now() / 1000);

        getDb()
          .prepare(
            "INSERT INTO notes (id, user_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run(newId, auth.userId, title, content, now);

        return json({
          id: newId,
          title,
          content,
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
        db.prepare(
          "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ?"
        ).run(body.title, body.content, now, body.id);

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
