import { BOOM_PRESET, CRASH_PRESET, SCALPING_PRESET } from "./autotrader";
import { buildAnalyzeOptsServer } from "./analyze-opts.server";
import { loadBotConfig, type Preset } from "./bot-engine.server";
import { getDb } from "./db.server";
import { SYMBOLS } from "./deriv";
import { fetchCandlesServer } from "./deriv.server";
import { generateScalpingSignal, MIN_M1_CANDLES } from "./scalping-signal.server";
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

const PRESETS: Preset[] = ["boom", "crash", "default", "scalping"];
const PRESET_LABEL: Record<Preset, string> = {
  default: "Multi",
  boom: "Boom",
  crash: "Crash",
  scalping: "Scalping",
};

const CANONICAL_PRESET: Record<Preset, Partial<AutoTraderConfig>> = {
  default: DEFAULT_CONFIG,
  boom: BOOM_PRESET,
  crash: CRASH_PRESET,
  scalping: SCALPING_PRESET,
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

export async function buildOpportunities(userId: number): Promise<OpportunitiesResponse> {
  const configs = new Map(PRESETS.map((preset) => [preset, mergeConfig(userId, preset)]));
  const jobs = PRESETS.flatMap((preset) => {
    const config = configs.get(preset)!;
    return (config.symbols ?? []).map((symbol) => ({ preset, symbol, config }));
  });

  const opportunities = (await mapWithConcurrency(jobs, 4, ({ preset, symbol, config }) =>
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
  )).sort(sortOpportunities);

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

  return {
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
}
