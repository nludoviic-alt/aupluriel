// Pure-JS technical indicators (no external lib).
// Inputs are arrays of close prices unless stated otherwise.

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      const slice = values.slice(0, period);
      prev = slice.reduce((a, b) => a + b, 0) / period;
      out.push(prev);
      continue;
    }
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = [null];
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = Math.max(diff, 0);
    const loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        out.push(100 - 100 / (1 + rs));
      } else {
        out.push(null);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

export function macd(values: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f !== null && s !== null ? f - s : null;
  });
  const cleaned = macdLine.map((v) => (v === null ? 0 : v));
  const signalLine = ema(cleaned, signal).map((v, i) => (macdLine[i] === null ? null : v));
  const hist = macdLine.map((m, i) =>
    m !== null && signalLine[i] !== null ? m - (signalLine[i] as number) : null,
  );
  return { macd: macdLine, signal: signalLine, histogram: hist };
}

export function bollinger(values: number[], period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1 || mid[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    const m = mid[i] as number;
    const variance = slice.reduce((acc, v) => acc + (v - m) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper.push(m + mult * sd);
    lower.push(m - mult * sd);
  }
  return { upper, middle: mid, lower };
}

export function atr(high: number[], low: number[], close: number[], period = 14): (number | null)[] {
  const tr: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i === 0) {
      tr.push(high[i] - low[i]);
    } else {
      tr.push(
        Math.max(
          high[i] - low[i],
          Math.abs(high[i] - close[i - 1]),
          Math.abs(low[i] - close[i - 1]),
        ),
      );
    }
  }
  return ema(tr, period);
}

/**
 * ADX (Average Directional Index) — measures trend STRENGTH (not direction).
 * ADX > 25 = strong trend, ADX < 20 = ranging/no trend.
 * Returns { adx, plusDI, minusDI }.
 */
export function adx(high: number[], low: number[], close: number[], period = 14) {
  const len = close.length;
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [high[0] - low[0]];

  for (let i = 1; i < len; i++) {
    const upMove = high[i] - high[i - 1];
    const downMove = low[i - 1] - low[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(
      Math.max(
        high[i] - low[i],
        Math.abs(high[i] - close[i - 1]),
        Math.abs(low[i] - close[i - 1]),
      ),
    );
  }

  // Wilder's smoothing
  const smooth = (arr: number[]): (number | null)[] => {
    const out: (number | null)[] = [];
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      if (i < period) {
        sum += arr[i];
        out.push(i === period - 1 ? sum : null);
      } else {
        const prev = out[i - 1] as number;
        out.push(prev - prev / period + arr[i]);
      }
    }
    return out;
  };

  const trS = smooth(tr);
  const plusS = smooth(plusDM);
  const minusS = smooth(minusDM);

  const plusDI: (number | null)[] = [];
  const minusDI: (number | null)[] = [];
  const dx: (number | null)[] = [];
  for (let i = 0; i < len; i++) {
    const t = trS[i];
    const p = plusS[i];
    const m = minusS[i];
    if (t === null || p === null || m === null || t === 0) {
      plusDI.push(null); minusDI.push(null); dx.push(null);
      continue;
    }
    const pdi = (p / t) * 100;
    const mdi = (m / t) * 100;
    plusDI.push(pdi);
    minusDI.push(mdi);
    const sum = pdi + mdi;
    dx.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }

  // ADX = smoothed DX
  const adxLine: (number | null)[] = [];
  let firstIdx = dx.findIndex((v) => v !== null);
  let count = 0;
  let runningSum = 0;
  let prevAdx: number | null = null;
  for (let i = 0; i < len; i++) {
    if (dx[i] === null || firstIdx < 0) { adxLine.push(null); continue; }
    if (i < firstIdx + period) {
      runningSum += dx[i] as number;
      count++;
      if (count === period) {
        prevAdx = runningSum / period;
        adxLine.push(prevAdx);
      } else {
        adxLine.push(null);
      }
    } else {
      prevAdx = ((prevAdx as number) * (period - 1) + (dx[i] as number)) / period;
      adxLine.push(prevAdx);
    }
  }

  return { adx: adxLine, plusDI, minusDI };
}

export interface PriceLevel {
  price: number;
  type: "support" | "resistance";
  strength: number; // number of touches
}

/**
 * Detect support/resistance via swing highs/lows (fractal method).
 * Clusters nearby swing points into levels. Returns levels sorted by strength.
 */
export function findLevels(
  candles: { high: number; low: number; close: number }[],
  lookback = 2,
  tolerancePct = 0.4,
): PriceLevel[] {
  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHigh = false;
      if (candles[i].low >= candles[i - j].low || candles[i].low >= candles[i + j].low) isLow = false;
    }
    if (isHigh) swingHighs.push(candles[i].high);
    if (isLow) swingLows.push(candles[i].low);
  }

  const cluster = (points: number[], type: "support" | "resistance"): PriceLevel[] => {
    const levels: PriceLevel[] = [];
    for (const p of points) {
      const existing = levels.find((l) => Math.abs(l.price - p) / l.price < tolerancePct / 100);
      if (existing) {
        existing.price = (existing.price * existing.strength + p) / (existing.strength + 1);
        existing.strength += 1;
      } else {
        levels.push({ price: p, type, strength: 1 });
      }
    }
    return levels;
  };

  return [...cluster(swingHighs, "resistance"), ...cluster(swingLows, "support")]
    .sort((a, b) => b.strength - a.strength);
}

export type SignalDirection = "BUY" | "SELL" | "HOLD";

export interface GeneratedSignal {
  direction: SignalDirection;
  confidence: number; // 0-100
  triggers: string[];
  quality?: "premium" | "good" | "weak"; // signal grade
  blockers?: string[]; // reasons a signal was downgraded/rejected
}

export interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

type CandleLike = { high: number; low: number; close: number };

/**
 * Advanced multi-factor signal engine.
 * Accepts full candles (preferred) or a closes-only array (degraded mode).
 *
 * Strict, selective logic designed to REDUCE losing trades:
 *  - Volatility filter (ATR%): rejects dead/erratic markets
 *  - Trend strength filter (ADX): only trend-trades when ADX confirms
 *  - Confluence scoring: RSI + MACD + EMA + Stochastic + S/R must agree
 *  - Conflicting-signal penalty: opposing indicators lower confidence
 *  - Calibrated confidence: based on agreement ratio, not a flat formula
 */
export function generateSignal(input: number[] | Candle[]): GeneratedSignal {
  // Normalize input
  const isCandles = input.length > 0 && typeof input[0] === "object";
  const closes = isCandles ? (input as Candle[]).map((c) => c.close) : (input as number[]);
  const highs = isCandles ? (input as Candle[]).map((c) => c.high) : closes;
  const lows = isCandles ? (input as Candle[]).map((c) => c.low) : closes;
  const candles: CandleLike[] = isCandles
    ? (input as Candle[])
    : closes.map((c) => ({ high: c, low: c, close: c }));

  if (closes.length < 60) {
    return { direction: "HOLD", confidence: 0, triggers: ["insufficient-data"], quality: "weak" };
  }

  const last = closes.length - 1;
  const price = closes[last];
  const triggers: string[] = [];
  const blockers: string[] = [];
  let bull = 0; // bullish points
  let bear = 0; // bearish points
  let maxPoints = 0;

  // ── 1. Volatility filter (ATR%) ──────────────────────────────
  const atrArr = atr(highs, lows, closes, 14);
  const atrNow = atrArr[last];
  const atrPct = atrNow !== null ? (atrNow / price) * 100 : null;
  let volOk = true;
  if (atrPct !== null) {
    if (atrPct < 0.05) {
      volOk = false;
      blockers.push(`Volatilité trop faible (ATR ${atrPct.toFixed(2)}%) — marché plat`);
    } else if (atrPct > 5) {
      blockers.push(`Volatilité extrême (ATR ${atrPct.toFixed(2)}%) — risque élevé`);
    }
  }

  // ── 2. Trend strength (ADX) ──────────────────────────────────
  const { adx: adxArr, plusDI, minusDI } = adx(highs, lows, closes, 14);
  const adxNow = adxArr[last];
  const pdiNow = plusDI[last];
  const mdiNow = minusDI[last];
  const strongTrend = adxNow !== null && adxNow > 25;
  const ranging = adxNow !== null && adxNow < 20;
  if (adxNow !== null) {
    if (strongTrend) {
      triggers.push(`ADX ${adxNow.toFixed(0)} — tendance forte`);
      maxPoints += 2;
      if (pdiNow !== null && mdiNow !== null) {
        if (pdiNow > mdiNow) bull += 2;
        else bear += 2;
      }
    } else if (ranging) {
      blockers.push(`ADX ${adxNow.toFixed(0)} — marché sans tendance`);
    }
  }

  // ── 3. RSI ───────────────────────────────────────────────────
  const r = rsi(closes, 14);
  const rNow = r[last];
  maxPoints += 2;
  if (rNow !== null) {
    if (rNow < 30) { bull += 2; triggers.push(`RSI ${rNow.toFixed(1)} (survendu)`); }
    else if (rNow > 70) { bear += 2; triggers.push(`RSI ${rNow.toFixed(1)} (suracheté)`); }
    else if (rNow < 45) { bull += 1; }
    else if (rNow > 55) { bear += 1; }
  }

  // ── 4. MACD cross ────────────────────────────────────────────
  const { macd: m, signal: s } = macd(closes);
  const mNow = m[last], mPrev = m[last - 1], sNow = s[last], sPrev = s[last - 1];
  maxPoints += 2;
  if (mNow !== null && sNow !== null && mPrev !== null && sPrev !== null) {
    if (mPrev < sPrev && mNow > sNow) { bull += 2; triggers.push("MACD cross haussier"); }
    else if (mPrev > sPrev && mNow < sNow) { bear += 2; triggers.push("MACD cross baissier"); }
    else if (mNow > sNow) { bull += 1; }
    else if (mNow < sNow) { bear += 1; }
  }

  // ── 5. EMA trend ─────────────────────────────────────────────
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const e50n = e50[last], e200n = e200[last];
  maxPoints += 1;
  if (e50n !== null && e200n !== null) {
    if (e50n > e200n) { bull += 1; triggers.push("EMA50 > EMA200 (haussier)"); }
    else { bear += 1; triggers.push("EMA50 < EMA200 (baissier)"); }
  }

  // ── 6. Stochastic confirmation ───────────────────────────────
  const stoch = stochastic(highs, lows, closes, 14, 3);
  const kNow = stoch.k[last];
  maxPoints += 1;
  if (kNow !== null) {
    if (kNow < 20) { bull += 1; triggers.push(`Stoch ${kNow.toFixed(0)} (survendu)`); }
    else if (kNow > 80) { bear += 1; triggers.push(`Stoch ${kNow.toFixed(0)} (suracheté)`); }
  }

  // ── 7. Support/Resistance confluence ─────────────────────────
  if (isCandles) {
    const levels = findLevels(candles, 2, 0.4);
    const near = levels.find((l) => Math.abs(l.price - price) / price < 0.5 / 100);
    maxPoints += 2;
    if (near) {
      if (near.type === "support") {
        bull += 2;
        triggers.push(`Prix sur support (${near.strength} touches)`);
      } else {
        bear += 2;
        triggers.push(`Prix sur résistance (${near.strength} touches)`);
      }
    }
  }

  // ── Decision ─────────────────────────────────────────────────
  const net = bull - bear;
  const total = bull + bear;
  let direction: SignalDirection = "HOLD";

  // Hard blocks: no trade in dead markets or ranging conditions for trend signals
  if (!volOk) {
    return { direction: "HOLD", confidence: 0, triggers, quality: "weak", blockers };
  }

  // Require a meaningful net edge AND that the dominant side clearly outweighs the other
  const dominance = total > 0 ? Math.max(bull, bear) / total : 0;
  if (net >= 4 && dominance >= 0.7) direction = "BUY";
  else if (net <= -4 && dominance >= 0.7) direction = "SELL";

  // Calibrated confidence: agreement ratio × strength, penalized by conflict
  let confidence = 0;
  if (direction !== "HOLD") {
    const ratio = maxPoints > 0 ? Math.max(bull, bear) / maxPoints : 0; // 0-1
    const conflict = Math.min(bull, bear) / (total || 1); // how much opposes
    confidence = Math.round((0.5 + ratio * 0.5 - conflict * 0.3) * 100);
    if (strongTrend) confidence += 3;
    if (ranging) confidence -= 8;
    confidence = Math.min(95, Math.max(40, confidence));
  }

  const quality: GeneratedSignal["quality"] =
    confidence >= 80 ? "premium" : confidence >= 65 ? "good" : "weak";

  return { direction, confidence, triggers, quality, blockers: blockers.length ? blockers : undefined };
}

export function stochastic(
  high: number[],
  low: number[],
  close: number[],
  kPeriod = 14,
  dPeriod = 3,
): { k: (number | null)[]; d: (number | null)[] } {
  const kLine: (number | null)[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i < kPeriod - 1) { kLine.push(null); continue; }
    const sliceH = high.slice(i - kPeriod + 1, i + 1);
    const sliceL = low.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...sliceH);
    const ll = Math.min(...sliceL);
    kLine.push(hh === ll ? 50 : ((close[i] - ll) / (hh - ll)) * 100);
  }
  const kClean = kLine.map((v) => v ?? 0);
  const dRaw = sma(kClean, dPeriod);
  const dLine: (number | null)[] = dRaw.map((v, i) => (kLine[i] === null ? null : v));
  return { k: kLine, d: dLine };
}

export interface TradeRecord {
  entryEpoch: number;
  exitEpoch: number;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  won: boolean;
}

export interface BacktestResult {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  roi: number; // %
  maxDrawdown: number; // %
  sharpe: number;
  equity: { t: number; value: number }[];
  tradeList: TradeRecord[];
}

function buildResult(
  initialCash: number,
  cash: number,
  tradeList: TradeRecord[],
  equity: { t: number; value: number }[],
  maxDd: number,
): BacktestResult {
  const wins = tradeList.filter((t) => t.won).length;
  const losses = tradeList.filter((t) => !t.won).length;
  const trades = tradeList.length;
  const returns = tradeList.map((t) => t.pnlPct / 100);
  const roi = ((cash - initialCash) / initialCash) * 100;
  const winRate = trades > 0 ? (wins / trades) * 100 : 0;
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length || 1);
  const sharpe = variance > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;
  return { trades, wins, losses, winRate, roi, maxDrawdown: maxDd * 100, sharpe, equity, tradeList };
}

/** Simple long-only RSI/MACD backtest on candles. */
export function backtestRsiMacd(candles: Candle[]): BacktestResult {
  const closes = candles.map((c) => c.close);
  const r = rsi(closes, 14);
  const { macd: m, signal: s } = macd(closes);
  const INITIAL = 10000;
  let cash = INITIAL;
  let units = 0;
  let entryPrice = 0;
  let entryEpoch = 0;
  const equity: { t: number; value: number }[] = [];
  const tradeList: TradeRecord[] = [];
  let peak = cash;
  let maxDd = 0;

  for (let i = 1; i < candles.length; i++) {
    const price = closes[i];
    const rPrev = r[i - 1];
    const mPrev = m[i - 1];
    const sPrev = s[i - 1];
    const mNow = m[i];
    const sNow = s[i];

    if (
      units === 0 &&
      rPrev !== null && rPrev < 40 &&
      mPrev !== null && sPrev !== null && mNow !== null && sNow !== null &&
      mPrev < sPrev && mNow > sNow
    ) {
      units = cash / price;
      entryPrice = price;
      entryEpoch = candles[i].epoch;
      cash = 0;
    } else if (
      units > 0 &&
      ((rPrev !== null && rPrev > 70) ||
        (mPrev !== null && sPrev !== null && mNow !== null && sNow !== null && mPrev > sPrev && mNow < sNow))
    ) {
      cash = units * price;
      const pnlPct = ((price - entryPrice) / entryPrice) * 100;
      tradeList.push({ entryEpoch, exitEpoch: candles[i].epoch, entryPrice, exitPrice: price, pnlPct, won: pnlPct > 0 });
      units = 0;
    }

    const value = cash + units * price;
    equity.push({ t: candles[i].epoch, value });
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  if (units > 0) {
    const price = closes[closes.length - 1];
    cash = units * price;
    const pnlPct = ((price - entryPrice) / entryPrice) * 100;
    tradeList.push({ entryEpoch, exitEpoch: candles[candles.length - 1].epoch, entryPrice, exitPrice: price, pnlPct, won: pnlPct > 0 });
  }

  return buildResult(INITIAL, cash, tradeList, equity, maxDd);
}

/** EMA cross (golden/death cross) long-only backtest. */
export function backtestEmaCross(candles: Candle[], fast = 50, slow = 200): BacktestResult {
  const closes = candles.map((c) => c.close);
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const INITIAL = 10000;
  let cash = INITIAL;
  let units = 0;
  let entryPrice = 0;
  let entryEpoch = 0;
  const equity: { t: number; value: number }[] = [];
  const tradeList: TradeRecord[] = [];
  let peak = cash;
  let maxDd = 0;

  for (let i = 1; i < candles.length; i++) {
    const price = closes[i];
    const fPrev = emaFast[i - 1];
    const sPrev = emaSlow[i - 1];
    const fNow = emaFast[i];
    const sNow = emaSlow[i];
    if (fPrev === null || sPrev === null || fNow === null || sNow === null) {
      equity.push({ t: candles[i].epoch, value: cash + units * price });
      continue;
    }

    if (units === 0 && fPrev <= sPrev && fNow > sNow) {
      units = cash / price;
      entryPrice = price;
      entryEpoch = candles[i].epoch;
      cash = 0;
    } else if (units > 0 && fPrev >= sPrev && fNow < sNow) {
      cash = units * price;
      const pnlPct = ((price - entryPrice) / entryPrice) * 100;
      tradeList.push({ entryEpoch, exitEpoch: candles[i].epoch, entryPrice, exitPrice: price, pnlPct, won: pnlPct > 0 });
      units = 0;
    }

    const value = cash + units * price;
    equity.push({ t: candles[i].epoch, value });
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  if (units > 0) {
    const price = closes[closes.length - 1];
    cash = units * price;
    const pnlPct = ((price - entryPrice) / entryPrice) * 100;
    tradeList.push({ entryEpoch, exitEpoch: candles[candles.length - 1].epoch, entryPrice, exitPrice: price, pnlPct, won: pnlPct > 0 });
  }

  return buildResult(INITIAL, cash, tradeList, equity, maxDd);
}

/** Bollinger Band mean-reversion long-only backtest. */
export function backtestBollinger(candles: Candle[], period = 20, mult = 2): BacktestResult {
  const closes = candles.map((c) => c.close);
  const bb = bollinger(closes, period, mult);
  const INITIAL = 10000;
  let cash = INITIAL;
  let units = 0;
  let entryPrice = 0;
  let entryEpoch = 0;
  const equity: { t: number; value: number }[] = [];
  const tradeList: TradeRecord[] = [];
  let peak = cash;
  let maxDd = 0;

  for (let i = 1; i < candles.length; i++) {
    const price = closes[i];
    const lower = bb.lower[i];
    const upper = bb.upper[i];
    const mid = bb.middle[i];
    if (lower === null || upper === null || mid === null) {
      equity.push({ t: candles[i].epoch, value: cash + units * price });
      continue;
    }

    if (units === 0 && price <= lower) {
      units = cash / price;
      entryPrice = price;
      entryEpoch = candles[i].epoch;
      cash = 0;
    } else if (units > 0 && price >= mid) {
      cash = units * price;
      const pnlPct = ((price - entryPrice) / entryPrice) * 100;
      tradeList.push({ entryEpoch, exitEpoch: candles[i].epoch, entryPrice, exitPrice: price, pnlPct, won: pnlPct > 0 });
      units = 0;
    }

    const value = cash + units * price;
    equity.push({ t: candles[i].epoch, value });
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  if (units > 0) {
    const price = closes[closes.length - 1];
    cash = units * price;
    const pnlPct = ((price - entryPrice) / entryPrice) * 100;
    tradeList.push({ entryEpoch, exitEpoch: candles[candles.length - 1].epoch, entryPrice, exitPrice: price, pnlPct, won: pnlPct > 0 });
  }

  return buildResult(INITIAL, cash, tradeList, equity, maxDd);
}