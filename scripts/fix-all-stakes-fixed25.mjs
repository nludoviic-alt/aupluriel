import Database from "better-sqlite3";
import { resolve } from "path";

const dbPath = process.env.DB_PATH || resolve(process.cwd(), "lio23.db");
console.log(`[fix-stakes] Fixation des mises à $25 (fixed) sur : ${dbPath}`);

const db = new Database(dbPath);

const rows = db.prepare("SELECT user_id, preset, config FROM bot_state").all();
let updated = 0;

const updateStmt = db.prepare("UPDATE bot_state SET config = ? WHERE user_id = ? AND preset = ?");

for (const row of rows) {
  try {
    const config = JSON.parse(row.config);
    let changed = false;
    if (config.stakeMode !== "fixed") {
      config.stakeMode = "fixed";
      changed = true;
    }
    if (config.stakeUsd !== 25) {
      config.stakeUsd = 25;
      changed = true;
    }
    if (config.maxDailyLossUsd !== 75) {
      config.maxDailyLossUsd = 75;
      changed = true;
    }

    if (changed) {
      updateStmt.run(JSON.stringify(config), row.user_id, row.preset);
      updated++;
      console.log(`  ✓ Updated user ${row.user_id} / preset ${row.preset}: stakeUsd=25, stakeMode=fixed, maxDailyLoss=75`);
    }
  } catch (e) {
    console.error(`  ✗ Erreur row user ${row.user_id} preset ${row.preset}:`, e.message);
  }
}

console.log(`[fix-stakes] Terminé : ${updated} / ${rows.length} configurations mises à jour.`);
db.close();
