import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { hashPassword, createToken, generateAuthToken } from "@/lib/auth.server";
import { sendEmail, verificationEmail, getAppUrl } from "@/lib/email.server";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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

        if (!email || !username || !password) {
          return json({ error: "Email, nom d'utilisateur et mot de passe requis." }, 400);
        }

        const normalizedEmail = email.toLowerCase();
        const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
        const isAdmin = !!adminEmail && normalizedEmail === adminEmail;

        // Invite-only gate: enforced when INVITE_CODE is configured. The admin email bypasses it.
        const requiredInvite = process.env.INVITE_CODE;
        if (!isAdmin && requiredInvite && inviteCode !== requiredInvite) {
          return json({ error: "Code d'invitation invalide." }, 403);
        }

        if (password.length < 6) {
          return json({ error: "Le mot de passe doit faire au moins 6 caractères." }, 400);
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
          return json({ error: "Email invalide." }, 400);
        }

        const db = getDb();
        const existing = db
          .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
          .get(normalizedEmail, username);

        if (existing) {
          return json({ error: "Cet email ou nom d'utilisateur est déjà utilisé." }, 409);
        }

        const passwordHash = await hashPassword(password);
        // Admin is auto-verified + approved; everyone else must verify their email
        // and then be approved by an admin before they can log in.
        const result = db
          .prepare(
            "INSERT INTO users (email, username, password_hash, email_verified, status, is_admin) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(
            normalizedEmail,
            username,
            passwordHash,
            isAdmin ? 1 : 0,
            isAdmin ? "approved" : "pending",
            isAdmin ? 1 : 0,
          );

        const userId = result.lastInsertRowid as number;
        db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").run(userId);

        // Admin account: log in immediately.
        if (isAdmin) {
          const token = await createToken(userId, normalizedEmail);
          return json({
            token,
            user: { id: userId, email: normalizedEmail, username, is_admin: 1 },
          });
        }

        // Regular account: issue a verification token and email the link.
        const verifyToken = generateAuthToken();
        db.prepare(
          "INSERT INTO auth_tokens (user_id, type, token, expires_at) VALUES (?, 'verify', ?, ?)",
        ).run(userId, verifyToken, Date.now() + VERIFY_TTL_MS);

        const link = `${getAppUrl()}/verify-email?token=${verifyToken}`;
        const { subject, html } = verificationEmail(link);
        try {
          await sendEmail({ to: normalizedEmail, subject, html });
        } catch {
          // Don't fail registration if the email provider hiccups; user can resend.
        }

        return json({
          requiresVerification: true,
          message:
            "Compte créé ! Vérifie ta boîte mail pour activer ton compte, puis attends l'approbation d'un administrateur.",
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
