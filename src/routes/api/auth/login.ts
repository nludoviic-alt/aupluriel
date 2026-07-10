import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { verifyPassword, createToken } from "@/lib/auth.server";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/rate-limit.server";

// Brute-force guard: 10 attempts/15min/IP is generous for a mistyped
// password but stops a credential-stuffing script cold.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60_000;

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = getClientIp(request);
        const limit = checkRateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
        if (!limit.allowed) return rateLimitResponse(limit.retryAfterMs);

        const { email, password } = (await request.json()) as {
          email?: string;
          password?: string;
        };

        if (!email || !password) {
          return json({ error: "Email et mot de passe requis." }, 400);
        }

        const db = getDb();
        const user = db
          .prepare(
            "SELECT id, email, username, password_hash, email_verified, status, is_admin FROM users WHERE email = ?",
          )
          .get(email.toLowerCase()) as
          | {
              id: number;
              email: string;
              username: string;
              password_hash: string;
              email_verified: number;
              status: string;
              is_admin: number;
            }
          | undefined;

        if (!user) {
          return json({ error: "Email ou mot de passe incorrect." }, 401);
        }

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
          return json({ error: "Email ou mot de passe incorrect." }, 401);
        }

        // Gating (admins bypass): email must be verified and account approved.
        if (!user.is_admin) {
          if (!user.email_verified) {
            return json(
              {
                error: "Ton adresse email n'est pas encore vérifiée. Consulte ta boîte mail.",
                code: "unverified",
              },
              403,
            );
          }
          if (user.status === "pending") {
            return json(
              {
                error: "Ton compte est en attente d'approbation par un administrateur.",
                code: "pending",
              },
              403,
            );
          }
          if (user.status === "rejected") {
            return json(
              { error: "Ton compte a été refusé. Contacte un administrateur.", code: "rejected" },
              403,
            );
          }
          if (user.status === "suspended") {
            return json(
              { error: "Ton accès a été révoqué. Contacte un administrateur.", code: "suspended" },
              403,
            );
          }
        }

        const token = await createToken(user.id, user.email);
        return json({
          token,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            is_admin: user.is_admin,
          },
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
