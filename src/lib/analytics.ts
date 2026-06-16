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
