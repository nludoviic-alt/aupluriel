// Periodic feature health monitor: runs a handful of checks every 5 min,
// persists each check's status, and pushes admins the moment a check
// transitions to/from a healthy state — so a silent failure (a crashed bot,
// a stalled backtest scheduler, an empty push subscription table) surfaces
// immediately instead of waiting for the next manual audit.
import { getDb } from "./db.server";
import { getBotRuntime, isBotRunning, restoreBots, loadBotConfig, startBotForUser } from "./bot-engine.server";
import { DEFAULT_CONFIG, getInstrumentForSymbol } from "./signal-core";

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

function checkDailySummaryScheduler(): CheckResult {
  const row = getDb().prepare("SELECT checked_at FROM health_status WHERE check_key = 'daily_summary'").get() as { checked_at: number } | undefined;
  const now = Math.floor(Date.now() / 1000);
  if (!row) {
    return { key: "daily_summary", label: "Résumé quotidien & alerte win rate", status: "warn", detail: "Scheduler démarré mais aucun résumé envoyé encore — attendu après 22h UTC." };
  }
  const ageH = (now - row.checked_at) / 3600;
  if (ageH > 30) {
    return { key: "daily_summary", label: "Résumé quotidien & alerte win rate", status: "error", detail: `Dernier résumé il y a ${Math.round(ageH)}h — le scheduler semble à l'arrêt.` };
  }
  return { key: "daily_summary", label: "Résumé quotidien & alerte win rate", status: "ok", detail: `Dernier cycle il y a ${Math.round((now - row.checked_at) / 60)} min.` };
}

function checkGoldTrading(): CheckResult {
  const goldSymbol = "frxXAUUSD";
  const inConfig = DEFAULT_CONFIG.symbols.includes(goldSymbol);
  if (!inConfig) {
    return { key: "gold_trading", label: "Trading de l'Or (XAU/USD)", status: "error", detail: "L'or n'est pas dans la liste des symboles tradés." };
  }
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayTs = Math.floor(todayStart.getTime() / 1000);
  const goldToday = getDb().prepare(
    "SELECT COUNT(*) AS n FROM bot_trades WHERE symbol = ? AND time >= ?",
  ).get(goldSymbol, todayTs) as { n: number };
  const goldTotal = getDb().prepare(
    "SELECT COUNT(*) AS n FROM bot_trades WHERE symbol = ?",
  ).get(goldSymbol) as { n: number };
  const volOk = DEFAULT_CONFIG.maxVolatilityPct >= 4;
  if (!volOk) {
    return { key: "gold_trading", label: "Trading de l'Or (XAU/USD)", status: "warn", detail: `Or dans la config mais maxVolatilityPct=${DEFAULT_CONFIG.maxVolatilityPct}% — trop bas pour l'or (ATR naturel 2-4%).` };
  }
  return {
    key: "gold_trading",
    label: "Trading de l'Or (XAU/USD)",
    status: "ok",
    detail: `Or actif · ${goldToday.n} trade(s) aujourd'hui · ${goldTotal.n} au total · volatilité max ${DEFAULT_CONFIG.maxVolatilityPct}%`,
  };
}

function checkHybridInstrument(): CheckResult {
  const overrides = DEFAULT_CONFIG.symbolInstrumentOverrides;
  const btcOverride = overrides?.["cryBTCUSD"];
  const btcInSymbols = DEFAULT_CONFIG.symbols.includes("cryBTCUSD");
  if (!btcInSymbols) {
    return { key: "hybrid_instrument", label: "Mode hybride BTC", status: "warn", detail: "BTC n'est pas dans la liste des symboles tradés." };
  }
  if (!btcOverride) {
    return { key: "hybrid_instrument", label: "Mode hybride BTC", status: "warn", detail: "BTC dans la config mais sans override multiplicateur — ne sera pas tradé en binaire." };
  }
  const goldInstrument = getInstrumentForSymbol("frxXAUUSD", DEFAULT_CONFIG);
  const btcInstrument = getInstrumentForSymbol("cryBTCUSD", DEFAULT_CONFIG);
  return {
    key: "hybrid_instrument",
    label: "Mode hybride BTC",
    status: "ok",
    detail: `Or=${goldInstrument} · BTC=${btcInstrument} — les deux instruments coexistent.`,
  };
}

const CHECKS: (() => CheckResult)[] = [
  checkBotsRunning,
  checkBotErrors,
  checkAutoBacktestScheduler,
  checkPushSubscriptions,
  checkEmailConfig,
  checkDerivTokens,
  checkDailySummaryScheduler,
  checkGoldTrading,
  checkHybridInstrument,
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

// ── Auto-repair: attempt to fix the problem before surfacing it ──
// Each repair is fire-and-forget — a failure just means the admin push
// will fire next tick with the still-broken status.
async function attemptRepair(result: CheckResult): Promise<CheckResult> {
  if (result.status === "ok") return result;

  try {
    // Bot enabled in DB but not running → restart it
    if (result.key === "bots_running") {
      console.log(`[health] Auto-réparation : redémarrage des bots arrêtés…`);
      await restoreBots();
      // Re-check immediately
      const recheck = checkBotsRunning();
      if (recheck.status === "ok") {
        return { ...recheck, detail: `${recheck.detail} (auto-réparé)` };
      }
      return recheck;
    }

    // Daily summary scheduler stalled → restart it
    if (result.key === "daily_summary" && result.status === "error") {
      console.log(`[health] Auto-réparation : redémarrage du scheduler daily-summary…`);
      const { startDailySummaryScheduler } = await import("./daily-summary.server");
      startDailySummaryScheduler();
      return { ...result, status: "ok", detail: `Scheduler redémarré automatiquement. ${result.detail}` };
    }

    // Auto-backtest scheduler stalled → restart it
    if (result.key === "auto_backtest" && result.status === "error") {
      console.log(`[health] Auto-réparation : redémarrage du scheduler auto-backtest…`);
      const { startAutoBacktestScheduler } = await import("./auto-backtest.server");
      startAutoBacktestScheduler();
      return { ...result, status: "ok", detail: `Scheduler redémarré automatiquement. ${result.detail}` };
    }
  } catch (e) {
    console.error(`[health] Auto-réparation échouée pour ${result.key}:`, (e as Error).message);
  }

  return result;
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

    // ── Auto-repair before surfacing ──
    if (result.status !== "ok") {
      result = await attemptRepair(result);
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
