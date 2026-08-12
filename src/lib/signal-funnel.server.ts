/**
 * Module Signal Funnel pour l'Architecture Trading V3.
 * Enregistre les compteurs de passage à chaque étape du pipeline :
 * SCANS -> SETUPS -> VALID_SIGNALS -> TIME_APPROVED -> RISK_APPROVED -> PROPOSAL_VALID -> EXECUTED
 */

import { getDb } from "./db.server";

export type FunnelStage =
  | "scan"
  | "setup"
  | "valid_signal"
  | "time_approved"
  | "risk_approved"
  | "proposal_valid"
  | "executed";

export function recordFunnelStep(preset: string, strategy: string, stage: FunnelStage, count = 1): void {
  const dateUtc = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const db = getDb();

  try {
    const colMap: Record<FunnelStage, string> = {
      scan: "scans",
      setup: "setups",
      valid_signal: "valid_signals",
      time_approved: "time_approved",
      risk_approved: "risk_approved",
      proposal_valid: "proposal_valid",
      executed: "executed_trades",
    };

    const col = colMap[stage];
    db.prepare(`
      INSERT INTO signal_funnel_stats (date_utc, preset, strategy, ${col}, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(date_utc, preset, strategy) DO UPDATE SET
        ${col} = ${col} + excluded.${col},
        updated_at = unixepoch()
    `).run(dateUtc, preset, strategy, count);
  } catch (e) {
    // Non-blocking logger
    console.error(`[SignalFunnel Error] ${stage} for ${preset}/${strategy}:`, (e as Error).message);
  }
}

export interface FunnelSummary {
  dateUtc: string;
  preset: string;
  strategy: string;
  scans: number;
  setups: number;
  validSignals: number;
  timeApproved: number;
  riskApproved: number;
  proposalValid: number;
  executedTrades: number;
  timeApprovalRatePct: number;
  riskApprovalRatePct: number;
  conversionRatePct: number;
}

export function getFunnelStats(preset?: string, dateUtc?: string): FunnelSummary[] {
  const targetDate = dateUtc ?? new Date().toISOString().split("T")[0];
  const db = getDb();

  let query = `SELECT * FROM signal_funnel_stats WHERE date_utc = ?`;
  const params: any[] = [targetDate];

  if (preset) {
    query += ` AND preset = ?`;
    params.push(preset);
  }

  const rows = db.prepare(query).all(...params) as any[];

  return rows.map((r) => {
    const valid = r.valid_signals || 0;
    const timeApp = r.time_approved || 0;
    const riskApp = r.risk_approved || 0;
    const exec = r.executed_trades || 0;

    return {
      dateUtc: r.date_utc,
      preset: r.preset,
      strategy: r.strategy,
      scans: r.scans || 0,
      setups: r.setups || 0,
      validSignals: valid,
      timeApproved: timeApp,
      riskApproved: riskApp,
      proposalValid: r.proposal_valid || 0,
      executedTrades: exec,
      timeApprovalRatePct: valid > 0 ? Number(((timeApp / valid) * 100).toFixed(1)) : 100,
      riskApprovalRatePct: timeApp > 0 ? Number(((riskApp / timeApp) * 100).toFixed(1)) : 100,
      conversionRatePct: valid > 0 ? Number(((exec / valid) * 100).toFixed(1)) : 0,
    };
  });
}
