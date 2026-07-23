// Pure trading logic shared by the BROWSER engine (autotrader.ts) and the
// SERVER engine (bot-engine.server.ts). Nothing here may touch localStorage,
// WebSocket, window or any other environment-specific API — both engines must
// produce identical decisions from identical inputs.

import { generateSignal } from "./indicators";
import type { GeneratedSignal, SignalComponent } from "./indicators";

// ─── Sessions ─────────────────────────────────────────────────────────────────

export type TradingSession = "sydney" | "asia" | "london" | "newyork";

export const SESSION_HOURS: Record<TradingSession, { label: string; open: number; close: number }> = {
  sydney:   { label: "Sydney",    open: 21, close: 6  },  // 21:00–06:00 UTC (passe minuit)
  asia:     { label: "Asie",      open: 0,  close: 9  },  // 00:00–09:00 UTC
  london:   { label: "Londres",   open: 7,  close: 16 },  // 07:00–16:00 UTC
  newyork:  { label: "New York",  open: 12, close: 21 },  // 12:00–21:00 UTC
};

/** Is the given session window active right now? Handles windows crossing midnight (Sydney). */
function isSessionActive(s: TradingSession, edgeMinutes = 0): boolean {
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const { open, close } = SESSION_HOURS[s];
  const start = open * 60 + edgeMinutes;
  const end = close * 60 - edgeMinutes;
  if (open > close) return utcMins >= start || utcMins < end; // wraps past midnight
  return utcMins >= start && utcMins < end;
}

export function currentActiveSessions(): TradingSession[] {
  return (Object.keys(SESSION_HOURS) as TradingSession[]).filter((s) => isSessionActive(s));
}

// ─── Contract availability on the Deriv Options Trading API ──────────────────
// - crypto (cry*): MULTIPLIER contracts only — CALL/PUT rise/fall unavailable
// - Boom/Crash (BOOM*/CRASH*): no CALL/PUT either
// - forex/commodities (frx*): CALL/PUT from 15 minutes, session-bound
// - stock indices (OTC_*): CALL/PUT 15m→1h, only during exchange hours
// - synthetic indices (R_*, 1HZ*, JD*, stpRNG, RDBULL/RDBEAR): from 15s, 24/7

/** True when the symbol supports CALL/PUT contracts (what the bot trades). */
export function isCallPutAvailable(symbol: string): boolean {
  return !symbol.startsWith("cry") && !symbol.startsWith("BOOM") && !symbol.startsWith("CRASH");
}

/**
 * True when the symbol can be traded with the given instrument type.
 * Crypto is Multiplier-only on the Deriv Options API — the old blanket
 * isCallPutAvailable() gate wrongly kept BTC/ETH out of the scan even after
 * Multiplier became the default instrument, which also cost the bot its only
 * 24/7 non-synthetic markets (forex sleeps outside London/NY sessions).
 * Stock indices (OTC_*) are the opposite case: Deriv offers them as CALL/PUT
 * but never as Multiplier — falling through to isCallPutAvailable() here
 * used to say "yes" for Multiplier mode too, so the bot would scan, signal,
 * and attempt real orders on OTC_* that Deriv always rejects with "Trading
 * is not offered for this duration" (a wasted cycle, not a loss, but a
 * symbol that can never actually fill in Multiplier mode).
 */
export function isSymbolTradeable(symbol: string, instrumentType: "binary" | "multiplier"): boolean {
  if (symbol.startsWith("cry")) return instrumentType === "multiplier";
  if (symbol.startsWith("OTC_") && instrumentType === "multiplier") return false;
  return isCallPutAvailable(symbol);
}

/** Minimum CALL/PUT contract duration (minutes) allowed for this symbol. */
export function minContractMinutes(symbol: string): number {
  return symbol.startsWith("frx") || symbol.startsWith("OTC_") ? 15 : 5;
}

/** Symbols that trade around the clock (no session/news filtering needed). */
export function is24x7Symbol(symbol: string): boolean {
  return !symbol.startsWith("frx") && !symbol.startsWith("OTC_") && !symbol.startsWith("WLD");
}

// Stock indices only trade during their home exchange's hours — approximated
// by the matching forex session window (backstop: Deriv rejects with
// MarketIsClosed if we're off).
export const INDEX_HOME_SESSION: Record<string, TradingSession> = {
  OTC_N225: "asia", OTC_HSI: "asia", OTC_AS51: "asia",
  OTC_FTSE: "london", OTC_GDAXI: "london", OTC_FCHI: "london",
  OTC_AEX: "london", OTC_SSMI: "london", OTC_SX5E: "london",
  OTC_SPC: "newyork", OTC_DJI: "newyork", OTC_NDX: "newyork",
};

export function isInTradingSession(sessions: TradingSession[], symbol: string, edgeMinutes = 0): boolean {
  // Crypto MARKETS trade 24/7, but this bot's crypto edge doesn't: live
  // results split sharply by session — trades opened 21h-02h UTC (forex
  // sessions closed, thin flow, indicator signals over noise) account for
  // the bulk of realized losses, while London/NY hours sit near break-even.
  // So crypto follows the configured session windows like forex does.
  if (symbol.startsWith("cry")) return sessions.some((s) => isSessionActive(s, edgeMinutes));

  // Synthetic indices are genuinely sessionless (RNG-generated) — no filter.
  if (is24x7Symbol(symbol)) return true;

  // Stock indices: their home exchange must be open AND enabled in the config
  const home = INDEX_HOME_SESSION[symbol];
  if (home) return sessions.includes(home) && isSessionActive(home, edgeMinutes);

  return sessions.some((s) => isSessionActive(s, edgeMinutes));
}

// ─── News macro filter ───────────────────────────────────────────────────────
// Event windows only apply on the days those events actually happen (Fed =
// Wednesday, ECB = Thursday, NFP = first Friday); session-open windows apply
// every weekday. The whole filter is opt-out via config.newsFilter for users
// who WANT to trade the volatile open (higher risk, their call).
interface RiskWindow {
  utcHour: number;
  utcMinute: number;
  durationMinutes: number;
  label: string;
  /** Limit to a UTC weekday (0=Sun … 6=Sat). Absent = every weekday. */
  utcDay?: number;
  /** Additionally require it to be the first such weekday of the month (NFP). */
  firstOfMonth?: boolean;
}

const HIGH_RISK_WINDOWS: RiskWindow[] = [
  { utcHour: 7,  utcMinute: 55, durationMinutes: 20, label: "Ouverture Londres" },
  { utcHour: 13, utcMinute: 25, durationMinutes: 20, label: "Ouverture NY" },
  { utcHour: 17, utcMinute: 55, durationMinutes: 15, label: "Fix Londres" },
  { utcHour: 23, utcMinute: 55, durationMinutes: 15, label: "Ouverture Asie" },
  { utcHour: 12, utcMinute: 15, durationMinutes: 30, label: "NFP", utcDay: 5, firstOfMonth: true },
  { utcHour: 12, utcMinute: 15, durationMinutes: 30, label: "ECB", utcDay: 4 },
  { utcHour: 18, utcMinute: 0,  durationMinutes: 20, label: "Zone Fed", utcDay: 3 },
];

export function isHighRiskWindow(): { blocked: boolean; reason?: string } {
  const now = new Date();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  // Block on Fridays after 20:00 UTC (low liquidity weekend)
  if (now.getUTCDay() === 5 && now.getUTCHours() >= 20) {
    return { blocked: true, reason: "Vendredi soir — faible liquidité avant week-end" };
  }
  for (const w of HIGH_RISK_WINDOWS) {
    if (w.utcDay !== undefined && now.getUTCDay() !== w.utcDay) continue;
    if (w.firstOfMonth && now.getUTCDate() > 7) continue;
    const start = w.utcHour * 60 + w.utcMinute;
    if (utcMins >= start && utcMins < start + w.durationMinutes) {
      return { blocked: true, reason: `Fenêtre à risque : ${w.label} (${w.durationMinutes}min)` };
    }
  }
  return { blocked: false };
}

// ─── Config ───────────────────────────────────────────────────────────────────

export type TradingMode = "simulation" | "demo" | "live";

/** How the 4H timeframe can veto a trade whose direction it contradicts. */
export type Veto4hMode = "always" | "strong-only" | "off";

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
  maxConsecutiveLosses: number;   // pause the SYMBOL after N consecutive losses on it
  cooldownMinutes: number;        // per-symbol pause length after a losing streak
  tradingSessions: TradingSession[]; // only trade during these sessions
  adaptiveStake: boolean;         // reduce stake automatically when losing
  premiumOnly: boolean;           // only trade PREMIUM-grade signals
  stopOnRisk: boolean;            // pause engine (with auto-resume) when a daily risk limit hits
  maxVolatilityPct: number;       // skip a symbol when ATR% above this
  maxDailyProfitUsd: number;     // pause bot for the day when daily profit >= this (0 = disabled)
  stakeMode: "fixed" | "percent" | "kelly"; // fixed USD, % of balance, or measured-edge Kelly sizing
  stakePercent: number;           // % of balance per trade (used when stakeMode = "percent")
  kellyFraction: number;          // fractional Kelly safety multiplier (0.5 = half-Kelly) when stakeMode = "kelly"
  sessionEdgeMinutes: number;     // skip N minutes at session open/close (avoids fake breakouts)
  trailingStopUsd: number;        // pause for the day if P&L drops this much below session peak (0 = disabled)
  blockCorrelated: boolean;       // skip correlated pairs when one is already active
  symbolMode: "watchlist" | "all-markets"; // trade only config.symbols, or rank+trade across every eligible market
  maxSimultaneousTrades: number;  // cap on how many NEW trades a single scan tick can open
  maxOpenPositions: number;       // hard cap on TOTAL concurrently open positions (across all scan ticks) — maxSimultaneousTrades is per-tick only, so successive ticks used to stack positions without bound
  newsFilter: boolean;            // block session-open / macro-event windows on session-bound markets
  veto4h: Veto4hMode;             // how strictly a contrarian 4H cancels a trade
  minPayoutRatio: number;         // skip a trade if the live quoted payout (profit/stake) is below this — a thin payout raises the win rate needed to break even, independent of signal confidence
  vetoDaily: Veto4hMode;          // how strictly a contrarian Daily trend cancels a trade ("off" = Daily bias not fetched at all)
  minSymbolWinRate: number;       // pause a SYMBOL when its rolling win rate drops below this (0 = disabled)
  symbolWinRateLookback: number;  // how many of the symbol's last closed trades the rolling win rate above is computed over
  // --- Instrument: binary (CALL/PUT, fixed expiry) or Multiplier (MULTUP/MULTDOWN, no expiry) ---
  instrumentType: "binary" | "multiplier";
  multiplierLevel: number;        // leverage level for Multiplier trades
  stopLossPctOfStake: number;     // Multiplier stop-loss, as % of the stake (100 = capped at losing the full stake, same max-loss-per-trade as binary) — used when atrStopMode is off
  takeProfitPctOfStake: number;   // Multiplier take-profit, as % of the stake — used when atrStopMode is off
  maxHoldMinutes: number;         // force-close a Multiplier position after this long even if neither stop-loss nor take-profit triggered (avoids swap fees / stuck positions)
  // --- ATR-based dynamic stop-loss/take-profit (Multiplier only) ---
  // A flat % of stake is blind to how much the instrument actually moves: at
  // 10x leverage, losing 100% of the stake needs a ~10% price move — on major
  // forex pairs (ATR% typically 0.05-0.2% per 15m candle) that almost never
  // happens from normal price action, so the "stop-loss" rarely does its job.
  // ATR mode ties the stop distance to the symbol's OWN current volatility
  // instead, so it tightens on calm markets and widens on volatile ones.
  atrStopMode: boolean;           // off by default — backtest before enabling on a live account
  atrStopMultiple: number;        // stop distance = this many multiples of the 15m ATR%
  riskRewardRatio: number;        // take-profit distance = stop distance × this ratio
}

/**
 * ATR-based stop-loss/take-profit for a Multiplier position, in absolute USD.
 * Multiplier P&L ≈ stake × leverage × price-change%, so a stop distance of
 * `atrMultiple` ATRs (in price %) translates linearly into a $ loss cap.
 * Both legs are capped at the stake itself — Deriv can't take more than that
 * on a Multiplier (deal cancellation / stop-out), so requesting more is a no-op
 * at best and a rejected order at worst.
 */
export function computeAtrStopUsd(
  stakeUsd: number,
  multiplierLevel: number,
  volatilityPct: number,
  atrMultiple: number,
  riskRewardRatio: number,
): { stopLossUsd: number; takeProfitUsd: number } {
  const stopDistancePct = Math.max(0.01, volatilityPct) * atrMultiple; // price % move that hits the stop
  const rawStop = stakeUsd * (multiplierLevel * stopDistancePct) / 100;
  const stopLossUsd = Math.round(Math.min(stakeUsd, Math.max(0.5, rawStop)) * 100) / 100;
  const takeProfitUsd = Math.round(stopLossUsd * riskRewardRatio * 100) / 100;
  return { stopLossUsd, takeProfitUsd };
}

export const DEFAULT_CONFIG: AutoTraderConfig = {
  enabled: false,
  mode: "demo",
  stakeUsd: 5,
  durationMinutes: 10,
  // 70 : analyse des 30 trades (juil. 2026) — paradoxe critique : plus la
  // confiance est haute, plus le bot perd. <80 → 62.5% win, 80-84 → 42.9%,
  // 85-89 → 33.3%, 90+ → 0%. Les indicateurs sont lagging : quand tout est
  // aligné (haute confiance), le mouvement est déjà fini. Le bucket <80 était
  // le SEUL rentable. On baisse à 70 pour capturer ces signaux, compensé par
  // minTfAgreement=4 (les 4 TFs doivent quand même être d'accord).
  minConfidence: 70,
  // 4 (sur 4 TFs) au lieu de 3 : analyse live (30 trades, juil. 2026) —
  // 3/4 → 20 trades, 45% win, -$38.32 (86% des pertes totales !). Le 4e TF
  // dissentant avait raison 55% du temps. 4/4 → 7 trades, 42.9% win, -$3.51
  // seulement. Le backtest disait EV 4/4 > 3/4 mais le live confirme : 3/4
  // est le tueur n°1. Exiger 4/4 réduit la fréquence mais élimine l'essentiel
  // des pertes. Moins de trades, moins de pertes.
  minTfAgreement: 4,
  // 15 : en binaire, 3 pertes consécutives = -$15. Pause auto du bot.
  maxDailyLossUsd: 15,
  maxTradesPerDay: 15,
  // Forex + BTC uniquement : analyse live (30 trades, juil. 2026) —
  // XAUUSD (1W/3L, -$19.46), XAGUSD (1W/3L, -$22.45) et cryETHUSD (0W/3L,
  // -$9.92) représentent $-41.91 sur $-44.66 de perte totale (94% !).
  // Les métaux précieux sont corrélés (XAU+XAG = même pari USD) et le bot
  // se trompe systématiquement dessus. ETH n'a jamais gagné. BTC reste
  // (4W/1L, +$15.67 — le meilleur symbole). Les indices synthétiques (R_*,
  // 1HZ*…) restent exclus — générés aléatoirement par Deriv.
  symbols: [
    "frxEURUSD", "frxGBPUSD", "frxUSDJPY", "frxAUDUSD", "frxUSDCAD", "frxUSDCHF",
    "frxEURGBP", "frxEURJPY", "frxGBPJPY", "frxXAUUSD", "cryBTCUSD"
  ],
  initialCapital: 100,
  maxConsecutiveLosses: 3,
  cooldownMinutes: 30,
  // Londres + New York + Asie : couvre 23h-22h UTC (Asie 23h-08h, Londres
  // 07h-16h, NY 13h-22h). BTC trade déjà 24/7 indépendamment. La session Asie
  // ajoute ~8h de fenêtre sur les paires forex — moins de volatilité mais plus
  // d'opportunités. Le newsFilter bloque les ouvertures de session les plus
  // volatiles.
  tradingSessions: ["london", "newyork", "asia"],
  adaptiveStake: true,
  // premiumOnly exigeait qu'au moins un timeframe note le signal ≥80 de
  // confiance EN PLUS du seuil moyen (minConfidence 75) et de l'accord
  // multi-timeframes — le deuxième plus gros tueur de fréquence après le
  // veto 4H (déjà assoupli). minConfidence + minTfAgreement + veto 4H
  // suffisent comme filtre qualité ; ce cran-là supprimait des journées
  // entières de trades valides.
  premiumOnly: false,
  stopOnRisk: true,
  maxVolatilityPct: 3,
  maxDailyProfitUsd: 10,
  // Fixe $5 : en mode binaire, la perte max = $5 (100% du stake) et le gain
  // = $5 × payout (~$3.75 à 75%). Simple, prévisible, pas de surprise.
  stakeMode: "fixed",
  stakePercent: 1,
  kellyFraction: 0.5,
  sessionEdgeMinutes: 5,
  trailingStopUsd: 0,
  blockCorrelated: true,
  symbolMode: "all-markets",
  maxSimultaneousTrades: 3,
  // 4 : observé en live — 6 positions empilées en 4 cycles de scan (12h23 →
  // 14h45), chacune sous maxSimultaneousTrades mais sans borne cumulée. La
  // limite de perte journalière ne compte que les trades CLÔTURÉS, donc
  // l'exposition flottante non plafonnée contournait le garde-fou.
  maxOpenPositions: 6,
  newsFilter: true,
  // A weak counter-trend 4H used to cancel the trade outright — the single
  // biggest signal-frequency killer found in the engine audit. Only a
  // confident (good/premium) 4H veto is honored by default now.
  veto4h: "strong-only",
  // 0.75 au lieu de 0.70 : breakeven win rate = 1/(1+0.75) = 57.1% au lieu de
  // 60.6% avec 0.70. Le bucket <80 avait 62.5% de win rate — au-dessus de 57%.
  // Exiger un payout plus élevé réduit le nombre de trades mais améliore l'EV.
  minPayoutRatio: 0.75,
  // Off by default: an untested filter shouldn't silently change what the
  // live bot trades. Backtest it (Auto-Trader → Backtest tab) before flipping
  // to "strong-only" — Daily is one more filter layer, it will trade less.
  vetoDaily: "off",
  // Same 35% floor computeAdaptiveStake already uses to cut stake by 75% —
  // here it fully pauses the SYMBOL instead, catching a slow bleed (alternating
  // win/loss) that a pure consecutive-loss streak counter never trips.
  minSymbolWinRate: 0.35,
  symbolWinRateLookback: 10,
  // BINARY (CALL/PUT) au lieu de Multiplier : les données live montrent que
  // le mode multiplier avait des pertes partielles fréquentes (avg_loss -58%
  // du stake) et des gains faibles (avg_win 19-64% du stake). Le binaire a un
  // payout fixe et connu d'avance : win = +stake×payout, loss = -stake. Pas
  // d'incertitude sur SL/TP, pas de partial fills. Breakeven = 1/(1+payout).
  // Avec minPayoutRatio 0.75 → breakeven 57.1%. Le bucket <80 avait 62.5%.
  instrumentType: "binary",
  multiplierLevel: 20,
  stopLossPctOfStake: 50,
  takeProfitPctOfStake: 100,
  maxHoldMinutes: 720,
  atrStopMode: false,
  atrStopMultiple: 3.0,
  riskRewardRatio: 1.5,
};

export const SCAN_INTERVAL_MS = 60_000;

// ─── Trade log ────────────────────────────────────────────────────────────────

export interface TradeLog {
  id: string;
  time: number;
  symbol: string;
  // MULTUP/MULTDOWN are the Multiplier equivalent of CALL/PUT (no fixed
  // expiry — closes on stop-loss/take-profit/manual sell instead).
  direction: "CALL" | "PUT" | "MULTUP" | "MULTDOWN";
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
  durationMinutes?: number;  // contract duration (for live countdown) — binary only
  expiry?: number;           // epoch ms when the contract resolves — binary only
  components?: SignalComponent[]; // scoring components that drove this trade — feeds adaptive weight learning on close
  multiplier?: number;       // leverage level — Multiplier trades only
  stopLossUsd?: number;      // absolute loss level that auto-closes the position — Multiplier trades only
  takeProfitUsd?: number;    // absolute profit level that auto-closes the position — Multiplier trades only
}

export type TradeEventHandler = (log: TradeLog, meta?: { cooldownUntil?: number }) => void;
export type RiskStopHandler = (reasons: string[], pausedUntil?: number) => void;

export interface ScanSymbolResult {
  symbol: string;
  action: "open-trade" | "session-closed" | "no-signal" | "low-confidence" | "low-agreement" | "not-premium" | "volatility" | "traded" | "daily-limit" | "cooldown" | "correlated" | "news-block" | "not-tradeable" | "low-payout";
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

// ─── P&L / trade-count helpers ────────────────────────────────────────────────

export function todayPnl(logs: TradeLog[]): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return logs
    .filter((l) => l.time >= start.getTime() && (l.status === "won" || l.status === "lost"))
    .reduce((sum, l) => sum + l.profit, 0);
}

/**
 * Trades that count toward the daily cap: positions actually placed (or being
 * placed). Cooldown markers, risk-stop markers and failed buys previously
 * consumed the budget too — a flaky connection could eat the whole day's
 * allowance without a single position (audit fix).
 */
export function todayTradeCount(logs: TradeLog[]): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return logs.filter(
    (l) =>
      l.time >= start.getTime() &&
      l.stake > 0 &&
      (l.status === "pending" || l.status === "open" || l.status === "won" || l.status === "lost"),
  ).length;
}

export function allTimePnl(logs: TradeLog[]): number {
  return logs
    .filter((l) => l.status === "won" || l.status === "lost")
    .reduce((sum, l) => sum + l.profit, 0);
}

/**
 * Consecutive losses at the head of the log, optionally scoped to one symbol.
 * Without a symbol, a losing streak on ONE instrument would otherwise trip the
 * same counter as every other symbol combined — too aggressive when scanning
 * many markets, and not targeted at whichever symbol is actually failing.
 */
export function countConsecutiveLosses(logs: TradeLog[], symbol?: string): number {
  let count = 0;
  for (const l of logs) {
    if (symbol && l.symbol !== symbol) continue;
    if (l.status === "lost") count++;
    else if (l.status === "won") break;
  }
  return count;
}

/**
 * Rolling win rate for one symbol over its last N closed trades. Complements
 * countConsecutiveLosses: a streak counter resets to 0 on a single win, so a
 * symbol going W-L-W-L-W-L (50% but never 2 losses in a row) sails through
 * the streak gate forever even though it's a coin flip against a payout that
 * needs >50% to break even. This looks at the actual rate instead of a streak.
 */
export function symbolRollingStats(logs: TradeLog[], symbol: string, lookback = 10): { trades: number; winRate: number } {
  const closed = logs
    .filter((l) => l.symbol === symbol && (l.status === "won" || l.status === "lost"))
    .slice(0, lookback);
  const wins = closed.filter((l) => l.status === "won").length;
  return { trades: closed.length, winRate: closed.length > 0 ? wins / closed.length : 1 };
}

// ─── Correlation ──────────────────────────────────────────────────────────────

// Pairs that share high exposure — only one from each group should be active at a time.
// All USD majors are one and the same dollar bet (directly or inversely correlated):
// EURUSD PUT + AUDUSD PUT is a doubled stake on USD strength, not two independent trades.
// Gold/silver trade in near-lockstep (both precious metals, same USD-strength
// and risk-sentiment drivers) — same-direction XAUUSD + XAGUSD is a doubled bet.
export const CORRELATION_GROUPS: string[][] = [
  ["frxEURUSD", "frxGBPUSD", "frxAUDUSD", "frxUSDJPY", "frxUSDCAD", "frxUSDCHF"],
  ["frxEURGBP", "frxEURJPY", "frxGBPJPY"],
  ["cryBTCUSD", "cryETHUSD", "cryLTCUSD"],
  ["frxXAUUSD", "frxXAGUSD"],
];

// USD is the BASE currency for these three (price = how many JPY/CAD/CHF per
// USD), so CALL means USD strengthens — the opposite convention from
// EURUSD/GBPUSD/AUDUSD, where USD is the QUOTE currency and CALL means USD
// *weakens*. Comparing raw CALL/PUT across the whole USD-majors group without
// correcting for this mixed convention gets the polarity backwards for any
// cross-type pair: EURUSD CALL + USDCHF PUT are BOTH bets on USD weakness
// (doubled exposure) but look like opposite raw directions, so they used to
// sail past the filter; EURUSD CALL + USDJPY CALL "roughly cancel" (per the
// comment below) but share the same raw direction, so they used to get
// blocked instead — exactly backwards in both cases.
const USD_BASE_PAIRS = new Set(["frxUSDJPY", "frxUSDCAD", "frxUSDCHF"]);

function usdBias(symbol: string, direction: "CALL" | "PUT"): "CALL" | "PUT" {
  return USD_BASE_PAIRS.has(symbol) ? (direction === "CALL" ? "PUT" : "CALL") : direction;
}

// Blocking is direction-aware: two correlated pairs traded in OPPOSITE
// directions aren't a doubled bet (e.g. EURUSD CALL + USDJPY CALL roughly
// cancel — one is long EUR/USD, the other long USD/JPY). Only the SAME
// direction on both doubles the exposure (EURUSD PUT + AUDUSD PUT = both
// long USD). Blanket-blocking regardless of direction was too aggressive
// for a watchlist made up entirely of one correlation group — it collapsed
// to a single concurrent trade for such users.
export function isCorrelatedWithActive(
  symbol: string,
  direction: "CALL" | "PUT",
  activeSymbols: Map<string, "CALL" | "PUT">,
): boolean {
  const group = CORRELATION_GROUPS.find((g) => g.includes(symbol));
  if (!group) return false;
  const bias = usdBias(symbol, direction);
  return group.some((s) => {
    const activeDir = activeSymbols.get(s);
    return s !== symbol && activeDir !== undefined && usdBias(s, activeDir) === bias;
  });
}

// ─── Adaptive stake ───────────────────────────────────────────────────────────

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

/** Kelly fraction f* = p - (1-p)/b, for win probability p and net payout odds b. */
export function computeKellyFraction(winRate: number, payoutRatio: number): number {
  if (payoutRatio <= 0) return 0;
  return Math.max(0, winRate - (1 - winRate) / payoutRatio);
}

// ─── Multi-timeframe aggregation ──────────────────────────────────────────────

export const TIMEFRAMES = ["5m", "15m", "1H", "4H"] as const;

export const TF_DURATION_MAP: Record<string, number> = {
  "5m":  5,
  "15m": 15,
  "1H":  30,
  "4H":  60,
};

export interface SymbolAnalysis {
  direction: "CALL" | "PUT" | null;
  confidence: number;
  agreement: number;
  premiumCount: number;       // how many timeframes graded PREMIUM
  volatilityPct: number;      // current ATR% on the base timeframe
  volatilityRatio: number;    // current ATR% vs this symbol's own recent median (1 = normal)
  blockers: string[];         // reasons signals were rejected
  dominantTf: string | null;  // TF with highest confidence signal
  suggestedDuration: number;  // optimal contract duration in minutes
  trendAlignmentScore: number; // 0-4: how many TFs agree on direction
  patternBonus: number;        // extra confidence from candle patterns
  strategyVote?: "BUY" | "SELL" | null; // vote from the user's custom /strategies rules, if any apply
  components?: SignalComponent[]; // scoring components that drove this trade — feeds adaptive weight learning
}

export type TfSignalMap = Partial<Record<(typeof TIMEFRAMES)[number], GeneratedSignal>>;

export const EMPTY_ANALYSIS = (blockers: string[], volatilityPct = 0, volatilityRatio = 1, dominantTf: string | null = null, suggestedDuration = 15): SymbolAnalysis => ({
  direction: null, confidence: 0, agreement: 0, premiumCount: 0, volatilityPct, volatilityRatio,
  blockers, dominantTf, suggestedDuration, trendAlignmentScore: 0, patternBonus: 0,
});

/**
 * Pure decision layer: given one GeneratedSignal per timeframe (already computed),
 * applies the exact same majority-vote + 4H-veto + Trend-Alignment-Score + pattern-bonus
 * logic the live engine uses. Shared by the live engines AND the historical
 * multi-timeframe backtest so they can never drift apart.
 */
export function aggregateTfSignals(
  tfSignals: TfSignalMap,
  volatilityPct: number,
  volatilityRatio: number,
  veto4h: Veto4hMode = "strong-only",
  minDurationMinutes = 0,
  dailySignal?: GeneratedSignal,
  vetoDaily: Veto4hMode = "off",
): SymbolAnalysis {
  const results: string[] = [];
  const qualities: string[] = [];
  const blockers = new Set<string>();
  const tfDirections: Record<string, "BUY" | "SELL"> = {};
  const tfQuality: Record<string, GeneratedSignal["quality"]> = {};
  let totalConf = 0;
  let bestConf = 0;
  let dominantTf: string | null = null;
  let patternBonus = 0;

  for (const tf of TIMEFRAMES) {
    const sig = tfSignals[tf];
    if (!sig) continue;
    if (sig.blockers) sig.blockers.forEach((b) => blockers.add(`${tf}: ${b}`));
    if (sig.direction === "HOLD" || sig.triggers[0] === "insufficient-data") continue;

    // Record TF direction even if weak (used for cross-TF alignment)
    tfDirections[tf] = sig.direction as "BUY" | "SELL";
    tfQuality[tf] = sig.quality;

    if (sig.quality === "weak") continue; // ignore weak votes for scoring
    results.push(sig.direction);
    qualities.push(sig.quality ?? "weak");
    totalConf += sig.confidence;

    // Accumulate pattern bonus from 15m (most actionable TF)
    if (tf === "15m" && sig.patterns) {
      for (const p of sig.patterns) patternBonus += p.strength * 2;
    }

    // A TF whose natural duration is shorter than the instrument's minimum
    // contract length can't actually be traded at its own timeframe — e.g. a
    // 5m signal on forex (15min minimum) would otherwise become "dominant"
    // and get its suggested 5min duration force-stretched to 15min downstream,
    // holding a short-term momentum read for 3x longer than it was calibrated
    // for. Such a TF still counts toward direction/confidence above; it's
    // just ineligible to set the traded duration.
    const tfDuration = TF_DURATION_MAP[tf] ?? 15;
    if (tfDuration >= minDurationMinutes && sig.confidence > bestConf) {
      bestConf = sig.confidence;
      dominantTf = tf;
    }
  }

  const suggestedDuration = dominantTf ? TF_DURATION_MAP[dominantTf] ?? 15 : Math.max(15, minDurationMinutes);

  if (!results.length) {
    return EMPTY_ANALYSIS([...blockers], volatilityPct, volatilityRatio, null, 15);
  }

  const buys = results.filter((r) => r === "BUY").length;
  const sells = results.filter((r) => r === "SELL").length;
  const rawDirection: "CALL" | "PUT" | null = buys > sells ? "CALL" : sells > buys ? "PUT" : null;

  if (!rawDirection) {
    return EMPTY_ANALYSIS([...blockers], volatilityPct, volatilityRatio, dominantTf, suggestedDuration);
  }

  const signalBias = rawDirection === "CALL" ? "BUY" : "SELL";

  // ── Trend Alignment Score (TAS) ────────────────────────────────────────────
  // Count how many TFs explicitly agree with the final direction
  const trendAlignmentScore = Object.values(tfDirections).filter((d) => d === signalBias).length;

  // VETO rule: a contrarian 4H can cancel the trade. "strong-only" (default)
  // requires the 4H signal itself to be confident (good/premium) — a weak,
  // barely-there 4H lean shouldn't kill an otherwise clean 15m setup.
  const h4dir = tfDirections["4H"];
  if (h4dir && h4dir !== signalBias && veto4h !== "off") {
    const h4strong = tfQuality["4H"] !== undefined && tfQuality["4H"] !== "weak";
    if (veto4h === "always" || h4strong) {
      blockers.add(`4H contre-tendance (${h4dir}) — trade annulé`);
      return EMPTY_ANALYSIS([...blockers], volatilityPct, volatilityRatio, dominantTf, suggestedDuration);
    }
    blockers.add(`4H contre-tendance faible (${h4dir}) — toléré`);
  }

  // VETO rule (optional, off by default): a contrarian Daily trend can cancel
  // the trade — same "strong-only cancels, weak is tolerated" pattern as 4H,
  // one timeframe higher. Independent of the TIMEFRAMES loop above (Daily
  // isn't a candidate for dominantTf/suggestedDuration — a 15min-1h binary
  // contract has no business being "held" at a daily-chart duration).
  if (dailySignal && dailySignal.direction !== "HOLD" && vetoDaily !== "off") {
    const dDir = dailySignal.direction;
    if (dDir !== signalBias) {
      const dStrong = dailySignal.quality !== undefined && dailySignal.quality !== "weak";
      if (vetoDaily === "always" || dStrong) {
        blockers.add(`Daily contre-tendance (${dDir}) — trade annulé`);
        return EMPTY_ANALYSIS([...blockers], volatilityPct, volatilityRatio, dominantTf, suggestedDuration);
      }
      blockers.add(`Daily contre-tendance faible (${dDir}) — toléré`);
    }
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

  // Union of components from every TF that agreed with the final direction — the
  // full "coalition" that drove this trade, for later win/loss attribution.
  const components: SignalComponent[] = [];
  for (const tf of TIMEFRAMES) {
    const sig = tfSignals[tf];
    if (sig?.direction === signalBias && sig.components) components.push(...sig.components);
  }

  return {
    direction: rawDirection, confidence: avgConf, agreement, premiumCount, volatilityPct, volatilityRatio,
    blockers: [...blockers], dominantTf, suggestedDuration, trendAlignmentScore, patternBonus,
    components: components.length ? components : undefined,
  };
}

// ─── Shared symbol analysis (pluggable data source) ──────────────────────────

export interface CandleBar {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Median of the given values — used to establish each symbol's own volatility baseline. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export type CandleFetcher = (symbol: string, granularitySeconds: number, count: number) => Promise<CandleBar[]>;

export const GRANULARITY_SECONDS: Record<(typeof TIMEFRAMES)[number], number> = {
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
};

/**
 * Fetches all 4 timeframes through the provided fetcher and aggregates them —
 * the environment-independent core of analyzeSymbol. The browser engine wraps
 * this with learned weights + custom-strategy overlay; the server engine uses
 * it directly.
 */
export async function analyzeSymbolCore(
  symbolDeriv: string,
  fetchCandlesFn: CandleFetcher,
  opts: {
    weights?: Partial<Record<SignalComponent["name"], number>>;
    veto4h?: Veto4hMode;
    vetoDaily?: Veto4hMode;
  } = {},
): Promise<{ analysis: SymbolAnalysis; candles15m: CandleBar[] | null }> {
  const { atr } = await import("./indicators");
  const tfSignals: TfSignalMap = {};
  let volatilityPct = 0;
  let volatilityRatio = 1;
  let candles15m: CandleBar[] | null = null;

  for (const tf of TIMEFRAMES) {
    try {
      const candles = await fetchCandlesFn(symbolDeriv, GRANULARITY_SECONDS[tf], 250);
      if (!candles.length) continue;

      // Volatility from the entry timeframe (15m), normalized against this
      // symbol's OWN recent ATR% distribution — a flat global cutoff either
      // over-restricts calm instruments (major forex) or under-restricts violent
      // ones (Volatility 100), so we also track a relative ratio.
      if (tf === "15m") {
        candles15m = candles;
        const highs = candles.map((c) => c.high), lows = candles.map((c) => c.low), closes = candles.map((c) => c.close);
        const atrSeries = atr(highs, lows, closes, 14);
        const price = closes[closes.length - 1];
        const atrNow = atrSeries[atrSeries.length - 1];
        if (atrNow !== null && price > 0) volatilityPct = (atrNow / price) * 100;

        const atrPctSeries = atrSeries
          .map((v, i) => (v !== null && closes[i] > 0 ? (v / closes[i]) * 100 : null))
          .filter((v): v is number => v !== null)
          .slice(0, -1); // exclude the current (possibly spiking) bar from its own baseline
        const baseline = median(atrPctSeries.slice(-100));
        // Both sides must be in ATR-PERCENT: comparing the absolute ATR (price
        // units) to a %-baseline made the ratio ~price-dependent — ~600x on
        // BTC (64k$ price) so crypto was always "abnormally volatile", ~0.01x
        // on forex so the gate never fired there. Dead on forex, spuriously
        // blocking on crypto — normalized, it finally does its actual job.
        if (baseline > 0 && atrNow !== null && price > 0) volatilityRatio = ((atrNow / price) * 100) / baseline;
      }

      tfSignals[tf] = generateSignal(candles, { weights: opts.weights });
    } catch { /* ignore */ }
  }

  // Daily bias is fetched separately from the TIMEFRAMES loop above — it's a
  // veto-only input (off by default), never a candidate for dominantTf, since
  // a day-long "duration" makes no sense for a 15min-1h binary contract.
  let dailySignal: GeneratedSignal | undefined;
  if ((opts.vetoDaily ?? "off") !== "off") {
    try {
      const daily = await fetchCandlesFn(symbolDeriv, 86_400, 250);
      if (daily.length) dailySignal = generateSignal(daily, { weights: opts.weights });
    } catch { /* ignore — veto simply doesn't apply this scan */ }
  }

  const analysis = aggregateTfSignals(
    tfSignals, volatilityPct, volatilityRatio, opts.veto4h ?? "strong-only",
    minContractMinutes(symbolDeriv), dailySignal, opts.vetoDaily ?? "off",
  );
  return { analysis, candles15m };
}
