import Database from "better-sqlite3";
import fs from "node:fs";

const dbPath = process.env.DB_PATH || "/home/ubuntu/data/lio23.db";
console.log("[Sync] Target DB:", dbPath);

const db = new Database(dbPath);
const users = db.prepare("SELECT id, email, username FROM users WHERE status = 'approved'").all();
console.log("[Sync] Approved users count:", users.length);

const ACTIVE_PRESETS = ["default", "boom", "crash", "scalping", "vol75"];

const PRESET_DEFAULTS = {
  default: {
    symbols: ["frxEURGBP", "frxUSDCAD", "OTC_NDX"],
    excludedSymbols: ["frxXAUUSD", "OTC_SPC", "BOOM500", "CRASH500", "CRASH900", "BOOM600"],
    stakeUsd: 25,
    maxDailyLossUsd: 75,
    minConfidence: 75,
    minTfAgreement: 4,
    hourlyEdgeFilter: true,
    mode: "demo",
  },
  boom: {
    symbols: ["BOOM900"],
    excludedSymbols: ["BOOM500", "BOOM1000", "BOOM600"],
    stakeUsd: 25,
    maxDailyLossUsd: 75,
    minConfidence: 82,
    minTfAgreement: 3,
    instrumentType: "multiplier",
    multiplierLevel: 100,
    mode: "demo",
  },
  crash: {
    symbols: ["CRASH1000"],
    excludedSymbols: ["CRASH500", "CRASH600", "CRASH900"],
    stakeUsd: 25,
    maxDailyLossUsd: 75,
    minConfidence: 82,
    minTfAgreement: 3,
    instrumentType: "multiplier",
    multiplierLevel: 100,
    mode: "demo",
  },
  scalping: {
    symbols: ["1HZ75V", "1HZ50V", "BOOM900", "CRASH1000", "frxEURGBP", "frxUSDCAD"],
    excludedSymbols: ["frxXAUUSD", "BOOM500", "CRASH500"],
    stakeUsd: 25,
    maxDailyLossUsd: 75,
    minConfidence: 82,
    mode: "demo",
  },
  vol75: {
    symbols: ["1HZ75V"],
    excludedSymbols: [],
    stakeUsd: 25,
    maxDailyLossUsd: 75,
    minConfidence: 80,
    multiplierLevel: 50,
    mode: "demo",
  },
};

const upsertStmt = db.prepare(`
  INSERT INTO bot_state (user_id, preset, enabled, config, updated_at)
  VALUES (?, ?, 0, ?, unixepoch())
  ON CONFLICT(user_id, preset) DO UPDATE SET
    config = excluded.config,
    updated_at = excluded.updated_at
`);

let updatedCount = 0;
for (const u of users) {
  for (const preset of ACTIVE_PRESETS) {
    const existingRow = db.prepare("SELECT config FROM bot_state WHERE user_id = ? AND preset = ?").get(u.id, preset);
    let config = { ...PRESET_DEFAULTS[preset] };
    if (existingRow && existingRow.config) {
      try {
        const parsed = JSON.parse(existingRow.config);
        config = { ...parsed, ...PRESET_DEFAULTS[preset] };
      } catch {}
    }
    upsertStmt.run(u.id, preset, JSON.stringify(config));
    updatedCount++;
  }
}

console.log(`[Sync Complete] ${updatedCount} preset configurations (5 presets x ${users.length} users) updated to $25 stake and calibrated settings.`);
