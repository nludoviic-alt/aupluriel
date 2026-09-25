import Database from "better-sqlite3";

const db = new Database("lio23.db", { readonly: true });

function calcMetrics(trades) {
  const total = trades.length;
  if (total === 0) {
    return { trades: 0, wins: 0, losses: 0, winRate: 0, pnl: 0, expectancy: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, maxDrawdown: 0 };
  }
  const won = trades.filter(t => t.status === "won");
  const lost = trades.filter(t => t.status === "lost");
  const grossWin = won.reduce((sum, t) => sum + (t.profit || 0), 0);
  const grossLoss = lost.reduce((sum, t) => sum + Math.abs(t.profit || 0), 0);
  const pnl = trades.reduce((sum, t) => sum + (t.profit || 0), 0);
  const avgWin = won.length > 0 ? grossWin / won.length : 0;
  const avgLoss = lost.length > 0 ? grossLoss / lost.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;
  const winRate = (won.length / total) * 100;
  const expectancy = pnl / total;

  const sorted = [...trades].sort((a, b) => (a.closed_at || a.time) - (b.closed_at || b.time));
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const t of sorted) {
    cumulative += t.profit;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }

  return {
    trades: total,
    wins: won.length,
    losses: lost.length,
    winRate: Number(winRate.toFixed(1)),
    pnl: Number(pnl.toFixed(2)),
    expectancy: Number(expectancy.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    maxDrawdown: Number(drawdown.toFixed(2)),
  };
}

const allTrades = db.prepare(`
  SELECT *,
    date(datetime(time/1000, 'unixepoch', 'localtime')) as local_date,
    datetime(time/1000, 'unixepoch', 'localtime') as local_datetime,
    strftime('%H', datetime(time / 1000, 'unixepoch', 'localtime')) as local_hour
  FROM bot_trades
  WHERE status IN ('won', 'lost')
`).all();

const yesterdayTrades = allTrades.filter(t => t.local_date === "2026-08-10");
const todayTrades = allTrades.filter(t => t.local_date === "2026-08-11");
const periodTrades = allTrades.filter(t => ["2026-08-10", "2026-08-11"].includes(t.local_date));

function getPreset(t) {
  if (t.preset) return t.preset;
  if (t.symbol.startsWith("BOOM")) return "boom";
  if (t.symbol.startsWith("CRASH")) return "crash";
  return "multi";
}

function getConfBucket(t) {
  const c = t.confidence;
  if (c < 60) return "<60";
  if (c < 70) return "60-69";
  if (c < 80) return "70-79";
  if (c < 90) return "80-89";
  return "90-100";
}

function printTable(title, trades, keyFn) {
  console.log(`\n=== ${title} ===`);
  const groups = {};
  for (const t of trades) {
    const k = keyFn(t);
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  }
  console.log("Segment | Trades | WinRate % | PnL $ | EV $ | PF | GainMoy $ | PerteMoy $ | MaxDD $");
  const keys = Object.keys(groups).sort();
  for (const k of keys) {
    const m = calcMetrics(groups[k]);
    console.log(`${k} | ${m.trades} | ${m.winRate}% | ${m.pnl}$ | ${m.expectancy}$ | ${m.profitFactor} | +${m.avgWin}$ | -${m.avgLoss}$ | ${m.maxDrawdown}$`);
  }
}

console.log("# AUDIT HIER (2026-08-10) ET AUJOURD'HUI (2026-08-11)");
console.log("\n## GLOBAL HIER (2026-08-10)");
console.log(JSON.stringify(calcMetrics(yesterdayTrades), null, 2));

console.log("\n## GLOBAL AUJOURD'HUI (2026-08-11)");
console.log(JSON.stringify(calcMetrics(todayTrades), null, 2));

console.log("\n## GLOBAL 2 JOURS CUMULÉ");
console.log(JSON.stringify(calcMetrics(periodTrades), null, 2));

printTable("HIER PAR PRESET", yesterdayTrades, getPreset);
printTable("AUJOURD'HUI PAR PRESET", todayTrades, getPreset);

printTable("2 JOURS PAR SYMBOLE", periodTrades, t => t.symbol);
printTable("2 JOURS PAR CONFIANCE", periodTrades, getConfBucket);
printTable("2 JOURS PAR ACCORD TF", periodTrades, t => `TF_${t.tf_agreement ?? 'N/A'}`);
printTable("HIER PAR HEURE LOCAL", yesterdayTrades, t => `${t.local_hour}h`);
printTable("AUJOURD'HUI PAR HEURE LOCAL", todayTrades, t => `${t.local_hour}h`);

console.log("\n=== DERNIERS CHANGEMENTS DE CONFIGURATION ===");
try {
  const cfgs = db.prepare("SELECT *, datetime(changed_at/1000, 'unixepoch', 'localtime') as dt FROM config_changes ORDER BY changed_at DESC LIMIT 10").all();
  for (const c of cfgs) {
    console.log(`[${c.dt}] Preset: ${c.preset} | Modifié par: ${c.source} | Details: ${c.fields}`);
  }
} catch (e) {
  console.log("Erreur lecture config_changes:", e.message);
}

console.log("\n=== ÉTAT ACTUEL DE BOT_STATE ===");
try {
  const states = db.prepare("SELECT u.username, bs.preset, bs.enabled, bs.paused_until, bs.config FROM bot_state bs JOIN users u ON u.id = bs.user_id").all();
  for (const s of states) {
    console.log(`${s.username} / ${s.preset} -> ${s.enabled ? 'ACTIF' : 'PAUSÉ/INACTIF'} (PausedUntil: ${s.paused_until || 'non'})`);
  }
} catch (e) {
  console.log("Erreur lecture bot_state:", e.message);
}

db.close();
