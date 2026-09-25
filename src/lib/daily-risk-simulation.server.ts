/** Phase 2 is deliberately analytical: it reads settled Shadow outcomes and
 * never updates bot_state, ConfigRegistry, or a risk limit. */
import { getDb } from "./db.server";
import type { Preset } from "./bot-engine.server";

type Observation = {
  equity_at_signal?: number | null;
  BASE_DAILY_LOSS_LIMIT?: number;
  NOMINAL_RISK_PER_TRADE?: number;
  COHORT?: {
    strategy_version?: string;
    risk_version?: string;
    execution_version?: string;
    config_hash?: string;
  };
};
type ShadowRow = {
  time: number;
  virtual_pnl: number;
  r_multiple: number;
  risk_observation: string | null;
};
type LimitInput = { equity: number; base: number; nominal: number };
type Scenario = { name: string; limit: (row: LimitInput) => number };

function parseObservation(raw: string | null): Observation | null {
  try {
    return raw ? (JSON.parse(raw) as Observation) : null;
  } catch {
    return null;
  }
}

function metrics(executed: ShadowRow[], blocked: ShadowRow[]) {
  const pnl = executed.reduce((sum, row) => sum + row.virtual_pnl, 0);
  const grossWin = executed.reduce((sum, row) => sum + Math.max(0, row.virtual_pnl), 0);
  const grossLoss = Math.abs(executed.reduce((sum, row) => sum + Math.min(0, row.virtual_pnl), 0));
  let peak = 0,
    cumulative = 0,
    maxDrawdown = 0;
  const lossByDay = new Map<string, number>();
  for (const row of executed) {
    cumulative += row.virtual_pnl;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }
  for (const row of executed) {
    const day = new Date(row.time).toISOString().slice(0, 10);
    lossByDay.set(day, (lossByDay.get(day) ?? 0) + Math.max(0, -row.virtual_pnl));
  }
  const lossesAvoided = Math.abs(
    blocked.reduce((sum, row) => sum + Math.min(0, row.virtual_pnl), 0),
  );
  const positivePnlBlocked = blocked.reduce((sum, row) => sum + Math.max(0, row.virtual_pnl), 0);
  return {
    tradesExecuted: executed.length,
    tradesBlocked: blocked.length,
    netPnl: pnl,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
    expectancy: executed.length ? pnl / executed.length : 0,
    expectancyR: executed.length
      ? executed.reduce((sum, row) => sum + row.r_multiple, 0) / executed.length
      : 0,
    maxDrawdown,
    dailyMaxLoss: Math.max(0, ...lossByDay.values()),
    lossesAvoided,
    positivePnlBlocked,
    netProtectionValue: lossesAvoided - positivePnlBlocked,
    netCapitalProtection: lossesAvoided - positivePnlBlocked,
  };
}

export function simulateDailyLimits(rows: ShadowRow[], scenarios: Scenario[]) {
  return scenarios.map((scenario) => {
    const executed: ShadowRow[] = [],
      blocked: ShadowRow[] = [];
    const lossByDay = new Map<string, number>();
    for (const row of rows) {
      const observation = parseObservation(row.risk_observation);
      if (!observation) continue;
      const day = new Date(row.time).toISOString().slice(0, 10);
      const equity = Math.max(0, observation.equity_at_signal ?? 0);
      const base = Math.max(0, observation.BASE_DAILY_LOSS_LIMIT ?? 0);
      const nominal = Math.max(0, observation.NOMINAL_RISK_PER_TRADE ?? 0);
      const limit = scenario.limit({ equity, base, nominal });
      if (limit <= 0 || (lossByDay.get(day) ?? 0) >= limit) {
        blocked.push(row);
        continue;
      }
      executed.push(row);
      lossByDay.set(day, (lossByDay.get(day) ?? 0) + Math.max(0, -row.virtual_pnl));
    }
    return { scenario: scenario.name, ...metrics(executed, blocked) };
  });
}

export function getDailyRiskSimulation(userId: number, preset: Preset) {
  const rows = getDb()
    .prepare(
      `
    SELECT time, virtual_pnl, r_multiple, risk_observation FROM shadow_trades
    WHERE user_id = ? AND preset = ? AND status IN ('won', 'lost') AND risk_observation IS NOT NULL
    ORDER BY time ASC
  `,
    )
    .all(userId, preset) as ShadowRow[];
  const cohorts = new Map<string, ShadowRow[]>();
  for (const row of rows) {
    const c = parseObservation(row.risk_observation)?.COHORT;
    if (!c?.strategy_version || !c.risk_version || !c.execution_version || !c.config_hash) continue;
    const key = `${c.strategy_version}|${c.risk_version}|${c.execution_version}|${c.config_hash}`;
    cohorts.set(key, [...(cohorts.get(key) ?? []), row]);
  }
  const scenarioDefinitions: Scenario[] = [
    { name: "CURRENT", limit: ({ base }) => base },
    ...[0.005, 0.01, 0.015, 0.02].map((pct) => ({
      name: `EQUITY_${pct * 100}%`,
      limit: ({ equity, base }: LimitInput) => Math.min(base, equity * pct),
    })),
    ...[3, 4, 5, 6].map((multiple) => ({
      name: `${multiple}R`,
      limit: ({ nominal, base }: LimitInput) => Math.min(base, nominal * multiple),
    })),
    ...[0.005, 0.01, 0.015, 0.02].flatMap((pct) =>
      [3, 4, 5, 6].map((multiple) => ({
        name: `HYBRID_${pct * 100}%_${multiple}R`,
        limit: ({ equity, nominal, base }: LimitInput) =>
          Math.min(base, equity * pct, nominal * multiple),
      })),
    ),
  ];
  return [...cohorts.entries()].map(([key, cohort]) => {
    const eligible = cohort.length >= 20;
    const scenarios = !eligible ? [] : simulateDailyLimits(cohort, scenarioDefinitions);
    const current = scenarios.find((scenario) => scenario.scenario === "CURRENT");
    return {
      cohort: key,
      outcomes: cohort.length,
      eligible,
      scenarios: scenarios.map((scenario) => ({
        ...scenario,
        recommendation:
          !current || scenario.scenario === "CURRENT"
            ? "BASELINE"
            : scenario.netProtectionValue > 0 &&
                scenario.expectancy >= current.expectancy &&
                scenario.maxDrawdown <= current.maxDrawdown
              ? "CANDIDATE"
              : "REJECT",
      })),
    };
  });
}
