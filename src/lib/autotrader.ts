// Auto-trading engine — all logic runs client-side.
// Only executes trades when strict signal quality thresholds are met.

import { fetchCandles, proposalContract, buyContract, subscribeContract, getProfitTable, GRANULARITY, getBalance } from "./deriv";
import { generateSignal, atr } from "./indicators";

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

export type TradingSession = "asia" | "london" | "newyork";

export type TradingMode = "simulation" | "demo" | "live";

export interface AutoTraderConfig {
  enabled: boolean;
  mode: TradingMode; // simulation = local, demo = Deriv demo account, live = Deriv real money
  stakeUsd: number;
  durationMinutes: number;
  minConfidence: number;
  minTfAgreement: number;
  maxDailyLossUsd: number;
  maxTradesPerDay: number;
  symbols: string[];
  initialCapital: number;          // starting capital for virtual P&L tracking
  // --- Risk protection ---
  maxConsecutiveLosses: number;   // hard-stop engine after N consecutive losses
  cooldownMinutes: number;        // (legacy) kept for compatibility
  tradingSessions: TradingSession[]; // only trade during these sessions
  adaptiveStake: boolean;         // reduce stake automatically when losing
  premiumOnly: boolean;           // only trade PREMIUM-grade signals
  stopOnRisk: boolean;            // hard-stop immediately when risk detected
  maxVolatilityPct: number;       // skip/stop if ATR% above this on a symbol
  maxDailyProfitUsd: number;     // stop bot when daily profit >= this (0 = disabled)
  stakeMode: "fixed" | "percent"; // fixed USD or % of balance
  stakePercent: number;           // % of balance per trade (used when stakeMode = "percent")
  sessionEdgeMinutes: number;     // skip N minutes at session open/close (avoids fake breakouts)
  trailingStopUsd: number;        // stop if P&L drops this much below session peak (0 = disabled)
  blockCorrelated: boolean;       // skip correlated pairs when one is already active
}

export const DEFAULT_CONFIG: AutoTraderConfig = {
  enabled: false,
  mode: "demo",
  stakeUsd: 5,
  durationMinutes: 15,
  minConfidence: 70,
  minTfAgreement: 2,
  maxDailyLossUsd: 20,
  maxTradesPerDay: 10,
  symbols: ["cryBTCUSD", "frxEURUSD"],
  initialCapital: 100,
  maxConsecutiveLosses: 3,
  cooldownMinutes: 30,
  tradingSessions: ["london", "newyork"],
  adaptiveStake: true,
  premiumOnly: false,
  stopOnRisk: true,
  maxVolatilityPct: 4,
  maxDailyProfitUsd: 0,
  stakeMode: "fixed",
  stakePercent: 1,
  sessionEdgeMinutes: 0,
  trailingStopUsd: 0,
  blockCorrelated: true,
};

export const SCAN_INTERVAL_MS = 60_000;

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
  symbols: ["cryBTCUSD", "frxEURUSD"],
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
  symbols: ["cryBTCUSD", "frxEURUSD", "cryETHUSD"],
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
  symbols: ["cryBTCUSD", "cryETHUSD", "frxEURUSD", "frxGBPUSD", "cryLTCUSD"],
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

export interface TradeLog {
  id: string;
  time: number;
  symbol: string;
  direction: "CALL" | "PUT";
  stake: number;
  payout: number;
  status: "pending" | "open" | "won" | "lost" | "error" | "cooldown" | "risk-stop";
  profit: number;
  confidence: number;
  tfAgreement: number;
  contractId?: number;
  closedAt?: number;
  note?: string;
  entryPrice?: number;       // price at trade open (for live visual)
  durationMinutes?: number;  // contract duration (for live countdown)
  expiry?: number;           // epoch ms when the contract resolves
}

export type TradeEventHandler = (log: TradeLog, meta?: { cooldownUntil?: number }) => void;
export type RiskStopHandler = (reasons: string[]) => void;

// Pairs that share high exposure — only one from each group should be active at a time.
// Group 0: EUR/GBP forex (positive correlation ~0.85)
// Group 1: crypto block (BTC/ETH/LTC move together ~0.80+)
export const CORRELATION_GROUPS: string[][] = [
  ["frxEURUSD", "frxGBPUSD"],
  ["cryBTCUSD", "cryETHUSD", "cryLTCUSD"],
];

export function isCorrelatedWithActive(symbol: string, activeSymbols: Set<string>): boolean {
  const group = CORRELATION_GROUPS.find((g) => g.includes(symbol));
  if (!group) return false;
  return group.some((s) => s !== symbol && activeSymbols.has(s));
}

export interface ScanSymbolResult {
  symbol: string;
  action: "open-trade" | "session-closed" | "no-signal" | "low-confidence" | "low-agreement" | "not-premium" | "volatility" | "traded" | "daily-limit" | "cooldown" | "correlated" | "news-block";
  direction?: "CALL" | "PUT" | null;
  confidence?: number;
  agreement?: number;
  note?: string;
}

export interface ScanResult {
  time: number;
  results: ScanSymbolResult[];
}

export type ScanResultHandler = (result: ScanResult) => void;

// ─── Risk notification ─────────────────────────────────────────────────────────

export function notifyRiskStop(reasons: string[]) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const n = new Notification("🛑 LIO23 — Auto-trader ARRÊTÉ (risque détecté)", {
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
  const n = new Notification(`✅ LIO23 — Trade pris sur ${symbol}`, {
    body: `${direction} · Confiance ${confidence}% · Position favorable (PREMIUM)`,
    icon: "/favicon.ico",
    tag: `lio23-trade-${symbol}`,
  });
  setTimeout(() => n.close(), 8000);
}

// ─── Session helpers ───────────────────────────────────────────────────────────

export const SESSION_HOURS: Record<TradingSession, { label: string; open: number; close: number }> = {
  asia:     { label: "Asie",      open: 0,  close: 9  },  // 00:00–09:00 UTC
  london:   { label: "Londres",   open: 7,  close: 16 },  // 07:00–16:00 UTC
  newyork:  { label: "New York",  open: 12, close: 21 },  // 12:00–21:00 UTC
};

export function isInTradingSession(sessions: TradingSession[], symbol: string, edgeMinutes = 0): boolean {
  // Crypto trades 24/7 — no session filter
  if (symbol.startsWith("cry")) return true;

  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return sessions.some((s) => {
    const { open, close } = SESSION_HOURS[s];
    return utcMins >= open * 60 + edgeMinutes && utcMins < close * 60 - edgeMinutes;
  });
}

export function currentActiveSessions(): TradingSession[] {
  const utcHour = new Date().getUTCHours();
  return (Object.keys(SESSION_HOURS) as TradingSession[]).filter((s) => {
    const { open, close } = SESSION_HOURS[s];
    return utcHour >= open && utcHour < close;
  });
}

// ─── Adaptive stake ────────────────────────────────────────────────────────────

export function computeAdaptiveStake(baseStake: number, recentLogs: TradeLog[]): number {
  const closed = recentLogs.filter((l) => l.status === "won" || l.status === "lost").slice(0, 20);
  if (closed.length < 5) return baseStake; // not enough data yet

  const wins = closed.filter((l) => l.status === "won").length;
  const winRate = wins / closed.length;

  // Reduce stake proportionally to under-performance
  if (winRate < 0.35) return Math.max(1, baseStake * 0.25); // -75%
  if (winRate < 0.45) return Math.max(1, baseStake * 0.5);  // -50%
  if (winRate < 0.55) return Math.max(1, baseStake * 0.75); // -25%
  return baseStake; // normal
}

// ─── Consecutive loss tracker ─────────────────────────────────────────────────

export function countConsecutiveLosses(logs: TradeLog[]): number {
  let count = 0;
  for (const l of logs) {
    if (l.status === "lost") count++;
    else if (l.status === "won") break;
  }
  return count;
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

// ─── Storage ──────────────────────────────────────────────────────────────────

const TIMEFRAMES = ["5m", "15m", "1H", "4H"] as const;
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
    // Keep only last 50 logs for performance
    const trimmed = logs.slice(0, 50);
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
      const profit = won ? stakeUsd * 0.85 : -stakeUsd;
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
    const proposal = await proposalContract({ symbol: symbolDeriv, amount: stake, contractType: direction, durationMinutes });

    let bought: { contractId: number; buyPrice: number; payout: number; startTime: number } | null = null;
    let attempts = 0;
    while (attempts < 3 && !bought) {
      try { attempts++; bought = await buyContract(proposal.id, proposal.askPrice * 1.05); }
      catch (e) { if (attempts >= 3) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    if (!bought) throw new Error("Échec achat après 3 tentatives");

    const openLog: TradeLog = { ...pending, status: "open", payout: bought.payout, contractId: bought.contractId };
    emit(openLog);

    let resolved = false;
    const resolve = (won: boolean, profit: number) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(fallback);
      unsub();
      emit({ ...openLog, status: won ? "won" : "lost", profit: won ? profit : -stake, closedAt: Date.now() });
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

// ─── News macro filter ───────────────────────────────────────────────────────
// High-risk UTC windows: NFP (1st Fri 12:30), Fed (Wed 18:00), ECB (Thu 12:15)
// Plus daily: NY open (13:30), London open (07:55), Asia open (23:55)
const HIGH_RISK_WINDOWS: { utcHour: number; utcMinute: number; durationMinutes: number; label: string }[] = [
  { utcHour: 7,  utcMinute: 55, durationMinutes: 20, label: "Ouverture Londres" },
  { utcHour: 12, utcMinute: 15, durationMinutes: 30, label: "Zone ECB/NFP" },
  { utcHour: 13, utcMinute: 25, durationMinutes: 20, label: "Ouverture NY" },
  { utcHour: 17, utcMinute: 55, durationMinutes: 15, label: "Fix Londres" },
  { utcHour: 18, utcMinute: 0,  durationMinutes: 20, label: "Zone Fed" },
  { utcHour: 23, utcMinute: 55, durationMinutes: 15, label: "Ouverture Asie" },
];

export function isHighRiskWindow(): { blocked: boolean; reason?: string } {
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  // Block on Fridays after 20:00 UTC (low liquidity weekend)
  if (now.getUTCDay() === 5 && now.getUTCHours() >= 20) {
    return { blocked: true, reason: "Vendredi soir — faible liquidité avant week-end" };
  }
  for (const w of HIGH_RISK_WINDOWS) {
    const start = w.utcHour * 60 + w.utcMinute;
    if (utcMins >= start && utcMins < start + w.durationMinutes) {
      return { blocked: true, reason: `Fenêtre à risque : ${w.label} (${w.durationMinutes}min)` };
    }
  }
  return { blocked: false };
}

// ─── Signal analysis ──────────────────────────────────────────────────────────

const TF_DURATION_MAP: Record<string, number> = {
  "5m":  5,
  "15m": 15,
  "1H":  30,
  "4H":  60,
};

interface SymbolAnalysis {
  direction: "CALL" | "PUT" | null;
  confidence: number;
  agreement: number;
  premiumCount: number;       // how many timeframes graded PREMIUM
  volatilityPct: number;      // current ATR% on the base timeframe
  blockers: string[];         // reasons signals were rejected
  dominantTf: string | null;  // TF with highest confidence signal
  suggestedDuration: number;  // optimal contract duration in minutes
  trendAlignmentScore: number; // 0-4: how many TFs agree on direction
  patternBonus: number;        // extra confidence from candle patterns
}

async function analyzeSymbol(symbolDeriv: string): Promise<SymbolAnalysis> {
  const results: string[] = [];
  const qualities: string[] = [];
  const blockers = new Set<string>();
  // Per-TF direction map for cross-TF alignment check
  const tfDirections: Record<string, "BUY" | "SELL"> = {};
  let totalConf = 0;
  let volatilityPct = 0;
  let bestConf = 0;
  let dominantTf: string | null = null;
  let patternBonus = 0;

  for (const tf of TIMEFRAMES) {
    try {
      const candles = await fetchCandles(symbolDeriv, GRANULARITY[tf], 250);
      if (!candles.length) continue;

      // Capture volatility from the entry timeframe (15m)
      if (tf === "15m") {
        const a = atr(candles.map((c) => c.high), candles.map((c) => c.low), candles.map((c) => c.close), 14);
        const atrNow = a[a.length - 1];
        const price = candles[candles.length - 1].close;
        if (atrNow !== null && price > 0) volatilityPct = (atrNow / price) * 100;
      }

      const sig = generateSignal(candles);
      if (sig.blockers) sig.blockers.forEach((b) => blockers.add(`${tf}: ${b}`));
      if (sig.direction === "HOLD" || sig.triggers[0] === "insufficient-data") continue;

      // Record TF direction even if weak (used for cross-TF alignment)
      tfDirections[tf] = sig.direction as "BUY" | "SELL";

      if (sig.quality === "weak") continue; // ignore weak votes for scoring
      results.push(sig.direction);
      qualities.push(sig.quality ?? "weak");
      totalConf += sig.confidence;

      // Accumulate pattern bonus from 15m (most actionable TF)
      if (tf === "15m" && sig.patterns) {
        for (const p of sig.patterns) patternBonus += p.strength * 2;
      }

      if (sig.confidence > bestConf) {
        bestConf = sig.confidence;
        dominantTf = tf;
      }
    } catch { /* ignore */ }
  }

  const suggestedDuration = dominantTf ? TF_DURATION_MAP[dominantTf] ?? 15 : 15;

  if (!results.length) {
    return { direction: null, confidence: 0, agreement: 0, premiumCount: 0, volatilityPct, blockers: [...blockers], dominantTf: null, suggestedDuration: 15, trendAlignmentScore: 0, patternBonus: 0 };
  }

  const buys = results.filter((r) => r === "BUY").length;
  const sells = results.filter((r) => r === "SELL").length;
  const rawDirection: "CALL" | "PUT" | null = buys > sells ? "CALL" : sells > buys ? "PUT" : null;

  if (!rawDirection) {
    return { direction: null, confidence: 0, agreement: 0, premiumCount: 0, volatilityPct, blockers: [...blockers], dominantTf, suggestedDuration, trendAlignmentScore: 0, patternBonus };
  }

  const signalBias = rawDirection === "CALL" ? "BUY" : "SELL";

  // ── Trend Alignment Score (TAS) ────────────────────────────────────────────
  // Count how many TFs explicitly agree with the final direction
  const trendAlignmentScore = Object.values(tfDirections).filter((d) => d === signalBias).length;

  // VETO rule: if 4H explicitly contradicts the signal → block entirely
  const h4dir = tfDirections["4H"];
  if (h4dir && h4dir !== signalBias) {
    blockers.add(`4H contre-tendance (${h4dir}) — trade annulé`);
    return { direction: null, confidence: 0, agreement: 0, premiumCount: 0, volatilityPct, blockers: [...blockers], dominantTf, suggestedDuration, trendAlignmentScore: 0, patternBonus };
  }

  // Confidence bonus based on alignment
  let avgConf = totalConf / results.length;
  if (trendAlignmentScore >= 4) avgConf = Math.min(95, avgConf + 15); // all 4 TFs agree
  else if (trendAlignmentScore === 3) avgConf = Math.min(95, avgConf + 8); // 3 TFs agree
  else if (trendAlignmentScore <= 1) avgConf = Math.max(0, avgConf - 10); // weak alignment

  // Pattern bonus (capped at +10 to avoid over-confidence)
  avgConf = Math.min(95, avgConf + Math.min(10, patternBonus));

  const premiumCount = qualities.filter((q) => q === "premium").length;
  const agreement = rawDirection === "CALL" ? buys : sells;

  if (rawDirection === "CALL") return { direction: "CALL", confidence: avgConf, agreement, premiumCount, volatilityPct, blockers: [...blockers], dominantTf, suggestedDuration, trendAlignmentScore, patternBonus };
  return { direction: "PUT", confidence: avgConf, agreement, premiumCount, volatilityPct, blockers: [...blockers], dominantTf, suggestedDuration, trendAlignmentScore, patternBonus };
}

// ─── P&L helpers ─────────────────────────────────────────────────────────────

export function allTimePnl(logs: TradeLog[]): number {
  return logs
    .filter((l) => l.status === "won" || l.status === "lost")
    .reduce((sum, l) => sum + l.profit, 0);
}

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

export function todayPnl(logs: TradeLog[]): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return logs
    .filter((l) => l.time >= start.getTime() && (l.status === "won" || l.status === "lost"))
    .reduce((sum, l) => sum + l.profit, 0);
}

export function todayTradeCount(logs: TradeLog[]): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return logs.filter((l) => l.time >= start.getTime() && l.status !== "pending").length;
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
  const activeSymbols = new Set<string>();
  let interval: ReturnType<typeof setInterval> | undefined;
  let cooldownUntil = 0; // epoch ms — engine skips trades until this time
  let sessionPeakPnl = 0; // highest daily P&L seen since engine start

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
    }
    onEvent(log, meta);
  }

  /** Hard-stop the engine, log the reasons, notify the user. */
  function riskStop(reasons: string[]) {
    if (stopped) return;
    stopped = true;
    if (interval) clearInterval(interval);
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
      note: reasons.join(" · "),
    };
    emit(stopLog);
    notifyRiskStop(reasons);
    onRiskStop?.(reasons);
  }

  async function tick() {
    if (stopped) return;

    const pnl = todayPnl(logs);
    const count = todayTradeCount(logs);
    const scanResults: ScanSymbolResult[] = [];

    // ── TRAILING STOP (session peak drawdown) ──────────────────
    if (pnl > sessionPeakPnl) sessionPeakPnl = pnl;
    if (config.trailingStopUsd > 0 && sessionPeakPnl > 0 && pnl < sessionPeakPnl - config.trailingStopUsd) {
      riskStop([
        `Trailing stop déclenché — pic: +$${sessionPeakPnl.toFixed(2)}, maintenant: ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
        `Drawdown de $${(sessionPeakPnl - pnl).toFixed(2)} > seuil $${config.trailingStopUsd}`,
      ]);
      return;
    }

    // ── RISK CHECKS ────────────────────────────────────────────
    // Daily loss limit — always enforced
    if (pnl <= -Math.abs(config.maxDailyLossUsd)) {
      if (config.stopOnRisk) {
        riskStop([`Perte journalière atteinte : $${Math.abs(pnl).toFixed(2)} / $${config.maxDailyLossUsd}`]);
      } else {
        onScanResult?.({ time: Date.now(), results: config.symbols.map((s) => ({ symbol: s, action: "daily-limit" as const })) });
      }
      return;
    }

    // Daily profit target
    if (config.maxDailyProfitUsd > 0 && pnl >= config.maxDailyProfitUsd) {
      if (config.stopOnRisk) {
        riskStop([`Objectif journalier atteint : +$${pnl.toFixed(2)} / $${config.maxDailyProfitUsd} — bien joué !`]);
      }
      return;
    }

    // Consecutive losses → hard stop (stopOnRisk) or cooldown pause (!stopOnRisk)
    const consecutive = countConsecutiveLosses(logs);
    if (consecutive >= config.maxConsecutiveLosses) {
      if (config.stopOnRisk) {
        riskStop([`${consecutive} pertes consécutives (max ${config.maxConsecutiveLosses})`]);
        return;
      } else if (cooldownUntil <= Date.now()) {
        cooldownUntil = Date.now() + config.cooldownMinutes * 60_000;
        const cdLog: TradeLog = {
          id: `cd_${Date.now()}`,
          time: Date.now(),
          symbol: "—",
          direction: "CALL",
          stake: 0, payout: 0, profit: 0, confidence: 0, tfAgreement: 0,
          status: "cooldown",
          note: `${consecutive} pertes consécutives — pause ${config.cooldownMinutes} min`,
        };
        emit(cdLog, { cooldownUntil });
        onScanResult?.({ time: Date.now(), results: config.symbols.map((s) => ({ symbol: s, action: "cooldown" as const })) });
        return;
      }
    }

    // Still in cooldown — skip tick
    if (Date.now() < cooldownUntil) {
      onScanResult?.({ time: Date.now(), results: config.symbols.map((s) => ({ symbol: s, action: "cooldown" as const })) });
      return;
    }

    if (count >= config.maxTradesPerDay) {
      for (const symbol of config.symbols) {
        scanResults.push({ symbol, action: "daily-limit" });
      }
      onScanResult?.({ time: Date.now(), results: scanResults });
      return;
    }

    // Base stake: fixed USD or % of current balance (resolve getter if needed)
    const currentBalance = typeof balanceUsd === "function" ? balanceUsd() : balanceUsd;
    const baseStake = config.stakeMode === "percent" && currentBalance && currentBalance > 0
      ? Math.max(1, (currentBalance * config.stakePercent) / 100)
      : config.stakeUsd;

    // Adaptive stake
    const effectiveStake = config.adaptiveStake
      ? computeAdaptiveStake(baseStake, logs)
      : baseStake;

    for (const symbol of config.symbols) {
      if (stopped) break;

      if (activeSymbols.has(symbol)) {
        scanResults.push({ symbol, action: "open-trade" });
        continue;
      }

      if (!isInTradingSession(config.tradingSessions, symbol, config.sessionEdgeMinutes)) {
        scanResults.push({ symbol, action: "session-closed" });
        continue;
      }

      // Skip high-risk news windows for forex pairs (crypto trades 24/7 unaffected)
      if (!symbol.startsWith("cry")) {
        const riskCheck = isHighRiskWindow();
        if (riskCheck.blocked) {
          scanResults.push({ symbol, action: "news-block", note: riskCheck.reason });
          continue;
        }
      }

      if (config.blockCorrelated && isCorrelatedWithActive(symbol, activeSymbols)) {
        scanResults.push({ symbol, action: "correlated" });
        continue;
      }

      const analysis = await analyzeSymbol(symbol);

      // ── Extreme volatility = RISK → stop immediately ──────────
      if (config.stopOnRisk && analysis.volatilityPct > config.maxVolatilityPct) {
        riskStop([
          `Volatilité extrême sur ${symbol} : ATR ${analysis.volatilityPct.toFixed(2)}% (max ${config.maxVolatilityPct}%)`,
          "Conditions de marché dangereuses — arrêt préventif",
        ]);
        return;
      }

      // ── FAVORABLE-ONLY FILTERS ────────────────────────────────
      if (!analysis.direction) {
        scanResults.push({ symbol, action: "no-signal", confidence: analysis.confidence });
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

      // Signal qualifies — will trade
      scanResults.push({ symbol, action: "traded", direction: analysis.direction, confidence: analysis.confidence, agreement: analysis.agreement });
      onScanResult?.({ time: Date.now(), results: scanResults });

      const stakeLabel = effectiveStake < config.stakeUsd
        ? `réduite: $${effectiveStake.toFixed(2)}`
        : "";
      const tasLabel = `TAS ${analysis.trendAlignmentScore}/4`;
      const patLabel = analysis.patternBonus > 0 ? ` · pattern +${analysis.patternBonus}` : "";
      const noteStr = [stakeLabel, tasLabel + patLabel].filter(Boolean).join(" · ");

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
        stake: effectiveStake,
        payout: 0,
        status: "pending",
        profit: 0,
        confidence: Math.round(analysis.confidence),
        tfAgreement: analysis.agreement,
        note: noteStr || undefined,
        entryPrice: entryPrice || undefined,
        durationMinutes: analysis.suggestedDuration,
        expiry: Date.now() + analysis.suggestedDuration * 60_000,
      };
      emit(pendingLog);
      notifyTradeTaken(
        symbol,
        analysis.direction,
        Math.round(analysis.confidence),
      );

      if (config.mode === "simulation") {
        // Local simulation - no real trades
        activeSymbols.add(symbol);
        emit({ ...pendingLog, status: "open" });

        setTimeout(async () => {
          try {
            const exitCandles = await fetchCandles(symbol, GRANULARITY["1m"], 2);
            const exitPrice = exitCandles[exitCandles.length - 1]?.close ?? 0;
            const won = entryPrice > 0 && exitPrice > 0
              ? (analysis.direction === "CALL" ? exitPrice > entryPrice : exitPrice < entryPrice)
              : Math.random() < Math.min(0.65, analysis.confidence / 100);
            const profit = won ? effectiveStake * 0.85 : -effectiveStake;
            emit({
              ...pendingLog,
              status: won ? "won" : "lost",
              profit,
              payout: won ? effectiveStake + profit : 0,
              closedAt: Date.now(),
            });
          } catch {
            const winProb = Math.min(0.65, analysis.confidence / 100);
            const won = Math.random() < winProb;
            const profit = won ? effectiveStake * 0.85 : -effectiveStake;
            emit({
              ...pendingLog,
              status: won ? "won" : "lost",
              profit,
              payout: won ? effectiveStake + profit : 0,
              closedAt: Date.now(),
              note: "Simulation (prix temps réel indisponible)",
            });
          } finally {
            activeSymbols.delete(symbol);
          }
        }, analysis.suggestedDuration * 60_000);

      } else {
        // Real Deriv account (demo or live): verify connection first
        const connected = await checkDerivConnection();
        if (!connected) {
          emit({ ...pendingLog, status: "error", profit: 0, note: "Connexion Deriv non disponible" });
          continue;
        }

        try {
          activeSymbols.add(symbol);
          const proposal = await proposalContract({
            symbol,
            amount: effectiveStake,
            contractType: analysis.direction,
            durationMinutes: analysis.suggestedDuration,
          });

          // Retry logic for buyContract (Deriv sometimes requires multiple attempts)
          let bought: { contractId: number; buyPrice: number; payout: number; startTime: number } | null = null;
          let attempts = 0;
          const maxAttempts = 3;
          while (attempts < maxAttempts && !bought) {
            try {
              attempts++;
              bought = await buyContract(proposal.id, proposal.askPrice * 1.05);
            } catch (e) {
              if (attempts >= maxAttempts) throw e;
              await new Promise((r) => setTimeout(r, 500)); // wait 500ms before retry
            }
          }
          if (!bought) throw new Error("Failed to buy contract after retries");

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
              profit: won ? profit : -effectiveStake,
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
          }, (analysis.suggestedDuration + 2) * 60_000);
        } catch (e) {
          emit({ ...pendingLog, status: "error", profit: 0, note: `Échec: ${(e as Error).message}` });
          activeSymbols.delete(symbol);
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
