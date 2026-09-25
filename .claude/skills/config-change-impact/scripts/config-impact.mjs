#!/usr/bin/env node
// Reads config_changes (see logConfigChange in src/lib/bot-engine.server.ts,
// 2026-08-02) and, for each logged edit, compares the N closed trades right
// before it to the N closed trades right after it. Read-only — never writes
// to the database.
import Database from "better-sqlite3";

const args = process.argv.slice(2);
const dbPath = args.find((arg) => !arg.startsWith("--"));
const usernameFilter = args.find((arg) => arg.startsWith("--user="))?.split("=")[1];
const presetFilter = args.find((arg) => arg.startsWith("--preset="))?.split("=")[1];
const windowSize = Number(args.find((arg) => arg.startsWith("--window="))?.split("=")[1] ?? 20);
const minSample = Number(args.find((arg) => arg.startsWith("--min-sample="))?.split("=")[1] ?? 10);
const jsonOutput = args.includes("--json");

if (!dbPath) {
  console.error("Usage: config-impact.mjs DB_PATH [--user=username] [--preset=default|boom|crash] [--window=20] [--min-sample=10] [--json]");
  process.exit(1);
}
if (presetFilter && !["default", "boom", "crash"].includes(presetFilter)) {
  console.error("--preset doit être default, boom ou crash");
  process.exit(1);
}
if (!Number.isInteger(windowSize) || windowSize < 1) {
  console.error("--window doit être un entier positif");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// Same symbol classification as presetSymbolFilter() in bot-engine.server.ts
// — duplicated rather than imported, same reasoning as the other standalone
// audit scripts in this repo (self-contained, no app-code dependency).
const BOOM_SYMS = ["BOOM1000", "BOOM500", "BOOM900"];
const CRASH_SYMS = ["CRASH1000", "CRASH500", "CRASH600", "CRASH900"];
function presetOf(symbol) {
  if (BOOM_SYMS.includes(symbol)) return "boom";
  if (CRASH_SYMS.includes(symbol)) return "crash";
  return "default";
}

function summarize(trades) {
  const closed = trades.filter((t) => t.status === "won" || t.status === "lost");
  const wins = closed.filter((t) => t.status === "won");
  const losses = closed.filter((t) => t.status === "lost");
  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const netPnl = closed.reduce((s, t) => s + t.profit, 0);
  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length : 0,
    netPnl,
    expectancy: closed.length ? netPnl / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? null : 0,
  };
}

let changeRows = db.prepare(`
  SELECT cc.id, cc.user_id, cc.preset, cc.changed_at, cc.changed_by, cc.fields, cc.source, u.username
  FROM config_changes cc
  JOIN users u ON u.id = cc.user_id
  ORDER BY cc.user_id, cc.preset, cc.changed_at ASC
`).all();

if (usernameFilter) changeRows = changeRows.filter((c) => c.username.toLowerCase() === usernameFilter.toLowerCase());
if (presetFilter) changeRows = changeRows.filter((c) => c.preset === presetFilter);

if (changeRows.length === 0) {
  console.error("Aucun changement de configuration trouvé pour ces filtres.");
  db.close();
  process.exit(0);
}

const usersById = new Map(
  db.prepare("SELECT id, username FROM users").all().map((u) => [u.id, u.username]),
);

// Fetch each (user, preset) pair's closed trades once, sorted — cheaper than
// one query per change when a user has many edits on the same preset.
const tradesCache = new Map();
function tradesFor(userId, preset) {
  const key = `${userId}:${preset}`;
  if (tradesCache.has(key)) return tradesCache.get(key);
  const all = db.prepare(`
    SELECT time, symbol, status, profit FROM bot_trades
    WHERE user_id = ? AND status IN ('won','lost')
    ORDER BY time ASC
  `).all(userId).filter((t) => presetOf(t.symbol) === preset);
  tradesCache.set(key, all);
  return all;
}

const results = changeRows.map((c) => {
  const trades = tradesFor(c.user_id, c.preset);
  const before = trades.filter((t) => t.time < c.changed_at).slice(-windowSize);
  const after = trades.filter((t) => t.time >= c.changed_at).slice(0, windowSize);
  const beforeSummary = before.length > 0 ? summarize(before) : null;
  const afterSummary = after.length > 0 ? summarize(after) : null;

  let verdict = "échantillon insuffisant";
  if (beforeSummary && afterSummary && before.length >= minSample && after.length >= minSample) {
    // Never conclude from win rate alone — expectancy is the number that
    // actually says whether the edit made money, same rule as
    // audit-trading-production.
    const expectancyDelta = afterSummary.expectancy - beforeSummary.expectancy;
    const pfBefore = beforeSummary.profitFactor ?? Infinity;
    const pfAfter = afterSummary.profitFactor ?? Infinity;
    if (expectancyDelta > 0.01 && pfAfter >= pfBefore) verdict = "amélioration";
    else if (expectancyDelta < -0.01 && pfAfter <= pfBefore) verdict = "dégradation";
    else verdict = "neutre";
  }

  return {
    id: c.id,
    username: c.username,
    preset: c.preset,
    changedAt: new Date(c.changed_at).toISOString(),
    changedBy: c.source === "auto-rollback" ? "rollback automatique" : c.changed_by !== null ? (usersById.get(c.changed_by) ?? `user#${c.changed_by}`) : "compte lui-même",
    source: c.source,
    fields: JSON.parse(c.fields),
    before: beforeSummary,
    beforeSampleSize: before.length,
    after: afterSummary,
    afterSampleSize: after.length,
    verdict,
  };
});

function money(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)} $`; }
function percent(v) { return `${(v * 100).toFixed(1)}%`; }
function pf(v) { return v === null ? "∞" : v.toFixed(2); }

if (jsonOutput) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), windowSize, minSample, changes: results }, null, 2));
} else {
  console.log(`# Impact des changements de config — fenêtre ${windowSize} trades, échantillon min ${minSample}`);
  for (const r of results) {
    console.log(`\n## ${r.username} / ${r.preset} — ${r.changedAt} (par ${r.changedBy})`);
    for (const [field, { from, to }] of Object.entries(r.fields)) {
      console.log(`- ${field}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
    }
    console.log(`\n| | Trades | Win rate | P&L | Espérance | PF |`);
    console.log(`|---|---:|---:|---:|---:|---:|`);
    const row = (label, s, n) => s
      ? `| ${label} (${n}) | ${s.trades} | ${percent(s.winRate)} | ${money(s.netPnl)} | ${money(s.expectancy)} | ${pf(s.profitFactor)} |`
      : `| ${label} (${n}) | — aucun trade clôturé — |`;
    console.log(row("Avant", r.before, r.beforeSampleSize));
    console.log(row("Après", r.after, r.afterSampleSize));
    console.log(`\n**Verdict : ${r.verdict}**`);
  }
}

db.close();
