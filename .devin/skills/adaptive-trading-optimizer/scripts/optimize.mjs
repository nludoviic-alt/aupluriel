#!/usr/bin/env node
/**
 * Adaptive Trading Optimizer — Le cerveau qui apprend et s'optimise.
 *
 * 7 phases:
 *  1. Collecte exhaustive des données
 *  2. Classification des erreurs (cause racine par trade perdant)
 *  3. Découverte de patterns gagnants (mining)
 *  4. Optimisation des paramètres (sweep)
 *  5. Génération de stratégies
 *  6. Auto-ajustement sécurisé (si --apply)
 *  7. Documentation persistante (journal)
 */
import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dbPath = args.find((a) => !a.startsWith("--"));
const userId = args.find((a) => a.startsWith("--user-id="))?.split("=")[1];
const presetFilter = args.find((a) => a.startsWith("--preset="))?.split("=")[1];
const targetWinRate = Number(args.find((a) => a.startsWith("--target-winrate="))?.split("=")[1] ?? 0.90);
const apply = args.includes("--apply");
const auto = args.includes("--auto");
const jsonOut = args.includes("--json");

if (!dbPath) { console.error("Usage: optimize.mjs DB_PATH [--user-id=N] [--preset=X] [--target-winrate=0.9] [--apply] [--auto] [--json]"); process.exit(1); }

const db = new Database(dbPath, { readonly: !apply, fileMustExist: true });
const userF = userId ? `AND user_id = ${Number(userId)}` : "";
const presetF = presetFilter ? `AND COALESCE(preset, CASE WHEN symbol LIKE 'BOOM%' THEN 'boom' WHEN symbol LIKE 'CRASH%' THEN 'crash' ELSE 'default' END) = '${presetFilter}'` : "";

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1: COLLECTE EXHAUSTIVE
// ═══════════════════════════════════════════════════════════════════════

const allTrades = db.prepare(`
  SELECT id, user_id, time, symbol, direction, stake, payout, status, profit,
    confidence, tf_agreement, contract_id, closed_at, note, entry_price,
    duration_minutes, multiplier, stop_loss, take_profit, mode, preset
  FROM bot_trades
  WHERE status IN ('won','lost') ${userF} ${presetF}
  ORDER BY COALESCE(closed_at, time), time
`).all();

const configs = db.prepare(`
  SELECT bs.user_id, bs.preset, bs.config, bs.enabled, u.username
  FROM bot_state bs JOIN users u ON u.id = bs.user_id
  WHERE 1=1 ${userId ? `AND bs.user_id = ${Number(userId)}` : ""} ${presetFilter ? `AND bs.preset = '${presetFilter}'` : ""}
`).all().map(r => {
  let cfg; try { cfg = JSON.parse(r.config); } catch { cfg = {}; }
  return { ...r, config: cfg };
});

const configChanges = db.prepare(`
  SELECT cc.*, u.username FROM config_changes cc
  JOIN users u ON u.id = cc.user_id
  WHERE 1=1 ${userId ? `AND cc.user_id = ${Number(userId)}` : ""}
  ORDER BY cc.changed_at DESC LIMIT 20
`).all().map(c => ({ ...c, fields: JSON.parse(c.fields) }));

const backtestState = db.prepare(`SELECT * FROM auto_backtest_state WHERE id = 1`).get();

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function calcMetrics(trades) {
  if (!trades.length) return { trades: 0, wins: 0, losses: 0, winRate: 0, pnl: 0, expectancy: 0, profitFactor: 0, avgWin: 0, avgLoss: 0 };
  const wins = trades.filter(t => t.status === "won");
  const losses = trades.filter(t => t.status === "lost");
  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const pnl = grossWin - grossLoss;
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: wins.length / trades.length,
    pnl,
    expectancy: pnl / trades.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length > 0 ? null : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
  };
}

function presetOf(t) {
  return t.preset || (t.symbol?.startsWith("BOOM") ? "boom" : t.symbol?.startsWith("CRASH") ? "crash" : "default");
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2: CLASSIFICATION DES ERREURS
// ═══════════════════════════════════════════════════════════════════════

// Pre-compute per-symbol, per-hour, per-confidence stats
function groupStats(keyFn) {
  const groups = {};
  for (const t of allTrades) {
    const k = keyFn(t);
    if (!groups[k]) groups[k] = [];
    groups[k].push(t);
  }
  return Object.entries(groups).map(([key, trades]) => ({ key, ...calcMetrics(trades) })).sort((a, b) => a.pnl - b.pnl);
}

const symbolStats = groupStats(t => t.symbol);
const hourStats = groupStats(t => {
  const h = new Date(t.time).getUTCHours();
  return String(h).padStart(2, "0") + "h";
});
const confidenceStats = groupStats(t => {
  if (t.confidence < 70) return "<70";
  if (t.confidence < 80) return "70-79";
  if (t.confidence < 85) return "80-84";
  if (t.confidence < 90) return "85-89";
  return "90+";
});
const tfStats = groupStats(t => String(t.tf_agreement));
const presetStats = groupStats(t => presetOf(t));

// Bad symbols: win rate < 45% with 20+ trades
const badSymbols = symbolStats.filter(s => s.trades >= 20 && s.winRate < 0.45);
// Bad hours: P&L negative with 20+ trades
const badHours = hourStats.filter(h => h.trades >= 20 && h.pnl < 0);
// Bad confidence zones: P&L negative with 20+ trades
const badConfidence = confidenceStats.filter(c => c.trades >= 20 && c.pnl < 0);
// Bad TF agreement: win rate < 50% with 20+ trades
const badTf = tfStats.filter(t => t.trades >= 20 && t.winRate < 0.50);
// Bad presets: P&L negative with 50+ trades
const badPresets = presetStats.filter(p => p.trades >= 50 && p.pnl < 0);

// Classify each losing trade
const errorClassification = {};
for (const t of allTrades.filter(t => t.status === "lost")) {
  const causes = [];
  const sym = symbolStats.find(s => s.key === t.symbol);
  const hr = hourStats.find(h => h.key === String(new Date(t.time).getUTCHours()).padStart(2, "0") + "h");
  const conf = confidenceStats.find(c => {
    if (t.confidence < 70) return c.key === "<70";
    if (t.confidence < 80) return c.key === "70-79";
    if (t.confidence < 85) return c.key === "80-84";
    if (t.confidence < 90) return c.key === "85-89";
    return c.key === "90+";
  });
  const tf = tfStats.find(x => x.key === String(t.tf_agreement));

  if (sym && sym.trades >= 20 && sym.winRate < 0.45) causes.push("BAD_SYMBOL");
  if (hr && hr.trades >= 20 && hr.pnl < 0) causes.push("BAD_TIMING");
  if (conf && conf.trades >= 20 && conf.pnl < 0) causes.push("BAD_CONFIDENCE");
  if (tf && tf.trades >= 20 && tf.winRate < 0.50) causes.push("BAD_TF_AGREEMENT");
  if (t.stake > 20) causes.push("BAD_STAKE");
  const p = presetStats.find(x => x.key === presetOf(t));
  if (p && p.trades >= 50 && p.pnl < 0) causes.push("BAD_PRESET");
  if (causes.length === 0) causes.push("UNCLASSIFIED");

  for (const c of causes) {
    errorClassification[c] = (errorClassification[c] || 0) + 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3: DÉCOUVERTE DE PATTERNS GAGNANTS (ZONES D'OR)
// ═══════════════════════════════════════════════════════════════════════

// Mining: symbol × hour × confidence bucket combinations
const patterns = {};
for (const t of allTrades) {
  const sym = t.symbol;
  const hr = String(new Date(t.time).getUTCHours()).padStart(2, "0") + "h";
  const confBucket = t.confidence < 80 ? "70-79" : t.confidence < 85 ? "80-84" : t.confidence < 90 ? "85-89" : "90+";
  const preset = presetOf(t);
  const key = `${preset} | ${sym} | ${hr} | conf ${confBucket}`;
  if (!patterns[key]) patterns[key] = [];
  patterns[key].push(t);
}

const goldenZones = Object.entries(patterns)
  .map(([key, trades]) => ({ key, ...calcMetrics(trades) }))
  .filter(p => p.trades >= 10 && p.winRate >= 0.70 && p.pnl > 0)
  .sort((a, b) => b.winRate - a.winRate)
  .slice(0, 10);

// Best symbols overall
const bestSymbols = symbolStats.filter(s => s.trades >= 20 && s.winRate >= 0.65 && s.pnl > 0).sort((a, b) => b.winRate - a.winRate);
// Best hours
const bestHours = hourStats.filter(h => h.trades >= 20 && h.winRate >= 0.65 && h.pnl > 0).sort((a, b) => b.winRate - a.winRate);
// Best confidence zones
const bestConfidence = confidenceStats.filter(c => c.trades >= 20 && c.winRate >= 0.65 && c.pnl > 0).sort((a, b) => b.winRate - a.winRate);

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4: OPTIMISATION DES PARAMÈTRES (SWEEP)
// ═══════════════════════════════════════════════════════════════════════

// For each preset, simulate filtering trades by different parameter thresholds
// and find the combination that maximizes win rate while keeping P&L positive
const presets = [...new Set(allTrades.map(presetOf))];

const optimizationResults = {};

for (const preset of presets) {
  const presetTrades = allTrades.filter(t => presetOf(t) === preset);
  if (presetTrades.length < 30) {
    optimizationResults[preset] = { skipped: true, reason: `Échantillon insuffisant (${presetTrades.length} < 30)`, current: calcMetrics(presetTrades) };
    continue;
  }

  const current = calcMetrics(presetTrades);
  const currentConfig = configs.find(c => c.preset === preset)?.config || {};

  // Sweep: minConfidence
  const confidenceSweep = {};
  for (const minC of [70, 75, 80, 85, 90, 95]) {
    const filtered = presetTrades.filter(t => t.confidence >= minC);
    confidenceSweep[minC] = { ...calcMetrics(filtered), minConfidence: minC };
  }

  // Sweep: minTfAgreement
  const tfSweep = {};
  for (const minTf of [1, 2, 3, 4, 5, 6]) {
    const filtered = presetTrades.filter(t => t.tf_agreement >= minTf);
    tfSweep[minTf] = { ...calcMetrics(filtered), minTfAgreement: minTf };
  }

  // Sweep: symbol restriction (test each symbol alone)
  const symbolSweep = {};
  const symbolsInPreset = [...new Set(presetTrades.map(t => t.symbol))];
  for (const sym of symbolsInPreset) {
    const filtered = presetTrades.filter(t => t.symbol === sym);
    if (filtered.length >= 10) symbolSweep[sym] = { ...calcMetrics(filtered), symbol: sym };
  }

  // Sweep: hour restriction (best 4-hour window)
  const hourWindows = {};
  for (let start = 0; start < 24; start += 4) {
    const hours = [];
    for (let i = 0; i < 4; i++) hours.push((start + i) % 24);
    const filtered = presetTrades.filter(t => hours.includes(new Date(t.time).getUTCHours()));
    if (filtered.length >= 10) hourWindows[`${String(start).padStart(2,"0")}h-${String((start+3)%24).padStart(2,"0")}h`] = { ...calcMetrics(filtered), window: `${start}h-${(start+3)%24}h` };
  }

  // Find best combination: highest win rate with P&L > 0 and 30+ trades
  const allCombos = [];
  for (const [minC, cRes] of Object.entries(confidenceSweep)) {
    for (const [minTf, tfRes] of Object.entries(tfSweep)) {
      const filtered = presetTrades.filter(t => t.confidence >= Number(minC) && t.tf_agreement >= Number(minTf));
      if (filtered.length >= 20) {
        const m = calcMetrics(filtered);
        if (m.pnl > 0 && m.winRate > current.winRate) {
          allCombos.push({
            minConfidence: Number(minC),
            minTfAgreement: Number(minTf),
            ...m,
            improvement: m.winRate - current.winRate,
          });
        }
      }
    }
  }
  allCombos.sort((a, b) => b.winRate - a.winRate);
  const bestCombo = allCombos[0] || null;

  // Best symbol alone
  const bestSymbol = Object.values(symbolSweep).sort((a, b) => b.winRate - a.winRate)[0] || null;
  // Best hour window
  const bestWindow = Object.values(hourWindows).sort((a, b) => b.winRate - a.winRate)[0] || null;

  optimizationResults[preset] = {
    current,
    currentConfig: {
      minConfidence: currentConfig.minConfidence,
      minTfAgreement: currentConfig.minTfAgreement,
      symbols: currentConfig.symbols,
      stakeUsd: currentConfig.stakeUsd,
      stopLossPctOfStake: currentConfig.stopLossPctOfStake,
      takeProfitPctOfStake: currentConfig.takeProfitPctOfStake,
      multiplierLevel: currentConfig.multiplierLevel,
      durationMinutes: currentConfig.durationMinutes,
    },
    confidenceSweep,
    tfSweep,
    symbolSweep,
    hourWindows,
    bestCombo,
    bestSymbol,
    bestWindow,
    reliable: presetTrades.length >= 50,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 5: GÉNÉRATION DE STRATÉGIES
// ═══════════════════════════════════════════════════════════════════════

const strategies = {};
for (const [preset, opt] of Object.entries(optimizationResults)) {
  if (opt.skipped) { strategies[preset] = { skipped: true, reason: opt.reason }; continue; }

  const recommended = {
    minConfidence: opt.bestCombo?.minConfidence || opt.currentConfig.minConfidence,
    minTfAgreement: opt.bestCombo?.minTfAgreement || opt.currentConfig.minTfAgreement,
    symbols: opt.bestSymbol ? [opt.bestSymbol.symbol] : opt.currentConfig.symbols,
    stakeUsd: opt.currentConfig.stakeUsd, // don't change stake automatically
    stopLossPctOfStake: opt.currentConfig.stopLossPctOfStake,
    takeProfitPctOfStake: opt.currentConfig.takeProfitPctOfStake,
    multiplierLevel: opt.currentConfig.multiplierLevel,
    durationMinutes: opt.currentConfig.durationMinutes,
  };

  // Project: simulate with recommended params
  const projectedTrades = allTrades.filter(t =>
    presetOf(t) === preset &&
    t.confidence >= recommended.minConfidence &&
    t.tf_agreement >= recommended.minTfAgreement &&
    recommended.symbols.includes(t.symbol)
  );
  const projected = calcMetrics(projectedTrades);

  const changes = [];
  if (recommended.minConfidence !== opt.currentConfig.minConfidence)
    changes.push({ field: "minConfidence", from: opt.currentConfig.minConfidence, to: recommended.minConfidence });
  if (recommended.minTfAgreement !== opt.currentConfig.minTfAgreement)
    changes.push({ field: "minTfAgreement", from: opt.currentConfig.minTfAgreement, to: recommended.minTfAgreement });
  if (JSON.stringify(recommended.symbols) !== JSON.stringify(opt.currentConfig.symbols))
    changes.push({ field: "symbols", from: opt.currentConfig.symbols, to: recommended.symbols });

  strategies[preset] = {
    current: opt.current,
    recommended,
    projected,
    changes,
    deltaWinRate: projected.winRate - opt.current.winRate,
    deltaPnl: projected.pnl - opt.current.pnl,
    toward90: Math.max(0, targetWinRate - projected.winRate),
    sampleSize: projectedTrades.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 6: AUTO-AJUSTEMENT SÉCURISÉ
// ═══════════════════════════════════════════════════════════════════════

const appliedChanges = [];

if (apply && !jsonOut) {
  for (const [preset, strat] of Object.entries(strategies)) {
    if (strat.skipped) continue;
    if (strat.changes.length === 0) continue;
    if (strat.changes.length > 3) {
      console.log(`⚠️ ${preset}: ${strat.changes.length} changements proposés — limite de sécurité à 3, ignoré.`);
      continue;
    }
    if (strat.projected.winRate < 0.60) {
      console.log(`⚠️ ${preset}: win rate projeté ${(strat.projected.winRate * 100).toFixed(1)}% < 60% — pas appliqué.`);
      continue;
    }
    if (strat.projected.pnl < 0) {
      console.log(`⚠️ ${preset}: P&L projeté ${strat.projected.pnl.toFixed(2)}$ < 0 — pas appliqué.`);
      continue;
    }
    if (strat.sampleSize < 20) {
      console.log(`⚠️ ${preset}: échantillon projeté ${strat.sampleSize} < 20 — pas appliqué.`);
      continue;
    }

    // Find the bot_state row(s) to update
    const states = db.prepare(`SELECT user_id, preset, config FROM bot_state WHERE preset = ? ${userId ? `AND user_id = ${Number(userId)}` : ""}`).all(preset);
    for (const state of states) {
      let cfg;
      try { cfg = JSON.parse(state.config); } catch { cfg = {}; }

      // Apply changes
      for (const change of strat.changes) {
        cfg[change.field] = change.to;
      }

      if (!auto) {
        // In non-auto mode, we'd ask for confirmation — but since this is a script,
        // we just log what would be applied. The agent handles confirmation.
        console.log(`\n📋 ${preset} (user ${state.user_id}): ${strat.changes.length} changement(s) proposé(s):`);
        for (const c of strat.changes) {
          console.log(`   ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
        }
        console.log(`   Win rate: ${(strat.current.winRate * 100).toFixed(1)}% → ${(strat.projected.winRate * 100).toFixed(1)}%`);
        console.log(`   P&L: ${strat.current.pnl.toFixed(2)}$ → ${strat.projected.pnl.toFixed(2)}$`);
        // Don't apply in non-auto mode
        appliedChanges.push({ preset, userId: state.user_id, changes: strat.changes, applied: false });
      } else {
        // Auto mode: apply directly
        db.prepare(`UPDATE bot_state SET config = ?, updated_at = unixepoch() WHERE user_id = ? AND preset = ?`)
          .run(JSON.stringify(cfg), state.user_id, preset);

        // Log to config_changes
        const changeId = `opt_${Date.now()}_${preset}_${state.user_id}`;
        const fields = {};
        for (const c of strat.changes) fields[c.field] = { from: c.from, to: c.to };
        db.prepare(`INSERT INTO config_changes (id, user_id, preset, changed_at, changed_by, fields, source) VALUES (?, ?, ?, ?, ?, ?, 'optimizer')`)
          .run(changeId, state.user_id, preset, Date.now(), Number(userId) || null, JSON.stringify(fields));

        appliedChanges.push({ preset, userId: state.user_id, changes: strat.changes, applied: true, changeId });
        console.log(`✅ ${preset} (user ${state.user_id}): ${strat.changes.length} changement(s) appliqué(s)`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 7: DOCUMENTATION PERSISTANTE
// ═══════════════════════════════════════════════════════════════════════

const journalDir = join(__dirname, "..", "journal");
mkdirSync(journalDir, { recursive: true });
const now = new Date();
const journalFile = join(journalDir, `${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}.md`);

// Read previous journal for comparison
const prevJournals = existsSync(journalDir) ? readdirSync(journalDir).filter(f => f.endsWith(".md")).sort().slice(-1) : [];
let prevData = null;
if (prevJournals.length) {
  try { prevData = readFileSync(join(journalDir, prevJournals[0]), "utf8"); } catch {}
}

const overall = calcMetrics(allTrades);
const journalContent = `# Journal Adaptive Optimizer — ${now.toISOString()}

## État actuel

- **Trades analysés**: ${overall.trades} (${overall.wins}W / ${overall.losses}L)
- **Win rate global**: ${(overall.winRate * 100).toFixed(1)}%
- **P&L global**: ${overall.pnl.toFixed(2)}$
- **Espérance/trade**: ${overall.expectancy.toFixed(2)}$
- **Profit factor**: ${overall.profitFactor === null ? "∞" : overall.profitFactor.toFixed(2)}
- **Objectif win rate**: ${(targetWinRate * 100).toFixed(0)}%
- **Écart vs objectif**: ${((targetWinRate - overall.winRate) * 100).toFixed(1)}pp

## Top 5 causes d'erreurs

${Object.entries(errorClassification).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([cause, count]) => `- **${cause}**: ${count} trades perdants`).join("\n")}

## Zones d'or (win rate ≥ 70%, P&L > 0)

${goldenZones.slice(0, 5).map(z => `- ${z.key}: ${z.trades} trades, ${(z.winRate * 100).toFixed(1)}% WR, ${z.pnl.toFixed(2)}$`).join("\n") || "Aucune zone d'or trouvée"}

## Optimisation par preset

${Object.entries(optimizationResults).map(([preset, opt]) => {
  if (opt.skipped) return `### ${preset}\n⚠️ ${opt.reason}`;
  const s = strategies[preset];
  return `### ${preset}
- **Actuel**: ${opt.current.trades} trades, ${(opt.current.winRate * 100).toFixed(1)}% WR, ${opt.current.pnl.toFixed(2)}$
- **Projeté**: ${s.sampleSize} trades, ${(s.projected.winRate * 100).toFixed(1)}% WR, ${s.projected.pnl.toFixed(2)}$
- **Delta WR**: ${s.deltaWinRate >= 0 ? "+" : ""}${(s.deltaWinRate * 100).toFixed(1)}pp
- **Vers 90%**: il manque ${((targetWinRate - s.projected.winRate) * 100).toFixed(1)}pp
${s.changes.length ? `- **Changements proposés**:\n${s.changes.map(c => `  - ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join("\n")}` : "- Aucun changement proposé (déjà optimal ou échantillon insuffisant)"}`;
}).join("\n\n")}

## Changements appliqués

${appliedChanges.length ? appliedChanges.map(c => `- **${c.preset}** (user ${c.userId}): ${c.changes.map(ch => `${ch.field}: ${JSON.stringify(ch.from)}→${JSON.stringify(ch.to)}`).join(", ")} ${c.applied ? "✅ APPLIQUÉ" : "📋 PROPOSÉ"}`).join("\n") : "Aucun changement appliqué (mode lecture seule)"}

## Prochaine réévaluation

- Après **50 nouveaux trades** ou **7 jours**
- Comparer le win rate et le P&L avec cette baseline
- Si dégradation, rollback automatique recommandé

## Progression vs exécution précédente

${prevData ? "Voir le journal précédent pour comparaison." : "Première exécution — pas de comparaison disponible."}
`;

writeFileSync(journalFile, journalContent);

// ═══════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════

function money(v) { return `${v >= 0 ? "+" : ""}${v.toFixed(2)}$`; }
function pct(v) { return `${(v * 100).toFixed(1)}%`; }
function pf(v) { return v === null ? "∞" : v.toFixed(2); }

const report = {
  timestamp: now.toISOString(),
  targetWinRate,
  overall,
  errorClassification,
  goldenZones: goldenZones.slice(0, 10),
  bestSymbols: bestSymbols.slice(0, 5),
  bestHours: bestHours.slice(0, 5),
  bestConfidence: bestConfidence.slice(0, 3),
  badSymbols: badSymbols.map(s => ({ symbol: s.key, trades: s.trades, winRate: s.winRate, pnl: s.pnl })),
  badHours: badHours.map(h => ({ hour: h.key, trades: h.trades, pnl: h.pnl })),
  optimization: optimizationResults,
  strategies,
  appliedChanges,
  journalFile,
  progressionVs90: {
    currentWinRate: overall.winRate,
    target: targetWinRate,
    gap: Math.max(0, targetWinRate - overall.winRate),
    bestProjectedWinRate: Math.max(...Object.values(strategies).filter(s => !s.skipped).map(s => s.projected.winRate), 0),
  },
};

if (jsonOut) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`# Adaptive Trading Optimizer — ${now.toISOString().slice(0, 16)}`);
  console.log(`Objectif: ${(targetWinRate * 100).toFixed(0)}% win rate\n`);

  console.log(`## État global`);
  console.log(`- Trades: ${overall.trades} (${overall.wins}W / ${overall.losses}L)`);
  console.log(`- Win rate: ${pct(overall.winRate)} — objectif: ${pct(targetWinRate)} — écart: ${((targetWinRate - overall.winRate) * 100).toFixed(1)}pp`);
  console.log(`- P&L: ${money(overall.pnl)}`);
  console.log(`- Espérance/trade: ${money(overall.expectancy)}`);
  console.log(`- Profit factor: ${pf(overall.profitFactor)}`);

  console.log(`\n## Top 5 causes d'erreurs`);
  for (const [cause, count] of Object.entries(errorClassification).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    console.log(`- ${cause}: ${count} trades perdants`);
  }

  if (badSymbols.length) {
    console.log(`\n## ⛔ Symboles à suspendre (WR < 45%, 20+ trades)`);
    for (const s of badSymbols) console.log(`- ${s.key}: ${s.trades} trades, ${pct(s.winRate)} WR, ${money(s.pnl)}`);
  }

  if (badHours.length) {
    console.log(`\n## ⛔ Heures à désactiver (P&L négatif, 20+ trades)`);
    for (const h of badHours) console.log(`- ${h.key}: ${h.trades} trades, ${money(h.pnl)}`);
  }

  if (goldenZones.length) {
    console.log(`\n## 🌟 Zones d'or (WR ≥ 70%, P&L > 0, 10+ trades)`);
    for (const z of goldenZones.slice(0, 5)) {
      console.log(`- ${z.key}: ${z.trades} trades, ${pct(z.winRate)} WR, ${money(z.pnl)}`);
    }
  }

  if (bestSymbols.length) {
    console.log(`\n## ✅ Meilleurs symboles (WR ≥ 65%, P&L > 0)`);
    for (const s of bestSymbols.slice(0, 5)) console.log(`- ${s.key}: ${s.trades} trades, ${pct(s.winRate)} WR, ${money(s.pnl)}`);
  }

  console.log(`\n## Optimisation par preset`);
  for (const [preset, opt] of Object.entries(optimizationResults)) {
    if (opt.skipped) { console.log(`\n### ${preset}: ⚠️ ${opt.reason}`); continue; }
    const s = strategies[preset];
    console.log(`\n### ${preset} ${opt.reliable ? "" : "⚠️ (échantillon < 50)"}`);
    console.log(`  Actuel: ${opt.current.trades}T, ${pct(opt.current.winRate)} WR, ${money(opt.current.pnl)}`);
    console.log(`  Projeté: ${s.sampleSize}T, ${pct(s.projected.winRate)} WR, ${money(s.projected.pnl)}`);
    console.log(`  Delta: ${s.deltaWinRate >= 0 ? "+" : ""}${(s.deltaWinRate * 100).toFixed(1)}pp WR, ${money(s.deltaPnl)}`);
    console.log(`  Vers 90%: il manque ${((targetWinRate - s.projected.winRate) * 100).toFixed(1)}pp`);
    if (s.changes.length) {
      console.log(`  Changements proposés:`);
      for (const c of s.changes) console.log(`    - ${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
    } else {
      console.log(`  Aucun changement proposé (déjà optimal)`);
    }
  }

  if (appliedChanges.length) {
    console.log(`\n## Changements ${apply ? (auto ? "appliqués ✅" : "proposés 📋") : "proposés (lecture seule)"}`);
    for (const c of appliedChanges) {
      console.log(`- ${c.preset} (user ${c.userId}): ${c.changes.map(ch => `${ch.field}: ${JSON.stringify(ch.from)}→${JSON.stringify(ch.to)}`).join(", ")}`);
    }
  }

  console.log(`\n## Progression vers 90%`);
  console.log(`- Win rate actuel: ${pct(overall.winRate)}`);
  const bestProj = report.progressionVs90.bestProjectedWinRate;
  console.log(`- Meilleur win rate projeté: ${pct(bestProj)}`);
  console.log(`- Écart restant: ${((targetWinRate - bestProj) * 100).toFixed(1)}pp`);

  console.log(`\n## Journal persistant`);
  console.log(`📄 ${journalFile}`);

  console.log(`\n## Prochaine réévaluation`);
  console.log(`- Après 50 nouveaux trades ou 7 jours`);
  console.log(`- Comparer avec cette baseline`);
  if (!apply) console.log(`- Pour appliquer: ajouter --apply (avec --auto pour全自动)`);
}
