import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin, generateAuthToken } from "@/lib/auth.server";
import { sendEmail, resetEmail, getAppUrl } from "@/lib/email.server";

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
            "SELECT id, email, username, email_verified, status, is_admin, created_at FROM users ORDER BY created_at DESC",
          )
          .all();
        return json({ users });
      },

      // Approve / reject / delete an account (admin only).
      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const { userId, action } = (await request.json()) as {
          userId?: number;
          action?: "approve" | "reject" | "revoke" | "delete" | "reset-password";
        };
        if (!userId || !action) return json({ error: "userId et action requis." }, 400);

        if (userId === admin.id) {
          return json({ error: "Tu ne peux pas modifier ton propre compte admin." }, 400);
        }

        const db = getDb();
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
