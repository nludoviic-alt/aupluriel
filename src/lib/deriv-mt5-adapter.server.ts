/**
 * Boundary for Deriv MT5 CFD execution.  It deliberately starts in shadow
 * mode: a bridge on the VPS must implement this contract before any order can
 * be transmitted.  The three Gold engines share this adapter, never signals.
 */
export type GoldPresetId = "gold" | "goldv2" | "liquidity";

export interface Mt5SymbolSpec {
  symbol: string;
  bid: number;
  ask: number;
  tickSize: number;
  tickValue: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
}

export interface GoldOrderIntent {
  preset: GoldPresetId;
  direction: "BUY" | "SELL";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  score: number;
  riskPercent: number;
}

export interface GoldTicket {
  leg: "tp1" | "tp2" | "runner";
  volume: number;
  stopLoss: number;
  takeProfit?: number;
}

export function splitGoldPosition(totalVolume: number, spec: Mt5SymbolSpec): GoldTicket[] | null {
  const step = spec.volumeStep;
  const round = (v: number) => Math.floor(v / step + 1e-9) * step;
  const a = round(totalVolume * 0.5);
  const b = round(totalVolume * 0.3);
  const c = round(totalVolume - a - b);
  if ([a, b, c].some((v) => v < spec.volumeMin) || a + b + c > spec.volumeMax) return null;
  return [
    { leg: "tp1", volume: a, stopLoss: 0 },
    { leg: "tp2", volume: b, stopLoss: 0 },
    { leg: "runner", volume: c, stopLoss: 0 },
  ];
}

/** Position sizing from equity × risk / actual stop cost. */
export function calculateGoldVolume(equity: number, riskPercent: number, entry: number, stopLoss: number, spec: Mt5SymbolSpec): number | null {
  const ticks = Math.abs(entry - stopLoss) / spec.tickSize;
  const lossPerLot = ticks * spec.tickValue;
  if (!Number.isFinite(lossPerLot) || lossPerLot <= 0) return null;
  const raw = (equity * riskPercent) / lossPerLot;
  const normalized = Math.floor(raw / spec.volumeStep + 1e-9) * spec.volumeStep;
  return normalized >= spec.volumeMin && normalized <= spec.volumeMax ? normalized : null;
}
