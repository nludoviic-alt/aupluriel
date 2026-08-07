import { getDb } from "./db.server";
import { fetchCandlesServer, type ServerCandle } from "./deriv.server";

export interface StoredCandle {
  symbol: string;
  granularity: number;
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Saves a list of candles to the local SQLite database.
 */
export function saveHistoricalCandles(symbol: string, granularity: number, candles: ServerCandle[]): number {
  if (!candles || candles.length === 0) return 0;
  const db = getDb();
  const insertStmt = db.prepare(`
    INSERT INTO historical_candles (symbol, granularity, epoch, open, high, low, close)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, granularity, epoch) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close
  `);

  const insertMany = db.transaction((items: ServerCandle[]) => {
    let count = 0;
    for (const c of items) {
      if (c && c.epoch && c.close > 0) {
        insertStmt.run(symbol, granularity, c.epoch, c.open, c.high, c.low, c.close);
        count++;
      }
    }
    return count;
  });

  return insertMany(candles);
}

/**
 * Queries stored historical candles from local SQLite DB.
 */
export function getStoredHistoricalCandles(symbol: string, granularity: number, limit = 5000): ServerCandle[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT epoch, open, high, low, close
    FROM historical_candles
    WHERE symbol = ? AND granularity = ?
    ORDER BY epoch ASC
    LIMIT ?
  `).all(symbol, granularity, limit) as ServerCandle[];
  return rows;
}

/**
 * Cache-first candle fetch for research tools that repeatedly re-analyze the
 * same symbol/granularity (e.g. strategy-tournament comparing 4 engines
 * across N symbols) — tune-multi-preset's own SKILL.md flags the "no caching,
 * fetch-per-call" cost of the existing backtest*Server functions as a real
 * limitation; this is the fix for NEW callers, not a change to those
 * functions (which back the live scheduled auto-backtest job and must keep
 * their current direct-fetch behavior). Falls through to a live fetch (and
 * persists it) whenever the cached tail is short or stale.
 */
export async function getCachedCandlesServer(
  symbol: string,
  granularitySec: number,
  count: number,
  maxAgeMs = 15 * 60_000,
): Promise<ServerCandle[]> {
  const stored = getStoredHistoricalCandles(symbol, granularitySec, count);
  const newestEpoch = stored.length ? stored[stored.length - 1].epoch : 0;
  const isFresh = stored.length >= count && Date.now() - newestEpoch * 1000 < maxAgeMs;
  if (isFresh) return stored;

  const fresh = await fetchCandlesServer(symbol, granularitySec, count).catch(() => []);
  if (fresh.length) saveHistoricalCandles(symbol, granularitySec, fresh);
  return fresh.length >= stored.length ? fresh : stored;
}

/**
 * Paginated historical candle fetcher. Downloads up to targetCount candles
 * going back in time from Deriv API and stores them in SQLite.
 */
export async function syncHistoricalCandles(
  symbol: string,
  granularity = 900,
  targetCount = 10000,
): Promise<{ totalStored: number; newFetched: number }> {
  let endEpoch = Math.floor(Date.now() / 1000);
  let fetchedTotal = 0;
  const batchSize = 1000;

  while (fetchedTotal < targetCount) {
    const candles = await fetchCandlesServer(symbol, granularity, batchSize, endEpoch).catch(() => []);
    if (!candles || candles.length === 0) break;

    const saved = saveHistoricalCandles(symbol, granularity, candles);
    fetchedTotal += candles.length;

    // Earliest epoch in this batch
    const oldestEpoch = Math.min(...candles.map((c) => c.epoch));
    if (oldestEpoch >= endEpoch) break; // Reached end of data
    endEpoch = oldestEpoch - 1;

    // Sleep 150ms to respect Deriv API rate limits
    await new Promise((r) => setTimeout(r, 150));
  }

  const db = getDb();
  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM historical_candles WHERE symbol = ? AND granularity = ?
  `).get(symbol, granularity) as { cnt: number };

  return { totalStored: countRow.cnt, newFetched: fetchedTotal };
}
