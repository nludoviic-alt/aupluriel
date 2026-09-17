import Database from "better-sqlite3";
import { resolve } from "path";

const dbPath = process.env.DB_PATH || resolve("lio23.db");
console.log(`Connecting to database at ${dbPath}...`);

const db = new Database(dbPath);

// Juluo (ID 4): Disable boom, keep crash, default, scalping, vol75
db.prepare(`
  UPDATE bot_state
  SET enabled = CASE 
    WHEN preset IN ('crash', 'default', 'scalping', 'vol75') THEN 1
    ELSE 0
  END
  WHERE user_id = 4
`).run();

// Stella (ID 11): Disable boom & scalping, keep crash, default, vol75
db.prepare(`
  UPDATE bot_state
  SET enabled = CASE 
    WHEN preset IN ('crash', 'default', 'vol75') THEN 1
    ELSE 0
  END
  WHERE user_id = 11
`).run();

console.log("✅ Optimizations applied for Juluo (ID 4) and Stella (ID 11).");

const rows = db.prepare(`
  SELECT u.username, b.preset, b.enabled
  FROM bot_state b
  JOIN users u ON u.id = b.user_id
  WHERE b.user_id IN (4, 11) AND b.enabled = 1
  ORDER BY u.id, b.preset
`).all();

console.table(rows);

db.close();
