// Compares the 3-4 GENUINELY DIFFERENT signal engines this codebase already
// has (confluence, liquidity-sweep/SMC, price-action scalping, Spike Hunter)
// against each other on the same symbol/window — not parameter variants of
// one engine, actual different logic. See SKILL.md for the decision rules.
//
// Two tracks, reported SEPARATELY (different units, never merge them):
//   Track A (--market=gold)       fixed-expiry binary, edge in percentage points
//   Track B (--market=synthetics) Multiplier, path-dependent, $ P&L at a stake/leverage
//
// Usage (from repo root):
//   npx tsx .claude/skills/strategy-tournament/scripts/tournament.ts --market=gold [--symbols=frxXAUUSD] [--candles=300] [--duration=15] [--quick]
//   npx tsx .claude/skills/strategy-tournament/scripts/tournament.ts --market=synthetics [--symbols=BOOM500,CRASH900,BOOM1000,CRASH1000] [--candles=250] [--hold=60] [--stake=5] [--leverage=20] [--quick]

import { closePublicSocket } from "../../../../src/lib/deriv.server";
import { backtestMultiTfServer, backtestLiquidityReversalServer, backtestScalpingBinaryServer } from "../../../../src/lib/backtest.server";
import { fetchAndAnalyzeSymbol, simulateCombo, defaultSweepGrid, type SweepCombo } from "../../../../src/lib/boom-sweep.server";
import { fetchAndAnalyzeSymbolLiquidity, fetchAndAnalyzeSymbolSpikeHunter, fetchAndAnalyzeSymbolScalping, simulateComboStructural } from "../../../../src/lib/strategy-sweep.server";

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split("=")[1] : fallback;
  };
  const market = get("market", "");
  if (market !== "gold" && market !== "synthetics") {
    console.error("Usage: tournament.ts --market=gold|synthetics [options]");
    process.exit(1);
  }
  const quick = argv.includes("--quick");
  const defaultSymbols = market === "gold" ? "frxXAUUSD" : "BOOM500,CRASH900,BOOM1000,CRASH1000";
  return {
    market: market as "gold" | "synthetics",
    quick,
    symbols: get("symbols", defaultSymbols).split(",").map((s) => s.trim()).filter(Boolean),
    candles: Number(get("candles", market === "gold" ? "300" : "250")),
    durationMinutes: Number(get("duration", "15")),
    holdMinutes: Number(get("hold", "60")),
    stake: Number(get("stake", "5")),
    leverage: Number(get("leverage", "20")),
    payout: Number(get("payout", "0.85")),
  };
}

function pad(v: string | number, n: number) { return String(v).padStart(n); }

async function runGold(args: ReturnType<typeof parseArgs>) {
  const breakEvenPct = (1 / (1 + args.payout)) * 100;
  const confCombos: { minConfidence: number; minTfAgreement: number }[] = args.quick
    ? [{ minConfidence: 70, minTfAgreement: 3 }, { minConfidence: 70, minTfAgreement: 4 }]
    : [{ minConfidence: 65, minTfAgreement: 3 }, { minConfidence: 70, minTfAgreement: 3 }, { minConfidence: 70, minTfAgreement: 4 }, { minConfidence: 75, minTfAgreement: 4 }];

  console.log(`=== Track A (fixed-expiry binary) — ${args.symbols.join(",")} — ${args.candles} candles, ${args.durationMinutes}min expiry ===\n`);

  const rows: { engine: string; trades: number; wins: number; winRate: number }[] = [];

  for (const symbol of args.symbols) {
    let bestConfluence = { trades: 0, wins: 0, winRate: 0 };
    for (const combo of confCombos) {
      const r = await backtestMultiTfServer(symbol, { ...combo, durationMinutes: args.durationMinutes, testCandles: args.candles });
      process.stderr.write(".");
      if (r.trades > 0 && r.winRate > bestConfluence.winRate) bestConfluence = { trades: r.trades, wins: r.wins, winRate: r.winRate * 100 };
      else if (r.trades > 0 && bestConfluence.trades === 0) bestConfluence = { trades: r.trades, wins: r.wins, winRate: r.winRate * 100 };
    }
    rows.push({ engine: `confluence (${symbol})`, ...bestConfluence });

    const liq = await backtestLiquidityReversalServer(symbol, { durationMinutes: args.durationMinutes, testCandles: args.candles });
    process.stderr.write(".");
    rows.push({ engine: `liquidity-sweep (${symbol})`, trades: liq.trades, wins: liq.wins, winRate: liq.winRate * 100 });

    const scalp = await backtestScalpingBinaryServer(symbol, { durationMinutes: args.durationMinutes, testCandles: args.candles });
    process.stderr.write(".");
    rows.push({ engine: `scalping-direction-only (${symbol})`, trades: scalp.trades, wins: scalp.wins, winRate: scalp.winRate * 100 });
  }
  process.stderr.write("\n\n");

  rows.sort((a, b) => (b.winRate - breakEvenPct) - (a.winRate - breakEvenPct));
  console.log("Engine                              | Trades  WinRate  Breakeven  Edge(pp)");
  for (const r of rows) {
    const edge = r.trades > 0 ? r.winRate - breakEvenPct : null;
    console.log(
      `${r.engine.padEnd(36)} | ${pad(r.trades, 6)}  ${r.trades > 0 ? r.winRate.toFixed(1).padStart(6) + "%" : "   n/a"}  ${breakEvenPct.toFixed(1).padStart(8)}%  ${edge === null ? "   n/a" : (edge >= 0 ? "+" : "") + edge.toFixed(1).padStart(6)}`,
    );
  }
  console.log(`\nFlat $${args.payout} payout assumption — treat edge (pp) as the primary signal, not a $ total. "scalping-direction-only" ignores its own structural stop/target (only its CALL/PUT direction is judged at fixed expiry) — not a measure of scalping's real edge, only whether its directional call has merit on this instrument. 0 trades means no combo tested ever qualified, not "ran and found nothing" — check the underlying data window before concluding no edge.`);
}

async function runSynthetics(args: ReturnType<typeof parseArgs>) {
  console.log(`=== Track B (Multiplier, path-dependent) — ${args.symbols.join(",")} — ${args.candles} candles, ${args.holdMinutes}min max hold, $${args.stake} stake, ${args.leverage}x ===\n`);

  const grid = defaultSweepGrid(args.quick);
  const scalpConfCombos = args.quick ? [0, 75] : [0, 60, 75, 85];

  type EngineResult = { engine: string; bestPnl: number; trades: number; winRate: number; perSymbol: { symbol: string; trades: number; pnl: number }[] };
  const results: EngineResult[] = [];

  // Confluence — reuses boom-sweep.server.ts unchanged (already-verified engine).
  {
    const perSymbol: { symbol: string; trades: number; pnl: number; winRate: number }[] = [];
    let best = { pnl: -Infinity, trades: 0, winRate: 0 };
    for (const combo of grid) {
      let pnl = 0, trades = 0, wins = 0;
      for (const symbol of args.symbols) {
        const { entries, c5m } = await fetchAndAnalyzeSymbol(symbol, args.candles, args.holdMinutes);
        const r = simulateCombo(entries, c5m, combo, args.stake, args.leverage, args.holdMinutes);
        pnl += r.totalPnlUsd; trades += r.trades; wins += r.wins;
      }
      process.stderr.write(".");
      if (pnl > best.pnl) best = { pnl, trades, winRate: trades ? (wins / trades) * 100 : 0 };
    }
    for (const symbol of args.symbols) {
      const { entries, c5m } = await fetchAndAnalyzeSymbol(symbol, args.candles, args.holdMinutes);
      const r = simulateCombo(entries, c5m, grid[0], args.stake, args.leverage, args.holdMinutes);
      perSymbol.push({ symbol, trades: entries.length, pnl: r.totalPnlUsd, winRate: r.winRate });
    }
    results.push({ engine: "confluence", bestPnl: Math.round(best.pnl * 100) / 100, trades: best.trades, winRate: best.winRate, perSymbol });
  }

  // Liquidity-sweep — new fetch fn, existing simulateCombo (same %-of-stake shape live).
  {
    let best = { pnl: -Infinity, trades: 0, winRate: 0 };
    const perSymbol: { symbol: string; trades: number; pnl: number }[] = [];
    const bySymbol = new Map<string, Awaited<ReturnType<typeof fetchAndAnalyzeSymbolLiquidity>>>();
    for (const symbol of args.symbols) bySymbol.set(symbol, await fetchAndAnalyzeSymbolLiquidity(symbol, args.candles, args.holdMinutes));
    for (const combo of grid) {
      let pnl = 0, trades = 0, wins = 0;
      for (const symbol of args.symbols) {
        const { entries, c5m } = bySymbol.get(symbol)!;
        const r = simulateCombo(entries, c5m, combo, args.stake, args.leverage, args.holdMinutes);
        pnl += r.totalPnlUsd; trades += r.trades; wins += r.wins;
      }
      process.stderr.write(".");
      if (pnl > best.pnl) best = { pnl, trades, winRate: trades ? (wins / trades) * 100 : 0 };
    }
    for (const symbol of args.symbols) {
      const { entries } = bySymbol.get(symbol)!;
      perSymbol.push({ symbol, trades: entries.length, pnl: 0 });
    }
    results.push({ engine: "liquidity-sweep", bestPnl: Math.round(best.pnl * 100) / 100, trades: best.trades, winRate: best.winRate, perSymbol });
  }

  // Spike Hunter — standalone, NOT its live fallback-only role (see SKILL.md caveat).
  {
    let best = { pnl: -Infinity, trades: 0, winRate: 0 };
    const perSymbol: { symbol: string; trades: number; pnl: number }[] = [];
    const bySymbol = new Map<string, Awaited<ReturnType<typeof fetchAndAnalyzeSymbolSpikeHunter>>>();
    for (const symbol of args.symbols) bySymbol.set(symbol, await fetchAndAnalyzeSymbolSpikeHunter(symbol, args.candles, args.holdMinutes));
    for (const combo of grid) {
      let pnl = 0, trades = 0, wins = 0;
      for (const symbol of args.symbols) {
        const { entries, c5m } = bySymbol.get(symbol)!;
        const r = simulateCombo(entries, c5m, combo, args.stake, args.leverage, args.holdMinutes);
        pnl += r.totalPnlUsd; trades += r.trades; wins += r.wins;
      }
      process.stderr.write(".");
      if (pnl > best.pnl) best = { pnl, trades, winRate: trades ? (wins / trades) * 100 : 0 };
    }
    for (const symbol of args.symbols) {
      const { entries } = bySymbol.get(symbol)!;
      perSymbol.push({ symbol, trades: entries.length, pnl: 0 });
    }
    results.push({ engine: "spike-hunter (standalone)", bestPnl: Math.round(best.pnl * 100) / 100, trades: best.trades, winRate: best.winRate, perSymbol });
  }

  // Scalping — own structural stop/target, RR_TARGET-fixed breakeven, confidence-only sweep.
  {
    let best = { pnl: -Infinity, trades: 0, winRate: 0 };
    const perSymbol: { symbol: string; trades: number; pnl: number }[] = [];
    const bySymbol = new Map<string, Awaited<ReturnType<typeof fetchAndAnalyzeSymbolScalping>>>();
    for (const symbol of args.symbols) bySymbol.set(symbol, await fetchAndAnalyzeSymbolScalping(symbol, args.candles, args.holdMinutes));
    for (const minConfidence of scalpConfCombos) {
      let pnl = 0, trades = 0, wins = 0;
      for (const symbol of args.symbols) {
        const { entries, c1m } = bySymbol.get(symbol)!;
        const r = simulateComboStructural(entries, c1m, args.stake, args.leverage, args.holdMinutes, minConfidence);
        pnl += r.totalPnlUsd; trades += r.trades; wins += r.wins;
      }
      process.stderr.write(".");
      if (pnl > best.pnl) best = { pnl, trades, winRate: trades ? (wins / trades) * 100 : 0 };
    }
    for (const symbol of args.symbols) {
      const { entries } = bySymbol.get(symbol)!;
      perSymbol.push({ symbol, trades: entries.length, pnl: 0 });
    }
    results.push({ engine: "scalping (structural)", bestPnl: Math.round(best.pnl * 100) / 100, trades: best.trades, winRate: best.winRate, perSymbol });
  }
  process.stderr.write("\n\n");

  results.sort((a, b) => b.bestPnl - a.bestPnl);
  console.log("=== Engines ranked by best-combo total $ P&L across all symbols ===");
  console.log("Engine                     | Trades  WinRate  BestComboPnL($)");
  for (const r of results) {
    console.log(`${r.engine.padEnd(26)} | ${pad(r.trades, 6)}  ${r.trades > 0 ? r.winRate.toFixed(1).padStart(6) + "%" : "   n/a"}  ${r.bestPnl >= 0 ? "+" : ""}$${r.bestPnl}`);
  }
  console.log("\nSignal counts by symbol (raw setups found, before any confidence/TF filter):");
  for (const r of results) {
    console.log(`  ${r.engine}: ${r.perSymbol.map((s) => `${s.symbol}=${s.trades}`).join(", ")}`);
  }
  console.log(`\n$P&L assumes $${args.stake} stake at ${args.leverage}x leverage, ${args.holdMinutes}min max hold — same assumptions across all 4 engines so this ranking is apples-to-apples. spike-hunter's number is its STANDALONE edge if it traded every qualifying setup, not its live contribution (live it only fires as a fallback when confluence confidence<75 on Boom/Crash). Treat any engine under ~30 trades as exploratory only.`);
}

async function main() {
  const args = parseArgs();
  if (args.market === "gold") await runGold(args);
  else await runSynthetics(args);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => {
    closePublicSocket();
    process.exit(process.exitCode ?? 0);
  });
