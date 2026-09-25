#!/usr/bin/env node
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const bankroll = Number(args.find((a) => a.startsWith("--bankroll="))?.split("=")[1] ?? 100);
const kellyFraction = Number(args.find((a) => a.startsWith("--kelly-fraction="))?.split("=")[1] ?? 0.25);
const mode = args.find((a) => a.startsWith("--mode="))?.split("=")[1] ?? "all";
const userId = args.find((a) => a.startsWith("--user-id="))?.split("=")[1];
const jsonOut = args.includes("--json");

if (!dbPath) { console.error("Usage: risk-optimize.mjs DB_PATH [--bankroll=100] [--kelly-fraction=0.25] [--mode=demo|live|all] [--user-id=N] [--json]"); process.exit(1); }

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const modeFilter = mode === "all" ? "1=1" : mode === "demo" ? "(mode = 'demo' OR mode IS NULL)" : "mode = 'live'";
const userFilter = userId ? `AND user_id = ${Number(userId)}` : "";

// ── Per-preset stats ──
const presets = db.prepare(`
  SELECT COALESCE(preset, CASE WHEN symbol LIKE 'BOOM%' THEN 'boom' WHEN symbol LIKE 'CRASH%' THEN 'crash' ELSE 'default' END) AS preset,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COUNT(*) FILTER (WHERE status = 'lost') AS losses,
    COALESCE(SUM(profit), 0) AS pnl,
    COALESCE(AVG(profit) FILTER (WHERE status = 'won'), 0) AS avg_win,
    COALESCE(-AVG(profit) FILTER (WHERE status = 'lost'), 0) AS avg_loss,
    COALESCE(AVG(stake), 0) AS avg_stake,
    COALESCE(MAX(stake), 0) AS max_stake
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter} ${userFilter}
  GROUP BY preset
`).all();

// ── Per-symbol stats ──
const symbols = db.prepare(`
  SELECT symbol,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COALESCE(AVG(profit) FILTER (WHERE status = 'won'), 0) AS avg_win,
    COALESCE(-AVG(profit) FILTER (WHERE status = 'lost'), 0) AS avg_loss,
    COALESCE(AVG(stake), 0) AS avg_stake
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter} ${userFilter}
  GROUP BY symbol HAVING trades >= 20
`).all();

// ── Daily P&L history for drawdown ──
const dailyPnl = db.prepare(`
  SELECT strftime('%Y-%m-%d', datetime(time / 1000, 'unixepoch')) AS day,
    COALESCE(SUM(profit), 0) AS pnl,
    COUNT(*) AS trades
  FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter} ${userFilter}
  GROUP BY day ORDER BY day
`).all();

const worstDay = dailyPnl.reduce((worst, d) => d.pnl < worst.pnl ? d : worst, { pnl: 0, day: "N/A", trades: 0 });
const bestDay = dailyPnl.reduce((best, d) => d.pnl > best.pnl ? d : best, { pnl: 0, day: "N/A", trades: 0 });
const avgDailyLoss = Math.abs(dailyPnl.filter(d => d.pnl < 0).reduce((sum, d) => sum + d.pnl, 0) / Math.max(1, dailyPnl.filter(d => d.pnl < 0).length));

// ── Max losing streak ──
const allTrades = db.prepare(`
  SELECT status FROM bot_trades
  WHERE status IN ('won','lost') AND ${modeFilter} ${userFilter}
  ORDER BY COALESCE(closed_at, time), time
`).all();
let maxStreak = 0, curStreak = 0;
for (const t of allTrades) {
  if (t.status === 'lost') { curStreak++; maxStreak = Math.max(maxStreak, curStreak); }
  else curStreak = 0;
}

// ── Kelly calculation per preset ──
function kelly(winRate, avgWin, avgLoss) {
  if (avgLoss === 0) return 0;
  const b = avgWin / avgLoss; // payout ratio
  const p = winRate;
  const q = 1 - p;
  const f = (p * b - q) / b;
  return f; // can be negative if edge is negative
}

const presetResults = presets.map(p => {
  const winRate = p.trades > 0 ? p.wins / p.trades : 0;
  const kellyFull = kelly(winRate, p.avg_win, p.avg_loss);
  const kellyFrac = Math.max(0, kellyFull * kellyFraction);
  const recommendedStake = Math.min(kellyFrac * bankroll, bankroll * 0.05); // cap at 5%
  const currentStake = p.avg_stake;
  const verdict = kellyFull <= 0 ? "ARRÊTER (edge négatif)"
    : currentStake > recommendedStake * 1.5 ? "SUR-RISQUE (réduire)"
    : currentStake < recommendedStake * 0.5 ? "SOUS-RISQUE (peut augmenter)"
    : "BIEN CALIBRÉ";
  return {
    preset: p.preset,
    trades: p.trades,
    winRate,
    avgWin: p.avg_win,
    avgLoss: p.avg_loss,
    payoutRatio: p.avg_loss > 0 ? p.avg_win / p.avg_loss : 0,
    kellyFull,
    kellyFractional: kellyFrac,
    recommendedStake: Math.max(0, recommendedStake),
    currentStake,
    maxStake: p.max_stake,
    verdict,
    reliable: p.trades >= 50,
  };
});

const symbolResults = symbols.map(s => {
  const winRate = s.trades > 0 ? s.wins / s.trades : 0;
  const kellyFull = kelly(winRate, s.avg_win, s.avg_loss);
  const kellyFrac = Math.max(0, kellyFull * kellyFraction);
  const recommendedStake = Math.min(kellyFrac * bankroll, bankroll * 0.05);
  return {
    symbol: s.symbol,
    trades: s.trades,
    winRate,
    kellyFull,
    recommendedStake: Math.max(0, recommendedStake),
    currentStake: s.avg_stake,
    verdict: kellyFull <= 0 ? "ARRÊTER" : s.avg_stake > recommendedStake * 1.5 ? "SUR-RISQUE" : s.avg_stake < recommendedStake * 0.5 ? "SOUS-RISQUE" : "OK",
  };
});

// ── Stress tests ──
function stressTest(stake, avgLoss, streak) {
  return { streak, loss: -(stake * streak), pctBankroll: -(stake * streak) / bankroll * 100 };
}

// ── Daily limits ──
const dailyLimit = Math.min(Math.abs(worstDay.pnl) * 1.5, bankroll * 0.15);
const weeklyLimit = Math.min(Math.abs(worstDay.pnl) * 4, bankroll * 0.30);

const report = {
  bankroll, kellyFraction, mode, userId: userId ?? "all",
  presets: presetResults,
  symbols: symbolResults,
  dailyPnl: { worstDay, bestDay, avgDailyLoss, totalDays: dailyPnl.length },
  maxLosingStreak: maxStreak,
  limits: { daily: dailyLimit, weekly: weeklyLimit, maxStakePct: 5, maxTradesPerDay: 50 },
  stressTests: [5, 10, 20].map(n => {
    const avgStake = presets.reduce((s, p) => s + p.avg_stake, 0) / Math.max(1, presets.length);
    const avgLoss = presets.reduce((s, p) => s + p.avg_loss, 0) / Math.max(1, presets.length);
    return stressTest(avgStake, avgLoss, n);
  }),
};

function money(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}$`; }
function pct(v) { return `${(v * 100).toFixed(1)}%`; }

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# Risk Optimizer — Bankroll ${bankroll}$ | Kelly × ${kellyFraction} | ${mode}\n`);

  console.log(`## Par preset\n`);
  console.log("| Preset | Trades | Win rate | Avg win | Avg loss | Payout | Kelly % | Mise reco | Mise actuelle | Verdict |");
  console.log("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const p of presetResults) {
    console.log(`| ${p.preset} | ${p.trades}${p.reliable ? "" : " ⚠️"} | ${pct(p.winRate)} | ${p.avgWin.toFixed(2)}$ | ${p.avgLoss.toFixed(2)}$ | ${p.payoutRatio.toFixed(2)} | ${pct(p.kellyFull)} | ${p.recommendedStake.toFixed(2)}$ | ${p.currentStake.toFixed(2)}$ | ${p.verdict} |`);
  }

  console.log(`\n## Par symbole (≥20 trades)\n`);
  console.log("| Symbole | Trades | Win rate | Kelly % | Mise reco | Mise actuelle | Verdict |");
  console.log("|---|---:|---:|---:|---:|---:|---|");
  for (const s of symbolResults) {
    console.log(`| ${s.symbol} | ${s.trades} | ${pct(s.winRate)} | ${pct(s.kellyFull)} | ${s.recommendedStake.toFixed(2)}$ | ${s.currentStake.toFixed(2)}$ | ${s.verdict} |`);
  }

  console.log(`\n## Limites recommandées`);
  console.log(`- Perte quotidienne max: ${dailyLimit.toFixed(2)}$ (${pct(dailyLimit / bankroll)} du bankroll)`);
  console.log(`- Perte hebdomadaire max: ${weeklyLimit.toFixed(2)}$ (${pct(weeklyLimit / bankroll)} du bankroll)`);
  console.log(`- Mise max par trade: ${(bankroll * 0.05).toFixed(2)}$ (5% du bankroll)`);
  console.log(`- Trades max par jour: 50`);

  console.log(`\n## Historique quotidien`);
  console.log(`- Pire jour: ${worstDay.day} (${money(worstDay.pnl)}, ${worstDay.trades} trades)`);
  console.log(`- Meilleur jour: ${bestDay.day} (${money(bestDay.pnl)}, ${bestDay.trades} trades)`);
  console.log(`- Perte journalière moyenne: ${avgDailyLoss.toFixed(2)}$`);
  console.log(`- Jours analysés: ${dailyPnl.length}`);

  console.log(`\n## Stress tests (séries de pertes)`);
  console.log("| Pertes consécutives | Perte totale | % bankroll |");
  console.log("|---:|---:|---:|");
  for (const s of report.stressTests) {
    console.log(`| ${s.streak} | ${s.loss.toFixed(2)}$ | ${s.pctBankroll.toFixed(1)}% |`);
  }

  console.log(`\n## Série de pertes maximale historique: ${maxStreak}`);

  console.log(`\n## Recommandations`);
  for (const p of presetResults) {
    if (p.verdict === "ARRÊTER (edge négatif)") {
      console.log(`- ⛔ ${p.preset}: edge négatif (Kelly ${pct(p.kellyFull)}) — ARRÊTER ce preset immédiatement`);
    } else if (p.verdict === "SUR-RISQUE (réduire)") {
      console.log(`- ⚠️ ${p.preset}: mise actuelle ${p.currentStake.toFixed(2)}$ vs recommandée ${p.recommendedStake.toFixed(2)}$ — RÉDUIRE de ${((1 - p.recommendedStake / p.currentStake) * 100).toFixed(0)}%`);
    } else if (p.verdict === "SOUS-RISQUE (peut augmenter)") {
      console.log(`- 📈 ${p.preset}: mise actuelle ${p.currentStake.toFixed(2)}$ vs recommandée ${p.recommendedStake.toFixed(2)}$ — peut AUGMENTER de ${((p.recommendedStake / p.currentStake - 1) * 100).toFixed(0)}%`);
    } else {
      console.log(`- ✅ ${p.preset}: bien calibré (${p.currentStake.toFixed(2)}$ ≈ ${p.recommendedStake.toFixed(2)}$)`);
    }
    if (!p.reliable) console.log(`  ⚠️ Échantillon insuffisant (${p.trades} < 50) — recommandation exploratoire`);
  }
}
