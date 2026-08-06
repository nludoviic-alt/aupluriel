#!/usr/bin/env node
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1];
const mode = args.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "all";
const jsonOut = args.includes("--json");

if (!dbPath) { console.error("Usage: daily-review.mjs DB_PATH [--date=YYYY-MM-DD] [--mode=demo|live|all] [--json]"); process.exit(1); }

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// Determine target date (default: yesterday UTC)
let targetDate;
if (dateArg) {
  targetDate = new Date(dateArg + "T00:00:00Z");
} else {
  targetDate = new Date(Date.now() - 86400000);
  targetDate.setUTCHours(0, 0, 0, 0);
}
const dayStart = Math.floor(targetDate.getTime() / 1000) * 1000;
const dayEnd = dayStart + 86400000;
const dateStr = targetDate.toISOString().slice(0, 10);

const modeFilter = mode === "all" ? "1=1" : mode === "demo" ? "(mode = 'demo' OR mode IS NULL)" : "mode = 'live'";

// ── Day summary ──
const dayStats = db.prepare(`
  SELECT COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COUNT(*) FILTER (WHERE status = 'lost') AS losses,
    COALESCE(SUM(profit), 0) AS pnl,
    COALESCE(SUM(profit) FILTER (WHERE status = 'won'), 0) AS gross_win,
    COALESCE(-SUM(profit) FILTER (WHERE status = 'lost'), 0) AS gross_loss,
    COALESCE(AVG(stake), 0) AS avg_stake,
    COALESCE(MAX(stake), 0) AS max_stake,
    COALESCE(AVG(profit) FILTER (WHERE status = 'won'), 0) AS avg_win,
    COALESCE(-AVG(profit) FILTER (WHERE status = 'lost'), 0) AS avg_loss
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter}
    AND time >= ${dayStart} AND time < ${dayEnd}
`).get();

// ── 7-day comparison ──
const weekStart = dayStart - 6 * 86400000;
const weekStats = db.prepare(`
  SELECT COUNT(*) AS trades,
    COALESCE(SUM(profit), 0) AS pnl,
    COALESCE(AVG(profit), 0) AS expectancy
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter}
    AND time >= ${weekStart} AND time < ${dayEnd}
`).get();
const weekDailyAvg = weekStats.trades > 0 ? weekStats.pnl / 7 : 0;

// ── By preset ──
const byPreset = db.prepare(`
  SELECT COALESCE(preset, CASE WHEN symbol LIKE 'BOOM%' THEN 'boom' WHEN symbol LIKE 'CRASH%' THEN 'crash' ELSE 'default' END) AS segment,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COALESCE(SUM(profit), 0) AS pnl
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter}
    AND time >= ${dayStart} AND time < ${dayEnd}
  GROUP BY segment ORDER BY pnl DESC
`).all();

// ── By symbol ──
const bySymbol = db.prepare(`
  SELECT symbol AS segment,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COALESCE(SUM(profit), 0) AS pnl,
    COALESCE(AVG(stake), 0) AS avg_stake
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter}
    AND time >= ${dayStart} AND time < ${dayEnd}
  GROUP BY symbol ORDER BY pnl ASC
`).all();

// ── By hour (UTC) ──
const byHour = db.prepare(`
  SELECT strftime('%H', datetime(time / 1000, 'unixepoch')) AS segment,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COALESCE(SUM(profit), 0) AS pnl
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter}
    AND time >= ${dayStart} AND time < ${dayEnd}
  GROUP BY segment ORDER BY segment
`).all();

// ── Biggest losses ──
const biggestLosses = db.prepare(`
  SELECT symbol, direction, stake, profit, confidence, preset, time, note
  FROM bot_trades
  WHERE status = 'lost' AND ${modeFilter}
    AND time >= ${dayStart} AND time < ${dayEnd}
  ORDER BY profit ASC LIMIT 5
`).all();

// ── Losing streaks ──
const dayTrades = db.prepare(`
  SELECT status, profit, symbol FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter}
    AND time >= ${dayStart} AND time < ${dayEnd}
  ORDER BY time ASC
`).all();
let maxStreak = 0, currentStreak = 0, streaks = [];
for (const t of dayTrades) {
  if (t.status === 'lost') { currentStreak++; maxStreak = Math.max(maxStreak, currentStreak); }
  else { if (currentStreak >= 3) streaks.push(currentStreak); currentStreak = 0; }
}
if (currentStreak >= 3) streaks.push(currentStreak);

// ── Recent config changes ──
const configChanges = db.prepare(`
  SELECT cc.preset, cc.changed_at, cc.fields, cc.source, u.username
  FROM config_changes cc JOIN users u ON u.id = cc.user_id
  WHERE cc.changed_at >= ${dayStart} AND cc.changed_at < ${dayEnd}
  ORDER BY cc.changed_at DESC LIMIT 5
`).all();

// ── Per-user breakdown ──
const byUser = db.prepare(`
  SELECT u.username,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE t.status = 'won') AS wins,
    COALESCE(SUM(t.profit), 0) AS pnl
  FROM bot_trades t JOIN users u ON u.id = t.user_id
  WHERE t.status IN ('won','lost') AND ${modeFilter}
    AND t.time >= ${dayStart} AND t.time < ${dayEnd}
  GROUP BY u.username ORDER BY pnl DESC
`).all();

const report = {
  date: dateStr,
  mode,
  day: {
    trades: dayStats.trades,
    wins: dayStats.wins,
    losses: dayStats.losses,
    winRate: dayStats.trades ? dayStats.wins / dayStats.trades : 0,
    pnl: dayStats.pnl,
    expectancy: dayStats.trades ? dayStats.pnl / dayStats.trades : 0,
    profitFactor: dayStats.gross_loss > 0 ? dayStats.gross_win / dayStats.gross_loss : dayStats.wins > 0 ? null : 0,
    avgStake: dayStats.avg_stake,
    maxStake: dayStats.max_stake,
    avgWin: dayStats.avg_win,
    avgLoss: dayStats.avg_loss,
  },
  weekComparison: {
    trades7d: weekStats.trades,
    pnl7d: weekStats.pnl,
    dailyAvgPnl: weekDailyAvg,
    dayVsAvg: dayStats.pnl - weekDailyAvg,
  },
  byPreset, bySymbol, byHour, biggestLosses, byUser,
  maxLosingStreak: maxStreak,
  losingStreaks: streaks,
  configChanges: configChanges.map(c => ({ ...c, fields: JSON.parse(c.fields) })),
};

function money(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}$`; }
function pct(v) { return `${(v * 100).toFixed(1)}%`; }

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const d = report.day;
  const w = report.weekComparison;
  console.log(`# Revue quotidienne — ${dateStr} (${mode})\n`);
  console.log(`## Résumé du jour`);
  console.log(`- Trades: ${d.trades} (${d.wins}W / ${d.losses}L)`);
  console.log(`- Win rate: ${pct(d.winRate)}`);
  console.log(`- P&L: ${money(d.pnl)}`);
  console.log(`- Espérance/trade: ${money(d.expectancy)}`);
  console.log(`- Profit factor: ${d.profitFactor === null ? "∞" : d.profitFactor.toFixed(2)}`);
  console.log(`- Mise moyenne: ${d.avgStake.toFixed(2)}$ / max: ${d.maxStake.toFixed(2)}$`);

  console.log(`\n## Comparaison vs 7 derniers jours`);
  console.log(`- P&L 7 jours: ${money(w.pnl7d)} (${w.trades7d} trades)`);
  console.log(`- Moyenne/jour: ${money(w.dailyAvgPnl)}`);
  console.log(`- Jour vs moyenne: ${w.dayVsAvg >= 0 ? "+" : ""}${w.dayVsAvg.toFixed(2)}$`);

  if (byPreset.length) {
    console.log(`\n## Par preset`);
    console.log("| Preset | Trades | Wins | P&L |");
    console.log("|---|---:|---:|---:|");
    for (const r of byPreset) console.log(`| ${r.segment} | ${r.trades} | ${r.wins} | ${money(r.pnl)} |`);
  }

  if (bySymbol.length) {
    console.log(`\n## Par symbole (trié par P&L ascendant)`);
    console.log("| Symbole | Trades | Wins | P&L | Mise moy |");
    console.log("|---|---:|---:|---:|---:|");
    for (const r of bySymbol) console.log(`| ${r.segment} | ${r.trades} | ${r.wins} | ${money(r.pnl)} | ${r.avg_stake.toFixed(2)}$ |`);
  }

  if (byHour.length) {
    console.log(`\n## Par heure UTC`);
    console.log("| Heure | Trades | Wins | P&L |");
    console.log("|---|---:|---:|---:|");
    for (const r of byHour) console.log(`| ${r.segment}h | ${r.trades} | ${r.wins} | ${money(r.pnl)} |`);
  }

  if (byUser.length) {
    console.log(`\n## Par utilisateur`);
    console.log("| User | Trades | Wins | P&L |");
    console.log("|---|---:|---:|---:|");
    for (const r of byUser) console.log(`| ${r.username} | ${r.trades} | ${r.wins} | ${money(r.pnl)} |`);
  }

  if (biggestLosses.length) {
    console.log(`\n## Plus grosses pertes`);
    for (const t of biggestLosses) {
      console.log(`- ${t.symbol} ${t.direction} ${t.preset ?? ""} — mise ${t.stake}$, confiance ${t.confidence}%, P&L ${money(t.profit)}${t.note ? ` (${t.note})` : ""}`);
    }
  }

  if (maxStreak >= 3) {
    console.log(`\n## ⚠️ Séries de pertes`);
    console.log(`- Série max: ${maxStreak} pertes consécutives`);
    if (streaks.length) console.log(`- Séries ≥3: ${streaks.join(", ")}`);
  }

  if (configChanges.length) {
    console.log(`\n## Changements de config du jour`);
    for (const c of configChanges) {
      const fields = Object.entries(c.fields).map(([k, v]) => `${k}: ${v.from}→${v.to}`).join(", ");
      console.log(`- ${c.username} / ${c.preset} — ${fields} (${c.source})`);
    }
  }

  // ── Recommendations ──
  console.log(`\n## Recommandations`);
  const recs = [];
  // Suspend symbols with 5+ trades and negative P&L
  for (const s of bySymbol) {
    if (s.trades >= 5 && s.pnl < 0) recs.push(`Suspendre ${s.segment} (${s.trades} trades, ${money(s.pnl)}) — perf négative aujourd'hui`);
  }
  // Flag high stakes
  if (d.maxStake > d.avgStake * 3 && d.maxStake > 20) recs.push(`Mise max ${d.maxStake.toFixed(2)}$ détectée (moyenne ${d.avgStake.toFixed(2)}$) — vérifier que ce n'est pas du revenge trading`);
  // Compare to week
  if (w.dayVsAvg < -10) recs.push(`Jour significativement pire que la moyenne 7 jours (${money(w.dayVsAvg)} vs ${money(w.dailyAvgPnl)}) — investiguer avant de continuer`);
  if (d.pnl > 0 && d.trades >= 10) recs.push(`Jour positif (${money(d.pnl)}) — ne pas changer la configuration, continuer tel quel`);
  if (recs.length === 0) recs.push("Pas d'action spécifique requise — surveiller et continuer");
  for (const r of recs) console.log(`- ${r}`);
}
