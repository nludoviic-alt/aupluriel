// One-off diagnostic backtest for CRASH500's dedicated engine
// (generateCrash500Signals in src/lib/crash500-signal.server.ts). Not part
// of the tune-crash-preset skill's normal grid — CRASH500 uses its own
// bespoke signal generator, not the shared analyzeSymbolCore/boom-sweep
// engine, so it needs its own harness. Kept in this skill's scripts/ folder
// only for the relative-import depth (4x "../" to repo root), same as
// sweep.ts.
//
// Live data (2026-09-15 VPS audit) showed: 45/45 real trades were MULTUP
// (CRASH500_DRIFT_SCALPER_BUY / legacy "crash500"), CRASH500_SPIKE_HUNTER_SELL
// never fired once. Every loss averaged -$2.33 (3-7x the nominal $0.50 stop),
// every win landed almost exactly at $0.50-0.58 — both stopLossUsd and
// takeProfitUsd are hitting the Math.max(0.5, ...) floor in
// computeStructuralStopUsd() (signal-core.ts:437-444), because CRASH500's
// ATR-scaled riskAbs/rewardAbs are tiny in price terms. This script:
//   1. Replays generateCrash500Signals as-is (baseline) to confirm the split.
//   2. Tests removing the $0.50 floor (use the raw computed stop/target).
//   3. Tests lowering the spike>=88 threshold to see if SELL ever fires and
//      how it performs when it does.
//
// Usage: npx tsx .claude/skills/tune-crash-preset/scripts/crash500-diagnostic.ts [--candles=4000] [--hold=8]

import { closePublicSocket, fetchCandlesServer, type ServerCandle } from "../../../../src/lib/deriv.server";
import { atr, bollinger, ema, macd, rsi } from "../../../../src/lib/indicators";

type Strategy = "CRASH500_SPIKE_HUNTER_SELL" | "CRASH500_DRIFT_SCALPER_BUY";

function values(c: ServerCandle[]) { return { close: c.map(x => x.close), high: c.map(x => x.high), low: c.map(x => x.low) }; }
function last<T>(a: T[]): T { return a[a.length - 1]; }

/** Same logic as generateCrash500Signals, but with the spike/drift score
 * thresholds parameterized so we can sweep them. */
function generateSignalsAt(
  m15: ServerCandle[], m5: ServerCandle[], m1: ServerCandle[],
  sellThreshold: number, buyThreshold: number,
): { strategy: Strategy; direction: "CALL" | "PUT"; confidence: number; riskAbs: number; rewardAbs: number } | null {
  if (m15.length < 55 || m5.length < 55 || m1.length < 35) return null;
  const a15 = values(m15), a5 = values(m5), a1 = values(m1);
  const e15_20 = last(ema(a15.close, 20)), e15_50 = last(ema(a15.close, 50));
  const e5_20 = last(ema(a5.close, 20)), e5_50 = last(ema(a5.close, 50));
  const e1_20 = last(ema(a1.close, 20));
  const r15 = last(rsi(a15.close, 14)), r5 = last(rsi(a5.close, 14)), r1 = last(rsi(a1.close, 14));
  const m = macd(a1.close); const hist = last(m.histogram) ?? 0; const prevHist = m.histogram[m.histogram.length - 2] ?? 0;
  const current = last(m1); const a = last(atr(a1.high, a1.low, a1.close, 14));
  const bb = bollinger(a5.close, 20, 2); const width = ((last(bb.upper) ?? 0) - (last(bb.lower) ?? 0)) / Math.max(current.close, Number.EPSILON);
  if ([e15_20, e15_50, e5_20, e5_50, e1_20, r15, r5, r1, a].some((v) => v === null)) return null;
  const atrValue = a as number;
  const recentLow = Math.min(...m1.slice(-8, -1).map((c) => c.low));
  const range = current.high - current.low;
  const bearishReject = current.close < current.open && current.high - Math.max(current.open, current.close) > range * 0.35;
  const bullishReject = current.close > current.open && Math.min(current.open, current.close) - current.low > range * 0.35;
  const postCrash = m1.slice(-4).some((c) => c.open - c.close >= atrValue * 2.2);

  let spike = 0;
  if ((e15_20 as number) <= (e15_50 as number) || r15! < 55) spike += 5;
  if (current.close >= Math.max(...m5.slice(-12).map((c) => c.close)) * 0.998) spike += 5;
  if ((e5_20 as number) <= (e5_50 as number) || current.close < (e5_20 as number)) spike += 10;
  if (width < 0.003) spike += 10;
  if (bearishReject) spike += 10;
  if (current.close < recentLow) spike += 15;
  if ((r1 as number) < 50) spike += 10;
  if (hist < 0 && hist < prevHist) spike += 10;
  if (!postCrash && spike >= sellThreshold) {
    return { strategy: "CRASH500_SPIKE_HUNTER_SELL", direction: "PUT", confidence: Math.min(100, spike), riskAbs: atrValue * 1.1, rewardAbs: atrValue * 1.8 };
  }
  let drift = 0;
  if ((e5_20 as number) > (e5_50 as number)) drift += 20;
  if (current.low > Math.min(...m1.slice(-8, -1).map((c) => c.low))) drift += 25;
  if ((r5 as number) > 50 && (r1 as number) > 50) drift += 20;
  if (hist > 0 && hist > prevHist) drift += 15;
  if (!postCrash && width < 0.012) drift += 10;
  if (bullishReject && current.close > (e1_20 as number)) drift += 10;
  if (drift >= buyThreshold && spike < 95) {
    return { strategy: "CRASH500_DRIFT_SCALPER_BUY", direction: "CALL", confidence: Math.min(100, drift), riskAbs: atrValue * 0.9, rewardAbs: atrValue * 1.2 };
  }
  return null;
}

type FloorMode = "live-bug" | "no-floor" | "proportional";

/** Mirrors computeStructuralStopUsd in signal-core.ts, with 3 floor
 * strategies: "live-bug" (today's code — floors SL and TP independently to
 * $0.50, destroying the intended R:R), "no-floor" (raw values, can be
 * pennies), "proportional" (the actual fix: if the smaller of the two would
 * fall under $0.50, scale BOTH up by the same factor so the floor is hit
 * without flattening the risk:reward ratio the signal intended). */
function computeStructuralStopUsd(stakeUsd: number, multiplierLevel: number, entryPrice: number, riskAbs: number, rewardAbs: number, mode: FloorMode) {
  const stopDistancePct = (riskAbs / entryPrice) * 100;
  const rewardDistancePct = (rewardAbs / entryPrice) * 100;
  const rawSl = (stakeUsd * (multiplierLevel * stopDistancePct)) / 100;
  const rawTp = (stakeUsd * (multiplierLevel * rewardDistancePct)) / 100;
  let stopLossUsd: number, takeProfitUsd: number;
  if (mode === "live-bug") {
    stopLossUsd = Math.min(stakeUsd, Math.max(0.5, rawSl));
    takeProfitUsd = Math.max(0.5, rawTp);
  } else if (mode === "no-floor") {
    stopLossUsd = Math.min(stakeUsd, Math.max(0.01, rawSl));
    takeProfitUsd = Math.max(0.01, rawTp);
  } else {
    const smaller = Math.min(rawSl, rawTp);
    const scale = smaller > 0 && smaller < 0.5 ? 0.5 / smaller : 1;
    stopLossUsd = Math.min(stakeUsd, Math.max(0.01, rawSl * scale));
    takeProfitUsd = Math.max(0.01, rawTp * scale);
  }
  return { stopLossUsd: Math.round(stopLossUsd * 100) / 100, takeProfitUsd: Math.round(takeProfitUsd * 100) / 100, rawSl, rawTp };
}

function sliceAsOf(candles: ServerCandle[], epoch: number, lookback: number): ServerCandle[] {
  let lo = 0, hi = candles.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (candles[mid].epoch <= epoch) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx < 0) return [];
  return candles.slice(Math.max(0, idx - lookback + 1), idx + 1);
}

interface Scenario { label: string; floorMode: FloorMode; sellThreshold: number; buyThreshold: number; }

async function main() {
  const argv = process.argv.slice(2);
  const get = (name: string, fb: string) => { const h = argv.find((a) => a.startsWith(`--${name}=`)); return h ? h.split("=")[1] : fb; };
  const candles1m = Number(get("candles", "4000"));
  const holdMinutes = Number(get("hold", "8"));
  const endArg = get("end", "");
  const end: number | "latest" = endArg ? Number(endArg) : "latest";
  const stakeUsd = 25, multiplierLevel = 100;

  console.log(`Fetching CRASH500 candles: ${candles1m} x M1, plus M5/M15 for the same span (end=${end})...`);
  const [m1all, m5all, m15all] = await Promise.all([
    fetchCandlesServer("CRASH500", 60, candles1m + 60, end),
    fetchCandlesServer("CRASH500", 300, Math.ceil(candles1m / 5) + 60, end),
    fetchCandlesServer("CRASH500", 900, Math.ceil(candles1m / 15) + 60, end),
  ]);
  console.log(`Got M1=${m1all.length} M5=${m5all.length} M15=${m15all.length} candles.\n`);

  const scenarios: Scenario[] = [
    { label: "Baseline (live, floor bug, sell>=88)", floorMode: "live-bug", sellThreshold: 88, buyThreshold: 90 },
    { label: "Fix A: no floor (raw ATR-scaled stop)", floorMode: "no-floor", sellThreshold: 88, buyThreshold: 90 },
    { label: "Fix C: proportional floor (preserves R:R)", floorMode: "proportional", sellThreshold: 88, buyThreshold: 90 },
    { label: "Fix B: sell>=65 (loosened)", floorMode: "live-bug", sellThreshold: 65, buyThreshold: 90 },
    { label: "Fix B+C combined", floorMode: "proportional", sellThreshold: 65, buyThreshold: 90 },
  ];

  for (const scenario of scenarios) {
    let wins = 0, losses = 0, totalPnl = 0, grossWin = 0, grossLoss = 0;
    let sellCount = 0, buyCount = 0, sellWins = 0, buyWins = 0, sellPnl = 0, buyPnl = 0;
    let sellFloored = 0, buyFloored = 0;
    const holdSec = holdMinutes * 60;

    const start = Math.max(55, m1all.length - candles1m);
    let i = start;
    while (i < m1all.length) {
      const asOf = m1all[i].epoch;
      const m1 = sliceAsOf(m1all, asOf, 250);
      const m5 = sliceAsOf(m5all, asOf, 250);
      const m15 = sliceAsOf(m15all, asOf, 250);
      const sig = generateSignalsAt(m15, m5, m1, scenario.sellThreshold, scenario.buyThreshold);
      if (!sig) { i++; continue; }
      const entryPrice = m1all[i].close;
      const entryEpoch = m1all[i].epoch;
      if (entryEpoch + holdSec > m1all[m1all.length - 1].epoch) break;

      const { stopLossUsd, takeProfitUsd, rawSl, rawTp } = computeStructuralStopUsd(
        stakeUsd, multiplierLevel, entryPrice, sig.riskAbs, sig.rewardAbs, scenario.floorMode,
      );
      const floored = rawSl < 0.5 || rawTp < 0.5;
      const leveredNotional = stakeUsd * multiplierLevel;
      const stopFrac = stopLossUsd / leveredNotional;
      const tpFrac = takeProfitUsd / leveredNotional;
      const slPrice = sig.direction === "CALL" ? entryPrice * (1 - stopFrac) : entryPrice * (1 + stopFrac);
      const tpPrice = sig.direction === "CALL" ? entryPrice * (1 + tpFrac) : entryPrice * (1 - tpFrac);

      const forward = m1all.filter((c) => c.epoch > entryEpoch && c.epoch <= entryEpoch + holdSec);
      let outcome: "stop" | "target" | "time" = "time";
      let pnl = 0;
      let exitEpoch = entryEpoch + holdSec;
      for (const c of forward) {
        const hitStop = sig.direction === "CALL" ? c.low <= slPrice : c.high >= slPrice;
        const hitTarget = sig.direction === "CALL" ? c.high >= tpPrice : c.low <= tpPrice;
        if (hitStop) { outcome = "stop"; pnl = -stopLossUsd; exitEpoch = c.epoch; break; }
        if (hitTarget) { outcome = "target"; pnl = takeProfitUsd; exitEpoch = c.epoch; break; }
      }
      if (outcome === "time") {
        const lastC = forward.length ? forward[forward.length - 1].close : entryPrice;
        const pctMove = sig.direction === "CALL" ? (lastC - entryPrice) / entryPrice : (entryPrice - lastC) / entryPrice;
        pnl = leveredNotional * pctMove;
      }
      const won = pnl > 0;
      won ? wins++ : losses++;
      if (pnl > 0) grossWin += pnl; else grossLoss += Math.abs(pnl);
      totalPnl += pnl;
      if (sig.strategy === "CRASH500_SPIKE_HUNTER_SELL") { sellCount++; sellPnl += pnl; if (won) sellWins++; if (floored) sellFloored++; }
      else { buyCount++; buyPnl += pnl; if (won) buyWins++; if (floored) buyFloored++; }

      // Only 1 position at a time (maxOpenPositions:1 live) — jump past this
      // trade's exit before considering the next entry, instead of letting
      // overlapping "trades" inflate volume and smear risk unrealistically.
      let nextI = i + 1;
      while (nextI < m1all.length && m1all[nextI].epoch < exitEpoch) nextI++;
      i = nextI;
    }

    const trades = wins + losses;
    const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    console.log(`=== ${scenario.label} ===`);
    console.log(`  Total: ${trades} trades, ${trades ? ((wins / trades) * 100).toFixed(1) : 0}% WR, PnL $${totalPnl.toFixed(2)}, PF ${pf.toFixed(2)}`);
    console.log(`  SELL (${sellCount} trades, ${sellFloored} floored): ${sellCount ? ((sellWins / sellCount) * 100).toFixed(1) : 0}% WR, PnL $${sellPnl.toFixed(2)}`);
    console.log(`  BUY  (${buyCount} trades, ${buyFloored} floored): ${buyCount ? ((buyWins / buyCount) * 100).toFixed(1) : 0}% WR, PnL $${buyPnl.toFixed(2)}`);
    console.log();
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => { closePublicSocket(); process.exit(process.exitCode ?? 0); });
