import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { generateAuthToken } from "@/lib/auth.server";
import { sendEmail, resetEmail, getAppUrl } from "@/lib/email.server";

const RESET_TTL_MS = 60 * 60 * 1000; // 1h

export const Route = createFileRoute("/api/auth/forgot-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { email } = (await request.json()) as { email?: string };
        // Generic response to avoid account enumeration.
        const generic = {
          message: "Si un compte existe pour cet email, un lien de réinitialisation a été envoyé.",
        };
        if (!email) return json(generic);

        const db = getDb();
        const user = db
          .prepare("SELECT id, email FROM users WHERE email = ?")
          .get(email.toLowerCase()) as { id: number; email: string } | undefined;

        if (user) {
          const token = generateAuthToken();
          db.prepare(
            "INSERT INTO auth_tokens (user_id, type, token, expires_at) VALUES (?, 'reset', ?, ?)",
          ).run(user.id, token, Date.now() + RESET_TTL_MS);
          const link = `${getAppUrl()}/reset-password?token=${token}`;
          const { subject, html } = resetEmail(link);
          try {
            await sendEmail({ to: user.email, subject, html });
          } catch {
            /* swallow — generic response either way */
          }
        }

        return json(generic);
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
