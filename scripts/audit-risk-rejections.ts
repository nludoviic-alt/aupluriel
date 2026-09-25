import { fetchCandlesServer } from "../src/lib/deriv.server";
import { generateBoom500Signals } from "../src/lib/boom500-signal.server";
import { generateVol75Signal } from "../src/lib/vol75-signal.server";
import { generateRb100Signal } from "../src/lib/rb100-signal.server";
import { generateVol50Signal } from "../src/lib/vol50-signal.server";
import { generateCrash500Signals } from "../src/lib/crash500-signal.server";
import { analyzeSymbolCore } from "../src/lib/signal-core";

interface RiskAuditResult {
  preset: string;
  symbol: string;
  strategy: string;
  signalsDetected: number;
  signalsValid: number;
  tradesExecuted: number;
  riskRejectedTotal: number;
  rejectedMaxDrawdown: number;
  rejectedDailyDd: number;
  rejectedMaxPositions: number;
  rejectedMaxExposure: number;
  rejectedCooldown: number;
  rejectedLossStreak: number;
  rejectedMaxTradesHour: number;
  rejectedMaxTradesDay: number;
  rejectedRr: number;
  rejectedDuplicatePosition: number;
  rejectedConflict: number;
  rejectedPositionSize: number;
  rejectedAccountBalance: number;
  executionRate: number;
  riskRejectionRate: number;
}

async function runAudit() {
  console.log("==========================================================================");
  console.log("              AUDIT RISK MANAGER — BLOCAGE DE SIGNAUX VALIDES             ");
  console.log("==========================================================================");

  const targets = [
    { preset: "CRASH900", symbol: "CRASH900", minConf: 70, maxPos: 2 },
    { preset: "BOOM500", symbol: "BOOM500", minConf: 80, maxPos: 2 },
    { preset: "CRASH500", symbol: "CRASH500", minConf: 70, maxPos: 3 },
    { preset: "VOL75_1S", symbol: "1HZ75V", minConf: 74, maxPos: 3 },
    { preset: "VOL50_1S", symbol: "1HZ50V", minConf: 76, maxPos: 3 },
    { preset: "RB100", symbol: "RB100", minConf: 72, maxPos: 1 },
  ];

  const results: RiskAuditResult[] = [];

  for (const t of targets) {
    console.log(`\nFetching candles for ${t.preset} (${t.symbol})...`);
    try {
      const [m15, m5, m1] = await Promise.all([
        fetchCandlesServer(t.symbol, 900, 300).catch(() => []),
        fetchCandlesServer(t.symbol, 300, 500).catch(() => []),
        fetchCandlesServer(t.symbol, 60, 1000).catch(() => []),
      ]);

      if (m1.length < 60) {
        console.log(`⚠️ Impossible de charger assez de bougies pour ${t.symbol}`);
        continue;
      }

      // We walk forward on M1 candles (step by 5 bars)
      const windowSizeM1 = 60;
      const step = 5;

      let detected = 0;
      let valid = 0;
      let executed = 0;
      let rejectedTotal = 0;

      let rejMaxDrawdown = 0;
      let rejDailyDd = 0;
      let rejMaxPositions = 0;
      let rejMaxExposure = 0;
      let rejCooldown = 0;
      let rejLossStreak = 0;
      let rejMaxTradesHour = 0;
      let rejMaxTradesDay = 0;
      let rejRr = 0;
      let rejDuplicatePosition = 0;
      let rejConflict = 0;
      let rejPositionSize = 0;
      let rejAccountBalance = 0;

      // Simulated state trackers
      let activePositionsCount = 0;
      let openSymbols = new Set<string>();
      let cooldownUntil = 0;
      let tradesInLastHour = 0;
      let tradesInLastDay = 0;
      let dailyLossAccumulated = 0;
      let maxDailyLossLimit = 50; // $50 daily loss cap
      let totalDrawdownAccumulated = 0;
      let maxDrawdownLimit = 150; // $150 total drawdown cap
      let consecutiveLosses = 0;

      const strategyCounts: Record<string, { detected: number; valid: number; executed: number; rejected: number }> = {};

      for (let i = windowSizeM1; i <= m1.length; i += step) {
        const sliceM1 = m1.slice(Math.max(0, i - windowSizeM1), i);
        const sliceM5 = m5.slice(Math.max(0, Math.floor(i / 5) - 60), Math.floor(i / 5));
        const sliceM15 = m15.slice(Math.max(0, Math.floor(i / 15) - 60), Math.floor(i / 15));

        const currentTime = sliceM1[sliceM1.length - 1].time * 1000;

        let signalsFound: Array<{ strategy: string; confidence: number; direction: string; rr?: number }> = [];

        if (t.preset === "BOOM500") {
          const sigs = generateBoom500Signals(sliceM15, sliceM5, sliceM1);
          signalsFound = sigs.map(s => ({ strategy: s.strategy, confidence: s.confidence, direction: s.direction, rr: s.rewardAbs / Math.max(0.01, s.riskAbs) }));
        } else if (t.preset === "CRASH500") {
          const sigs = generateCrash500Signals(sliceM15, sliceM5, sliceM1);
          signalsFound = sigs.map(s => ({ strategy: s.strategy, confidence: s.confidence, direction: s.direction, rr: s.rewardAbs / Math.max(0.01, s.riskAbs) }));
        } else if (t.preset === "VOL75_1S") {
          const res = generateVol75Signal(sliceM15, sliceM5, sliceM1);
          if (res.signal) signalsFound = [{ strategy: res.signal.strategy, confidence: res.signal.confidence, direction: res.signal.direction, rr: res.signal.rewardAbs / Math.max(0.01, res.signal.riskAbs) }];
        } else if (t.preset === "VOL50_1S") {
          const res = generateVol50Signal(sliceM15, sliceM5, sliceM1);
          if (res.signal) signalsFound = [{ strategy: res.signal.strategy, confidence: res.signal.confidence, direction: res.signal.direction, rr: res.signal.rewardAbs / Math.max(0.01, res.signal.riskAbs) }];
        } else if (t.preset === "RB100") {
          const res = generateRb100Signal(sliceM15, sliceM5, sliceM1);
          if (res.signal) signalsFound = [{ strategy: res.signal.strategy, confidence: res.signal.confidence, direction: res.signal.direction, rr: res.signal.rewardAbs / Math.max(0.01, res.signal.riskAbs) }];
        } else if (t.preset === "CRASH900") {
          const fetcher = async (sym: string, gran: number, count: number) => {
            return gran === 900 ? sliceM15 : gran === 300 ? sliceM5 : sliceM1;
          };
          try {
            const res = await analyzeSymbolCore(fetcher as any, "CRASH900", {});
            if (res.analysis && res.analysis.confidence >= 50) {
              signalsFound = [{ strategy: "CRASH900_TREND_PULLBACK", confidence: res.analysis.confidence, direction: res.analysis.direction || "PUT", rr: 1.5 }];
            }
          } catch { /* ignore */ }
        }

        for (const sig of signalsFound) {
          detected++;
          if (!strategyCounts[sig.strategy]) {
            strategyCounts[sig.strategy] = { detected: 0, valid: 0, executed: 0, rejected: 0 };
          }
          strategyCounts[sig.strategy].detected++;

          // Is signal VALID (meets min confidence)?
          if (sig.confidence < t.minConf) {
            continue; // Not valid (below confidence threshold)
          }

          valid++;
          strategyCounts[sig.strategy].valid++;

          // Check Risk Manager rules in priority order
          let isRejected = false;
          let rejectReason = "";

          if (totalDrawdownAccumulated >= maxDrawdownLimit) {
            isRejected = true;
            rejectReason = "MAX_DRAWDOWN";
            rejMaxDrawdown++;
          } else if (dailyLossAccumulated >= maxDailyLossLimit) {
            isRejected = true;
            rejectReason = "DAILY_DD";
            rejDailyDd++;
          } else if (activePositionsCount >= t.maxPos) {
            isRejected = true;
            rejectReason = "MAX_POSITIONS";
            rejMaxPositions++;
          } else if (openSymbols.has(t.symbol)) {
            isRejected = true;
            rejectReason = "DUPLICATE_POSITION";
            rejDuplicatePosition++;
          } else if (currentTime < cooldownUntil) {
            isRejected = true;
            rejectReason = "COOLDOWN";
            rejCooldown++;
          } else if (consecutiveLosses >= 3) {
            isRejected = true;
            rejectReason = "LOSS_STREAK";
            rejLossStreak++;
          } else if (tradesInLastHour >= 4) {
            isRejected = true;
            rejectReason = "MAX_TRADES_HOUR";
            rejMaxTradesHour++;
          } else if (tradesInLastDay >= 20) {
            isRejected = true;
            rejectReason = "MAX_TRADES_DAY";
            rejMaxTradesDay++;
          } else if (sig.rr !== undefined && sig.rr < 1.1) {
            isRejected = true;
            rejectReason = "RR";
            rejRr++;
          }

          if (isRejected) {
            rejectedTotal++;
            strategyCounts[sig.strategy].rejected++;
          } else {
            executed++;
            strategyCounts[sig.strategy].executed++;
            // Simulate position opening and closing after some bars
            activePositionsCount++;
            openSymbols.add(t.symbol);
            tradesInLastHour++;
            tradesInLastDay++;
            // Simulate release after cooldown
            cooldownUntil = currentTime + 15 * 60 * 1000;
            // Decay open positions
            setTimeout(() => {
              activePositionsCount = Math.max(0, activePositionsCount - 1);
              openSymbols.delete(t.symbol);
            }, 500);
          }
        }
      }

      const execRate = valid > 0 ? (executed / valid) * 100 : 0;
      const rejRate = valid > 0 ? (rejectedTotal / valid) * 100 : 0;

      const mainResult: RiskAuditResult = {
        preset: t.preset,
        symbol: t.symbol,
        strategy: Object.keys(strategyCounts).join(" / ") || t.preset,
        signalsDetected: detected,
        signalsValid: valid,
        tradesExecuted: executed,
        riskRejectedTotal: rejectedTotal,
        rejectedMaxDrawdown: rejMaxDrawdown,
        rejectedDailyDd: rejDailyDd,
        rejectedMaxPositions: rejMaxPositions,
        rejectedMaxExposure: rejMaxExposure,
        rejectedCooldown: rejCooldown,
        rejectedLossStreak: rejLossStreak,
        rejectedMaxTradesHour: rejMaxTradesHour,
        rejectedMaxTradesDay: rejMaxTradesDay,
        rejectedRr: rejRr,
        rejectedDuplicatePosition: rejDuplicatePosition,
        rejectedConflict: rejConflict,
        rejectedPositionSize: rejPositionSize,
        rejectedAccountBalance: rejAccountBalance,
        executionRate: Math.round(execRate * 10) / 10,
        riskRejectionRate: Math.round(rejRate * 10) / 10,
      };

      results.push(mainResult);
    } catch (e) {
      console.error(`Error auditing ${t.preset}:`, (e as Error).message);
    }
  }

  console.log("\n==========================================================================");
  console.log("                        RÉSULTATS DE L'AUDIT RISK MANAGER                  ");
  console.log("==========================================================================");
  console.log(JSON.stringify(results, null, 2));
}

runAudit();
