// One-off: restrict the Auto-Trader preset strip to the presets actually in
// use during the dual-engine trial, for the three trial accounts.
// Display-only — never touches any engine or what the server trades.
// Reversible: setVisiblePresets(userId, [...ACTIVE_PRESETS]) or clear the row.
//
// Run ON the VPS:
//   DB_PATH=/home/ubuntu/data/lio23.db npx --yes tsx@4 scripts/set-visible-presets-trial.ts

import { setVisiblePresets, getVisiblePresets } from "../src/lib/bot-engine.server";

const USERS = [2, 4, 11];
const VISIBLE = ["default", "scalping"];

for (const u of USERS) {
  const before = getVisiblePresets(u);
  const after = setVisiblePresets(u, VISIBLE);
  console.log(`user ${u}: ${before.length} -> [${after.join(", ")}]`);
}
