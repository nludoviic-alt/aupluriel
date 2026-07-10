// Minimal email sender. Uses Resend (https://resend.com) when RESEND_API_KEY is
// configured; otherwise it logs the message to the server console so the app keeps
// working (and verification/reset links stay visible in Railway logs) until a real
// sending service is wired up.

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

const APP_NAME = "Lio23";

export function getAppUrl(): string {
  // Public base URL used to build links in emails.
  return process.env.APP_URL ?? process.env.PUBLIC_URL ?? "https://lio23.com";
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
  const logoUrl = `${getAppUrl()}/logo-lio23-banner.jpg`;
  return `<body style="margin:0;padding:0;background-color:#050505">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#050505;padding:32px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#0f0f0f;border:1px solid rgba(249,115,22,0.25);border-radius:16px;overflow:hidden;font-family:Inter,Arial,sans-serif">
          <tr>
            <td>
              <img src="${logoUrl}" alt="${APP_NAME}" width="480" style="display:block;width:100%;height:auto;border:0" />
            </td>
          </tr>
          <tr>
            <td style="padding:32px">
              <h2 style="font-size:18px;font-weight:800;color:#ffffff;margin:0 0 16px">${title}</h2>
              <div style="font-size:14px;line-height:1.6;color:#cbd5e1">${body}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 28px">
              <p style="font-size:11px;color:#71717a;margin:0">${APP_NAME} — Quant Trading. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;
}

const buttonStyle =
  "display:inline-block;background:linear-gradient(90deg,#f97316,#ea580c);color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px";

export function verificationEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Vérifie ton adresse email — Lio23",
    html: layout(
      "Active ton compte",
      `<p style="margin:0 0 16px">Bienvenue ! Confirme ton adresse email pour activer ton compte Lio23.</p>
       <p style="margin:0 0 20px"><a href="${link}" style="${buttonStyle}">Vérifier mon email</a></p>
       <p style="font-size:12px;color:#71717a;margin:0 0 8px">Ou copie ce lien : <br>${link}</p>
       <p style="font-size:12px;color:#71717a;margin:0">Ce lien expire dans 24 h. Après vérification, ton compte devra être approuvé par un administrateur.</p>`,
    ),
  };
}

export function welcomeEmail(
  username: string,
  email: string,
  password: string,
): { subject: string; html: string } {
  const link = `${getAppUrl()}/login`;
  return {
    subject: "Ton compte Lio23 a été créé",
    html: layout(
      "Bienvenue sur Lio23",
      `<p style="margin:0 0 16px">Un administrateur vient de créer ton compte. Voici tes identifiants de connexion :</p>
       <p style="font-size:13px;color:#e4e4e7;background:#18181b;border-radius:8px;padding:14px 16px;margin:0 0 20px">Identifiant : <strong>${username}</strong><br>Email : <strong>${email}</strong><br>Mot de passe : <strong>${password}</strong></p>
       <p style="margin:0 0 20px"><a href="${link}" style="${buttonStyle}">Se connecter</a></p>
       <p style="font-size:12px;color:#71717a;margin:0">Nous te recommandons de changer ce mot de passe après ta première connexion.</p>`,
    ),
  };
}

export function tradeClosedEmail(params: {
  symbol: string;
  direction: string;
  stake: number;
  profit: number;
  won: boolean;
  mode: string;
}): { subject: string; html: string } {
  const { symbol, direction, stake, profit, won, mode } = params;
  const sign = profit >= 0 ? "+" : "";
  const color = won ? "#22c55e" : "#ef4444";
  const modeTag = mode === "live" ? "💰 RÉEL" : "démo";
  return {
    subject: `${won ? "✅ Gagné" : "❌ Perdu"} ${sign}$${profit.toFixed(2)} — ${symbol} (${modeTag})`,
    html: layout(
      `Trade clôturé — ${symbol}`,
      `<p style="margin:0 0 16px">Le bot serveur vient de clôturer une position (${modeTag}) :</p>
       <p style="font-size:13px;color:#e4e4e7;background:#18181b;border-radius:8px;padding:14px 16px;margin:0 0 20px">
         Marché : <strong>${symbol}</strong> · ${direction}<br>
         Mise : <strong>$${stake.toFixed(2)}</strong><br>
         Résultat : <strong style="color:${color}">${sign}$${profit.toFixed(2)}</strong>
       </p>
       <p style="margin:0 0 20px"><a href="${getAppUrl()}/autotrader" style="${buttonStyle}">Voir l'Auto-Trader</a></p>`,
    ),
  };
}

export function riskPauseEmail(note: string, mode: string): { subject: string; html: string } {
  const modeTag = mode === "live" ? "💰 RÉEL" : "démo";
  return {
    subject: `⏸️ Bot en pause (protection de risque) — ${modeTag}`,
    html: layout(
      "Le bot s'est mis en pause",
      `<p style="margin:0 0 16px">Une limite de protection a été atteinte (${modeTag}) — le bot arrête de trader et reprendra automatiquement :</p>
       <p style="font-size:13px;color:#e4e4e7;background:#18181b;border-radius:8px;padding:14px 16px;margin:0 0 20px">${note}</p>
       <p style="margin:0 0 20px"><a href="${getAppUrl()}/autotrader" style="${buttonStyle}">Voir l'Auto-Trader</a></p>`,
    ),
  };
}

export function resetEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Réinitialise ton mot de passe — Lio23",
    html: layout(
      "Réinitialisation du mot de passe",
      `<p style="margin:0 0 16px">Tu as demandé à réinitialiser ton mot de passe.</p>
       <p style="margin:0 0 20px"><a href="${link}" style="${buttonStyle}">Choisir un nouveau mot de passe</a></p>
       <p style="font-size:12px;color:#71717a;margin:0 0 8px">Ou copie ce lien : <br>${link}</p>
       <p style="font-size:12px;color:#71717a;margin:0">Ce lien expire dans 1 h.</p>`,
    ),
  };
}
