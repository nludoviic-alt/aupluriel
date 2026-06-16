import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { hashPassword, createToken } from "@/lib/auth.server";

export const Route = createFileRoute("/api/auth/register")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { email, username, password, inviteCode } = (await request.json()) as {
          email?: string;
          username?: string;
          password?: string;
          inviteCode?: string;
        };

        // Invite-only gate: enforced only when INVITE_CODE is configured.
        const requiredInvite = process.env.INVITE_CODE;
        if (requiredInvite && inviteCode !== requiredInvite) {
          return json({ error: "Code d'invitation invalide." }, 403);
        }

        if (!email || !username || !password) {
          return json({ error: "Email, nom d'utilisateur et mot de passe requis." }, 400);
        }
        if (password.length < 6) {
          return json({ error: "Le mot de passe doit faire au moins 6 caractères." }, 400);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json({ error: "Email invalide." }, 400);
        }

        const db = getDb();
        const existing = db
          .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
          .get(email.toLowerCase(), username);

        if (existing) {
          return json({ error: "Cet email ou nom d'utilisateur est déjà utilisé." }, 409);
        }

        const passwordHash = await hashPassword(password);
        const result = db
          .prepare("INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)")
          .run(email.toLowerCase(), username, passwordHash);

        const userId = result.lastInsertRowid as number;
        db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").run(userId);

        const token = await createToken(userId, email.toLowerCase());
        return json({ token, user: { id: userId, email: email.toLowerCase(), username } });
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
