// One-off: move the confluence arm of the dual-engine trial (users 2 & 4,
// preset `default`) onto the scalping engine — same 1HZ75V demo config as
// user 11's scalping arm. Use if the confluence engine keeps producing 0
// setups on 1HZ75V. Demo only. Requires a `sudo systemctl restart lio23`
// afterwards for the running engines to pick it up.
//
// Run ON the VPS:
//   DB_PATH=/home/ubuntu/data/lio23.db npx --yes tsx@4 scripts/switch-confluence-to-scalping.ts
//   sudo systemctl restart lio23

import { getDb } from "../src/lib/db.server";
import {
  updateConfigForUser,
  loadBotConfig,
  type AutoTraderConfig,
  type Preset,
} from "../src/lib/bot-engine.server";

const USERS = [2, 4];

const SCALPING_OVERRIDES: Partial<AutoTraderConfig> = {
  symbols: ["1HZ75V"],
  excludedSymbols: [],
  symbolMode: "watchlist",
  instrumentType: "multiplier",
  multiplierLevel: 100,
  symbolInstrumentOverrides: {},
  mode: "demo",
  stakeMode: "fixed",
  stakeUsd: 20,
  stakePercent: 1,
  maxDailyLossUsd: 40,
  maxDailyProfitUsd: 200,
  maxTradesPerDay: 40,
  maxConsecutiveLosses: 5,
  cooldownMinutes: 10,
  maxSimultaneousTrades: 1,
  maxOpenPositions: 2,
  maxHoldMinutes: 60,
  newsFilter: false,
  hourlyEdgeFilter: false,
  veto4h: "off",
  vetoDaily: "off",
  blockCorrelated: false,
  premiumOnly: false,
  progressiveStakeReduction: false,
  adaptiveStake: false,
  tradingSessions: ["asia", "london", "newyork"],
  autoRollbackEnabled: true,
  stopLossPctOfStake: 50,
  takeProfitPctOfStake: 100,
  maxVolatilityPct: 100,
  minConfidence: 68,
  maxConfidence: 100,
  minTfAgreement: 2,
  adxFilterMode: "off",
  atrStopMode: false,
  riskRewardRatio: 1.5,
  durationMinutes: 5,
};

function main() {
  for (const u of USERS) {
    const cur = loadBotConfig(u, "scalping" as Preset);
    if (!cur) {
      console.error(`user ${u}: no scalping bot_state row — skipped`);
      continue;
    }
    updateConfigForUser(u, "scalping" as Preset, { ...cur, ...SCALPING_OVERRIDES } as AutoTraderConfig);
    getDb()
      .prepare(
        `UPDATE bot_state SET enabled=1, config=json_set(config,'$.enabled',json('true')), updated_at=unixepoch() WHERE user_id=? AND preset='scalping'`,
      )
      .run(u);
    getDb()
      .prepare(
        `UPDATE bot_state SET enabled=0, config=json_set(config,'$.enabled',json('false')), updated_at=unixepoch() WHERE user_id=? AND preset='default'`,
      )
      .run(u);
    console.log(`user ${u}: default -> DISABLED, scalping -> ENABLED on 1HZ75V`);
  }

  console.log("\nenabled bots now:");
  console.table(
    getDb()
      .prepare(
        `SELECT user_id,preset,enabled,json_extract(config,'$.symbols') sym FROM bot_state WHERE enabled=1 ORDER BY user_id,preset`,
      )
      .all(),
  );
  console.log("\nNext: sudo systemctl restart lio23");
}

main();
