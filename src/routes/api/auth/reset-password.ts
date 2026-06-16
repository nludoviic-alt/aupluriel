import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { hashPassword } from "@/lib/auth.server";

export const Route = createFileRoute("/api/auth/reset-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { token, password } = (await request.json()) as {
          token?: string;
          password?: string;
        };
        if (!token || !password) return json({ error: "Token et mot de passe requis." }, 400);
        if (password.length < 6) {
          return json({ error: "Le mot de passe doit faire au moins 6 caractères." }, 400);
        }

        const db = getDb();
        const row = db
          .prepare(
            "SELECT id, user_id, expires_at, used FROM auth_tokens WHERE token = ? AND type = 'reset'",
          )
          .get(token) as
          | { id: number; user_id: number; expires_at: number; used: number }
          | undefined;

        if (!row || row.used || row.expires_at < Date.now()) {
          return json({ error: "Lien de réinitialisation invalide ou expiré." }, 400);
        }

        const passwordHash = await hashPassword(password);
        const tx = db.transaction(() => {
          db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
            passwordHash,
            row.user_id,
          );
          db.prepare("UPDATE auth_tokens SET used = 1 WHERE id = ?").run(row.id);
          // Invalidate any other outstanding reset tokens for this user.
          db.prepare(
            "UPDATE auth_tokens SET used = 1 WHERE user_id = ? AND type = 'reset' AND used = 0",
          ).run(row.user_id);
        });
        tx();

        return json({ message: "Mot de passe réinitialisé. Tu peux maintenant te connecter." });
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
