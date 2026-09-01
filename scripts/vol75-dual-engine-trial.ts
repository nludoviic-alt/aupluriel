// ─────────────────────────────────────────────────────────────────────────────
// One-off, explicit config change — "vol75 dual-engine trial" (demo only).
//
// WHY: the `vol75` preset (VOL75_1S_TREND_PULLBACK engine) has a real PF ~0.65
// on the last 50 trades of every demo account running it and is held in
// supervised half-stake / shadow by the risk manager — near-zero live volume.
// A walk-forward tournament (strategy-tournament skill, 2026-09-01) on
// 1HZ75V + CRASH500 showed two engines clearly ahead, out-of-sample:
//   confluence (analyzeSymbolCore)        +$86.70 / 249 trades / 69.5% WR
//   scalping structural (generateScalpingSignal) +$71.93 / 113 trades / gap ~0
//
// WHAT THIS DOES (3 demo accounts: users 2, 4, 11):
//   - user 2, 4  -> enable `default` preset on 1HZ75V  (routes to the
//                   confluence engine via the bot-engine else-branch)
//   - user 11    -> enable `scalping` preset on 1HZ75V (structural scalper)
//   - disable `vol75` and `crash500` for all three so the trial is clean
//   Neither `default` nor `scalping` is in LOCKED_PRESET_SYMBOLS, so the
//   1HZ75V watchlist sticks. Stake $20 (< the $25 scaling tier, so no
//   approval gate). Demo mode only — no real funds. autoRollbackEnabled=true
//   so config-rollback-guardian reverts a bleeding side automatically.
//
// Config writes go through updateConfigForUser (logs config_changes +
// ConfigRegistry version). The enabled flip is raw SQL here; the service
// restart that follows re-runs startBotForUser -> setBotStateEnabled, which
// takes the proper activation snapshot.
//
// Run ON the VPS:
//   DB_PATH=/home/ubuntu/data/lio23.db npx --yes tsx@4 scripts/vol75-dual-engine-trial.ts
// then: sudo systemctl restart lio23
// ─────────────────────────────────────────────────────────────────────────────

import { getDb } from "../src/lib/db.server";
import {
  updateConfigForUser,
  loadBotConfig,
  type AutoTraderConfig,
  type Preset,
} from "../src/lib/bot-engine.server";

const CONFLUENCE_USERS = [2, 4];
const SCALPING_USERS = [11];
const DISABLE_PRESETS: Preset[] = ["vol75", "crash500"];

const SHARED: Partial<AutoTraderConfig> = {
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
};

const CONFLUENCE_OVERRIDES: Partial<AutoTraderConfig> = {
  ...SHARED,
  minConfidence: 72,
  maxConfidence: 100,
  minTfAgreement: 2,
  confluenceMode: "weighted",
  adxFilterMode: "penalize",
  adxBlockThreshold: 20,
  atrStopMode: true,
  atrStopMultiple: 1.1,
  riskRewardRatio: 1.8,
  durationMinutes: 15,
};

const SCALPING_OVERRIDES: Partial<AutoTraderConfig> = {
  ...SHARED,
  minConfidence: 68,
  maxConfidence: 100,
  minTfAgreement: 2,
  adxFilterMode: "off",
  atrStopMode: false,
  riskRewardRatio: 1.5,
  durationMinutes: 5,
};

function applyTrial(userId: number, preset: Preset, overrides: Partial<AutoTraderConfig>) {
  const current = loadBotConfig(userId, preset);
  if (!current) {
    console.error(`  user ${userId} / ${preset}: NO bot_state row — skipped`);
    return;
  }
  const next = { ...current, ...overrides } as AutoTraderConfig;
  updateConfigForUser(userId, preset, next);
  getDb()
    .prepare(
      `UPDATE bot_state
         SET enabled = 1,
             config = json_set(config, '$.enabled', json('true')),
             updated_at = unixepoch()
       WHERE user_id = ? AND preset = ?`,
    )
    .run(userId, preset);
  console.log(
    `  user ${userId} / ${preset}: ENABLED on 1HZ75V — conf>=${overrides.minConfidence}, stake $${overrides.stakeUsd}, adx=${overrides.adxFilterMode}`,
  );
}

function disable(userId: number, preset: Preset) {
  const res = getDb()
    .prepare(
      `UPDATE bot_state
         SET enabled = 0,
             config = json_set(config, '$.enabled', json('false')),
             updated_at = unixepoch()
       WHERE user_id = ? AND preset = ?`,
    )
    .run(userId, preset);
  if (res.changes) console.log(`  user ${userId} / ${preset}: disabled`);
}

function main() {
  const allUsers = [...CONFLUENCE_USERS, ...SCALPING_USERS];

  console.log("── disabling vol75 + crash500 ──");
  for (const u of allUsers) for (const p of DISABLE_PRESETS) disable(u, p);

  console.log("── confluence trial (preset: default) ──");
  for (const u of CONFLUENCE_USERS) applyTrial(u, "default", CONFLUENCE_OVERRIDES);

  console.log("── scalping trial (preset: scalping) ──");
  for (const u of SCALPING_USERS) applyTrial(u, "scalping", SCALPING_OVERRIDES);

  console.log("\n── resulting bot_state (enabled rows) ──");
  const rows = getDb()
    .prepare(
      `SELECT user_id, preset, enabled,
              json_extract(config,'$.symbols') AS symbols,
              json_extract(config,'$.mode') AS mode,
              json_extract(config,'$.stakeUsd') AS stake,
              json_extract(config,'$.minConfidence') AS minconf
         FROM bot_state WHERE enabled = 1 ORDER BY user_id, preset`,
    )
    .all();
  console.table(rows);

  console.log("\nNext: sudo systemctl restart lio23");
}

main();
