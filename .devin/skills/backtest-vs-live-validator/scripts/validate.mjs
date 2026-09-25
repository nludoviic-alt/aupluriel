#!/usr/bin/env node
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const userId = args.find((a) => a.startsWith("--user-id="))?.split("=")[1];
const presetFilter = args.find((a) => a.startsWith("--preset="))?.split("=")[1];
const sample = Number(args.find((a) => a.startsWith("--sample="))?.split("=")[1] ?? 100);
const jsonOut = args.includes("--json");

if (!dbPath) { console.error("Usage: validate.mjs DB_PATH [--user-id=N] [--preset=crash] [--sample=100] [--json]"); process.exit(1); }

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const userF = userId ? `AND user_id = ${Number(userId)}` : "";
const presetF = presetFilter ? `AND COALESCE(preset, CASE WHEN symbol LIKE 'BOOM%' THEN 'boom' WHEN symbol LIKE 'CRASH%' THEN 'crash' ELSE 'default' END) = '${presetFilter}'` : "";

// ── Backtest state ──
const backtestState = db.prepare(`SELECT * FROM auto_backtest_state WHERE id = 1`).get();

// ── Live metrics (last N closed trades) ──
const liveStats = db.prepare(`
  SELECT COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COUNT(*) FILTER (WHERE status = 'lost') AS losses,
    COALESCE(SUM(profit), 0) AS pnl,
    COALESCE(SUM(profit) FILTER (WHERE status = 'won'), 0) AS gross_win,
    COALESCE(-SUM(profit) FILTER (WHERE status = 'lost'), 0) AS gross_loss,
    COALESCE(AVG(profit) FILTER (WHERE status = 'won'), 0) AS avg_win,
    COALESCE(-AVG(profit) FILTER (WHERE status = 'lost'), 0) AS avg_loss,
    COALESCE(AVG(stake), 0) AS avg_stake,
    MIN(time) AS first_trade_time,
    MAX(time) AS last_trade_time
  FROM (
    SELECT * FROM bot_trades
    WHERE status IN ('won','lost') ${userF} ${presetF}
    ORDER BY COALESCE(closed_at, time) DESC
    LIMIT ${sample}
  )
`).get();

const liveWinRate = liveStats.trades > 0 ? liveStats.wins / liveStats.trades : 0;
const liveExpectancy = liveStats.trades > 0 ? liveStats.pnl / liveStats.trades : 0;
const livePF = liveStats.gross_loss > 0 ? liveStats.gross_win / liveStats.gross_loss : liveStats.wins > 0 ? null : 0;
const liveBreakEven = liveStats.avg_win + liveStats.avg_loss > 0 ? liveStats.avg_loss / (liveStats.avg_win + liveStats.avg_loss) : 0;

// ── Backtest metrics ──
const btWinRate = backtestState?.win_rate ?? null;
const btBreakEven = backtestState?.break_even_win_rate ?? null;
const btFavorable = backtestState?.favorable ?? null;
const btCheckedAt = backtestState?.checked_at ? new Date(backtestState.checked_at * 1000).toISOString() : null;

// ── Per-preset live breakdown ──
const presetBreakdown = db.prepare(`
  SELECT COALESCE(preset, CASE WHEN symbol LIKE 'BOOM%' THEN 'boom' WHEN symbol LIKE 'CRASH%' THEN 'crash' ELSE 'default' END) AS preset,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COALESCE(SUM(profit), 0) AS pnl,
    COALESCE(AVG(profit) FILTER (WHERE status = 'won'), 0) AS avg_win,
    COALESCE(-AVG(profit) FILTER (WHERE status = 'lost'), 0) AS avg_loss
  FROM (
    SELECT * FROM bot_trades
    WHERE status IN ('won','lost') ${userF}
    ORDER BY COALESCE(closed_at, time) DESC
    LIMIT ${sample}
  )
  GROUP BY preset
`).all();

// ── Per-symbol live breakdown ──
const symbolBreakdown = db.prepare(`
  SELECT symbol,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COALESCE(SUM(profit), 0) AS pnl
  FROM (
    SELECT * FROM bot_trades
    WHERE status IN ('won','lost') ${userF} ${presetF}
    ORDER BY COALESCE(closed_at, time) DESC
    LIMIT ${sample}
  )
  GROUP BY symbol ORDER BY pnl DESC
`).all();

// ── Confidence distribution ──
const confDist = db.prepare(`
  SELECT
    CASE WHEN confidence < 70 THEN '<70'
         WHEN confidence < 80 THEN '70-79'
         WHEN confidence < 90 THEN '80-89'
         ELSE '90+' END AS bucket,
    COUNT(*) AS trades,
    COUNT(*) FILTER (WHERE status = 'won') AS wins,
    COALESCE(SUM(profit), 0) AS pnl
  FROM (
    SELECT * FROM bot_trades
    WHERE status IN ('won','lost') ${userF} ${presetF}
    ORDER BY COALESCE(closed_at, time) DESC
    LIMIT ${sample}
  )
  GROUP BY bucket ORDER BY bucket
`).all();

// ── Error trades ──
const errorCount = db.prepare(`
  SELECT COUNT(*) AS cnt FROM bot_trades
  WHERE status = 'error' ${userF} ${presetF}
    AND time > (SELECT COALESCE(MIN(time), 0) FROM (SELECT * FROM bot_trades WHERE status IN ('won','lost') ${userF} ${presetF} ORDER BY COALESCE(closed_at, time) DESC LIMIT ${sample}))
`).get();

// ── Calculate gaps ──
const winRateGap = btWinRate !== null ? liveWinRate - btWinRate : null;
const breakEvenGap = btBreakEven !== null ? liveBreakEven - btBreakEven : null;

let verdict = "INCONNU";
let verdictColor = "🔍";
if (winRateGap !== null) {
  const gapPct = Math.abs(winRateGap) * 100;
  if (gapPct < 5) { verdict = "FIABLE"; verdictColor = "✅"; }
  else if (gapPct < 15) { verdict = "PARTIELLEMENT FIABLE"; verdictColor = "⚠️"; }
  else { verdict = "NON FIABLE"; verdictColor = "⛔"; }
}

// ── Possible causes ──
const causes = [];
if (winRateGap !== null && winRateGap < -0.05) {
  causes.push("Win rate live inférieur au backtest — possible surapprentissage ou conditions de marché différentes");
}
if (errorCount.cnt > 5) {
  causes.push(`${errorCount.cnt} trades en erreur — problème d'exécution (connexion Deriv, symboles invalides, timeout)`);
}
if (liveStats.avg_stake > 0 && livePF !== null && livePF < 1) {
  causes.push(`Profit factor live < 1 (${livePF.toFixed(2)}) — le bot perd de l'argent en conditions réelles`);
}
if (btBreakEven !== null && liveBreakEven > btBreakEven) {
  causes.push(`Seuil de rentabilité live supérieur au backtest (${(liveBreakEven * 100).toFixed(1)}% vs ${(btBreakEven * 100).toFixed(1)}%) — le payout réel est moins favorable`);
}
// Check if live trades span a very short period (possible market condition mismatch)
const spanMs = (liveStats.last_trade_time ?? 0) - (liveStats.first_trade_time ?? 0);
const spanDays = spanMs / 86400000;
if (spanDays < 1 && liveStats.trades > 20) {
  causes.push(`Tous les trades live sont sur ${spanDays.toFixed(1)} jour(s) — échantillon trop concentré pour comparer au backtest`);
}

const report = {
  sample,
  userId: userId ?? "all",
  preset: presetFilter ?? "all",
  backtest: {
    winRate: btWinRate,
    breakEvenWinRate: btBreakEven,
    favorable: Boolean(btFavorable),
    checkedAt: btCheckedAt,
  },
  live: {
    trades: liveStats.trades,
    wins: liveStats.wins,
    losses: liveStats.losses,
    winRate: liveWinRate,
    pnl: liveStats.pnl,
    expectancy: liveExpectancy,
    profitFactor: livePF,
    avgWin: liveStats.avg_win,
    avgLoss: liveStats.avg_loss,
    avgStake: liveStats.avg_stake,
    breakEvenWinRate: liveBreakEven,
    firstTradeTime: liveStats.first_trade_time,
    lastTradeTime: liveStats.last_trade_time,
    spanDays,
    errorCount: errorCount.cnt,
  },
  gap: {
    winRate: winRateGap,
    breakEven: breakEvenGap,
  },
  verdict: { label: verdict, color: verdictColor },
  causes,
  presetBreakdown,
  symbolBreakdown,
  confidenceDistribution: confDist,
};

function money(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}$`; }
function pct(v) { return v !== null ? `${(v * 100).toFixed(1)}%` : "N/A"; }
function pf(v) { return v === null ? "∞" : v.toFixed(2); }

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# Backtest vs Live Validator — ${sample} derniers trades\n`);

  console.log(`## Backtest (auto_backtest_state)`);
  console.log(`- Win rate: ${pct(btWinRate)}`);
  console.log(`- Seuil de rentabilité: ${pct(btBreakEven)}`);
  console.log(`- Favorable: ${btFavorable ? "Oui" : "Non"}`);
  console.log(`- Dernière vérification: ${btCheckedAt ?? "N/A"}`);

  console.log(`\n## Live (${liveStats.trades} trades fermés)`);
  console.log(`- Win rate: ${pct(liveWinRate)} (${liveStats.wins}W / ${liveStats.losses}L)`);
  console.log(`- P&L total: ${money(liveStats.pnl)}`);
  console.log(`- Espérance/trade: ${money(liveExpectancy)}`);
  console.log(`- Profit factor: ${pf(livePF)}`);
  console.log(`- Gain moyen: ${liveStats.avg_win.toFixed(2)}$ / Perte moyenne: ${liveStats.avg_loss.toFixed(2)}$`);
  console.log(`- Seuil de rentabilité: ${pct(liveBreakEven)}`);
  console.log(`- Mise moyenne: ${liveStats.avg_stake.toFixed(2)}$`);
  console.log(`- Période: ${spanDays.toFixed(1)} jours`);
  console.log(`- Trades en erreur: ${errorCount.cnt}`);

  console.log(`\n## Comparaison`);
  console.log("| Métrique | Backtest | Live | Écart |");
  console.log("|---|---:|---:|---:|");
  console.log(`| Win rate | ${pct(btWinRate)} | ${pct(liveWinRate)} | ${winRateGap !== null ? (winRateGap >= 0 ? "+" : "") + (winRateGap * 100).toFixed(1) + "pp" : "N/A"} |`);
  console.log(`| Seuil rentabilité | ${pct(btBreakEven)} | ${pct(liveBreakEven)} | ${breakEvenGap !== null ? (breakEvenGap >= 0 ? "+" : "") + (breakEvenGap * 100).toFixed(1) + "pp" : "N/A"} |`);

  console.log(`\n## Verdict: ${verdictColor} ${verdict}`);
  if (winRateGap !== null) {
    if (Math.abs(winRateGap) < 0.05) console.log(`  Écart de win rate < 5% — le backtest est représentatif du live.`);
    else if (winRateGap < -0.05) console.log(`  Le live sous-performe de ${Math.abs(winRateGap * 100).toFixed(1)}pp — le backtest est optimiste.`);
    else console.log(`  Le live surperforme de ${(winRateGap * 100).toFixed(1)}pp — le backtest est conservateur.`);
  }

  if (causes.length) {
    console.log(`\n## Causes possibles de l'écart`);
    for (const c of causes) console.log(`- ${c}`);
  }

  if (presetBreakdown.length) {
    console.log(`\n## Par preset (live)`);
    console.log("| Preset | Trades | Win rate | P&L | PF |");
    console.log("|---|---:|---:|---:|---:|");
    for (const p of presetBreakdown) {
      const wr = p.trades ? p.wins / p.trades : 0;
      const pfVal = p.avg_loss > 0 ? p.avg_win / p.avg_loss : p.wins > 0 ? null : 0;
      console.log(`| ${p.preset} | ${p.trades} | ${pct(wr)} | ${money(p.pnl)} | ${pf(pfVal)} |`);
    }
  }

  if (symbolBreakdown.length) {
    console.log(`\n## Par symbole (live, top/bottom 5)`);
    const top5 = [...symbolBreakdown].sort((a, b) => b.pnl - a.pnl).slice(0, 5);
    const bot5 = [...symbolBreakdown].sort((a, b) => a.pnl - b.pnl).slice(0, 5);
    console.log(`**Top 5:**`);
    for (const s of top5) console.log(`- ${s.symbol}: ${s.trades} trades, ${money(s.pnl)}`);
    console.log(`**Bottom 5:**`);
    for (const s of bot5) console.log(`- ${s.symbol}: ${s.trades} trades, ${money(s.pnl)}`);
  }

  if (confDist.length) {
    console.log(`\n## Distribution par confiance (live)`);
    console.log("| Bucket | Trades | Win rate | P&L |");
    console.log("|---|---:|---:|---:|");
    for (const c of confDist) {
      const wr = c.trades ? c.wins / c.trades : 0;
      console.log(`| ${c.bucket} | ${c.trades} | ${pct(wr)} | ${money(c.pnl)} |`);
    }
  }

  console.log(`\n## Recommandations`);
  if (verdict === "FIABLE") {
    console.log("- ✅ Le backtest est fiable — continuer avec la configuration actuelle");
  } else if (verdict === "PARTIELLEMENT FIABLE") {
    console.log("- ⚠️ Le backtest est partiellement fiable — ajuster les attentes et surveiller");
    console.log("- Vérifier si les symboles perdants en live l'étaient aussi en backtest");
  } else if (verdict === "NON FIABLE") {
    console.log("- ⛔ Le backtest n'est pas représentatif du live — ne pas s'y fier pour les décisions");
    console.log("- Envisager de re-calibrer le backtest avec des données plus récentes");
    console.log("- Vérifier les causes d'écart ci-dessus et corriger avant de continuer");
  }
  if (liveStats.trades < 30) {
    console.log(`- ⚠️ Échantillon live insuffisant (${liveStats.trades} < 30) — attendre plus de trades avant de conclure`);
  }
}
