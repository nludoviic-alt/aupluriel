// BROWSER auto-trading engine. The pure decision logic (signal aggregation,
// sessions, news windows, risk math) lives in signal-core.ts, shared with the
// server engine (bot-engine.server.ts) so the two can never drift apart.
// Only executes trades when strict signal quality thresholds are met.

import { fetchCandles, proposalContract, buyContract, subscribeContract, getProfitTable, getOpenPositions, GRANULARITY, getBalance, SYMBOLS } from "./deriv";
import { generateSignal, rsi, macd, ema, bollinger } from "./indicators";
import { evaluateStrategies } from "./strategies";
import { getLearnedWeights, recordComponentOutcomes } from "./indicator-weights";
import { mapWithConcurrency } from "./utils";
import {
  DEFAULT_CONFIG,
  TIMEFRAMES,
  aggregateTfSignals,
  analyzeSymbolCore,
  computeAdaptiveStake,
  computeKellyFraction,
  countConsecutiveLosses,
  is24x7Symbol,
  isCallPutAvailable,
  isCorrelatedWithActive,
  isHighRiskWindow,
  isInTradingSession,
  minContractMinutes,
  symbolRollingStats,
  todayPnl,
  todayTradeCount,
  type AutoTraderConfig,
  type RiskStopHandler,
  type ScanResultHandler,
  type ScanSymbolResult,
  type SymbolAnalysis,
  type TfSignalMap,
  type TradeEventHandler,
  type TradeLog,
  type TradingSession,
  type Veto4hMode,
} from "./signal-core";

// Re-export the shared core so the many existing UI imports from "@/lib/autotrader" keep working.
export * from "./signal-core";

let derivConnected = false;
let lastConnectionCheck = 0;

/** Check if Deriv WebSocket session is active and authenticated (re-checks every 30s) */
async function checkDerivConnection(): Promise<boolean> {
  const now = Date.now();
  if (derivConnected && now - lastConnectionCheck < 30_000) return true;
  try {
    const balance = await getBalance();
    derivConnected = balance !== null;
    lastConnectionCheck = now;
    return derivConnected;
  } catch {
    derivConnected = false;
    return false;
  }
}

/**
 * Robust buy pipeline: Deriv proposal IDs expire within seconds, so each retry
 * MUST request a fresh proposal instead of reusing a stale ID.
 */
async function proposeAndBuy(params: {
  symbol: string;
  amount: number;
  contractType: "CALL" | "PUT";
  durationMinutes: number;
}, maxAttempts = 3): Promise<{ contractId: number; buyPrice: number; payout: number; startTime: number }> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const proposal = await proposalContract(params);
      // Deriv rejects a `price` with >2 decimals — the 1.05 slippage buffer must be re-rounded.
      const maxPrice = Math.round(proposal.askPrice * 1.05 * 100) / 100;
      return await buyContract(proposal.id, maxPrice);
    } catch (e) {
      lastError = e as Error;
      // Validation errors (invalid price/stake/contract) fail identically on retry —
      // only transient failures (proposal expired, network) are worth another attempt.
      if (/price|amount|stake|decimal|invalid|not available|not offered/i.test(lastError.message)) break;
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  throw lastError ?? new Error("Échec achat après plusieurs tentatives");
}

/**
 * Real payout ratio (profit-if-won / stake) for a symbol+duration, fetched as a
 * live quote (no money committed — a proposal is just a price check). Replaces
 * the flat 85% assumption previously hardcoded into simulation P&L and the
 * backtest: real Deriv payouts vary by instrument, duration and volatility.
 * Falls back to 0.85 if no quote can be obtained (e.g. offline / unsupported symbol).
 */
export async function fetchRealPayoutRatio(
  symbol: string,
  durationMinutes: number,
  stakeUsd = 10,
): Promise<number> {
  try {
    const proposal = await proposalContract({ symbol, amount: stakeUsd, contractType: "CALL", durationMinutes });
    const ratio = (proposal.payout - proposal.askPrice) / proposal.askPrice;
    return ratio > 0 && ratio < 5 ? ratio : 0.85;
  } catch {
    return 0.85;
  }
}

/**
 * "Prudent" preset — discipline-focused overrides applied on top of the
 * user's current config. Capital-dependent fields (stake, daily loss,
 * watched symbols) are intentionally preserved so we never guess their size.
 */
export const PRUDENT_CONFIG: Partial<AutoTraderConfig> = {
  mode: "demo",
  minConfidence: 82,
  minTfAgreement: 4,
  maxTradesPerDay: 5,
  maxConsecutiveLosses: 3,
  maxVolatilityPct: 3,
  adaptiveStake: true,
  premiumOnly: true,
  stopOnRisk: true,
  trailingStopUsd: 10,
  blockCorrelated: true,
};

/** Optimized presets for different risk profiles */
export type RiskProfile = "conservative" | "moderate" | "aggressive";

export interface PresetConfig extends Partial<AutoTraderConfig> {
  name: string;
  description: string;
  emoji: string;
  recommendedCapital: string;
  targetWinRate: string;
  expectedTradesPerDay: string;
}

/**
 * CONSERVATIVE - Safety first, steady small wins
 * Best for: Beginners, small accounts ($100-500)
 */
export const CONSERVATIVE_PRESET: PresetConfig = {
  name: "Conservateur",
  description: "Sécurité maximale. 1% par trade, trailing stop activé, signaux premium uniquement.",
  emoji: "🛡️",
  recommendedCapital: "$100-500",
  targetWinRate: "65-70%",
  expectedTradesPerDay: "2-4",
  mode: "demo",
  stakeMode: "percent",
  stakePercent: 1,            // 1% du capital par trade
  stakeUsd: 2,
  durationMinutes: 15,
  minConfidence: 82,          // Seuil élevé — qualité avant quantité
  minTfAgreement: 4,          // Les 4 TF doivent s'aligner
  maxDailyLossUsd: 15,        // ~3-5% d'un capital de $300-500
  maxTradesPerDay: 4,
  maxConsecutiveLosses: 2,
  maxVolatilityPct: 2,
  symbols: ["R_25", "R_50", "frxEURUSD"],
  tradingSessions: ["london", "newyork"],
  adaptiveStake: true,
  premiumOnly: true,
  stopOnRisk: true,
  trailingStopUsd: 8,         // Protège les gains dès +$8 de pic
  blockCorrelated: true,
  sessionEdgeMinutes: 15,
};

/**
 * MODERATE - Balanced risk/reward
 * Best for: Intermediate traders, medium accounts ($500-2000)
 */
export const MODERATE_PRESET: PresetConfig = {
  name: "Modéré",
  description: "Équilibre optimal. 1.5% par trade, corrélation bloquée, overlap London/NY privilégié.",
  emoji: "⚖️",
  recommendedCapital: "$500-2000",
  targetWinRate: "62-67%",
  expectedTradesPerDay: "4-8",
  mode: "demo",
  stakeMode: "percent",
  stakePercent: 1.5,          // 1.5% du capital par trade
  stakeUsd: 5,
  durationMinutes: 10,
  minConfidence: 78,          // Seuil optimisé vs 70% par défaut
  minTfAgreement: 3,          // 3/4 TF en accord
  maxDailyLossUsd: 30,        // ~3% d'un capital de $1000
  maxTradesPerDay: 8,
  maxConsecutiveLosses: 3,
  maxVolatilityPct: 3,
  symbols: ["R_100", "R_50", "frxEURUSD"],
  tradingSessions: ["london", "newyork"],
  adaptiveStake: true,
  premiumOnly: false,
  stopOnRisk: true,
  trailingStopUsd: 15,        // Trailing stop à $15 de drawdown depuis pic
  blockCorrelated: true,
  sessionEdgeMinutes: 0,
};

/**
 * AGGRESSIVE - Maximum trades, higher risk
 * Best for: Experienced traders, large accounts ($2000+)
 */
export const AGGRESSIVE_PRESET: PresetConfig = {
  name: "Agressif",
  description: "Volume maximal. 2% par trade, toutes sessions, signaux 75%+ — surveillance requise.",
  emoji: "🚀",
  recommendedCapital: "$2000+",
  targetWinRate: "58-63%",
  expectedTradesPerDay: "8-15",
  mode: "demo",
  stakeMode: "percent",
  stakePercent: 2,            // 2% du capital par trade
  stakeUsd: 10,
  durationMinutes: 5,
  minConfidence: 75,          // Relevé de 70% → réduit les faux signaux
  minTfAgreement: 3,          // Relevé de 2 → meilleure qualité
  maxDailyLossUsd: 80,        // ~4% d'un capital de $2000
  maxTradesPerDay: 15,
  maxConsecutiveLosses: 4,
  maxVolatilityPct: 5,
  symbols: ["R_100", "R_75", "R_50", "1HZ100V", "frxEURUSD", "frxGBPUSD"],
  tradingSessions: ["asia", "london", "newyork"],
  adaptiveStake: true,
  premiumOnly: false,
  stopOnRisk: true,
  trailingStopUsd: 30,        // Trailing stop à $30 — laisse respirer les positions
  blockCorrelated: true,
  sessionEdgeMinutes: 0,
};

export const PRESETS: Record<RiskProfile, PresetConfig> = {
  conservative: CONSERVATIVE_PRESET,
  moderate: MODERATE_PRESET,
  aggressive: AGGRESSIVE_PRESET,
};

/** Custom user preset with performance tracking */
export interface CustomPreset extends PresetConfig {
  id: string;
  createdAt: number;
  performance?: {
    totalTrades: number;
    winRate: number;
    totalProfit: number;
    lastUsed: number;
  };
}

const CUSTOM_PRESETS_KEY = "lio23.custom_presets";

/** Load custom presets from localStorage */
export function loadCustomPresets(): CustomPreset[] {
  try {
    const data = localStorage.getItem(CUSTOM_PRESETS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/** Save custom presets to localStorage */
export function saveCustomPresets(presets: CustomPreset[]) {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets.slice(0, 10))); // Max 10 presets
  } catch {}
}

/** Save current config as a custom preset */
export function saveCurrentAsPreset(
  config: AutoTraderConfig,
  name: string,
  description: string,
  emoji: string = "💾"
): CustomPreset {
  const presets = loadCustomPresets();
  const newPreset: CustomPreset = {
    id: `custom_${Date.now()}`,
    name,
    description,
    emoji,
    recommendedCapital: "Personnalisé",
    targetWinRate: "En cours de calcul...",
    expectedTradesPerDay: String(config.maxTradesPerDay),
    createdAt: Date.now(),
    ...config,
  };
  saveCustomPresets([newPreset, ...presets]);
  return newPreset;
}

/** Delete a custom preset */
export function deleteCustomPreset(id: string) {
  const presets = loadCustomPresets().filter((p) => p.id !== id);
  saveCustomPresets(presets);
}

/** Update preset performance stats */
export function updatePresetPerformance(
  id: string,
  stats: { totalTrades: number; winRate: number; totalProfit: number }
) {
  const presets = loadCustomPresets();
  const idx = presets.findIndex((p) => p.id === id);
  if (idx >= 0) {
    presets[idx].performance = { ...stats, lastUsed: Date.now() };
    saveCustomPresets(presets);
  }
}

// ─── Risk notification ─────────────────────────────────────────────────────────

export function notifyRiskStop(reasons: string[]) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const n = new Notification("🛑 PLURIEL — Auto-trader ARRÊTÉ (risque détecté)", {
    body: reasons.join("\n"),
    icon: "/favicon.ico",
    tag: "lio23-risk-stop",
    requireInteraction: true,
  });
  setTimeout(() => n.close(), 15000);
}

export function notifyTradeTaken(symbol: string, direction: string, confidence: number) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const n = new Notification(`✅ PLURIEL — Trade pris sur ${symbol}`, {
    body: `${direction} · Confiance ${confidence}% · Position favorable (PREMIUM)`,
    icon: "/favicon.ico",
    tag: `lio23-trade-${symbol}`,
  });
  setTimeout(() => n.close(), 8000);
}

// ─── Real Kelly-criterion stake ────────────────────────────────────────────────
// "adaptiveStake" above is a coarse win-rate-tiered haircut, marketed as "Kelly"
// in the UI but not an actual Kelly calculation. This is: same formula already
// used correctly in risk-calculator.tsx (f* = p - q/b), fed by the REAL measured
// win-rate/payout from backtestMultiTf instead of a value the user guesses.

const BACKTEST_STATS_KEY = "lio23.backtest_stats";

export interface SymbolBacktestStats {
  winRate: number;   // 0-1
  payoutPct: number; // e.g. 0.85
  trades: number;
  updatedAt: number;
}

export function saveBacktestStats(symbol: string, stats: Omit<SymbolBacktestStats, "updatedAt">) {
  try {
    const all = JSON.parse(localStorage.getItem(BACKTEST_STATS_KEY) ?? "{}");
    all[symbol] = { ...stats, updatedAt: Date.now() };
    localStorage.setItem(BACKTEST_STATS_KEY, JSON.stringify(all));
  } catch {}
}

export function loadBacktestStats(symbol: string): SymbolBacktestStats | null {
  try {
    const all = JSON.parse(localStorage.getItem(BACKTEST_STATS_KEY) ?? "{}");
    return all[symbol] ?? null;
  } catch {
    return null;
  }
}

/**
 * Kelly stake for this symbol from its persisted backtest stats, or null if no
 * (or too little) measured data exists yet — callers should fall back to the
 * fixed/percent stake rather than guess. Capped at 5% of balance regardless of
 * what the raw Kelly formula suggests: a short/overfit backtest sample can
 * output an unrealistically large fraction, and this is meant to recalibrate
 * sizing, not to bet the account on one instrument's small sample.
 */
export function computeKellyStake(symbol: string, balance: number, kellyFraction: number): number | null {
  const stats = loadBacktestStats(symbol);
  if (!stats || stats.trades < 20) return null;
  const kelly = computeKellyFraction(stats.winRate, stats.payoutPct);
  if (kelly <= 0) return null; // measured edge is flat/negative — Kelly says don't size up
  const pct = Math.min(kelly * kellyFraction, 0.05);
  return Math.max(1, balance * pct);
}

// ─── Cumulative P&L (persists forever, never resets) ─────────────────────────

const CUMULATIVE_PNL_KEY = "lio23.cumulative_pnl";

export function loadCumulativePnl(): number {
  try { return Number(JSON.parse(localStorage.getItem(CUMULATIVE_PNL_KEY) ?? "0")) || 0; }
  catch { return 0; }
}

export function saveCumulativePnl(amount: number) {
  try { localStorage.setItem(CUMULATIVE_PNL_KEY, JSON.stringify(amount)); } catch {}
}

export function addToCumulativePnl(profit: number): number {
  const next = loadCumulativePnl() + profit;
  saveCumulativePnl(next);
  return next;
}

export function resetCumulativePnl() {
  saveCumulativePnl(0);
}

// ─── Daily P&L rollup (survives log trimming) ─────────────────────────────────
// todayPnl(logs) recomputes from the trade log, but the log is trimmed to its
// most recent entries — once enough events accumulate, the day's earlier wins
// fall out of the window and the displayed daily gain silently shrinks. This
// date-keyed rollup is updated once per closed trade and never trimmed.

const DAILY_PNL_KEY = "lio23.daily_pnl";

export interface DailyPnlRollup { date: string; pnl: number; closed: number }

function localDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function loadDailyPnl(): DailyPnlRollup {
  const empty: DailyPnlRollup = { date: localDateKey(), pnl: 0, closed: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(DAILY_PNL_KEY) ?? "null") as DailyPnlRollup | null;
    if (!stored || stored.date !== localDateKey()) return empty; // new day — resets naturally
    return stored;
  } catch {
    return empty;
  }
}

export function addToDailyPnl(profit: number): DailyPnlRollup {
  const current = loadDailyPnl();
  const next: DailyPnlRollup = { date: current.date, pnl: current.pnl + profit, closed: current.closed + 1 };
  try { localStorage.setItem(DAILY_PNL_KEY, JSON.stringify(next)); } catch {}
  return next;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = "lio23.autotrader_log";

export function loadTradeLog(): TradeLog[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** In-memory cache to avoid repeated localStorage parsing */
let logsCache: TradeLog[] | null = null;

function saveTradeLog(logs: TradeLog[]) {
  try {
    // Keep a generous window: enough for a full day of events (trades + markers)
    // so day-scoped stats computed from the log stay accurate.
    const trimmed = logs.slice(0, 200);
    logsCache = trimmed;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

/** Load logs with caching - much faster than parsing every time */
export function loadTradeLogCached(): TradeLog[] {
  if (logsCache) return logsCache;
  logsCache = loadTradeLog();
  return logsCache;
}

/** Clear cache when needed (e.g., after manual deletion) */
export function clearTradeLogCache() {
  logsCache = null;
}

/**
 * Opens a single DEMO position immediately for previewing the live visual,
 * bypassing the strict signal filters. Direction follows the current signal
 * (fallback CALL). Resolves after `durationMinutes` like a normal demo trade.
 */
export async function openPreviewTrade(
  symbolDeriv: string,
  durationMinutes: number,
  stakeUsd: number,
  onEvent: TradeEventHandler,
) {
  const logs = loadTradeLog();
  const emit = (log: TradeLog) => {
    const idx = logs.findIndex((l) => l.id === log.id);
    if (idx >= 0) logs[idx] = log;
    else logs.unshift(log);
    saveTradeLog(logs);
    onEvent(log);
  };

  let entryPrice = 0;
  let direction: "CALL" | "PUT" = "CALL";
  try {
    const candles = await fetchCandles(symbolDeriv, GRANULARITY["1m"], 60);
    entryPrice = candles[candles.length - 1]?.close ?? 0;
    const sig = generateSignal(candles);
    if (sig.direction === "SELL") direction = "PUT";
    else if (sig.direction === "BUY") direction = "CALL";
  } catch { /* ignore */ }
  const payoutRatio = await fetchRealPayoutRatio(symbolDeriv, durationMinutes, stakeUsd);

  const id = `preview_${Date.now()}_${symbolDeriv}`;
  const base: TradeLog = {
    id,
    time: Date.now(),
    symbol: symbolDeriv,
    direction,
    stake: stakeUsd,
    payout: 0,
    status: "open",
    profit: 0,
    confidence: 0,
    tfAgreement: 0,
    note: "Aperçu",
    entryPrice: entryPrice || undefined,
    durationMinutes,
    expiry: Date.now() + durationMinutes * 60_000,
  };
  emit(base);

  setTimeout(async () => {
    try {
      const candles = await fetchCandles(symbolDeriv, GRANULARITY["1m"], 2);
      const last = candles[candles.length - 1]?.close ?? entryPrice;
      const won = direction === "CALL" ? last > entryPrice : last < entryPrice;
      const profit = won ? stakeUsd * payoutRatio : -stakeUsd;
      emit({ ...base, status: won ? "won" : "lost", profit, payout: won ? stakeUsd + profit : 0, closedAt: Date.now() });
    } catch {
      emit({ ...base, status: "error", profit: 0 });
    }
  }, durationMinutes * 60_000);
}

/**
 * Bypasses signal filters and opens a real trade on the connected Deriv account.
 * Used to verify the Deriv pipeline works end-to-end during testing.
 */
export async function forceDemoTrade(
  symbolDeriv: string,
  direction: "CALL" | "PUT",
  stake: number,
  durationMinutes: number,
  onEvent: TradeEventHandler,
): Promise<void> {
  if (!isCallPutAvailable(symbolDeriv)) {
    throw new Error("CALL/PUT indisponible sur les cryptos — choisis un indice Volatility (R_100…) ou une paire forex");
  }
  durationMinutes = Math.max(durationMinutes, minContractMinutes(symbolDeriv));
  const logs = loadTradeLog();
  const emit = (log: TradeLog) => {
    const idx = logs.findIndex((l) => l.id === log.id);
    if (idx >= 0) logs[idx] = log;
    else logs.unshift(log);
    saveTradeLog(logs);
    clearTradeLogCache();
    onEvent(log);
  };

  let entryPrice = 0;
  try {
    const candles = await fetchCandles(symbolDeriv, GRANULARITY["1m"], 1);
    entryPrice = candles[candles.length - 1]?.close ?? 0;
  } catch { /* ignore */ }

  const logId = `force_${Date.now()}_${symbolDeriv}`;
  const pending: TradeLog = {
    id: logId,
    time: Date.now(),
    symbol: symbolDeriv,
    direction,
    stake,
    payout: 0,
    status: "pending",
    profit: 0,
    confidence: 0,
    tfAgreement: 0,
    note: "Trade forcé (test pipeline)",
    entryPrice: entryPrice || undefined,
    durationMinutes,
    expiry: Date.now() + durationMinutes * 60_000,
  };
  emit(pending);

  try {
    const bought = await proposeAndBuy({ symbol: symbolDeriv, amount: stake, contractType: direction, durationMinutes });

    const openLog: TradeLog = { ...pending, status: "open", payout: bought.payout, contractId: bought.contractId };
    emit(openLog);

    let resolved = false;
    const resolve = (won: boolean, profit: number) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallback);
      unsub();
      // Use the REAL profit reported by Deriv (covers partial payouts and early sells)
      emit({ ...openLog, status: won ? "won" : "lost", profit, closedAt: Date.now() });
    };

    const unsub = subscribeContract(bought.contractId, (update) => {
      if (update.status !== "open") resolve(update.status === "won", update.profit);
    });

    const fallback = setTimeout(async () => {
      if (resolved) return;
      try {
        const records = await getProfitTable(20);
        const match = records.find((r) => r.contractId === bought!.contractId);
        if (match) resolve(match.profit > 0, match.profit);
        else { resolved = true; unsub(); emit({ ...openLog, status: "error", profit: 0, note: "Résolution non reçue" }); }
      } catch {
        if (!resolved) { resolved = true; unsub(); emit({ ...openLog, status: "error", profit: 0, note: "Timeout" }); }
      }
    }, (durationMinutes + 2) * 60_000);
  } catch (e) {
    emit({ ...pending, status: "error", profit: 0, note: `Échec: ${(e as Error).message}` });
  }
}

/**
 * Reconciles locally-tracked "open" trades with the real Deriv account.
 * Called after page reload / session reconnect: any position whose contract
 * subscription was lost is either re-tracked (still open on Deriv) or
 * resolved with the REAL profit from the profit table.
 */
export async function reconcileOpenTrades(onEvent: TradeEventHandler): Promise<void> {
  const logs = loadTradeLog();
  const stale = logs.filter(
    (l) => (l.status === "open" || l.status === "pending") && l.contractId,
  );
  if (!stale.length) return;

  const emit = (log: TradeLog) => {
    const idx = logs.findIndex((l) => l.id === log.id);
    const prev = idx >= 0 ? logs[idx] : null;
    if (idx >= 0) logs[idx] = log;
    saveTradeLog(logs);
    clearTradeLogCache();
    // Un trade réglé pendant l'absence doit compter dans les P&L persistés —
    // sinon ses gains n'apparaissent nulle part (même bug que la troncature).
    if ((log.status === "won" || log.status === "lost") &&
        prev && prev.status !== "won" && prev.status !== "lost") {
      addToCumulativePnl(log.profit);
      addToDailyPnl(log.profit);
      recordComponentOutcomes(log.symbol, log.components, log.status === "won");
    }
    onEvent(log);
  };

  let openIds = new Set<number>();
  try {
    const positions = await getOpenPositions();
    openIds = new Set(positions.map((p) => p.contractId));
  } catch { return; /* not connected — retry on next reconcile */ }

  let profitRecords: Awaited<ReturnType<typeof getProfitTable>> = [];
  try { profitRecords = await getProfitTable(50); } catch { /* ignore */ }

  for (const log of stale) {
    const cid = log.contractId!;
    if (openIds.has(cid)) {
      // Still open on Deriv — re-attach live tracking
      const unsub = subscribeContract(cid, (update) => {
        if (update.status === "open") return;
        unsub();
        emit({ ...log, status: update.status === "won" ? "won" : "lost", profit: update.profit, closedAt: Date.now() });
      });
    } else {
      // Closed while we were away — settle with the real result
      const match = profitRecords.find((r) => r.contractId === cid);
      if (match) {
        emit({ ...log, status: match.profit > 0 ? "won" : "lost", profit: match.profit, closedAt: Date.now() });
      } else {
        emit({ ...log, status: "error", profit: 0, note: "Contrat introuvable — vérifie ton compte Deriv", closedAt: Date.now() });
      }
    }
  }
}

// ─── Signal analysis ──────────────────────────────────────────────────────────

/** rsi/macd/ema/bollinger snapshot at the last closed candle — feeds the custom /strategies engine. */
function computeIndicatorSnapshot(candles: { close: number }[]) {
  const closes = candles.map((c) => c.close);
  const last = closes.length - 1;
  const { histogram } = macd(closes);
  const bb = bollinger(closes, 20, 2);
  return {
    rsi: rsi(closes, 14)[last],
    macdHist: histogram[last],
    ema50: ema(closes, 50)[last],
    ema200: ema(closes, 200)[last],
    bbUpper: bb.upper[last],
    bbLower: bb.lower[last],
    close: closes[last],
  };
}

/**
 * Folds the user's custom /strategies rules (see strategies.ts) into an already-computed
 * analysis: when a custom strategy is enabled for this symbol, its vote nudges confidence
 * up (agrees) or down (disagrees) instead of being silently ignored like before.
 */
function applyStrategyOverlay(analysis: SymbolAnalysis, symbolDeriv: string, candles15m: { close: number }[] | null): SymbolAnalysis {
  if (!analysis.direction || !candles15m || candles15m.length < 60) return analysis;
  const snapshot = computeIndicatorSnapshot(candles15m);
  const vote = evaluateStrategies(symbolDeriv, snapshot);
  if (!vote) return analysis;

  const agrees = (vote === "BUY" && analysis.direction === "CALL") || (vote === "SELL" && analysis.direction === "PUT");
  if (agrees) {
    return { ...analysis, confidence: Math.min(95, analysis.confidence + 5), strategyVote: vote };
  }
  return {
    ...analysis,
    confidence: Math.max(0, analysis.confidence - 5),
    blockers: [...analysis.blockers, `Stratégie perso en désaccord (${vote} attendu, signal ${analysis.direction})`],
    strategyVote: vote,
  };
}

async function analyzeSymbol(symbolDeriv: string, veto4h: Veto4hMode, vetoDaily: Veto4hMode = "off"): Promise<SymbolAnalysis> {
  const learnedWeights = getLearnedWeights(symbolDeriv);
  const { analysis, candles15m } = await analyzeSymbolCore(
    symbolDeriv,
    (sym, granularitySeconds, count) => fetchCandles(sym, granularitySeconds, count),
    { weights: learnedWeights, veto4h, vetoDaily },
  );
  return applyStrategyOverlay(analysis, symbolDeriv, candles15m);
}

// ─── Real multi-timeframe backtest ────────────────────────────────────────────
// indicators.ts' backtestSignal() only replays a SINGLE timeframe, but the live
// engine trades on a 4-TF vote + 4H veto + Trend Alignment Score + pattern bonus
// (aggregateTfSignals above). This replays that exact pipeline over historical,
// time-aligned candles across all 4 timeframes — no lookahead: at each test point
// only candles closed before that instant are visible to each timeframe.

const GRAN_MINUTES: Record<string, number> = { "5m": 5, "15m": 15, "1H": 60, "4H": 240 };

/** Binary search: the trailing `lookback` candles that were already closed as of `epoch`. */
function sliceAsOf<T extends { epoch: number }>(candles: T[], epoch: number, lookback: number): T[] {
  let lo = 0, hi = candles.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].epoch <= epoch) { idx = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  if (idx < 0) return [];
  return candles.slice(Math.max(0, idx - lookback + 1), idx + 1);
}

export interface MultiTfBacktestResult {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  avgConfidence: number;
  breakEvenWinRate: number;
  payoutPct: number;
  /** Win rate segmented by how many timeframes agreed (1-4) — reveals whether TF agreement actually predicts outcomes. */
  byAgreement: Record<number, { trades: number; wins: number }>;
}

export async function backtestMultiTf(
  symbolDeriv: string,
  {
    minConfidence = 70,
    minTfAgreement = 2,
    durationMinutes = 15,
    stakeUsd = 5,
    testCandles = 150, // number of 15m entry points tested (~37.5h of opportunities)
    veto4h = "strong-only",
  }: {
    minConfidence?: number;
    minTfAgreement?: number;
    durationMinutes?: number;
    stakeUsd?: number;
    testCandles?: number;
    veto4h?: Veto4hMode;
  } = {},
): Promise<MultiTfBacktestResult> {
  const LOOKBACK = 250; // same per-TF depth analyzeSymbol() fetches live
  const durationCandles = Math.max(1, Math.round(durationMinutes / 15));
  const testSpanMinutes = testCandles * 15;
  // Replay with the SAME learned weights the live bot currently uses for this
  // symbol, so the backtest reflects the bot's actual current behavior, not a
  // frozen baseline it moved past.
  const learnedWeights = getLearnedWeights(symbolDeriv);
  const countFor = (tf: string, margin = 20) =>
    Math.ceil((testSpanMinutes + LOOKBACK * GRAN_MINUTES[tf]) / GRAN_MINUTES[tf]) + margin;

  const [c5m, c15m, c1h, c4h, payoutPct] = await Promise.all([
    fetchCandles(symbolDeriv, GRANULARITY["5m"], countFor("5m")),
    fetchCandles(symbolDeriv, GRANULARITY["15m"], countFor("15m") + durationCandles),
    fetchCandles(symbolDeriv, GRANULARITY["1H"], countFor("1H")),
    fetchCandles(symbolDeriv, GRANULARITY["4H"], countFor("4H")),
    fetchRealPayoutRatio(symbolDeriv, durationMinutes, stakeUsd),
  ]);
  const bySrc: Record<string, typeof c15m> = { "5m": c5m, "15m": c15m, "1H": c1h, "4H": c4h };

  let wins = 0, losses = 0, totalConf = 0;
  const byAgreement: Record<number, { trades: number; wins: number }> = {
    1: { trades: 0, wins: 0 }, 2: { trades: 0, wins: 0 }, 3: { trades: 0, wins: 0 }, 4: { trades: 0, wins: 0 },
  };

  const start = Math.max(LOOKBACK, c15m.length - testCandles - durationCandles);
  const end = c15m.length - durationCandles;

  for (let i = start; i < end; i++) {
    const asOfEpoch = c15m[i - 1].epoch;
    const tfSignals: TfSignalMap = {};
    for (const tf of TIMEFRAMES) {
      const slice = sliceAsOf(bySrc[tf], asOfEpoch, LOOKBACK);
      if (slice.length >= 60) tfSignals[tf] = generateSignal(slice, { weights: learnedWeights });
    }
    const analysis = aggregateTfSignals(tfSignals, 0, 1, veto4h);
    if (!analysis.direction) continue;
    if (analysis.confidence < minConfidence) continue;
    if (analysis.agreement < minTfAgreement) continue;

    const entry = c15m[i - 1].close;
    const exit = c15m[i - 1 + durationCandles].close;
    const won = analysis.direction === "CALL" ? exit > entry : exit < entry;
    if (won) wins++; else losses++;
    totalConf += analysis.confidence;

    const bucket = Math.min(4, Math.max(1, analysis.agreement));
    byAgreement[bucket].trades++;
    if (won) byAgreement[bucket].wins++;
  }

  const trades = wins + losses;
  const winRate = trades > 0 ? wins / trades : 0;
  const pnl = wins * stakeUsd * payoutPct - losses * stakeUsd;

  return {
    trades, wins, losses, winRate, pnl,
    avgConfidence: trades > 0 ? Math.round(totalConf / trades) : 0,
    breakEvenWinRate: 1 / (1 + payoutPct),
    payoutPct,
    byAgreement,
  };
}

// ─── P&L helpers ─────────────────────────────────────────────────────────────

/** Dismiss a preview trade: mark it closed and remove from active display. */
export function dismissTrade(id: string): TradeLog[] {
  const logs = loadTradeLog();
  const idx = logs.findIndex((l) => l.id === id);
  if (idx >= 0 && (logs[idx].status === "open" || logs[idx].status === "pending")) {
    logs[idx] = { ...logs[idx], status: "lost", profit: 0, closedAt: Date.now(), note: "Fermé manuellement" };
    saveTradeLog(logs);
    logsCache = logs;
  }
  return logs;
}

// ─── Main engine ──────────────────────────────────────────────────────────────

export function startAutoTrader(
  config: AutoTraderConfig,
  onEvent: TradeEventHandler,
  onRiskStop?: RiskStopHandler,
  onScanResult?: ScanResultHandler,
  balanceUsd?: number | (() => number | undefined),
): () => void {
  let stopped = false;
  const logs = loadTradeLog();
  const activeSymbols = new Map<string, "CALL" | "PUT">();
  let interval: ReturnType<typeof setInterval> | undefined;
  // Per-symbol cooldown (epoch ms) — a losing streak on ONE instrument no longer
  // has to pause every other symbol too (see countConsecutiveLosses(logs, symbol)).
  const symbolCooldowns = new Map<string, number>();
  let sessionPeakPnl = 0; // highest daily P&L seen since engine start
  // Risk events PAUSE the engine (with automatic resume) instead of killing it:
  // the previous hard-stop never re-armed, so a limit hit at 10am left the bot
  // dead until someone manually restarted it (audit fix #1).
  let pausedUntil = 0;

  function emit(log: TradeLog, meta?: { cooldownUntil?: number }) {
    const idx = logs.findIndex((l) => l.id === log.id);
    const prev = idx >= 0 ? logs[idx] : null;
    if (idx >= 0) logs[idx] = log;
    else logs.unshift(log);
    saveTradeLog(logs);
    // Update cumulative P&L only when trade first reaches a terminal state
    if ((log.status === "won" || log.status === "lost") &&
        prev && prev.status !== "won" && prev.status !== "lost") {
      addToCumulativePnl(log.profit);
      addToDailyPnl(log.profit); // rollup du jour — insensible à la troncature du journal
      // Feed the outcome back into the adaptive indicator weights for this symbol —
      // the actual "learns from its mistakes" mechanism, not just a stake haircut.
      recordComponentOutcomes(log.symbol, log.components, log.status === "won");
    }
    onEvent(log, meta);
  }

  /** Next local midnight — daily limits re-arm when todayPnl naturally resets. */
  function nextMidnight(): number {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  /** Pause the engine until `untilTs`, log the reasons, notify — auto-resumes. */
  function riskPause(reasons: string[], untilTs: number) {
    if (stopped || Date.now() < pausedUntil) return;
    pausedUntil = untilTs;
    sessionPeakPnl = 0; // re-arm the trailing stop for the next trading window
    const resumeLabel = new Date(untilTs).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const stopLog: TradeLog = {
      id: `risk_${Date.now()}`,
      time: Date.now(),
      symbol: "—",
      direction: "CALL",
      stake: 0,
      payout: 0,
      status: "risk-stop",
      profit: 0,
      confidence: 0,
      tfAgreement: 0,
      note: `${reasons.join(" · ")} — reprise auto à ${resumeLabel}`,
    };
    emit(stopLog);
    notifyRiskStop(reasons);
    onRiskStop?.(reasons, untilTs);
  }

  async function tick() {
    if (stopped) return;
    if (Date.now() < pausedUntil) return; // risk pause in effect — auto-resumes

    // Rollup persisté plutôt que somme du journal tronqué — les gains du début
    // de journée sortaient de la fenêtre et les limites de risque dérivaient.
    const pnl = loadDailyPnl().pnl;
    const count = todayTradeCount(logs);
    const scanResults: ScanSymbolResult[] = [];

    // ── TRAILING STOP (session peak drawdown) ──────────────────
    if (pnl > sessionPeakPnl) sessionPeakPnl = pnl;
    if (config.trailingStopUsd > 0 && sessionPeakPnl > 0 && pnl < sessionPeakPnl - config.trailingStopUsd) {
      riskPause([
        `Trailing stop déclenché — pic: +$${sessionPeakPnl.toFixed(2)}, maintenant: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
        `Drawdown de $${(sessionPeakPnl - pnl).toFixed(2)} > seuil $${config.trailingStopUsd}`,
      ], nextMidnight());
      return;
    }

    // ── RISK CHECKS ────────────────────────────────────────────
    // Daily loss limit — always enforced
    if (pnl <= -Math.abs(config.maxDailyLossUsd)) {
      if (config.stopOnRisk) {
        riskPause([`Perte journalière atteinte : $${Math.abs(pnl).toFixed(2)} / $${config.maxDailyLossUsd}`], nextMidnight());
      } else {
        onScanResult?.({ time: Date.now(), results: config.symbols.map((s) => ({ symbol: s, action: "daily-limit" as const })) });
      }
      return;
    }

    // Daily profit target
    if (config.maxDailyProfitUsd > 0 && pnl >= config.maxDailyProfitUsd) {
      if (config.stopOnRisk) {
        riskPause([`Objectif journalier atteint : +$${pnl.toFixed(2)} / $${config.maxDailyProfitUsd} — bien joué !`], nextMidnight());
      }
      return;
    }

    if (count >= config.maxTradesPerDay) {
      for (const symbol of config.symbols) {
        scanResults.push({ symbol, action: "daily-limit" });
      }
      onScanResult?.({ time: Date.now(), results: scanResults });
      return;
    }

    // Base stake: fixed USD, % of current balance, or (if a Kelly stake can't be
    // resolved for a given symbol later) this same fixed/percent fallback.
    const currentBalance = typeof balanceUsd === "function" ? balanceUsd() : balanceUsd;
    const baseStake = config.stakeMode === "percent" && currentBalance && currentBalance > 0
      ? Math.max(1, (currentBalance * config.stakePercent) / 100)
      : config.stakeUsd;

    // Adaptive stake (win-rate-tiered haircut on recent trades)
    const effectiveStake = config.adaptiveStake
      ? computeAdaptiveStake(baseStake, logs)
      : baseStake;

    // ── Candidate symbols: the manual watchlist, or every CALL/PUT-eligible market ──
    // Synthetic indices excluded even here: RNG-generated by Deriv, no real edge,
    // structural ~50% long-term winrate (see DEFAULT_CONFIG.symbols comment).
    const candidateSymbols = config.symbolMode === "all-markets"
      ? SYMBOLS.filter((s) => s.market !== "synthetic" && isCallPutAvailable(s.deriv)).map((s) => s.deriv)
      : config.symbols;

    // ── Cheap pre-filter (no network) — trims the list before spending
    // analyzeSymbol's 4-timeframe fetches on symbols that can't trade anyway ──
    const toAnalyze: string[] = [];
    for (const symbol of candidateSymbols) {
      if (!isCallPutAvailable(symbol)) {
        scanResults.push({ symbol, action: "not-tradeable", note: "CALL/PUT indisponible sur crypto — utilise les indices Volatility (R_100…)" });
        continue;
      }
      if (activeSymbols.has(symbol)) {
        scanResults.push({ symbol, action: "open-trade" });
        continue;
      }
      if (!isInTradingSession(config.tradingSessions, symbol, config.sessionEdgeMinutes)) {
        scanResults.push({ symbol, action: "session-closed" });
        continue;
      }
      // Skip high-risk news/session-open windows for session-bound markets
      // (24/7 synthetics unaffected). Opt-out via config.newsFilter for users
      // who explicitly want to trade the volatile session opens.
      if (!is24x7Symbol(symbol) && config.newsFilter !== false) {
        const riskCheck = isHighRiskWindow();
        if (riskCheck.blocked) {
          scanResults.push({ symbol, action: "news-block", note: riskCheck.reason });
          continue;
        }
      }

      const symbolCooldownUntil = symbolCooldowns.get(symbol) ?? 0;
      if (Date.now() < symbolCooldownUntil) {
        scanResults.push({ symbol, action: "cooldown" });
        continue;
      }
      if (symbolCooldownUntil > 0) symbolCooldowns.delete(symbol); // expired

      // Consecutive losses on THIS symbol → pause THIS symbol only. Killing the
      // whole engine for one instrument's streak (old stopOnRisk behavior) left
      // every other market untraded until a manual restart (audit fix #1).
      const consecutive = countConsecutiveLosses(logs, symbol);
      if (consecutive >= config.maxConsecutiveLosses) {
        symbolCooldowns.set(symbol, Date.now() + config.cooldownMinutes * 60_000);
        emit({
          id: `cd_${Date.now()}_${symbol}`,
          time: Date.now(),
          symbol,
          direction: "CALL",
          stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
          status: "cooldown",
          note: `${consecutive} pertes consécutives sur ${symbol} — pause ${config.cooldownMinutes} min`,
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
          symbolCooldowns.set(symbol, Date.now() + config.cooldownMinutes * 60_000);
          emit({
            id: `cd_${Date.now()}_${symbol}`,
            time: Date.now(),
            symbol,
            direction: "CALL",
            stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
            status: "cooldown",
            note: `Win rate ${(rolling.winRate * 100).toFixed(0)}% sur ${rolling.trades} trades (${symbol}) — pause ${config.cooldownMinutes} min`,
          });
          scanResults.push({ symbol, action: "cooldown" });
          continue;
        }
      }

      toAnalyze.push(symbol);
    }

    if (!toAnalyze.length) {
      onScanResult?.({ time: Date.now(), results: scanResults });
      return;
    }

    // ── Parallel analysis (concurrency-capped) ──────────────────
    // Sequentially awaiting analyzeSymbol per symbol made a large watchlist (or
    // an all-markets scan) take minutes; this caps concurrency instead.
    const analyzed = await mapWithConcurrency(toAnalyze, 6, async (symbol) => ({
      symbol,
      analysis: await analyzeSymbol(symbol, config.veto4h ?? "strong-only", config.vetoDaily ?? "off"),
    }));

    // All-markets mode: best opportunities get first crack at the trade slots
    // this tick allows. Watchlist mode keeps the user's configured order.
    const ordered = config.symbolMode === "all-markets"
      ? [...analyzed].sort((a, b) => b.analysis.confidence - a.analysis.confidence)
      : analyzed;

    let newTradesThisTick = 0;

    for (const { symbol, analysis } of ordered) {
      if (stopped) break;

      if (newTradesThisTick >= config.maxSimultaneousTrades) {
        scanResults.push({ symbol, action: "daily-limit", note: `Limite de ${config.maxSimultaneousTrades} trades/cycle atteinte` });
        continue;
      }

      // ── Extreme volatility → skip THIS symbol (one wild market shouldn't
      // shut down trading on every calm one — audit fix) ──────────
      if (analysis.volatilityPct > config.maxVolatilityPct) {
        scanResults.push({ symbol, action: "volatility", note: `ATR ${analysis.volatilityPct.toFixed(2)}% > max ${config.maxVolatilityPct}% — paire ignorée` });
        continue;
      }

      // ── Abnormal volatility for THIS symbol specifically ──────
      // A flat ATR% cutoff either over-restricts calm pairs (EUR/USD) or
      // under-restricts violent ones (Volatility 100). On top of the absolute
      // gate above, skip this symbol only when its current ATR% is a multiple
      // of ITS OWN recent norm — catches an abnormal spike a global % would miss.
      if (analysis.volatilityRatio > 3) {
        scanResults.push({ symbol, action: "volatility", note: `Volatilité ${analysis.volatilityRatio.toFixed(1)}x la normale de ce marché — signal ignoré` });
        continue;
      }

      // ── FAVORABLE-ONLY FILTERS ────────────────────────────────
      if (!analysis.direction) {
        scanResults.push({ symbol, action: "no-signal", confidence: analysis.confidence });
        continue;
      }
      // Correlation can change mid-tick as earlier candidates open trades —
      // must be rechecked here, not just in the pre-filter pass above. Direction-
      // aware: only the SAME direction on a correlated pair doubles the bet.
      if (config.blockCorrelated && isCorrelatedWithActive(symbol, analysis.direction, activeSymbols)) {
        scanResults.push({ symbol, action: "correlated" });
        continue;
      }
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

      // Clamp to the symbol's minimum allowed duration (forex CALL/PUT starts at 15m)
      const tradeDuration = Math.max(analysis.suggestedDuration, minContractMinutes(symbol));

      // Confidence alone doesn't guard against a thin payout — Deriv's actual
      // payout varies by instrument/duration/volatility, and a low one raises
      // the win rate needed just to break even. Skipped entirely in simulation
      // mode, which already prices its own P&L off a live payout quote.
      if (config.mode !== "simulation") {
        try {
          const proposal = await proposalContract({
            symbol, amount: effectiveStake, contractType: analysis.direction, durationMinutes: tradeDuration,
          });
          const payoutRatio = (proposal.payout - proposal.askPrice) / proposal.askPrice;
          if (payoutRatio > 0 && payoutRatio < 5 && payoutRatio < config.minPayoutRatio) {
            scanResults.push({
              symbol, action: "low-payout", direction: analysis.direction, confidence: analysis.confidence,
              note: `Payout ${(payoutRatio * 100).toFixed(0)}% < min ${(config.minPayoutRatio * 100).toFixed(0)}%`,
            });
            continue;
          }
        } catch { /* quote unavailable — don't block the trade on it */ }
      }

      // Signal qualifies — will trade
      scanResults.push({ symbol, action: "traded", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement });
      onScanResult?.({ time: Date.now(), results: scanResults });
      newTradesThisTick++;

      // Stake for THIS trade: Kelly (per-symbol measured edge) when enabled and
      // enough backtest data exists for this symbol, otherwise the fixed/percent
      // fallback already computed above.
      let stakeForTrade = effectiveStake;
      let kellyNote = "";
      if (config.stakeMode === "kelly") {
        const kellyStake = computeKellyStake(symbol, currentBalance ?? config.initialCapital, config.kellyFraction);
        if (kellyStake !== null) {
          stakeForTrade = config.adaptiveStake ? computeAdaptiveStake(kellyStake, logs) : kellyStake;
          kellyNote = `Kelly $${kellyStake.toFixed(2)}`;
        } else {
          kellyNote = "Kelly indisponible (backtest requis) — mise de secours";
        }
      }

      const stakeLabel = stakeForTrade < config.stakeUsd ? `réduite: $${stakeForTrade.toFixed(2)}` : "";
      const tasLabel = `TAS ${analysis.trendAlignmentScore}/4`;
      const patLabel = analysis.patternBonus > 0 ? ` · pattern +${analysis.patternBonus}` : "";
      const noteStr = [kellyNote, stakeLabel, tasLabel + patLabel].filter(Boolean).join(" · ");

      // Capture entry price at open for the live visual
      let entryPrice = 0;
      try {
        const entryCandles = await fetchCandles(symbol, GRANULARITY["1m"], 1);
        entryPrice = entryCandles[entryCandles.length - 1]?.close ?? 0;
      } catch { /* ignore */ }

      const logId = `t_${Date.now()}_${symbol}`;
      const pendingLog: TradeLog = {
        id: logId,
        time: Date.now(),
        symbol,
        direction: analysis.direction,
        stake: stakeForTrade,
        payout: 0,
        status: "pending",
        profit: 0,
        confidence: Math.round(analysis.confidence),
        tfAgreement: analysis.agreement,
        note: noteStr || undefined,
        entryPrice: entryPrice || undefined,
        durationMinutes: tradeDuration,
        expiry: Date.now() + tradeDuration * 60_000,
        components: analysis.components,
      };
      emit(pendingLog);
      notifyTradeTaken(
        symbol,
        analysis.direction,
        Math.round(analysis.confidence),
      );

      if (config.mode === "simulation") {
        // Local simulation - no real trades
        activeSymbols.set(symbol, analysis.direction);
        emit({ ...pendingLog, status: "open" });
        // Real current payout quote (no money committed) instead of an assumed flat 85%.
        const payoutRatio = await fetchRealPayoutRatio(symbol, tradeDuration, stakeForTrade);

        setTimeout(async () => {
          try {
            const exitCandles = await fetchCandles(symbol, GRANULARITY["1m"], 2);
            const exitPrice = exitCandles[exitCandles.length - 1]?.close ?? 0;
            const won = entryPrice > 0 && exitPrice > 0
              ? (analysis.direction === "CALL" ? exitPrice > entryPrice : exitPrice < entryPrice)
              : Math.random() < Math.min(0.65, analysis.confidence / 100);
            const profit = won ? stakeForTrade * payoutRatio : -stakeForTrade;
            emit({
              ...pendingLog,
              status: won ? "won" : "lost",
              profit,
              payout: won ? stakeForTrade + profit : 0,
              closedAt: Date.now(),
            });
          } catch {
            const winProb = Math.min(0.65, analysis.confidence / 100);
            const won = Math.random() < winProb;
            const profit = won ? stakeForTrade * payoutRatio : -stakeForTrade;
            emit({
              ...pendingLog,
              status: won ? "won" : "lost",
              profit,
              payout: won ? stakeForTrade + profit : 0,
              closedAt: Date.now(),
              note: "Simulation (prix temps réel indisponible)",
            });
          } finally {
            activeSymbols.delete(symbol);
          }
        }, tradeDuration * 60_000);

      } else {
        // Real Deriv account (demo or live): verify connection first
        const connected = await checkDerivConnection();
        if (!connected) {
          emit({ ...pendingLog, status: "error", profit: 0, note: "Connexion Deriv non disponible" });
          continue;
        }

        try {
          activeSymbols.set(symbol, analysis.direction);
          // Fresh proposal per attempt — Deriv proposal IDs expire in seconds
          const bought = await proposeAndBuy({
            symbol,
            amount: stakeForTrade,
            contractType: analysis.direction,
            durationMinutes: tradeDuration,
          });

          const openLog: TradeLog = {
            ...pendingLog,
            status: "open",
            payout: bought.payout,
            contractId: bought.contractId,
          };
          emit(openLog);

          let contractResolved = false;
          const resolveContract = (won: boolean, profit: number) => {
            if (contractResolved) return;
            contractResolved = true;
            clearTimeout(fallbackTimeout);
            unsub();
            activeSymbols.delete(symbol);
            emit({
              ...openLog,
              status: won ? "won" : "lost",
              // REAL Deriv profit — negative on loss, includes partial payouts
              profit,
              closedAt: Date.now(),
            } as TradeLog);
          };

          const unsub = subscribeContract(bought.contractId, (update) => {
            if (update.status === "open") return;
            resolveContract(update.status === "won", update.profit);
          });

          // Fallback: if contract never resolves via subscription, poll profit table
          const fallbackTimeout = setTimeout(async () => {
            if (contractResolved) return;
            try {
              const records = await getProfitTable(20);
              const match = records.find((r) => r.contractId === bought!.contractId);
              if (match) {
                resolveContract(match.profit > 0, match.profit);
              } else {
                // Still unknown — mark error but don't leave it open forever
                if (!contractResolved) {
                  contractResolved = true;
                  unsub();
                  activeSymbols.delete(symbol);
                  emit({ ...openLog, status: "error", profit: 0, note: "Résolution non reçue — vérifie ton compte Deriv" });
                }
              }
            } catch {
              if (!contractResolved) {
                contractResolved = true;
                unsub();
                activeSymbols.delete(symbol);
                emit({ ...openLog, status: "error", profit: 0, note: "Timeout résolution contrat" });
              }
            }
          }, (tradeDuration + 2) * 60_000);
        } catch (e) {
          emit({ ...pendingLog, status: "error", profit: 0, note: `Échec: ${(e as Error).message}` });
          activeSymbols.delete(symbol);
          // Un achat qui échoue échouera probablement pareil au tick suivant (erreur de
          // validation API) — cooldown court pour ne pas marteler la même commande chaque minute.
          symbolCooldowns.set(symbol, Date.now() + 10 * 60_000);
        }
      }
    }

    onScanResult?.({ time: Date.now(), results: scanResults });
  }

  tick();
  interval = setInterval(tick, 60_000); // Scan every 60s

  return () => {
    stopped = true;
    if (interval) clearInterval(interval);
  };
}
