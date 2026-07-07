// SERVER auto-trader engine — the browser engine's twin, running in the Node
// process so trading continues with the phone locked / app closed. Decision
// logic is the shared signal-core.ts; this file only wires it to the server
// Deriv client (deriv.server.ts) and SQLite instead of WebSocket-in-browser
// and localStorage.
//
// Differences vs the browser engine (documented, deliberate):
// - No custom-strategy overlay and no learned indicator weights (both live in
//   the user's localStorage). Signals use the base calibrated weights.
// - stakeMode "kelly" falls back to fixed/percent (backtest stats are client-side).
// - Trades are persisted to bot_trades; risk pauses to bot_state.paused_until,
//   so a Railway restart resumes exactly where it left off.

import { getDb } from "./db.server";
import { DerivTradingConnection, fetchCandlesServer } from "./deriv.server";
import { SYMBOLS } from "./deriv";
import { mapWithConcurrency } from "./utils";
import {
  DEFAULT_CONFIG,
  analyzeSymbolCore,
  computeAdaptiveStake,
  countConsecutiveLosses,
  is24x7Symbol,
  isCallPutAvailable,
  isCorrelatedWithActive,
  isHighRiskWindow,
  isInTradingSession,
  minContractMinutes,
  todayPnl,
  todayTradeCount,
  type AutoTraderConfig,
  type ScanResult,
  type ScanSymbolResult,
  type TradeLog,
} from "./signal-core";

const SCAN_MS = 60_000;

// ─── DB helpers ───────────────────────────────────────────────────────────────

interface BotTradeRow {
  id: string;
  user_id: number;
  time: number;
  symbol: string;
  direction: "CALL" | "PUT";
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
}

function logFromRow(r: BotTradeRow): TradeLog {
  return {
    id: r.id, time: r.time, symbol: r.symbol, direction: r.direction, stake: r.stake,
    payout: r.payout, status: r.status, profit: r.profit, confidence: r.confidence,
    tfAgreement: r.tf_agreement, contractId: r.contract_id ?? undefined,
    closedAt: r.closed_at ?? undefined, note: r.note ?? undefined,
    entryPrice: r.entry_price ?? undefined, durationMinutes: r.duration_minutes ?? undefined,
    expiry: r.expiry ?? undefined,
  };
}

function upsertTrade(userId: number, log: TradeLog) {
  getDb().prepare(`
    INSERT INTO bot_trades (id, user_id, time, symbol, direction, stake, payout, status, profit, confidence, tf_agreement, contract_id, closed_at, note, entry_price, duration_minutes, expiry)
    VALUES (@id, @user_id, @time, @symbol, @direction, @stake, @payout, @status, @profit, @confidence, @tf_agreement, @contract_id, @closed_at, @note, @entry_price, @duration_minutes, @expiry)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status, payout = excluded.payout, profit = excluded.profit,
      contract_id = excluded.contract_id, closed_at = excluded.closed_at, note = excluded.note
  `).run({
    id: log.id, user_id: userId, time: log.time, symbol: log.symbol, direction: log.direction,
    stake: log.stake, payout: log.payout, status: log.status, profit: log.profit,
    confidence: log.confidence, tf_agreement: log.tfAgreement,
    contract_id: log.contractId ?? null, closed_at: log.closedAt ?? null, note: log.note ?? null,
    entry_price: log.entryPrice ?? null, duration_minutes: log.durationMinutes ?? null, expiry: log.expiry ?? null,
  });
}

function loadRecentTrades(userId: number, limit = 50): TradeLog[] {
  const rows = getDb()
    .prepare("SELECT * FROM bot_trades WHERE user_id = ? ORDER BY time DESC LIMIT ?")
    .all(userId, limit) as BotTradeRow[];
  return rows.map(logFromRow);
}

function loadBotConfig(userId: number): AutoTraderConfig | null {
  const row = getDb().prepare("SELECT config FROM bot_state WHERE user_id = ?").get(userId) as { config: string } | undefined;
  if (!row) return null;
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(row.config) } as AutoTraderConfig;
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
  private logs: TradeLog[];
  private activeSymbols = new Set<string>();
  private symbolCooldowns = new Map<string, number>();
  private contractUnsubs = new Map<number, () => void>();
  private fallbackTimers = new Set<ReturnType<typeof setTimeout>>();
  private sessionPeakPnl = 0;
  lastScan: ScanResult | null = null;
  lastError: string | null = null;

  constructor(
    public readonly userId: number,
    private config: AutoTraderConfig,
    derivToken: string,
  ) {
    this.conn = new DerivTradingConnection(derivToken, config.mode === "live" ? "live" : "demo");
    this.logs = loadRecentTrades(userId);
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
    if (idx >= 0) this.logs[idx] = log;
    else this.logs.unshift(log);
    if (this.logs.length > 60) this.logs.length = 60;
    upsertTrade(this.userId, log);
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
        this.emit({ ...log, status: match.profit > 0 ? "won" : "lost", profit: match.profit, closedAt: Date.now() });
      } else if (log.expiry && Date.now() < log.expiry + 2 * 60_000) {
        this.trackContract(log); // probably still open — re-subscribe
      } else {
        this.emit({ ...log, status: "error", profit: 0, note: "Contrat introuvable après redémarrage", closedAt: Date.now() });
      }
    }
  }

  private trackContract(openLog: TradeLog) {
    const contractId = openLog.contractId!;
    this.activeSymbols.add(openLog.symbol);
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
    const pnl = todayPnl(logs);
    const count = todayTradeCount(logs);
    const scanResults: ScanSymbolResult[] = [];
    const finishScan = () => { this.lastScan = { time: Date.now(), results: scanResults }; };

    // ── Trailing stop / daily limits (pause-with-auto-resume) ──
    if (pnl > this.sessionPeakPnl) this.sessionPeakPnl = pnl;
    if (config.trailingStopUsd > 0 && this.sessionPeakPnl > 0 && pnl < this.sessionPeakPnl - config.trailingStopUsd) {
      this.riskPause([`Trailing stop — pic +$${this.sessionPeakPnl.toFixed(2)}, maintenant ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`], this.nextUtcMidnight());
      return finishScan();
    }
    if (pnl <= -Math.abs(config.maxDailyLossUsd)) {
      if (config.stopOnRisk) this.riskPause([`Perte journalière atteinte : $${Math.abs(pnl).toFixed(2)} / $${config.maxDailyLossUsd}`], this.nextUtcMidnight());
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

    // ── Stake ──
    const balance = await this.conn.getBalance();
    const currentBalance = balance?.balance;
    const baseStake = config.stakeMode === "percent" && currentBalance && currentBalance > 0
      ? Math.max(1, (currentBalance * config.stakePercent) / 100)
      : config.stakeUsd;
    const effectiveStake = config.adaptiveStake ? computeAdaptiveStake(baseStake, logs) : baseStake;

    // ── Candidates + cheap pre-filters ──
    const candidateSymbols = config.symbolMode === "all-markets"
      ? SYMBOLS.filter((s) => isCallPutAvailable(s.deriv)).map((s) => s.deriv)
      : config.symbols;

    const toAnalyze: string[] = [];
    for (const symbol of candidateSymbols) {
      if (!isCallPutAvailable(symbol)) { scanResults.push({ symbol, action: "not-tradeable" }); continue; }
      if (this.activeSymbols.has(symbol)) { scanResults.push({ symbol, action: "open-trade" }); continue; }
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
      toAnalyze.push(symbol);
    }

    if (!toAnalyze.length) return finishScan();

    // ── Analysis (shared decision core, base weights) ──
    const analyzed = await mapWithConcurrency(toAnalyze, 4, async (symbol) => ({
      symbol,
      analysis: (await analyzeSymbolCore(symbol, fetchCandlesServer, { veto4h: config.veto4h ?? "strong-only" })).analysis,
    }));

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
      if (config.blockCorrelated && isCorrelatedWithActive(symbol, this.activeSymbols)) {
        scanResults.push({ symbol, action: "correlated" });
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
      if (analysis.confidence < config.minConfidence) {
        scanResults.push({ symbol, action: "low-confidence", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement });
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

      // ── Signal qualifies — place the trade ──
      scanResults.push({ symbol, action: "traded", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement });
      newTradesThisTick++;

      let entryPrice = 0;
      try {
        const entryCandles = await fetchCandlesServer(symbol, 60, 1);
        entryPrice = entryCandles[entryCandles.length - 1]?.close ?? 0;
      } catch { /* ignore */ }

      const tradeDuration = Math.max(analysis.suggestedDuration, minContractMinutes(symbol));
      const pendingLog: TradeLog = {
        id: `srv_${Date.now()}_${symbol}`,
        time: Date.now(),
        symbol,
        direction: analysis.direction,
        stake: effectiveStake,
        payout: 0,
        status: "pending",
        profit: 0,
        confidence: Math.round(analysis.confidence),
        tfAgreement: analysis.agreement,
        note: `☁️ serveur · TAS ${analysis.trendAlignmentScore}/4`,
        entryPrice: entryPrice || undefined,
        durationMinutes: tradeDuration,
        expiry: Date.now() + tradeDuration * 60_000,
      };
      this.emit(pendingLog);

      try {
        const bought = await this.conn.proposeAndBuy({
          symbol,
          amount: effectiveStake,
          contractType: analysis.direction,
          durationMinutes: tradeDuration,
        });
        const openLog: TradeLog = { ...pendingLog, status: "open", payout: bought.payout, contractId: bought.contractId };
        this.emit(openLog);
        this.trackContract(openLog);
      } catch (e) {
        this.emit({ ...pendingLog, status: "error", profit: 0, note: `Échec: ${(e as Error).message}` });
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

export function getBotRuntime(userId: number): { running: boolean; pausedUntil: number | null; lastScan: ScanResult | null; lastError: string | null } {
  const engine = engines.get(userId);
  if (!engine) return { running: false, pausedUntil: null, lastScan: null, lastError: null };
  const paused = engine.pausedUntil;
  return { running: true, pausedUntil: paused > Date.now() ? paused : null, lastScan: engine.lastScan, lastError: engine.lastError };
}

export async function startBotForUser(userId: number, config: AutoTraderConfig): Promise<void> {
  if (engines.has(userId)) return;
  if (config.mode === "simulation") throw new Error("Le bot serveur trade sur Deriv (demo/live) — le mode simulation reste dans le navigateur.");

  const settings = getDb()
    .prepare("SELECT deriv_token FROM user_settings WHERE user_id = ?")
    .get(userId) as { deriv_token?: string } | undefined;
  if (!settings?.deriv_token) {
    throw new Error("Aucun token Deriv enregistré côté serveur — va dans Paramètres et clique « Tester & enregistrer ».");
  }

  getDb().prepare(`
    INSERT INTO bot_state (user_id, enabled, config, updated_at) VALUES (?, 1, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET enabled = 1, config = excluded.config, updated_at = unixepoch()
  `).run(userId, JSON.stringify(config));

  const engine = new ServerBotEngine(userId, config, settings.deriv_token);
  engines.set(userId, engine);
  await engine.reconcile().catch(() => {});
  engine.start();
  console.log(`[bot] Moteur serveur démarré pour user ${userId} (mode ${config.mode})`);
}

export function stopBotForUser(userId: number): void {
  getDb().prepare("UPDATE bot_state SET enabled = 0, updated_at = unixepoch() WHERE user_id = ?").run(userId);
  const engine = engines.get(userId);
  if (engine) {
    engine.stop();
    engines.delete(userId);
    console.log(`[bot] Moteur serveur arrêté pour user ${userId}`);
  }
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
