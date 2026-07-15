// Personal notes — one free-text blob per user, server-side so it survives
// switching devices (unlike the old localStorage-only presets).
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

export const Route = createFileRoute("/api/notes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const row = getDb()
          .prepare("SELECT content, updated_at AS updatedAt FROM user_notes WHERE user_id = ?")
          .get(auth.userId) as { content: string; updatedAt: number } | undefined;

        return json({ content: row?.content ?? "", updatedAt: row?.updatedAt ?? null });
      },

      PUT: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as { content?: string };
        if (typeof body.content !== "string") return json({ error: "content requis." }, 400);

        getDb().prepare(`
          INSERT INTO user_notes (user_id, content, updated_at) VALUES (?, ?, unixepoch())
          ON CONFLICT(user_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
        `).run(auth.userId, body.content);

        return json({ ok: true, updatedAt: Math.floor(Date.now() / 1000) });
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
