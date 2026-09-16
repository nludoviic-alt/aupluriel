import Database from "better-sqlite3";
import { resolve } from "path";

const dbPath = process.env.DB_PATH || resolve("lio23.db");
console.log(`Connecting to database at ${dbPath}...`);

const db = new Database(dbPath);

// Target User IDs: 4 (Juluo), 11 (Stella)
const userIds = [4, 11];

const result = db.prepare(`
  UPDATE bot_state
  SET enabled = 1
  WHERE user_id IN (${userIds.join(",")})
`).run();

console.log(`✅ Updated ${result.changes} bot_state rows to enabled = 1 for users Juluo (ID 4) & Stella (ID 11).`);

const rows = db.prepare(`
  SELECT user_id, preset, enabled, config
  FROM bot_state
  WHERE user_id IN (${userIds.join(",")})
`).all();

console.table(rows.map(r => ({
  userId: r.user_id,
  preset: r.preset,
  enabled: r.enabled === 1 ? "ENABLED (1)" : "DISABLED (0)",
  mode: JSON.parse(r.config).mode,
  stakeUsd: JSON.parse(r.config).stakeUsd
})));

db.close();
