// Automatic safety net on top of config_changes (see logConfigChange in
// bot-engine.server.ts) and the same before/after logic as the
// config-change-impact skill: if a logged, human-made config edit is
// followed by a well-sampled, unambiguous degradation, revert the changed
// fields back to their pre-change values — without waiting for someone to
// open /admin and notice.
//
// Deliberately narrower than health-monitor.server.ts's auto-repair: that
// restores state the system already intends (a bot that should be running).
// This REVERSES a human trading decision, so three guards apply that
// auto-repair doesn't need:
//   1. Opt-in per preset (AutoTraderConfig.autoRollbackEnabled, off by
//      default) — never fires for an account that hasn't explicitly turned
//      it on.
//   2. A stricter sample size than the read-only config-change-impact tool
//      (20 trades minimum on EACH side, vs. its default of 10) — an
//      automatic action deserves more evidence than a report a human will
//      read critically.
//   3. Two independent signals must agree (expectancy AND profit factor both
//      worse, profit factor now under 1) — reverts only when the change
//      turned a working setup into a LOSING one, not merely "less good than
//      before," which is far more likely to be noise on a small sample.
//
// Every revert is itself logged as its own config_changes row (source:
// "auto-rollback") and pushed to the account's admins — it must never be a
// silent action.
import { getDb } from "./db.server";
import { updateConfigForUser, type Preset } from "./bot-engine.server";
import { summarize } from "./analytics";
import type { TradeLog, AutoTraderConfig } from "./signal-core";

const CHECK_INTERVAL_MS = 30 * 60_000; // every 30 min — a slow safety net, not a stop-loss; no need to react within minutes
const MIN_SAMPLE = 20; // per side — stricter than config-change-impact's read-only default (10)
const MIN_EXPECTANCY_DROP_USD = 0.02; // $/trade — must be a real drop, not float noise

interface ConfigChangeRow {
  id: string;
  user_id: number;
  preset: Preset;
  changed_at: number;
  fields: string;
}

function tradesForUserPreset(userId: number, preset: Preset): TradeLog[] {
  return getDb()
    .prepare(
      `SELECT time, symbol, status, profit FROM bot_trades
       WHERE user_id = ? AND preset = ? AND status IN ('won','lost')
       ORDER BY time ASC`,
    )
    .all(userId, preset) as TradeLog[];
}

async function notifyRollback(userId: number, username: string, preset: Preset, fields: Record<string, { from: unknown; to: unknown }>): Promise<void> {
  try {
    const admins = getDb().prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: number }[];
    if (!admins.length) return;
    const { sendPushToUser } = await import("./push.server");
    const fieldList = Object.entries(fields).map(([k, v]) => `${k}: ${JSON.stringify(v.to)}→${JSON.stringify(v.from)}`).join(", ");
    const payload = {
      title: `⏪ Rollback automatique — ${username} / ${preset}`,
      body: `Dégradation confirmée après le dernier changement, retour aux anciennes valeurs : ${fieldList}`,
      url: "/admin",
    };
    await Promise.allSettled(admins.map((a) => sendPushToUser(a.id, payload)));
  } catch (e) {
    console.error("[config-guardian] Notification échouée:", (e as Error).message);
  }
}

async function tick(): Promise<void> {
  const db = getDb();

  // Only presets that opted in — join bot_state to read the live config's
  // autoRollbackEnabled flag rather than trusting a stale copy.
  const candidates = db
    .prepare(
      `SELECT cc.id, cc.user_id, cc.preset, cc.changed_at, cc.fields, u.username, bs.config
       FROM config_changes cc
       JOIN users u ON u.id = cc.user_id
       JOIN bot_state bs ON bs.user_id = cc.user_id AND bs.preset = cc.preset
       WHERE cc.source = 'user' AND cc.resolved_at IS NULL`,
    )
    .all() as (ConfigChangeRow & { username: string; config: string })[];

  for (const row of candidates) {
    let config: AutoTraderConfig;
    try {
      config = JSON.parse(row.config);
    } catch {
      continue; // corrupt config JSON — not this guardian's job to fix, verify-trading-code covers that
    }
    if (!config.autoRollbackEnabled) continue;

    const trades = tradesForUserPreset(row.user_id, row.preset);
    const before = trades.filter((t) => t.time < row.changed_at).slice(-MIN_SAMPLE * 5); // generous cap, summarize() only needs the tail
    const after = trades.filter((t) => t.time >= row.changed_at);

    // Not enough evidence yet either way — leave unresolved, check again next tick.
    if (before.length < MIN_SAMPLE || after.length < MIN_SAMPLE) continue;

    const beforeSummary = summarize(before.slice(-MIN_SAMPLE));
    const afterSummary = summarize(after.slice(0, MIN_SAMPLE));

    const expectancyDropped = beforeSummary.expectancy - afterSummary.expectancy >= MIN_EXPECTANCY_DROP_USD;
    const pfWorse = (afterSummary.profitFactor ?? Infinity) < (beforeSummary.profitFactor ?? Infinity);
    const nowLosing = (afterSummary.profitFactor ?? Infinity) < 1;

    if (expectancyDropped && pfWorse && nowLosing) {
      const fields = JSON.parse(row.fields) as Record<string, { from: unknown; to: unknown }>;
      const revertPatch: Partial<AutoTraderConfig> = {};
      for (const [key, { from }] of Object.entries(fields)) {
        (revertPatch as Record<string, unknown>)[key] = from;
      }
      console.log(`[config-guardian] Rollback automatique — user ${row.user_id} preset ${row.preset}: expectancy ${beforeSummary.expectancy.toFixed(3)}→${afterSummary.expectancy.toFixed(3)}, PF ${beforeSummary.profitFactor?.toFixed(2)}→${afterSummary.profitFactor?.toFixed(2)}`);
      updateConfigForUser(row.user_id, row.preset, { ...config, ...revertPatch }, undefined, "auto-rollback");
      db.prepare("UPDATE config_changes SET resolved_at = unixepoch() * 1000 WHERE id = ?").run(row.id);
      void notifyRollback(row.user_id, row.username, row.preset, fields);
    } else {
      // Judged either way (helped, neutral, or a drop too small/mixed to act
      // on) — mark resolved so this change isn't re-evaluated on every tick
      // forever. Read-only tools (config-change-impact, audit-trading-
      // production) remain available for a human to re-examine it anytime.
      db.prepare("UPDATE config_changes SET resolved_at = unixepoch() * 1000 WHERE id = ?").run(row.id);
    }
  }
}

export function startConfigRollbackGuardian(): void {
  setTimeout(() => {
    tick().catch((e) => console.error("[config-guardian] Tick échoué:", (e as Error).message));
  }, 15_000);
  setInterval(() => {
    tick().catch((e) => console.error("[config-guardian] Tick échoué:", (e as Error).message));
  }, CHECK_INTERVAL_MS);
  console.log("[config-guardian] Scheduler démarré.");
}
