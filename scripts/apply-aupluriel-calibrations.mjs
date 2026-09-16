import Database from 'better-sqlite3';
import fs from 'node:fs';

const dbPath = './lio23.db';
const backupPath = `./db-backups/lio23.db.backup-${Date.now()}`;

// 1. Backup DB
if (!fs.existsSync('./db-backups')) {
  fs.mkdirSync('./db-backups', { recursive: true });
}
fs.copyFileSync(dbPath, backupPath);
console.log(`[Backup] DB saved to ${backupPath}`);

const db = new Database(dbPath);

// 2. Disable toxic single-symbol bots (crash500)
const disableStmt = db.prepare(`UPDATE bot_state SET enabled = 0 WHERE preset = 'crash500'`);
const disabledInfo = disableStmt.run();
console.log(`[Disable Toxic] Disabled ${disabledInfo.changes} row(s) for preset 'crash500'`);

// 3. Update active configs to enforce minTfAgreement = 4, hourlyEdgeFilter = true, and safe symbols
const activeRows = db.prepare(`SELECT user_id, preset, config FROM bot_state WHERE enabled = 1`).all();

const updateStmt = db.prepare(`UPDATE bot_state SET config = ? WHERE user_id = ? AND preset = ?`);

for (const row of activeRows) {
  try {
    const config = JSON.parse(row.config);
    config.minTfAgreement = 4; // Force TF=4 (eliminate losing TF=3 bucket)
    config.hourlyEdgeFilter = true; // Force hourly edge filter

    // Preset specific symbol updates
    if (row.preset === 'boom') {
      config.symbols = ['BOOM900'];
      config.excludedSymbols = ['BOOM500', 'BOOM1000', 'BOOM600'];
    } else if (row.preset === 'crash') {
      config.symbols = ['CRASH1000'];
      config.excludedSymbols = ['CRASH500', 'CRASH600', 'CRASH900'];
    } else if (row.preset === 'default') {
      config.symbols = ['frxEURGBP', 'frxUSDCAD', 'OTC_NDX'];
      config.excludedSymbols = ['frxXAUUSD', 'OTC_SPC', 'BOOM500', 'CRASH500'];
    }

    updateStmt.run(JSON.stringify(config), row.user_id, row.preset);
    console.log(`[Calibrated] Updated ${row.preset} for user_id ${row.user_id}`);
  } catch (err) {
    console.error(`[Error] Failed to calibrate user_id ${row.user_id}, preset ${row.preset}:`, err);
  }
}

console.log('[Calibration Complete] All active bots updated with TF=4 and safe symbol filters.');
