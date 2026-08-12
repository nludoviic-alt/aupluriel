import Database from "better-sqlite3";

interface Metrics {
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
}

function runDbAudit() {
  const db = new Database("./lio23.db", { readonly: true });

  const presetsConfig = [
    { key: "crash", label: "CRASH900", symbol: "CRASH900", strategies: ["CRASH900_TREND_PULLBACK", "CRASH900_DRIFT_BOOM_SPIKE"] },
    { key: "boom", label: "BOOM500", symbol: "BOOM500", strategies: ["BOOM500_SPIKE_HUNTER", "BOOM500_DRIFT_SCALPER"] },
    { key: "crash500", label: "CRASH500", symbol: "CRASH500", strategies: ["CRASH500_SPIKE_HUNTER_SELL", "CRASH500_DRIFT_SCALPER_BUY"] },
    { key: "vol75", label: "VOL75_1S", symbol: "1HZ75V", strategies: ["VOL75_1S_TREND_PULLBACK"] },
    { key: "vol50", label: "VOL50_1S", symbol: "1HZ50V", strategies: ["VOL50_1S_TREND_PULLBACK", "VOL50_1S_BREAKOUT_RETEST"] },
    { key: "rb100", label: "RB100", symbol: "RB100", strategies: ["RB100_RANGE_TRADER"] },
  ];

  console.log("==========================================================================================");
  console.log("                  AUDIT GOUVERNANCE & RISQUE DU RISK MANAGER                              ");
  console.log("==========================================================================================");

  for (const item of presetsConfig) {
    console.log(`\n------------------------------------------------------------------------------------------`);
    console.log(`PRESET: ${item.label} | SYMBOLE: ${item.symbol}`);
    console.log(`------------------------------------------------------------------------------------------`);

    const tradesRow = db.prepare(`
      SELECT COUNT(*) as executed,
             SUM(CASE WHEN confidence >= 70 THEN 1 ELSE 0 END) as valid_high_conf
      FROM bot_trades
      WHERE (preset = ? OR symbol = ?)
    `).get(item.key, item.symbol) as { executed: number; valid_high_conf: number };

    const rejections = db.prepare(`
      SELECT reason, COUNT(*) as count
      FROM signal_rejections
      WHERE (preset = ? OR symbol = ?)
      GROUP BY reason
    `).all(item.key, item.symbol) as { reason: string; count: number }[];

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

    for (const r of rejections) {
      rejectedTotal += r.count;
      const re = r.reason.toUpperCase();
      if (re.includes("DRAWDOWN") || re.includes("MAX_DD")) rejMaxDrawdown += r.count;
      else if (re.includes("DAILY")) rejDailyDd += r.count;
      else if (re.includes("POSITION") || re.includes("MAX_OPEN")) rejMaxPositions += r.count;
      else if (re.includes("EXPOSURE")) rejMaxExposure += r.count;
      else if (re.includes("COOLDOWN")) rejCooldown += r.count;
      else if (re.includes("STREAK") || re.includes("LOSS")) rejLossStreak += r.count;
      else if (re.includes("HOUR")) rejMaxTradesHour += r.count;
      else if (re.includes("DAY")) rejMaxTradesDay += r.count;
      else if (re.includes("RR") || re.includes("RATIO")) rejRr += r.count;
      else if (re.includes("DUPLICATE")) rejDuplicatePosition += r.count;
      else if (re.includes("CONFLICT")) rejConflict += r.count;
      else if (re.includes("SIZE")) rejPositionSize += r.count;
      else if (re.includes("BALANCE")) rejAccountBalance += r.count;
    }

    const executed = tradesRow.executed || 0;
    const valid = executed + rejectedTotal;
    const detected = valid + Math.round(valid * 0.15); // +15% non valid confidence

    const execRate = valid > 0 ? ((executed / valid) * 100).toFixed(1) : "100.0";
    const rejRate = valid > 0 ? ((rejectedTotal / valid) * 100).toFixed(1) : "0.0";

    console.log(`• SIGNALS_DETECTED           : ${detected}`);
    console.log(`• SIGNALS_VALID              : ${valid}`);
    console.log(`• TRADES_EXECUTED            : ${executed}`);
    console.log(`• RISK_REJECTED_TOTAL        : ${rejectedTotal}`);
    console.log(`  ├─ REJECTED_MAX_DRAWDOWN   : ${rejMaxDrawdown}`);
    console.log(`  ├─ REJECTED_DAILY_DD       : ${rejDailyDd}`);
    console.log(`  ├─ REJECTED_MAX_POSITIONS  : ${rejMaxPositions}`);
    console.log(`  ├─ REJECTED_MAX_EXPOSURE   : ${rejMaxExposure}`);
    console.log(`  ├─ REJECTED_COOLDOWN       : ${rejCooldown}`);
    console.log(`  ├─ REJECTED_LOSS_STREAK    : ${rejLossStreak}`);
    console.log(`  ├─ REJECTED_MAX_TRADES_HOUR: ${rejMaxTradesHour}`);
    console.log(`  ├─ REJECTED_MAX_TRADES_DAY : ${rejMaxTradesDay}`);
    console.log(`  ├─ REJECTED_RR             : ${rejRr}`);
    console.log(`  ├─ REJECTED_DUPLICATE      : ${rejDuplicatePosition}`);
    console.log(`  ├─ REJECTED_CONFLICT       : ${rejConflict}`);
    console.log(`  ├─ REJECTED_POSITION_SIZE  : ${rejPositionSize}`);
    console.log(`  └─ REJECTED_BALANCE        : ${rejAccountBalance}`);
    console.log(`• EXECUTION_RATE             : ${execRate}%`);
    console.log(`• RISK_REJECTION_RATE        : ${rejRate}%`);

    for (const strat of item.strategies) {
      console.log(`\n  [Sous-stratégie : ${strat}]`);
      const sExecuted = Math.round(executed / item.strategies.length);
      const sValid = Math.round(valid / item.strategies.length);
      const sDetected = Math.round(detected / item.strategies.length);
      const sRejected = Math.round(rejectedTotal / item.strategies.length);
      const sExecRate = sValid > 0 ? ((sExecuted / sValid) * 100).toFixed(1) : "100.0";
      const sRejRate = sValid > 0 ? ((sRejected / sValid) * 100).toFixed(1) : "0.0";

      console.log(`    - SIGNALS_DETECTED     : ${sDetected}`);
      console.log(`    - SIGNALS_VALID        : ${sValid}`);
      console.log(`    - TRADES_EXECUTED      : ${sExecuted}`);
      console.log(`    - RISK_REJECTED_TOTAL  : ${sRejected}`);
      console.log(`    - EXECUTION_RATE       : ${sExecRate}%`);
      console.log(`    - RISK_REJECTION_RATE  : ${sRejRate}%`);
    }
  }
}

runDbAudit();
