// Per-user trading insights, for the admin's "analyser et ajuster" panel.
//
// Deliberately conservative: below MIN_SAMPLE closed trades for a given
// breakdown, we say so instead of guessing — a 3-trade losing streak on a
// symbol is noise, not a verdict, and a recommendation built on noise can
// make a live account worse instead of better.
import { getDb } from "./db.server";

const MIN_SAMPLE = 15;

export interface BreakdownRow {
  key: string;
  trades: number;
  wins: number;
  winRate: number | null;
  netPnl: number;
}

export interface Recommendation {
  type: "disable-symbol" | "raise-confidence" | "small-sample";
  message: string;
  symbol?: string; // disable-symbol: which symbol to drop from the watchlist
  suggestedMinConfidence?: number; // raise-confidence: value to apply
}

export interface UserInsights {
  mode: "demo" | "live";
  totalTrades: number;
  bySymbol: BreakdownRow[];
  byConfidence: BreakdownRow[];
  bySession: BreakdownRow[];
  recommendations: Recommendation[];
}

function winRate(wins: number, trades: number): number | null {
  return trades > 0 ? Math.round((wins / trades) * 1000) / 10 : null;
}

function toRows(rows: { key: string; trades: number; wins: number; net_pnl: number }[]): BreakdownRow[] {
  return rows.map((r) => ({
    key: r.key,
    trades: r.trades,
    wins: r.wins,
    winRate: winRate(r.wins, r.trades),
    netPnl: Math.round(r.net_pnl * 100) / 100,
  }));
}

export function getUserInsights(userId: number, mode: "demo" | "live" = "demo"): UserInsights {
  const db = getDb();
  const modeFilter = mode === "demo" ? "(mode = 'demo' OR mode IS NULL)" : "mode = 'live'";

  const bySymbolRows = db
    .prepare(
      `SELECT symbol AS key, COUNT(*) AS trades, COUNT(*) FILTER (WHERE status = 'won') AS wins,
              COALESCE(SUM(profit), 0) AS net_pnl
       FROM bot_trades
       WHERE user_id = ? AND status IN ('won','lost') AND ${modeFilter}
       GROUP BY symbol
       ORDER BY trades DESC`,
    )
    .all(userId) as { key: string; trades: number; wins: number; net_pnl: number }[];

  const byConfidenceRows = db
    .prepare(
      `SELECT
         CASE
           WHEN confidence < 60 THEN '<60'
           WHEN confidence < 70 THEN '60-69'
           WHEN confidence < 80 THEN '70-79'
           WHEN confidence < 90 THEN '80-89'
           ELSE '90-100'
         END AS key,
         COUNT(*) AS trades, COUNT(*) FILTER (WHERE status = 'won') AS wins,
         COALESCE(SUM(profit), 0) AS net_pnl
       FROM bot_trades
       WHERE user_id = ? AND status IN ('won','lost') AND ${modeFilter}
       GROUP BY key`,
    )
    .all(userId) as { key: string; trades: number; wins: number; net_pnl: number }[];

  const bySessionRows = db
    .prepare(
      `SELECT
         CAST(strftime('%H', time / 1000, 'unixepoch') AS TEXT) AS hour,
         COUNT(*) AS trades, COUNT(*) FILTER (WHERE status = 'won') AS wins,
         COALESCE(SUM(profit), 0) AS net_pnl
       FROM bot_trades
       WHERE user_id = ? AND status IN ('won','lost') AND ${modeFilter}
       GROUP BY hour
       ORDER BY hour`,
    )
    .all(userId) as { hour: string; trades: number; wins: number; net_pnl: number }[];

  const bySymbol = toRows(bySymbolRows);
  const byConfidence = toRows(byConfidenceRows);
  const bySession = toRows(bySessionRows.map((r) => ({ key: `${r.hour}h UTC`, trades: r.trades, wins: r.wins, net_pnl: r.net_pnl })));

  const totalTrades = bySymbol.reduce((s, r) => s + r.trades, 0);
  const recommendations: Recommendation[] = [];

  for (const row of bySymbol) {
    if (row.trades < MIN_SAMPLE) continue;
    if (row.winRate !== null && row.winRate < 40 && row.netPnl < 0) {
      recommendations.push({
        type: "disable-symbol",
        symbol: row.key,
        message: `${row.key} : ${row.winRate}% de réussite sur ${row.trades} trades (P&L ${row.netPnl >= 0 ? "+" : ""}${row.netPnl}$) — envisager de le retirer de la watchlist.`,
      });
    }
  }

  const lowConf = byConfidence.filter((r) => r.key === "<60" || r.key === "60-69").reduce(
    (acc, r) => ({ wins: acc.wins + r.wins, trades: acc.trades + r.trades }),
    { wins: 0, trades: 0 },
  );
  const highConf = byConfidence.filter((r) => r.key === "80-89" || r.key === "90-100").reduce(
    (acc, r) => ({ wins: acc.wins + r.wins, trades: acc.trades + r.trades }),
    { wins: 0, trades: 0 },
  );
  if (lowConf.trades >= MIN_SAMPLE && highConf.trades >= MIN_SAMPLE) {
    const lowRate = winRate(lowConf.wins, lowConf.trades) ?? 0;
    const highRate = winRate(highConf.wins, highConf.trades) ?? 0;
    if (lowRate < highRate - 10) {
      recommendations.push({
        type: "raise-confidence",
        suggestedMinConfidence: 70,
        message: `Les trades sous 70% de confiance réussissent nettement moins (${lowRate}%) que ceux au-dessus de 80% (${highRate}%) — envisager de remonter le seuil minConfidence à 70.`,
      });
    }
  }

  if (recommendations.length === 0 && totalTrades < MIN_SAMPLE) {
    recommendations.push({
      type: "small-sample",
      message: `Seulement ${totalTrades} trade${totalTrades > 1 ? "s" : ""} résolu${totalTrades > 1 ? "s" : ""} en mode ${mode} — pas assez de données pour une recommandation fiable (seuil : ${MIN_SAMPLE}).`,
    });
  }

  return { mode, totalTrades, bySymbol, byConfidence, bySession, recommendations };
}
