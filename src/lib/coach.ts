// Market coach — turns the signal engine output into plain-language advice
// telling the user whether conditions favour trading right now, and why.

import { fetchCandles, GRANULARITY, SYMBOLS } from "./deriv";
import { generateSignal, atr } from "./indicators";
import { isInTradingSession, type TradingSession } from "./autotrader";

export type CoachTone = "go" | "wait" | "caution" | "info";

export interface CoachMessage {
  id: string;
  symbol: string;
  label: string;
  tone: CoachTone;
  title: string;
  text: string;
  time: number;
  verdict: string; // stable key to dedupe identical advice
  locked?: boolean; // advice held during an active trade window
}

/** Verdicts that justify breaking a trade lock (real danger, act now). */
export function isEmergencyVerdict(verdict: string): boolean {
  return verdict === "extreme-vol";
}

function fmtPct(n: number) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

// ── Watched-pairs preference (shared with the settings page) ───────────
export const COACH_SYMBOLS_KEY = "lio23.coach_symbols";
/** Event fired when the user changes which pairs the coach watches. */
export const COACH_CONFIG_EVENT = "lio23:coach-config";
/** Default watchlist: the first 6 supported symbols. */
export const DEFAULT_COACH_SYMBOLS = SYMBOLS.slice(0, 6).map((s) => s.deriv);

export function loadCoachSymbols(): string[] {
  if (typeof window === "undefined") return DEFAULT_COACH_SYMBOLS;
  try {
    const raw = JSON.parse(localStorage.getItem(COACH_SYMBOLS_KEY) ?? "null");
    if (Array.isArray(raw) && raw.length) {
      // keep only still-supported symbols
      const valid = raw.filter((d) => SYMBOLS.some((s) => s.deriv === d));
      if (valid.length) return valid;
    }
  } catch {}
  return DEFAULT_COACH_SYMBOLS;
}

export function saveCoachSymbols(symbols: string[]) {
  try {
    localStorage.setItem(COACH_SYMBOLS_KEY, JSON.stringify(symbols));
    window.dispatchEvent(new CustomEvent(COACH_CONFIG_EVENT));
  } catch {}
}

/** Analyse one symbol and produce a coach message (or null if nothing useful). */
async function analyze(
  sym: { deriv: string; label: string; market: string },
  sessions: TradingSession[],
): Promise<CoachMessage | null> {
  let candles;
  try {
    candles = await fetchCandles(sym.deriv, GRANULARITY["15m"], 250);
  } catch {
    return null;
  }
  if (!candles.length) return null;

  const sig = generateSignal(candles);
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const change = closes.length > 20 ? ((price - closes[closes.length - 20]) / closes[closes.length - 20]) * 100 : 0;

  const a = atr(candles.map((c) => c.high), candles.map((c) => c.low), closes, 14);
  const atrNow = a[a.length - 1];
  const atrPct = atrNow !== null && price > 0 ? (atrNow / price) * 100 : 0;

  const base = { id: `${sym.deriv}_${Date.now()}`, symbol: sym.deriv, label: sym.label, time: Date.now() };

  // 1. Outside trading session (forex/commodities only)
  if (!isInTradingSession(sessions, sym.deriv)) {
    return {
      ...base,
      tone: "wait",
      title: `${sym.label} — hors session`,
      text: `Le marché ${sym.label} est calme hors des sessions Londres/New York. Mieux vaut attendre l'ouverture pour de meilleures conditions.`,
      verdict: "out-of-session",
    };
  }

  // 2. Dead / flat market (volatility too low)
  if (atrPct < 0.05) {
    return {
      ...base,
      tone: "wait",
      title: `${sym.label} — marché plat`,
      text: `Très faible volatilité (ATR ${atrPct.toFixed(2)}%). Aucun mouvement exploitable — patiente avant de trader.`,
      verdict: "flat",
    };
  }

  // 3. Extreme volatility — risky
  if (atrPct > 4) {
    return {
      ...base,
      tone: "caution",
      title: `${sym.label} — volatilité extrême`,
      text: `Mouvements violents (ATR ${atrPct.toFixed(2)}%, ${fmtPct(change)} récemment). Risque élevé : réduis la mise ou évite pour l'instant.`,
      verdict: "extreme-vol",
    };
  }

  // 4. Strong favourable signal
  if (sig.direction !== "HOLD" && (sig.quality === "premium" || sig.quality === "good")) {
    const dir = sig.direction === "BUY" ? "hausse (CALL)" : "baisse (PUT)";
    const top = sig.triggers.slice(0, 2).join(", ");
    return {
      ...base,
      tone: "go",
      title: `${sym.label} — opportunité ${sig.direction === "BUY" ? "haussière" : "baissière"}`,
      text: `Conditions favorables pour un trade en ${dir} · confiance ${sig.confidence}%${top ? `. ${top}.` : "."} ${sig.quality === "premium" ? "Signal PREMIUM." : ""}`,
      verdict: `go-${sig.direction}`,
    };
  }

  // 5. Weak / no clear signal
  if (sig.direction === "HOLD") {
    return {
      ...base,
      tone: "info",
      title: `${sym.label} — pas de signal clair`,
      text: `Marché indécis (${fmtPct(change)}). Les indicateurs ne sont pas alignés — pas de trade conseillé pour le moment.`,
      verdict: "no-signal",
    };
  }

  // 6. Directional but low quality
  return {
    ...base,
    tone: "caution",
    title: `${sym.label} — signal faible`,
    text: `Tendance ${sig.direction === "BUY" ? "haussière" : "baissière"} possible mais peu confirmée (confiance ${sig.confidence}%). Attends une meilleure configuration.`,
    verdict: `weak-${sig.direction}`,
  };
}

/**
 * Build the coach feed: prioritise opportunities (GO), then cautions, then
 * one contextual "wait/info" message. Limited to keep the UI uncluttered.
 */
export async function buildCoachMessages(
  sessions: TradingSession[],
  max = 3,
  symbols: string[] = DEFAULT_COACH_SYMBOLS,
): Promise<CoachMessage[]> {
  const watch = SYMBOLS.filter((s) => symbols.includes(s.deriv));
  const results = await Promise.all(watch.map((s) => analyze(s, sessions)));
  const msgs = results.filter((m): m is CoachMessage => m !== null);

  const order: Record<CoachTone, number> = { go: 0, caution: 1, wait: 2, info: 3 };
  msgs.sort((a, b) => order[a.tone] - order[b.tone]);

  // Always surface all GO/caution, then pad with one wait/info for context
  const priority = msgs.filter((m) => m.tone === "go" || m.tone === "caution");
  const context = msgs.filter((m) => m.tone === "wait" || m.tone === "info");
  return [...priority, ...context].slice(0, max);
}
