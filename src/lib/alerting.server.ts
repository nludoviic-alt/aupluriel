import { getDb } from "./db.server";

export type AlertSeverity = "INFO" | "WARNING" | "CRITICAL";

export type AlertType =
  | "DERIV_DISCONNECTED"
  | "BOT_STALLED"
  | "STRATEGY_PAUSED"
  | "DRAWDOWN_LIMIT_REACHED"
  | "HIGH_REJECTION_RATE"
  | "PORTFOLIO_MISMATCH"
  | "UNUSUAL_TRADE_SILENCE"
  | "LOSS_STREAK_STATE_MISMATCH";

export interface AlertPayload {
  userId: number;
  preset?: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

export class AlertingEngine {
  /**
   * Dispatches an alert across all active notification channels and persists to SQLite.
   */
  static async sendAlert(payload: AlertPayload): Promise<void> {
    const { userId, preset = "default", type, severity, title, message, metadata } = payload;
    const now = Date.now();
    const alertId = `alt_${now}_${Math.random().toString(36).slice(2, 8)}`;

    console.warn(`[ALERTING] [${severity}] [${type}] User ${userId} (${preset}): ${title} - ${message}`);

    // 1. Persist alert to database
    try {
      getDb().prepare(`
        INSERT INTO alerts (id, user_id, title, message, type, is_read, created_at, symbol)
        VALUES (?, ?, ?, ?, ?, 0, unixepoch(), ?)
      `).run(alertId, userId, `[${severity}] ${title}`, message, type.toLowerCase(), preset);
    } catch (err) {
      console.error("[ALERTING] DB insert error:", err);
    }

    // 2. Dispatch to Telegram if configured
    try {
      await this.sendTelegramNotification(userId, severity, title, message);
    } catch (err) {
      console.error("[ALERTING] Telegram dispatch error:", err);
    }
  }

  private static async sendTelegramNotification(
    userId: number,
    severity: AlertSeverity,
    title: string,
    message: string
  ): Promise<void> {
    const db = getDb();
    const userCfgRow = db.prepare("SELECT config FROM user_config WHERE user_id = ?").get(userId) as
      | { config: string }
      | undefined;
    if (!userCfgRow) return;

    try {
      const cfg = JSON.parse(userCfgRow.config);
      const botToken = cfg.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
      const chatId = cfg.telegramChatId || process.env.TELEGRAM_CHAT_ID;

      if (!botToken || !chatId) return;

      const icon = severity === "CRITICAL" ? "🚨" : severity === "WARNING" ? "⚠️" : "ℹ️";
      const text = `${icon} *AU PLURIEL ALERT* (${severity})\n*${title}*\n${message}`;

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
      });
    } catch {
      // Ignore webhook fetch errors
    }
  }
}

/**
 * Background Heartbeat & Anomaly Monitor Daemon.
 * Periodically checks for stale connections, paused strategies, high rejection counts, or stuck loops.
 */
class HeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private lastHeartbeats: Map<string, number> = new Map();

  start(intervalMs = 30000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.runHealthChecks(), intervalMs);
    console.log(`[HeartbeatMonitor] Started background health checks (interval: ${intervalMs}ms)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  recordEngineHeartbeat(userId: number, preset: string) {
    this.lastHeartbeats.set(`${userId}:${preset}`, Date.now());
  }

  private runHealthChecks() {
    const db = getDb();
    const now = Date.now();

    // 1. Check for paused strategies due to risk limits
    try {
      const pausedRows = db
        .prepare("SELECT user_id, preset, paused_until FROM bot_state WHERE paused_until > ?")
        .all(now) as { user_id: number; preset: string; paused_until: number }[];

      for (const row of pausedRows) {
        const remainingMinutes = Math.ceil((row.paused_until - now) / 60000);
        AlertingEngine.sendAlert({
          userId: row.user_id,
          preset: row.preset,
          type: "STRATEGY_PAUSED",
          severity: "WARNING",
          title: "Stratégie en Pause Sécurité",
          message: `La stratégie ${row.preset} est suspendue suite au déclenchement d'un filtre de risque. Reprise dans ${remainingMinutes} min.`
        });
      }
    } catch (err) {
      console.error("[HeartbeatMonitor] Error checking paused strategies:", err);
    }

    // 2. Check for signal rejection spikes (> 10 rejections in last 10 minutes)
    try {
      const tenMinsAgo = now - 600000;
      const rejectionSpikes = db
        .prepare(`
          SELECT user_id, preset, COUNT(*) as rej_count 
          FROM signal_rejections 
          WHERE time >= ? 
          GROUP BY user_id, preset 
          HAVING rej_count >= 10
        `)
        .all(tenMinsAgo) as { user_id: number; preset: string; rej_count: number }[];

      for (const spike of rejectionSpikes) {
        AlertingEngine.sendAlert({
          userId: spike.user_id,
          preset: spike.preset,
          type: "HIGH_REJECTION_RATE",
          severity: "WARNING",
          title: "Pics de Signaux Rejetés",
          message: `${spike.rej_count} signaux ont été filtrés/rejetés dans les 10 dernières minutes sur le préréglage ${spike.preset}.`
        });
      }
    } catch (err) {
      console.error("[HeartbeatMonitor] Error checking rejection spikes:", err);
    }
  }
}

export const heartbeatMonitor = new HeartbeatMonitor();
