// Auto-trading engine — all logic runs client-side.
// Only executes trades when strict signal quality thresholds are met.

import { fetchCandles, proposalContract, buyContract, subscribeContract, GRANULARITY, getBalance } from "./deriv";
import { generateSignal, atr } from "./indicators";

let derivConnected = false;

/** Check if Deriv WebSocket session is active and authenticated */
async function checkDerivConnection(): Promise<boolean> {
  if (derivConnected) return true;
  try {
    const balance = await getBalance();
    derivConnected = balance !== null;
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
  // --- Risk protection ---
  maxConsecutiveLosses: number;   // hard-stop engine after N consecutive losses
  cooldownMinutes: number;        // (legacy) kept for compatibility
  tradingSessions: TradingSession[]; // only trade during these sessions
  adaptiveStake: boolean;         // reduce stake automatically when losing
  premiumOnly: boolean;           // only trade PREMIUM-grade signals
  stopOnRisk: boolean;            // hard-stop immediately when risk detected
  maxVolatilityPct: number;       // skip/stop if ATR% above this on a symbol
}

export const DEFAULT_CONFIG: AutoTraderConfig = {
  enabled: false,
  mode: "simulation",
  stakeUsd: 5,
  durationMinutes: 15,
  minConfidence: 78,
  minTfAgreement: 3,
  maxDailyLossUsd: 20,
  maxTradesPerDay: 10,
  symbols: ["cryBTCUSD", "frxEURUSD"],
  maxConsecutiveLosses: 3,
  cooldownMinutes: 30,
  tradingSessions: ["london", "newyork"],
  adaptiveStake: true,
  premiumOnly: true,
  stopOnRisk: true,
  maxVolatilityPct: 4,
};

/**
 * "Prudent" preset — discipline-focused overrides applied on top of the
 * user's current config. Capital-dependent fields (stake, daily loss,
 * watched symbols) are intentionally preserved so we never guess their size.
 */
export const PRUDENT_CONFIG: Partial<AutoTraderConfig> = {
  mode: "simulation",      // safest: local simulation first
  minConfidence: 82,       // very selective
  minTfAgreement: 4,       // all timeframes must agree
  maxTradesPerDay: 5,      // limit exposure
  maxConsecutiveLosses: 3, // cooldown / hard-stop early
  maxVolatilityPct: 3,     // avoid chaotic markets
  adaptiveStake: true,     // shrink stake when losing
  premiumOnly: true,       // only the best-graded signals
  stopOnRisk: true,        // hard-stop the engine on danger
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
 * Best for: Beginners, small accounts (<$500), risk-averse traders
 */
export const CONSERVATIVE_PRESET: PresetConfig = {
  name: "Conservateur",
  description: "Sécurité maximale. Petits gains réguliers, pertes minimisées.",
  emoji: "🛡️",
  recommendedCapital: "$200-500",
  targetWinRate: "65-70%",
  expectedTradesPerDay: "2-4",
  mode: "simulation",        // Start safe, switch to live when comfortable
  stakeUsd: 2,               // 0.4-1% of capital
  durationMinutes: 15,       // Avoid 1min noise
  minConfidence: 85,         // Only highest quality signals
  minTfAgreement: 4,         // All 4 TFs must align
  maxDailyLossUsd: 10,       // 2-5% max daily risk
  maxTradesPerDay: 4,
  maxConsecutiveLosses: 2,   // Stop early on bad days
  maxVolatilityPct: 2,        // Avoid all volatile markets
  symbols: ["cryBTCUSD", "frxEURUSD"],  // Most liquid pairs
  tradingSessions: ["london", "newyork"],
  adaptiveStake: true,
  premiumOnly: true,          // Grade A only
  stopOnRisk: true,
};

/**
 * MODERATE - Balanced risk/reward
 * Best for: Intermediate traders, medium accounts ($500-2000)
 */
export const MODERATE_PRESET: PresetConfig = {
  name: "Modéré",
  description: "Équilibre optimal entre sécurité et rendement.",
  emoji: "⚖️",
  recommendedCapital: "$500-2000",
  targetWinRate: "60-65%",
  expectedTradesPerDay: "4-8",
  mode: "demo",              // Test in demo first
  stakeUsd: 5,               // 0.25-1% of capital
  durationMinutes: 10,         // Medium frequency
  minConfidence: 78,           // Standard threshold
  minTfAgreement: 3,           // 3 of 4 TFs align
  maxDailyLossUsd: 20,         // 1-4% daily risk
  maxTradesPerDay: 8,
  maxConsecutiveLosses: 3,
  maxVolatilityPct: 3,
  symbols: ["cryBTCUSD", "frxEURUSD", "cryETHUSD"],
  tradingSessions: ["london", "newyork"],
  adaptiveStake: true,
  premiumOnly: false,          // Allow good signals too
  stopOnRisk: true,
};

/**
 * AGGRESSIVE - Maximum trades, higher risk
 * Best for: Experienced traders, large accounts (>$2000), active monitoring
 */
export const AGGRESSIVE_PRESET: PresetConfig = {
  name: "Aggressif",
  description: "Plus de trades, plus de risque, potentiel élevé. Surveillance active requise.",
  emoji: "🚀",
  recommendedCapital: "$2000+",
  targetWinRate: "55-60%",
  expectedTradesPerDay: "8-15",
  mode: "demo",                // Mandatory demo first
  stakeUsd: 10,                // 0.5% of capital
  durationMinutes: 5,           // Quick scalping
  minConfidence: 70,            // Accept more signals
  minTfAgreement: 2,            // 2 of 4 TFs align
  maxDailyLossUsd: 50,          // 2.5% daily risk
  maxTradesPerDay: 15,
  maxConsecutiveLosses: 5,      // Allow more room
  maxVolatilityPct: 5,          // Trade volatile markets
  symbols: ["cryBTCUSD", "cryETHUSD", "frxEURUSD", "frxGBPUSD", "cryLTCUSD"],
  tradingSessions: ["asia", "london", "newyork"],  // All sessions
  adaptiveStake: true,
  premiumOnly: false,
  stopOnRisk: true,
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

export function isInTradingSession(sessions: TradingSession[], symbol: string): boolean {
  // Crypto trades 24/7 — no session filter
  if (symbol.startsWith("cry")) return true;

  const utcHour = new Date().getUTCHours();
  return sessions.some((s) => {
    const { open, close } = SESSION_HOURS[s];
    return utcHour >= open && utcHour < close;
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

function saveTradeLog(logs: TradeLog[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));
  } catch {}
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

// ─── Signal analysis ──────────────────────────────────────────────────────────

interface SymbolAnalysis {
  direction: "CALL" | "PUT" | null;
  confidence: number;
  agreement: number;
  premiumCount: number;   // how many timeframes graded PREMIUM
  volatilityPct: number;  // current ATR% on the base timeframe
  blockers: string[];     // reasons signals were rejected
}

async function analyzeSymbol(symbolDeriv: string): Promise<SymbolAnalysis> {
  const results: string[] = [];
  const qualities: string[] = [];
  const blockers = new Set<string>();
  let totalConf = 0;
  let volatilityPct = 0;

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
      if (sig.quality === "weak") continue; // ignore weak votes
      results.push(sig.direction);
      qualities.push(sig.quality ?? "weak");
      totalConf += sig.confidence;
    } catch { /* ignore */ }
  }

  if (!results.length) {
    return { direction: null, confidence: 0, agreement: 0, premiumCount: 0, volatilityPct, blockers: [...blockers] };
  }

  const buys = results.filter((r) => r === "BUY").length;
  const sells = results.filter((r) => r === "SELL").length;
  const avgConf = totalConf / results.length;
  const premiumCount = qualities.filter((q) => q === "premium").length;

  if (buys > sells) return { direction: "CALL", confidence: avgConf, agreement: buys, premiumCount, volatilityPct, blockers: [...blockers] };
  if (sells > buys) return { direction: "PUT", confidence: avgConf, agreement: sells, premiumCount, volatilityPct, blockers: [...blockers] };
  return { direction: null, confidence: avgConf, agreement: 0, premiumCount, volatilityPct, blockers: [...blockers] };
}

// ─── P&L helpers ─────────────────────────────────────────────────────────────

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
): () => void {
  let stopped = false;
  const logs = loadTradeLog();
  const activeSymbols = new Set<string>();
  let interval: ReturnType<typeof setInterval> | undefined;

  function emit(log: TradeLog, meta?: { cooldownUntil?: number }) {
    const idx = logs.findIndex((l) => l.id === log.id);
    if (idx >= 0) logs[idx] = log;
    else logs.unshift(log);
    saveTradeLog(logs);
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

    // ── RISK STOP CONDITIONS (immediate full stop) ──────────────
    if (config.stopOnRisk) {
      const reasons: string[] = [];

      // 1. Daily loss limit reached
      if (pnl <= -Math.abs(config.maxDailyLossUsd)) {
        reasons.push(`Perte journalière atteinte : $${Math.abs(pnl).toFixed(2)} / $${config.maxDailyLossUsd}`);
      }

      // 2. Consecutive losses
      const consecutive = countConsecutiveLosses(logs);
      if (consecutive >= config.maxConsecutiveLosses) {
        reasons.push(`${consecutive} pertes consécutives (max ${config.maxConsecutiveLosses})`);
      }

      if (reasons.length) {
        riskStop(reasons);
        return;
      }
    } else {
      // Soft circuit-breakers (no hard stop)
      if (pnl <= -Math.abs(config.maxDailyLossUsd)) return;
    }

    // Max trades/day (soft — just stop opening new ones)
    if (count >= config.maxTradesPerDay) return;

    // Adaptive stake
    const effectiveStake = config.adaptiveStake
      ? computeAdaptiveStake(config.stakeUsd, logs)
      : config.stakeUsd;

    for (const symbol of config.symbols) {
      if (stopped) break;
      if (activeSymbols.has(symbol)) continue;

      // Session filter — skip silently outside allowed sessions
      if (!isInTradingSession(config.tradingSessions, symbol)) continue;

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
      if (!analysis.direction) continue;
      if (analysis.confidence < config.minConfidence) continue;
      if (analysis.agreement < config.minTfAgreement) continue;
      // Only trade PREMIUM positions when enabled
      if (config.premiumOnly && analysis.premiumCount < 1) continue;

      const stakeLabel = effectiveStake < config.stakeUsd
        ? ` (réduite: $${effectiveStake.toFixed(2)})`
        : "";

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
        note: stakeLabel || undefined,
        entryPrice: entryPrice || undefined,
        durationMinutes: config.durationMinutes,
        expiry: Date.now() + config.durationMinutes * 60_000,
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
            const candles = await fetchCandles(symbol, GRANULARITY["1m"], 2);
            const last = candles[candles.length - 1]?.close ?? entryPrice;
            const won = analysis.direction === "CALL" ? last > entryPrice : last < entryPrice;
            const profit = won ? effectiveStake * 0.85 : -effectiveStake;
            emit({
              ...pendingLog,
              status: won ? "won" : "lost",
              profit,
              payout: won ? effectiveStake + profit : 0,
              closedAt: Date.now(),
            });
          } catch {
            emit({ ...pendingLog, status: "error", profit: 0 });
          } finally {
            activeSymbols.delete(symbol);
          }
        }, config.durationMinutes * 60_000);

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
            durationMinutes: config.durationMinutes,
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

          const unsub = subscribeContract(bought.contractId, (update) => {
            if (update.status === "open") return;
            unsub();
            activeSymbols.delete(symbol);
            const won = update.status === "won";
            emit({
              ...openLog,
              status: won ? "won" : "lost",
              profit: won ? update.profit : -effectiveStake,
              closedAt: Date.now(),
            } as TradeLog);
          });
        } catch (e) {
          emit({ ...pendingLog, status: "error", profit: 0, note: `Échec: ${(e as Error).message}` });
          activeSymbols.delete(symbol);
        }
      }
    }
  }

  tick();
  interval = setInterval(tick, 60_000); // Scan every 60s (was 5min)

  return () => {
    stopped = true;
    if (interval) clearInterval(interval);
  };
}
