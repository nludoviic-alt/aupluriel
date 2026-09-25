// Periodic auto-backtest: every 6h, replays the live pipeline across the
// server bot's (locked, identical-for-everyone) strategy config and caches
// a favorable/unfavorable verdict. Every 15min, that cached verdict is used
// to start/stop the demo-mode bot of each user who opted in via the
// "Backtest automatique" setting — never touches a "live" mode bot.
import { getDb } from "./db.server";
import { backtestLiquidityReversalServer, backtestMultiTfServer } from "./backtest.server";
import { DEFAULT_CONFIG } from "./signal-core";
import { LIQUIDITY_PRESET } from "./autotrader";
import { mapWithConcurrency } from "./utils";
import { hasOpenPositions, isBotRunning, loadBotConfig, startBotForUser, stopBotForUser } from "./bot-engine.server";

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

function loadLiquidityVerdict(): AutoBacktestVerdict | null {
  const row = getDb()
    .prepare("SELECT favorable, win_rate, break_even_win_rate, checked_at FROM auto_liquidity_backtest_state WHERE id = 1")
    .get() as { favorable: number; win_rate: number; break_even_win_rate: number; checked_at: number } | undefined;
  if (!row) return null;
  return { favorable: !!row.favorable, winRate: row.win_rate, breakEvenWinRate: row.break_even_win_rate, checkedAt: row.checked_at * 1000 };
}

function saveLiquidityVerdict(v: Omit<AutoBacktestVerdict, "checkedAt">) {
  getDb().prepare(`
    INSERT INTO auto_liquidity_backtest_state (id, favorable, win_rate, break_even_win_rate, checked_at)
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
    const previous = loadVerdict();
    const results = await mapWithConcurrency(DEFAULT_CONFIG.symbols, 3, (symbol) =>
      backtestMultiTfServer(symbol, {
        minConfidence: DEFAULT_CONFIG.minConfidence,
        minTfAgreement: DEFAULT_CONFIG.minTfAgreement,
        durationMinutes: DEFAULT_CONFIG.durationMinutes,
        testCandles: BACKTEST_CANDLES,
        veto4h: DEFAULT_CONFIG.veto4h,
        vetoDaily: DEFAULT_CONFIG.vetoDaily,
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

    // The single most useful alert in this whole system: tell the admin the
    // moment the edge actually turns real, instead of them polling the admin
    // page hoping to catch it. Only fires on an actual flip, not every 6h tick.
    if (previous && previous.favorable !== favorable) {
      void notifyVerdictChange(favorable, winRate, breakEvenWinRate);
    }
  } catch (e) {
    console.error("[auto-backtest] recompute échoué:", (e as Error).message);
  }
}

/** Dedicated replay for the experimental XAU/USD + Nasdaq reversal engine. */
async function recomputeLiquidityVerdict(): Promise<void> {
  try {
    const symbols = LIQUIDITY_PRESET.symbols ?? [];
    const results = await mapWithConcurrency(symbols, 2, (symbol) =>
      backtestLiquidityReversalServer(symbol, { durationMinutes: 15, testCandles: BACKTEST_CANDLES * 2 }).catch(() => null),
    );
    const usable = results.filter((r): r is NonNullable<typeof r> => r !== null);
    const totalTrades = usable.reduce((sum, result) => sum + result.trades, 0);
    const totalWins = usable.reduce((sum, result) => sum + result.wins, 0);
    const winRate = totalTrades ? totalWins / totalTrades : 0;
    const breakEvenWinRate = usable[0]?.breakEvenWinRate ?? 0.541;
    // This is an experiment: no verdict on a thin sample, and no automatic
    // trading unless the measured edge is above the binary payout threshold.
    const favorable = totalTrades >= 20 && winRate >= breakEvenWinRate;
    saveLiquidityVerdict({ favorable, winRate, breakEvenWinRate });
    console.log(`[auto-backtest] liquidity verdict: ${favorable ? "FAVORABLE" : "défavorable"} — ${(winRate * 100).toFixed(1)}%, ${totalTrades} trades`);
  } catch (e) {
    console.error("[auto-backtest] liquidity recompute échoué:", (e as Error).message);
  }
}

async function notifyVerdictChange(favorable: boolean, winRate: number, breakEvenWinRate: number): Promise<void> {
  try {
    const admins = getDb().prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: number }[];
    if (!admins.length) return;
    const { sendPushToUser } = await import("./push.server");
    const payload = {
      title: favorable ? "✅ Backtest devenu favorable" : "🔴 Backtest redevenu défavorable",
      body: `${(winRate * 100).toFixed(1)}% de réussite mesurée (seuil de rentabilité ${(breakEvenWinRate * 100).toFixed(1)}%).`,
      url: "/admin",
    };
    await Promise.allSettled(admins.map((a) => sendPushToUser(a.id, payload)));
  } catch (e) {
    console.error("[auto-backtest] Notification de changement de verdict échouée:", (e as Error).message);
  }
}

/** Starts/stops each opted-in user's demo bot according to the cached verdict. */
async function sweepUsers(verdict: AutoBacktestVerdict): Promise<void> {
  const rows = getDb()
    .prepare("SELECT us.user_id FROM user_settings us JOIN users u ON u.id = us.user_id WHERE us.auto_backtest_enabled = 1 AND us.deriv_token IS NOT NULL AND u.status = 'approved'")
    .all() as { user_id: number }[];

  // This whole subsystem replays and gates DEFAULT_CONFIG specifically (the
  // "Multi" preset) — Boom/Crash have their own walk-forward-validated
  // parameters and aren't evaluated by this backtest at all.
  const PRESET = "default" as const;

  for (const { user_id } of rows) {
    try {
      const existing = loadBotConfig(user_id, PRESET);
      const isLive = existing?.mode === "live";
      const running = isBotRunning(user_id, PRESET);

      if (verdict.favorable && !running) {
        // Live is never auto-started — a live start moves real money and
        // stays a manual, confirmed action. Auto-backtest only ever resumes
        // demo; a live bot the user stopped (or that this sweep stopped
        // below) waits for them to restart it themselves.
        if (isLive) continue;
        const config = { ...DEFAULT_CONFIG, stakeUsd: existing?.stakeUsd ?? DEFAULT_CONFIG.stakeUsd, mode: "demo" as const };
        await startBotForUser(user_id, PRESET, config);
        console.log(`[auto-backtest] bot démarré pour user ${user_id} (verdict favorable)`);
      } else if (!verdict.favorable && running) {
        // stop() tears down every open position's live tracking (P&L updates,
        // the maxHoldMinutes force-close) with nothing left to resume it —
        // wait for them to close naturally instead of orphaning them. Next
        // sweep (15min) re-checks; the bot won't open anything new in the
        // meantime since the verdict is already unfavorable.
        if (hasOpenPositions(user_id, PRESET)) {
          console.log(`[auto-backtest] user ${user_id} : verdict défavorable mais positions encore ouvertes — arrêt reporté`);
          continue;
        }
        // Same circuit-breaker extended to live: an edge that isn't there in
        // demo isn't there in live either, and real money shouldn't keep
        // trading on it. Only the stop side applies here — restart is always
        // manual (see the isLive skip above).
        stopBotForUser(user_id, PRESET, isLive
          ? "Verdict de backtest automatique défavorable (live)"
          : "Verdict de backtest automatique défavorable");
        console.log(`[auto-backtest] bot arrêté pour user ${user_id} (verdict défavorable${isLive ? ", live" : ""})`);
      }
    } catch (e) {
      console.error(`[auto-backtest] sweep échoué pour user ${user_id}:`, (e as Error).message);
    }
  }
}

/** The experimental engine is opt-in twice: global auto-backtest enabled AND
 * a saved liquidity preset config for that user. It is always demo-only. */
async function sweepLiquidityUsers(verdict: AutoBacktestVerdict): Promise<void> {
  const rows = getDb()
    .prepare("SELECT us.user_id FROM user_settings us JOIN users u ON u.id = us.user_id WHERE us.auto_backtest_enabled = 1 AND us.deriv_token IS NOT NULL AND u.status = 'approved'")
    .all() as { user_id: number }[];

  for (const { user_id } of rows) {
    try {
      const saved = loadBotConfig(user_id, "liquidity");
      if (!saved) continue;
      const running = isBotRunning(user_id, "liquidity");
      if (verdict.favorable && !running) {
        await startBotForUser(user_id, "liquidity", { ...LIQUIDITY_PRESET, ...saved, mode: "demo" } as Parameters<typeof startBotForUser>[2]);
        console.log(`[auto-backtest] liquidity démo démarré pour user ${user_id} (verdict favorable)`);
      } else if (!verdict.favorable && running) {
        if (hasOpenPositions(user_id, "liquidity")) continue;
        stopBotForUser(user_id, "liquidity", "Verdict de backtest Reversal liquidité défavorable");
        console.log(`[auto-backtest] liquidity arrêté pour user ${user_id} (verdict défavorable)`);
      }
    } catch (e) {
      console.error(`[auto-backtest] liquidity sweep échoué pour user ${user_id}:`, (e as Error).message);
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

  let liquidityVerdict = loadLiquidityVerdict();
  if (!liquidityVerdict || Date.now() - liquidityVerdict.checkedAt >= BACKTEST_INTERVAL_MS) {
    await recomputeLiquidityVerdict();
    liquidityVerdict = loadLiquidityVerdict();
  }
  if (liquidityVerdict) await sweepLiquidityUsers(liquidityVerdict);
}

export function startAutoBacktestScheduler(): void {
  // First tick shortly after boot (candle fetches are network calls — no rush),
  // then every SWEEP_INTERVAL_MS; the 6h backtest recompute is gated inside tick().
  setTimeout(() => { tick().catch((e) => console.error("[auto-backtest] tick échoué:", e)); }, 15_000);
  setInterval(() => { tick().catch((e) => console.error("[auto-backtest] tick échoué:", e)); }, SWEEP_INTERVAL_MS);
}
