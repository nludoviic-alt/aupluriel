/**
 * Shared preset strategy definitions — extracted from routes/strategies.tsx
 * so admin.tsx can import them without a route-to-route circular dependency
 * (which crashed the admin page at runtime: "Cannot read properties of
 * undefined (reading 'length')", 2026-08-06).
 */
import type { AutoTraderConfig } from "./signal-core";

export interface PresetStrategyDef {
  id: string;
  name: string;
  category: "Multi" | "Boom" | "Crash" | "Scalping" | "Best Day";
  targetPreset: "default" | "boom" | "boom900" | "crash" | "scalping" | "crash900" | "boomv2" | "scalpingv2";
  targetMarkets: string;
  tagline: string;
  badge: string;
  riskProfile: "Équilibré" | "Conservateur" | "Volumique" | "Spikes";
  color: string;
  borderGlow: string;
  /** Set only on strategies whose configOverride was cross-checked against
   * real production trade data (bot_trades / config-change-impact) and
   * corrected to match — not just a plausible-sounding template. Renders the
   * green "Vérifié" badge below. See src/lib/signal-core.ts DEFAULT_CONFIG
   * for the audited symbol/confidence values this must stay aligned with. */
  verified?: boolean;
  /** Set on strategies that were re-run through the real historical
   * backtest engine (backtestMultiTfServer / backtestLiquidityReversalServer
   * — see scratch analysis run 2026-08-06) but did NOT clear the bar for
   * `verified`, so the finding is shown instead of hidden. Never invent a
   * green badge to fill this gap — an honest "pas encore d'edge démontrée"
   * note is the point of testing, not a defect to paper over. */
  verifiedNote?: string;
  params: {
    minConfidence: number;
    maxConfidence: number;
    minTfAgreement: number;
    durationMinutes: number;
    stakeUsd: number;
    maxDailyLossUsd: number;
    symbolsCount: number;
  };
  configOverride: Partial<AutoTraderConfig>;
}

export const OFFICIAL_PRESET_STRATEGIES: PresetStrategyDef[] = [
  {
    id: "gold-trend-liquidity-sweep",
    name: "Gold & Trend — Fakeout (Exclu)",
    category: "Multi",
    targetPreset: "default",
    targetMarkets: "Gold (XAU/USD - EXCLU)",
    tagline: "❌ Symbole Or (frxXAUUSD) exclu suite aux pertes subies (-37.46$). Preset désactivé par Risk Guard.",
    badge: "❌ Exclu (Gold)",
    riskProfile: "Conservateur",
    color: "from-rose-500/30 via-red-500/15 to-transparent",
    borderGlow: "border-rose-500/50",
    verifiedNote: "Marché Or (frxXAUUSD) définitivement exclu de l'Auto-Trader suite à l'audit (-37.46$ de perte nette).",
    params: {
      minConfidence: 80,
      maxConfidence: 95,
      minTfAgreement: 4,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbolsCount: 0,
    },
    configOverride: {
      minConfidence: 80,
      maxConfidence: 95,
      minTfAgreement: 4,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbols: ["frxEURGBP", "frxUSDCAD"],
      excludedSymbols: ["frxXAUUSD", "BOOM500", "CRASH500", "BOOM1000", "CRASH900"],
    },
  },
  {
    id: "gold-infinite-trailing",
    name: "Gold & Crypto — Trailing de Compte (Exclu)",
    category: "Multi",
    targetPreset: "default",
    targetMarkets: "Bitcoin (BTC) · Or Exclu",
    tagline: "❌ Or (frxXAUUSD) exclu (-37.46$). BTC retenu avec trailing stop au niveau du compte.",
    badge: "❌ Exclu (Gold)",
    riskProfile: "Volumique",
    color: "from-amber-500/30 via-yellow-500/15 to-transparent",
    borderGlow: "border-amber-500/40",
    verifiedNote: "Or (frxXAUUSD) exclu suite à l'audit empirique. BTC conservé en surveillance isolée.",
    params: {
      minConfidence: 80,
      maxConfidence: 95,
      minTfAgreement: 4,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbolsCount: 1,
    },
    configOverride: {
      minConfidence: 80,
      maxConfidence: 95,
      minTfAgreement: 4,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      trailingStopPct: 0.15,
      trailingStopMinPeakUsd: 5,
      symbols: ["cryBTCUSD"],
      excludedSymbols: ["frxXAUUSD", "BOOM500", "CRASH500", "BOOM1000", "CRASH900"],
    },
  },
  {
    id: "scalping-m1",
    name: "Scalping — M1/M5 Haute Fréquence",
    category: "Scalping",
    targetPreset: "scalping",
    targetMarkets: "BOOM900 (Synthétiques M1/M5) · EUR/USD",
    tagline: "Exécution ultra-rapide M1/M5. BOOM900 seul retenu. BOOM500 (-86.22$) et CRASH500 (-59.27$) exclus.",
    badge: "Scalping M1/M5",
    riskProfile: "Volumique",
    color: "from-cyan-500/20 via-sky-500/10 to-transparent",
    borderGlow: "border-cyan-500/30",
    verifiedNote: "BOOM900 est le seul symbole Boom rentable en production (+32.89$, PF 1.31). BOOM500 exclu (-86.22$).",
    params: {
      minConfidence: 75,
      maxConfidence: 95,
      minTfAgreement: 4,
      durationMinutes: 1,
      stakeUsd: 1,
      maxDailyLossUsd: 10,
      symbolsCount: 2,
    },
    configOverride: {
      minConfidence: 75,
      maxConfidence: 95,
      minTfAgreement: 4,
      durationMinutes: 1,
      stakeUsd: 1,
      maxDailyLossUsd: 10,
      symbols: ["BOOM900", "frxEURUSD"],
      excludedSymbols: ["BOOM500", "CRASH500", "BOOM1000", "CRASH900", "frxXAUUSD"],
    },
  },
  {
    id: "multi-conservative",
    name: "Multi — Conservateur",
    category: "Multi",
    targetPreset: "default",
    targetMarkets: "Nasdaq (OTC_NDX) · EUR/GBP · USD/CAD",
    tagline: "Filtrage ultra-strict TF=4 et confiance 80-89%. 3 symboles certifiés. BOOM500/1000, CRASH500/900 et Or exclus.",
    badge: "Sécurité Max",
    riskProfile: "Conservateur",
    color: "from-blue-500/20 via-indigo-500/10 to-transparent",
    borderGlow: "border-blue-500/30",
    verified: true,
    params: {
      minConfidence: 80,
      maxConfidence: 89,
      minTfAgreement: 4,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbolsCount: 3,
    },
    configOverride: {
      minConfidence: 80,
      maxConfidence: 89,
      minTfAgreement: 4,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbols: ["frxEURGBP", "frxUSDCAD", "OTC_NDX"],
      excludedSymbols: ["frxXAUUSD", "OTC_SPC", "BOOM500", "CRASH500", "BOOM1000", "CRASH900"],
    },
  },
  {
    id: "boom-spikes",
    name: "Boom — Spikes Scalper",
    category: "Boom",
    targetPreset: "boom",
    targetMarkets: "BOOM 900 uniquement",
    tagline: "BOOM900 seul — symbole Boom rentable (+32.89$, PF 1.31). BOOM500 (-86.22$) et BOOM1000 (-43.01$) exclus.",
    badge: "Indices Boom",
    riskProfile: "Spikes",
    color: "from-rose-500/20 via-red-500/10 to-transparent",
    borderGlow: "border-rose-500/30",
    verified: true,
    params: {
      minConfidence: 80,
      maxConfidence: 100,
      minTfAgreement: 4,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbolsCount: 1,
    },
    configOverride: {
      minConfidence: 80,
      maxConfidence: 100,
      minTfAgreement: 4,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbols: ["BOOM900"],
      excludedSymbols: ["BOOM500", "BOOM1000", "BOOM600"],
    },
  },
  {
    id: "crash-reversal",
    name: "Crash — Reversal Hunter",
    category: "Crash",
    targetPreset: "crash",
    targetMarkets: "CRASH 1000 uniquement",
    tagline: "CRASH1000 seul — symbole Crash certifié (PF 1.02, +2.14$). CRASH500 (-59.27$) et CRASH900 (-43.63$) exclus.",
    badge: "Indices Crash",
    riskProfile: "Spikes",
    color: "from-purple-500/20 via-fuchsia-500/10 to-transparent",
    borderGlow: "border-purple-500/30",
    verified: true,
    params: {
      minConfidence: 80,
      maxConfidence: 100,
      minTfAgreement: 4,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbolsCount: 1,
    },
    configOverride: {
      minConfidence: 80,
      maxConfidence: 100,
      minTfAgreement: 4,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbols: ["CRASH1000"],
      excludedSymbols: ["CRASH500", "CRASH600", "CRASH900"],
    },
  },
  {
    id: "best-day-boom",
    name: "Best Day — Boom (Exclu)",
    category: "Best Day",
    targetPreset: "boom",
    targetMarkets: "BOOM 500 / 1000 (EXCLUS)",
    tagline: "❌ BOOM500 (-86.22$) et BOOM1000 (-43.01$) définitivement exclus. Remplacé par BOOM900 certifié.",
    badge: "❌ Exclu",
    riskProfile: "Spikes",
    color: "from-rose-500/25 via-red-500/10 to-transparent",
    borderGlow: "border-rose-500/40",
    verifiedNote: "BOOM500 et BOOM1000 sont définitivement exclus du robot suite au bilan de pertes. Seul BOOM900 est autorisé.",
    params: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 30,
      symbolsCount: 1,
    },
    configOverride: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      stakeUsd: 5,
      maxDailyLossUsd: 30,
      stopLossPctOfStake: 15,
      takeProfitPctOfStake: 10,
      multiplierLevel: 100,
      symbols: ["BOOM900"],
      excludedSymbols: ["BOOM500", "BOOM1000", "BOOM600"],
    },
  },
  {
    id: "best-day-crash",
    name: "Best Day — Crash 1000",
    category: "Best Day",
    targetPreset: "crash",
    targetMarkets: "CRASH 1000 uniquement",
    tagline: "CRASH1000 certifié. CRASH900 (-43.63$) et CRASH500 (-59.27$) exclus. Accord TF=4 forcé.",
    badge: "Crash Certifié",
    riskProfile: "Spikes",
    color: "from-green-500/25 via-emerald-500/10 to-transparent",
    borderGlow: "border-green-500/40",
    verified: true,
    params: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 50,
      symbolsCount: 1,
    },
    configOverride: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      stakeUsd: 5,
      maxDailyLossUsd: 50,
      stopLossPctOfStake: 10,
      takeProfitPctOfStake: 10,
      multiplierLevel: 100,
      symbols: ["CRASH1000"],
      excludedSymbols: ["CRASH500", "CRASH600", "CRASH900"],
    },
  },
  {
    id: "bon-jour-crash",
    name: "Bon Jour — Crash 1000",
    category: "Best Day",
    targetPreset: "crash",
    targetMarkets: "CRASH 1000 uniquement",
    tagline: "Stratégie optimisée CRASH1000 avec filtre horaire. CRASH900 (-43.63$) et CRASH500 (-59.27$) exclus.",
    badge: "Bon Jour",
    riskProfile: "Spikes",
    color: "from-green-500/30 via-teal-500/15 to-transparent",
    borderGlow: "border-green-500/50",
    verifiedNote: "CRASH1000 est le seul marché Crash conservé après exclusion de CRASH900 et CRASH500.",
    params: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      durationMinutes: 5,
      stakeUsd: 10,
      maxDailyLossUsd: 50,
      symbolsCount: 1,
    },
    configOverride: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      stakeUsd: 10,
      maxDailyLossUsd: 50,
      stopLossPctOfStake: 10,
      takeProfitPctOfStake: 10,
      multiplierLevel: 100,
      symbols: ["CRASH1000"],
      excludedSymbols: ["CRASH500", "CRASH600", "CRASH900"],
      hourlyEdgeFilter: true,
      hourlyEdgeLookback: 5,
      tradingSessions: ["asia", "london", "newyork"],
      sessionEdgeMinutes: 0,
    },
  },
];

/** True only when every field this template actually overrides matches what
 * the server is presently running for that preset. This is the source of
 * truth for the "Active sur Bot" badge — a local id remembered from the last
 * click is not: the server config can drift away from any given template
 * (an admin edit, another device, a direct fix) without that memory ever
 * noticing, so it can keep claiming a template is active long after it
 * stopped being true. */
export function matchesLiveConfig(strat: PresetStrategyDef, live: AutoTraderConfig | null | undefined): boolean {
  if (!live) return false;
  return Object.entries(strat.configOverride).every(([key, expected]) => {
    const actual = (live as unknown as Record<string, unknown>)[key];
    if (Array.isArray(expected)) {
      return Array.isArray(actual) && JSON.stringify([...expected].sort()) === JSON.stringify([...actual].sort());
    }
    return actual === expected;
  });
}
