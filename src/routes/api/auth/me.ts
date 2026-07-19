import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const db = getDb();
         const user = db
          .prepare(
            "SELECT id, email, username, avatar, online_status, email_verified, status, is_admin, chat_enabled, created_at FROM users WHERE id = ?",
          )
          .get(auth.userId) as
          | {
              id: number;
              email: string;
              username: string;
              avatar: string | null;
              online_status: "online" | "offline";
              email_verified: number;
              status: string;
              is_admin: number;
              chat_enabled: number;
              created_at: number;
            }
          | undefined;

        if (!user) return json({ error: "Utilisateur introuvable" }, 404);

        const settings = db
          .prepare("SELECT * FROM user_settings WHERE user_id = ?")
          .get(auth.userId) as Record<string, unknown> | undefined;

        return json({ user, settings: settings ?? {} });
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
