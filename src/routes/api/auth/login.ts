import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { verifyPassword, createToken } from "@/lib/auth.server";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { email, password } = (await request.json()) as {
          email?: string;
          password?: string;
        };

        if (!email || !password) {
          return json({ error: "Email et mot de passe requis." }, 400);
        }

        const db = getDb();
        const user = db
          .prepare("SELECT id, email, username, password_hash FROM users WHERE email = ?")
          .get(email.toLowerCase()) as
          | { id: number; email: string; username: string; password_hash: string }
          | undefined;

        if (!user) {
          return json({ error: "Email ou mot de passe incorrect." }, 401);
        }

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
          return json({ error: "Email ou mot de passe incorrect." }, 401);
        }

        const token = await createToken(user.id, user.email);
        return json({
          token,
          user: { id: user.id, email: user.email, username: user.username },
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
