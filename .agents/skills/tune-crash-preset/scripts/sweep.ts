// CLI wrapper around sweepBoomPreset() in src/lib/boom-sweep.server.ts — same
// engine as tune-boom-preset, just defaulted to CRASH_SYMBOLS. The function
// is symbol-agnostic (it fetches whatever candles it's told to and replays
// the walk-forward against them), which is how CRASH_PRESET in
// src/lib/autotrader.ts was itself derived on 2026-08-01 — see that constant's
// header comment ("sweep.ts --symbols=CRASH1000,CRASH500,CRASH600,CRASH900").
//
// Usage (from repo root):
//   npx tsx .agents/skills/tune-crash-preset/scripts/sweep.ts [--quick] [--candles=150] [--symbols=CRASH1000,CRASH500] [--stake=5] [--leverage=100] [--hold=60]

import { closePublicSocket } from "../../../../src/lib/deriv.server";
import { CRASH_SYMBOLS } from "../../../../src/lib/autotrader";
import { sweepBoomPreset } from "../../../../src/lib/boom-sweep.server";

function parseArgs() {
  const argv = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split("=")[1] : fallback;
  };
  return {
    quick: argv.includes("--quick"),
    candles: Number(get("candles", "150")),
    symbols: get("symbols", CRASH_SYMBOLS.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
    stake: Number(get("stake", "5")),
    leverage: Number(get("leverage", "100")), // matches CRASH_PRESET.multiplierLevel
    hold: Number(get("hold", "60")), // matches CRASH_PRESET.maxHoldMinutes (inherited from BOOM_PRESET)
  };
}

async function main() {
  const args = parseArgs();
  console.log(`${args.symbols.length} symbol(s) — fetching candles once per symbol, then replaying every combo in memory.`);
  console.log(`symbols=${args.symbols.join(",")} candles=${args.candles} stake=$${args.stake} leverage=${args.leverage}x hold=${args.hold}min\n`);

  const report = await sweepBoomPreset(args);

  for (const [symbol, count] of Object.entries(report.signalCountsBySymbol)) {
    console.log(`${symbol}: ${count} candidate signals`);
  }

  console.log("\n=== Top 10 combos (ranked by total $ P&L across all symbols) ===");
  console.log("TP%  SL%  Conf  TF  | Trades  WinRate  Breakeven  Edge(pp)  TotalPnL($)  StopHits/TargetHits/TimeExits");
  for (const a of report.ranked.slice(0, 10)) {
    const c = a.combo;
    const edge = a.winRate - a.breakEvenWinRate;
    console.log(
      `${String(c.takeProfitPctOfStake).padStart(3)}  ${String(c.stopLossPctOfStake).padStart(3)}  ${String(c.minConfidence).padStart(4)}  ${String(c.minTfAgreement).padStart(2)}  | ` +
      `${String(a.trades).padStart(6)}  ${a.winRate.toFixed(1).padStart(6)}%  ${a.breakEvenWinRate.toFixed(1).padStart(8)}%  ${edge >= 0 ? "+" : ""}${edge.toFixed(1).padStart(6)}  ${a.totalPnlUsd >= 0 ? "+" : ""}$${a.totalPnlUsd}       ${a.stopHits}/${a.targetHits}/${a.timeExits}`,
    );
  }

  const best = report.ranked[0];
  if (best) {
    console.log(`\nBest combo: TP=${best.combo.takeProfitPctOfStake}% SL=${best.combo.stopLossPctOfStake}% minConfidence=${best.combo.minConfidence} minTfAgreement=${best.combo.minTfAgreement}`);
    console.log("Per-symbol breakdown for the best combo:");
    for (const r of best.perSymbol) {
      const edge = r.winRate - r.breakEvenWinRate;
      console.log(`  ${r.symbol}: ${r.trades} trades, ${r.winRate.toFixed(1)}% WR (breakeven ${r.breakEvenWinRate.toFixed(1)}%, edge ${edge >= 0 ? "+" : ""}${edge.toFixed(1)}pp), $${r.totalPnlUsd}, avg hold ${r.avgHoldMinutes}min, exits ${r.stopHits}/${r.targetHits}/${r.timeExits}`);
    }
  }

  console.log(`\nIf timeExits dominates stopHits+targetHits, most trades never actually reach either barrier within --hold minutes — the win/loss is then decided by directional drift alone, not by the TP/SL choice, and raising --leverage or --hold is what actually changes outcomes.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => {
    // The shared public WS has a 30s heartbeat interval that keeps the event
    // loop alive forever otherwise — without this the script hangs after
    // printing all its output instead of exiting.
    closePublicSocket();
    process.exit(process.exitCode ?? 0);
  });
