import { BOOM_PRESET, BOOM900_PRESET, BOOM_V2_PRESET, CRASH_PRESET, CRASH500_PRESET, CRASH900_V2_PRESET, GOLD_PRESET, GOLD_V2_PRESET, LIQUIDITY_PRESET, LIQUIDITY_V2_PRESET, SCALPING_PRESET, SCALPING_V2_PRESET, VOL75_PRESET } from "./autotrader";
import { buildAnalyzeOptsServer } from "./analyze-opts.server";
import { loadBotConfig, type Preset } from "./bot-engine.server";
import { getDb } from "./db.server";
import { SYMBOLS } from "./deriv";
import { fetchCandlesServer, fetchRecentTicksServer } from "./deriv.server";
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
  analyzeSymbolCore,
  classifyOpportunity,
  DEFAULT_CONFIG,
  explainOpportunity,
  getInstrumentForSymbol,
  getMultiplierOverride,
  isBadStats,
  riskLevelFor,
  type AutoTraderConfig,
  type ClassifyThresholds,
  type OpportunityDecision,
  type SymbolAnalysis,
} from "./signal-core";
import { mapWithConcurrency } from "./utils";

// Single source of truth for the take/wait/avoid decision — see
// classifyOpportunity in signal-core.ts, which the live bot also calls so
// the two can no longer silently disagree on what's worth trading.
export type { OpportunityDecision };
export type OpportunityMode = "manual" | "demo" | "auto";

export interface OpportunityItem {
  id: string;
  preset: Preset;
  presetLabel: string;
  /** Whether this user's server auto-trader currently has this preset enabled. Added after analysis assembly. */
  active?: boolean;
  symbol: string;
  label: string;
  market: string;
  decision: OpportunityDecision;
  direction: "CALL" | "PUT" | null;
  directionLabel: string;
  confidence: number;
  agreement: number;
  risk: "faible" | "modere" | "eleve";
  mode: OpportunityMode;
  instrument: "binary" | "multiplier";
  durationMinutes: number;
  takeProfitUsd: number | null;
  stopLossUsd: number | null;
  reasons: string[];
  blockers: string[];
  stats: {
    trades: number;
    winRate: number | null;
    pnl: number;
    expectancy: number | null;
    profitFactor: number | null;
  };
  updatedAt: number;
}

export interface AvoidItem {
  preset: Preset;
  presetLabel: string;
  symbol: string;
  label: string;
  reason: string;
  stats: OpportunityItem["stats"];
}

export interface OpportunitiesResponse {
  generatedAt: number;
  opportunities: OpportunityItem[];
  avoidList: AvoidItem[];
  summary: {
    take: number;
    wait: number;
    avoid: number;
    presets: number;
  };
}

// "boom" deliberately excluded from opportunity scanning (2026-08-07,
// strategy-tournament audit): production data shows Boom losing overall
// Boom réintégré 2026-08-09 : le preset a été corrigé (minTfAgreement 2→4,
// TP/SL inversé 15/10, multiplierLevel 100x) et réactivé en démo. Les anciens
// résultats (PF 0.85, -$198) étaient avec TF=2 et TP/SL inversé — la config
// actuelle est structurellement différente.
const PRESETS: Preset[] = ["boom", "vol75", "crash", "crash500", "default", "liquidity", "gold", "goldv2"];
const PRESET_LABEL: Record<Preset, string> = {
  default: "Multi",
  boom: "Boom500",
  boom900: "Boom900",
  vol75: "Volatility 75 (1s)",
  crash: "Crash900",
  crash500: "Crash500",
  scalping: "Scalping",
  liquidity: "Reversal liquidité",
  gold: "Or Trend",
  crash900: "Crash900 V2",
  boomv2: "Boom V2 — contrôlé",
  scalpingv2: "Scalping V2 — Spike Hunter",
  liquidityv2: "Liquidity V2 — XAU sweep",
  goldv2: "Gold V2 — session pullback",
};

const CANONICAL_PRESET: Record<Preset, Partial<AutoTraderConfig>> = {
  default: DEFAULT_CONFIG,
  boom: BOOM_PRESET,
  boom900: BOOM900_PRESET,
  vol75: VOL75_PRESET,
  crash: CRASH_PRESET,
  crash500: CRASH500_PRESET,
  scalping: SCALPING_PRESET,
  liquidity: LIQUIDITY_PRESET,
  gold: GOLD_PRESET,
  crash900: CRASH900_V2_PRESET,
  boomv2: BOOM_V2_PRESET,
  scalpingv2: SCALPING_V2_PRESET,
  liquidityv2: LIQUIDITY_V2_PRESET,
  goldv2: GOLD_V2_PRESET,
};

const SYMBOL_LABELS = new Map(SYMBOLS.map((s) => [s.deriv, s]));

function mergeConfig(userId: number, preset: Preset): AutoTraderConfig {
  const saved = loadBotConfig(userId, preset);
  return {
    ...DEFAULT_CONFIG,
    ...CANONICAL_PRESET[preset],
    ...(saved ?? {}),
  };
}

function statsFor(preset: Preset, symbol: string): OpportunityItem["stats"] {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) AS trades,
             COUNT(*) FILTER (WHERE status = 'won') AS wins,
             COALESCE(SUM(profit), 0) AS pnl,
             COALESCE(SUM(profit) FILTER (WHERE status = 'won'), 0) AS gross_win,
             COALESCE(-SUM(profit) FILTER (WHERE status = 'lost'), 0) AS gross_loss
      FROM bot_trades
      WHERE status IN ('won','lost')
        AND (mode = 'demo' OR mode IS NULL)
        AND preset = ?
        AND symbol = ?
    `)
    .get(preset, symbol) as { trades: number; wins: number; pnl: number; gross_win: number; gross_loss: number };

  return {
    trades: row.trades,
    winRate: row.trades ? row.wins / row.trades : null,
    pnl: row.pnl,
    expectancy: row.trades ? row.pnl / row.trades : null,
    profitFactor: row.gross_loss > 0 ? row.gross_win / row.gross_loss : row.gross_win > 0 ? null : 0,
  };
}

function directionLabel(direction: "CALL" | "PUT" | null, instrument: "binary" | "multiplier") {
  if (!direction) return "Aucune";
  if (instrument === "binary") return direction === "CALL" ? "CALL / Achat" : "PUT / Vente";
  return direction === "CALL" ? "Multiplier hausse" : "Multiplier baisse";
}

// Per-symbol multiplier overrides (e.g. Or/GBP-USD run a looser TF-agreement
// bar than the global config) must apply here too — the live bot already
// resolves this before deciding; the advisor didn't, which let it show
// "take" for a signal the bot would reject as low-agreement.
function thresholdsFor(symbol: string, instrument: "binary" | "multiplier", config: AutoTraderConfig): ClassifyThresholds {
  const override = instrument === "multiplier" ? getMultiplierOverride(symbol) : undefined;
  return {
    minConfidence: config.minConfidence,
    maxConfidence: config.maxConfidence,
    minTfAgreement: override?.minTfAgreement ?? config.minTfAgreement,
    maxVolatilityPct: config.maxVolatilityPct,
    premiumOnly: config.premiumOnly,
  };
}

async function analyzePresetSymbol(preset: Preset, symbol: string, config: AutoTraderConfig): Promise<OpportunityItem> {
  const meta = SYMBOL_LABELS.get(symbol);
  const stats = statsFor(preset, symbol);
  const instrument = getInstrumentForSymbol(symbol, config);
  const now = Date.now();

  if (preset === "boom") {
    const [m15, m5, m1, ticks] = await Promise.all([
      fetchCandlesServer(symbol, 900, 70), fetchCandlesServer(symbol, 300, 70),
      fetchCandlesServer(symbol, 60, 55), fetchRecentTicksServer(symbol, 120).catch(() => []),
    ]);
    const candidates = generateBoom500Signals(m15, m5, m1, ticks);
    const signal = candidates.find((candidate) => candidate.strategy === "BOOM500_SPIKE_HUNTER_BUY") ?? candidates[0];
    const analysis: SymbolAnalysis = signal ? {
      direction: signal.direction, confidence: signal.confidence, agreement: 4,
      premiumCount: signal.confidence >= 95 ? 1 : 0, volatilityPct: signal.volatilityPct,
      volatilityRatio: 1, blockers: [], dominantTf: "M15/M5/M1", suggestedDuration: 0,
      trendAlignmentScore: 4, patternBonus: signal.confidence >= 95 ? 10 : 0,
    } : {
      direction: null, confidence: 0, agreement: 0, premiumCount: 0,
      volatilityPct: 0, volatilityRatio: 1, blockers: ["Pas de setup Boom500 Spike BUY ou Drift SELL confirmé"],
      dominantTf: "M15/M5/M1", suggestedDuration: 0, trendAlignmentScore: 0, patternBonus: 0,
    };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const { decision } = classifyOpportunity(analysis, thresholds, isBadStats(stats));
    return {
      id: `${preset}:${symbol}`, preset, presetLabel: PRESET_LABEL[preset], symbol,
      label: meta?.label ?? symbol, market: meta?.market ?? "unknown", decision,
      direction: analysis.direction, directionLabel: directionLabel(analysis.direction, instrument),
      confidence: analysis.confidence, agreement: analysis.agreement, risk: riskLevelFor(analysis, stats),
      mode: decision === "take" ? "demo" : "manual", instrument, durationMinutes: 0,
      takeProfitUsd: null, stopLossUsd: null,
      reasons: signal ? [`${signal.strategy} · ${signal.reason}`] : explainOpportunity(decision, analysis, thresholds, stats),
      blockers: analysis.blockers, stats, updatedAt: now,
    };
  }

  if (preset === "vol75") {
    const [m15, m5, m1, ticks] = await Promise.all([
      fetchCandlesServer(symbol, 900, 230), fetchCandlesServer(symbol, 300, 230),
      fetchCandlesServer(symbol, 60, 80), fetchRecentTicksServer(symbol, 180).catch(() => []),
    ]);
    const verdict = generateVol75Signal(m15, m5, m1, ticks);
    const signal = verdict.signal;
    const analysis: SymbolAnalysis = signal ? {
      direction: signal.direction, confidence: signal.confidence, agreement: 4,
      premiumCount: signal.confidence >= 92 ? 1 : 0, volatilityPct: signal.volatilityPct,
      volatilityRatio: 1, blockers: [], dominantTf: "M15/M5/M1/ticks", suggestedDuration: 0,
      trendAlignmentScore: 4, patternBonus: signal.confidence >= 92 ? 10 : 0,
    } : {
      direction: null, confidence: verdict.rejection?.score ?? 0, agreement: 0, premiumCount: 0,
      volatilityPct: 0, volatilityRatio: 1, blockers: [verdict.rejection?.reason ?? "NO_TRADE"],
      dominantTf: "M15/M5/M1/ticks", suggestedDuration: 0, trendAlignmentScore: 0, patternBonus: 0,
    };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const { decision } = classifyOpportunity(analysis, thresholds, isBadStats(stats));
    return {
      id: `${preset}:${symbol}`, preset, presetLabel: PRESET_LABEL[preset], symbol,
      label: meta?.label ?? symbol, market: meta?.market ?? "synthetic", decision,
      direction: analysis.direction, directionLabel: directionLabel(analysis.direction, instrument),
      confidence: analysis.confidence, agreement: analysis.agreement, risk: riskLevelFor(analysis, stats),
      mode: decision === "take" ? "demo" : "manual", instrument, durationMinutes: 0,
      takeProfitUsd: null, stopLossUsd: null,
      reasons: signal ? [`${signal.strategy} · ${signal.reason}`] : [`Signal refusé : ${verdict.rejection?.reason ?? "NO_TRADE"}`],
      blockers: analysis.blockers, stats, updatedAt: now,
    };
  }

  if (preset === "crash500") {
    const [m15, m5, m1, ticks] = await Promise.all([
      fetchCandlesServer(symbol, 900, 70), fetchCandlesServer(symbol, 300, 70),
      fetchCandlesServer(symbol, 60, 55), fetchRecentTicksServer(symbol, 120).catch(() => []),
    ]);
    const candidates = generateCrash500Signals(m15, m5, m1, ticks);
    const signal = candidates.find((candidate) => candidate.strategy === "CRASH500_SPIKE_HUNTER_SELL" && candidate.confidence >= 95)
      ?? candidates.sort((a, b) => b.confidence - a.confidence)[0];
    const analysis: SymbolAnalysis = signal ? {
      direction: signal.direction, confidence: signal.confidence, agreement: 4,
      premiumCount: signal.confidence >= 95 ? 1 : 0, volatilityPct: signal.volatilityPct,
      volatilityRatio: 1, blockers: [], dominantTf: "M15/M5/M1", suggestedDuration: 0,
      trendAlignmentScore: 4, patternBonus: signal.confidence >= 95 ? 10 : 0,
    } : {
      direction: null, confidence: 0, agreement: 0, premiumCount: 0,
      volatilityPct: 0, volatilityRatio: 1, blockers: ["Pas de setup Crash500 Spike SELL ou Drift BUY confirmé"],
      dominantTf: "M15/M5/M1", suggestedDuration: 0, trendAlignmentScore: 0, patternBonus: 0,
    };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const { decision } = classifyOpportunity(analysis, thresholds, isBadStats(stats));
    return {
      id: `${preset}:${symbol}`, preset, presetLabel: PRESET_LABEL[preset], symbol,
      label: meta?.label ?? symbol, market: meta?.market ?? "unknown", decision,
      direction: analysis.direction, directionLabel: directionLabel(analysis.direction, instrument),
      confidence: analysis.confidence, agreement: analysis.agreement, risk: riskLevelFor(analysis, stats),
      mode: decision === "take" ? "demo" : "manual", instrument, durationMinutes: 0,
      takeProfitUsd: null, stopLossUsd: null,
      reasons: signal ? [`${signal.strategy} · ${signal.reason}`] : explainOpportunity(decision, analysis, thresholds, stats),
      blockers: analysis.blockers, stats, updatedAt: now,
    };
  }

  if (preset === "scalpingv2") {
    const [m1, m5] = await Promise.all([fetchCandlesServer(symbol, 60, 60), fetchCandlesServer(symbol, 300, 30)]);
    const signal = generateSpikeHunterSignal(symbol, m1, m5);
    const analysis: SymbolAnalysis = signal ? {
      direction: signal.direction, confidence: signal.confidence, agreement: 4, premiumCount: 0,
      volatilityPct: 0, volatilityRatio: 1, blockers: [], dominantTf: "M1/M5", suggestedDuration: config.durationMinutes, trendAlignmentScore: 4, patternBonus: 0,
    } : {
      direction: null, confidence: 0, agreement: 0, premiumCount: 0,
      volatilityPct: 0, volatilityRatio: 1, blockers: ["Pas d'accumulation/distribution Spike Hunter M1/M5"], dominantTf: "M1/M5", suggestedDuration: config.durationMinutes, trendAlignmentScore: 0, patternBonus: 0,
    };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const { decision } = classifyOpportunity(analysis, thresholds, isBadStats(stats));
    return { id: `${preset}:${symbol}`, preset, presetLabel: PRESET_LABEL[preset], symbol, label: meta?.label ?? symbol, market: meta?.market ?? "unknown", decision, direction: analysis.direction, directionLabel: directionLabel(analysis.direction, instrument), confidence: analysis.confidence, agreement: analysis.agreement, risk: riskLevelFor(analysis, stats), mode: "manual", instrument, durationMinutes: config.durationMinutes, takeProfitUsd: config.stakeUsd * ((config.takeProfitPctOfStake ?? 0) / 100) || null, stopLossUsd: config.stakeUsd * ((config.stopLossPctOfStake ?? 0) / 100) || null, reasons: signal ? [signal.reason] : ["Aucun setup Spike Hunter confirmé."], blockers: analysis.blockers, stats, updatedAt: now };
  }

  if (preset === "scalping") {
    const m1 = await fetchCandlesServer(symbol, 60, MIN_M1_CANDLES + 5);
    const signal = generateScalpingSignal(m1);
    const analysis: SymbolAnalysis = signal
      ? {
          direction: signal.direction,
          confidence: signal.confidence,
          agreement: 2,
          premiumCount: 0,
          volatilityPct: signal.volatilityPct,
          volatilityRatio: 1,
          blockers: [],
          dominantTf: "M1/M5",
          suggestedDuration: config.durationMinutes,
          trendAlignmentScore: 2,
          patternBonus: 0,
        }
      : {
          direction: null,
          confidence: 0,
          agreement: 0,
          premiumCount: 0,
          volatilityPct: 0,
          volatilityRatio: 1,
          blockers: ["Setup price-action incomplet"],
          dominantTf: "M1/M5",
          suggestedDuration: config.durationMinutes,
          trendAlignmentScore: 0,
          patternBonus: 0,
        };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const bad = isBadStats(stats);
    const { decision } = classifyOpportunity(analysis, thresholds, bad);
    return {
      id: `${preset}:${symbol}`,
      preset,
      presetLabel: PRESET_LABEL[preset],
      symbol,
      label: meta?.label ?? symbol,
      market: meta?.market ?? "unknown",
      decision,
      direction: analysis.direction,
      directionLabel: directionLabel(analysis.direction, instrument),
      confidence: analysis.confidence,
      agreement: analysis.agreement,
      risk: riskLevelFor(analysis, stats),
      mode: decision === "take" ? "demo" : "manual",
      instrument,
      durationMinutes: config.durationMinutes,
      takeProfitUsd: config.takeProfitPctOfStake ? config.stakeUsd * (config.takeProfitPctOfStake / 100) : null,
      stopLossUsd: config.stopLossPctOfStake ? config.stakeUsd * (config.stopLossPctOfStake / 100) : null,
      reasons: explainOpportunity(decision, analysis, thresholds, stats),
      blockers: analysis.blockers,
      stats,
      updatedAt: now,
    };
  }

  if (preset === "liquidity" || preset === "liquidityv2") {
    const m15 = await fetchCandlesServer(symbol, 900, MIN_LIQUIDITY_CANDLES + 5);
    const signal = generateLiquidityReversalSignal(m15);
    const analysis: SymbolAnalysis = signal
      ? {
          direction: signal.direction,
          confidence: signal.confidence,
          agreement: 4,
          premiumCount: 0,
          volatilityPct: signal.volatilityPct,
          volatilityRatio: 1,
          blockers: [],
          dominantTf: "15m",
          suggestedDuration: 15,
          trendAlignmentScore: 4,
          patternBonus: 0,
        }
      : {
          direction: null,
          confidence: 0,
          agreement: 0,
          premiumCount: 0,
          volatilityPct: 0,
          volatilityRatio: 1,
          blockers: ["Pas de balayage/réintégration M15 confirmé par RSI"],
          dominantTf: "15m",
          suggestedDuration: 15,
          trendAlignmentScore: 0,
          patternBonus: 0,
        };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const { decision } = classifyOpportunity(analysis, thresholds, isBadStats(stats));
    return {
      id: `${preset}:${symbol}`,
      preset,
      presetLabel: PRESET_LABEL[preset],
      symbol,
      label: meta?.label ?? symbol,
      market: meta?.market ?? "unknown",
      decision,
      direction: analysis.direction,
      directionLabel: directionLabel(analysis.direction, instrument),
      confidence: analysis.confidence,
      agreement: analysis.agreement,
      risk: riskLevelFor(analysis, stats),
      mode: "manual",
      instrument,
      durationMinutes: config.durationMinutes,
      takeProfitUsd: null,
      stopLossUsd: null,
      reasons: signal ? [signal.reason] : ["Aucun setup de reversal de liquidité confirmé."],
      blockers: analysis.blockers,
      stats,
      updatedAt: now,
    };
  }

  if (preset === "goldv2") {
    const m15 = await fetchCandlesServer(symbol, 900, MIN_GOLD_SESSION_CANDLES + 5);
    const signal = generateGoldSessionBreakoutSignal(m15);
    const analysis: SymbolAnalysis = signal ? {
      direction: signal.direction, confidence: signal.confidence, agreement: 4, premiumCount: 0,
      volatilityPct: signal.volatilityPct, volatilityRatio: 1, blockers: [], dominantTf: "15m", suggestedDuration: config.durationMinutes, trendAlignmentScore: 4, patternBonus: 0,
    } : {
      direction: null, confidence: 0, agreement: 0, premiumCount: 0,
      volatilityPct: 0, volatilityRatio: 1, blockers: ["Pas de cassure de session suivie d'un pullback validé"], dominantTf: "15m", suggestedDuration: config.durationMinutes, trendAlignmentScore: 0, patternBonus: 0,
    };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const { decision } = classifyOpportunity(analysis, thresholds, isBadStats(stats));
    return { id: `${preset}:${symbol}`, preset, presetLabel: PRESET_LABEL[preset], symbol, label: meta?.label ?? symbol, market: meta?.market ?? "unknown", decision, direction: analysis.direction, directionLabel: directionLabel(analysis.direction, instrument), confidence: analysis.confidence, agreement: analysis.agreement, risk: riskLevelFor(analysis, stats), mode: "manual", instrument, durationMinutes: config.durationMinutes, takeProfitUsd: null, stopLossUsd: null, reasons: signal ? [signal.reason] : ["Aucun setup breakout/pullback de session confirmé sur l'or."], blockers: analysis.blockers, stats, updatedAt: now };
  }

  if (preset === "gold") {
    const [h1, m15, m5, m1] = await Promise.all([
      fetchCandlesServer(symbol, 3600, MIN_GOLD_PULLBACK_H1_CANDLES + 5),
      fetchCandlesServer(symbol, 900, MIN_GOLD_PULLBACK_M15_CANDLES + 5),
      fetchCandlesServer(symbol, 300, MIN_GOLD_PULLBACK_M5_CANDLES + 5),
      fetchCandlesServer(symbol, 60, MIN_GOLD_PULLBACK_M1_CANDLES + 5),
    ]);
    const signal = generateGoldTrendPullbackSignal(h1, m15, m5, m1);
    const analysis: SymbolAnalysis = signal
      ? {
          direction: signal.direction,
          confidence: signal.confidence,
          agreement: 4,
          premiumCount: 0,
          volatilityPct: signal.volatilityPct,
          volatilityRatio: 1,
          blockers: [],
          dominantTf: "1m",
          suggestedDuration: 0,
          trendAlignmentScore: 4,
          patternBonus: 0,
        }
      : {
          direction: null,
          confidence: 0,
          agreement: 0,
          premiumCount: 0,
          volatilityPct: 0,
          volatilityRatio: 1,
          blockers: ["Pas de séquence Trend Pullback H1→M15→M5→M1 complète"],
          dominantTf: "1m",
          suggestedDuration: 0,
          trendAlignmentScore: 0,
          patternBonus: 0,
        };
    const thresholds = thresholdsFor(symbol, instrument, config);
    const { decision } = classifyOpportunity(analysis, thresholds, isBadStats(stats));
    return {
      id: `${preset}:${symbol}`,
      preset,
      presetLabel: PRESET_LABEL[preset],
      symbol,
      label: meta?.label ?? symbol,
      market: meta?.market ?? "unknown",
      decision,
      direction: analysis.direction,
      directionLabel: directionLabel(analysis.direction, instrument),
      confidence: analysis.confidence,
      agreement: analysis.agreement,
      risk: riskLevelFor(analysis, stats),
      mode: "manual",
      instrument,
      durationMinutes: 30,
      takeProfitUsd: null,
      stopLossUsd: null,
      reasons: signal ? [signal.reason] : ["Aucun setup trend-following confirmé sur l'or."],
      blockers: analysis.blockers,
      stats,
      updatedAt: now,
    };
  }

  const { analysis } = await analyzeSymbolCore(symbol, fetchCandlesServer, buildAnalyzeOptsServer(symbol, config));
  const thresholds = thresholdsFor(symbol, instrument, config);
  const bad = isBadStats(stats);
  const { decision } = classifyOpportunity(analysis, thresholds, bad);

  return {
    id: `${preset}:${symbol}`,
    preset,
    presetLabel: PRESET_LABEL[preset],
    symbol,
    label: meta?.label ?? symbol,
    market: meta?.market ?? "unknown",
    decision,
    direction: analysis.direction,
    directionLabel: directionLabel(analysis.direction, instrument),
    confidence: analysis.confidence,
    agreement: analysis.agreement,
    risk: riskLevelFor(analysis, stats),
    mode: decision === "take" ? "demo" : "manual",
    instrument,
    durationMinutes: Math.max(config.durationMinutes, analysis.suggestedDuration),
    takeProfitUsd: instrument === "multiplier" && config.takeProfitPctOfStake ? config.stakeUsd * (config.takeProfitPctOfStake / 100) : null,
    stopLossUsd: instrument === "multiplier" && config.stopLossPctOfStake ? config.stakeUsd * (config.stopLossPctOfStake / 100) : null,
    reasons: explainOpportunity(decision, analysis, thresholds, stats),
    blockers: analysis.blockers,
    stats,
    updatedAt: now,
  };
}

function sortOpportunities(a: OpportunityItem, b: OpportunityItem): number {
  const rank: Record<OpportunityDecision, number> = { take: 0, wait: 1, avoid: 2 };
  if (rank[a.decision] !== rank[b.decision]) return rank[a.decision] - rank[b.decision];
  if (a.decision === "take" && b.decision === "take") return b.confidence - a.confidence;
  return (b.stats.expectancy ?? -999) - (a.stats.expectancy ?? -999);
}

let opportunitiesCache: { timestamp: number; userId: number; result: OpportunitiesResponse } | null = null;
let pendingBuildPromise: Promise<OpportunitiesResponse> | null = null;

export async function buildOpportunities(userId: number): Promise<OpportunitiesResponse> {
  const now = Date.now();
  if (opportunitiesCache && opportunitiesCache.userId === userId && now - opportunitiesCache.timestamp < 15_000) {
    return opportunitiesCache.result;
  }

  if (pendingBuildPromise) {
    return pendingBuildPromise;
  }

  pendingBuildPromise = (async () => {
    try {
      const configs = new Map(PRESETS.map((preset) => [preset, mergeConfig(userId, preset)]));
      const activePresets = new Set(
        (getDb()
          .prepare("SELECT preset FROM bot_state WHERE user_id = ? AND enabled = 1")
          .all(userId) as Array<{ preset: Preset }>)
          .map((row) => row.preset),
      );
      const jobs = PRESETS.flatMap((preset) => {
        const config = configs.get(preset)!;
        const symbols = Array.isArray(config.symbols) ? config.symbols : [];
        return symbols.map((symbol) => ({ preset, symbol, config }));
      });

      const opportunities = (await mapWithConcurrency(jobs, 8, ({ preset, symbol, config }) =>
        analyzePresetSymbol(preset, symbol, config).catch((e) => {
          const meta = SYMBOL_LABELS.get(symbol);
          const stats = statsFor(preset, symbol);
          return {
            id: `${preset}:${symbol}`,
            preset,
            presetLabel: PRESET_LABEL[preset],
            symbol,
            label: meta?.label ?? symbol,
            market: meta?.market ?? "unknown",
            decision: "wait" as const,
            direction: null,
            directionLabel: "Aucune",
            confidence: 0,
            agreement: 0,
            risk: "modere" as const,
            mode: "manual" as const,
            instrument: getInstrumentForSymbol(symbol, config),
            durationMinutes: config.durationMinutes,
            takeProfitUsd: null,
            stopLossUsd: null,
            reasons: ["Analyse indisponible pour le moment."],
            blockers: [(e as Error).message],
            stats,
            updatedAt: Date.now(),
          };
        }),
      ))
        .map((opportunity) => ({ ...opportunity, active: activePresets.has(opportunity.preset) }))
        .sort(sortOpportunities);

      const avoidList: AvoidItem[] = PRESETS.flatMap((preset) => {
        const config = configs.get(preset)!;
        return (config.excludedSymbols ?? []).map((symbol) => {
          const meta = SYMBOL_LABELS.get(symbol);
          const stats = statsFor(preset, symbol);
          return {
            preset,
            presetLabel: PRESET_LABEL[preset],
            symbol,
            label: meta?.label ?? symbol,
            reason: isBadStats(stats) ? "Historique defavorable" : "Exclu de la strategie actuelle",
            stats,
          };
        });
      });

      const res: OpportunitiesResponse = {
        generatedAt: Date.now(),
        opportunities,
        avoidList,
        summary: {
          take: opportunities.filter((o) => o.decision === "take").length,
          wait: opportunities.filter((o) => o.decision === "wait").length,
          avoid: opportunities.filter((o) => o.decision === "avoid").length + avoidList.length,
          presets: PRESETS.length,
        },
      };

      opportunitiesCache = { timestamp: Date.now(), userId, result: res };
      return res;
    } finally {
      pendingBuildPromise = null;
    }
  })();

  return pendingBuildPromise;
}
