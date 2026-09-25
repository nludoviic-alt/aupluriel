/**
 * Helpers to bridge custom user strategies with the auto-trader.
 * Strategies are stored in localStorage and can inject their symbols
 * into the auto-trader config.
 */
import { SYMBOLS } from "./deriv";

export interface Strategy {
  id: string;
  name: string;
  pair: string;
  indicator: "RSI" | "MACD" | "EMA_CROSS" | "BB";
  buyThreshold: number;
  sellThreshold: number;
  stopLoss: number;
  takeProfit: number;
  enabled: boolean;
}

const STORAGE_KEY = "lio23.strategies";

export function loadStrategies(): Strategy[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/**
 * Returns the list of Deriv symbol IDs that have at least one
 * enabled strategy. Used by the auto-trader to auto-populate its
 * symbol watchlist.
 */
export function activeStrategySymbols(): string[] {
  const strats = loadStrategies().filter((s) => s.enabled);
  const derivIds = strats
    .map((s) => SYMBOLS.find((sym) => sym.label === s.pair)?.deriv)
    .filter(Boolean) as string[];
  return [...new Set(derivIds)];
}

/**
 * Given a symbol and the latest indicator values, checks all enabled
 * strategies for that symbol and returns a direction vote or null.
 */
export function evaluateStrategies(
  derivSymbol: string,
  indicators: {
    rsi: number | null;
    macdHist: number | null;
    ema50: number | null;
    ema200: number | null;
    bbUpper: number | null;
    bbLower: number | null;
    close: number;
  },
): "BUY" | "SELL" | null {
  const strats = loadStrategies().filter(
    (s) => s.enabled && SYMBOLS.find((sym) => sym.label === s.pair)?.deriv === derivSymbol,
  );

  if (!strats.length) return null;

  const votes: ("BUY" | "SELL")[] = [];

  for (const s of strats) {
    let vote: "BUY" | "SELL" | null = null;

    switch (s.indicator) {
      case "RSI":
        if (indicators.rsi !== null) {
          if (indicators.rsi <= s.buyThreshold) vote = "BUY";
          else if (indicators.rsi >= s.sellThreshold) vote = "SELL";
        }
        break;
      case "MACD":
        if (indicators.macdHist !== null) {
          if (indicators.macdHist > 0) vote = "BUY";
          else if (indicators.macdHist < 0) vote = "SELL";
        }
        break;
      case "EMA_CROSS":
        if (indicators.ema50 !== null && indicators.ema200 !== null) {
          if (indicators.ema50 > indicators.ema200) vote = "BUY";
          else if (indicators.ema50 < indicators.ema200) vote = "SELL";
        }
        break;
      case "BB":
        if (indicators.bbLower !== null && indicators.bbUpper !== null) {
          if (indicators.close <= indicators.bbLower) vote = "BUY";
          else if (indicators.close >= indicators.bbUpper) vote = "SELL";
        }
        break;
    }
    if (vote) votes.push(vote);
  }

  if (!votes.length) return null;
  const buys = votes.filter((v) => v === "BUY").length;
  const sells = votes.filter((v) => v === "SELL").length;
  if (buys > sells) return "BUY";
  if (sells > buys) return "SELL";
  return null;
}
