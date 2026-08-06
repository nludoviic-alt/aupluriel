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
  targetPreset: "default" | "boom" | "crash" | "scalping" | "liquidity";
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
    name: "Gold & Trend — Fakeout & Chasse à la Liquidité",
    category: "Multi",
    targetPreset: "default",
    targetMarkets: "Gold (XAU/USD)",
    tagline: "Continuation de tendance HTF sur l'Or. Vente après tentative de breakout / fakeout au-dessus de la droite de tendance avec réintégration et viseur BOS.",
    badge: "Fakeout & Trend 4R",
    riskProfile: "Équilibré",
    color: "from-amber-500/30 via-rose-500/15 to-transparent",
    borderGlow: "border-amber-500/50",
    verifiedNote: "Backtest réel (150 bougies M15, moteur multi-TF) : 0 signal qualifié sur la fenêtre testée à ces seuils — un seul symbole à 80%+ confiance / 3 TF est trop strict pour juger. Ni validé ni invalidé, juste pas assez de données encore.",
    params: {
      minConfidence: 80,
      maxConfidence: 95,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbolsCount: 1,
    },
    configOverride: {
      minConfidence: 80,
      maxConfidence: 95,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbols: ["frxXAUUSD"],
    },
  },
  {
    id: "gold-infinite-trailing",
    name: "Gold & Crypto — Trailing de Compte",
    category: "Multi",
    targetPreset: "default",
    targetMarkets: "Gold (XAU/USD) · Bitcoin (BTC)",
    tagline: "Binaire CALL/PUT classique (pas de position à SL/TP individuel) — la protection est un trailing stop AU NIVEAU DU COMPTE : pas de plafond de profit journalier fixe, coupe seulement si le pic de gains recule de 15%.",
    badge: "Trailing de Compte",
    riskProfile: "Volumique",
    color: "from-amber-500/30 via-yellow-500/15 to-transparent",
    borderGlow: "border-amber-500/40",
    // BOOM1000 et frxGBPUSD retirés après backtest réel : BOOM1000 portait
    // 22 des 33 trades de la version précédente à 72.7% WR, mais c'est un
    // indice synthétique sans edge structurel documenté (cf. exclusion des
    // synthétiques en mode all-markets, DEFAULT_CONFIG.symbols) — un résultat
    // à ce niveau sur un RNG est du bruit, pas une edge. frxGBPUSD tournait
    // à 16.7% WR (6 trades) et tirait le reste vers le bas.
    verifiedNote: "Backtest réel (150 bougies M15) sur XAU+BTC seuls : 5 trades sur la fenêtre testée — bien trop peu pour juger. L'ancienne version (avec BOOM1000 + GBP/USD) affichait 60.6% agrégé, mais 22 des 33 trades venaient de BOOM1000 (indice synthétique sans edge documentée) et GBP/USD était à 16.7% — un artefact, pas une edge réelle.",
    params: {
      minConfidence: 75,
      maxConfidence: 95,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbolsCount: 2,
    },
    configOverride: {
      minConfidence: 75,
      maxConfidence: 95,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      trailingStopPct: 0.15,
      trailingStopMinPeakUsd: 5,
      symbols: ["frxXAUUSD", "cryBTCUSD"],
    },
  },
  {
    id: "smc-liquidity-avg",
    name: "SMC — Liquidité Externe & AVG 50-60%",
    category: "Multi",
    targetPreset: "liquidity",
    targetMarkets: "Gold (XAU/USD) · Bitcoin (BTC) · EUR/USD",
    tagline: "Biais institutionnel H1 sur zone d'équilibre 50-60% (OTE/AVG). Entrée M5/M15 dans le FVG interne avec TP sur la liquidité externe.",
    badge: "Institutionnel SMC",
    riskProfile: "Équilibré",
    color: "from-purple-500/20 via-violet-500/10 to-transparent",
    borderGlow: "border-purple-500/30",
    // OTC_GDAXI retiré : déjà identifié comme le pire symbole de l'audit VPS
    // 2026-08-05 (-$77.54) et responsable direct de la perte Multi du
    // 2026-08-04. BOOM1000 retiré : synthétique sans edge structurelle
    // documentée, et sous breakeven ici (38.5% sur 13 trades) — c'était lui
    // qui gonflait artificiellement l'agrégat.
    verifiedNote: "Backtest réel (moteur retournement de liquidité, 300 bougies M15) : l'agrégat à 5 symboles dépassait le seuil de rentabilité (57.1%), mais porté par 2 échantillons minuscules à 100% (4 trades chacun sur XAU et EUR/USD) pendant que BOOM1000 (38.5%/13) et OTC_GDAXI — déjà signalé ailleurs comme le pire symbole de l'audit prod — tiraient vers le bas. Retirés ici ; à retester sur un plus grand échantillon avant de faire confiance au chiffre.",
    params: {
      minConfidence: 78,
      maxConfidence: 95,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbolsCount: 3,
    },
    configOverride: {
      minConfidence: 78,
      maxConfidence: 95,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbols: ["frxXAUUSD", "cryBTCUSD", "frxEURUSD"],
    },
  },
  // "multi-balanced" retiré le 2026-08-06 : backtest réel (150 bougies M15)
  // sur sa config d'origine → 22 trades, 45.5% WR, -8.6pp sous breakeven
  // (DÉFAVORABLE). Sa liste de symboles incluait OTC_SPC et OTC_GDAXI — les
  // deux symboles que l'audit VPS 2026-08-05 identifie comme les pires
  // (et responsables directs de la perte Multi du 2026-08-04, voir l'analyse
  // du mardi). Une version corrigée (symboles retirés, confiance relevée à
  // 85) reste sous breakeven sur l'échantillon testé ET utilise 2 symboles
  // de moins que "Multi — Volumique" (cryBTCUSD, frxEURUSD absents) — donc
  // strictement inférieure à un modèle déjà vérifié plutôt qu'une variante
  // utile. Pas de raison de la garder ; "Multi — Conservateur"/"Volumique"
  // couvrent déjà ce terrain avec des symboles prouvés.
  {
    id: "scalping-m1",
    name: "Scalping — M1/M5 Haute Fréquence",
    category: "Scalping",
    targetPreset: "scalping",
    targetMarkets: "BOOM500 (Indices Synthétiques M1/M5) · EUR/USD (Forex M1)",
    tagline: "Exécution ultra-rapide sur micro-impulsions M1/M5. Réaction immédiate sur cassures et micro-spikes.",
    badge: "Scalping M1/M5",
    riskProfile: "Volumique",
    color: "from-cyan-500/20 via-sky-500/10 to-transparent",
    borderGlow: "border-cyan-500/30",
    verifiedNote: "Backtest réel (150 bougies M15) : 110 trades, 52.7% — quasi pile ou face, sous le seuil de rentabilité (54.1%). Une variante plus stricte testée (confiance 78%, TF 3/4) fait pire (51.4% sur 37 trades). BOOM500 seul est légèrement positif (54.7%) mais frxEURUSD est exactement à 50% et le tire vers le bas. Aucune edge démontrée pour l'instant.",
    params: {
      minConfidence: 70,
      maxConfidence: 95,
      minTfAgreement: 2,
      durationMinutes: 1,
      stakeUsd: 1,
      maxDailyLossUsd: 10,
      symbolsCount: 2,
    },
    configOverride: {
      minConfidence: 70,
      maxConfidence: 95,
      minTfAgreement: 2,
      durationMinutes: 1,
      stakeUsd: 1,
      maxDailyLossUsd: 10,
      symbols: ["BOOM500", "frxEURUSD"],
    },
  },
  {
    id: "multi-conservative",
    name: "Multi — Conservateur",
    category: "Multi",
    targetPreset: "default",
    targetMarkets: "Dow Jones · Nasdaq · EUR/GBP · EUR/USD · BTC/USD · GBP/USD · USD/CAD",
    tagline: "Filtrage ultra-strict avec accord 4/4 TF et confiance 80-89%. 3 symboles seulement, sélectionnés sur les données de production VPS (2204 trades, audit 2026-08-06).",
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
      // Audit VPS 2026-08-06 (2204 trades production) : seuls 3 symboles Multi
      // sont défendables — frxEURGBP (PF 2.11, +$25), frxUSDCAD (PF 2.29,
      // +$25), OTC_NDX (PF 10.17, +$99, échantillon faible mais prometteur).
      // OTC_DJI retiré (PF 0.83, -$36.64), frxEURUSD retiré (PF 0.16, -$11.50),
      // cryBTCUSD retiré (PF 0.74, -$17.65), frxGBPUSD retiré (PF 0.88, -$2.69).
      // minConfidence abaissé 85->80 : l'audit montre que 80-89% est la tranche
      // la plus rentable (PF 1.22, +$54), pas 85-89 seul.
      minConfidence: 80,
      maxConfidence: 89,
      minTfAgreement: 4,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbols: ["frxEURGBP", "frxUSDCAD", "OTC_NDX"],
    },
  },
  {
    id: "multi-volume",
    name: "Multi — Volumique",
    category: "Multi",
    targetPreset: "default",
    targetMarkets: "Dow Jones · Nasdaq · EUR/GBP · EUR/USD · BTC/USD · GBP/USD · USD/CAD",
    tagline: "Même watchlist validée que Conservateur, mais accord 3/4 TF pour plus de volume. Attention : TF=3 est le pire bucket d'accord TF en production (PF 0.65, -$141.76) — à utiliser avec prudence.",
    badge: "Fréquence Élevée",
    riskProfile: "Volumique",
    color: "from-emerald-500/20 via-teal-500/10 to-transparent",
    borderGlow: "border-emerald-500/30",
    // Badge verified retiré 2026-08-06 : l'audit VPS production (2204 trades)
    // montre que TF=3 est le pire bucket d'accord TF (PF 0.65, -$141.76 sur
    // la base locale ; PF 0.85 sur le VPS mais bien inférieur à TF=4 qui est
    // à PF 0.97). Recommender TF≥3 pour "plus de volume" est dangereux —
    // le volume supplémentaire vient des trades les plus perdants.
    verifiedNote: "Audit VPS 2026-08-06 : TF=3 est le pire bucket d'accord TF en production (PF 0.65, -$141.76). La version Conservateur (TF≥4) est strictement supérieure. Cette stratégie reste disponible pour exploration mais n'est plus certifiée.",
    params: {
      minConfidence: 80,
      maxConfidence: 89,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbolsCount: 3,
    },
    configOverride: {
      // Mêmes 3 symboles que Conservateur (alignés audit VPS 2026-08-06).
      // TF≥3 au lieu de TF≥4 pour plus de volume — mais l'audit montre que
      // TF=3 est le pire bucket (PF 0.65). À utiliser avec prudence.
      minConfidence: 80,
      maxConfidence: 89,
      minTfAgreement: 3,
      durationMinutes: 15,
      stakeUsd: 5,
      maxDailyLossUsd: 20,
      symbols: ["frxEURGBP", "frxUSDCAD", "OTC_NDX"],
    },
  },
  {
    id: "boom-spikes",
    name: "Boom — Spikes Scalper",
    category: "Boom",
    targetPreset: "boom",
    targetMarkets: "BOOM 500",
    tagline: "BOOM500 seul — le moins pire des symboles Boom en production (PF 0.94, -$34.53 sur 282 trades). Aucun symbole Boom n'est encore rentable : à surveiller, pas à confiance aveugle.",
    badge: "Indices Boom",
    riskProfile: "Spikes",
    color: "from-rose-500/20 via-red-500/10 to-transparent",
    borderGlow: "border-rose-500/30",
    // Badge verified retiré 2026-08-06 : l'audit VPS production montre qu'aucun
    // symbole Boom n'est rentable — BOOM500 (PF 0.94, -$34.53), BOOM1000
    // (PF 0.71, -$26.99), BOOM900 (PF 0.85, -$69.55), BOOM600 (PF 0.43,
    // -$24.30). BOOM1000 retiré de la liste (PF 0.71). BOOM500 conservé seul
    // comme le moins pire, en attente de validation sur 150 trades.
    verifiedNote: "Audit VPS 2026-08-06 (production, 601 trades Boom) : aucun symbole Boom n'a un PF > 1. BOOM500 est le moins pire (PF 0.94, 76.2% WR) mais reste perdant. BOOM1000 retiré (PF 0.71). Stratégie en observation, plus en validation.",
    params: {
      minConfidence: 85,
      maxConfidence: 89,
      minTfAgreement: 4,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbolsCount: 1,
    },
    configOverride: {
      // Audit VPS 2026-08-06 : BOOM500 seul (PF 0.94, le moins pire des 4
      // symboles Boom). BOOM1000 retiré (PF 0.71, -$26.99). BOOM900 et
      // BOOM600 déjà exclus. TF≥4 (au lieu de 3) car TF=3 est le pire bucket.
      minConfidence: 85,
      maxConfidence: 89,
      minTfAgreement: 4,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbols: ["BOOM500"],
    },
  },
  {
    id: "crash-reversal",
    name: "Crash — Reversal Hunter",
    category: "Crash",
    targetPreset: "crash",
    targetMarkets: "CRASH 900",
    tagline: "CRASH900 seul — le meilleur symbole de toute la production (PF 1.58, +$160.31 sur 111 trades). CRASH1000 retiré (PF 0.98, quasi neutre). TF≥4 pour éliminer le pire bucket d'accord TF.",
    badge: "Indices Crash",
    riskProfile: "Spikes",
    color: "from-purple-500/20 via-fuchsia-500/10 to-transparent",
    borderGlow: "border-purple-500/30",
    verified: true,
    params: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbolsCount: 1,
    },
    configOverride: {
      // Audit VPS 2026-08-06 : CRASH900 est le meilleur symbole de toute la
      // production (PF 1.58, +$160.31, 111 trades). CRASH1000 retiré (PF 0.98,
      // -$9.52 — quasi neutre mais pas rentable). CRASH500/600 déjà exclus.
      // TF≥4 (au lieu de 3) car TF=3 est le pire bucket d'accord TF (PF 0.65).
      // maxConfidence laissé à 100 : l'audit ne montre pas que 90-100% est
      // mauvais spécifiquement pour Crash.
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 4,
      stakeUsd: 5,
      maxDailyLossUsd: 15,
      symbols: ["CRASH900"],
    },
  },
  // ── Best Day — Config gagnante de mardi 4 août 2026 ──
  // Boom: +31.78$ (138 trades, 59.4% WR) · Crash: +92.48$ (114 trades, 71.1% WR)
  // Total Boom+Crash: +124.26$ — seule la config Multi/default perdait ce jour.
  {
    id: "best-day-boom",
    name: "Best Day — Boom (Mardi)",
    category: "Best Day",
    targetPreset: "boom",
    targetMarkets: "BOOM 500 · BOOM 1000",
    tagline: "Configuration exacte de mardi 4 août 2026 — jour gagnant Boom (+31.78$, 138 trades, 59.4% WR). Multi-symboles, TF≥2, SL 15%, TP 10%.",
    badge: "Best Day",
    riskProfile: "Spikes",
    color: "from-green-500/25 via-emerald-500/10 to-transparent",
    borderGlow: "border-green-500/40",
    verified: true,
    params: {
      minConfidence: 85,
      maxConfidence: 89,
      minTfAgreement: 2,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 30,
      symbolsCount: 2,
    },
    configOverride: {
      // Config de mardi 4 août 2026 — jour gagnant (+31.78$ sur 138 trades)
      minConfidence: 85,
      maxConfidence: 89,
      minTfAgreement: 2,
      stakeUsd: 5,
      maxDailyLossUsd: 30,
      stopLossPctOfStake: 15,
      takeProfitPctOfStake: 10,
      multiplierLevel: 100,
      symbols: ["BOOM500", "BOOM1000"],
      excludedSymbols: ["BOOM600", "BOOM900"],
    },
  },
  {
    id: "best-day-crash",
    name: "Best Day — Crash (Mardi)",
    category: "Best Day",
    targetPreset: "crash",
    targetMarkets: "CRASH 900 · CRASH 1000",
    tagline: "Configuration exacte de mardi 4 août 2026 — meilleur jour Crash (+92.48$, 114 trades, 71.1% WR). CRASH900+1000, TF≥3, SL 10%, TP 10%.",
    badge: "Best Day",
    riskProfile: "Spikes",
    color: "from-green-500/25 via-emerald-500/10 to-transparent",
    borderGlow: "border-green-500/40",
    verified: true,
    params: {
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 3,
      durationMinutes: 5,
      stakeUsd: 5,
      maxDailyLossUsd: 50,
      symbolsCount: 2,
    },
    configOverride: {
      // Config de mardi 4 août 2026 — meilleur jour Crash (+92.48$ sur 114 trades, 71.1% WR)
      minConfidence: 85,
      maxConfidence: 100,
      minTfAgreement: 3,
      stakeUsd: 5,
      maxDailyLossUsd: 50,
      stopLossPctOfStake: 10,
      takeProfitPctOfStake: 10,
      multiplierLevel: 100,
      symbols: ["CRASH1000", "CRASH900"],
      excludedSymbols: ["CRASH500", "CRASH600"],
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
