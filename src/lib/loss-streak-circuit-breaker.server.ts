/**
 * R5 — Persistent circuit breaker for consecutive-loss streaks, per
 * (user_id, strategy). Replaces the old permanent latch in
 * risk-manager.server.ts (still available behind
 * FEATURE_FLAGS.RISK_LOSS_STREAK_CIRCUIT_BREAKER_ENABLED for instant
 * rollback) with a NORMAL -> PAUSED -> RECOVERY state machine that can
 * actually recover on its own.
 *
 * bot_trades stays the factual source of truth for trade outcomes. This
 * module's own table (loss_streak_state) is the source of truth for the
 * breaker's lifecycle — it is reconciled against bot_trades once per
 * process lifetime per (user, strategy), on first read, never on every
 * scan tick (mirrors the ENGINES_KEY globalThis HMR-safe caching pattern
 * used for live engine instances in bot-engine.server.ts).
 *
 * Design rules enforced here (do not relax without an explicit decision):
 *  - Time passing only ever moves PAUSED -> RECOVERY, never PAUSED/RECOVERY
 *    -> NORMAL. Only an actual resolved trade outcome can return to NORMAL
 *    (a RECOVERY win) or escalate (a RECOVERY loss).
 *  - Rejected candidates never touch this state — only recordTradeOutcome,
 *    called on a real won/lost resolution, advances the machine.
 *  - recovery_trades_used increments on the trade's OUTCOME, not on the
 *    gate's approval, so a probe rejected by a later, unrelated filter
 *    (technical/exposure/Deriv validation) never burns the one-shot attempt.
 *  - Reconciliation never invents a "won" trade to force NORMAL.
 */

import { getDb } from "./db.server";
import { AlertingEngine } from "./alerting.server";
import { currentRiskVersion } from "./risk-version.server";

export type LossStreakState = "NORMAL" | "PAUSED" | "RECOVERY";

export interface LossStreakRecord {
  userId: number;
  strategy: string;
  state: LossStreakState;
  lossStreakCount: number;
  pausedAt: number | null;
  resumeAt: number | null;
  recoveryTradesUsed: number;
  lastLossAt: number | null;
  lastWinAt: number | null;
  riskVersion: string | null;
}

export interface LossStreakGateResult {
  allow: boolean;
  reason?: "RISK_LOSS_STREAK";
  explanation?: string;
  /** 1.0 in NORMAL, 0 when rejected, RECOVERY_RISK_MULTIPLIER in RECOVERY. */
  stakeMultiplier: number;
  strategyStatus: "NORMAL" | "PAUSED";
}

// Duplicated from risk-manager.server.ts's RISK_CONFIG.MAX_CONSECUTIVE_LOSSES
// deliberately, rather than imported, to avoid a circular import between
// this module and risk-manager.server.ts (which imports from here). Keep
// these two values in sync if either changes.
const MAX_CONSECUTIVE_LOSSES = 3;

// Configurable pause durations (minutes). Initial values per the approved
// design — not a strategy/technical threshold, purely the breaker's own
// timing knobs.
const PAUSE_AFTER_3_LOSSES_MINUTES = 30;
const PAUSE_AFTER_4_LOSSES_MINUTES = 60;
const RECOVERY_RISK_MULTIPLIER = 0.5;

function computePauseDurationMs(lossStreakCount: number): number {
  const minutes = lossStreakCount >= 4 ? PAUSE_AFTER_4_LOSSES_MINUTES : PAUSE_AFTER_3_LOSSES_MINUTES;
  return minutes * 60_000;
}

// HMR-safe per-process cache of already-reconciled (userId, strategy) pairs,
// same pattern as ENGINES_KEY in bot-engine.server.ts:4193-4196 — avoids
// re-running reconciliation on every signal scan (every ~60s per symbol).
const RECONCILED_KEY = Symbol.for("lio23.loss_streak_reconciled");
const reconciledPairs: Set<string> =
  ((globalThis as Record<symbol, unknown>)[RECONCILED_KEY] as Set<string>) ??
  ((globalThis as Record<symbol, unknown>)[RECONCILED_KEY] = new Set<string>());

function cacheKey(userId: number, strategy: string): string {
  return `${userId}:${strategy}`;
}

interface StoredRow {
  user_id: number;
  strategy: string;
  state: LossStreakState;
  loss_streak_count: number;
  paused_at: number | null;
  resume_at: number | null;
  recovery_trades_used: number;
  last_loss_at: number | null;
  last_win_at: number | null;
  risk_version: string | null;
}

function toRecord(row: StoredRow): LossStreakRecord {
  return {
    userId: row.user_id,
    strategy: row.strategy,
    state: row.state,
    lossStreakCount: row.loss_streak_count,
    pausedAt: row.paused_at,
    resumeAt: row.resume_at,
    recoveryTradesUsed: row.recovery_trades_used,
    lastLossAt: row.last_loss_at,
    lastWinAt: row.last_win_at,
    riskVersion: row.risk_version,
  };
}

function readRow(userId: number, strategy: string): StoredRow | undefined {
  return getDb()
    .prepare(`SELECT * FROM loss_streak_state WHERE user_id = ? AND strategy = ?`)
    .get(userId, strategy) as StoredRow | undefined;
}

function upsert(userId: number, strategy: string, fields: Partial<Omit<StoredRow, "user_id" | "strategy">>): void {
  const existing = readRow(userId, strategy);
  const now = Date.now();
  const merged: Omit<StoredRow, "user_id" | "strategy"> = {
    state: existing?.state ?? "NORMAL",
    loss_streak_count: existing?.loss_streak_count ?? 0,
    paused_at: existing?.paused_at ?? null,
    resume_at: existing?.resume_at ?? null,
    recovery_trades_used: existing?.recovery_trades_used ?? 0,
    last_loss_at: existing?.last_loss_at ?? null,
    last_win_at: existing?.last_win_at ?? null,
    risk_version: existing?.risk_version ?? null,
    ...fields,
  };

  getDb()
    .prepare(`
      INSERT INTO loss_streak_state (
        user_id, strategy, state, loss_streak_count, paused_at, resume_at,
        recovery_trades_used, last_loss_at, last_win_at, risk_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, strategy) DO UPDATE SET
        state = excluded.state,
        loss_streak_count = excluded.loss_streak_count,
        paused_at = excluded.paused_at,
        resume_at = excluded.resume_at,
        recovery_trades_used = excluded.recovery_trades_used,
        last_loss_at = excluded.last_loss_at,
        last_win_at = excluded.last_win_at,
        risk_version = excluded.risk_version,
        updated_at = excluded.updated_at
    `)
    .run(
      userId, strategy, merged.state, merged.loss_streak_count, merged.paused_at, merged.resume_at,
      merged.recovery_trades_used, merged.last_loss_at, merged.last_win_at, merged.risk_version, now,
    );
}

/** Recomputes the real streak from bot_trades — same "leading losses from
 * the most recent closed trade" logic as the original risk-manager.server.ts
 * query it replaces. */
function computeRealStreak(userId: number, strategy: string): {
  streak: number; lastLossAt: number | null; lastWinAt: number | null;
} {
  const recent = getDb()
    .prepare(`
      SELECT status, time FROM bot_trades
      WHERE user_id = ? AND strategy = ? AND status IN ('won', 'lost')
      ORDER BY time DESC LIMIT 5
    `)
    .all(userId, strategy) as { status: "won" | "lost"; time: number }[];

  let streak = 0;
  let lastLossAt: number | null = null;
  let lastWinAt: number | null = null;
  for (const t of recent) {
    if (t.status === "lost") {
      streak++;
      if (lastLossAt === null) lastLossAt = t.time;
    } else {
      if (lastWinAt === null) lastWinAt = t.time;
      break;
    }
  }
  return { streak, lastLossAt, lastWinAt };
}

/** Initializes (or rebuilds) a row directly from a real historical last-loss
 * timestamp — used both for first-ever-seen latched pairs during lazy
 * reconciliation AND for the explicit one-off backfill script. If the
 * computed pause has already elapsed relative to the REAL loss timestamp,
 * seeds directly into RECOVERY rather than PAUSED. */
function initializeFromRealLastLoss(
  userId: number,
  strategy: string,
  lastLossAt: number,
  lossStreakCount: number,
  lastWinAt: number | null,
): void {
  const pauseMs = computePauseDurationMs(lossStreakCount);
  const resumeAt = lastLossAt + pauseMs;
  const state: LossStreakState = Date.now() >= resumeAt ? "RECOVERY" : "PAUSED";
  upsert(userId, strategy, {
    state,
    loss_streak_count: lossStreakCount,
    paused_at: lastLossAt,
    resume_at: resumeAt,
    recovery_trades_used: 0,
    last_loss_at: lastLossAt,
    last_win_at: lastWinAt,
    risk_version: currentRiskVersion(),
  });
}

/** Reconciles stored state against bot_trades ground truth. Called at most
 * once per process per (userId, strategy) — see reconciledPairs cache. */
function reconcileFromTrades(userId: number, strategy: string): void {
  const stored = readRow(userId, strategy);
  const { streak: computedStreak, lastLossAt, lastWinAt } = computeRealStreak(userId, strategy);

  if (!stored) {
    if (computedStreak >= MAX_CONSECUTIVE_LOSSES && lastLossAt !== null) {
      // A pre-existing latch this table has never known about — this is the
      // backfill path for currently-latched strategies, reached
      // automatically the first time a live process touches this pair.
      initializeFromRealLastLoss(userId, strategy, lastLossAt, computedStreak, lastWinAt);
    } else {
      upsert(userId, strategy, {
        state: "NORMAL",
        loss_streak_count: computedStreak,
        last_loss_at: lastLossAt,
        last_win_at: lastWinAt,
        risk_version: currentRiskVersion(),
      });
    }
    return;
  }

  const consistent = stored.loss_streak_count === computedStreak && stored.last_loss_at === lastLossAt;
  if (consistent) return; // trust stored state as-is — preserves paused_at/resume_at/recovery_trades_used

  void AlertingEngine.sendAlert({
    userId,
    type: "LOSS_STREAK_STATE_MISMATCH",
    severity: "WARNING",
    title: `Incohérence loss-streak — ${strategy}`,
    message: `État stocké (streak=${stored.loss_streak_count}, state=${stored.state}) diverge de bot_trades (streak=${computedStreak})`,
    metadata: { strategy, stored, computedStreak, lastLossAt, lastWinAt },
  });

  if (computedStreak >= MAX_CONSECUTIVE_LOSSES && stored.state === "NORMAL" && lastLossAt !== null) {
    // bot_trades shows a live streak the table doesn't know about — rebuild
    // as freshly PAUSED/RECOVERY from the real last-loss timestamp.
    initializeFromRealLastLoss(userId, strategy, lastLossAt, computedStreak, lastWinAt);
    return;
  }

  // Any other mismatch: resync the factual count/timestamps but NEVER clear
  // an active PAUSED/RECOVERY state just because the recomputed count
  // shrank — a shrinking count must not silently end a pause (constraint:
  // time only ever moves PAUSED -> RECOVERY, never -> NORMAL).
  upsert(userId, strategy, {
    loss_streak_count: computedStreak,
    last_loss_at: lastLossAt,
    last_win_at: lastWinAt,
  });
}

function ensureReconciled(userId: number, strategy: string): void {
  const key = cacheKey(userId, strategy);
  if (reconciledPairs.has(key)) return;
  reconcileFromTrades(userId, strategy);
  reconciledPairs.add(key);
}

/** Reads the current breaker state for (userId, strategy), reconciling
 * against bot_trades on first access this process. */
export function getLossStreakState(userId: number, strategy: string): LossStreakRecord {
  ensureReconciled(userId, strategy);
  const row = readRow(userId, strategy);
  if (!row) {
    // Should be unreachable — reconcile always upserts a row — but never
    // block trading on a missing observability row.
    return {
      userId, strategy, state: "NORMAL", lossStreakCount: 0, pausedAt: null,
      resumeAt: null, recoveryTradesUsed: 0, lastLossAt: null, lastWinAt: null, riskVersion: null,
    };
  }
  return toRecord(row);
}

/** Every strategy ever tagged for this (userId, preset) pair in bot_trades —
 * a preset can have more than one strategy, so this can return several
 * entries. Used by the API for per-preset observability. */
export function getLossStreakStatesForPreset(userId: number, preset: string): LossStreakRecord[] {
  const strategies = getDb()
    .prepare(`SELECT DISTINCT strategy FROM bot_trades WHERE user_id = ? AND preset = ? AND strategy IS NOT NULL`)
    .all(userId, preset) as { strategy: string }[];
  return strategies.map((s) => getLossStreakState(userId, s.strategy));
}

/** Called from risk-manager.server.ts's step 3 (loss-streak check). Never
 * mutates loss_streak_count itself — only recordTradeOutcome (a real
 * resolved trade) does that. This function only ever performs the
 * time-driven PAUSED -> RECOVERY transition. */
export function evaluateLossStreakGate(userId: number, strategy: string): LossStreakGateResult {
  const row = getLossStreakState(userId, strategy);

  if (row.state === "NORMAL") {
    return { allow: true, stakeMultiplier: 1.0, strategyStatus: "NORMAL" };
  }

  if (row.state === "PAUSED") {
    if (row.resumeAt !== null && Date.now() >= row.resumeAt) {
      upsert(userId, strategy, { state: "RECOVERY", recovery_trades_used: 0 });
      return { allow: true, stakeMultiplier: RECOVERY_RISK_MULTIPLIER, strategyStatus: "NORMAL" };
    }
    return {
      allow: false,
      reason: "RISK_LOSS_STREAK",
      stakeMultiplier: 0,
      strategyStatus: "PAUSED",
      explanation: `${row.lossStreakCount} pertes consécutives — pause jusqu'à ${row.resumeAt ? new Date(row.resumeAt).toISOString() : "?"}`,
    };
  }

  // RECOVERY
  if (row.recoveryTradesUsed >= 1) {
    return {
      allow: false,
      reason: "RISK_LOSS_STREAK",
      stakeMultiplier: 0,
      strategyStatus: "PAUSED",
      explanation: `Trade de récupération déjà en cours pour ${strategy} — en attente du résultat`,
    };
  }
  return { allow: true, stakeMultiplier: RECOVERY_RISK_MULTIPLIER, strategyStatus: "NORMAL" };
}

/** The only function allowed to advance the state machine on an actual
 * trade result. Called from bot-engine.server.ts's emit() on the
 * pending -> won/lost transition. */
export function recordTradeOutcome(userId: number, strategy: string, outcome: "won" | "lost"): void {
  const row = getLossStreakState(userId, strategy);
  const now = Date.now();

  if (row.state === "NORMAL") {
    if (outcome === "lost") {
      const newCount = row.lossStreakCount + 1;
      if (newCount >= MAX_CONSECUTIVE_LOSSES) {
        upsert(userId, strategy, {
          state: "PAUSED",
          loss_streak_count: newCount,
          paused_at: now,
          resume_at: now + computePauseDurationMs(newCount),
          recovery_trades_used: 0,
          last_loss_at: now,
          risk_version: currentRiskVersion(),
        });
      } else {
        upsert(userId, strategy, { loss_streak_count: newCount, last_loss_at: now });
      }
    } else {
      upsert(userId, strategy, { loss_streak_count: 0, last_win_at: now });
    }
    return;
  }

  if (row.state === "RECOVERY") {
    // This IS the probe trade resolving.
    if (outcome === "won") {
      upsert(userId, strategy, {
        state: "NORMAL", loss_streak_count: 0, recovery_trades_used: 0,
        paused_at: null, resume_at: null, last_win_at: now,
      });
    } else {
      const newCount = row.lossStreakCount + 1; // 4, 5, 6... — recycles the
      // 4-loss pause duration for every count >= 4, per the approved design
      // (no new threshold invented for >=5, no automatic escalation to
      // AUTO_SHADOW here — that stays Performance Drift's decision).
      upsert(userId, strategy, {
        state: "PAUSED",
        loss_streak_count: newCount,
        paused_at: now,
        resume_at: now + computePauseDurationMs(newCount),
        recovery_trades_used: 0,
        last_loss_at: now,
        risk_version: currentRiskVersion(),
      });
    }
    return;
  }

  // state === "PAUSED": evaluateLossStreakGate rejects candidates while
  // PAUSED, so this should be rare — but a trade opened just before the
  // PAUSED transition began could still resolve after it. Count the
  // outcome defensively without forcing a state change (the next
  // evaluateLossStreakGate call still governs the PAUSED -> RECOVERY
  // timing correctly regardless).
  console.warn(`[loss-streak] recordTradeOutcome(${outcome}) for ${userId}/${strategy} while already PAUSED — trade resolved after pause began`);
  if (outcome === "lost") {
    upsert(userId, strategy, { loss_streak_count: row.lossStreakCount + 1, last_loss_at: now });
  } else {
    upsert(userId, strategy, { last_win_at: now });
  }
}

/** One-time explicit backfill for a currently-latched (user, strategy) pair
 * — used by scripts/backfill-loss-streak-state.ts. Functionally identical
 * to what lazy reconciliation does automatically on first touch, but callable
 * ahead of time (and from a script, not a live trading process) so the
 * resulting row can be inspected before any live signal evaluates it. */
export function backfillLatchedStrategy(userId: number, strategy: string): LossStreakRecord {
  reconcileFromTrades(userId, strategy);
  reconciledPairs.add(cacheKey(userId, strategy));
  return getLossStreakState(userId, strategy);
}
