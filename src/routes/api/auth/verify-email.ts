import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";

export const Route = createFileRoute("/api/auth/verify-email")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { token } = (await request.json()) as { token?: string };
        if (!token) return json({ error: "Token manquant." }, 400);

        const db = getDb();
        const row = db
          .prepare(
            "SELECT id, user_id, expires_at, used FROM auth_tokens WHERE token = ? AND type = 'verify'",
          )
          .get(token) as
          | { id: number; user_id: number; expires_at: number; used: number }
          | undefined;

        if (!row || row.used || row.expires_at < Date.now()) {
          return json({ error: "Lien de vérification invalide ou expiré." }, 400);
        }

        const tx = db.transaction(() => {
          db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(row.user_id);
          db.prepare("UPDATE auth_tokens SET used = 1 WHERE id = ?").run(row.id);
        });
        tx();

        return json({
          message:
            "Email vérifié ! Ton compte doit maintenant être approuvé par un administrateur avant de pouvoir te connecter.",
        });
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
