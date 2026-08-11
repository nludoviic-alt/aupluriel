// SERVER auto-trader engine — the browser engine's twin, running in the Node
// process so trading continues with the phone locked / app closed. Decision
// logic is the shared signal-core.ts; this file only wires it to the server
// Deriv client (deriv.server.ts) and SQLite instead of WebSocket-in-browser
// and localStorage.
//
// Differences vs the browser engine (documented, deliberate):
// - No custom-strategy overlay (lives in the user's localStorage).
// - Learned indicator weights come from indicator_stats in SQLite — SHARED
//   across all users, so every user's closed trades train the same weights
//   (the browser engine's localStorage learning stays per-user).
// - stakeMode "kelly" is measured off this user's own bot_trades history for
//   the symbol+mode (see computeKellyStakeServer), not the browser's
//   localStorage backtest sample — same formula and 5%-of-balance cap.
// - Trades are persisted to bot_trades; risk pauses to bot_state.paused_until,
//   so a Railway restart resumes exactly where it left off.

import { getDb } from "./db.server";
import { DerivApiError, DerivTradingConnection, effectiveMultiplier, fetchCandlesServer, fetchRecentTicksServer, closePublicSocket } from "./deriv.server";
import { KrakenTradingConnection, isKrakenSymbol, derivToKrakenSymbol, fetchKrakenCandles, KRAKEN_DERIV_SYMBOLS, closeKrakenSocket } from "./kraken.server";
import { BinanceTradingConnection, isBinanceSymbol, derivToBinanceSymbol, fetchBinanceCandles, BINANCE_DERIV_SYMBOLS, closeBinanceSocket } from "./binance.server";
import { OandaTradingConnection, isOandaSymbol, derivToOandaSymbol, fetchOandaCandles, OANDA_DERIV_SYMBOLS, closeOandaSocket } from "./oanda.server";
import { recordComponentOutcomesServer } from "./indicator-weights.server";
import { buildAnalyzeOptsServer } from "./analyze-opts.server";
import type { SignalComponent } from "./indicators";
import { SYMBOLS } from "./deriv";
import { mapWithConcurrency } from "./utils";
import { generateScalpingSignal, MIN_M1_CANDLES } from "./scalping-signal.server";
import { generateLiquidityReversalSignal, MIN_LIQUIDITY_CANDLES } from "./liquidity-reversal-signal.server";
import {
  generateGoldTrendPullbackSignal,
  MIN_GOLD_PULLBACK_H1_CANDLES,
  MIN_GOLD_PULLBACK_M15_CANDLES,
  MIN_GOLD_PULLBACK_M5_CANDLES,
  MIN_GOLD_PULLBACK_M1_CANDLES,
} from "./gold-trend-signal.server";
import { generateGoldSessionBreakoutSignal, MIN_GOLD_SESSION_CANDLES } from "./gold-session-breakout-signal.server";
import { generateSpikeHunterSignal } from "./spike-hunter-signal.server";
import { generateCrash500Signals } from "./crash500-signal.server";
import { generateBoom500Signals } from "./boom500-signal.server";
import { generateVol75Signal } from "./vol75-signal.server";
import {
  DEFAULT_CONFIG,
  analyzeSymbolCore,
  classifyOpportunity,
  computeAdaptiveStake,
  computeAtrStopUsd,
  computeStructuralStopUsd,
  computeKellyFraction,
  computeProgressiveStake,
  computeDynamicMinConfidence,
  countConsecutiveLosses,
  explainOpportunity,
  getMultiplierOverride,
  is24x7Symbol,
  isCorrelatedWithActive,
  isSymbolTradeable,
  isTradingSymbolDisabled,
  isHighRiskWindow,
  isInTradingSession,
  isHourBlocked,
  getInstrumentForSymbol,
  minContractMinutes,
  riskLevelFor,
  symbolRollingStats,
  currentActiveSessions,
  type AutoTraderConfig,
  type ClassifyReasonCode,
  type ScanResult,
  type ScanSymbolResult,
  type SymbolAnalysis,
  type TradeLog,
  type TradingSession,
} from "./signal-core";

// Maps a rejected classifyOpportunity() verdict onto the scan-log vocabulary
// this file already used before the two decision engines were unified — so
// the UI's SCAN_ACTION_META labels/colors don't need to change.
// "bad-stats"/"ok" are unreachable here: the bot never passes a badStats
// argument (no extra SQL in the 60s tick — see the classifyOpportunity call
// below) and "ok" only ever accompanies a "take" decision, handled separately.
const REASON_CODE_ACTION: Record<ClassifyReasonCode, ScanSymbolResult["action"]> = {
  "bad-stats": "no-signal",
  "volatility-abs": "volatility",
  "volatility-ratio": "volatility",
  "no-direction": "no-signal",
  "confidence-low": "low-confidence",
  "confidence-high": "too-confident",
  "agreement-low": "low-agreement",
  "not-premium": "not-premium",
  "ok": "traded",
};

const SCAN_MS = 60_000;
// Durée de pause pour un déclencheur RÉVERSIBLE (perte flottante non réalisée,
// trailing stop sur un pic). 45 min laisse le temps aux positions ouvertes de
// se résoudre — la durée de détention moyenne mesurée sur Boom est de ~20 min —
// puis le bot réévalue. Une perte RÉALISÉE, elle, reste bloquante jusqu'à
// minuit UTC : l'argent est réellement parti, contrairement au flottant.
const REVERSIBLE_PAUSE_MS = 45 * 60_000;
// A qualified signal is evaluated every minute.  Without a per-engine
// cooldown, one unchanged setup would generate a push every minute while the
// user is deciding whether to open it manually.
const OPPORTUNITY_PUSH_COOLDOWN_MS = 5 * 60_000;

// A user can run all four presets simultaneously — each is a fully
// independent engine with its own bot_state row (composite user_id + preset
// key), own config, own risk caps. Nothing shared between them except the
// underlying Deriv account they all trade on. "scalping" (2026-08-02) is
// deliberately allowed to trade a symbol another preset also trades (BOOM500)
// — see the `preset` column on bot_trades for how that stays unambiguous.
export type Preset = "default" | "boom" | "boom900" | "vol75" | "crash" | "crash500" | "scalping" | "liquidity" | "gold" | "crash900" | "boomv2" | "scalpingv2" | "liquidityv2" | "goldv2";
/** Gold strategies may never opt out of the macro-news safety block. */
function isGoldPreset(preset: Preset): boolean {
  return preset === "gold" || preset === "goldv2" || preset === "liquidity" || preset === "liquidityv2";
}

/** Gold engines never inherit a legacy Deriv configuration on restore. */
function lockGoldOanda(config: AutoTraderConfig): AutoTraderConfig {
  return {
    ...config,
    mode: "demo",
    broker: "oanda",
    enableOanda: true,
    enableDeriv: false,
    instrumentType: "multiplier",
    newsFilter: true,
  };
}
function hasOpenGoldExposure(userId: number, except: Preset): boolean {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM bot_trades WHERE user_id = ? AND preset IN ('gold','goldv2','liquidity','liquidityv2') AND preset != ? AND status IN ('open','pending')`).get(userId, except) as { n: number };
  return row.n > 0;
}
function engineKey(userId: number, preset: Preset): string {
  return `${userId}:${preset}`;
}

export const ALL_PRESETS: readonly Preset[] = ["default", "boom", "boom900", "vol75", "crash", "crash500", "scalping", "liquidity", "gold", "crash900", "boomv2", "scalpingv2", "liquidityv2", "goldv2"];
/** The only strategies offered for new scans, Portfolio and Opportunities. */
export const ACTIVE_PRESETS: readonly Preset[] = ["default", "boom", "vol75", "crash", "crash500", "liquidity", "gold", "goldv2"];

// These strategies are intentionally single-market. Persisted configurations
// from before their separation must never be able to merge them back together.
const LOCKED_PRESET_SYMBOLS: Partial<Record<Preset, readonly string[]>> = {
  boom: ["BOOM500"],
  boom900: ["BOOM900"],
  vol75: ["1HZ75V"],
  crash: ["CRASH900"],
  crash500: ["CRASH500"],
  liquidity: ["frxXAUUSD"],
  gold: ["frxXAUUSD"],
  goldv2: ["frxXAUUSD"],
};

function lockPresetSymbols(preset: Preset, config: AutoTraderConfig): AutoTraderConfig {
  const symbols = LOCKED_PRESET_SYMBOLS[preset];
  return symbols ? { ...config, symbolMode: "watchlist", symbols: [...symbols], excludedSymbols: [] } : config;
}

// Display names for user-facing text (push notifications) — kept local rather
// than imported from opportunities.server.ts's own copy of this map, which
// imports FROM this file and would make it circular.
const PRESET_LABEL: Record<Preset, string> = {
  default: "Multi",
  boom: "Boom500",
  boom900: "Boom900 — démo isolée",
  vol75: "Volatility 75 (1s) — démo",
  crash: "Crash900",
  crash500: "Crash500 — démo isolée",
  scalping: "Scalping",
  liquidity: "GOLD LIQUIDITY SWEEP",
  gold: "GOLD TREND PULLBACK",
  crash900: "Crash900 V2",
  boomv2: "Boom V2 — contrôlé",
  scalpingv2: "Scalping V2 — Spike Hunter",
  liquidityv2: "Liquidity V2 — XAU sweep",
  goldv2: "GOLD BREAKOUT",
};

/** How many preset tabs the Auto-Trader shows on MOBILE. Used to cap this at
 * 3 (five tabs squeezed into a phone-width strip was unreadable), but that
 * blocked users from running/viewing every preset on mobile at once — removed
 * the artificial cap (2026-08-03), so it now just tracks the real preset
 * count. Desktop is unaffected and always renders all of them. */
export const MAX_VISIBLE_PRESETS = ACTIVE_PRESETS.length;

/** All 5 official production presets enabled and visible across mobile and desktop. */
export const VISIBLE_PRESETS_DEFAULT: readonly Preset[] = [...ACTIVE_PRESETS];

/**
 * The user's mobile preset whitelist. Purely a DISPLAY filter — it never
 * starts, stops, or hides the *engine*: a hidden preset keeps trading and
 * keeps reporting into /api/bot, admin, and the journal exactly as before.
 * That's why nothing in the scan/execute path reads this.
 *
 * Always returns a valid, deduped list of at most MAX_VISIBLE_PRESETS, even
 * if the stored JSON is corrupt, empty, or references a preset that no longer
 * exists — the tab strip must never end up with zero tabs and no way back.
 */
export function getVisiblePresets(userId: number): Preset[] {
  const row = getDb().prepare("SELECT visible_presets FROM users WHERE id = ?").get(userId) as
    { visible_presets: string | null } | undefined;
  if (!row?.visible_presets) return [...VISIBLE_PRESETS_DEFAULT];
  try {
    const parsed: unknown = JSON.parse(row.visible_presets);
    if (!Array.isArray(parsed)) return [...VISIBLE_PRESETS_DEFAULT];
    const clean = [...new Set(parsed.filter((p): p is Preset => ACTIVE_PRESETS.includes(p as Preset)))];
    return clean.length ? clean.slice(0, MAX_VISIBLE_PRESETS) : [...VISIBLE_PRESETS_DEFAULT];
  } catch {
    return [...VISIBLE_PRESETS_DEFAULT];
  }
}

/** Persists the whitelist. Sanitises the same way getVisiblePresets does, so
 * a bad payload can't lock the tab strip into an unusable state. Returns what
 * was actually stored. */
export function setVisiblePresets(userId: number, presets: readonly string[]): Preset[] {
  const clean = [...new Set(presets.filter((p): p is Preset => ACTIVE_PRESETS.includes(p as Preset)))]
    .slice(0, MAX_VISIBLE_PRESETS);
  const final = clean.length ? clean : [...VISIBLE_PRESETS_DEFAULT];
  getDb().prepare("UPDATE users SET visible_presets = ? WHERE id = ?").run(JSON.stringify(final), userId);
  return final;
}

/** Correlation/active-symbol tracking cares about the underlying bullish/bearish
 * bias, not the contract mechanics — MULTUP is the same bias as CALL. */
function biasOf(direction: TradeLog["direction"]): "CALL" | "PUT" {
  return direction === "MULTDOWN" ? "PUT" : direction === "MULTUP" ? "CALL" : direction;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface BotTradeRow {
  id: string;
  user_id: number;
  time: number;
  symbol: string;
  direction: "CALL" | "PUT" | "MULTUP" | "MULTDOWN";
  stake: number;
  payout: number;
  status: TradeLog["status"];
  profit: number;
  confidence: number;
  tf_agreement: number;
  contract_id: number | null;
  closed_at: number | null;
  note: string | null;
  strategy: string | null;
  entry_price: number | null;
  duration_minutes: number | null;
  expiry: number | null;
  components: string | null;
  multiplier: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  mode: "demo" | "live" | null;
  preset: Preset | null;
}

function parseComponents(json: string | null): SignalComponent[] | undefined {
  if (!json) return undefined;
  try {
    const arr = JSON.parse(json) as SignalComponent[];
    return Array.isArray(arr) && arr.length ? arr : undefined;
  } catch {
    return undefined;
  }
}

export function logFromRow(r: BotTradeRow): TradeLog {
  return {
    id: r.id, time: r.time, symbol: r.symbol, direction: r.direction, stake: r.stake,
    payout: r.payout, status: r.status, profit: r.profit, confidence: r.confidence,
    tfAgreement: r.tf_agreement, contractId: r.contract_id ?? undefined,
    closedAt: r.closed_at ?? undefined, note: r.note ?? undefined, strategy: r.strategy ?? undefined,
    entryPrice: r.entry_price ?? undefined, durationMinutes: r.duration_minutes ?? undefined,
    expiry: r.expiry ?? undefined,
    components: parseComponents(r.components),
    multiplier: r.multiplier ?? undefined, stopLossUsd: r.stop_loss ?? undefined, takeProfitUsd: r.take_profit ?? undefined,
    preset: r.preset ?? undefined,
    mode: r.mode ?? undefined,
  };
}

function upsertTrade(userId: number, preset: Preset, log: TradeLog, mode: "demo" | "live") {
  getDb().prepare(`
    INSERT INTO bot_trades (id, user_id, time, symbol, direction, stake, payout, status, profit, confidence, tf_agreement, contract_id, closed_at, note, strategy, entry_price, duration_minutes, expiry, components, multiplier, stop_loss, take_profit, mode, preset)
    VALUES (@id, @user_id, @time, @symbol, @direction, @stake, @payout, @status, @profit, @confidence, @tf_agreement, @contract_id, @closed_at, @note, @strategy, @entry_price, @duration_minutes, @expiry, @components, @multiplier, @stop_loss, @take_profit, @mode, @preset)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, payout = excluded.payout, profit = excluded.profit,
      contract_id = excluded.contract_id, closed_at = excluded.closed_at, note = excluded.note
  `).run({
    id: log.id, user_id: userId, time: log.time, symbol: log.symbol, direction: log.direction,
    stake: log.stake, payout: log.payout, status: log.status, profit: log.profit,
    confidence: log.confidence, tf_agreement: log.tfAgreement,
    contract_id: log.contractId ?? null, closed_at: log.closedAt ?? null, note: log.note ?? null, strategy: log.strategy ?? null,
    entry_price: log.entryPrice ?? null, duration_minutes: log.durationMinutes ?? null, expiry: log.expiry ?? null,
    components: log.components?.length ? JSON.stringify(log.components) : null,
    multiplier: log.multiplier ?? null, stop_loss: log.stopLossUsd ?? null, take_profit: log.takeProfitUsd ?? null,
    mode, preset,
  });
}

function loadRecentTrades(userId: number, preset: Preset, limit = 50): TradeLog[] {
  const rows = getDb()
    .prepare(`SELECT * FROM bot_trades WHERE user_id = ? AND preset = ? ORDER BY time DESC LIMIT ?`)
    .all(userId, preset, limit) as BotTradeRow[];
  return rows.map(logFromRow);
}

/** Every currently open/pending position for this user AND this preset,
 * regardless of age — unlike loadRecentTrades, not capped to a recent
 * window, so reconcile() can't lose track of a position just because enough
 * newer trades piled up. Scoped by the explicit `preset` column (not symbol
 * inference) so simultaneous engines that share a symbol — Scalping and Boom
 * both trade BOOM500 — never fight over re-tracking each other's positions. */
function loadOpenOrPendingTrades(userId: number, preset: Preset): TradeLog[] {
  const rows = getDb()
    .prepare(`SELECT * FROM bot_trades WHERE user_id = ? AND preset = ? AND status IN ('open', 'pending')`)
    .all(userId, preset) as BotTradeRow[];
  return rows.map(logFromRow);
}

/**
 * Today's P&L and trade count computed over ALL of today's rows in SQL — the
 * in-memory log and the API's recent-trades list are capped windows, so summing
 * them silently drops the day's earlier wins once enough events accumulate
 * (the "my gain disappeared" bug).
 */
/**
 * Floating P&L across currently-open positions — the `profit` column is kept
 * live for open Multiplier positions by the proposal_open_contract stream.
 * Used so the daily-loss cap sees losses as they build, not only once the
 * stop-loss actually realizes them.
 */
function getOpenFloatingPnl(userId: number, preset: Preset): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(profit), 0) AS floating FROM bot_trades WHERE user_id = ? AND preset = ? AND status = 'open'`)
    .get(userId, preset) as { floating: number };
  return row.floating;
}

export function getTodayStats(userId: number, preset: Preset, mode?: "demo" | "live"): {
  pnl: number;
  floatingLoss: number;
  riskPnl: number;
  count: number;
  wins: number;
  losses: number;
  totalWon: number;
  totalLost: number;
} {
  // UTC midnight — must match nextUtcMidnight() below. Using local server
  // midnight here let a resumed bot see stale pre-reset P&L still above the
  // daily cap and immediately re-pause itself (server tz != UTC).
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const row = getDb()
    .prepare(
       `SELECT
         COALESCE(SUM(CASE WHEN status IN ('won','lost') THEN profit ELSE 0 END), 0) AS pnl,
         COALESCE(SUM(CASE WHEN stake > 0 AND status IN ('pending','open','won','lost') THEN 1 ELSE 0 END), 0) AS count,
         COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS wins,
         COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses,
         COALESCE(SUM(CASE WHEN status = 'won' THEN profit ELSE 0 END), 0) AS totalWon,
         COALESCE(SUM(CASE WHEN status = 'lost' THEN profit ELSE 0 END), 0) AS totalLost
       FROM bot_trades WHERE user_id = ? AND preset = ? AND time >= ? AND (? IS NULL OR mode = ? OR mode IS NULL)`,
    )
    .get(userId, preset, start.getTime(), mode ?? null, mode ?? null) as {
      pnl: number;
      count: number;
      wins: number;
      losses: number;
      totalWon: number;
      totalLost: number;
    };
  const floatingLoss = Math.min(0, getOpenFloatingPnl(userId, preset));
  return {
    ...row,
    floatingLoss,
    riskPnl: row.pnl + floatingLoss,
  };
}

/**
 * All-time closed-trade record for this user — surfaced before letting them
 * switch the server bot to live so the "am I ready for real money" decision
 * is informed by an actual number, not a guess. Cross-user by design (shared
 * strategy, shared learning) would be more statistically meaningful, but
 * showing someone else's win rate to justify THEIR real-money risk would be
 * misleading — this stays scoped to the user's own trades.
 */
export function getAllTimeStats(userId: number, preset: Preset, mode?: "demo" | "live"): { trades: number; wins: number; losses: number; winRate: number; pnl: number } {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS wins,
         COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses,
         COALESCE(SUM(CASE WHEN status IN ('won','lost') THEN profit ELSE 0 END), 0) AS pnl
       FROM bot_trades WHERE user_id = ? AND preset = ? AND (? IS NULL OR mode = ? OR mode IS NULL)`,
    )
    .get(userId, preset, mode ?? null, mode ?? null) as { wins: number; losses: number; pnl: number };
  const trades = row.wins + row.losses;
  return { trades, wins: row.wins, losses: row.losses, winRate: trades > 0 ? row.wins / trades : 0, pnl: row.pnl };
}

export function getRecentPerformance(
  userId: number,
  preset: Preset,
  limit = 100,
): { trades: number; pnl: number; expectancy: number; profitFactor: number } {
  const rows = getDb()
    .prepare(
      `SELECT profit FROM bot_trades
       WHERE user_id = ? AND preset = ? AND status IN ('won','lost')
       ORDER BY COALESCE(closed_at, time) DESC LIMIT ?`,
    )
    .all(userId, preset, limit) as { profit: number }[];
  const grossWin = rows.reduce((sum, row) => sum + Math.max(0, row.profit), 0);
  const grossLoss = Math.abs(rows.reduce((sum, row) => sum + Math.min(0, row.profit), 0));
  const pnl = grossWin - grossLoss;
  return {
    trades: rows.length,
    pnl,
    expectancy: rows.length ? pnl / rows.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
  };
}

/**
 * Server-side counterpart to the browser's computeKellyStake (autotrader.ts) —
 * same formula and 5%-of-balance cap, but measured off this user's own closed
 * bot_trades for the symbol+mode instead of a browser-local backtest sample
 * (the server has no access to localStorage). Previously stakeMode "kelly"
 * silently fell back to fixed/percent sizing on the server; this is that gap.
 * Returns null (caller falls back to fixed/percent) below a 20-trade sample.
 */
function computeKellyStakeServer(
  userId: number,
  symbol: string,
  mode: "demo" | "live",
  balance: number,
  kellyFraction: number,
): number | null {
  const rows = getDb()
    .prepare(
      `SELECT status, stake, profit FROM bot_trades
       WHERE user_id = @userId AND symbol = @symbol AND mode = @mode AND status IN ('won','lost')
       ORDER BY time DESC LIMIT 200`,
    )
    .all({ userId, symbol, mode }) as { status: string; stake: number; profit: number }[];
  if (rows.length < 20) return null;

  const wins = rows.filter((r) => r.status === "won");
  const winRate = wins.length / rows.length;
  const avgPayoutRatio = wins.length
    ? wins.reduce((sum, r) => sum + (r.stake > 0 ? r.profit / r.stake : 0), 0) / wins.length
    : 0;

  const kelly = computeKellyFraction(winRate, avgPayoutRatio);
  if (kelly <= 0) return null; // measured edge is flat/negative — don't size up

  const pct = Math.min(kelly * kellyFraction, 0.05);
  return Math.max(1, balance * pct);
}

export function loadBotConfig(userId: number, preset: Preset): AutoTraderConfig | null {
  const row = getDb().prepare("SELECT config FROM bot_state WHERE user_id = ? AND preset = ?").get(userId, preset) as { config: string } | undefined;
  if (!row) return null;
  // La config sauvegardée est reprise INTÉGRALEMENT, avec DEFAULT_CONFIG en
  // simple filet pour les champs absents (config ancienne, ou partielle).
  //
  // Avant, ce chargement marchait par LISTE BLANCHE : chaque champ devait être
  // recopié explicitement, et tout champ oublié retombait silencieusement sur
  // DEFAULT_CONFIG au premier redémarrage. Ça a produit la même régression au
  // moins trois fois (minConfidence/excludedSymbols effacés le 2026-07-27,
  // puis les champs du preset Boom), et le 2026-07-29 en production le bot
  // tradait Boom avec le trailing stop de Default (10% dès $10 de pic au lieu
  // de 20% dès $30) — il s'est mis en pause après ~6 gains et une perte.
  // Une fusion générique supprime cette classe de bug : plus rien à maintenir.
  //
  // Seuls les champs qui engagent de l'ARGENT restent validés explicitement —
  // une valeur corrompue en base ne doit jamais pouvoir agrandir une mise ou
  // faire basculer un compte en réel.
  try {
    const saved = JSON.parse(row.config) as Partial<AutoTraderConfig>;
    const merged: AutoTraderConfig = {
      ...DEFAULT_CONFIG,
      ...saved,
      stakeUsd: preset === "boom900"
        ? Math.min(0.9, Math.max(0.1, Number(saved.stakeUsd) || 0.9))
        : Math.min(50, Math.max(1, Number(saved.stakeUsd) || DEFAULT_CONFIG.stakeUsd)),
      // $200 is an explicitly supported demo risk ceiling for the four-core
      // research basket.  Keeping the old $100 clamp made the saved value and
      // the server's effective protection disagree silently.
      maxDailyLossUsd: Math.min(200, Math.max(1, Number(saved.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd)),
      // "live" seulement si explicitement choisi — jamais de bascule silencieuse.
      mode: saved.mode === "live" ? "live" : "demo",
    };
    // Guard: a legacy save could have symbols encoded as "[frxXAUUSD]".
    // db.server repairs it at startup, while this fallback keeps an engine
    // safe if a malformed row is encountered before that migration runs.
    if (!Array.isArray(merged.symbols)) {
      const rawValue = (saved as { symbols?: unknown }).symbols;
      const rawSymbols = typeof rawValue === "string" ? rawValue.trim() : "";
      merged.symbols = rawSymbols.startsWith("[") && rawSymbols.endsWith("]")
        ? rawSymbols.slice(1, -1).split(",").map((symbol: string) => symbol.trim()).filter(Boolean)
        : DEFAULT_CONFIG.symbols;
    }
    if (!Array.isArray(merged.excludedSymbols)) merged.excludedSymbols = DEFAULT_CONFIG.excludedSymbols;
    return lockPresetSymbols(preset, isGoldPreset(preset) ? lockGoldOanda(merged) : merged);
  } catch {
    const fallback = { ...DEFAULT_CONFIG };
    return lockPresetSymbols(preset, isGoldPreset(preset) ? lockGoldOanda(fallback) : fallback);
  }
}

// ─── Engine ───────────────────────────────────────────────────────────────────

class ServerBotEngine {
  private interval: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private ticking = false;
  private conn: DerivTradingConnection;
  private krakenConn: KrakenTradingConnection | null;
  private binanceConn: BinanceTradingConnection | null;
  private oandaConn: OandaTradingConnection | null;
  private logs: TradeLog[];
  private activeSymbols = new Map<string, "CALL" | "PUT">();
  private symbolCooldowns = new Map<string, number>();
  // Identifies WHICH losing streak a symbol's cooldown was served for (the id
  // of its most recent closed trade at cooldown time). Without this, a
  // symbol that never gets to trade again after its cooldown expires keeps
  // re-reading the SAME stale historical streak forever — maxConsecutiveLosses
  // re-triggers an identical cooldown every time the timer expires, logging a
  // new row each cycle and permanently locking the symbol out (observed live:
  // cryETHUSD stuck re-pausing hourly for 16h+ straight). Once a streak's
  // cooldown has been served, the symbol gets one real attempt to trade
  // again; only a genuinely NEW loss re-arms the cooldown.
  private servedCooldownFor = new Map<string, string>();
  // Same idea as servedCooldownFor but for the PRESET-WIDE circuit breaker
  // below (countConsecutiveLosses(logs) with no symbol filter): identifies
  // which streak the preset's last risk-pause was served for, by the id of
  // the most recent closed trade at pause time. Without this, a preset that
  // stops trading during its own pause re-reads the SAME stale streak on
  // every resume and immediately re-pauses — forever, since no new trade can
  // occur while paused to ever produce a win and clear it. Observed live:
  // Stella/crash cycled "5 pertes consécutives" → 45min pause → resume →
  // re-pause every ~45min for 8.5+ hours (2026-08-07) with zero new trades
  // in between. The per-symbol version of this exact bug was already fixed
  // (see servedCooldownFor above); this preset-wide breaker never got the
  // same fix when it was added after the 2026-08-04 incident.
  private presetServedCooldownFor: string | undefined;
  private contractUnsubs = new Map<number, () => void>();
  private fallbackTimers = new Set<ReturnType<typeof setTimeout>>();
  // Set by stopScanning() when a stop was requested while a position was still
  // open — non-null means "finish tearing down as soon as nothing is open."
  private pendingStopReason: string | null = null;
  private sessionPeakPnl = 0;
  private opportunityPushes = new Map<string, { direction: "CALL" | "PUT"; sentAt: number }>();
  lastScan: ScanResult | null = null;
  lastError: string | null = null;
  private lastActiveSessions: TradingSession[] = [];

  constructor(
    public readonly userId: number,
    public readonly preset: Preset,
    private config: AutoTraderConfig,
    derivToken: string,
    krakenConn: KrakenTradingConnection | null = null,
    binanceConn: BinanceTradingConnection | null = null,
    oandaConn: OandaTradingConnection | null = null,
  ) {
    this.conn = new DerivTradingConnection(derivToken, config.mode === "live" ? "live" : "demo");
    this.krakenConn = krakenConn;
    this.binanceConn = binanceConn;
    this.oandaConn = oandaConn;
    this.logs = loadRecentTrades(userId, preset);
    this.lastActiveSessions = currentActiveSessions();
  }

  // Hot-swaps the config an in-flight engine reads on its next tick — used by
  // the admin's per-user adjustment panel so a suggestion can be applied
  // without stopping/restarting the bot. `mode` is deliberately excluded by
  // the caller: this.conn is bound to demo/live at construction time and
  // wouldn't follow a mode change here.
  updateConfig(newConfig: AutoTraderConfig) {
    this.config = newConfig;
  }

  async getBalances(): Promise<{
    deriv: { balance: number; currency: string } | null;
    kraken: { balance: number; currency: string } | null;
    binance: { balance: number; currency: string } | null;
    oanda: { balance: number; currency: string } | null;
  }> {
    const [deriv, kraken, binance, oanda] = await Promise.all([
      this.conn.getBalance().catch(() => null),
      this.krakenConn?.getBalance().catch(() => null) ?? null,
      this.binanceConn?.getBalance().catch(() => null) ?? null,
      this.oandaConn?.getBalance().catch(() => null) ?? null,
    ]);
    return { deriv, kraken, binance, oanda };
  }

  get pausedUntil(): number {
    const row = getDb().prepare("SELECT paused_until FROM bot_state WHERE user_id = ? AND preset = ?").get(this.userId, this.preset) as { paused_until: number | null } | undefined;
    return row?.paused_until ?? 0;
  }

  private setPausedUntil(ts: number | null) {
    getDb().prepare("UPDATE bot_state SET paused_until = ?, updated_at = unixepoch() WHERE user_id = ? AND preset = ?").run(ts, this.userId, this.preset);
  }

  /**
   * Send a server-side, actionable manual-trading alert only for a signal
   * that passed the same quality and execution filters as an automatic trade.
   * This reaches subscribed devices even when /opportunities is closed.
   */
  private notifyManualOpportunity(symbol: string, direction: "CALL" | "PUT", confidence: number, agreement: number) {
    const now = Date.now();
    const previous = this.opportunityPushes.get(symbol);
    if (previous && previous.direction === direction && now - previous.sentAt < OPPORTUNITY_PUSH_COOLDOWN_MS) return;
    this.opportunityPushes.set(symbol, { direction, sentAt: now });

    void (async () => {
      const { sendPushToUser } = await import("./push.server");
      const title = `⚡ Opportunité ${PRESET_LABEL[this.preset]} — ${symbol}`;
      const body = `${direction} · confiance ${Math.round(confidence)}% · ${agreement} TF alignés. Ouvrir le trade manuel.`;
      const url = `/manual-trader?symbol=${encodeURIComponent(symbol)}&direction=${direction}&preset=${this.preset}&take=1`;
      await sendPushToUser(this.userId, { title, body, url, category: "signal" });
    })().catch((e) => console.error(`[bot] Notification opportunité échouée pour user ${this.userId}:`, (e as Error).message));
  }

  private emit(log: TradeLog) {
    const idx = this.logs.findIndex((l) => l.id === log.id);
    const prevStatus = idx >= 0 ? this.logs[idx].status : null;
    if (idx >= 0) this.logs[idx] = log;
    else this.logs.unshift(log);
    if (this.logs.length > 60) this.logs.length = 60;
    upsertTrade(this.userId, this.preset, log, this.config.mode === "live" ? "live" : "demo");
    this.notify(log, prevStatus);
    this.finalizeIfIdle();
  }

  /** Push each automatic trade opening and resolution, plus risk pauses —
   * fire-and-forget so a push provider hiccup never breaks trade resolution.
   * Risk pauses are exactly the event a locked-phone user most needs to see
   * (Réglages promises "pause risque envoyée même téléphone verrouillé"),
   * but riskPause()'s emit() used to fall straight through this method's
   * won-only check and notify nobody — the pause was only visible if the
   * user happened to have the app open. Each risk-stop log has a unique id
   * (see riskPause), so unlike "won" it needs no prevStatus transition guard
   * — every risk-stop emit is a fresh pause, never a re-emit of the same one. */
  private notify(log: TradeLog, prevStatus: TradeLog["status"] | null) {
    // A trade can be emitted several times while its broker subscription is
    // live. Notify only on the status transition, never for price/P&L ticks.
    if (log.status === "open" && prevStatus !== "open") {
      void (async () => {
        const { sendPushToUser } = await import("./push.server");
        await sendPushToUser(this.userId, {
          title: `🟦 Trade ouvert — ${PRESET_LABEL[this.preset]}`,
          body: `${log.symbol} · ${log.direction} · mise $${log.stake.toFixed(2)} · ${this.config.mode === "live" ? "Réel" : "Démo"}`,
          url: "/autotrader",
          category: "trade",
        });
      })().catch((e) => console.error(`[bot] Notification push échouée pour user ${this.userId}:`, (e as Error).message));
      return;
    }

    if ((log.status === "won" || log.status === "lost") && prevStatus !== log.status) {
      void (async () => {
        const { sendPushToUser } = await import("./push.server");
        const won = log.status === "won";
        await sendPushToUser(this.userId, {
          title: `${won ? "✅" : "🔴"} Trade fermé ${won ? "gagnant" : "perdant"} — ${PRESET_LABEL[this.preset]}`,
          body: `${log.symbol} · ${log.direction} · ${won ? "+" : ""}$${log.profit.toFixed(2)} · ${this.config.mode === "live" ? "Réel" : "Démo"}`,
          url: "/autotrader",
          category: "trade",
        });
      })().catch((e) => console.error(`[bot] Notification push échouée pour user ${this.userId}:`, (e as Error).message));
      return;
    }

    if (log.status === "risk-stop") {
      void (async () => {
        const { sendPushToUser } = await import("./push.server");
        await sendPushToUser(this.userId, {
          title: `⏸ Bot en pause — ${PRESET_LABEL[this.preset]}`,
          body: log.note ?? "Protection de risque déclenchée.",
          url: "/autotrader",
        });
      })().catch((e) => console.error(`[bot] Notification push (pause risque) échouée pour user ${this.userId}:`, (e as Error).message));
    }
  }

  /** Pause courte pour un déclencheur RÉVERSIBLE (perte flottante, trailing
   * stop) : la position peut encore se retourner, et couper la journée entière
   * sur un creux temporaire coûtait très cher — 8 des 10 pauses observées en
   * production entre le 14 et le 29 juillet 2026 étaient déclenchées par du
   * flottant avec $0.00 de perte RÉALISÉE, soit ~133 heures d'arrêt pour des
   * pertes qui n'avaient jamais eu lieu. */
  private nextShortResume(): number {
    return Math.min(Date.now() + REVERSIBLE_PAUSE_MS, this.nextUtcMidnight());
  }

  private riskPause(reasons: string[], untilTs: number) {
    if (this.stopped || Date.now() < this.pausedUntil) return;
    this.setPausedUntil(untilTs);
    this.sessionPeakPnl = 0;
    const resumeLabel = new Date(untilTs).toISOString().slice(11, 16);
    this.emit({
      id: `risk_${Date.now()}`,
      time: Date.now(),
      symbol: "—",
      direction: "CALL",
      stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
      status: "risk-stop",
      note: `${reasons.join(" · ")} — reprise auto à ${resumeLabel} UTC`,
    });
  }

  /** Re-attach contract tracking for trades left open by a previous process. */
  async reconcile() {
    // Query the DB directly, not this.logs (capped at the 50 most recent
    // trades by loadRecentTrades) — a position that ages out of that window
    // once enough newer trades accumulate never gets revisited again here,
    // leaving it "open" with no maxHoldMinutes safety net forever (audit
    // finding: a week-old open Multiplier position, 70 trades later, that
    // reconcile() had stopped seeing entirely).
    const stale = loadOpenOrPendingTrades(this.userId, this.preset).filter((l) => l.contractId);
    if (!stale.length) return;
    const records = await this.conn.getProfitTable(60);
    for (const log of stale) {
      const match = records.find((r) => r.contractId === log.contractId);
      if (match) {
        const won = match.profit > 0;
        this.emit({ ...log, status: won ? "won" : "lost", profit: match.profit, closedAt: Date.now() });
        try { recordComponentOutcomesServer(log.symbol, log.components, won); } catch { /* never break reconcile */ }
      } else if (isOandaSymbol(log.symbol) && this.oandaConn) {
        // OANDA has no Deriv profit-table record. Reattach using the real
        // trade id stored in contract_id, and recover the live unit size for
        // partial/maximum-hold closes.
        try {
          const trade = await this.oandaConn.getTradeInfo(String(log.contractId));
          if (trade.state === "CLOSED") {
            const won = trade.profit > 0;
            this.emit({ ...log, status: won ? "won" : "lost", profit: trade.profit, closedAt: Date.now() });
            try { recordComponentOutcomesServer(log.symbol, log.components, won); } catch { /* never break reconcile */ }
          } else {
            this.trackOandaPosition(log, String(log.contractId), Math.abs(trade.units));
          }
        } catch {
          this.emit({ ...log, status: "error", profit: 0, note: "Trade OANDA introuvable après redémarrage", closedAt: Date.now() });
        }
      } else if (log.direction === "MULTUP" || log.direction === "MULTDOWN") {
        // Multiplier positions don't expire — getProfitTable only lists SOLD
        // contracts, so no match here just means it's still open. Re-subscribe
        // rather than treating the missing expiry as staleness.
        this.trackMultiplierPosition(log);
      } else if (log.expiry && Date.now() < log.expiry + 2 * 60_000) {
        this.trackContract(log); // probably still open — re-subscribe
      } else {
        this.emit({ ...log, status: "error", profit: 0, note: "Contrat introuvable après redémarrage", closedAt: Date.now() });
      }
    }
  }

  private trackContract(openLog: TradeLog) {
    const contractId = openLog.contractId!;
    this.activeSymbols.set(openLog.symbol, biasOf(openLog.direction));
    let resolved = false;

    const resolve = (won: boolean, profit: number) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallback);
      this.fallbackTimers.delete(fallback);
      this.contractUnsubs.get(contractId)?.();
      this.contractUnsubs.delete(contractId);
      this.activeSymbols.delete(openLog.symbol);
      this.emit({ ...openLog, status: won ? "won" : "lost", profit, closedAt: Date.now() });
      // Shared learning: credit/blame this trade's signal components in the
      // cross-user stats so every user's trades train the same weights.
      try { recordComponentOutcomesServer(openLog.symbol, openLog.components, won); } catch { /* never break resolution */ }
    };

    const unsub = this.conn.subscribeContract(contractId, (u) => {
      if (u.status !== "open") resolve(u.status === "won", u.profit);
    });
    this.contractUnsubs.set(contractId, unsub);

    const msLeft = Math.max(30_000, (openLog.expiry ?? Date.now()) - Date.now() + 2 * 60_000);
    const fallback = setTimeout(async () => {
      if (resolved || this.stopped) return;
      const records = await this.conn.getProfitTable(30);
      const match = records.find((r) => r.contractId === contractId);
      if (match) resolve(match.profit > 0, match.profit);
      else {
        resolved = true;
        this.contractUnsubs.get(contractId)?.();
        this.contractUnsubs.delete(contractId);
        this.activeSymbols.delete(openLog.symbol);
        this.emit({ ...openLog, status: "error", profit: 0, note: "Résolution non reçue" });
      }
    }, msLeft);
    this.fallbackTimers.add(fallback);
  }

  /**
   * Multiplier positions have no fixed expiry — they stay open until
   * stop_loss/take_profit triggers or the max-hold timer force-closes them.
   * Unlike trackContract, "open" updates aren't noise to discard: they carry
   * the live floating profit, pushed through so it's visible in DB/UI while
   * the position is still live, not just once it finally resolves.
   */
  private trackMultiplierPosition(openLog: TradeLog) {
    const contractId = openLog.contractId!;
    this.activeSymbols.set(openLog.symbol, biasOf(openLog.direction));
    let resolved = false;
    let partialTaken = false;

    const finalize = (profit: number) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(maxHoldTimer);
      this.fallbackTimers.delete(maxHoldTimer);
      this.contractUnsubs.get(contractId)?.();
      this.contractUnsubs.delete(contractId);
      this.activeSymbols.delete(openLog.symbol);
      this.emit({ ...openLog, status: profit > 0 ? "won" : "lost", profit, closedAt: Date.now() });
      try { recordComponentOutcomesServer(openLog.symbol, openLog.components, profit > 0); } catch { /* never break resolution */ }
    };

    const unsub = this.conn.subscribeContract(contractId, (u) => {
      if (u.status === "open") {
        this.emit({ ...openLog, status: "open", profit: u.profit });

        // ── Partial profit taking ──
        // When floating profit reaches 50% of the take-profit target, we
        // could sell part of the position. Deriv's multiplier API doesn't
        // support partial sells (sellContract is all-or-nothing), so instead
        // we track the milestone for analytics. The existing TP will still
        // capture the full move, and the maxHoldTimer provides downside protection.
        if (!partialTaken && this.config.partialTakeProfitPct > 0 && openLog.takeProfitUsd) {
          const partialTrigger = openLog.takeProfitUsd * (this.config.partialTakeProfitPct / 100);
          if (u.profit >= partialTrigger) {
            partialTaken = true;
            // Log the milestone — the position continues to run toward full TP.
            // On Binance/Kraken/OANDA, partial closes are possible and handled
            // in their respective tracking methods.
          }
        }
        return;
      }
      finalize(u.profit);
    });
    this.contractUnsubs.set(contractId, unsub);

    // Safety net: force-close after maxHoldMinutes even if neither stop_loss
    // nor take_profit triggered — avoids swap-fee accumulation on positions
    // held past the daily cutoff, and stops a stuck position from holding a
    // correlation slot open indefinitely. Measured from the position's
    // ORIGINAL open time (openLog.time), not from whenever this function
    // runs: re-tracking on reconcile() (server restart, or the auto-backtest
    // gate stopping and later restarting the bot — stop() tears down every
    // subscription and timer) used to reset a fresh full-duration timer
    // every time, so a position surviving a restart could sit open well past
    // maxHoldMinutes with the safety net never actually firing. A position
    // already overdue by the time it's reconciled force-closes immediately.
    const maxHoldMs = Math.max(60_000, this.config.maxHoldMinutes * 60_000);
    const remainingMs = Math.max(0, maxHoldMs - (Date.now() - openLog.time));
    const maxHoldTimer = setTimeout(async () => {
      if (resolved || this.stopped) return;
      try {
        await this.conn.sellContract(contractId);
        // The subscription's next "is_sold" update calls finalize with the real profit.
      } catch {
        const records = await this.conn.getProfitTable(30);
        const match = records.find((r) => r.contractId === contractId);
        if (match) finalize(match.profit);
      }
    }, remainingMs);
    this.fallbackTimers.add(maxHoldTimer);
  }

  /**
   * Track a Kraken spot position — poll the order status periodically and
   * resolve the trade when the stop-loss/take-profit fills or the max-hold
   * timer fires. Kraken doesn't have a contract subscription like Deriv, so
   * we poll the order status every 30s instead.
   */
  private trackKrakenPosition(openLog: TradeLog, orderId: string, volume: number) {
    this.activeSymbols.set(openLog.symbol, biasOf(openLog.direction));
    let resolved = false;

    const finalize = (won: boolean, profit: number) => {
      if (resolved) return;
      resolved = true;
      clearInterval(pollTimer);
      this.fallbackTimers.delete(pollTimer);
      clearTimeout(maxHoldTimer);
      this.fallbackTimers.delete(maxHoldTimer);
      this.activeSymbols.delete(openLog.symbol);
      this.emit({ ...openLog, status: won ? "won" : "lost", profit, closedAt: Date.now() });
      try { recordComponentOutcomesServer(openLog.symbol, openLog.components, won); } catch { /* never break resolution */ }
    };

    // Poll order status every 30s
    const pollTimer = setInterval(async () => {
      if (resolved || this.stopped || !this.krakenConn) return;
      try {
        const info = await this.krakenConn.getOrderInfo(orderId);
        if (info.status === "closed" || info.status === "canceled" || info.status === "expired") {
          // Get the current price to compute profit
          const currentPrice = await this.krakenConn.getAssetPrice(openLog.symbol);
          const entryPrice = openLog.entryPrice ?? currentPrice;
          const isBuy = openLog.direction === "MULTUP";
          const priceDiff = isBuy ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
          const profit = Math.round(priceDiff * volume * 100) / 100;
          finalize(profit > 0, profit);
        }
      } catch { /* ignore poll errors */ }
    }, 30_000);
    this.fallbackTimers.add(pollTimer);

    // Safety net: force-close after maxHoldMinutes
    const maxHoldMs = Math.max(60_000, this.config.maxHoldMinutes * 60_000);
    const remainingMs = Math.max(0, maxHoldMs - (Date.now() - openLog.time));
    const maxHoldTimer = setTimeout(async () => {
      if (resolved || this.stopped || !this.krakenConn) return;
      try {
        await this.krakenConn.closeOrder(orderId, openLog.symbol, volume);
        const currentPrice = await this.krakenConn.getAssetPrice(openLog.symbol);
        const entryPrice = openLog.entryPrice ?? currentPrice;
        const isBuy = openLog.direction === "MULTUP";
        const priceDiff = isBuy ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
        const profit = Math.round(priceDiff * volume * 100) / 100;
        finalize(profit > 0, profit);
      } catch {
        finalize(false, -openLog.stake);
      }
    }, remainingMs);
    this.fallbackTimers.add(maxHoldTimer);
  }

  /**
   * Track a Binance spot position — poll order status and resolve when closed.
   */
  private trackBinancePosition(openLog: TradeLog, orderId: number, baseAmount: number) {
    this.activeSymbols.set(openLog.symbol, biasOf(openLog.direction));
    let resolved = false;
    let partialTaken = false;

    const finalize = (won: boolean, profit: number) => {
      if (resolved) return;
      resolved = true;
      clearInterval(pollTimer);
      this.fallbackTimers.delete(pollTimer);
      clearTimeout(maxHoldTimer);
      this.fallbackTimers.delete(maxHoldTimer);
      this.activeSymbols.delete(openLog.symbol);
      this.emit({ ...openLog, status: won ? "won" : "lost", profit, closedAt: Date.now() });
      try { recordComponentOutcomesServer(openLog.symbol, openLog.components, won); } catch { /* never break resolution */ }
    };

    const pollTimer = setInterval(async () => {
      if (resolved || this.stopped || !this.binanceConn) return;
      try {
        // ── Partial profit taking on Binance ──
        if (!partialTaken && this.config.partialTakeProfitPct > 0 && openLog.takeProfitUsd) {
          const currentPrice = await this.binanceConn.getAssetPrice(openLog.symbol);
          const entryPrice = openLog.entryPrice ?? currentPrice;
          const isBuy = openLog.direction === "MULTUP";
          const priceDiff = isBuy ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
          const floatingProfit = priceDiff * baseAmount;
          const partialTrigger = openLog.takeProfitUsd * (this.config.partialTakeProfitPct / 100);
          if (floatingProfit >= partialTrigger) {
            partialTaken = true;
            // Sell partialTakeProfitPct% of the position to lock in profits
            const partialAmount = baseAmount * (this.config.partialTakeProfitPct / 100);
            try {
              await this.binanceConn.placeMarketOrder({
                symbol: openLog.symbol,
                direction: "SELL",
                quoteAmount: 0,
                baseAmount: partialAmount,
              });
            } catch { /* ignore partial sell failure */ }
          }
        }

        const info = await this.binanceConn.getOrderInfo(orderId, openLog.symbol);
        if (info.status === "FILLED" || info.status === "CANCELED" || info.status === "EXPIRED") {
          const currentPrice = await this.binanceConn.getAssetPrice(openLog.symbol);
          const entryPrice = openLog.entryPrice ?? currentPrice;
          const isBuy = openLog.direction === "MULTUP";
          const priceDiff = isBuy ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
          const profit = Math.round(priceDiff * baseAmount * 100) / 100;
          finalize(profit > 0, profit);
        }
      } catch { /* ignore poll errors */ }
    }, 30_000);
    this.fallbackTimers.add(pollTimer);

    const maxHoldMs = Math.max(60_000, this.config.maxHoldMinutes * 60_000);
    const remainingMs = Math.max(0, maxHoldMs - (Date.now() - openLog.time));
    const maxHoldTimer = setTimeout(async () => {
      if (resolved || this.stopped || !this.binanceConn) return;
      try {
        await this.binanceConn.closeOrder(orderId, openLog.symbol, baseAmount);
        const currentPrice = await this.binanceConn.getAssetPrice(openLog.symbol);
        const entryPrice = openLog.entryPrice ?? currentPrice;
        const isBuy = openLog.direction === "MULTUP";
        const priceDiff = isBuy ? (currentPrice - entryPrice) : (entryPrice - currentPrice);
        const profit = Math.round(priceDiff * baseAmount * 100) / 100;
        finalize(profit > 0, profit);
      } catch {
        finalize(false, -openLog.stake);
      }
    }, remainingMs);
    this.fallbackTimers.add(maxHoldTimer);
  }

  /**
   * Track an OANDA spot position — poll trade status and resolve when closed.
   */
  private trackOandaPosition(openLog: TradeLog, tradeId: string, units: number) {
    this.activeSymbols.set(openLog.symbol, biasOf(openLog.direction));
    let resolved = false;
    let partialTaken = false;

    const finalize = (won: boolean, profit: number) => {
      if (resolved) return;
      resolved = true;
      clearInterval(pollTimer);
      this.fallbackTimers.delete(pollTimer);
      clearTimeout(maxHoldTimer);
      this.fallbackTimers.delete(maxHoldTimer);
      this.activeSymbols.delete(openLog.symbol);
      this.emit({ ...openLog, status: won ? "won" : "lost", profit, closedAt: Date.now() });
      try { recordComponentOutcomesServer(openLog.symbol, openLog.components, won); } catch { /* never break resolution */ }
    };

    const pollTimer = setInterval(async () => {
      if (resolved || this.stopped || !this.oandaConn) return;
      try {
        // ── Partial profit taking on OANDA ──
        if (!partialTaken && this.config.partialTakeProfitPct > 0 && openLog.takeProfitUsd) {
          const info = await this.oandaConn.getTradeInfo(tradeId);
          const partialTrigger = openLog.takeProfitUsd * (this.config.partialTakeProfitPct / 100);
          if (info.profit >= partialTrigger) {
            partialTaken = true;
            // Close partialTakeProfitPct% of the position to lock in profits
            const partialUnits = Math.floor(units * (this.config.partialTakeProfitPct / 100));
            // OANDA's common unit precision is 0. Do not send an invalid
            // fractional close for the smallest permitted Gold position.
            if (partialUnits >= 1) {
              try {
                await this.oandaConn.closeTrade(tradeId, partialUnits);
              } catch { /* ignore partial close failure */ }
            }
          }
        }

        const info = await this.oandaConn.getTradeInfo(tradeId);
        if (info.state === "CLOSED") {
          finalize(info.profit > 0, info.profit);
        }
      } catch { /* ignore poll errors */ }
    }, 30_000);
    this.fallbackTimers.add(pollTimer);

    const maxHoldMs = Math.max(60_000, this.config.maxHoldMinutes * 60_000);
    const remainingMs = Math.max(0, maxHoldMs - (Date.now() - openLog.time));
    const maxHoldTimer = setTimeout(async () => {
      if (resolved || this.stopped || !this.oandaConn) return;
      try {
        await this.oandaConn.closeTrade(tradeId, units);
        const info = await this.oandaConn.getTradeInfo(tradeId);
        finalize(info.profit > 0, info.profit);
      } catch {
        finalize(false, -openLog.stake);
      }
    }, remainingMs);
    this.fallbackTimers.add(maxHoldTimer);
  }

  start() {
    this.tick().catch((e) => { this.lastError = (e as Error).message; });
    this.interval = setInterval(() => {
      this.tick().catch((e) => { this.lastError = (e as Error).message; });
    }, SCAN_MS);
  }

  /**
   * Admin force-trade: buys a contract directly via the engine's Deriv
   * connection, bypassing the signal scan. Used by the admin user profile
   * page to let an admin manually trade on behalf of a user.
   */
  async forceTrade(opts: {
    symbol: string;
    direction: "CALL" | "PUT" | "MULTUP" | "MULTDOWN";
    stake: number;
    durationMinutes: number;
  }): Promise<TradeLog> {
    if (this.stopped) throw new Error("Moteur arrêté — redémarrez le bot d'abord.");
    const { symbol, direction, stake, durationMinutes } = opts;
    if (isTradingSymbolDisabled(symbol)) {
      throw new Error(`${symbol} est exclu globalement et ne peut pas être tradé.`);
    }
    const isMultiplier = direction === "MULTUP" || direction === "MULTDOWN";
    const tradeId = `srv_admin_${Date.now()}_${symbol}`;
    const pendingLog: TradeLog = {
      id: tradeId,
      time: Date.now(),
      symbol,
      direction,
      stake,
      payout: 0,
      status: "pending",
      profit: 0,
      confidence: 100,
      tfAgreement: 0,
      note: "Trade manuel admin",
      ...(isMultiplier
        ? { multiplier: this.config.multiplierLevel ?? 20, stopLossUsd: stake * 0.5, takeProfitUsd: stake }
        : { durationMinutes, expiry: Date.now() + durationMinutes * 60_000 }),
    };
    this.emit(pendingLog);

    try {
      if (isMultiplier) {
        const bought = await this.conn.proposeAndBuyMultiplier({
          symbol,
          amount: stake,
          direction: direction === "MULTUP" ? "CALL" : "PUT",
          multiplier: this.config.multiplierLevel ?? 20,
          stopLossUsd: stake * 0.5,
          takeProfitUsd: stake,
        });
        const openLog: TradeLog = { ...pendingLog, status: "open", contractId: bought.contractId };
        this.emit(openLog);
        this.trackMultiplierPosition(openLog);
        return openLog;
      } else {
        const bought = await this.conn.proposeAndBuy({
          symbol,
          amount: stake,
          contractType: direction,
          durationMinutes,
        });
        const openLog: TradeLog = { ...pendingLog, status: "open", payout: bought.payout, contractId: bought.contractId };
        this.emit(openLog);
        this.trackContract(openLog);
        return openLog;
      }
    } catch (e) {
      this.emit({ ...pendingLog, status: "error", profit: 0, note: `Échec admin: ${(e as Error).message}` });
      throw e;
    }
  }

  stop() {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.teardownConnections();
  }

  private teardownConnections() {
    for (const t of this.fallbackTimers) clearTimeout(t);
    this.fallbackTimers.clear();
    for (const unsub of this.contractUnsubs.values()) unsub();
    this.contractUnsubs.clear();
    this.conn.close();
    this.krakenConn?.close();
    this.binanceConn?.close();
    this.oandaConn?.close();
  }

  /**
   * Halts scanning (no new trades) WITHOUT tearing down contract subscriptions,
   * timers, or the connection — unlike stop(), which orphans any position still
   * open (no more live P&L updates, maxHoldMinutes force-close never fires; see
   * hasOpenPositions' doc comment for the 2026-07-15 incident this class of bug
   * caused). Used by stopBotForUser when the preset has an open position: the
   * engine keeps tracking it to a normal close, then emit() below finalizes the
   * teardown itself once nothing is left open.
   */
  stopScanning(reason: string) {
    if (this.stopped) return;
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.pendingStopReason = reason;
  }

  /** Completes a stopScanning() deferral once its last open position has just
   * closed (called from emit() below, right after that close is persisted). */
  private finalizeIfIdle() {
    if (!this.stopped || !this.pendingStopReason) return;
    if (hasOpenPositions(this.userId, this.preset)) return;
    this.teardownConnections();
    engines.delete(engineKey(this.userId, this.preset));
    console.log(`[bot] Moteur serveur finalisé pour user ${this.userId} preset ${this.preset} — dernière position close (${this.pendingStopReason})`);
  }

  private nextUtcMidnight(): number {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d.getTime();
  }

  private async tick() {
    if (this.stopped || this.ticking) return;
    if (Date.now() < this.pausedUntil) return;
    this.ticking = true;
    try {
      await this.runScan();
      this.lastError = null;
    } finally {
      this.ticking = false;
    }
  }

  private async runScan() {
    const config = this.config;
    const logs = this.logs;
    // SQL over all of today's rows — the in-memory log is a capped window, so
    // computing daily P&L/count from it drops early wins as events accumulate.
    const { pnl, count } = getTodayStats(this.userId, this.preset);

    // Check for session open/close changes
    const currentSessions = currentActiveSessions();
    const openedSessions = currentSessions.filter((s) => !this.lastActiveSessions.includes(s));
    const closedSessions = this.lastActiveSessions.filter((s) => !currentSessions.includes(s));
    this.lastActiveSessions = currentSessions;

    if (openedSessions.length > 0 || closedSessions.length > 0) {
      const configSessions = config.tradingSessions || [];
      const relevantOpened = openedSessions.filter((s) => configSessions.includes(s));
      const relevantClosed = closedSessions.filter((s) => configSessions.includes(s));

      if (relevantOpened.length > 0 || relevantClosed.length > 0) {
        void (async () => {
          try {
            const { sendPushToUser } = await import("./push.server");
            const sessionLabels: Record<TradingSession, string> = {
              london: "Londres",
              newyork: "New York",
              asia: "Asie/Tokyo",
              sydney: "Sydney",
            };

            for (const s of relevantOpened) {
              await sendPushToUser(this.userId, {
                title: `Session ${sessionLabels[s] || s} ouverte`,
                body: `La session ${sessionLabels[s] || s} vient d'ouvrir. Le bot commence l'analyse de ce marché.`,
                url: "/autotrader",
              }).catch(() => {});
            }

            for (const s of relevantClosed) {
              await sendPushToUser(this.userId, {
                title: `Session ${sessionLabels[s] || s} fermée`,
                body: `La session ${sessionLabels[s] || s} est maintenant fermée. Le bot suspend le trading sur ce marché.`,
                url: "/autotrader",
              }).catch(() => {});
            }
          } catch (e) {
            console.error(`[bot] Push de session échoué pour user ${this.userId}:`, (e as Error).message);
          }
        })();
      }
    }
    const scanResults: ScanSymbolResult[] = [];
    const finishScan = () => { this.lastScan = { time: Date.now(), results: scanResults }; };

    // ── Trailing stop / daily limits (pause-with-auto-resume) ──
    if (pnl > this.sessionPeakPnl) this.sessionPeakPnl = pnl;
    if (config.trailingStopUsd > 0 && this.sessionPeakPnl > 0 && pnl < this.sessionPeakPnl - config.trailingStopUsd) {
      // Même raisonnement que le trailing stop proportionnel plus bas :
      // protéger un pic n'est pas constater une perte définitive.
      this.riskPause([`Trailing stop — pic +$${this.sessionPeakPnl.toFixed(2)}, maintenant ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`], this.nextShortResume());
      return finishScan();
    }
    // Proportional trailing stop: the allowed giveback scales with the size
    // of today's peak gain (e.g. 10% of +$100 = $10) instead of a flat $
    // amount — "the more we've won, the more room we allow before locking
    // in". Gated on trailingStopMinPeakUsd so an early $2 peak doesn't pause
    // the bot for the rest of the day over a $0.20 wobble.
    if (config.trailingStopPct > 0 && this.sessionPeakPnl >= config.trailingStopMinPeakUsd) {
      const maxDrawdown = this.sessionPeakPnl * config.trailingStopPct;
      if (pnl < this.sessionPeakPnl - maxDrawdown) {
        // Pause courte : le trailing stop protège un PIC, il ne constate pas
        // une perte définitive — le P&L est souvent encore positif quand il
        // se déclenche (+$7.54 lors du déclenchement observé le 2026-07-29).
        // Couper la journée entière dans ce cas gelait le bot alors qu'il
        // était en gain.
        this.riskPause([
          `Trailing stop % — pic +$${this.sessionPeakPnl.toFixed(2)}, perte max autorisée ${(config.trailingStopPct * 100).toFixed(0)}% (-$${maxDrawdown.toFixed(2)}), maintenant ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
        ], this.nextShortResume());
        return finishScan();
      }
    }
    // Realized-only pnl let the bot keep opening positions while already deep
    // underwater on OPEN ones — the loss only "existed" once a stop actually
    // hit. Floating LOSSES count toward the cap; floating gains don't (they
    // can evaporate, and must not mask realized losses).
    const floatingLoss = Math.min(0, getOpenFloatingPnl(this.userId, this.preset));
    const riskPnl = pnl + floatingLoss;
    if (riskPnl <= -Math.abs(config.maxDailyLossUsd)) {
      if (config.stopOnRisk) {
        const detail = floatingLoss < 0
          ? `$${Math.abs(pnl).toFixed(2)} réalisé + $${Math.abs(floatingLoss).toFixed(2)} flottant`
          : `$${Math.abs(pnl).toFixed(2)}`;
        // La durée dépend de ce qui a VRAIMENT déclenché : si le plafond n'est
        // franchi que grâce au flottant, la perte peut encore se résorber —
        // pause courte. Si la perte réalisée seule suffit, l'argent est parti :
        // on coupe la journée.
        const realizedAloneTriggers = pnl <= -Math.abs(config.maxDailyLossUsd);
        this.riskPause(
          [`Perte journalière atteinte : ${detail} / $${config.maxDailyLossUsd}`],
          realizedAloneTriggers ? this.nextUtcMidnight() : this.nextShortResume(),
        );
      }
      return finishScan();
    }
    if (config.maxDailyProfitUsd > 0 && pnl >= config.maxDailyProfitUsd) {
      if (config.stopOnRisk) this.riskPause([`Objectif journalier atteint : +$${pnl.toFixed(2)}`], this.nextUtcMidnight());
      return finishScan();
    }
    if (count >= config.maxTradesPerDay) {
      for (const symbol of config.symbols) scanResults.push({ symbol, action: "daily-limit" });
      return finishScan();
    }
    // Global cap on TOTAL open positions — maxSimultaneousTrades only limits
    // NEW trades per tick, so successive ticks stacked positions without
    // bound (6 observed live on 2026-07-14) while only per-symbol/correlation
    // gates applied. activeSymbols survives restarts (rebuilt by reconcile()).
    if (this.activeSymbols.size >= config.maxOpenPositions) {
      for (const symbol of config.symbols) {
        if (!this.activeSymbols.has(symbol)) scanResults.push({ symbol, action: "daily-limit", note: `${this.activeSymbols.size} positions ouvertes — plafond ${config.maxOpenPositions}` });
      }
      return finishScan();
    }

    // ── Preset-wide consecutive-loss circuit breaker ──
    // maxConsecutiveLosses is also enforced per-symbol further below (each
    // symbol tracks its own streak), but that alone can't see a preset
    // bleeding across SEVERAL different symbols in a row. Incident
    // 2026-08-04 : Default lost 4 straight trades across 3 different OTC
    // symbols (GDAXI, SPC, DJI, GDAXI) — no single symbol's own streak ever
    // reached 3, so the per-symbol cooldown never engaged and the account
    // kept trading straight through it. countConsecutiveLosses(logs) with no
    // symbol filter counts the streak across this preset's own trade stream.
    const presetConsecutiveLosses = countConsecutiveLosses(logs);
    if (presetConsecutiveLosses >= config.maxConsecutiveLosses) {
      // Same "already served" check as the per-symbol breaker below: identify
      // THIS streak by its most recent closed trade. If the pause already
      // served was for this exact streak (no new trade since — expected,
      // since the preset was blocked), the penalty is served: fall through
      // and let it try again instead of reading the same stale history and
      // re-pausing forever.
      const streakTrade = logs.find((l) => l.status === "won" || l.status === "lost");
      const streakKey = streakTrade?.id;
      const alreadyServed = streakKey !== undefined && this.presetServedCooldownFor === streakKey;
      if (!alreadyServed) {
        if (config.stopOnRisk) {
          this.riskPause(
            [`${presetConsecutiveLosses} pertes consécutives (tous symboles confondus)`],
            this.nextShortResume(),
          );
        }
        if (streakKey !== undefined) this.presetServedCooldownFor = streakKey;
        for (const symbol of config.symbols) scanResults.push({ symbol, action: "cooldown" });
        return finishScan();
      }
      // Pause already served for this streak — fall through and attempt a
      // trade. A fresh loss produces a new streakKey and re-arms the breaker
      // normally; a win clears the streak (countConsecutiveLosses stops at
      // the first "won") and this branch stops matching entirely.
    }

    // ── Stake ──
    const balance = await this.conn.getBalance();
    // Gold presets routed to OANDA must size from the OANDA Practice equity,
    // never from an unrelated Deriv wallet balance.
    const oandaBalance = isGoldPreset(this.preset) && this.config.broker === "oanda"
      ? await this.oandaConn?.getBalance().catch(() => null)
      : null;
    const currentBalance = oandaBalance?.balance ?? balance?.balance;
    const baseStake = config.stakeMode === "percent" && currentBalance && currentBalance > 0
      ? Math.max(1, (currentBalance * config.stakePercent) / 100)
      : config.stakeUsd;
    const effectiveStake = config.adaptiveStake ? computeAdaptiveStake(baseStake, logs) : baseStake;

    // ── Candidates + cheap pre-filters ──
    // Synthetic indices (R_*, 1HZ*, JD*, stpRNG, RDBULL/RDBEAR) are excluded even
    // in all-markets mode: Deriv generates them by RNG, no indicator has a real
    // edge on them, and long-term winrate ~50% is a structural loss against the
    // payout (see DEFAULT_CONFIG.symbols comment).
    const excluded = new Set(config.excludedSymbols ?? []);
    const candidateSymbols = (config.symbolMode === "all-markets"
      ? SYMBOLS.filter((s) => s.market !== "synthetic" && isSymbolTradeable(s.deriv, getInstrumentForSymbol(s.deriv, config))).map((s) => s.deriv)
      : config.symbols
    ).filter((s) => !excluded.has(s) && !isTradingSymbolDisabled(s));

    const toAnalyze: string[] = [];
    for (const symbol of candidateSymbols) {
      if (isGoldPreset(this.preset) && hasOpenGoldExposure(this.userId, this.preset)) {
        scanResults.push({ symbol, action: "correlated", note: "Conflict Manager Gold : exposition d’un autre moteur déjà ouverte" });
        continue;
      }
      const symInstrument = getInstrumentForSymbol(symbol, config);
      if (!isSymbolTradeable(symbol, symInstrument)) { scanResults.push({ symbol, action: "not-tradeable" }); continue; }
      if (this.activeSymbols.has(symbol)) { scanResults.push({ symbol, action: "open-trade" }); continue; }
      // A preset that explicitly selects OANDA must never silently send a
      // fallback order to Deriv. This matters most for Gold: its stop/target
      // and its risk sizing are calculated for an OANDA spot position.
      if (config.broker === "oanda") {
        if (!isOandaSymbol(symbol)) { scanResults.push({ symbol, action: "not-tradeable", note: "Symbole indisponible chez OANDA" }); continue; }
        if (!this.oandaConn) { scanResults.push({ symbol, action: "session-closed", note: "OANDA Practice non configuré" }); continue; }
      }
      // ── Skip symbols from disabled brokers ──
      if (isKrakenSymbol(symbol) && !(this.config.enableKraken ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "Kraken désactivé" }); continue; }
      if (isBinanceSymbol(symbol) && !(this.config.enableBinance ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "Binance désactivé" }); continue; }
      if (isOandaSymbol(symbol) && !(this.config.enableOanda ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "OANDA désactivé" }); continue; }
      if (!isKrakenSymbol(symbol) && !isBinanceSymbol(symbol) && !isOandaSymbol(symbol) && !(this.config.enableDeriv ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "Deriv désactivé" }); continue; }
      if (!isInTradingSession(config.tradingSessions, symbol, config.sessionEdgeMinutes)) {
        scanResults.push({ symbol, action: "session-closed" });
        continue;
      }
      if (!is24x7Symbol(symbol) && (isGoldPreset(this.preset) || config.newsFilter !== false)) {
        const riskCheck = isHighRiskWindow();
        if (riskCheck.blocked) { scanResults.push({ symbol, action: "news-block", note: riskCheck.reason }); continue; }
      }
      const cooldownUntil = this.symbolCooldowns.get(symbol) ?? 0;
      if (Date.now() < cooldownUntil) { scanResults.push({ symbol, action: "cooldown" }); continue; }
      if (cooldownUntil > 0) this.symbolCooldowns.delete(symbol);

      const consecutive = countConsecutiveLosses(logs, symbol);
      if (consecutive >= config.maxConsecutiveLosses) {
        // Identify THIS streak by its most recent closed trade. If the
        // cooldown already served was for this exact streak (no new trade
        // happened since — expected, since the symbol was blocked), the
        // penalty is served: let it try again this cycle instead of reading
        // the same stale history and re-blocking forever.
        const streakTrade = logs.find((l) => l.symbol === symbol && (l.status === "won" || l.status === "lost"));
        const streakKey = streakTrade?.id;
        const alreadyServed = streakKey !== undefined && this.servedCooldownFor.get(symbol) === streakKey;
        if (!alreadyServed) {
          this.symbolCooldowns.set(symbol, Date.now() + config.cooldownMinutes * 60_000);
          if (streakKey !== undefined) this.servedCooldownFor.set(symbol, streakKey);
          this.emit({
            id: `cd_${Date.now()}_${symbol}`, time: Date.now(), symbol, direction: "CALL",
            stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
            status: "cooldown", note: `${consecutive} pertes consécutives — pause ${config.cooldownMinutes} min`,
          });
          scanResults.push({ symbol, action: "cooldown" });
          continue;
        }
        // Cooldown already served for this streak — fall through and let it
        // attempt a trade. A fresh loss will produce a new streakKey and
        // re-arm the cooldown normally; a win clears the streak entirely.
      }

      // A streak counter resets on any single win — a symbol alternating
      // W-L-W-L never trips it even though it's a coin flip against a payout
      // that needs >50% to break even. Catches that slow bleed directly.
      // Pause is a full day (not the short cooldownMinutes used for a losing
      // streak) — a structural win-rate problem doesn't resolve itself in an
      // hour, and the old short pause let symbols like Gold/Silver come back
      // and re-lose within the same session over and over (audit finding).
      if (config.minSymbolWinRate > 0) {
        const rolling = symbolRollingStats(logs, symbol, config.symbolWinRateLookback);
        if (rolling.trades >= 5 && rolling.winRate < config.minSymbolWinRate) {
          const until = this.nextUtcMidnight();
          this.symbolCooldowns.set(symbol, until);
          this.emit({
            id: `cd_${Date.now()}_${symbol}`, time: Date.now(), symbol, direction: "CALL",
            stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
            status: "cooldown",
            note: `Win rate ${(rolling.winRate * 100).toFixed(0)}% sur ${rolling.trades} trades — pause jusqu'à 00:00 UTC`,
          });
          scanResults.push({ symbol, action: "cooldown" });
          continue;
        }
      }
      toAnalyze.push(symbol);
    }

    if (!toAnalyze.length) return finishScan();

    // ── Analysis (shared decision core + cross-user learned weights) ──
    // Candle fetcher that routes symbols to the appropriate broker
    const candleFetcher = async (symbol: string, granularity: number, count: number) => {
      if (isKrakenSymbol(symbol) && this.krakenConn) {
        return fetchKrakenCandles(symbol, granularity, count);
      }
      if (isBinanceSymbol(symbol) && this.binanceConn) {
        return fetchBinanceCandles(symbol, granularity, count);
      }
      if (isOandaSymbol(symbol) && this.oandaConn) {
        return fetchOandaCandles(symbol, granularity, count, this.oandaConn.apiKey, this.oandaConn.accountId, this.oandaConn.isPractice);
      }
      return fetchCandlesServer(symbol, granularity, count);
    };

    // Scalping trades a completely different, finer-grained (M1/M5) signal —
    // see scalping-signal.server.ts's header for why it can't reuse
    // analyzeSymbolCore's 5m/15m/1H/4H aggregation. riskAbs/rewardAbs (price
    // distances) are stashed here, keyed by symbol, and consumed below when
    // computing stopLossUsd/takeProfitUsd for THIS tick only — never persisted.
    const scalpingLevels = new Map<string, { riskAbs: number; rewardAbs: number }>();
    // Kept separate from the generic Crash engine: each CRASH500 execution is
    // tagged in its journal note with the internal strategy that selected it.
    const crash500Levels = new Map<string, { riskAbs: number; rewardAbs: number; strategy: string; reason: string }>();
    const boom500Levels = new Map<string, { riskAbs: number; rewardAbs: number; strategy: string; reason: string; riskPct: number }>();
    const vol75Levels = new Map<string, { riskAbs: number; rewardAbs: number; strategy: string; reason: string; riskPct: number }>();

    const analyzed = this.preset === "boom"
      ? await mapWithConcurrency(toAnalyze, 2, async (symbol) => {
          const [m15, m5, m1, ticks] = await Promise.all([
            candleFetcher(symbol, 900, 70), candleFetcher(symbol, 300, 70), candleFetcher(symbol, 60, 55),
            fetchRecentTicksServer(symbol, 120).catch(() => []),
          ]);
          const candidates = generateBoom500Signals(m15, m5, m1, ticks);
          // A qualified Spike BUY has priority; a Drift SELL may never be
          // opened against a simultaneous spike setup.
          const sig = candidates.find(c => c.strategy === "BOOM500_SPIKE_HUNTER_BUY") ?? candidates[0];
          if (sig) boom500Levels.set(symbol, { ...sig, riskPct: sig.strategy === "BOOM500_SPIKE_HUNTER_BUY" ? .25 : .20 });
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null, confidence: sig?.confidence ?? 0, agreement: sig ? 4 : 0,
            premiumCount: sig && sig.confidence >= 95 ? 1 : 0, volatilityPct: sig?.volatilityPct ?? 0,
            volatilityRatio: 1, blockers: sig ? [] : ["Pas de setup Boom500 Spike BUY ou Drift SELL confirmé"],
            dominantTf: "1m", suggestedDuration: 0, trendAlignmentScore: sig ? 4 : 0,
            patternBonus: sig && sig.confidence >= 95 ? 10 : 0,
          };
          return { symbol, analysis };
        })
      : this.preset === "vol75"
      ? await mapWithConcurrency(toAnalyze, 1, async (symbol) => {
          const [m15, m5, m1, ticks] = await Promise.all([
            candleFetcher(symbol, 900, 230), candleFetcher(symbol, 300, 230), candleFetcher(symbol, 60, 80),
            fetchRecentTicksServer(symbol, 180).catch(() => []),
          ]);
          const decision = generateVol75Signal(m15, m5, m1, ticks);
          const sig = decision.signal;
          if (sig) vol75Levels.set(symbol, { ...sig });
          if (decision.rejection) {
            getDb().prepare(`INSERT INTO signal_rejections (id,user_id,preset,symbol,time,score,reason,diagnostics) VALUES (?,?,?,?,?,?,?,?)`)
              .run(`vol75_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, this.userId, "vol75", symbol, Date.now(), Math.round(decision.rejection.score), decision.rejection.reason, JSON.stringify(decision.rejection.diagnostics));
          }
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null, confidence: sig?.confidence ?? decision.rejection?.score ?? 0, agreement: sig ? 4 : 0,
            premiumCount: sig && sig.confidence >= 92 ? 1 : 0, volatilityPct: sig?.volatilityPct ?? 0,
            volatilityRatio: 1, blockers: sig ? [] : [decision.rejection?.reason ?? "NO_TRADE"],
            dominantTf: "1m", suggestedDuration: 0, trendAlignmentScore: sig ? 4 : 0,
            patternBonus: sig && sig.confidence >= 92 ? 10 : 0,
          };
          return { symbol, analysis };
        })
      : this.preset === "crash500"
      ? await mapWithConcurrency(toAnalyze, 2, async (symbol) => {
          const [m15, m5, m1, ticks] = await Promise.all([
            candleFetcher(symbol, 900, 70),
            candleFetcher(symbol, 300, 70),
            candleFetcher(symbol, 60, 55),
            fetchRecentTicksServer(symbol, 120).catch(() => []),
          ]);
          const candidates = generateCrash500Signals(m15, m5, m1, ticks);
          // Premium Spike Hunter has priority over Drift when both qualify.
          const sig = candidates.find((candidate) => candidate.strategy === "CRASH500_SPIKE_HUNTER_SELL" && candidate.confidence >= 95)
            ?? candidates.sort((a, b) => b.confidence - a.confidence)[0];
          if (sig) crash500Levels.set(symbol, sig);
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null,
            confidence: sig?.confidence ?? 0,
            agreement: sig ? 4 : 0,
            premiumCount: sig?.confidence && sig.confidence >= 95 ? 1 : 0,
            volatilityPct: sig?.volatilityPct ?? 0,
            volatilityRatio: 1,
            blockers: sig ? [] : ["Pas de setup Crash500 Spike SELL ou Drift BUY confirmé"],
            dominantTf: "1m",
            suggestedDuration: 0,
            trendAlignmentScore: sig ? 4 : 0,
            patternBonus: sig?.confidence && sig.confidence >= 95 ? 10 : 0,
          };
          return { symbol, analysis };
        })
      : this.preset === "scalping"
      ? await mapWithConcurrency(toAnalyze, 4, async (symbol) => {
          const m1 = await candleFetcher(symbol, 60, Math.max(MIN_M1_CANDLES + 10, 300));
          const sig = m1.length >= MIN_M1_CANDLES ? generateScalpingSignal(m1) : null;
          if (sig) scalpingLevels.set(symbol, { riskAbs: sig.riskAbs, rewardAbs: sig.rewardAbs });
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null,
            confidence: sig?.confidence ?? 0,
            agreement: sig ? 4 : 0, // both M5-trend and M1-confirmation already agreed, or there's no signal
            premiumCount: 0,
            volatilityPct: sig?.volatilityPct ?? 0,
            volatilityRatio: 1,
            blockers: sig ? [] : ["Pas de setup M5-tendance / repli M1 / confirmation"],
            dominantTf: "1m",
            suggestedDuration: 0,
            trendAlignmentScore: sig ? 4 : 0,
            patternBonus: 0,
            // Deliberately no `components` — this isn't the indicator-based
            // engine, so its outcomes must not feed the cross-user learned
            // weights (indicator-weights.server.ts) meant for that system.
          };
          return { symbol, analysis };
        })
      : this.preset === "scalpingv2"
      ? await mapWithConcurrency(toAnalyze, 4, async (symbol) => {
          const [m1, m5] = await Promise.all([
            candleFetcher(symbol, 60, 60),
            candleFetcher(symbol, 300, 30),
          ]);
          const sig = generateSpikeHunterSignal(symbol, m1, m5);
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null,
            confidence: sig?.confidence ?? 0,
            agreement: sig ? 4 : 0,
            premiumCount: 0,
            volatilityPct: 0,
            volatilityRatio: 1,
            blockers: sig ? [] : ["Pas d'accumulation/distribution Spike Hunter M1/M5"],
            dominantTf: "1m",
            suggestedDuration: 0,
            trendAlignmentScore: sig ? 4 : 0,
            patternBonus: 0,
          };
          return { symbol, analysis };
        })
      : this.preset === "liquidity" || this.preset === "liquidityv2"
      ? await mapWithConcurrency(toAnalyze, 4, async (symbol) => {
          const m15 = await candleFetcher(symbol, 900, MIN_LIQUIDITY_CANDLES + 5);
          const sig = m15.length >= MIN_LIQUIDITY_CANDLES ? generateLiquidityReversalSignal(m15) : null;
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null,
            confidence: sig?.confidence ?? 0,
            agreement: sig ? 4 : 0,
            premiumCount: 0,
            volatilityPct: sig?.volatilityPct ?? 0,
            volatilityRatio: 1,
            blockers: sig ? [] : ["Pas de balayage/réintégration M15 confirmé par le RSI"],
            dominantTf: "15m",
            suggestedDuration: 60,
            trendAlignmentScore: sig ? 4 : 0,
            patternBonus: 0,
          };
          return { symbol, analysis };
        })
      : this.preset === "goldv2"
      ? await mapWithConcurrency(toAnalyze, 4, async (symbol) => {
          const m15 = await candleFetcher(symbol, 900, MIN_GOLD_SESSION_CANDLES + 5);
          const sig = m15.length >= MIN_GOLD_SESSION_CANDLES ? generateGoldSessionBreakoutSignal(m15) : null;
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null,
            confidence: sig?.confidence ?? 0,
            agreement: sig ? 4 : 0,
            premiumCount: 0,
            volatilityPct: sig?.volatilityPct ?? 0,
            volatilityRatio: 1,
            blockers: sig ? [] : ["Pas de cassure de session suivie d'un pullback validé"],
            dominantTf: "15m",
            suggestedDuration: 30,
            trendAlignmentScore: sig ? 4 : 0,
            patternBonus: 0,
          };
          return { symbol, analysis };
        })
      : this.preset === "gold"
      ? await mapWithConcurrency(toAnalyze, 4, async (symbol) => {
          const [h1, m15, m5, m1] = await Promise.all([
            candleFetcher(symbol, 3600, MIN_GOLD_PULLBACK_H1_CANDLES + 5),
            candleFetcher(symbol, 900, MIN_GOLD_PULLBACK_M15_CANDLES + 5),
            candleFetcher(symbol, 300, MIN_GOLD_PULLBACK_M5_CANDLES + 5),
            candleFetcher(symbol, 60, MIN_GOLD_PULLBACK_M1_CANDLES + 5),
          ]);
          const sig = generateGoldTrendPullbackSignal(h1, m15, m5, m1);
          const analysis: SymbolAnalysis = {
            direction: sig?.direction ?? null,
            confidence: sig?.confidence ?? 0,
            agreement: sig ? 4 : 0,
            premiumCount: 0,
            volatilityPct: sig?.volatilityPct ?? 0,
            volatilityRatio: 1,
            blockers: sig ? [] : ["Pas de séquence Trend Pullback H1→M15→M5→M1 complète"],
            dominantTf: "1m",
            suggestedDuration: 0,
            trendAlignmentScore: sig ? 4 : 0,
            patternBonus: 0,
          };
          return { symbol, analysis };
        })
      : await mapWithConcurrency(toAnalyze, 4, async (symbol) => {
          const core = await analyzeSymbolCore(symbol, candleFetcher, buildAnalyzeOptsServer(symbol, config));
          let analysis = core.analysis;

          // ── Spike Hunter Layer for Boom & Crash ──
          if ((symbol.includes("BOOM") || symbol.includes("CRASH")) && (!analysis.direction || analysis.confidence < 75)) {
            const m1 = await candleFetcher(symbol, 60, 60).catch(() => []);
            const m5 = await candleFetcher(symbol, 300, 30).catch(() => []);
            const spikeSig = generateSpikeHunterSignal(symbol, m1, m5);
            if (spikeSig && spikeSig.confidence >= config.minConfidence) {
              analysis = {
                direction: spikeSig.direction,
                confidence: spikeSig.confidence,
                agreement: 4,
                premiumCount: 1,
                volatilityPct: 1,
                volatilityRatio: 1,
                blockers: [],
                dominantTf: "1m",
                suggestedDuration: 5,
                trendAlignmentScore: 4,
                patternBonus: 10,
              };
            }
          }
          return { symbol, analysis };
        });

    const ordered = config.symbolMode === "all-markets"
      ? [...analyzed].sort((a, b) => b.analysis.confidence - a.analysis.confidence)
      : analyzed;

    let newTradesThisTick = 0;

    for (const { symbol, analysis } of ordered) {
      if (this.stopped) break;
      if (newTradesThisTick >= config.maxSimultaneousTrades) {
        scanResults.push({ symbol, action: "daily-limit", note: `Limite ${config.maxSimultaneousTrades} trades/cycle` });
        continue;
      }
      // ── Time-of-day edge filter ──
      if (config.hourlyEdgeFilter && isHourBlocked(logs, config.hourlyEdgeLookback)) {
        scanResults.push({ symbol, action: "no-signal", note: "Creneau horaire bloque (P&L negatif)" });
        continue;
      }
      // ── Verdict conseiller ──
      // isMultiplier/multiplierOverride sont de simples lookups (pas d'I/O) —
      // résolus ici, avant le verdict, pour qu'effectiveMinTfAgreement soit
      // exactement celui que l'advisor (opportunities.server.ts) utiliserait
      // pour le même symbole. classifyOpportunity() est la même fonction pure
      // que le conseiller : un trade automatique n'est possible que si le
      // conseiller aurait dit "à prendre".
      const isMultiplier = getInstrumentForSymbol(symbol, config) === "multiplier";
      // Per-symbol override (Or/GBP-USD run their own measured settings —
      // see MULTIPLIER_SYMBOL_OVERRIDES) — undefined for BTC and every
      // binary symbol, which keep reading the global config fields below.
      const multiplierOverride = isMultiplier ? getMultiplierOverride(symbol) : undefined;
      const effectiveMinTfAgreement = multiplierOverride?.minTfAgreement ?? config.minTfAgreement;
      const thresholds = {
        minConfidence: config.minConfidence,
        maxConfidence: config.maxConfidence,
        minTfAgreement: effectiveMinTfAgreement,
        maxVolatilityPct: config.maxVolatilityPct,
        premiumOnly: config.premiumOnly,
      };
      const verdict = classifyOpportunity(analysis, thresholds);
      if (verdict.decision !== "take") {
        const note = verdict.reasonCode === "confidence-low" ? `Seuil: ${config.minConfidence}`
          : verdict.reasonCode === "confidence-high" ? `Plafond: ${config.maxConfidence}`
          : verdict.reasonCode === "agreement-low" ? `Seuil: ${effectiveMinTfAgreement}`
          : verdict.reasonCode === "volatility-abs" ? `ATR ${analysis.volatilityPct.toFixed(2)}% > max`
          : verdict.reasonCode === "volatility-ratio" ? `Volatilité ${analysis.volatilityRatio.toFixed(1)}x la normale`
          : undefined;
        scanResults.push({
          symbol,
          action: REASON_CODE_ACTION[verdict.reasonCode],
          direction: analysis.direction,
          confidence: analysis.confidence,
          agreement: analysis.agreement,
          note,
        });
        continue;
      }
      // classifyOpportunity's "take" branch requires analysis.direction to be
      // non-null (see the "no-direction" check inside it) — this re-narrows
      // it for TypeScript's benefit, it can never actually continue here.
      if (!analysis.direction) continue;

      // ── À partir d'ici : le conseiller dit "à prendre" — reste à vérifier
      // qu'on PEUT exécuter maintenant (position corrélée, spread, plafond
      // dynamique de confiance basé sur le payout, mise, durée, payout). Ce
      // sont des contraintes d'exécution/compte, pas des questions de
      // "est-ce une bonne opportunité". ──
      if (config.blockCorrelated && isCorrelatedWithActive(symbol, analysis.direction, this.activeSymbols)) {
        scanResults.push({ symbol, action: "correlated" });
        continue;
      }
      const useKraken = isKrakenSymbol(symbol) && this.krakenConn !== null;
      const useBinance = isBinanceSymbol(symbol) && this.binanceConn !== null;
      const useOanda = config.broker === "oanda" && isOandaSymbol(symbol) && this.oandaConn !== null;
      const useAltBroker = useKraken || useBinance || useOanda;

      // ── Spread/slippage filter (alt brokers only) ──
      // On spot exchanges, a wide bid/ask spread eats into small stakes.
      // Skip the trade if the spread exceeds the configured max.
      if (config.maxSpreadPct > 0 && useAltBroker) {
        try {
          const price = await (useKraken ? this.krakenConn!.getAssetPrice(symbol)
            : useBinance ? this.binanceConn!.getAssetPrice(symbol)
            : this.oandaConn!.getAssetPrice(symbol));
          // Approximate spread check: compare entry price vs last candle close
          // A true bid/ask would need a separate API call; this is a lightweight proxy
          // that catches abnormal spread conditions (illiquid hours, post-news gaps)
          const recentCandles = await candleFetcher(symbol, 60, 2);
          if (recentCandles.length >= 2) {
            const lastClose = recentCandles[recentCandles.length - 1].close;
            const spreadPct = Math.abs(price - lastClose) / lastClose * 100;
            if (spreadPct > config.maxSpreadPct) {
              scanResults.push({ symbol, action: "volatility", note: `Spread ${spreadPct.toFixed(3)}% > max ${config.maxSpreadPct}%` });
              continue;
            }
          }
        } catch { /* ignore spread check failure */ }
      }

      // Plancher de confiance dynamique basé sur le payout : uniquement un
      // durcissement optionnel AU-DESSUS du seuil déjà validé par le
      // conseiller (Math.max) — jamais plus permissif, sinon le bot pourrait
      // trader en dessous de ce que le conseiller aurait classé "à prendre".
      let effectiveMinConfidence = config.minConfidence;
      if (config.dynamicMinConfidence && !isMultiplier && !useAltBroker) {
        // Pre-fetch payout to calibrate confidence threshold
        const prePayout = await this.conn.getPayoutRatio({
          symbol, amount: effectiveStake, contractType: analysis.direction, durationMinutes: Math.max(analysis.suggestedDuration, minContractMinutes(symbol)),
        }).catch(() => null);
        if (prePayout !== null) {
          effectiveMinConfidence = Math.max(config.minConfidence, computeDynamicMinConfidence(prePayout, config.dynamicConfidenceMargin, config.minConfidence));
        }
      }
      if (analysis.confidence < effectiveMinConfidence) {
        scanResults.push({ symbol, action: "low-confidence", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement, note: `Seuil dyn: ${effectiveMinConfidence}` });
        continue;
      }

      // Stake for THIS trade: Kelly (per-symbol measured edge from this user's
      // own bot_trades history) when enabled and enough of a sample exists,
      // otherwise the fixed/percent/adaptive stake already computed above.
      let stakeForTrade = effectiveStake;
      // BOOM900's currently available Deriv multiplier contract caps the
      // amount at $0.90. Keep this isolated: other presets retain their
      // ordinary stake floor and cannot inherit this broker-specific cap.
      if (this.preset === "boom900") stakeForTrade = Math.min(0.9, stakeForTrade);
      if (config.stakeMode === "kelly") {
        const kellyStake = computeKellyStakeServer(
          this.userId, symbol, this.config.mode === "live" ? "live" : "demo",
          currentBalance ?? effectiveStake, config.kellyFraction,
        );
        if (kellyStake !== null) {
          stakeForTrade = config.adaptiveStake ? computeAdaptiveStake(kellyStake, logs) : kellyStake;
        }
      }

      // ── Progressive stake reduction after consecutive losses ──
      if (config.progressiveStakeReduction) {
        const consecLosses = countConsecutiveLosses(logs, symbol);
        if (consecLosses > 0) {
          stakeForTrade = computeProgressiveStake(stakeForTrade, consecLosses);
        }
      }

      // Boom500's two strategies have independent risk budgets. This is
      // calculated from balance, never from a martingale or tick count.
      const boom500Level = this.preset === "boom" ? boom500Levels.get(symbol) : undefined;
      const vol75Level = this.preset === "vol75" ? vol75Levels.get(symbol) : undefined;
      if (boom500Level && currentBalance && currentBalance > 0) {
        stakeForTrade = Math.max(1, Math.round(currentBalance * (boom500Level.riskPct / 100) * 100) / 100);
      }
      if (vol75Level && currentBalance && currentBalance > 0) {
        stakeForTrade = Math.max(1, Math.round(currentBalance * (vol75Level.riskPct / 100) * 100) / 100);
      }

      // Gold presets are sized from the stop, not from an arbitrary stake.
      // With an ATR stop, the $ loss for a $1 multiplier position is
      // proportional to multiplier × ATR%; solve that relation backwards.
      // The 0.25%-of-equity target is still capped by the configured daily
      // loss budget split across the permitted losing streak. If OANDA's
      // minimum trade unit cannot respect that cap, placeMarketOrder rejects
      // it before an order reaches the broker.
      if (isGoldPreset(this.preset) && config.broker === "oanda" && isMultiplier) {
        if (!currentBalance || currentBalance <= 0) {
          scanResults.push({ symbol, action: "no-signal", note: "Solde indisponible : sizing risque 0,25% impossible" });
          continue;
        }
        const perTradeBudget = config.maxDailyLossUsd / Math.max(1, config.maxConsecutiveLosses);
        const riskTarget = Math.min(currentBalance * 0.0025, perTradeBudget);
        const effMultiplier = effectiveMultiplier(symbol, config.multiplierLevel);
        const perStakeRisk = Math.min(1, Math.max(0.0001, effMultiplier * analysis.volatilityPct * config.atrStopMultiple / 100));
        const minimumStop = computeAtrStopUsd(1, effMultiplier, analysis.volatilityPct, config.atrStopMultiple, config.riskRewardRatio).stopLossUsd;
        if (riskTarget < minimumStop) {
          scanResults.push({ symbol, action: "no-signal", note: `Risque cible $${riskTarget.toFixed(2)} inférieur au stop minimal $${minimumStop.toFixed(2)}` });
          continue;
        }
        stakeForTrade = Math.round((riskTarget / perStakeRisk) * 100) / 100;
      }

      // Duration alignment and the payout-ratio floor are binary-only concepts
      // (fixed expiry, and a "payout" that only exists for a fixed-odds
      // contract). Multiplier, Kraken/Binance spot, and OANDA spot have neither.
      let tradeDuration = 0;
      if (!isMultiplier && !useAltBroker) {
        // ── Dynamic duration based on ATR ──
        if (config.dynamicDuration) {
          // High volatility = shorter duration (capture the move faster)
          // Low volatility = longer duration (give the trade more time to develop)
          const atrFactor = analysis.volatilityPct > 2 ? 0.7 : analysis.volatilityPct < 0.3 ? 1.5 : 1.0;
          tradeDuration = Math.round(Math.max(analysis.suggestedDuration, minContractMinutes(symbol)) * atrFactor);
          tradeDuration = Math.max(minContractMinutes(symbol), Math.min(60, tradeDuration));
        } else {
          tradeDuration = Math.max(analysis.suggestedDuration, minContractMinutes(symbol));
        }
        // Confidence alone doesn't guard against a thin payout — Deriv's actual
        // payout varies by instrument/duration/volatility, and a low one raises
        // the win rate needed just to break even. Read-only quote, no money
        // committed; a null result (quote unavailable) doesn't block the trade.
        const payoutRatio = await this.conn.getPayoutRatio({
          symbol, amount: stakeForTrade, contractType: analysis.direction, durationMinutes: tradeDuration,
        });
        if (payoutRatio !== null && payoutRatio < config.minPayoutRatio) {
          scanResults.push({
            symbol, action: "low-payout", direction: analysis.direction, confidence: analysis.confidence,
            note: `Payout ${(payoutRatio * 100).toFixed(0)}% < min ${(config.minPayoutRatio * 100).toFixed(0)}%`,
          });
          continue;
        }
      }

      // The manual-trading notification is emitted only after every quality,
      // correlation, confidence, spread and payout gate above has passed.
      // It is therefore an actionable setup, not a generic market alert.
      this.notifyManualOpportunity(symbol, analysis.direction, analysis.confidence, analysis.agreement);

      // ── Signal qualifies — place the trade ──
      // stats omitted (undefined) — no extra SQL in the 60s tick; the
      // resulting reasons/risk skip only the EV-history line explainOpportunity
      // would otherwise add, everything else (confidence/agreement/volatility
      // wording) is identical to what the advisor would show for this symbol.
      const tradeReasons = explainOpportunity("take", analysis, thresholds);
      const tradeRisk = riskLevelFor(analysis);
      scanResults.push({ symbol, action: "traded", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement, note: tradeReasons.join(" · ") });
      newTradesThisTick++;

      // Reserve the symbol NOW, before any network round-trip. trackContract/
      // trackXXXPosition only mark a symbol active once the buy call resolves,
      // which left a window where two overlapping evaluations of the same
      // symbol (two engine instances for the same user — see the registry
      // note above ServerBotEngine) both saw it "free" and both bought.
      // Confirmed live: duplicate real contracts opened <500ms apart, same
      // symbol/direction/stake, distinct contract IDs. Released in the catch
      // below if the buy itself fails — success paths re-set it harmlessly.
      this.activeSymbols.set(symbol, analysis.direction);

      let entryPrice = 0;
      try {
        if (useKraken) {
          entryPrice = await this.krakenConn!.getAssetPrice(symbol);
        } else if (useBinance) {
          entryPrice = await this.binanceConn!.getAssetPrice(symbol);
        } else if (useOanda) {
          entryPrice = await this.oandaConn!.getAssetPrice(symbol);
        } else {
          const entryCandles = await fetchCandlesServer(symbol, 60, 1);
          entryPrice = entryCandles[entryCandles.length - 1]?.close ?? 0;
        }
      } catch { /* ignore */ }

      // A missing broker price must stop execution. Falling back to `1` made
      // XAU/USD sizing explode (notional / 1) and produced an impossible
      // 22,096-unit OANDA order. A signal remains valid, but it is not
      // executable until OANDA supplies a real price on the next scan.
      if (useOanda && (!Number.isFinite(entryPrice) || entryPrice <= 0)) {
        this.activeSymbols.delete(symbol);
        const note = "OANDA: prix d’entrée indisponible — ordre non envoyé";
        scanResults.push({ symbol, action: "session-closed", note });
        this.emit({
          id: `srv_${Date.now()}_${symbol}`,
          time: Date.now(), symbol,
          direction: analysis.direction === "CALL" ? "MULTUP" : "MULTDOWN",
          stake: stakeForTrade, payout: 0, profit: 0,
          confidence: Math.round(analysis.confidence), tfAgreement: analysis.agreement,
          status: "error", note,
        });
        continue;
      }

      // stop_loss/take_profit are absolute $ amounts Deriv expects, derived
      // from the stake so they scale with adaptive/percent/Kelly sizing.
      // ATR mode ties the distance to the symbol's actual current volatility
      // instead of a flat % of stake that's blind to market conditions.
      // Uses the EFFECTIVE multiplier (post crypto cap), not the raw config
      // value — computing the stop off the uncapped level while the order
      // opens at the capped one silently doubled the intended stop distance
      // for crypto (20 assumed vs 10 actually applied on the wire).
      const effMultiplier = effectiveMultiplier(symbol, config.multiplierLevel);
      const useAtrStop = multiplierOverride?.atrStopMode ?? config.atrStopMode;
      // Scalping's stop/target come from the structural swing high/low found
      // at signal time (scalpingLevels, populated above), not ATR or a flat
      // % of stake — see scalping-signal.server.ts.
      const scalpingLevel = this.preset === "scalping" ? scalpingLevels.get(symbol) : undefined;
      const crash500Level = this.preset === "crash500" ? crash500Levels.get(symbol) : undefined;
      const structuralLevel = scalpingLevel ?? crash500Level ?? boom500Level ?? vol75Level;
      const { stopLossUsd, takeProfitUsd } = structuralLevel
        ? computeStructuralStopUsd(stakeForTrade, effMultiplier, entryPrice, structuralLevel.riskAbs, structuralLevel.rewardAbs)
        : useAtrStop
        ? computeAtrStopUsd(
            stakeForTrade, effMultiplier, analysis.volatilityPct,
            multiplierOverride?.atrStopMultiple ?? config.atrStopMultiple,
            multiplierOverride?.riskRewardRatio ?? config.riskRewardRatio,
          )
        : {
            stopLossUsd: Math.round(stakeForTrade * ((multiplierOverride?.stopLossPctOfStake ?? config.stopLossPctOfStake) / 100) * 100) / 100,
            takeProfitUsd: Math.round(stakeForTrade * ((multiplierOverride?.takeProfitPctOfStake ?? config.takeProfitPctOfStake) / 100) * 100) / 100,
          };

      const brokerLabel = useKraken ? "Kraken" : useBinance ? "Binance" : useOanda ? "OANDA" : "serveur";
      const pendingLog: TradeLog = {
        id: `srv_${Date.now()}_${symbol}`,
        time: Date.now(),
        symbol,
        direction: useAltBroker ? (analysis.direction === "CALL" ? "MULTUP" : "MULTDOWN") : (isMultiplier ? (analysis.direction === "CALL" ? "MULTUP" : "MULTDOWN") : analysis.direction),
        stake: stakeForTrade,
        payout: 0,
        status: "pending",
        profit: 0,
        confidence: Math.round(analysis.confidence),
        tfAgreement: analysis.agreement,
        note: `${(crash500Level ?? boom500Level ?? vol75Level) ? `${(crash500Level ?? boom500Level ?? vol75Level)!.strategy} · ${(crash500Level ?? boom500Level ?? vol75Level)!.reason} · ` : ""}${brokerLabel} · TAS ${analysis.trendAlignmentScore}/4 · risque ${tradeRisk} · ${tradeReasons.join(" · ")}`,
        strategy: boom500Level?.strategy ?? crash500Level?.strategy ?? vol75Level?.strategy,
        entryPrice: entryPrice || undefined,
        components: analysis.components,
        ...(useAltBroker
          ? { multiplier: 1, stopLossUsd, takeProfitUsd }
          : isMultiplier
            ? { multiplier: effMultiplier, stopLossUsd, takeProfitUsd }
            : { durationMinutes: tradeDuration, expiry: Date.now() + tradeDuration * 60_000 }),
      };
      this.emit(pendingLog);

      try {
        if (useKraken) {
          // Kraken spot: buy/sell the base asset at market price
          const volume = stakeForTrade / (entryPrice || 1);
          const slPrice = analysis.direction === "CALL"
            ? entryPrice * (1 - stopLossUsd / stakeForTrade)
            : entryPrice * (1 + stopLossUsd / stakeForTrade);
          const tpPrice = analysis.direction === "CALL"
            ? entryPrice * (1 + takeProfitUsd / stakeForTrade)
            : entryPrice * (1 - takeProfitUsd / stakeForTrade);

          const bought = await this.krakenConn!.placeMarketOrder({
            symbol,
            direction: analysis.direction === "CALL" ? "BUY" : "SELL",
            volume,
            stopLossPrice: slPrice,
            takeProfitPrice: tpPrice,
          });
          const fakeContractId = Math.abs(bought.orderId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
          const openLog: TradeLog = { ...pendingLog, status: "open", contractId: fakeContractId };
          this.emit(openLog);
          this.trackKrakenPosition(openLog, bought.orderId, volume);
        } else if (useBinance) {
          // Binance spot: buy with USD amount or sell base amount
          const baseAmount = stakeForTrade / (entryPrice || 1);
          const slPrice = analysis.direction === "CALL"
            ? entryPrice * (1 - stopLossUsd / stakeForTrade)
            : entryPrice * (1 + stopLossUsd / stakeForTrade);
          const tpPrice = analysis.direction === "CALL"
            ? entryPrice * (1 + takeProfitUsd / stakeForTrade)
            : entryPrice * (1 - takeProfitUsd / stakeForTrade);

          const bought = await this.binanceConn!.placeMarketOrder({
            symbol,
            direction: analysis.direction === "CALL" ? "BUY" : "SELL",
            quoteAmount: stakeForTrade,
            baseAmount: analysis.direction === "PUT" ? baseAmount : undefined,
            stopLossPrice: slPrice,
            takeProfitPrice: tpPrice,
          });
          const openLog: TradeLog = { ...pendingLog, status: "open", contractId: bought.orderId };
          this.emit(openLog);
          this.trackBinancePosition(openLog, bought.orderId, baseAmount);
        } else if (useOanda) {
          // OANDA spot forex, margin-traded like the Deriv Multiplier product —
          // sized with the same leverage (effMultiplier) so stopLossPctOfStake/
          // takeProfitPctOfStake map to realistic price distances. Unlevered
          // stake/price sizing needed a ~50%/100% price move on EUR/USD to ever
          // trigger — a move that never happens, so the stop/target were dead
          // code and every position would ride to the maxHoldMinutes force-close
          // instead (audit finding).
          const leveredNotional = stakeForTrade * effMultiplier;
          const units = Math.round((leveredNotional / entryPrice) * 1000) / 1000;
          const slPrice = analysis.direction === "CALL"
            ? entryPrice * (1 - stopLossUsd / leveredNotional)
            : entryPrice * (1 + stopLossUsd / leveredNotional);
          const tpPrice = analysis.direction === "CALL"
            ? entryPrice * (1 + takeProfitUsd / leveredNotional)
            : entryPrice * (1 - takeProfitUsd / leveredNotional);

          const bought = await this.oandaConn!.placeMarketOrder({
            symbol,
            direction: analysis.direction === "CALL" ? "BUY" : "SELL",
            units,
            stopLossPrice: slPrice,
            takeProfitPrice: tpPrice,
          });
          const tradeId = Number(bought.orderId);
          if (!Number.isSafeInteger(tradeId) || tradeId <= 0) throw new Error("OANDA: identifiant de trade invalide");
          const openLog: TradeLog = { ...pendingLog, status: "open", contractId: tradeId };
          this.emit(openLog);
          this.trackOandaPosition(openLog, bought.orderId, bought.units);
        } else if (isMultiplier) {
          const bought = await this.conn.proposeAndBuyMultiplier({
            symbol, amount: stakeForTrade, direction: analysis.direction,
            multiplier: effMultiplier, stopLossUsd, takeProfitUsd,
          });
          const openLog: TradeLog = { ...pendingLog, status: "open", contractId: bought.contractId };
          this.emit(openLog);
          this.trackMultiplierPosition(openLog);
        } else {
          const bought = await this.conn.proposeAndBuy({
            symbol,
            amount: stakeForTrade,
            contractType: analysis.direction,
            durationMinutes: tradeDuration,
          });
          const openLog: TradeLog = { ...pendingLog, status: "open", payout: bought.payout, contractId: bought.contractId };
          this.emit(openLog);
          this.trackContract(openLog);
        }
      } catch (e) {
        this.activeSymbols.delete(symbol); // release the reservation — no position was actually opened
        this.emit({ ...pendingLog, status: "error", profit: 0, note: `Échec: ${(e as Error).message}` });
        if (this.preset === "boom900") {
          const error = e instanceof DerivApiError
            ? { code: e.code, message: e.message }
            : { code: "TEMPORARILY_DISABLED", message: (e as Error).message };
          const status = error.code === "SYMBOL_UNAVAILABLE" || error.code === "CONTRACT_UNAVAILABLE"
            ? "CONTRACT_UNAVAILABLE"
            : error.code === "INVALID_MULTIPLIER"
              ? "INVALID_MULTIPLIER"
              : /amount|stake/i.test(error.code) || /amount|stake/i.test(error.message)
                ? "INVALID_STAKE"
                : /authoriz|account|restrict/i.test(error.code) || /authoriz|account|restrict/i.test(error.message)
                  ? "ACCOUNT_RESTRICTED"
                  : "TEMPORARILY_DISABLED";
          const nextConfig = {
            ...this.config,
            boom900ContractStatus: {
              status,
              at: Date.now(),
              contractType: analysis.direction === "CALL" ? "MULTUP" : "MULTDOWN",
              multiplier: effMultiplier,
              amount: stakeForTrade,
              error,
            },
          } as AutoTraderConfig;
          updateConfigForUser(this.userId, "boom900", nextConfig);
          stopBotForUser(this.userId, "boom900", `Contrat Boom900 suspendu : ${error.code}`);
          return finishScan();
        }
        this.symbolCooldowns.set(symbol, Date.now() + 10 * 60_000);
      }
    }

    finishScan();
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

// Backed by globalThis (via a global Symbol key, not a plain module variable)
// so it survives this module being re-evaluated — Vite HMR in dev, or any
// other reload of this file's dependency graph. Without this, a reload resets
// `engines` to a fresh empty Map while the PREVIOUS engine's setInterval keeps
// running, orphaned and invisible to isBotRunning/startBotForUser. Those then
// happily start a second engine for the same user, and both zombie + new
// engine end up trading the same signals on the same real Deriv account —
// this is how the duplicate-contract bug (see the activeSymbols reservation
// above) actually occurred in practice, not just the intra-tick race.
// Keyed by "${userId}:${preset}" (engineKey) rather than userId alone — one
// user can now have up to three engines registered at once (2026-08-01).
const ENGINES_KEY = Symbol.for("lio23.bot_engines_registry");
const engines: Map<string, ServerBotEngine> =
  (globalThis as Record<symbol, unknown>)[ENGINES_KEY] as Map<string, ServerBotEngine>
  ?? ((globalThis as Record<symbol, unknown>)[ENGINES_KEY] = new Map<string, ServerBotEngine>());

export function isBotRunning(userId: number, preset: Preset): boolean {
  return engines.has(engineKey(userId, preset));
}

/** Every preset currently registered as running for this user — used where a
 * caller genuinely needs "is ANY engine up" rather than one specific preset
 * (e.g. picking a live connection to reuse for a balance check). */
function runningPresetsFor(userId: number): Preset[] {
  const prefix = `${userId}:`;
  const out: Preset[] = [];
  for (const key of engines.keys()) {
    if (key.startsWith(prefix)) out.push(key.slice(prefix.length) as Preset);
  }
  return out;
}

// Fields worth logging to config_changes for the "compare performance
// before/after" view — the ones that actually change trading behavior
// (risk caps, entry filters, TP/SL/leverage, watchlist). Deliberately not
// every AutoTraderConfig field: things like mode or adaptiveStake toggle
// don't have a comparable "did this help" question in the same way.
const CONFIG_CHANGE_FIELDS: readonly (keyof AutoTraderConfig)[] = [
  "stakeUsd", "maxDailyLossUsd", "maxDailyProfitUsd",
  "minConfidence", "maxConfidence", "minTfAgreement",
  "takeProfitPctOfStake", "stopLossPctOfStake", "multiplierLevel",
  "symbols", "excludedSymbols",
];

function stableStringify(v: unknown): string {
  return Array.isArray(v) ? JSON.stringify([...v].sort()) : JSON.stringify(v);
}

export type ConfigChangeSource = "user" | "admin" | "auto-rollback";

/** Diffs `oldConfig` vs `newConfig` on CONFIG_CHANGE_FIELDS and, if anything
 * changed, records a config_changes row so the admin panel can show
 * performance right before vs. right after this exact edit. */
function logConfigChange(userId: number, preset: Preset, oldConfig: AutoTraderConfig | null, newConfig: AutoTraderConfig, changedBy: number | undefined, source: ConfigChangeSource): void {
  if (!oldConfig) return; // first-ever config for this user/preset — nothing to diff against
  const fields: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of CONFIG_CHANGE_FIELDS) {
    const from = oldConfig[key];
    const to = newConfig[key];
    if (stableStringify(from) !== stableStringify(to)) fields[key] = { from, to };
  }
  if (Object.keys(fields).length === 0) return;
  getDb()
    .prepare("INSERT INTO config_changes (id, user_id, preset, changed_at, changed_by, fields, source) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(`cfg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, userId, preset, Date.now(), changedBy ?? null, JSON.stringify(fields), source);
}

/**
 * Persists a config change to bot_state and, if this user's bot is currently
 * running, hot-swaps it into the live engine so it applies on the next scan
 * tick instead of waiting for a manual stop/restart. Also logs a
 * config_changes row for whatever performance-relevant fields moved, so
 * their effect can be measured after the fact (see logConfigChange above).
 * `source` defaults from `changedBy` (admin id present → "admin" edit,
 * absent → the account's own "user" edit) — pass `"auto-rollback"` explicitly
 * from config-rollback-guardian.server.ts so its reverts are never mistaken
 * for a fresh human edit worth re-judging.
 */
export function updateConfigForUser(userId: number, preset: Preset, config: AutoTraderConfig, changedBy?: number, source?: ConfigChangeSource): void {
  config = lockPresetSymbols(preset, isGoldPreset(preset) ? lockGoldOanda(config) : config);
  const db = getDb();
  const oldRow = db.prepare("SELECT config FROM bot_state WHERE user_id = ? AND preset = ?").get(userId, preset) as { config: string } | undefined;
  const oldConfig = oldRow ? (JSON.parse(oldRow.config) as AutoTraderConfig) : null;

  db.prepare("UPDATE bot_state SET config = ?, updated_at = unixepoch() WHERE user_id = ? AND preset = ?")
    .run(JSON.stringify(config), userId, preset);
  logConfigChange(userId, preset, oldConfig, config, changedBy, source ?? (changedBy ? "admin" : "user"));
  engines.get(engineKey(userId, preset))?.updateConfig(config);
}

/**
 * True if this user has any position still open on Deriv. Used to hold off
 * stopping a bot (auto-backtest sweep) until those positions actually clear
 * — stop() tears down every contract subscription and timer, orphaning any
 * open position: no more live P&L updates, and the maxHoldMinutes force-
 * close never fires because nothing is left running to fire it. Observed
 * live 2026-07-15: a bot got stopped by an unfavorable verdict with 3 open
 * positions (one +$30+ floating), frozen mid-flight with no tracking.
 */
export function hasOpenPositions(userId: number, preset: Preset): boolean {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM bot_trades WHERE user_id = ? AND preset = ? AND status = 'open'`)
    .get(userId, preset) as { n: number };
  return row.n > 0;
}

export function getBotRuntime(userId: number, preset: Preset): { running: boolean; pausedUntil: number | null; lastScan: ScanResult | null; lastError: string | null } {
  const engine = engines.get(engineKey(userId, preset));
  if (!engine) return { running: false, pausedUntil: null, lastScan: null, lastError: null };
  const paused = engine.pausedUntil;
  return { running: true, pausedUntil: paused > Date.now() ? paused : null, lastScan: engine.lastScan, lastError: engine.lastError };
}

/** Manual Boom900 revalidation: only Deriv metadata + a proposal, never buy. */
export async function revalidateBoom900ContractForUser(userId: number) {
  const settings = getDb().prepare("SELECT deriv_token FROM user_settings WHERE user_id = ?").get(userId) as { deriv_token?: string } | undefined;
  const config = loadBotConfig(userId, "boom900");
  if (!settings?.deriv_token || !config) throw new Error("Compte Deriv ou configuration Boom900 introuvable.");
  const connection = new DerivTradingConnection(settings.deriv_token, "demo");
  try {
    const result = await connection.validateMultiplierContract({ symbol: "BOOM900", direction: "CALL", multiplier: config.multiplierLevel, amount: config.stakeUsd });
    const next = { ...config, boom900ContractStatus: result } as AutoTraderConfig;
    updateConfigForUser(userId, "boom900", next);
    // Re-enable only after a real valid proposal. An invalid proposal leaves
    // the temporary suspension intact.
    if (result.status === "AVAILABLE") getDb().prepare("UPDATE bot_state SET enabled = 1, updated_at = unixepoch() WHERE user_id = ? AND preset = 'boom900'").run(userId);
    return result;
  } finally { connection.close(); }
}

// Account/broker balances are the same regardless of which preset's engine
// answers — reuses whichever engine happens to be running (any of the three)
// for a live connection, falling back to stored credentials + the "default"
// preset's broker toggles if none are up.
export async function getBrokerBalances(userId: number): Promise<{
  deriv: { balance: number; currency: string } | null;
  kraken: { balance: number; currency: string } | null;
  binance: { balance: number; currency: string } | null;
  oanda: { balance: number; currency: string } | null;
}> {
  const anyRunning = runningPresetsFor(userId)[0];
  const engine = anyRunning ? engines.get(engineKey(userId, anyRunning)) : undefined;
  if (engine) {
    return engine.getBalances();
  }

  // Bot not running — fetch balances directly from stored credentials
  const settings = getDb()
    .prepare("SELECT deriv_token, kraken_api_key, kraken_api_secret, binance_api_key, binance_api_secret, oanda_api_key, oanda_account_id, oanda_is_practice FROM user_settings WHERE user_id = ?")
    .get(userId) as { deriv_token?: string; kraken_api_key?: string; kraken_api_secret?: string; binance_api_key?: string; binance_api_secret?: string; oanda_api_key?: string; oanda_account_id?: string; oanda_is_practice?: number } | undefined;

  if (!settings) return { deriv: null, kraken: null, binance: null, oanda: null };

  const config = loadBotConfig(userId, "default");
  const enableDeriv = config?.enableDeriv ?? true;
  const enableKraken = config?.enableKraken ?? true;
  const enableBinance = config?.enableBinance ?? true;
  const enableOanda = config?.enableOanda ?? true;
  const mode = config?.mode === "live" ? "live" : "demo";

  const [deriv, kraken, binance, oanda] = await Promise.all([
    enableDeriv && settings.deriv_token
      ? new DerivTradingConnection(settings.deriv_token, mode).getBalance().catch(() => null)
      : null,
    enableKraken && settings.kraken_api_key && settings.kraken_api_secret
      ? new KrakenTradingConnection(settings.kraken_api_key, settings.kraken_api_secret).getBalance().catch(() => null)
      : null,
    enableBinance && settings.binance_api_key && settings.binance_api_secret
      ? new BinanceTradingConnection(settings.binance_api_key, settings.binance_api_secret).getBalance().catch(() => null)
      : null,
    enableOanda && settings.oanda_api_key && settings.oanda_account_id
      ? new OandaTradingConnection(settings.oanda_api_key, settings.oanda_account_id, !!settings.oanda_is_practice).getBalance().catch(() => null)
      : null,
  ]);

  return { deriv, kraken, binance, oanda };
}

export async function startBotForUser(userId: number, preset: Preset, config: AutoTraderConfig): Promise<void> {
  if (!ACTIVE_PRESETS.includes(preset)) throw new Error("Ce preset est désactivé et ne peut plus être démarré.");
  config = lockPresetSymbols(preset, isGoldPreset(preset) ? lockGoldOanda(config) : config);
  if (engines.has(engineKey(userId, preset))) return;
  // Defense-in-depth against a stale persisted config from before "simulation"
  // was removed as a selectable mode — TradingMode no longer allows it, so this
  // is a runtime-only guard against old bot_state/localStorage rows.
  if ((config.mode as string) === "simulation") throw new Error("Mode simulation obsolète — repasse en Démo ou Live.");

  const account = getDb().prepare("SELECT status, is_admin FROM users WHERE id = ?").get(userId) as { status: string; is_admin: number } | undefined;
  if (!account || (!account.is_admin && account.status !== "approved")) {
    throw new Error("Ce compte n'est pas approuvé : démarrage du bot refusé.");
  }

  const settings = getDb()
    .prepare("SELECT deriv_token, kraken_api_key, kraken_api_secret, binance_api_key, binance_api_secret, oanda_api_key, oanda_account_id, oanda_is_practice FROM user_settings WHERE user_id = ?")
    .get(userId) as { deriv_token?: string; kraken_api_key?: string; kraken_api_secret?: string; binance_api_key?: string; binance_api_secret?: string; oanda_api_key?: string; oanda_account_id?: string; oanda_is_practice?: number } | undefined;

  // Deriv connection (forex/or binaire + multiplier)
  let derivToken: string | null = null;
  if (settings?.deriv_token && (config.enableDeriv ?? true)) {
    derivToken = settings.deriv_token;
  }

  // Kraken connection (crypto spot)
  let krakenConn: KrakenTradingConnection | null = null;
  if (settings?.kraken_api_key && settings?.kraken_api_secret && (config.enableKraken ?? true)) {
    krakenConn = new KrakenTradingConnection(settings.kraken_api_key, settings.kraken_api_secret);
  }

  // Binance connection (crypto spot — for users in regions where Binance is available)
  let binanceConn: BinanceTradingConnection | null = null;
  if (settings?.binance_api_key && settings?.binance_api_secret && (config.enableBinance ?? true)) {
    binanceConn = new BinanceTradingConnection(settings.binance_api_key, settings.binance_api_secret);
  }

  // OANDA connection (forex spot — for users in Canada)
  let oandaConn: OandaTradingConnection | null = null;
  if (settings?.oanda_api_key && settings?.oanda_account_id && (config.enableOanda ?? true)) {
    oandaConn = new OandaTradingConnection(settings.oanda_api_key, settings.oanda_account_id, !!settings.oanda_is_practice);
  }

  // Gold presets are an OANDA Practice-only experiment. They have different
  // position sizing from Deriv, so an unavailable or live OANDA account is a
  // hard start failure rather than an execution fallback.
  if (isGoldPreset(preset)) {
    if (config.mode !== "demo") throw new Error("Les presets Gold sont limités au mode Démo.");
    if (config.broker !== "oanda" || !oandaConn || !settings?.oanda_is_practice) {
      throw new Error("Les presets Gold exigent un compte OANDA Practice configuré et activé.");
    }
  }

  // Deriv is the universal fallback for presets that select it — every symbol Kraken/Binance/OANDA can
  // trade also has a Deriv route (crypto via Multiplier, forex via CALL/PUT
  // or Multiplier), and the scan loop already falls back to it transparently
  // whenever an alt-broker connection is null (isKrakenSymbol(s) && this.
  // krakenConn !== null, etc.) — so Deriv is the only broker that's ever
  // truly required to start. Kraken/Binance/OANDA stay enabled-by-default
  // (DEFAULT_CONFIG) for every user regardless of whether THEY personally
  // set up those keys, so hard-blocking startup on missing alt-broker
  // credentials broke the bot for every user except the one account that
  // happened to have Kraken/OANDA keys configured (audit finding).
  const needsDeriv = config.enableDeriv ?? true;

  if (needsDeriv && !derivToken) {
    throw new Error("Deriv est activé mais aucun token enregistré — va dans Paramètres ou désactive Deriv.");
  }

  getDb().prepare(`
    INSERT INTO bot_state (user_id, preset, enabled, config, paused_until, updated_at) VALUES (?, ?, 1, ?, NULL, unixepoch())
    ON CONFLICT(user_id, preset) DO UPDATE SET enabled = 1, config = excluded.config, paused_until = NULL, updated_at = unixepoch()
  `).run(userId, preset, JSON.stringify(config));

  const engine = new ServerBotEngine(userId, preset, config, derivToken ?? "", krakenConn, binanceConn, oandaConn);
  engines.set(engineKey(userId, preset), engine);
  await engine.reconcile().catch(() => {});
  engine.start();
  console.log(`[bot] Moteur serveur démarré pour user ${userId} preset ${preset} (mode ${config.mode})`);
  void (async () => {
    try {
      const { sendPushToUser } = await import("./push.server");
      await sendPushToUser(userId, {
        title: "Auto-trader démarré",
        body: `Le bot serveur est actif en mode ${config.mode === "live" ? "Réel" : "Démo"}.`,
        url: "/autotrader",
      });
    } catch (e) {
      console.error(`[bot] Push démarré échoué pour user ${userId}:`, (e as Error).message);
    }
  })();
}

export function stopBotForUser(userId: number, preset: Preset, reason = "Arrêt manuel"): void {
  getDb().prepare("UPDATE bot_state SET enabled = 0, updated_at = unixepoch() WHERE user_id = ? AND preset = ?").run(userId, preset);
  const engine = engines.get(engineKey(userId, preset));
  if (engine) {
    // A full stop() tears down every contract subscription and timer —
    // orphaning any position still open (no more live P&L updates, its
    // maxHoldMinutes force-close never fires; see hasOpenPositions' doc
    // comment for the 2026-07-15 incident). Scanning stops immediately
    // either way; only the connection teardown is deferred until the last
    // open position actually closes (engine.emit() finalizes it then).
    if (hasOpenPositions(userId, preset)) {
      engine.stopScanning(reason);
      console.log(`[bot] Scan arrêté pour user ${userId} preset ${preset} (${reason}) — position(s) ouverte(s), moteur maintenu le temps qu'elles se clôturent`);
    } else {
      engine.stop();
      engines.delete(engineKey(userId, preset));
      console.log(`[bot] Moteur serveur arrêté pour user ${userId} preset ${preset} (${reason})`);
    }

    void (async () => {
      try {
        const { sendPushToUser } = await import("./push.server");
        await sendPushToUser(userId, {
          title: "Auto-trader arrêté",
          body: reason,
          url: "/autotrader",
        });
      } catch (e) {
        console.error(`[bot] Push d'arrêt utilisateur échoué pour user ${userId}:`, (e as Error).message);
      }
    })();

    void (async () => {
      try {
        const admins = getDb().prepare("SELECT id FROM users WHERE is_admin = 1").all() as { id: number }[];
        if (!admins.length) return;
        const user = getDb().prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;
        if (!user) return;

        const { sendPushToUser } = await import("./push.server");
        const payload = {
          title: `Bot arrêté : ${user.username}`,
          body: reason,
          url: "/admin",
        };
        await Promise.allSettled(admins.map((admin) => sendPushToUser(admin.id, payload)));
      } catch (e) {
        console.error(`[bot] Notification Push admin échouée pour user ${userId}:`, (e as Error).message);
      }
    })();
  }
}

/** Disable future scans for every preset while keeping existing contract
 * subscriptions alive until their positions settle. This is the safe action
 * for an account revocation: stopping outright would orphan open positions. */
export function suspendBotsForUser(userId: number, reason = "Compte suspendu"): void {
  const until = Date.now() + 10 * 365 * 24 * 60 * 60 * 1000;
  getDb().prepare("UPDATE bot_state SET enabled = 0, paused_until = ?, updated_at = unixepoch() WHERE user_id = ?").run(until, userId);
  console.log(`[bot] Tous les scans suspendus pour user ${userId} (${reason})`);
}

/**
 * Process shutdown (SIGTERM at deploy/restart): stop every engine and close
 * its Deriv socket WITHOUT touching bot_state.enabled — unlike stopBotForUser,
 * these bots must come back via restoreBots() when the new process boots.
 * Open WebSockets were what kept the old process alive ~90s past SIGTERM
 * until systemd SIGKILLed it (a full 502 window on every deploy).
 */
export function shutdownAllEngines(): void {
  for (const engine of engines.values()) {
    try { engine.stop(); } catch { /* closing anyway */ }
  }
  engines.clear();
  closePublicSocket();
  closeKrakenSocket();
  closeBinanceSocket();
  closeOandaSocket();
}

/** Called once at server boot: resume every (user, preset) bot that was
 * enabled before the restart — up to three per user now. */
export async function restoreBots(): Promise<void> {
  const rows = getDb().prepare(
    "SELECT bs.user_id, bs.preset FROM bot_state bs JOIN users u ON u.id = bs.user_id WHERE bs.enabled = 1 AND (u.is_admin = 1 OR u.status = 'approved')",
  ).all() as { user_id: number; preset: Preset }[];
  for (const { user_id, preset } of rows) {
    if (!ACTIVE_PRESETS.includes(preset)) {
      // Leave any already-open broker position untouched; this only prevents
      // the retired engine from resuming scans after the restart.
      getDb().prepare("UPDATE bot_state SET enabled = 0, updated_at = unixepoch() WHERE user_id = ? AND preset = ?").run(user_id, preset);
      continue;
    }
    try {
      const config = loadBotConfig(user_id, preset);
      if (!config) continue;
      await startBotForUser(user_id, preset, config);
    } catch (e) {
      console.error(`[bot] Restauration échouée pour user ${user_id} preset ${preset}:`, (e as Error).message);
    }
  }
  if (rows.length) console.log(`[bot] ${rows.length} bot(s) restauré(s) après redémarrage`);
}

export function getBotTrades(userId: number, preset: Preset, limit = 20): TradeLog[] {
  return loadRecentTrades(userId, preset, limit);
}

export function getOpenBotTrades(userId: number, preset: Preset): TradeLog[] {
  return loadOpenOrPendingTrades(userId, preset);
}

/**
 * Admin force-trade: executes a manual trade on behalf of a user via their
 * running bot engine's Deriv connection. Requires the engine to be running
 * (so the Deriv connection is established). Returns the trade log.
 */
export async function forceTradeForUser(
  userId: number,
  preset: Preset,
  opts: { symbol: string; direction: "CALL" | "PUT" | "MULTUP" | "MULTDOWN"; stake: number; durationMinutes: number },
): Promise<TradeLog> {
  const engine = engines.get(engineKey(userId, preset));
  if (!engine) throw new Error(`Bot non actif pour user ${userId} preset ${preset} — démarrez le bot d'abord.`);
  return engine.forceTrade(opts);
}
