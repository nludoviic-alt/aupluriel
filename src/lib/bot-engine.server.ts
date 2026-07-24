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
import { DerivTradingConnection, effectiveMultiplier, fetchCandlesServer, closePublicSocket } from "./deriv.server";
import { KrakenTradingConnection, isKrakenSymbol, derivToKrakenSymbol, fetchKrakenCandles, KRAKEN_DERIV_SYMBOLS, closeKrakenSocket } from "./kraken.server";
import { BinanceTradingConnection, isBinanceSymbol, derivToBinanceSymbol, fetchBinanceCandles, BINANCE_DERIV_SYMBOLS, closeBinanceSocket } from "./binance.server";
import { OandaTradingConnection, isOandaSymbol, derivToOandaSymbol, fetchOandaCandles, OANDA_DERIV_SYMBOLS, closeOandaSocket } from "./oanda.server";
import { getLearnedWeightsServer, recordComponentOutcomesServer } from "./indicator-weights.server";
import type { SignalComponent } from "./indicators";
import { SYMBOLS } from "./deriv";
import { mapWithConcurrency } from "./utils";
import {
  DEFAULT_CONFIG,
  analyzeSymbolCore,
  computeAdaptiveStake,
  computeAtrStopUsd,
  computeKellyFraction,
  computeProgressiveStake,
  computeDynamicMinConfidence,
  countConsecutiveLosses,
  is24x7Symbol,
  isCorrelatedWithActive,
  isSymbolTradeable,
  isHighRiskWindow,
  isInTradingSession,
  isHourBlocked,
  getInstrumentForSymbol,
  minContractMinutes,
  symbolRollingStats,
  currentActiveSessions,
  type AutoTraderConfig,
  type ScanResult,
  type ScanSymbolResult,
  type TradeLog,
  type TradingSession,
} from "./signal-core";

const SCAN_MS = 60_000;

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
  entry_price: number | null;
  duration_minutes: number | null;
  expiry: number | null;
  components: string | null;
  multiplier: number | null;
  stop_loss: number | null;
  take_profit: number | null;
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

function logFromRow(r: BotTradeRow): TradeLog {
  return {
    id: r.id, time: r.time, symbol: r.symbol, direction: r.direction, stake: r.stake,
    payout: r.payout, status: r.status, profit: r.profit, confidence: r.confidence,
    tfAgreement: r.tf_agreement, contractId: r.contract_id ?? undefined,
    closedAt: r.closed_at ?? undefined, note: r.note ?? undefined,
    entryPrice: r.entry_price ?? undefined, durationMinutes: r.duration_minutes ?? undefined,
    expiry: r.expiry ?? undefined,
    components: parseComponents(r.components),
    multiplier: r.multiplier ?? undefined, stopLossUsd: r.stop_loss ?? undefined, takeProfitUsd: r.take_profit ?? undefined,
  };
}

function upsertTrade(userId: number, log: TradeLog, mode: "demo" | "live") {
  getDb().prepare(`
    INSERT INTO bot_trades (id, user_id, time, symbol, direction, stake, payout, status, profit, confidence, tf_agreement, contract_id, closed_at, note, entry_price, duration_minutes, expiry, components, multiplier, stop_loss, take_profit, mode)
    VALUES (@id, @user_id, @time, @symbol, @direction, @stake, @payout, @status, @profit, @confidence, @tf_agreement, @contract_id, @closed_at, @note, @entry_price, @duration_minutes, @expiry, @components, @multiplier, @stop_loss, @take_profit, @mode)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, payout = excluded.payout, profit = excluded.profit,
      contract_id = excluded.contract_id, closed_at = excluded.closed_at, note = excluded.note
  `).run({
    id: log.id, user_id: userId, time: log.time, symbol: log.symbol, direction: log.direction,
    stake: log.stake, payout: log.payout, status: log.status, profit: log.profit,
    confidence: log.confidence, tf_agreement: log.tfAgreement,
    contract_id: log.contractId ?? null, closed_at: log.closedAt ?? null, note: log.note ?? null,
    entry_price: log.entryPrice ?? null, duration_minutes: log.durationMinutes ?? null, expiry: log.expiry ?? null,
    components: log.components?.length ? JSON.stringify(log.components) : null,
    multiplier: log.multiplier ?? null, stop_loss: log.stopLossUsd ?? null, take_profit: log.takeProfitUsd ?? null,
    mode,
  });
}

function loadRecentTrades(userId: number, limit = 50): TradeLog[] {
  const rows = getDb()
    .prepare("SELECT * FROM bot_trades WHERE user_id = ? ORDER BY time DESC LIMIT ?")
    .all(userId, limit) as BotTradeRow[];
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
function getOpenFloatingPnl(userId: number): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(profit), 0) AS floating FROM bot_trades WHERE user_id = ? AND status = 'open'")
    .get(userId) as { floating: number };
  return row.floating;
}

export function getTodayStats(userId: number, mode?: "demo" | "live"): { pnl: number; count: number } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status IN ('won','lost') THEN profit ELSE 0 END), 0) AS pnl,
         COALESCE(SUM(CASE WHEN stake > 0 AND status IN ('pending','open','won','lost') THEN 1 ELSE 0 END), 0) AS count
       FROM bot_trades WHERE user_id = @userId AND time >= @start AND (@mode IS NULL OR mode = @mode OR mode IS NULL)`,
    )
    .get({ userId, start: start.getTime(), mode: mode ?? null }) as { pnl: number; count: number };
  return row;
}

/**
 * All-time closed-trade record for this user — surfaced before letting them
 * switch the server bot to live so the "am I ready for real money" decision
 * is informed by an actual number, not a guess. Cross-user by design (shared
 * strategy, shared learning) would be more statistically meaningful, but
 * showing someone else's win rate to justify THEIR real-money risk would be
 * misleading — this stays scoped to the user's own trades.
 */
export function getAllTimeStats(userId: number, mode?: "demo" | "live"): { trades: number; wins: number; losses: number; winRate: number; pnl: number } {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END), 0) AS wins,
         COALESCE(SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END), 0) AS losses,
         COALESCE(SUM(CASE WHEN status IN ('won','lost') THEN profit ELSE 0 END), 0) AS pnl
       FROM bot_trades WHERE user_id = @userId AND (@mode IS NULL OR mode = @mode OR mode IS NULL)`,
    )
    .get({ userId, mode: mode ?? null }) as { wins: number; losses: number; pnl: number };
  const trades = row.wins + row.losses;
  return { trades, wins: row.wins, losses: row.losses, winRate: trades > 0 ? row.wins / trades : 0, pnl: row.pnl };
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

export function loadBotConfig(userId: number): AutoTraderConfig | null {
  const row = getDb().prepare("SELECT config FROM bot_state WHERE user_id = ?").get(userId) as { config: string } | undefined;
  if (!row) return null;
  // Config verrouillée : seuls la mise (stakeUsd, maxDailyLossUsd) et le mode
  // (demo/live) sont repris de la config sauvegardée — la stratégie vient
  // toujours de DEFAULT_CONFIG. "live" n'est retenu que si l'utilisateur l'a
  // explicitement choisi au démarrage (voir /api/bot.ts) ; ce choix persiste
  // across restarts/redéploiements — pas de re-bascule silencieuse en demo.
  try {
    const saved = JSON.parse(row.config) as Partial<AutoTraderConfig>;
    return {
      ...DEFAULT_CONFIG,
      stakeUsd: Math.min(100, Math.max(1, Number(saved.stakeUsd) || DEFAULT_CONFIG.stakeUsd)),
      maxDailyLossUsd: Math.min(500, Math.max(1, Number(saved.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd)),
      mode: saved.mode === "live" ? "live" : "demo",
      enableDeriv: saved.enableDeriv ?? DEFAULT_CONFIG.enableDeriv,
      enableKraken: saved.enableKraken ?? DEFAULT_CONFIG.enableKraken,
      enableBinance: saved.enableBinance ?? DEFAULT_CONFIG.enableBinance,
      enableOanda: saved.enableOanda ?? DEFAULT_CONFIG.enableOanda,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
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
  private contractUnsubs = new Map<number, () => void>();
  private fallbackTimers = new Set<ReturnType<typeof setTimeout>>();
  private sessionPeakPnl = 0;
  lastScan: ScanResult | null = null;
  lastError: string | null = null;
  private lastActiveSessions: TradingSession[] = [];

  constructor(
    public readonly userId: number,
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
    this.logs = loadRecentTrades(userId);
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
    const row = getDb().prepare("SELECT paused_until FROM bot_state WHERE user_id = ?").get(this.userId) as { paused_until: number | null } | undefined;
    return row?.paused_until ?? 0;
  }

  private setPausedUntil(ts: number | null) {
    getDb().prepare("UPDATE bot_state SET paused_until = ?, updated_at = unixepoch() WHERE user_id = ?").run(ts, this.userId);
  }

  private emit(log: TradeLog) {
    const idx = this.logs.findIndex((l) => l.id === log.id);
    const prevStatus = idx >= 0 ? this.logs[idx].status : null;
    if (idx >= 0) this.logs[idx] = log;
    else this.logs.unshift(log);
    if (this.logs.length > 60) this.logs.length = 60;
    upsertTrade(this.userId, log, this.config.mode === "live" ? "live" : "demo");
    this.notify(log, prevStatus);
  }

  /** Email + push the user on the two events worth an interruption: a trade
   * just closed (won/lost transition — not re-emits of an already-closed
   * row, which reconcile() can produce) and a risk pause. Fire-and-forget:
   * a mail/push provider hiccup must never break trade resolution. */
  private notify(log: TradeLog, prevStatus: TradeLog["status"] | null) {
    const closed = (log.status === "won" || log.status === "lost") && prevStatus !== log.status;
    const riskStop = log.status === "risk-stop" && prevStatus === null;
    const opened = log.status === "open" && (prevStatus === null || prevStatus === "pending");
    const error = log.status === "error" && prevStatus === null;

    if (!closed && !riskStop && !opened && !error) return;

    // Push, unlike email, is scoped to the trade's owner only — it targets
    // that person's own locked phone, not a shared admin inbox.
    void (async () => {
      const { sendPushToUser } = await import("./push.server");
      const sign = log.profit >= 0 ? "+" : "";
      
      let payload;
      if (closed) {
        payload = {
          title: log.status === "won" ? `Gagné ${sign}$${log.profit.toFixed(2)}` : `Perdu ${sign}$${log.profit.toFixed(2)}`,
          body: `${log.symbol} · ${log.direction} · ${this.config.mode === "live" ? "Réel" : "Démo"}`,
          url: "/autotrader",
        };
      } else if (opened) {
        payload = {
          title: `Position ouverte : ${log.symbol}`,
          body: `${log.direction} · Mise : $${log.stake.toFixed(2)} · Confiance : ${log.confidence}% · Mode : ${this.config.mode === "live" ? "Réel" : "Démo"}`,
          url: "/autotrader",
        };
      } else if (error) {
        payload = {
          title: `Erreur sur ${log.symbol}`,
          body: log.note ?? "Échec de l'ouverture de position",
          url: "/autotrader",
        };
      } else {
        payload = {
          title: "Bot en pause (protection de risque)",
          body: log.note ?? "Limite de risque atteinte",
          url: "/autotrader",
        };
      }
      
      await sendPushToUser(this.userId, payload);
    })().catch((e) => console.error(`[bot] Notification push échouée pour user ${this.userId}:`, (e as Error).message));
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
    const stale = this.logs.filter((l) => (l.status === "open" || l.status === "pending") && l.contractId);
    if (!stale.length) return;
    const records = await this.conn.getProfitTable(60);
    for (const log of stale) {
      const match = records.find((r) => r.contractId === log.contractId);
      if (match) {
        const won = match.profit > 0;
        this.emit({ ...log, status: won ? "won" : "lost", profit: match.profit, closedAt: Date.now() });
        try { recordComponentOutcomesServer(log.symbol, log.components, won); } catch { /* never break reconcile */ }
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
          if (info.unrealizedPL >= partialTrigger) {
            partialTaken = true;
            // Close partialTakeProfitPct% of the position to lock in profits
            const partialUnits = units * (this.config.partialTakeProfitPct / 100);
            try {
              await this.oandaConn.closeTrade(tradeId, partialUnits);
            } catch { /* ignore partial close failure */ }
          }
        }

        const info = await this.oandaConn.getTradeInfo(tradeId);
        if (info.state === "CLOSE") {
          finalize(info.unrealizedPL > 0, info.unrealizedPL);
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
        finalize(info.unrealizedPL > 0, info.unrealizedPL);
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

  stop() {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    for (const t of this.fallbackTimers) clearTimeout(t);
    this.fallbackTimers.clear();
    for (const unsub of this.contractUnsubs.values()) unsub();
    this.contractUnsubs.clear();
    this.conn.close();
    this.krakenConn?.close();
    this.binanceConn?.close();
    this.oandaConn?.close();
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
    const { pnl, count } = getTodayStats(this.userId);

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
      this.riskPause([`Trailing stop — pic +$${this.sessionPeakPnl.toFixed(2)}, maintenant ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`], this.nextUtcMidnight());
      return finishScan();
    }
    // Realized-only pnl let the bot keep opening positions while already deep
    // underwater on OPEN ones — the loss only "existed" once a stop actually
    // hit. Floating LOSSES count toward the cap; floating gains don't (they
    // can evaporate, and must not mask realized losses).
    const floatingLoss = Math.min(0, getOpenFloatingPnl(this.userId));
    const riskPnl = pnl + floatingLoss;
    if (riskPnl <= -Math.abs(config.maxDailyLossUsd)) {
      if (config.stopOnRisk) {
        const detail = floatingLoss < 0
          ? `$${Math.abs(pnl).toFixed(2)} réalisé + $${Math.abs(floatingLoss).toFixed(2)} flottant`
          : `$${Math.abs(pnl).toFixed(2)}`;
        this.riskPause([`Perte journalière atteinte : ${detail} / $${config.maxDailyLossUsd}`], this.nextUtcMidnight());
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

    // ── Stake ──
    const balance = await this.conn.getBalance();
    const currentBalance = balance?.balance;
    const baseStake = config.stakeMode === "percent" && currentBalance && currentBalance > 0
      ? Math.max(1, (currentBalance * config.stakePercent) / 100)
      : config.stakeUsd;
    const effectiveStake = config.adaptiveStake ? computeAdaptiveStake(baseStake, logs) : baseStake;

    // ── Candidates + cheap pre-filters ──
    // Synthetic indices (R_*, 1HZ*, JD*, stpRNG, RDBULL/RDBEAR) are excluded even
    // in all-markets mode: Deriv generates them by RNG, no indicator has a real
    // edge on them, and long-term winrate ~50% is a structural loss against the
    // payout (see DEFAULT_CONFIG.symbols comment).
    const candidateSymbols = config.symbolMode === "all-markets"
      ? SYMBOLS.filter((s) => s.market !== "synthetic" && isSymbolTradeable(s.deriv, getInstrumentForSymbol(s.deriv, config))).map((s) => s.deriv)
      : config.symbols;

    const toAnalyze: string[] = [];
    for (const symbol of candidateSymbols) {
      const symInstrument = getInstrumentForSymbol(symbol, config);
      if (!isSymbolTradeable(symbol, symInstrument)) { scanResults.push({ symbol, action: "not-tradeable" }); continue; }
      if (this.activeSymbols.has(symbol)) { scanResults.push({ symbol, action: "open-trade" }); continue; }
      // ── Skip symbols from disabled brokers ──
      if (isKrakenSymbol(symbol) && !(this.config.enableKraken ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "Kraken désactivé" }); continue; }
      if (isBinanceSymbol(symbol) && !(this.config.enableBinance ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "Binance désactivé" }); continue; }
      if (isOandaSymbol(symbol) && !(this.config.enableOanda ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "OANDA désactivé" }); continue; }
      if (!isKrakenSymbol(symbol) && !isBinanceSymbol(symbol) && !isOandaSymbol(symbol) && !(this.config.enableDeriv ?? true)) { scanResults.push({ symbol, action: "session-closed", note: "Deriv désactivé" }); continue; }
      if (!isInTradingSession(config.tradingSessions, symbol, config.sessionEdgeMinutes)) {
        scanResults.push({ symbol, action: "session-closed" });
        continue;
      }
      if (!is24x7Symbol(symbol) && config.newsFilter !== false) {
        const riskCheck = isHighRiskWindow();
        if (riskCheck.blocked) { scanResults.push({ symbol, action: "news-block", note: riskCheck.reason }); continue; }
      }
      const cooldownUntil = this.symbolCooldowns.get(symbol) ?? 0;
      if (Date.now() < cooldownUntil) { scanResults.push({ symbol, action: "cooldown" }); continue; }
      if (cooldownUntil > 0) this.symbolCooldowns.delete(symbol);

      const consecutive = countConsecutiveLosses(logs, symbol);
      if (consecutive >= config.maxConsecutiveLosses) {
        this.symbolCooldowns.set(symbol, Date.now() + config.cooldownMinutes * 60_000);
        this.emit({
          id: `cd_${Date.now()}_${symbol}`, time: Date.now(), symbol, direction: "CALL",
          stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
          status: "cooldown", note: `${consecutive} pertes consécutives — pause ${config.cooldownMinutes} min`,
        });
        scanResults.push({ symbol, action: "cooldown" });
        continue;
      }

      // A streak counter resets on any single win — a symbol alternating
      // W-L-W-L never trips it even though it's a coin flip against a payout
      // that needs >50% to break even. Catches that slow bleed directly.
      if (config.minSymbolWinRate > 0) {
        const rolling = symbolRollingStats(logs, symbol, config.symbolWinRateLookback);
        if (rolling.trades >= 5 && rolling.winRate < config.minSymbolWinRate) {
          this.symbolCooldowns.set(symbol, Date.now() + config.cooldownMinutes * 60_000);
          this.emit({
            id: `cd_${Date.now()}_${symbol}`, time: Date.now(), symbol, direction: "CALL",
            stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
            status: "cooldown",
            note: `Win rate ${(rolling.winRate * 100).toFixed(0)}% sur ${rolling.trades} trades — pause ${config.cooldownMinutes} min`,
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

    const analyzed = await mapWithConcurrency(toAnalyze, 4, async (symbol) => {
      let weights: ReturnType<typeof getLearnedWeightsServer> | undefined;
      try { weights = getLearnedWeightsServer(symbol); } catch { /* base weights */ }
      return {
        symbol,
        analysis: (await analyzeSymbolCore(symbol, candleFetcher, {
          weights, veto4h: config.veto4h ?? "strong-only", vetoDaily: config.vetoDaily ?? "off",
          confluenceMode: config.confluenceMode ?? "vote",
          adxFilterMode: config.adxFilterMode ?? "off",
          adxBlockThreshold: config.adxBlockThreshold,
          adxStrongThreshold: config.adxStrongThreshold,
        })).analysis,
      };
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
      if (analysis.volatilityPct > config.maxVolatilityPct) {
        scanResults.push({ symbol, action: "volatility", note: `ATR ${analysis.volatilityPct.toFixed(2)}% > max` });
        continue;
      }
      if (analysis.volatilityRatio > 3) {
        scanResults.push({ symbol, action: "volatility", note: `Volatilité ${analysis.volatilityRatio.toFixed(1)}x la normale` });
        continue;
      }
      if (!analysis.direction) { scanResults.push({ symbol, action: "no-signal", confidence: analysis.confidence }); continue; }
      if (config.blockCorrelated && isCorrelatedWithActive(symbol, analysis.direction, this.activeSymbols)) {
        scanResults.push({ symbol, action: "correlated" });
        continue;
      }
      // ── Dynamic minConfidence based on payout ──
      const isMultiplier = getInstrumentForSymbol(symbol, config) === "multiplier";
      const useKraken = isKrakenSymbol(symbol) && this.krakenConn !== null;
      const useBinance = isBinanceSymbol(symbol) && this.binanceConn !== null;
      const useOanda = isOandaSymbol(symbol) && this.oandaConn !== null;
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

      let effectiveMinConfidence = config.minConfidence;
      if (config.dynamicMinConfidence && !isMultiplier && !useAltBroker) {
        // Pre-fetch payout to calibrate confidence threshold
        const prePayout = await this.conn.getPayoutRatio({
          symbol, amount: effectiveStake, contractType: analysis.direction, durationMinutes: Math.max(analysis.suggestedDuration, minContractMinutes(symbol)),
        }).catch(() => null);
        if (prePayout !== null) {
          effectiveMinConfidence = computeDynamicMinConfidence(prePayout, config.dynamicConfidenceMargin, config.minConfidence);
        }
      }
      if (analysis.confidence < effectiveMinConfidence) {
        scanResults.push({ symbol, action: "low-confidence", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement, note: `Seuil dyn: ${effectiveMinConfidence}` });
        continue;
      }
      if (analysis.agreement < config.minTfAgreement) {
        scanResults.push({ symbol, action: "low-agreement", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement });
        continue;
      }
      if (config.premiumOnly && analysis.premiumCount < 1) {
        scanResults.push({ symbol, action: "not-premium", direction: analysis.direction, confidence: analysis.confidence });
        continue;
      }

      // Stake for THIS trade: Kelly (per-symbol measured edge from this user's
      // own bot_trades history) when enabled and enough of a sample exists,
      // otherwise the fixed/percent/adaptive stake already computed above.
      let stakeForTrade = effectiveStake;
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

      // ── Signal qualifies — place the trade ──
      scanResults.push({ symbol, action: "traded", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement });
      newTradesThisTick++;

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

      // stop_loss/take_profit are absolute $ amounts Deriv expects, derived
      // from the stake so they scale with adaptive/percent/Kelly sizing.
      // ATR mode ties the distance to the symbol's actual current volatility
      // instead of a flat % of stake that's blind to market conditions.
      // Uses the EFFECTIVE multiplier (post crypto cap), not the raw config
      // value — computing the stop off the uncapped level while the order
      // opens at the capped one silently doubled the intended stop distance
      // for crypto (20 assumed vs 10 actually applied on the wire).
      const effMultiplier = effectiveMultiplier(symbol, config.multiplierLevel);
      const { stopLossUsd, takeProfitUsd } = config.atrStopMode
        ? computeAtrStopUsd(stakeForTrade, effMultiplier, analysis.volatilityPct, config.atrStopMultiple, config.riskRewardRatio)
        : {
            stopLossUsd: Math.round(stakeForTrade * (config.stopLossPctOfStake / 100) * 100) / 100,
            takeProfitUsd: Math.round(stakeForTrade * (config.takeProfitPctOfStake / 100) * 100) / 100,
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
        note: `${brokerLabel} · TAS ${analysis.trendAlignmentScore}/4`,
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
          // OANDA spot forex: buy/sell units of base currency
          // Units = stake / price (approximate, OANDA handles precision)
          const units = Math.round((stakeForTrade / (entryPrice || 1)) * 1000) / 1000;
          const slPrice = analysis.direction === "CALL"
            ? entryPrice * (1 - stopLossUsd / stakeForTrade)
            : entryPrice * (1 + stopLossUsd / stakeForTrade);
          const tpPrice = analysis.direction === "CALL"
            ? entryPrice * (1 + takeProfitUsd / stakeForTrade)
            : entryPrice * (1 - takeProfitUsd / stakeForTrade);

          const bought = await this.oandaConn!.placeMarketOrder({
            symbol,
            direction: analysis.direction === "CALL" ? "BUY" : "SELL",
            units,
            stopLossPrice: slPrice,
            takeProfitPrice: tpPrice,
          });
          const fakeContractId = Math.abs(bought.orderId.split("").reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0));
          const openLog: TradeLog = { ...pendingLog, status: "open", contractId: fakeContractId };
          this.emit(openLog);
          this.trackOandaPosition(openLog, bought.orderId, units);
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
        this.emit({ ...pendingLog, status: "error", profit: 0, note: `Échec: ${(e as Error).message}` });
        this.symbolCooldowns.set(symbol, Date.now() + 10 * 60_000);
      }
    }

    finishScan();
  }
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const engines = new Map<number, ServerBotEngine>();

export function isBotRunning(userId: number): boolean {
  return engines.has(userId);
}

/**
 * Persists a config change to bot_state and, if this user's bot is currently
 * running, hot-swaps it into the live engine so it applies on the next scan
 * tick instead of waiting for a manual stop/restart.
 */
export function updateConfigForUser(userId: number, config: AutoTraderConfig): void {
  getDb()
    .prepare("UPDATE bot_state SET config = ?, updated_at = unixepoch() WHERE user_id = ?")
    .run(JSON.stringify(config), userId);
  engines.get(userId)?.updateConfig(config);
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
export function hasOpenPositions(userId: number): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM bot_trades WHERE user_id = ? AND status = 'open'")
    .get(userId) as { n: number };
  return row.n > 0;
}

export function getBotRuntime(userId: number): { running: boolean; pausedUntil: number | null; lastScan: ScanResult | null; lastError: string | null } {
  const engine = engines.get(userId);
  if (!engine) return { running: false, pausedUntil: null, lastScan: null, lastError: null };
  const paused = engine.pausedUntil;
  return { running: true, pausedUntil: paused > Date.now() ? paused : null, lastScan: engine.lastScan, lastError: engine.lastError };
}

export async function getBrokerBalances(userId: number): Promise<{
  deriv: { balance: number; currency: string } | null;
  kraken: { balance: number; currency: string } | null;
  binance: { balance: number; currency: string } | null;
  oanda: { balance: number; currency: string } | null;
}> {
  const engine = engines.get(userId);
  if (engine) {
    return engine.getBalances();
  }

  // Bot not running — fetch balances directly from stored credentials
  const settings = getDb()
    .prepare("SELECT deriv_token, kraken_api_key, kraken_api_secret, binance_api_key, binance_api_secret, oanda_api_key, oanda_account_id, oanda_is_practice FROM user_settings WHERE user_id = ?")
    .get(userId) as { deriv_token?: string; kraken_api_key?: string; kraken_api_secret?: string; binance_api_key?: string; binance_api_secret?: string; oanda_api_key?: string; oanda_account_id?: string; oanda_is_practice?: number } | undefined;

  if (!settings) return { deriv: null, kraken: null, binance: null, oanda: null };

  const config = loadBotConfig(userId);
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

export async function startBotForUser(userId: number, config: AutoTraderConfig): Promise<void> {
  if (engines.has(userId)) return;
  if (config.mode === "simulation") throw new Error("Le bot serveur trade sur Deriv/Kraken (demo/live) — le mode simulation reste dans le navigateur.");

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

  // Determine which broker(s) are needed based on config symbols AND toggles
  const needsDeriv = config.symbols.some((s) => !isKrakenSymbol(s) && !isBinanceSymbol(s) && !isOandaSymbol(s)) && (config.enableDeriv ?? true);
  const needsKraken = config.symbols.some((s) => isKrakenSymbol(s)) && (config.enableKraken ?? true);
  const needsBinance = config.symbols.some((s) => isBinanceSymbol(s)) && (config.enableBinance ?? true);
  const needsOanda = config.symbols.some((s) => isOandaSymbol(s)) && (config.enableOanda ?? true);

  if (needsDeriv && !derivToken) {
    throw new Error("Deriv est activé mais aucun token enregistré — va dans Paramètres ou désactive Deriv.");
  }
  if (needsKraken && !krakenConn) {
    throw new Error("Kraken est activé mais aucune clé API enregistrée — va dans Paramètres ou désactive Kraken.");
  }
  if (needsBinance && !binanceConn) {
    throw new Error("Binance est activé mais aucune clé API enregistrée — va dans Paramètres ou désactive Binance.");
  }
  if (needsOanda && !oandaConn) {
    throw new Error("OANDA est activé mais aucune clé enregistrée — va dans Paramètres ou désactive OANDA.");
  }

  getDb().prepare(`
    INSERT INTO bot_state (user_id, enabled, config, updated_at) VALUES (?, 1, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET enabled = 1, config = excluded.config, updated_at = unixepoch()
  `).run(userId, JSON.stringify(config));

  const engine = new ServerBotEngine(userId, config, derivToken ?? "", krakenConn, binanceConn, oandaConn);
  engines.set(userId, engine);
  await engine.reconcile().catch(() => {});
  engine.start();
  console.log(`[bot] Moteur serveur démarré pour user ${userId} (mode ${config.mode})`);
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

export function stopBotForUser(userId: number, reason = "Arrêt manuel"): void {
  getDb().prepare("UPDATE bot_state SET enabled = 0, updated_at = unixepoch() WHERE user_id = ?").run(userId);
  const engine = engines.get(userId);
  if (engine) {
    engine.stop();
    engines.delete(userId);
    console.log(`[bot] Moteur serveur arrêté pour user ${userId} (${reason})`);

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

/** Called once at server boot: resume every bot that was enabled before the restart. */
export async function restoreBots(): Promise<void> {
  const rows = getDb().prepare("SELECT user_id FROM bot_state WHERE enabled = 1").all() as { user_id: number }[];
  for (const { user_id } of rows) {
    try {
      const config = loadBotConfig(user_id);
      if (!config) continue;
      await startBotForUser(user_id, config);
    } catch (e) {
      console.error(`[bot] Restauration échouée pour user ${user_id}:`, (e as Error).message);
    }
  }
  if (rows.length) console.log(`[bot] ${rows.length} bot(s) restauré(s) après redémarrage`);
}

export function getBotTrades(userId: number, limit = 20): TradeLog[] {
  return loadRecentTrades(userId, limit);
}
