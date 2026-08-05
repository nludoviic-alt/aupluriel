import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

export interface NotificationItem {
  id: number;
  userId: number;
  title: string;
  body: string;
  url: string | null;
  category: "trade" | "risk" | "system" | "signal";
  isRead: boolean;
  createdAt: number;
}

export const Route = createFileRoute("/api/notifications")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const db = getDb();
        const rows = db.prepare(`
          SELECT id, user_id as userId, title, body, url, category, is_read as isRead, created_at as createdAt
          FROM user_notifications
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 100
        `).all(auth.userId) as NotificationItem[];

        const unreadCount = (db.prepare(`
          SELECT COUNT(*) as count FROM user_notifications
          WHERE user_id = ? AND is_read = 0
        `).get(auth.userId) as { count: number }).count;

        return json({
          notifications: rows.map((r) => ({ ...r, isRead: Boolean(r.isRead) })),
          unreadCount,
        });
      },

      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          action?: "mark_read" | "mark_all_read" | "delete" | "clear_all" | "record";
          id?: number;
          title?: string;
          message?: string;
          url?: string;
          category?: "trade" | "risk" | "system" | "signal";
        };

        const db = getDb();

        if (body.action === "mark_read" && body.id) {
          db.prepare("UPDATE user_notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(body.id, auth.userId);
          return json({ ok: true });
        }

        if (body.action === "mark_all_read") {
          db.prepare("UPDATE user_notifications SET is_read = 1 WHERE user_id = ?").run(auth.userId);
          return json({ ok: true });
        }

        if (body.action === "delete" && body.id) {
          db.prepare("DELETE FROM user_notifications WHERE id = ? AND user_id = ?").run(body.id, auth.userId);
          return json({ ok: true });
        }

        if (body.action === "clear_all") {
          db.prepare("DELETE FROM user_notifications WHERE user_id = ?").run(auth.userId);
          return json({ ok: true });
        }

        if (body.action === "record" && body.title && body.message) {
          db.prepare(`
            INSERT INTO user_notifications (user_id, title, body, url, category, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, 0, unixepoch())
          `).run(auth.userId, body.title, body.message, body.url ?? null, body.category ?? "system");
          return json({ ok: true });
        }

        return json({ error: "Action non valide" }, 400);
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
