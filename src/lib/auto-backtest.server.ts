// Periodic auto-backtest: every 6h, replays the live pipeline across the
// server bot's (locked, identical-for-everyone) strategy config and caches
// a favorable/unfavorable verdict. Every 15min, that cached verdict is used
// to start/stop the demo-mode bot of each user who opted in via the
// "Backtest automatique" setting — never touches a "live" mode bot.
import { getDb } from "./db.server";
import { backtestMultiTfServer } from "./backtest.server";
import { DEFAULT_CONFIG } from "./signal-core";
import { mapWithConcurrency } from "./utils";
import { isBotRunning, loadBotConfig, startBotForUser, stopBotForUser } from "./bot-engine.server";

const BACKTEST_INTERVAL_MS = 6 * 60 * 60 * 1000; // recompute the global verdict every 6h
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;         // apply the cached verdict to opted-in users every 15min
const BACKTEST_CANDLES = 150;

interface AutoBacktestVerdict {
  favorable: boolean;
  winRate: number;
  breakEvenWinRate: number;
  checkedAt: number;
}

function loadVerdict(): AutoBacktestVerdict | null {
  const row = getDb()
    .prepare("SELECT favorable, win_rate, break_even_win_rate, checked_at FROM auto_backtest_state WHERE id = 1")
    .get() as { favorable: number; win_rate: number; break_even_win_rate: number; checked_at: number } | undefined;
  if (!row) return null;
  return {
    favorable: !!row.favorable,
    winRate: row.win_rate,
    breakEvenWinRate: row.break_even_win_rate,
    checkedAt: row.checked_at * 1000, // stored as unixepoch seconds
  };
}

function saveVerdict(v: Omit<AutoBacktestVerdict, "checkedAt">) {
  getDb().prepare(`
    INSERT INTO auto_backtest_state (id, favorable, win_rate, break_even_win_rate, checked_at)
    VALUES (1, ?, ?, ?, unixepoch())
    ON CONFLICT (id) DO UPDATE SET
      favorable = excluded.favorable,
      win_rate = excluded.win_rate,
      break_even_win_rate = excluded.break_even_win_rate,
      checked_at = excluded.checked_at
  `).run(v.favorable ? 1 : 0, v.winRate, v.breakEvenWinRate);
}

/** Replays the server bot's locked strategy across all its symbols and caches the go/no-go verdict. */
async function recomputeVerdict(): Promise<void> {
  try {
    const results = await mapWithConcurrency(DEFAULT_CONFIG.symbols, 3, (symbol) =>
      backtestMultiTfServer(symbol, {
        minConfidence: DEFAULT_CONFIG.minConfidence,
        minTfAgreement: DEFAULT_CONFIG.minTfAgreement,
        durationMinutes: DEFAULT_CONFIG.durationMinutes,
        testCandles: BACKTEST_CANDLES,
        veto4h: DEFAULT_CONFIG.veto4h,
      }).catch(() => null),
    );
    const usable = results.filter((r): r is NonNullable<typeof r> => r !== null);
    const totalTrades = usable.reduce((s, r) => s + r.trades, 0);
    const totalWins = usable.reduce((s, r) => s + r.wins, 0);
    const winRate = totalTrades > 0 ? totalWins / totalTrades : 0;
    const breakEvenWinRate = usable[0]?.breakEvenWinRate ?? 0.541;
    // Require a minimum sample before trusting the edge either way — too few
    // trades in the window shouldn't flip real bots on/off on noise.
    const favorable = totalTrades >= 20 && winRate >= breakEvenWinRate;
    saveVerdict({ favorable, winRate, breakEvenWinRate });
    console.log(
      `[auto-backtest] verdict: ${favorable ? "FAVORABLE" : "défavorable"} — ` +
      `${(winRate * 100).toFixed(1)}% win rate (seuil ${(breakEvenWinRate * 100).toFixed(1)}%), ${totalTrades} trades`,
    );
  } catch (e) {
    console.error("[auto-backtest] recompute échoué:", (e as Error).message);
  }
}

/** Starts/stops each opted-in user's demo bot according to the cached verdict. */
async function sweepUsers(verdict: AutoBacktestVerdict): Promise<void> {
  const rows = getDb()
    .prepare("SELECT user_id FROM user_settings WHERE auto_backtest_enabled = 1 AND deriv_token IS NOT NULL")
    .all() as { user_id: number }[];

  for (const { user_id } of rows) {
    try {
      const existing = loadBotConfig(user_id);
      // Never touch a live-mode bot — auto-backtest only ever manages demo.
      if (existing?.mode === "live") continue;

      const running = isBotRunning(user_id);
      if (verdict.favorable && !running) {
        const config = { ...DEFAULT_CONFIG, stakeUsd: existing?.stakeUsd ?? DEFAULT_CONFIG.stakeUsd, mode: "demo" as const };
        await startBotForUser(user_id, config);
        console.log(`[auto-backtest] bot démarré pour user ${user_id} (verdict favorable)`);
      } else if (!verdict.favorable && running) {
        stopBotForUser(user_id, "Verdict de backtest automatique défavorable");
        console.log(`[auto-backtest] bot arrêté pour user ${user_id} (verdict défavorable)`);
      }
    } catch (e) {
      console.error(`[auto-backtest] sweep échoué pour user ${user_id}:`, (e as Error).message);
    }
  }
}

async function tick(): Promise<void> {
  let verdict = loadVerdict();
  if (!verdict || Date.now() - verdict.checkedAt >= BACKTEST_INTERVAL_MS) {
    await recomputeVerdict();
    verdict = loadVerdict();
  }
  if (verdict) await sweepUsers(verdict);
}

export function startAutoBacktestScheduler(): void {
  // First tick shortly after boot (candle fetches are network calls — no rush),
  // then every SWEEP_INTERVAL_MS; the 6h backtest recompute is gated inside tick().
  setTimeout(() => { tick().catch((e) => console.error("[auto-backtest] tick échoué:", e)); }, 15_000);
  setInterval(() => { tick().catch((e) => console.error("[auto-backtest] tick échoué:", e)); }, SWEEP_INTERVAL_MS);
}
