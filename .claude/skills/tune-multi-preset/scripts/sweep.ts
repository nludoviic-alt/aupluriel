// CLI wrapper around backtestMultiTfServer() in src/lib/backtest.server.ts —
// the SAME function the app's own scheduled auto-backtest job uses (see
// auto-backtest.server.ts), so results here match what the live scan
// pipeline would actually have done. Unlike tune-boom-preset's engine
// (sweepBoomPreset), this one fetches candles fresh on every call — there's
// no "fetch once, replay many combos" optimization here yet, so a sweep is
// slower than the Boom/Crash ones. Keep grids small; see SKILL.md.
//
// Usage (from repo root):
//   npx tsx .claude/skills/tune-multi-preset/scripts/sweep.ts [--quick] [--candles=150] [--symbols=frxEURUSD,frxGBPUSD] [--duration=15] [--stake=5] [--payout=0.85]

import { closePublicSocket } from "../../../../src/lib/deriv.server";
import { DEFAULT_CONFIG } from "../../../../src/lib/signal-core";
import { backtestMultiTfServer } from "../../../../src/lib/backtest.server";

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split("=")[1] : fallback;
  };
  const quick = argv.includes("--quick");
  return {
    quick,
    candles: Number(get("candles", "150")),
    symbols: get("symbols", DEFAULT_CONFIG.symbols.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
    durationMinutes: Number(get("duration", String(DEFAULT_CONFIG.durationMinutes))), // matches DEFAULT_CONFIG.durationMinutes
    stake: Number(get("stake", "5")),
    payout: Number(get("payout", "0.85")), // Deriv's typical binary CALL/PUT payout — real payout varies per quote
  };
}

interface Combo { minConfidence: number; minTfAgreement: number }

function combosFor(quick: boolean): Combo[] {
  if (quick) {
    return [
      { minConfidence: 70, minTfAgreement: 3 },
      { minConfidence: 70, minTfAgreement: 4 },
      { minConfidence: 75, minTfAgreement: 3 },
      { minConfidence: 75, minTfAgreement: 4 },
    ];
  }
  const combos: Combo[] = [];
  for (const minConfidence of [65, 70, 72, 75, 80]) {
    for (const minTfAgreement of [3, 4]) {
      combos.push({ minConfidence, minTfAgreement });
    }
  }
  return combos;
}

async function main() {
  const args = parseArgs();
  const combos = combosFor(args.quick);
  console.log(`${args.symbols.length} symbol(s) × ${combos.length} combo(s) — this engine fetches candles per call, so this is slower than tune-boom-preset/tune-crash-preset. Be patient.`);
  console.log(`symbols=${args.symbols.join(",")} candles=${args.candles} duration=${args.durationMinutes}min stake=$${args.stake} payout=${args.payout}\n`);

  const perCombo: { combo: Combo; trades: number; wins: number; losses: number; totalPnlUsd: number; perSymbol: { symbol: string; trades: number; winRate: number }[] }[] = [];

  for (const combo of combos) {
    let trades = 0, wins = 0, losses = 0;
    const perSymbol: { symbol: string; trades: number; winRate: number }[] = [];
    for (const symbol of args.symbols) {
      const r = await backtestMultiTfServer(symbol, {
        minConfidence: combo.minConfidence,
        minTfAgreement: combo.minTfAgreement,
        durationMinutes: args.durationMinutes,
        testCandles: args.candles,
      });
      trades += r.trades; wins += r.wins; losses += r.losses;
      perSymbol.push({ symbol, trades: r.trades, winRate: r.winRate * 100 });
    }
    const totalPnlUsd = Math.round((wins * args.stake * args.payout - losses * args.stake) * 100) / 100;
    perCombo.push({ combo, trades, wins, losses, totalPnlUsd, perSymbol });
    process.stderr.write(`.`); // progress dot — this can take a while
  }
  process.stderr.write("\n\n");

  const breakEvenWinRate = 1 / (1 + args.payout);
  const ranked = perCombo
    .map((c) => ({ ...c, winRate: c.trades ? (c.wins / c.trades) * 100 : 0 }))
    .sort((a, b) => b.totalPnlUsd - a.totalPnlUsd);

  console.log("=== Combos ranked by total $ P&L across all symbols ===");
  console.log("Conf  TF  | Trades  WinRate  Breakeven  Edge(pp)  TotalPnL($)");
  for (const a of ranked) {
    const edge = a.winRate - breakEvenWinRate * 100;
    console.log(
      `${String(a.combo.minConfidence).padStart(4)}  ${String(a.combo.minTfAgreement).padStart(2)}  | ` +
      `${String(a.trades).padStart(6)}  ${a.winRate.toFixed(1).padStart(6)}%  ${(breakEvenWinRate * 100).toFixed(1).padStart(8)}%  ${edge >= 0 ? "+" : ""}${edge.toFixed(1).padStart(6)}  ${a.totalPnlUsd >= 0 ? "+" : ""}$${a.totalPnlUsd}`,
    );
  }

  const best = ranked[0];
  if (best) {
    console.log(`\nBest combo: minConfidence=${best.combo.minConfidence} minTfAgreement=${best.combo.minTfAgreement}`);
    console.log("Per-symbol breakdown for the best combo:");
    for (const s of best.perSymbol) {
      const edge = s.winRate - breakEvenWinRate * 100;
      console.log(`  ${s.symbol}: ${s.trades} trades, ${s.winRate.toFixed(1)}% WR (breakeven ${(breakEvenWinRate * 100).toFixed(1)}%, edge ${edge >= 0 ? "+" : ""}${edge.toFixed(1)}pp)`);
    }
  }

  console.log(`\nP&L above assumes a fixed $${args.payout} payout ratio on every win — the live engine reads the REAL quoted payout per trade, which moves with volatility and can differ meaningfully from this flat assumption. Treat the edge (pp) column as the primary signal, the $ total as an approximation.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => {
    closePublicSocket();
    process.exit(process.exitCode ?? 0);
  });
