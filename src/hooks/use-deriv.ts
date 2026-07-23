import { useEffect, useRef, useState } from "react";
import { fetchCandles, subscribeTicks, type DerivCandle } from "@/lib/deriv";

const TICK_FLUSH_MS = 400; // throttle UI updates for high-frequency ticks

export function useDerivTicks(symbol: string, maxPoints = 120) {
  const [series, setSeries] = useState<{ t: number; price: number }[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const dataRef = useRef<{ t: number; price: number }[]>([]);

  useEffect(() => {
    if (!symbol) {
      setStatus("error");
      return;
    }
    setSeries([]);
    setLast(null);
    setStatus("connecting");
    dataRef.current = [];

    let unsub = () => {};
    let lastFlush = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let latestPrice: number | null = null;

    const flush = () => {
      lastFlush = Date.now();
      flushTimer = null;
      setSeries(dataRef.current.slice());
      if (latestPrice !== null) setLast(latestPrice);
    };

    try {
      unsub = subscribeTicks(symbol, (tick) => {
        setStatus("live");
        const next = dataRef.current;
        next.push({ t: tick.epoch * 1000, price: tick.quote });
        if (next.length > maxPoints) next.splice(0, next.length - maxPoints);
        latestPrice = tick.quote;

        // Throttle: flush at most every TICK_FLUSH_MS
        const since = Date.now() - lastFlush;
        if (since >= TICK_FLUSH_MS) flush();
        else if (!flushTimer) flushTimer = setTimeout(flush, TICK_FLUSH_MS - since);
      });
    } catch {
      setStatus("error");
    }

    return () => {
      unsub();
      if (flushTimer) clearTimeout(flushTimer);
    };
  }, [symbol, maxPoints]);

  return { series, last, status };
}

/**
 * `refreshKey` triggers a refetch without needing to remount the component via
 * a changing React `key` — a full remount discards local state and forces
 * React to tear down/rebuild the DOM subtree, which is unnecessary here.
 *
 * In-memory cache: if multiple components request the same symbol+granularity
 * within the same render cycle (e.g. signal cards + MTF table), the fetch is
 * shared instead of duplicated — critical on mobile where each candle request
 * opens a WebSocket round-trip.
 */
const candleCache = new Map<string, { promise: Promise<DerivCandle[]>; ts: number }>();
const CACHE_TTL_MS = 30_000; // 30s — fresh enough for signals, avoids refetch storms

export function useDerivCandles(symbol: string, granularity: number, count = 200, refreshKey: number | string = 0) {
  const [candles, setCandles] = useState<DerivCandle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const cacheKey = `${symbol}:${granularity}:${count}:${refreshKey}`;
    const now = Date.now();
    let entry = candleCache.get(cacheKey);
    if (!entry || now - entry.ts > CACHE_TTL_MS) {
      entry = {
        promise: fetchCandles(symbol, granularity, count),
        ts: now,
      };
      candleCache.set(cacheKey, entry);
    }

    entry.promise
      .then((c) => {
        if (!cancelled) setCandles(c);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, granularity, count, refreshKey]);

  return { candles, loading, error };
}