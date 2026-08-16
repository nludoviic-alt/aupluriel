// One-time, explicit backfill for the (user, strategy) pairs currently
// latched permanently by the old RISK_LOSS_STREAK behavior — run this
// BEFORE flipping FEATURE_FLAGS.RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED to
// true in production, so the resulting rows can be inspected before any
// live signal evaluates them.
//
// Read-only against bot_trades (never modifies a trade row); only writes to
// the new loss_streak_state table. Safe to run more than once — it's the
// same reconciliation path the live engine runs lazily on first touch
// anyway (see loss-streak-circuit-breaker.server.ts).
//
// Run with: npx tsx scripts/backfill-loss-streak-state.ts
// Point at a specific DB with: DB_PATH=/path/to/lio23.db npx tsx scripts/backfill-loss-streak-state.ts

import { backfillLatchedStrategy } from "../src/lib/loss-streak-circuit-breaker.server";

const KNOWN_LATCHED_PAIRS: Array<{ label: string; userId: number; strategy: string }> = [
  { label: "Ludovic / CRASH900", userId: 2, strategy: "CRASH_ENGINE" },
  { label: "Juluo / CRASH900", userId: 4, strategy: "CRASH_ENGINE" },
  { label: "Stella / CRASH900", userId: 11, strategy: "CRASH_ENGINE" },
  { label: "Ludovic / VOL75", userId: 2, strategy: "VOL75_1S_TREND_PULLBACK" },
  { label: "Juluo / VOL75", userId: 4, strategy: "VOL75_1S_TREND_PULLBACK" },
];

function main() {
  console.log("==========================================================================");
  console.log("        BACKFILL — R5 Loss Streak Circuit Breaker (read-only vs bot_trades)");
  console.log("==========================================================================");

  const results = KNOWN_LATCHED_PAIRS.map(({ label, userId, strategy }) => {
    try {
      const record = backfillLatchedStrategy(userId, strategy);
      return { label, ...record };
    } catch (e) {
      console.error(`Échec du backfill pour ${label} (user ${userId}, strategy ${strategy}):`, (e as Error).message);
      return { label, userId, strategy, state: "ERROR" as const, error: (e as Error).message };
    }
  });

  console.log(JSON.stringify(results, null, 2));

  const stillPaused = results.filter((r) => r.state === "PAUSED");
  const recovered = results.filter((r) => r.state === "RECOVERY");
  const unexpectedlyNormal = results.filter((r) => r.state === "NORMAL");
  const errored = results.filter((r) => r.state === "ERROR");

  console.log("\n--------------------------------------------------------------------------");
  if (errored.length > 0) {
    console.log(`ERREUR (paire non traitée) : ${errored.length}`);
    errored.forEach((r) => console.log(`  - ${r.label}: ${(r as { error: string }).error}`));
  }
  console.log(`RECOVERY (cooldown historique dépassé, probe prêt) : ${recovered.length}`);
  recovered.forEach((r) => console.log(`  - ${r.label}: streak=${r.lossStreakCount}, resumeAt=${new Date(r.resumeAt!).toISOString()}`));
  console.log(`PAUSED (cooldown pas encore écoulé) : ${stillPaused.length}`);
  stillPaused.forEach((r) => console.log(`  - ${r.label}: streak=${r.lossStreakCount}, resumeAt=${new Date(r.resumeAt!).toISOString()}`));
  if (unexpectedlyNormal.length > 0) {
    console.log(`NORMAL inattendu (bot_trades ne montre plus 3+ pertes consécutives) : ${unexpectedlyNormal.length}`);
    unexpectedlyNormal.forEach((r) => console.log(`  - ${r.label}`));
  }
  console.log("==========================================================================");
}

main();
