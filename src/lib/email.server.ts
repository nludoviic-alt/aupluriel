// Minimal email sender. Uses Resend (https://resend.com) when RESEND_API_KEY is
// configured; otherwise it logs the message to the server console so the app keeps
// working (and verification/reset links stay visible in Railway logs) until a real
// sending service is wired up.

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

const APP_NAME = "Pluriel";

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
  const logoUrl = `${getAppUrl()}/favicon.png`;
  return `<body style="margin:0;padding:0;background-color:#050505;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#050505;padding:40px 16px">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:linear-gradient(135deg,#0d0d11 0%,#08080a 100%);border:1px solid rgba(255,255,255,0.06);border-radius:24px;overflow:hidden;box-shadow:0 10px 40px -10px rgba(0,0,0,0.5)">
          <!-- Centered Favicon Logo Header -->
          <tr>
            <td align="center" style="padding:40px 40px 0">
              <img src="${logoUrl}" alt="${APP_NAME}" width="64" height="64" style="display:block;width:64px;height:64px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);box-shadow:0 4px 15px rgba(0,0,0,0.3)" />
            </td>
          </tr>
          <!-- Title & Content -->
          <tr>
            <td style="padding:32px 40px 40px">
              <h2 style="font-size:22px;font-weight:900;color:#ffffff;margin:0 0 20px;text-align:center;letter-spacing:-0.02em;line-height:1.3">${title}</h2>
              <div style="font-size:14px;line-height:1.65;color:#a1a1aa;margin:0">${body}</div>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:0 40px 40px;border-top:1px solid rgba(255,255,255,0.04)">
              <p style="font-size:11px;color:#52525b;margin:0;line-height:1.5;text-align:center">${APP_NAME} Quant Trading. Si tu n'es pas à l'origine de cette demande, tu peux ignorer cet email en toute sécurité.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;
}

const buttonStyle =
  "display:inline-block;background:linear-gradient(90deg,#06b6d4,#8b5cf6);color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:12px;font-weight:800;font-size:14px;text-align:center;box-shadow:0 4px 12px rgba(6,182,212,0.15);transition:all 0.2s ease-in-out";

export function verificationEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Vérifie ton adresse email — Pluriel",
    html: layout(
      "Active ton compte",
      `<p style="margin:0 0 16px;text-align:center">Bienvenue ! Confirme ton adresse email pour activer ton compte Pluriel.</p>
       <p style="margin:0 0 24px;text-align:center"><a href="${link}" style="${buttonStyle}">Vérifier mon email</a></p>
       <p style="font-size:12px;color:#52525b;margin:0 0 8px;text-align:center">Ou copie ce lien : <br><a href="${link}" style="color:#06b6d4;text-decoration:none;word-break:break-all">${link}</a></p>
       <p style="font-size:12px;color:#52525b;margin:0;text-align:center">Ce lien expire dans 24 h. Après vérification, ton compte devra être approuvé par un administrateur.</p>`,
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
    subject: "Ton compte Pluriel a été créé",
    html: layout(
      "Bienvenue sur Pluriel",
      `<p style="margin:0 0 16px;text-align:center">Un administrateur vient de créer ton compte. Voici tes identifiants de connexion :</p>
       <div style="font-size:13px;color:#e4e4e7;background:#141417;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin:0 0 24px">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
           <tr><td style="padding:4px 0;color:#71717a">Identifiant :</td><td style="padding:4px 0;text-align:right;color:#ffffff;font-weight:700">${username}</td></tr>
           <tr><td style="padding:4px 0;color:#71717a">Email :</td><td style="padding:4px 0;text-align:right;color:#ffffff;font-weight:700">${email}</td></tr>
           <tr><td style="padding:4px 0;color:#71717a">Mot de passe :</td><td style="padding:4px 0;text-align:right;color:#ffffff;font-weight:700;font-family:monospace">${password}</td></tr>
         </table>
       </div>
       <p style="margin:0 0 24px;text-align:center"><a href="${link}" style="${buttonStyle}">Se connecter</a></p>
       <p style="font-size:12px;color:#52525b;margin:0;text-align:center">Nous te recommandons de changer ce mot de passe temporaire après ta première connexion.</p>`,
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
       <div style="font-size:13px;color:#e4e4e7;background:#141417;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin:0 0 24px">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
           <tr><td style="padding:6px 0;color:#71717a">Marché :</td><td style="padding:6px 0;text-align:right;color:#ffffff;font-weight:700">${symbol} · ${direction}</td></tr>
           <tr><td style="padding:6px 0;color:#71717a">Mise :</td><td style="padding:6px 0;text-align:right;color:#ffffff;font-weight:700">$${stake.toFixed(2)}</td></tr>
           <tr><td style="padding:6px 0;color:#71717a">Résultat :</td><td style="padding:6px 0;text-align:right;color:${color};font-weight:900;font-size:16px">${sign}$${profit.toFixed(2)}</td></tr>
         </table>
       </div>
       <p style="margin:0 0 12px;text-align:center"><a href="${getAppUrl()}/autotrader" style="${buttonStyle}">Voir l'Auto-Trader</a></p>`,
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
       <div style="font-size:13px;color:#e4e4e7;background:#141417;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin:0 0 24px;font-weight:700;color:#f59e0b;text-align:center">${note}</div>
       <p style="margin:0 0 12px;text-align:center"><a href="${getAppUrl()}/autotrader" style="${buttonStyle}">Voir l'Auto-Trader</a></p>`,
    ),
  };
}

export function inviteEmail(
  code: string,
  email: string,
  expiresAt: number,
): { subject: string; html: string } {
  const link = `${getAppUrl()}/login?tab=register&email=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`;
  const expiryLabel = new Date(expiresAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  });
  return {
    subject: "Tu es invité(e) sur Pluriel",
    html: layout(
      "Invitation à rejoindre Pluriel",
      `<p style="margin:0 0 16px;text-align:center">Un administrateur t'invite à créer un compte sur Pluriel Quant Trading.</p>
       <div style="font-size:13px;color:#e4e4e7;background:#141417;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:16px;margin:0 0 24px;text-align:center">
         <span style="font-size:11px;text-transform:uppercase;color:#71717a;font-weight:700;letter-spacing:0.1em">Code d'invitation</span>
         <div style="font-size:24px;font-weight:900;letter-spacing:4px;color:#ffffff;margin-top:6px;font-family:monospace">${code}</div>
       </div>
       <p style="margin:0 0 24px;text-align:center"><a href="${link}" style="${buttonStyle}">Créer mon compte</a></p>
       <p style="font-size:12px;color:#52525b;margin:0 0 8px;text-align:center">Ou copie ce lien : <br><a href="${link}" style="color:#06b6d4;text-decoration:none;word-break:break-all">${link}</a></p>
       <p style="font-size:12px;color:#52525b;margin:0;text-align:center">Ce code est valable uniquement pour l'adresse ${email} et expire le ${expiryLabel}.</p>`,
    ),
  };
}

export function resetEmail(link: string): { subject: string; html: string } {
  return {
    subject: "Réinitialise ton mot de passe — Pluriel",
    html: layout(
      "Réinitialisation du mot de passe",
      `<p style="margin:0 0 16px;text-align:center">Tu as demandé à réinitialiser ton mot de passe.</p>
       <p style="margin:0 0 24px;text-align:center"><a href="${link}" style="${buttonStyle}">Choisir un nouveau mot de passe</a></p>
       <p style="font-size:12px;color:#52525b;margin:0 0 8px;text-align:center">Ou copie ce lien : <br><a href="${link}" style="color:#06b6d4;text-decoration:none;word-break:break-all">${link}</a></p>
       <p style="font-size:12px;color:#52525b;margin:0;text-align:center">Ce lien expire dans 1 h.</p>`,
    ),
  };
}
