import { getDb } from "./db.server";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  notifyOnTradeOpen: boolean;
  notifyOnTradeClose: boolean;
  notifyOnRiskLimit: boolean;
  notifyOnSpikeSignal: boolean;
}

export function getUserTelegramConfig(userId: number): TelegramConfig | null {
  const db = getDb();
  const row = db
    .prepare("SELECT config FROM user_config WHERE user_id = ?")
    .get(userId) as { config?: string } | undefined;

  if (!row || !row.config) return null;
  try {
    const parsed = JSON.parse(row.config);
    if (parsed.telegram) return parsed.telegram as TelegramConfig;
  } catch {
    // ignore json parse error
  }
  return null;
}

export function saveUserTelegramConfig(userId: number, cfg: TelegramConfig): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT config FROM user_config WHERE user_id = ?")
    .get(userId) as { config?: string } | undefined;

  let current: Record<string, any> = {};
  if (existing && existing.config) {
    try {
      current = JSON.parse(existing.config);
    } catch {
      current = {};
    }
  }

  current.telegram = cfg;
  const jsonStr = JSON.stringify(current);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO user_config (user_id, config, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      config = excluded.config,
      updated_at = excluded.updated_at
  `).run(userId, jsonStr, now);
}

/**
 * Sends a Markdown/HTML formatted notification via Telegram Bot API.
 */
export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  if (!botToken || !chatId) {
    return { success: false, error: "Bot Token ou Chat ID manquant" };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken.trim()}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const data = await res.json();
    if (data.ok) {
      return { success: true };
    } else {
      return { success: false, error: data.description || "Erreur Telegram API" };
    }
  } catch (err: any) {
    return { success: false, error: err.message || "Échec de la connexion Telegram" };
  }
}
