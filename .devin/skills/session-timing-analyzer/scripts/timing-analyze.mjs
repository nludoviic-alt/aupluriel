#!/usr/bin/env node
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const mode = args.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "all";
const userId = args.find((a) => a.startsWith("--user-id="))?.split("=")[1];
const presetFilter = args.find((a) => a.startsWith("--preset="))?.split("=")[1];
const jsonOut = args.includes("--json");

if (!dbPath) { console.error("Usage: timing-analyze.mjs DB_PATH [--mode=demo|live|all] [--user-id=N] [--preset=crash] [--json]"); process.exit(1); }

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const modeF = mode === "all" ? "1=1" : mode === "demo" ? "(mode = 'demo' OR mode IS NULL)" : "mode = 'live'";
const userF = userId ? `AND user_id = ${Number(userId)}` : "";
const presetF = presetFilter ? `AND COALESCE(preset, CASE WHEN symbol LIKE 'BOOM%' THEN 'boom' WHEN symbol LIKE 'CRASH%' THEN 'crash' ELSE 'default' END) = '${presetFilter}'` : "";

function metrics(where, params = []) {
  const row = db.prepare(`
    SELECT COUNT(*) AS trades,
      COUNT(*) FILTER (WHERE status = 'won') AS wins,
      COALESCE(SUM(profit), 0) AS pnl,
      COALESCE(SUM(profit) FILTER (WHERE status = 'won'), 0) AS gross_win,
      COALESCE(-SUM(profit) FILTER (WHERE status = 'lost'), 0) AS gross_loss
    FROM bot_trades
    WHERE status IN ('won','lost') AND ${modeF} ${userF} ${presetF} AND ${where}
  `).get(...params);
  return {
    trades: row.trades,
    wins: row.wins,
    winRate: row.trades ? row.wins / row.trades : 0,
    pnl: row.pnl,
    expectancy: row.trades ? row.pnl / row.trades : 0,
    profitFactor: row.gross_loss > 0 ? row.gross_win / row.gross_loss : row.wins > 0 ? null : 0,
  };
}

// ── By hour ──
const byHour = [];
for (let h = 0; h < 24; h++) {
  const hStr = String(h).padStart(2, "0");
  const m = metrics(`strftime('%H', datetime(time / 1000, 'unixepoch')) = '${hStr}'`);
  byHour.push({ hour: hStr, ...m });
}

// ── By session ──
const sessions = [
  { name: "Asia (00-08 UTC)", start: 0, end: 8 },
  { name: "London (08-16 UTC)", start: 8, end: 16 },
  { name: "New York (13-21 UTC)", start: 13, end: 21 },
  { name: "Off-hours (21-00 UTC)", start: 21, end: 24 },
];
const bySession = sessions.map(s => {
  const hours = byHour.filter(h => Number(h.hour) >= s.start && Number(h.hour) < s.end);
  const trades = hours.reduce((sum, h) => sum + h.trades, 0);
  const wins = hours.reduce((sum, h) => sum + h.wins, 0);
  const pnl = hours.reduce((sum, h) => sum + h.pnl, 0);
  const grossWin = hours.reduce((sum, h) => sum + (h.profitFactor !== null ? h.pnl : 0), 0);
  return {
    name: s.name,
    trades,
    wins,
    winRate: trades ? wins / trades : 0,
    pnl,
    expectancy: trades ? pnl / trades : 0,
  };
});

// ── By day of week ──
const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const byDay = [];
for (let d = 0; d < 7; d++) {
  const m = metrics(`strftime('%w', datetime(time / 1000, 'unixepoch')) = '${d}'`);
  byDay.push({ day: dayNames[d], dayNum: d, ...m });
}

// ── Heatmap hour × day ──
const heatmap = [];
for (let h = 0; h < 24; h++) {
  for (let d = 0; d < 7; d++) {
    const hStr = String(h).padStart(2, "0");
    const m = metrics(`strftime('%H', datetime(time / 1000, 'unixepoch')) = '${hStr}' AND strftime('%w', datetime(time / 1000, 'unixepoch')) = '${d}'`);
    if (m.trades > 0) heatmap.push({ hour: hStr, day: dayNames[d], ...m });
  }
}
const topCombos = [...heatmap].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
const bottomCombos = [...heatmap].sort((a, b) => a.pnl - b.pnl).slice(0, 5);

// ── By symbol type ──
const symbolTypes = [
  { name: "BOOM/CRASH (synthétique)", filter: "symbol LIKE 'BOOM%' OR symbol LIKE 'CRASH%'" },
  { name: "Forex (frx*)", filter: "symbol LIKE 'frx%'" },
  { name: "Volatility (R_*)", filter: "symbol LIKE 'R\\_%' ESCAPE '\\'" },
  { name: "OTC", filter: "symbol LIKE 'OTC\\_%' ESCAPE '\\'" },
];
const bySymbolType = symbolTypes.map(t => ({ name: t.name, ...metrics(t.filter) }));

// ── Recommended windows ──
const goodHours = byHour.filter(h => h.trades >= 20 && h.pnl > 0).map(h => h.hour);
const badHours = byHour.filter(h => h.trades >= 20 && h.pnl < 0).map(h => h.hour);
const exploratoryHours = byHour.filter(h => h.trades > 0 && h.trades < 20).map(h => h.hour);

const report = {
  mode, userId: userId ?? "all", preset: presetFilter ?? "all",
  byHour, bySession, byDay, topCombos, bottomCombos, bySymbolType,
  recommendations: { goodHours, badHours, exploratoryHours },
};

function money(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}$`; }
function pct(v) { return `${(v * 100).toFixed(1)}%`; }
function pf(v) { return v === null ? "∞" : v.toFixed(2); }

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# Session Timing Analyzer — ${mode}${presetFilter ? ` / ${presetFilter}` : ""}\n`);

  console.log(`## Par heure UTC\n`);
  console.log("| Heure | Trades | Win rate | P&L | EV/trade | PF | Verdict |");
  console.log("|---|---:|---:|---:|---:|---:|---|");
  for (const h of byHour) {
    if (h.trades === 0) continue;
    const verdict = h.trades >= 20 ? (h.pnl > 0 ? "✅ Activer" : "⛔ Désactiver") : "🔍 Explorer";
    console.log(`| ${h.hour}h | ${h.trades} | ${pct(h.winRate)} | ${money(h.pnl)} | ${money(h.expectancy)} | ${pf(h.profitFactor)} | ${verdict} |`);
  }

  console.log(`\n## Par session\n`);
  console.log("| Session | Trades | Win rate | P&L | EV/trade |");
  console.log("|---|---:|---:|---:|---:|");
  for (const s of bySession) {
    if (s.trades === 0) continue;
    console.log(`| ${s.name} | ${s.trades} | ${pct(s.winRate)} | ${money(s.pnl)} | ${money(s.expectancy)} |`);
  }

  console.log(`\n## Par jour de la semaine\n`);
  console.log("| Jour | Trades | Win rate | P&L | EV/trade | PF |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const d of byDay) {
    if (d.trades === 0) continue;
    console.log(`| ${d.day} | ${d.trades} | ${pct(d.winRate)} | ${money(d.pnl)} | ${money(d.expectancy)} | ${pf(d.profitFactor)} |`);
  }

  console.log(`\n## Top 5 combinaisons heure × jour`);
  for (const c of topCombos) {
    console.log(`- ${c.day} ${c.hour}h — ${c.trades} trades, ${money(c.pnl)}, WR ${pct(c.winRate)}`);
  }

  console.log(`\n## Bottom 5 combinaisons heure × jour`);
  for (const c of bottomCombos) {
    console.log(`- ${c.day} ${c.hour}h — ${c.trades} trades, ${money(c.pnl)}, WR ${pct(c.winRate)}`);
  }

  console.log(`\n## Par type de symbole\n`);
  console.log("| Type | Trades | Win rate | P&L | EV/trade | PF |");
  console.log("|---|---:|---:|---:|---:|---:|");
  for (const t of bySymbolType) {
    if (t.trades === 0) continue;
    console.log(`| ${t.name} | ${t.trades} | ${pct(t.winRate)} | ${money(t.pnl)} | ${money(t.expectancy)} | ${pf(t.profitFactor)} |`);
  }

  console.log(`\n## Fenêtres recommandées`);
  if (goodHours.length) console.log(`- ✅ Heures rentables (≥20 trades): ${goodHours.map(h => h + "h").join(", ")}`);
  if (badHours.length) console.log(`- ⛔ Heures perdantes (≥20 trades): ${badHours.map(h => h + "h").join(", ")}`);
  if (exploratoryHours.length) console.log(`- 🔍 Heures à explorer (<20 trades): ${exploratoryHours.map(h => h + "h").join(", ")}`);

  // Session recommendations
  console.log(`\n## Recommandations par session`);
  for (const s of bySession) {
    if (s.trades < 10) { console.log(`- ${s.name}: échantillon insuffisant (${s.trades} trades)`); continue; }
    if (s.pnl > 0) console.log(`- ✅ ${s.name}: ${money(s.pnl)} sur ${s.trades} trades — garder actif`);
    else console.log(`- ⛔ ${s.name}: ${money(s.pnl)} sur ${s.trades} trades — envisager de désactiver`);
  }
}
