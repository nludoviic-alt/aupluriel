#!/usr/bin/env node
// Checks every saved bot_state config for a symbol present in BOTH `symbols`
// and `excludedSymbols` at once — that combination silently drops the
// symbol from every scan (bot-engine.server.ts applies `excludedSymbols` to
// the watchlist too, not just all-markets mode, despite what an earlier
// version of the comment on that field implied). Found in production
// 2026-08-02: re-adding BOOM900 to `symbols` after an earlier exclusion left
// it in `excludedSymbols` too, so it silently never traded even though the
// UI showed it as part of the active watchlist. Read-only.
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = args.find((arg) => !arg.startsWith("--"));
if (!dbPath) {
  console.error("Usage: check-symbol-overlap.mjs DB_PATH");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const rows = db.prepare(`
  SELECT bs.user_id, bs.preset, bs.enabled, bs.config, u.username
  FROM bot_state bs JOIN users u ON u.id = bs.user_id
`).all();

let anyOverlap = false;
for (const row of rows) {
  let config;
  try { config = JSON.parse(row.config); } catch { continue; }
  const symbols = config.symbols ?? [];
  const excluded = new Set(config.excludedSymbols ?? []);
  const overlap = symbols.filter((s) => excluded.has(s));
  if (overlap.length > 0) {
    anyOverlap = true;
    console.log(`✗ ${row.username} / ${row.preset} (${row.enabled ? "actif" : "arrêté"}): ${overlap.join(", ")} présent dans symbols ET excludedSymbols — jamais réellement tradé malgré la config affichée.`);
  }
}

if (!anyOverlap) console.log("✓ Aucun chevauchement symbols/excludedSymbols trouvé.");
db.close();
process.exit(anyOverlap ? 1 : 0);
