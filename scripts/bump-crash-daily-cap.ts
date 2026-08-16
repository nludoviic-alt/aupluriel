// One-off, explicit config change: raise `crash`'s maxTradesPerDay from 5 to
// 15 (matching the sibling presets crash500/boom, both already at 15) for
// every user currently running crash. No technical/strategy fields touched
// (MIN_SCORE, RSI, ADX, ATR, SL/TP, multiplier, stake — all untouched).
// Goes through updateConfigForUser so it hot-swaps into the live engine and
// (where the field is tracked) logs to config_changes like any other edit.
//
// Run with: npx tsx scripts/bump-crash-daily-cap.ts
// Point at a specific DB with: DB_PATH=/path/to/lio23.db npx tsx scripts/bump-crash-daily-cap.ts

import { getDb } from "../src/lib/db.server";
import { updateConfigForUser, type AutoTraderConfig } from "../src/lib/bot-engine.server";

const NEW_CAP = 15;

function main() {
  const db = getDb();
  const rows = db
    .prepare(`SELECT user_id, config FROM bot_state WHERE preset = 'crash' AND enabled = 1`)
    .all() as { user_id: number; config: string }[];

  console.log(`Found ${rows.length} enabled 'crash' bot(s).`);

  for (const row of rows) {
    const config = JSON.parse(row.config) as AutoTraderConfig;
    const before = config.maxTradesPerDay;
    if (before === NEW_CAP) {
      console.log(`user ${row.user_id}: already at ${NEW_CAP}, skipping`);
      continue;
    }
    config.maxTradesPerDay = NEW_CAP;
    try {
      updateConfigForUser(row.user_id, "crash", config);
      console.log(`user ${row.user_id}: maxTradesPerDay ${before} -> ${NEW_CAP} OK`);
    } catch (e) {
      console.error(`user ${row.user_id}: FAILED — ${(e as Error).message}`);
    }
  }
}

main();
