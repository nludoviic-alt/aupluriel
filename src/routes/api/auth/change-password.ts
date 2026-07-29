import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest, hashPassword, verifyPassword } from "@/lib/auth.server";

export const Route = createFileRoute("/api/auth/change-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const { currentPassword, newPassword } = (await request.json()) as {
          currentPassword?: string;
          newPassword?: string;
        };
        if (!currentPassword || !newPassword) {
          return json({ error: "Mot de passe actuel et nouveau mot de passe requis." }, 400);
        }
        if (newPassword.length < 6) {
          return json({ error: "Le nouveau mot de passe doit faire au moins 6 caractères." }, 400);
        }

        const db = getDb();
        const user = db
          .prepare("SELECT id, password_hash FROM users WHERE id = ?")
          .get(auth.userId) as { id: number; password_hash: string } | undefined;
        if (!user) return json({ error: "Utilisateur introuvable." }, 404);

        const valid = await verifyPassword(currentPassword, user.password_hash);
        if (!valid) return json({ error: "Mot de passe actuel incorrect." }, 401);

        const passwordHash = await hashPassword(newPassword);
        db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);

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
