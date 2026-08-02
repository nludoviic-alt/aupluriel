#!/usr/bin/env node
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = args.find((arg) => !arg.startsWith("--"));
const mode = (args.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? "demo").toLowerCase();
const minSample = Number(args.find((arg) => arg.startsWith("--min-sample="))?.split("=")[1] ?? 30);
const jsonOutput = args.includes("--json");

if (!dbPath) {
  console.error("Usage: audit-production.mjs DB_PATH [--mode=demo|live] [--min-sample=30] [--json]");
  process.exit(1);
}
if (!["demo", "live"].includes(mode)) {
  console.error("--mode doit être demo ou live");
  process.exit(1);
}
if (!Number.isInteger(minSample) || minSample < 1) {
  console.error("--min-sample doit être un entier positif");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const modeSql = mode === "demo" ? "(mode = 'demo' OR mode IS NULL)" : "mode = 'live'";

function metrics(extraWhere = "1=1", params = []) {
  const row = db.prepare(`
    SELECT COUNT(*) AS trades,
           COUNT(*) FILTER (WHERE status = 'won') AS wins,
           COUNT(*) FILTER (WHERE status = 'lost') AS losses,
           COALESCE(SUM(profit), 0) AS pnl,
           COALESCE(SUM(profit) FILTER (WHERE status = 'won'), 0) AS gross_win,
           COALESCE(-SUM(profit) FILTER (WHERE status = 'lost'), 0) AS gross_loss,
           COALESCE(AVG(profit) FILTER (WHERE status = 'won'), 0) AS avg_win,
           COALESCE(-AVG(profit) FILTER (WHERE status = 'lost'), 0) AS avg_loss
    FROM bot_trades
    WHERE status IN ('won','lost') AND ${modeSql} AND ${extraWhere}
  `).get(...params);
  const profitFactor = row.gross_loss > 0 ? row.gross_win / row.gross_loss : row.wins > 0 ? null : 0;
  return {
    trades: row.trades,
    wins: row.wins,
    losses: row.losses,
    winRate: row.trades ? row.wins / row.trades : 0,
    pnl: row.pnl,
    expectancy: row.trades ? row.pnl / row.trades : 0,
    profitFactor,
    avgWin: row.avg_win,
    avgLoss: row.avg_loss,
    breakEvenWinRate: row.avg_win + row.avg_loss > 0 ? row.avg_loss / (row.avg_win + row.avg_loss) : 0,
    reliable: row.trades >= minSample,
  };
}

function grouped(expression, label) {
  const rows = db.prepare(`
    SELECT ${expression} AS segment
    FROM bot_trades
    WHERE status IN ('won','lost') AND ${modeSql}
    GROUP BY segment
  `).all();
  return {
    label,
    rows: rows.map(({ segment }) => ({
      segment: String(segment),
      ...metrics(`${expression} = ?`, [segment]),
    })).sort((a, b) => b.pnl - a.pnl),
  };
}

function maxDrawdown() {
  const rows = db.prepare(`
    SELECT profit FROM bot_trades
    WHERE status IN ('won','lost') AND ${modeSql}
    ORDER BY COALESCE(closed_at, time), time
  `).all();
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const row of rows) {
    cumulative += row.profit;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return drawdown;
}

const presetExpression = `CASE
  WHEN symbol LIKE 'BOOM%' THEN 'Boom'
  WHEN symbol LIKE 'CRASH%' THEN 'Crash'
  ELSE 'Multi'
END`;
const confidenceExpression = `CASE
  WHEN confidence < 60 THEN '<60'
  WHEN confidence < 70 THEN '60-69'
  WHEN confidence < 80 THEN '70-79'
  WHEN confidence < 90 THEN '80-89'
  ELSE '90-100'
END`;
const configs = db.prepare(`
  SELECT u.username, bs.preset, bs.enabled, bs.paused_until, bs.config, bs.updated_at
  FROM bot_state bs
  JOIN users u ON u.id = bs.user_id
  ORDER BY u.username, bs.preset
`).all().map((row) => {
  let config = null;
  try {
    const parsed = JSON.parse(row.config);
    config = {
      mode: parsed.mode,
      symbols: parsed.symbols,
      excludedSymbols: parsed.excludedSymbols,
      minConfidence: parsed.minConfidence,
      maxConfidence: parsed.maxConfidence,
      minTfAgreement: parsed.minTfAgreement,
      maxOpenPositions: parsed.maxOpenPositions,
    };
  } catch {
    config = { error: "config JSON invalide" };
  }
  return { ...row, enabled: Boolean(row.enabled), config };
});

const report = {
  generatedAt: new Date().toISOString(),
  database: dbPath,
  mode,
  minSample,
  overall: { ...metrics(), maxDrawdown: maxDrawdown() },
  groups: [
    grouped(presetExpression, "Presets"),
    grouped("symbol", "Symboles"),
    grouped(confidenceExpression, "Confiance"),
    grouped("tf_agreement", "Accord TF"),
    grouped("strftime('%H', datetime(time / 1000, 'unixepoch'))", "Heures UTC"),
  ],
  configs,
};

function money(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} $`;
}
function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
function pf(value) {
  return value === null ? "∞" : value.toFixed(2);
}
function printMetricRow(row) {
  return `| ${row.segment} | ${row.trades} | ${percent(row.winRate)} | ${money(row.pnl)} | ${money(row.expectancy)} | ${pf(row.profitFactor)} | ${row.reliable ? "oui" : "exploratoire"} |`;
}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const total = report.overall;
  console.log(`# Audit trading production — ${mode}`);
  console.log(`\nGénéré: ${report.generatedAt}`);
  console.log(`\n## Global`);
  console.log(`\n- Trades fermés: ${total.trades}`);
  console.log(`- Win rate: ${percent(total.winRate)} (rentabilité requise: ${percent(total.breakEvenWinRate)})`);
  console.log(`- P&L: ${money(total.pnl)}`);
  console.log(`- Espérance/trade: ${money(total.expectancy)}`);
  console.log(`- Profit factor: ${pf(total.profitFactor)}`);
  console.log(`- Gain moyen: ${money(total.avgWin)}; perte moyenne: -${total.avgLoss.toFixed(2)} $`);
  console.log(`- Drawdown maximal: ${total.maxDrawdown.toFixed(2)} $`);

  for (const group of report.groups) {
    console.log(`\n## ${group.label}\n`);
    console.log("| Segment | Trades | Win rate | P&L | EV/trade | PF | Échantillon |");
    console.log("|---|---:|---:|---:|---:|---:|---|");
    for (const row of group.rows) console.log(printMetricRow(row));
  }

  console.log("\n## Configurations sauvegardées\n");
  for (const row of configs) {
    console.log(`- ${row.username} / ${row.preset}: ${row.enabled ? "actif" : "arrêté"} — ${JSON.stringify(row.config)}`);
  }
}

db.close();
