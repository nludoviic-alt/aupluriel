import { getDb } from "./db.server";
import { generateSignal, type Candle } from "./indicators";
import { ConfigRegistry } from "./config-registry.server";

export interface ReplayOptions {
  userId: number;
  preset: string;
  versionId: string;
  symbol: string;
  granularity?: number; // default 60 (M1)
  startTime?: number;
  endTime?: number;
}

export interface ReplayTradeResult {
  tradeId: string;
  time: number;
  symbol: string;
  direction: "CALL" | "PUT";
  entryPrice: number;
  exitPrice: number;
  stake: number;
  profit: number;
  won: boolean;
  confidence: number;
  tfAgreement: number;
  decisionReason: string;
}

export interface ReplayExecutionResult {
  versionId: string;
  versionTag: string;
  preset: string;
  symbol: string;
  granularity: number;
  candlesAnalyzed: number;
  tradesPlaced: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalProfitUsd: number;
  profitFactor: number;
  maxDrawdownUsd: number;
  trades: ReplayTradeResult[];
  rejectionsCount: number;
}

export class ReplayEngine {
  /**
   * Executes a deterministic simulation replay of historical candles against a strategy version.
   */
  static runReplay(opts: ReplayOptions): ReplayExecutionResult {
    const { userId, preset, versionId, symbol, granularity = 60 } = opts;
    const db = getDb();

    // 1. Fetch version config
    const versionRow = db
      .prepare("SELECT * FROM config_versions WHERE id = ? AND user_id = ? AND preset = ?")
      .get(versionId, userId, preset) as any;

    if (!versionRow) {
      throw new Error(`Strategy version ${versionId} not found.`);
    }

    const config = JSON.parse(versionRow.config_json);

    // 2. Fetch candles from historical_candles
    let query = "SELECT open, high, low, close, epoch FROM historical_candles WHERE symbol = ? AND granularity = ?";
    const params: any[] = [symbol, granularity];

    if (opts.startTime) {
      query += " AND epoch >= ?";
      params.push(Math.floor(opts.startTime / 1000));
    }
    if (opts.endTime) {
      query += " AND epoch <= ?";
      params.push(Math.floor(opts.endTime / 1000));
    }
    query += " ORDER BY epoch ASC";

    const candleRows = db.prepare(query).all(...params) as {
      open: number;
      high: number;
      low: number;
      close: number;
      epoch: number;
    }[];

    const candles: Candle[] = candleRows.map((r) => ({
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      time: r.epoch * 1000,
    }));

    const trades: ReplayTradeResult[] = [];
    let rejectionsCount = 0;
    let peakEquity = 0;
    let maxDrawdown = 0;
    let currentEquity = 0;

    const minConfidence = config.minConfidence ?? 70;
    const stake = config.stakeUsd ?? 10;
    const lookback = 30; // Minimum candles required for indicators

    // 3. Replay loop candle by candle
    for (let i = lookback; i < candles.length - 1; i++) {
      const windowCandles = candles.slice(i - lookback, i + 1);
      const signal = generateSignal(windowCandles);

      if (!signal || signal.confidence < minConfidence) {
        rejectionsCount++;
        continue;
      }

      // Check trade outcome on subsequent candles (simple 5-candle horizon evaluation)
      const entryCandle = candles[i];
      const exitCandle = candles[Math.min(i + 5, candles.length - 1)];

      const direction = signal.bias === "BULLISH" ? "CALL" : "PUT";
      const won =
        direction === "CALL"
          ? exitCandle.close > entryCandle.close
          : exitCandle.close < entryCandle.close;

      const payoutMultiplier = 0.95; // 95% payout for winning trade
      const profit = won ? stake * payoutMultiplier : -stake;

      currentEquity += profit;
      if (currentEquity > peakEquity) peakEquity = currentEquity;
      const dd = peakEquity - currentEquity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      trades.push({
        tradeId: `rtrade_${i}_${candles[i].time}`,
        time: candles[i].time,
        symbol,
        direction,
        entryPrice: entryCandle.close,
        exitPrice: exitCandle.close,
        stake,
        profit: Number(profit.toFixed(2)),
        won,
        confidence: signal.confidence,
        tfAgreement: 100,
        decisionReason: `Signal bias ${signal.bias} (conf: ${signal.confidence}%)`,
      });
    }

    const wins = trades.filter((t) => t.won).length;
    const losses = trades.length - wins;
    const winRate = trades.length > 0 ? wins / trades.length : 0;
    const totalProfit = trades.reduce((acc, t) => acc + t.profit, 0);

    const grossProfit = trades.filter((t) => t.won).reduce((acc, t) => acc + t.profit, 0);
    const grossLoss = Math.abs(trades.filter((t) => !t.won).reduce((acc, t) => acc + t.profit, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.99 : 0;

    return {
      versionId,
      versionTag: versionRow.version_tag,
      preset,
      symbol,
      granularity,
      candlesAnalyzed: candles.length,
      tradesPlaced: trades.length,
      winCount: wins,
      lossCount: losses,
      winRate: Number(winRate.toFixed(4)),
      totalProfitUsd: Number(totalProfit.toFixed(2)),
      profitFactor: Number(profitFactor.toFixed(2)),
      maxDrawdownUsd: Number(maxDrawdown.toFixed(2)),
      trades,
      rejectionsCount,
    };
  }
}
