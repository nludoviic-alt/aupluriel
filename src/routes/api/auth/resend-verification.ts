import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { generateAuthToken } from "@/lib/auth.server";
import { sendEmail, verificationEmail, getAppUrl } from "@/lib/email.server";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

export const Route = createFileRoute("/api/auth/resend-verification")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { email } = (await request.json()) as { email?: string };
        // Always return a generic message to avoid leaking which emails exist.
        const generic = {
          message: "Si un compte non vérifié existe pour cet email, un nouveau lien a été envoyé.",
        };
        if (!email) return json(generic);

        const db = getDb();
        const user = db
          .prepare("SELECT id, email, email_verified FROM users WHERE email = ?")
          .get(email.toLowerCase()) as
          | { id: number; email: string; email_verified: number }
          | undefined;

        if (user && !user.email_verified) {
          const token = generateAuthToken();
          db.prepare(
            "INSERT INTO auth_tokens (user_id, type, token, expires_at) VALUES (?, 'verify', ?, ?)",
          ).run(user.id, token, Date.now() + VERIFY_TTL_MS);
          const link = `${getAppUrl()}/verify-email?token=${token}`;
          const { subject, html } = verificationEmail(link);
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
