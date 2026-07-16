import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin, generateAuthToken, hashPassword } from "@/lib/auth.server";
import { sendEmail, resetEmail, welcomeEmail, getAppUrl } from "@/lib/email.server";

const RESET_TTL_MS = 60 * 60 * 1000; // 1h

export const Route = createFileRoute("/api/admin/users")({
  server: {
    handlers: {
      // List all accounts (admin only).
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const db = getDb();
        const users = db
          .prepare(
            "SELECT id, email, username, email_verified, status, is_admin, chat_enabled, created_at FROM users ORDER BY created_at DESC",
          )
          .all();
        return json({ users });
      },

      // Create / approve / reject / delete an account (admin only).
      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json()) as {
          userId?: number;
          action?: "create" | "approve" | "reject" | "revoke" | "delete" | "reset-password" | "toggle-chat" | "edit-username";
          email?: string;
          username?: string;
          password?: string;
          isAdmin?: boolean;
          chatEnabled?: boolean;
        };
        const { action } = body;
        if (!action) return json({ error: "action requise." }, 400);

        const db = getDb();

        if (action === "create") {
          const { email, username, password, isAdmin } = body;
          if (!email || !username || !password) {
            return json({ error: "Email, nom d'utilisateur et mot de passe requis." }, 400);
          }
          if (password.length < 6) {
            return json({ error: "Le mot de passe doit faire au moins 6 caractères." }, 400);
          }
          const normalizedEmail = email.toLowerCase();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return json({ error: "Email invalide." }, 400);
          }

          const existing = db
            .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
            .get(normalizedEmail, username);
          if (existing) {
            return json({ error: "Cet email ou nom d'utilisateur est déjà utilisé." }, 409);
          }

          const passwordHash = await hashPassword(password);
          // Admin-created accounts are pre-verified and pre-approved — no email/admin gate needed.
          const result = db
            .prepare(
              "INSERT INTO users (email, username, password_hash, email_verified, status, is_admin) VALUES (?, ?, ?, 1, 'approved', ?)",
            )
            .run(normalizedEmail, username, passwordHash, isAdmin ? 1 : 0);

          const newUserId = result.lastInsertRowid as number;
          db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").run(newUserId);

          const { subject, html } = welcomeEmail(username, normalizedEmail, password);
          try {
            await sendEmail({ to: normalizedEmail, subject, html });
          } catch {
            // Don't fail account creation if the email provider hiccups.
          }

          return json({
            ok: true,
            user: { id: newUserId, email: normalizedEmail, username, is_admin: isAdmin ? 1 : 0 },
          });
        }

        const { userId } = body;
        if (!userId) return json({ error: "userId requis." }, 400);

        if (userId === admin.id) {
          return json({ error: "Tu ne peux pas modifier ton propre compte admin." }, 400);
        }

        const target = db.prepare("SELECT id, is_admin FROM users WHERE id = ?").get(userId) as
          | { id: number; is_admin: number }
          | undefined;
        if (!target) return json({ error: "Utilisateur introuvable." }, 404);
        if (target.is_admin) {
          return json({ error: "Impossible de modifier un autre administrateur." }, 400);
        }

        switch (action) {
          case "approve":
            // Approving also clears the email-verification gate.
            db.prepare(
              "UPDATE users SET status = 'approved', email_verified = 1 WHERE id = ?",
            ).run(userId);
            break;
          case "reject":
            db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(userId);
            break;
          case "revoke":
            db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(userId);
            break;
          case "delete":
            // user_settings / auth_tokens cascade via ON DELETE CASCADE.
            db.prepare("DELETE FROM users WHERE id = ?").run(userId);
            break;
          case "reset-password": {
            const targetUser = db
              .prepare("SELECT id, email FROM users WHERE id = ?")
              .get(userId) as { id: number; email: string } | undefined;
            if (!targetUser) return json({ error: "Utilisateur introuvable." }, 404);
            const token = generateAuthToken();
            db.prepare(
              "INSERT INTO auth_tokens (user_id, type, token, expires_at) VALUES (?, 'reset', ?, ?)",
            ).run(targetUser.id, token, Date.now() + RESET_TTL_MS);
            const link = `${getAppUrl()}/reset-password?token=${token}`;
            const { subject, html } = resetEmail(link);
            await sendEmail({ to: targetUser.email, subject, html });
            return json({ ok: true });
          }
          case "toggle-chat": {
            db.prepare("UPDATE users SET chat_enabled = ? WHERE id = ?").run(body.chatEnabled ? 1 : 0, userId);
            break;
          }
          case "edit-username": {
            const username = body.username?.trim();
            if (!username) return json({ error: "Nom d'utilisateur requis." }, 400);
            if (username.length < 2 || username.length > 32) {
              return json({ error: "Le nom d'utilisateur doit faire entre 2 et 32 caractères." }, 400);
            }
            const taken = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, userId);
            if (taken) return json({ error: "Ce nom d'utilisateur est déjà pris." }, 409);
            db.prepare("UPDATE users SET username = ? WHERE id = ?").run(username, userId);
            break;
          }
          default:
            return json({ error: "Action inconnue." }, 400);
        }

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
