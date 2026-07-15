// Periodic feature health monitor: runs a handful of checks every 5 min,
// persists each check's status, and pushes admins the moment a check
// transitions to/from a healthy state — so a silent failure (a crashed bot,
// a stalled backtest scheduler, an empty push subscription table) surfaces
// immediately instead of waiting for the next manual audit.
import { getDb } from "./db.server";
import { getBotRuntime, isBotRunning } from "./bot-engine.server";

type Status = "ok" | "warn" | "error";
interface CheckResult {
  key: string;
  label: string;
  status: Status;
  detail: string;
}

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function checkBotsRunning(): CheckResult {
  const rows = getDb().prepare("SELECT user_id FROM bot_state WHERE enabled = 1").all() as { user_id: number }[];
  const down = rows.filter((r) => !isBotRunning(r.user_id)).map((r) => r.user_id);
  if (!down.length) {
    return { key: "bots_running", label: "Bots serveur", status: "ok", detail: `${rows.length} bot(s) actif(s), tous en cours d'exécution.` };
  }
  return { key: "bots_running", label: "Bots serveur", status: "error", detail: `Activé(s) en base mais arrêté(s) en pratique : user(s) ${down.join(", ")}.` };
}

function checkBotErrors(): CheckResult {
  const rows = getDb().prepare("SELECT user_id FROM bot_state WHERE enabled = 1").all() as { user_id: number }[];
  const errored = rows
    .map((r) => ({ userId: r.user_id, err: getBotRuntime(r.user_id).lastError }))
    .filter((r): r is { userId: number; err: string } => !!r.err);
  if (!errored.length) {
    return { key: "bot_errors", label: "Erreurs bot actives", status: "ok", detail: "Aucune erreur active." };
  }
  return {
    key: "bot_errors",
    label: "Erreurs bot actives",
    status: "warn",
    detail: errored.map((e) => `user ${e.userId} : ${e.err}`).join(" · "),
  };
}

function checkAutoBacktestScheduler(): CheckResult {
  const row = getDb().prepare("SELECT checked_at FROM auto_backtest_state WHERE id = 1").get() as { checked_at: number } | undefined;
  if (!row) {
    return { key: "auto_backtest", label: "Backtest automatique", status: "warn", detail: "Aucun verdict encore calculé." };
  }
  const ageMs = Date.now() - row.checked_at * 1000;
  if (ageMs > 7 * 60 * 60 * 1000) {
    return { key: "auto_backtest", label: "Backtest automatique", status: "error", detail: `Dernier calcul il y a ${Math.round(ageMs / 3_600_000)}h — le scheduler semble à l'arrêt (attendu toutes les 6h).` };
  }
  return { key: "auto_backtest", label: "Backtest automatique", status: "ok", detail: `Dernier calcul il y a ${Math.round(ageMs / 60_000)} min.` };
}

function checkPushSubscriptions(): CheckResult {
  const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM push_subscriptions").get() as { n: number };
  if (n === 0) {
    return { key: "push_subs", label: "Notifications push", status: "warn", detail: "Aucun appareil abonné — personne ne recevra de notification push." };
  }
  return { key: "push_subs", label: "Notifications push", status: "ok", detail: `${n} appareil(s) abonné(s).` };
}

function checkEmailConfig(): CheckResult {
  if (!process.env.RESEND_API_KEY) {
    return { key: "email_config", label: "Envoi d'emails", status: "warn", detail: "RESEND_API_KEY non configurée — les emails sont seulement journalisés, jamais réellement envoyés." };
  }
  return { key: "email_config", label: "Envoi d'emails", status: "ok", detail: "Fournisseur Resend configuré." };
}

function checkDerivTokens(): CheckResult {
  const rows = getDb()
    .prepare(
      `SELECT bs.user_id FROM bot_state bs
       LEFT JOIN user_settings us ON us.user_id = bs.user_id
       WHERE bs.enabled = 1 AND (us.deriv_token IS NULL OR us.deriv_token = '')`,
    )
    .all() as { user_id: number }[];
  if (!rows.length) {
    return { key: "deriv_tokens", label: "Connexion Deriv", status: "ok", detail: "Tous les bots actifs ont un token Deriv enregistré." };
  }
  return { key: "deriv_tokens", label: "Connexion Deriv", status: "error", detail: `Bot actif sans token enregistré : user(s) ${rows.map((r) => r.user_id).join(", ")}.` };
}

const CHECKS: (() => CheckResult)[] = [
  checkBotsRunning,
  checkBotErrors,
  checkAutoBacktestScheduler,
  checkPushSubscriptions,
  checkEmailConfig,
  checkDerivTokens,
];

async function notifyTransition(result: CheckResult, prevStatus: Status | null): Promise<void> {
  try {
    const admins = getDb().prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: number }[];
    if (!admins.length) return;
    const { sendPushToUser } = await import("./push.server");
    const recovered = result.status === "ok" && prevStatus !== null && prevStatus !== "ok";
    const payload = {
      title: recovered ? `✅ ${result.label} rétabli` : `${result.status === "error" ? "🔴" : "🟠"} ${result.label} — problème détecté`,
      body: result.detail,
      url: "/admin",
    };
    await Promise.allSettled(admins.map((a) => sendPushToUser(a.id, payload)));
  } catch (e) {
    console.error("[health] Notification de transition échouée:", (e as Error).message);
  }
}

async function tick(): Promise<void> {
  const db = getDb();
  for (const check of CHECKS) {
    let result: CheckResult;
    try {
      result = check();
    } catch (e) {
      result = { key: check.name, label: check.name, status: "error", detail: `Vérification échouée : ${(e as Error).message}` };
    }

    const prev = db.prepare("SELECT status FROM health_status WHERE check_key = ?").get(result.key) as { status: Status } | undefined;

    db.prepare(
      `INSERT INTO health_status (check_key, label, status, detail, checked_at)
       VALUES (?, ?, ?, ?, unixepoch())
       ON CONFLICT(check_key) DO UPDATE SET
         label = excluded.label, status = excluded.status, detail = excluded.detail, checked_at = excluded.checked_at`,
    ).run(result.key, result.label, result.status, result.detail);

    // Alert on: a fresh problem (no prior row, already unhealthy), any status
    // change, or a recovery — never on an unchanged, already-known state
    // (that would just spam admins every 5 min while something stays broken).
    if (!prev) {
      if (result.status !== "ok") void notifyTransition(result, null);
    } else if (prev.status !== result.status) {
      void notifyTransition(result, prev.status);
    }
  }
}

export function startHealthMonitorScheduler(): void {
  // First tick after the boot dust settles (restoreBots + auto-backtest's
  // own startup delays), then every CHECK_INTERVAL_MS.
  setTimeout(() => { tick().catch((e) => console.error("[health] tick échoué:", e)); }, 30_000);
  setInterval(() => { tick().catch((e) => console.error("[health] tick échoué:", e)); }, CHECK_INTERVAL_MS);
}
