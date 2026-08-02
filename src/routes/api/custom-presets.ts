import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/custom-presets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);
        const rows = getDb()
          .prepare("SELECT data FROM custom_presets WHERE user_id = ? ORDER BY created_at DESC LIMIT 10")
          .all(auth.userId) as { data: string }[];
        return json(rows.flatMap((row) => {
          try { return [JSON.parse(row.data)]; } catch { return []; }
        }));
      },
      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);
        const preset = await request.json() as { id?: string; name?: string; createdAt?: number };
        if (!preset.id || !preset.name) return json({ error: "Preset incomplet" }, 400);
        getDb().prepare(`
          INSERT OR REPLACE INTO custom_presets (id, user_id, data, created_at)
          VALUES (?, ?, ?, ?)
        `).run(preset.id, auth.userId, JSON.stringify(preset), Math.floor((preset.createdAt ?? Date.now()) / 1000));
        return json({ ok: true });
      },
      DELETE: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);
        const id = new URL(request.url).searchParams.get("id");
        if (!id) return json({ error: "id requis" }, 400);
        getDb().prepare("DELETE FROM custom_presets WHERE id = ? AND user_id = ?").run(id, auth.userId);
        return json({ ok: true });
      },
    },
  },
});
