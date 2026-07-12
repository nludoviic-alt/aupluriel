// Admin-generated invite codes: create one bound to a recipient's email,
// send it by email, list/revoke existing ones. Redeemed in register.ts.
import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "crypto";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import { sendEmail, inviteEmail } from "@/lib/email.server";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
// Excludes ambiguous chars (0/O, 1/I/l) so a code is easy to read and retype.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

interface InviteRow {
  id: number;
  code: string;
  email: string;
  used_by: number | null;
  used_at: number | null;
  revoked: number;
  expires_at: number;
  created_at: number;
  used_by_username: string | null;
}

export const Route = createFileRoute("/api/admin/invites")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const rows = getDb()
          .prepare(
            `SELECT i.id, i.code, i.email, i.used_by, i.used_at, i.revoked, i.expires_at, i.created_at,
                    u.username AS used_by_username
             FROM invite_codes i
             LEFT JOIN users u ON u.id = i.used_by
             ORDER BY i.created_at DESC`,
          )
          .all() as InviteRow[];

        const now = Date.now();
        const invites = rows.map((r) => ({
          id: r.id,
          code: r.code,
          email: r.email,
          usedByUsername: r.used_by_username,
          usedAt: r.used_at,
          revoked: !!r.revoked,
          expiresAt: r.expires_at,
          createdAt: r.created_at,
          status: r.used_by
            ? "used"
            : r.revoked
              ? "revoked"
              : r.expires_at < now
                ? "expired"
                : "pending",
        }));

        return json({ invites });
      },

      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          action?: "create" | "revoke" | "resend" | "delete";
          id?: number;
          email?: string;
        };
        const { action } = body;
        if (!action) return json({ error: "action requise." }, 400);

        const db = getDb();

        if (action === "create") {
          const email = body.email?.trim().toLowerCase();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return json({ error: "Email invalide." }, 400);
          }

          const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
          if (existingUser) {
            return json({ error: "Un compte existe déjà avec cet email." }, 409);
          }

          const code = generateCode();
          const expiresAt = Date.now() + INVITE_TTL_MS;
          db.prepare(
            "INSERT INTO invite_codes (code, email, created_by, expires_at) VALUES (?, ?, ?, ?)",
          ).run(code, email, admin.id, expiresAt);

          const { subject, html } = inviteEmail(code, email, expiresAt);
          try {
            await sendEmail({ to: email, subject, html });
          } catch (e) {
            return json({ error: `Code créé mais l'email n'a pas pu être envoyé : ${(e as Error).message}` }, 502);
          }

          return json({ ok: true, code });
        }

        const { id } = body;
        if (!id) return json({ error: "id requis." }, 400);

        const invite = db.prepare("SELECT id, email, code, expires_at, used_by FROM invite_codes WHERE id = ?").get(id) as
          | { id: number; email: string; code: string; expires_at: number; used_by: number | null }
          | undefined;
        if (!invite) return json({ error: "Invitation introuvable." }, 404);

        switch (action) {
          case "revoke":
            db.prepare("UPDATE invite_codes SET revoked = 1 WHERE id = ?").run(id);
            return json({ ok: true });

          case "delete":
            db.prepare("DELETE FROM invite_codes WHERE id = ?").run(id);
            return json({ ok: true });

          case "resend": {
            if (invite.used_by) return json({ error: "Ce code a déjà été utilisé." }, 400);
            const { subject, html } = inviteEmail(invite.code, invite.email, invite.expires_at);
            try {
              await sendEmail({ to: invite.email, subject, html });
            } catch (e) {
              return json({ error: (e as Error).message }, 502);
            }
            return json({ ok: true });
          }

          default:
            return json({ error: "Action inconnue." }, 400);
        }
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
