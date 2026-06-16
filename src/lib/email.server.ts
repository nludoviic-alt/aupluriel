// Minimal email sender. Uses Resend (https://resend.com) when RESEND_API_KEY is
// configured; otherwise it logs the message to the server console so the app keeps
// working (and verification/reset links stay visible in Railway logs) until a real
// sending service is wired up.

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

const APP_NAME = "LIO23";

export function getAppUrl(): string {
  // Public base URL used to build links in emails.
  return (
    process.env.APP_URL ??
    process.env.PUBLIC_URL ??
    "https://lio23-vortex-production.up.railway.app"
  );
}

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`;

  if (!apiKey) {
    // Fallback: no email provider configured yet — log so the link is still reachable.
    console.warn(
      `[email] RESEND_API_KEY non configurée — email NON envoyé.\n` +
        `  To: ${to}\n  Subject: ${subject}\n  (contenu ci-dessous)\n${stripHtml(html)}`,
    );
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[email] Échec d'envoi via Resend (HTTP ${res.status}): ${body}`);
    throw new Error("L'envoi de l'email a échoué.");
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Branded wrapper for transactional emails. */
function layout(title: string, body: string): string {
  return `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0f172a">
    <h1 style="font-size:20px;font-weight:800;background:linear-gradient(90deg,#22d3ee,#a855f7);-webkit-background-clip:text;background-clip:text;color:transparent">${APP_NAME}</h1>
    <h2 style="font-size:16px;margin-top:16px">${title}</h2>
    <div style="font-size:14px;line-height:1.6;color:#334155">${body}</div>
    <p style="font-size:11px;color:#94a3b8;margin-top:24px">LIO23 — Quant Trading AI. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
  </div>`;
}

export function verificationEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Vérifie ton adresse email — LIO23",
    html: layout(
      "Active ton compte",
      `<p>Bienvenue ! Confirme ton adresse email pour activer ton compte LIO23.</p>
       <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Vérifier mon email</a></p>
       <p style="font-size:12px;color:#64748b">Ou copie ce lien : <br>${link}</p>
       <p style="font-size:12px;color:#64748b">Ce lien expire dans 24 h. Après vérification, ton compte devra être approuvé par un administrateur.</p>`,
    ),
  };
}

export function resetEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Réinitialise ton mot de passe — LIO23",
    html: layout(
      "Réinitialisation du mot de passe",
      `<p>Tu as demandé à réinitialiser ton mot de passe.</p>
       <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Choisir un nouveau mot de passe</a></p>
       <p style="font-size:12px;color:#64748b">Ou copie ce lien : <br>${link}</p>
       <p style="font-size:12px;color:#64748b">Ce lien expire dans 1 h.</p>`,
    ),
  };
}
