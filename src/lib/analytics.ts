// Performance analytics computed from the auto-trader trade log.
// Turns raw trade history into actionable breakdowns: which symbols,
// sessions, hours and confidence levels actually make money.

import { SESSION_HOURS, type TradeLog, type TradingSession } from "./autotrader";
import { SYMBOLS } from "./deriv";

export type ClosedTrade = TradeLog & { status: "won" | "lost" };

export function closedTrades(logs: TradeLog[]): ClosedTrade[] {
  return logs.filter((l) => l.status === "won" || l.status === "lost") as ClosedTrade[];
}

export interface Summary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;       // %
  netPnl: number;
  grossWin: number;
  grossLoss: number;     // positive number
  profitFactor: number;  // grossWin / grossLoss
  avgWin: number;
  avgLoss: number;       // positive number
  expectancy: number;    // avg P&L per trade
  bestTrade: number;
  worstTrade: number;
  currentStreak: number; // +N wins or -N losses
  maxWinStreak: number;
  maxLossStreak: number;
}

export function summarize(logs: TradeLog[]): Summary {
  const t = closedTrades(logs).slice().sort((a, b) => a.time - b.time);
  const wins = t.filter((x) => x.status === "won");
  const losses = t.filter((x) => x.status === "lost");
  const grossWin = wins.reduce((s, x) => s + x.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, x) => s + x.profit, 0));
  const netPnl = t.reduce((s, x) => s + x.profit, 0);

  let curStreak = 0;
  let maxWin = 0;
  let maxLoss = 0;
  let run = 0;
  let lastWon: boolean | null = null;
  for (const x of t) {
    const won = x.status === "won";
    if (lastWon === null || won === lastWon) run = won ? run + 1 : run - 1;
    else run = won ? 1 : -1;
    // recompute simply:
    lastWon = won;
  }
  // streaks (clean pass)
  let streak = 0;
  for (const x of t) {
    const won = x.status === "won";
    if (won) { streak = streak >= 0 ? streak + 1 : 1; maxWin = Math.max(maxWin, streak); }
    else { streak = streak <= 0 ? streak - 1 : -1; maxLoss = Math.max(maxLoss, -streak); }
  }
  curStreak = streak;

  return {
    trades: t.length,
    wins: wins.length,
    losses: losses.length,
    winRate: t.length ? (wins.length / t.length) * 100 : 0,
    netPnl,
    grossWin,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    expectancy: t.length ? netPnl / t.length : 0,
    bestTrade: t.length ? Math.max(...t.map((x) => x.profit)) : 0,
    worstTrade: t.length ? Math.min(...t.map((x) => x.profit)) : 0,
    currentStreak: curStreak,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
  };
}

export interface Bucket {
  key: string;
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
}

function bucketStats(key: string, label: string, items: ClosedTrade[]): Bucket {
  const wins = items.filter((x) => x.status === "won").length;
  return {
    key,
    label,
    trades: items.length,
    wins,
    winRate: items.length ? (wins / items.length) * 100 : 0,
    pnl: items.reduce((s, x) => s + x.profit, 0),
  };
}

export function bySymbol(logs: TradeLog[]): Bucket[] {
  const t = closedTrades(logs);
  const map = new Map<string, ClosedTrade[]>();
  for (const x of t) {
    if (!map.has(x.symbol)) map.set(x.symbol, []);
    map.get(x.symbol)!.push(x);
  }
  return [...map.entries()]
    .map(([sym, items]) => bucketStats(sym, SYMBOLS.find((s) => s.deriv === sym)?.label ?? sym, items))
    .sort((a, b) => b.trades - a.trades);
}

export function bySession(logs: TradeLog[]): Bucket[] {
  const t = closedTrades(logs);
  const sessions: TradingSession[] = ["asia", "london", "newyork"];
  return sessions.map((s) => {
    const { open, close, label } = SESSION_HOURS[s];
    const items = t.filter((x) => {
      const h = new Date(x.time).getUTCHours();
      return h >= open && h < close;
    });
    return bucketStats(s, label, items);
  });
}

export function byHour(logs: TradeLog[]): Bucket[] {
  const t = closedTrades(logs);
  const buckets: Bucket[] = [];
  for (let h = 0; h < 24; h++) {
    const items = t.filter((x) => new Date(x.time).getHours() === h);
    if (items.length) buckets.push(bucketStats(String(h), `${String(h).padStart(2, "0")}h`, items));
  }
  return buckets;
}

export function byConfidence(logs: TradeLog[]): Bucket[] {
  const t = closedTrades(logs);
  const ranges = [
    { key: "lt70", label: "< 70%", min: 0, max: 70 },
    { key: "70-80", label: "70–80%", min: 70, max: 80 },
    { key: "80-90", label: "80–90%", min: 80, max: 90 },
    { key: "gte90", label: "≥ 90%", min: 90, max: 101 },
  ];
  return ranges
    .map((r) => bucketStats(r.key, r.label, t.filter((x) => x.confidence >= r.min && x.confidence < r.max)))
    .filter((b) => b.trades > 0);
}

export interface EquityPoint {
  t: number;
  pnl: number;       // cumulative
  value: number;     // running equity (10000 base)
}

export function equityCurve(logs: TradeLog[], base = 10000): EquityPoint[] {
  const t = closedTrades(logs).slice().sort((a, b) => a.time - b.time);
  let cum = 0;
  return t.map((x) => {
    cum += x.profit;
    return { t: x.closedAt ?? x.time, pnl: cum, value: base + cum };
  });
}

export interface DayBucket {
  date: string; // YYYY-MM-DD
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
}

export function byDay(logs: TradeLog[]): DayBucket[] {
  const t = closedTrades(logs);
  const map = new Map<string, ClosedTrade[]>();
  for (const x of t) {
    const d = new Date(x.closedAt ?? x.time).toISOString().slice(0, 10);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(x);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, items]) => {
      const wins = items.filter((x) => x.status === "won").length;
      return {
        date,
        trades: items.length,
        wins,
        winRate: items.length ? (wins / items.length) * 100 : 0,
        pnl: items.reduce((s, x) => s + x.profit, 0),
      };
    });
}

export function exportToCsv(logs: TradeLog[]): void {
  const closed = closedTrades(logs).slice().sort((a, b) => a.time - b.time);
  const header = ["Date", "Heure", "Paire", "Direction", "Mise ($)", "P&L ($)", "Résultat", "Confiance (%)", "TF Agreement", "Note"];
  const rows = closed.map((l) => {
    const d = new Date(l.time);
    return [
      d.toLocaleDateString("fr-FR"),
      d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
      l.symbol,
      l.direction,
      l.stake.toFixed(2),
      l.profit.toFixed(2),
      l.status === "won" ? "Gagné" : "Perdu",
      String(l.confidence),
      String(l.tfAgreement),
      l.note ?? "",
    ];
  });
  const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lio23-journal-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Generate plain-language recommendations from the data. */
export function insights(logs: TradeLog[]): { type: "good" | "warn" | "info"; text: string }[] {
  const out: { type: "good" | "warn" | "info"; text: string }[] = [];
  const s = summarize(logs);
  if (s.trades < 10) {
    out.push({ type: "info", text: `Seulement ${s.trades} trades clôturés — il faut au moins 20-30 trades pour des stats fiables.` });
    return out;
  }

  // Profit factor
  if (s.profitFactor >= 1.5) out.push({ type: "good", text: `Profit factor solide (${s.profitFactor.toFixed(2)}) — la stratégie gagne plus qu'elle ne perd.` });
  else if (s.profitFactor < 1) out.push({ type: "warn", text: `Profit factor < 1 (${s.profitFactor.toFixed(2)}) — la config actuelle perd de l'argent. À revoir.` });

  // Best/worst symbols
  const syms = bySymbol(logs).filter((b) => b.trades >= 5);
  const worst = syms.slice().sort((a, b) => a.winRate - b.winRate)[0];
  const best = syms.slice().sort((a, b) => b.winRate - a.winRate)[0];
  if (worst && worst.winRate < 45) out.push({ type: "warn", text: `${worst.label} : ${worst.winRate.toFixed(0)}% de réussite sur ${worst.trades} trades — envisage de le retirer des paires surveillées.` });
  if (best && best.winRate >= 60) out.push({ type: "good", text: `${best.label} : ${best.winRate.toFixed(0)}% de réussite sur ${best.trades} trades — ta paire la plus fiable.` });

  // Best session
  const sess = bySession(logs).filter((b) => b.trades >= 5).sort((a, b) => b.winRate - a.winRate)[0];
  if (sess && sess.winRate >= 58) out.push({ type: "good", text: `Session ${sess.label} : ${sess.winRate.toFixed(0)}% — concentre ton trading sur ce créneau.` });

  // Confidence correlation
  const conf = byConfidence(logs);
  const high = conf.find((c) => c.key === "gte90" || c.key === "80-90");
  const low = conf.find((c) => c.key === "lt70");
  if (high && low && high.winRate > low.winRate + 10) {
    out.push({ type: "good", text: `Les signaux à forte confiance gagnent davantage (${high.label}: ${high.winRate.toFixed(0)}%) — augmente le seuil de confiance minimum.` });
  }

  // Streak warning
  if (s.maxLossStreak >= 4) out.push({ type: "warn", text: `Série de ${s.maxLossStreak} pertes consécutives déjà atteinte — vérifie que ton cooldown est bien réglé.` });

  return out;
}

// ─── Diagnostic segmenté ──────────────────────────────────────────────────────
// Les breakdowns ci-dessus agrègent TOUS les trades ensemble. C'est trompeur
// dès que le bot tourne sur plusieurs familles d'instruments : le preset Boom
// impose 2 TF d'accord sur des synthétiques à ratio 6:1 (~86% de gagnants
// requis pour l'équilibre), le preset Default impose 4 TF sur du forex binaire
// (~57% requis). Comparer leurs TAUX DE GAIN bruts revient à comparer des
// instruments, pas l'effet du paramètre — un paradoxe de Simpson qui a déjà
// produit deux conclusions opposées sur minTfAgreement à deux mois d'écart.
//
// D'où cette couche : on segmente d'abord par famille d'instrument, on compare
// en ESPÉRANCE ($/trade, universellement comparable) plutôt qu'en taux de gain,
// et on expose un intervalle de confiance pour qu'un bucket de 8 trades ne
// puisse plus passer pour un résultat.

export interface SegmentStats {
  key: string;
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  /** Bornes de Wilson à 95% — un intervalle large = échantillon non concluant. */
  winRateLow: number;
  winRateHigh: number;
  pnl: number;
  /** $/trade — la seule métrique comparable entre instruments à ratio différent. */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  /** Déduit des gains/pertes RÉELLEMENT observés (slippage inclus), pas de la config. */
  breakEvenWinRate: number | null;
  edge: number | null;
  /** false quand l'échantillon est trop petit pour conclure quoi que ce soit. */
  reliable: boolean;
}

const MIN_SAMPLE = 20;

/** Intervalle de Wilson : robuste sur petits échantillons, contrairement à
 * l'intervalle normal qui donne des bornes absurdes (négatives, >100%). */
function wilson(wins: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 0 };
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, (centre - margin) * 100), high: Math.min(100, (centre + margin) * 100) };
}

function segmentStats(key: string, label: string, items: ClosedTrade[]): SegmentStats {
  const trades = items.length;
  const winItems = items.filter((x) => x.status === "won");
  const lossItems = items.filter((x) => x.status === "lost");
  const wins = winItems.length;
  const pnl = items.reduce((s, x) => s + x.profit, 0);
  const avgWin = winItems.length ? winItems.reduce((s, x) => s + x.profit, 0) / winItems.length : 0;
  const avgLoss = lossItems.length ? Math.abs(lossItems.reduce((s, x) => s + x.profit, 0) / lossItems.length) : 0;
  // Seuil de rentabilité tiré du couple gain/perte réellement constaté.
  const breakEvenWinRate = avgWin > 0 && avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) * 100 : null;
  const winRate = trades ? (wins / trades) * 100 : 0;
  const { low, high } = wilson(wins, trades);
  return {
    key, label, trades, wins, winRate, winRateLow: low, winRateHigh: high,
    pnl: Math.round(pnl * 100) / 100,
    expectancy: trades ? Math.round((pnl / trades) * 10000) / 10000 : 0,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    breakEvenWinRate,
    edge: breakEvenWinRate === null ? null : winRate - breakEvenWinRate,
    reliable: trades >= MIN_SAMPLE,
  };
}

/** Famille d'instrument — c'est ELLE qui porte le confondant, pas le symbole
 * seul : mécanique de contrat, ratio TP/SL et seuil de rentabilité changent
 * complètement d'une famille à l'autre. */
export function instrumentFamily(symbol: string): { key: string; label: string } {
  if (symbol.startsWith("BOOM") || symbol.startsWith("CRASH")) return { key: "boomcrash", label: "Boom/Crash (Multiplier)" };
  if (symbol.startsWith("cry")) return { key: "crypto", label: "Crypto (Multiplier)" };
  if (symbol.startsWith("OTC_")) return { key: "indices", label: "Indices boursiers" };
  if (symbol.startsWith("frx")) return { key: "forex", label: "Forex / Métaux" };
  return { key: "synth", label: "Synthétiques volatilité" };
}

export function bySegment(logs: TradeLog[]): SegmentStats[] {
  const t = closedTrades(logs);
  const map = new Map<string, { label: string; items: ClosedTrade[] }>();
  for (const x of t) {
    const f = instrumentFamily(x.symbol);
    if (!map.has(f.key)) map.set(f.key, { label: f.label, items: [] });
    map.get(f.key)!.items.push(x);
  }
  return [...map.entries()]
    .map(([key, v]) => segmentStats(key, v.label, v.items))
    .sort((a, b) => b.trades - a.trades);
}

/** Découpe une dimension (confiance, accord TF) À L'INTÉRIEUR de chaque famille.
 * C'est la correction du paradoxe : « 2 TF = 80% / 4 TF = 46% » disparaît dès
 * qu'on cesse de comparer des Boom à du forex. */
export function withinSegment(
  logs: TradeLog[],
  dimension: "confidence" | "tfAgreement",
): { segment: string; label: string; buckets: SegmentStats[] }[] {
  const t = closedTrades(logs);
  const families = new Map<string, { label: string; items: ClosedTrade[] }>();
  for (const x of t) {
    const f = instrumentFamily(x.symbol);
    if (!families.has(f.key)) families.set(f.key, { label: f.label, items: [] });
    families.get(f.key)!.items.push(x);
  }

  const ranges = dimension === "confidence"
    ? [
        { key: "lt70", label: "< 70", pick: (x: ClosedTrade) => x.confidence < 70 },
        { key: "70-80", label: "70–80", pick: (x: ClosedTrade) => x.confidence >= 70 && x.confidence < 80 },
        { key: "80-90", label: "80–90", pick: (x: ClosedTrade) => x.confidence >= 80 && x.confidence < 90 },
        { key: "gte90", label: "≥ 90", pick: (x: ClosedTrade) => x.confidence >= 90 },
      ]
    : [1, 2, 3, 4].map((n) => ({ key: `tf${n}`, label: `${n}/4 TF`, pick: (x: ClosedTrade) => x.tfAgreement === n }));

  return [...families.entries()]
    .sort((a, b) => b[1].items.length - a[1].items.length)
    .map(([key, v]) => ({
      segment: key,
      label: v.label,
      buckets: ranges
        .map((r) => segmentStats(r.key, r.label, v.items.filter(r.pick)))
        .filter((b) => b.trades > 0),
    }))
    .filter((s) => s.buckets.length > 0);
}

export interface SlippageReport {
  /** Trades perdants dont le stop configuré est connu. */
  measuredLosses: number;
  configuredStopAvg: number;
  actualLossAvg: number;
  /** Dépassement moyen au-delà du stop — le coût de transaction réel. */
  overshootAvg: number;
  overshootMax: number;
  /** Nombre de pertes qui dépassent le stop de plus d'un centime. */
  exceedingCount: number;
  measuredWins: number;
  configuredTpAvg: number;
  actualWinAvg: number;
  /** Manque à gagner moyen par rapport au take-profit visé. */
  shortfallAvg: number;
  /** Coût total estimé par trade (dépassement sur pertes + manque sur gains),
   * pondéré par la fréquence de chaque issue. */
  costPerTradeEstimate: number | null;
}

/** Mesure l'écart entre les stops/objectifs CONFIGURÉS et ce qui a réellement
 * été encaissé. C'est le seul moyen d'obtenir le coût de transaction effectif :
 * l'API Deriv refuse les données d'offering sans compte authentifié, et un
 * backtest sur bougies OHLC ne peut structurellement pas le voir. */
export function stopSlippage(logs: TradeLog[]): SlippageReport {
  const t = closedTrades(logs);
  const losses = t.filter((x) => x.status === "lost" && typeof x.stopLossUsd === "number" && x.stopLossUsd > 0);
  const wins = t.filter((x) => x.status === "won" && typeof x.takeProfitUsd === "number" && x.takeProfitUsd > 0);

  const configuredStopAvg = losses.length ? losses.reduce((s, x) => s + x.stopLossUsd!, 0) / losses.length : 0;
  const actualLossAvg = losses.length ? losses.reduce((s, x) => s + Math.abs(x.profit), 0) / losses.length : 0;
  const overshoots = losses.map((x) => Math.abs(x.profit) - x.stopLossUsd!);
  const overshootAvg = overshoots.length ? overshoots.reduce((s, v) => s + v, 0) / overshoots.length : 0;
  const overshootMax = overshoots.length ? Math.max(...overshoots) : 0;

  const configuredTpAvg = wins.length ? wins.reduce((s, x) => s + x.takeProfitUsd!, 0) / wins.length : 0;
  const actualWinAvg = wins.length ? wins.reduce((s, x) => s + x.profit, 0) / wins.length : 0;
  const shortfallAvg = wins.length ? configuredTpAvg - actualWinAvg : 0;

  const total = losses.length + wins.length;
  const costPerTradeEstimate = total
    ? Math.round(((overshootAvg * losses.length + shortfallAvg * wins.length) / total) * 10000) / 10000
    : null;

  const r2 = (v: number) => Math.round(v * 10000) / 10000;
  return {
    measuredLosses: losses.length,
    configuredStopAvg: r2(configuredStopAvg),
    actualLossAvg: r2(actualLossAvg),
    overshootAvg: r2(overshootAvg),
    overshootMax: r2(overshootMax),
    exceedingCount: overshoots.filter((v) => v > 0.01).length,
    measuredWins: wins.length,
    configuredTpAvg: r2(configuredTpAvg),
    actualWinAvg: r2(actualWinAvg),
    shortfallAvg: r2(shortfallAvg),
    costPerTradeEstimate,
  };
}

export interface ErrorDay {
  date: string;
  count: number;
  topNote: string;
}

/** Erreurs groupées par jour. Un pic concentré sur quelques jours signale un
 * bug ponctuel déjà derrière nous, pas un taux d'échec courant — distinction
 * invisible dès qu'on agrège tout l'historique en un seul pourcentage. */
export function errorsByDay(logs: TradeLog[]): ErrorDay[] {
  const errs = logs.filter((l) => l.status === "error");
  const map = new Map<string, string[]>();
  for (const e of errs) {
    const d = new Date(e.time).toISOString().slice(0, 10);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(e.note ?? "(sans détail)");
  }
  return [...map.entries()]
    .map(([date, notes]) => {
      const counts = new Map<string, number>();
      for (const n of notes) {
        const short = n.slice(0, 60);
        counts.set(short, (counts.get(short) ?? 0) + 1);
      }
      const topNote = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
      return { date, count: notes.length, topNote };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface SegmentSlippage extends SlippageReport {
  key: string;
  label: string;
  /** false quand trop peu de trades mesurés pour que le chiffre veuille dire
   * quelque chose — même seuil que les autres blocs du diagnostic. */
  reliable: boolean;
}

/**
 * Slippage calculé PAR FAMILLE d'instrument.
 *
 * Le total agrégé n'a aucun sens : il moyenne des stops de $1.50 (Boom, mise
 * $5 × levier 100) avec des stops de $100 (forex/crypto sur grosses mises).
 * Observé en production le 2026-07-30 — le bloc global annonçait un coût de
 * $6.97/trade, entièrement porté par quelques anciens gros trades, alors que
 * l'exécution sur Boom était en réalité FAVORABLE (pertes sous le stop
 * configuré, gains au-dessus de l'objectif). Exactement le paradoxe de
 * Simpson que le reste de ce diagnostic corrige — d'où cette version
 * segmentée, la seule interprétable.
 */
export function slippageBySegment(logs: TradeLog[]): SegmentSlippage[] {
  const t = closedTrades(logs);
  const groups = new Map<string, { label: string; items: ClosedTrade[] }>();
  for (const x of t) {
    const f = instrumentFamily(x.symbol);
    if (!groups.has(f.key)) groups.set(f.key, { label: f.label, items: [] });
    groups.get(f.key)!.items.push(x);
  }
  return [...groups.entries()]
    .map(([key, v]) => {
      const r = stopSlippage(v.items);
      const n = r.measuredLosses + r.measuredWins;
      return { ...r, key, label: v.label, reliable: n >= MIN_SAMPLE };
    })
    // Une famille sans stop/objectif enregistré (binaire pur) n'a rien à mesurer.
    .filter((s) => s.measuredLosses + s.measuredWins > 0)
    .sort((a, b) => b.measuredLosses + b.measuredWins - (a.measuredLosses + a.measuredWins));
}
