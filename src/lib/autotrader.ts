// BROWSER auto-trading engine. The pure decision logic (signal aggregation,
// sessions, news windows, risk math) lives in signal-core.ts, shared with the
// server engine (bot-engine.server.ts) so the two can never drift apart.
// Only executes trades when strict signal quality thresholds are met.

import { fetchCandles, proposalContract, proposalMultiplierContract, buyContract, subscribeContract, getProfitTable, getOpenPositions, GRANULARITY, getBalance } from "./deriv";
import { generateSignal, rsi, macd, ema, bollinger } from "./indicators";
import { evaluateStrategies } from "./strategies";
import { getLearnedWeights, recordComponentOutcomes } from "./indicator-weights";
import {
  DEFAULT_CONFIG,
  TIMEFRAMES,
  aggregateTfSignals,
  analyzeSymbolCore,
  computeKellyFraction,
  isSymbolTradeable,
  minContractMinutes,
  todayPnl,
  type AutoTraderConfig,
  type SymbolAnalysis,
  type TfSignalMap,
  type TradeEventHandler,
  type TradeLog,
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

async function proposeAndBuyMultiplier(params: {
  symbol: string;
  amount: number;
  direction: "MULTUP" | "MULTDOWN";
  multiplier: number;
  stopLossUsd: number;
  takeProfitUsd: number;
}, maxAttempts = 3): Promise<{ contractId: number; buyPrice: number }> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const proposal = await proposalMultiplierContract({
        symbol: params.symbol,
        amount: params.amount,
        contractType: params.direction,
        multiplier: params.symbol.startsWith("cry") ? Math.min(params.multiplier, 10) : params.multiplier,
        stopLossUsd: params.stopLossUsd,
        takeProfitUsd: params.takeProfitUsd,
      });
      const maxPrice = Math.round(proposal.askPrice * 1.05 * 100) / 100;
      const bought = await buyContract(proposal.id, maxPrice);
      return { contractId: bought.contractId, buyPrice: bought.buyPrice };
    } catch (e) {
      lastError = e as Error;
      if (/price|amount|stake|decimal|invalid|not available|not offered|multiplier|limit_order/i.test(lastError.message)) break;
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  throw lastError ?? new Error("Échec achat Multiplicateur");
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
  // Paires du panier Multi validé (pas dans DEFAULT_CONFIG.excludedSymbols —
  // un symbole présent dans les deux listes disparaît silencieusement du scan).
  // Pas d'indices synthétiques (R_*) : séries RNG, aucun edge réel possible,
  // winrate long terme ~50% = perte structurelle face au payout.
  symbols: ["frxEURGBP", "frxUSDCAD"],
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
  // frxEURUSD et cryBTCUSD sont dans DEFAULT_CONFIG.excludedSymbols —
  // utiliser frxEURGBP et frxUSDCAD (panier Multi validé) évite le piège du
  // symbole présent dans symbols ET excludedSymbols (silencieusement droppé).
  symbols: ["frxEURGBP", "frxGBPUSD", "frxUSDCAD"],
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
  // frxEURUSD, frxUSDJPY, frxXAUUSD, cryBTCUSD, cryETHUSD sont tous dans
  // DEFAULT_CONFIG.excludedSymbols. On garde frxGBPUSD (validé) + OTC indices
  // + frxEURGBP/frxUSDCAD du panier Multi.
  symbols: ["frxEURGBP", "frxGBPUSD", "frxUSDCAD", "OTC_NDX", "OTC_SPC"],
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

// ── Quick-switch presets (Default vs Boom 1000 vs Crash vs Scalping) ─────────
export type QuickPreset = "default" | "boom" | "crash" | "scalping";

/** The 3 Boom indices Deriv actually offers as Multiplier that are
 * profitable (confirmed live — Boom 100/150/200/300/50 don't exist on
 * Deriv Options/Multipliers at all; BOOM600 excluded after production
 * audit: 62.7% WR, -$46.95 over 150 trades; BOOM1000 excluded after
 * recalibrage TP 10%: EV -$0.02/trade, quasi break-even). */
export const BOOM_SYMBOLS = ["BOOM500", "BOOM900"];

/** Mirror of BOOM_SYMBOLS for Crash — 2 variants retained after production
 * audit (CRASH600 dominates, CRASH1000/900 near breakeven). NOT yet
 * confirmed live the way BOOM_SYMBOLS was — treat as a starting guess. */
export const CRASH_SYMBOLS = ["CRASH1000", "CRASH900"];

/**
 * BOOM preset — scalping haute fréquence sur les 2 index Boom rentables.
 *
 * Philosophie : beaucoup de trades courts, on ferme dès qu'un trade est en
 * gain (même quelques centimes) plutôt que d'attendre un objectif ambitieux.
 * Trades/positions illimités (pas de plafond artificiel — seule limite
 * réelle : 1 position par symbole, donc 2 max avec 2 symboles), mais la
 * protection anti-série-de-pertes reste active (maxConsecutiveLosses).
 *
 * Différences clés vs Default :
 * - 2 symboles (BOOM500/900), pas de scan all-markets
 * - instrumentType multiplier : aucun Boom n'a de Rise/Fall sur Deriv
 * - Durée 5 min (min autorisé par Deriv pour les synthétiques)
 * - Confiance 55 : très permissif, on veut du volume
 * - Accord TF 2/4 : minimum pour valider un signal
 * - Volatilité max 20% : les Boom font des spikes, on accepte tout
 * - maxConsecutiveLosses 4, trailingStopPct 0.20 : garde-fous de perte conservés (demandé)
 * - trailingStopMinPeakUsd 15, maxDailyLossUsd 50, hourlyEdgeFilter off :
 *   recalibrage haute fréquence — ces trois réglages hérités de DEFAULT_CONFIG
 *   (conçu pour 2-12 trades/jour) mettaient le bot en pause jusqu'à minuit UTC
 *   au bout de quelques trades. Détail dans les commentaires ci-dessous.
 * - maxSimultaneousTrades / maxOpenPositions / maxTradesPerDay / maxDailyProfitUsd :
 *   plafonds retirés (trades illimités, demandé) — bornés en pratique par
 *   1 position/symbole × 2 symboles
 * - multiplierLevel 100 (au lieu du défaut générique 20) : mesuré par sweep
 *   réel — à 20x la distance de prix du TP/SL dépassait le mouvement typique
 *   de Boom en 60 min (93% des trades expiraient sans jamais toucher ni l'un
 *   ni l'autre) ; à 100x (défaut DTrader pour les Boom) ça tombe à 2.5%
 * - takeProfitPctOfStake 5, stopLossPctOfStake 30 : validé en walk-forward
 *   (positif sur une période de vérification jamais vue par l'optimisation,
 *   WR 88%), contrairement à TP10/SL15 qui changeait de signe selon la
 *   fenêtre. Ratio 6:1 assumé — détail dans les commentaires ci-dessous.
 * - atrStopMode off, partialTakeProfitPct 0 : sortie nette, pas de partiel
 * - maxHoldMinutes 60 : ne laisse pas une position traîner si le petit
 *   objectif n'est jamais atteint
 * - newsFilter off, blockCorrelated off, veto4h off, vetoDaily off
 * - premiumOnly off : on prend tous les signaux
 * - dynamicDuration on : adapte la durée selon la volatilité
 * - cooldownMinutes 15 : reprise rapide après une série de pertes
 * - minPayoutRatio 0.70 : accepte des payouts plus modestes
 * - minSymbolWinRate 0.30 : ne coupe pas un symbole trop vite
 * - adxFilterMode off : pas de filtre de trend sur RNG
 * - stakeMode fixed : mise constante, pas de Kelly
 */
export const BOOM_PRESET: Partial<AutoTraderConfig> = {
  // ── 2 symboles Boom (BOOM600 exclu — 62.7% WR, -$46.95 sur 150 trades ;
  //    BOOM1000 exclu — EV -$0.02/trade après recalibrage TP 10%) ──
  symbolMode: "watchlist",
  symbols: BOOM_SYMBOLS,
  // Pas de excludedSymbols ici : c'est une curation indépendante (ex. BOOM600
  // exclu après analyse réelle), pas une propriété du preset. Un preset qui
  // la fixe à [] l'efface silencieusement à chaque (ré)application — bug
  // constaté en prod le 2026-08-01, BOOM600 réapparu après un simple
  // aller-retour entre presets. Les 3 points d'application (applyPreset côté
  // client, /api/bot action=preset, /api/admin/user-config) préservent
  // maintenant explicitement excludedSymbols au lieu de le laisser ici.
  // ── Instrument — aucun Boom n'a de Rise/Fall sur Deriv, Multiplier only ──
  instrumentType: "multiplier",
  symbolInstrumentOverrides: {},
  // ── Signaux — très permissif pour du volume ──
  minConfidence: 80,
  maxConfidence: 89,
  minTfAgreement: 2,
  premiumOnly: false,
  // ── Durée — 5 min (min pour synthétiques) ──
  durationMinutes: 5,
  dynamicDuration: true,
  // ── Volatilité — les Boom font des spikes brutals, on accepte ──
  maxVolatilityPct: 20,
  // ── Risk — garde-fous recalibrés pour la haute fréquence ET pour la taille
  // de perte du couple TP/SL choisi plus bas. Ces seuils DÉPENDENT du
  // stopLossPctOfStake : les changer sans recalibrer ici est le bug d'origine
  // de ce preset (trailingStopMinPeakUsd valait 3 alors qu'une seule perte
  // valait 0.75 — le bot se mettait en pause jusqu'à minuit UTC après ~6
  // gains suivis d'UNE perte normale).
  // Règle appliquée : le giveback toléré doit couvrir les maxConsecutiveLosses
  // pertes d'affilée, sinon une série normale tue la journée.
  //   perte/trade = stakeUsd × stopLossPctOfStake = $5 × 20% = $1.00
  //   4 pertes    = $4.00  →  peak × 0.20 > $4.00  →  peak > $20
  // (stopLossPctOfStake est passé de 30% à 20% le 2026-08-02, voir plus bas —
  // trailingStopMinPeakUsd=30 reste donc plus conservateur que le minimum
  // requis, pas un oubli de recalibrage.)
  maxConsecutiveLosses: 4,
  cooldownMinutes: 15,
  trailingStopPct: 0.20,
  trailingStopMinPeakUsd: 30,
  // maxDailyLossUsd 50 (au lieu des 15 hérités de DEFAULT_CONFIG) : à $1.00
  // de perte par trade (SL 20%), $50 = 50 trades perdants, atteignable en
  // haute fréquence avant la pause jusqu'à minuit UTC. C'est le garde-fou de
  // RISQUE RÉEL qui borne la journée (le trailing stop ci-dessus, lui, ne
  // s'arme quasiment jamais avec un TP de $0.50 : il faudrait des centaines
  // de trades pour un pic de $30). À revoir avant tout passage en mode live.
  maxDailyLossUsd: 50,
  // hourlyEdgeFilter off : il bloque une heure UTC dès que 5 trades y ont un
  // P&L cumulé négatif (voir getBlockedHours dans signal-core.ts). Conçu pour
  // le preset Default (2-12 trades/jour, une heure atteint rarement 5 trades),
  // il devient un frein permanent en haute fréquence — sur un synthétique RNG
  // la moitié des heures finissent négatives par pur hasard, et une heure
  // bloquée ne peut plus se rétablir puisqu'elle ne trade plus.
  hourlyEdgeFilter: false,
  // ── Volume — le vrai plafond est 1 position par symbole (le scan saute un
  // symbole déjà en position), donc 3 positions simultanées avec 3 symboles.
  // maxOpenPositions/maxTradesPerDay sont volontairement hors d'atteinte. ──
  maxSimultaneousTrades: 2,
  maxOpenPositions: 3,
  maxTradesPerDay: 100_000,
  maxDailyProfitUsd: 0,
  // ── Take-profit/stop-loss + levier — recalibrés après audit production
  //    (8 juillet → 2 août, 874 trades Boom clôturés).
  // 1) multiplierLevel 100x confirmé : à 20x, 93% des trades n'atteignaient
  //    ni TP ni SL en 60 min. À 100x, les trades se résolvent sur TP/SL.
  // 2) TP relevé de 5% à 10% après analyse des données réelles :
  //    TP 5% / SL 30% → break-even à 85.7% de wins. BOOM500 (86.3%) et
  //    BOOM900 (82.2%) passent juste, mais BOOM1000 (74.1%) perd.
  //    TP 10% / SL 30% → break-even à 75%. Gain $0.50 au lieu de $0.25.
  //    BOOM500 : EV +$0.23/trade (was +$0.08), BOOM900 : +$0.14 (was +$0.07),
  //    BOOM1000 : EV -$0.02 (was -$0.20) — quasi break-even au lieu de perte.
  //    MULTDOWN (79.3% WR, -$203.86 avec TP 5%) devient EV +$0.09/trade.
  // 3) Contrepartie : le win rate baissera (TP plus distant), mais l'EV
  //    s'améliore sur tous les symboles. Les garde-fous (maxConsecutiveLosses,
  //    cooldown, maxDailyLoss) restent calibrés sur SL 20% = $1.00/trade.
  multiplierLevel: 100,
  takeProfitPctOfStake: 10,
  stopLossPctOfStake: 20,
  atrStopMode: false,
  partialTakeProfitPct: 0,
  maxHoldMinutes: 60,
  // ── Pas de filtres inutiles sur synthétique 24/7 ──
  newsFilter: false,
  blockCorrelated: false,
  veto4h: "off",
  vetoDaily: "off",
  // ── Sessions 24/7 ──
  tradingSessions: ["asia", "london", "newyork"],
  sessionEdgeMinutes: 0,
  // ── Payout minimum modéré ──
  minPayoutRatio: 0.70,
  // ── Ne coupe pas le symbole trop vite ──
  minSymbolWinRate: 0.30,
  symbolWinRateLookback: 15,
  // ── Adaptatif ──
  adaptiveStake: false,
  stopOnRisk: true,
  progressiveStakeReduction: false,
  // ── Kelly off sur synthétique (pas d'edge mesurable fiable) ──
  stakeMode: "fixed",
  // ── ADX filter off sur Boom (RNG = pas de vrai trend) ──
  adxFilterMode: "off",
};

export function isBoomPresetActive(config: AutoTraderConfig): boolean {
  return config.symbolMode === "watchlist"
    && config.symbols.length === BOOM_SYMBOLS.length
    && BOOM_SYMBOLS.every((s) => config.symbols.includes(s));
}

/**
 * CRASH preset — premier passage mesuré sur données réelles (skill
 * tune-boom-preset, sweep.ts --symbols=CRASH1000,CRASH500,CRASH600,CRASH900),
 * pas un simple clone de BOOM_PRESET.
 *
 * Fait confirmé au passage : les 4 symboles CRASH1000/500/600/900 renvoient
 * bien des bougies historiques réelles chez Deriv (candidat plausible avant
 * de le tester — BOOM_SYMBOLS avait eu la mauvaise surprise que plusieurs
 * variantes marketées n'existaient pas comme Multiplier malgré leur
 * présence sur le site).
 *
 * Sweep du 2026-08-01, 500 bougies (~125h), levier 100x (le palier confirmé
 * réel — même que Boom) :
 *   TP5% / SL30% / confiance 60 / TF 2/4 → 1112 trades, 88.4% WR, edge +2.7pp
 *   au-dessus du seuil de rentabilité (85.7%), +$100.65 total, seulement
 *   72/1112 trades expirés sans toucher ni stop ni objectif (6.5%).
 * Même ratio TP:SL que Boom (5:30) — cohérent avec Crash étant le miroir
 * structurel de Boom, mais confiance 60 (pas 55) mesurée séparément.
 *
 * Piste NON retenue ici : le sweep improve encore à 150x/200x (edge jusqu'à
 * +5.8pp) — mais rien ne confirme que ces paliers de levier sont réellement
 * sélectionnables chez Deriv pour Crash (Boom lui-même n'offre que certains
 * paliers précis). Ne pas les activer sans vérification live.
 *
 * Par symbole (combo gagnant) : CRASH600 domine largement (94.8% WR, edge
 * +9.1pp, $53 sur 310 trades) — CRASH1000/900 proches du seuil de
 * rentabilité (edge -0.8pp / -1.1pp), à surveiller une fois de vraies
 * données live disponibles, même logique qui a fait exclure BOOM600.
 *
 * Limite assumée : une seule fenêtre de 125h, pas un vrai walk-forward
 * optimiser/vérifier comme celui qui a validé BOOM_PRESET (deux fenêtres
 * distinctes, la seconde jamais vue par l'optimisation). Traiter comme un
 * signal réel fort, pas encore comme un résultat aussi solide que Boom.
 */
export const CRASH_PRESET: Partial<AutoTraderConfig> = {
  ...BOOM_PRESET,
  symbolMode: "watchlist",
  symbols: CRASH_SYMBOLS,
  // Pas de excludedSymbols ici non plus — même raison que BOOM_PRESET plus haut.
  // Revalidation Deriv récente (300 bougies, 330 trades candidats, levier
  // 100x) : TP 5% / SL 20% a produit +$17.59, 82.4% de réussite contre
  // 80% requis, avec seulement 14 sorties au temps. TP 10% / SL 20% était
  // plus faible sur la même fenêtre (+$12.58) et davantage dépendant du timeout.
  takeProfitPctOfStake: 5,
  stopLossPctOfStake: 20,
  // Noyau prod retenu le 2026-08-02 : CRASH1000/900 avec accord TF 3+.
  // La confiance reste large (70-100) car ce preset manque encore de marge ;
  // le vrai filtre est le symbole + TF, pas un bucket 80-89 comme Boom.
  minConfidence: 70,
  maxConfidence: 100,
  minTfAgreement: 3,
  multiplierLevel: 100,
};

export function isCrashPresetActive(config: AutoTraderConfig): boolean {
  return config.symbolMode === "watchlist"
    && config.symbols.length === CRASH_SYMBOLS.length
    && CRASH_SYMBOLS.every((s) => config.symbols.includes(s));
}

/** Scalping V2 watchlist: BOOM500, BOOM900 and CRASH1000 validated on real SQLite metrics */
export const SCALPING_SYMBOLS = ["BOOM500", "BOOM900", "CRASH1000"];

/**
 * "Scalping" preset (2026-08-02) — an isolated, low-risk M1/M5 price-action
 * strategy: M5 trend (price vs SMA20) → M1 pullback to SMA10 → M1
 * confirmation candle → structural stop at the last swing low/high → 1.5R
 * target. Full rules and backtest numbers in scalping-signal.server.ts.
 *
 * This is a DIFFERENT TRADING MECHANISM, not a confidence-band variant of
 * Boom: bot-engine.server.ts branches on preset === "scalping" and calls
 * generateScalpingSignal instead of analyzeSymbolCore, and sizes the stop via
 * computeStructuralStopUsd instead of ATR/flat-% of stake. It therefore does
 * NOT inherit Boom's TP/SL — those fields are ignored for this preset.
 *
 * Runs as a genuinely separate server engine so it can trade BOOM500
 * alongside Boom itself without disrupting Boom's own live config — the two
 * are told apart in bot_trades via the explicit `preset` column (not symbol
 * inference, which can't distinguish them since they share BOOM500).
 *
 * Risk guards are scaled down for the deliberately tiny stake ($1, vs
 * Boom's $5) — NOT left at BOOM_PRESET's values. Leaving a $-denominated
 * guard sized for a $5 stake while the stake shrinks 5x is exactly the bug
 * class already documented on BOOM_PRESET.trailingStopMinPeakUsd (a guard
 * that doesn't scale with stake pauses the bot after a handful of normal
 * losses, or does nothing at all).
 */
export const SCALPING_PRESET: Partial<AutoTraderConfig> = {
  ...BOOM_PRESET,
  symbolMode: "watchlist",
  symbols: SCALPING_SYMBOLS,
  // Keep scalping in the same conservative confidence band as the current
  // production test. The sample is still tiny, so volume stays intentionally
  // constrained until it proves itself.
  minConfidence: 80,
  maxConfidence: 89,
  stakeUsd: 1,
  // Scaled down from BOOM_PRESET's $5 stake to this preset's $1 — not left at
  // BOOM_PRESET's values verbatim. trailingStopMinPeakUsd follows the
  // mechanical ÷5 (BOOM_PRESET's 30 → 6); maxDailyLossUsd is a deliberately
  // stricter $5 (not the ÷5-implied $10) since this is still a tiny, unproven
  // sample (see header comment) and Boom's own stopLossPctOfStake doesn't
  // even apply here — Scalping sizes its stop structurally per-trade
  // (computeStructuralStopUsd), not as a flat % of stake.
  maxDailyLossUsd: 5,
  maxConsecutiveLosses: 3,
  trailingStopMinPeakUsd: 6,
  maxSimultaneousTrades: 2,
  maxOpenPositions: 3,
  // mode is forced back to "demo" server-side on every start (see
  // api/bot.ts) regardless of what's requested — this preset never trades
  // real money, by design, until the comparison in step 10 of the plan says
  // otherwise and a human explicitly decides to graduate it.
  mode: "demo",
};

/**
 * Demo-only experiment for XAU/USD and US Tech 100: an M15 sweep of a recent
 * liquidity extreme, followed by a close back into the range and RSI turn.
 * It is intentionally a separate preset so it cannot alter Multi's validated
 * market list or risk behaviour.
 */
export const LIQUIDITY_PRESET: Partial<AutoTraderConfig> = {
  ...DEFAULT_CONFIG,
  symbolMode: "watchlist",
  symbols: ["frxXAUUSD", "OTC_NDX"],
  // Pas de excludedSymbols ici — même raison que BOOM_PRESET : un preset
  // qui le fixe à [] l'efface silencieusement à chaque (ré)application.
  instrumentType: "binary",
  stakeUsd: 1,
  durationMinutes: 15,
  minConfidence: 80,
  maxConfidence: 95,
  minTfAgreement: 4,
  maxDailyLossUsd: 3,
  maxTradesPerDay: 2,
  maxConsecutiveLosses: 2,
  maxSimultaneousTrades: 1,
  maxOpenPositions: 1,
  tradingSessions: ["london", "newyork"],
  mode: "demo",
};

export function isScalpingPresetActive(config: AutoTraderConfig): boolean {
  return config.symbolMode === "watchlist"
    && config.symbols.length === SCALPING_SYMBOLS.length
    && SCALPING_SYMBOLS.every((s) => config.symbols.includes(s));
}

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

// ─── Real Kelly-criterion stake ────────────────────────────────────────────────
// "adaptiveStake" above is a coarse win-rate-tiered haircut, marketed as "Kelly"
// in the UI but not an actual Kelly calculation. This is: the real formula
// (f* = p - q/b), fed by the REAL measured win-rate/payout from
// backtestMultiTf instead of a value the user guesses.

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
    const trimmed = logs.slice(0, 500);
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
      addToCumulativePnl(profit);
      addToDailyPnl(profit);
      emit({ ...base, status: won ? "won" : "lost", profit, payout: won ? stakeUsd + profit : 0, closedAt: Date.now() });
    } catch {
      emit({ ...base, status: "error", profit: 0 });
    }
  }, durationMinutes * 60_000);
}

/**
 * Opens a manual trade on the connected Deriv account. The UI already requires
 * an explicit confirmation; this function only routes that confirmed choice to
 * the valid Deriv contract family for the selected market.
 */
export async function forceDemoTrade(
  symbolDeriv: string,
  direction: TradeLog["direction"],
  stake: number,
  durationMinutes: number,
  onEvent: TradeEventHandler,
  multiplierSettings: Pick<AutoTraderConfig, "multiplierLevel" | "stopLossPctOfStake" | "takeProfitPctOfStake"> = DEFAULT_CONFIG,
): Promise<void> {
  const isMultiplier = direction === "MULTUP" || direction === "MULTDOWN";
  if (!isSymbolTradeable(symbolDeriv, isMultiplier ? "multiplier" : "binary")) {
    throw new Error(isMultiplier
      ? "Le contrat Multiplicateur n’est pas disponible sur ce marché."
      : "Ce marché nécessite un contrat Multiplicateur (MULTUP/MULTDOWN).");
  }
  if (!isMultiplier) durationMinutes = Math.max(durationMinutes, minContractMinutes(symbolDeriv));
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
  const stopLossUsd = Math.round(stake * (multiplierSettings.stopLossPctOfStake / 100) * 100) / 100;
  const takeProfitUsd = Math.round(stake * (multiplierSettings.takeProfitPctOfStake / 100) * 100) / 100;
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
    note: isMultiplier ? "Prise manuelle · Multiplicateur" : "Prise manuelle · CALL/PUT",
    entryPrice: entryPrice || undefined,
    ...(isMultiplier
      ? { multiplier: symbolDeriv.startsWith("cry") ? Math.min(multiplierSettings.multiplierLevel, 10) : multiplierSettings.multiplierLevel, stopLossUsd, takeProfitUsd }
      : { durationMinutes, expiry: Date.now() + durationMinutes * 60_000 }),
  };
  emit(pending);

  try {
    if (isMultiplier) {
      const bought = await proposeAndBuyMultiplier({
        symbol: symbolDeriv,
        amount: stake,
        direction: direction as "MULTUP" | "MULTDOWN",
        multiplier: multiplierSettings.multiplierLevel,
        stopLossUsd,
        takeProfitUsd,
      });
      const openLog: TradeLog = { ...pending, status: "open", contractId: bought.contractId };
      emit(openLog);
      const unsub = subscribeContract(bought.contractId, (update) => {
        if (update.status === "open") return;
        unsub();
        emit({ ...openLog, status: update.status === "won" ? "won" : "lost", profit: update.profit, closedAt: Date.now() });
      });
      return;
    }
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

async function analyzeSymbol(
  symbolDeriv: string,
  veto4h: Veto4hMode,
  vetoDaily: Veto4hMode = "off",
  opts?: {
    confluenceMode?: "vote" | "weighted";
    adxFilterMode?: "off" | "penalize" | "block";
    adxBlockThreshold?: number;
    adxStrongThreshold?: number;
  },
): Promise<SymbolAnalysis> {
  const learnedWeights = getLearnedWeights(symbolDeriv);
  const { analysis, candles15m } = await analyzeSymbolCore(
    symbolDeriv,
    (sym, granularitySeconds, count) => fetchCandles(sym, granularitySeconds, count),
    { weights: learnedWeights, veto4h, vetoDaily, ...opts },
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
    minConfidence = 72,
    minTfAgreement = 4,
    durationMinutes = 15,
    stakeUsd = 5,
    testCandles = 150, // number of 15m entry points tested (~37.5h of opportunities)
    veto4h = "strong-only",
    vetoDaily = "strong-only",
    confluenceMode = "weighted",
    adxFilterMode = "block",
    adxBlockThreshold = 20,
    adxStrongThreshold = 25,
  }: {
    minConfidence?: number;
    minTfAgreement?: number;
    durationMinutes?: number;
    stakeUsd?: number;
    testCandles?: number;
    veto4h?: Veto4hMode;
    vetoDaily?: Veto4hMode;
    confluenceMode?: "vote" | "weighted";
    adxFilterMode?: "off" | "penalize" | "block";
    adxBlockThreshold?: number;
    adxStrongThreshold?: number;
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
    const analysis = aggregateTfSignals(tfSignals, 0, 1, veto4h, 0, undefined, vetoDaily, {
      confluenceMode,
      adxFilterMode,
      adxBlockThreshold,
      adxStrongThreshold,
    });
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
