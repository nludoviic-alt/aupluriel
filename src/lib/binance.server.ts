// Node-side Binance client for the SERVER auto-trader.
//
// Binance uses REST API with HMAC-SHA256 for private endpoints and WebSocket
// for real-time market data. This is for users in regions where Binance is
// available (e.g. Cameroon via P2P Mobile Money).
//
// API docs: https://binance-docs.github.io/apidocs/spot/en/
//
// Requires Node >= 18 (global fetch, global WebSocket, global crypto).

import { createHmac } from "node:crypto";

const BINANCE_REST_URL = "https://api.binance.com";
const BINANCE_WS_URL = "wss://stream.binance.com:9443/ws";

// ─── Symbol mapping: Deriv crypto → Binance ──────────────────────────────────

const BINANCE_SYMBOL_MAP: Record<string, string> = {
  "cryBTCUSD": "BTCUSDT",
  "cryETHUSD": "ETHUSDT",
  "cryLTCUSD": "LTCUSDT",
  "cryBTCUSDT": "BTCUSDT",
  "cryETHUSDT": "ETHUSDT",
};

export function derivToBinanceSymbol(derivSymbol: string): string | null {
  return BINANCE_SYMBOL_MAP[derivSymbol] ?? null;
}

export function isBinanceSymbol(derivSymbol: string): boolean {
  return derivSymbol in BINANCE_SYMBOL_MAP;
}

export const BINANCE_DERIV_SYMBOLS = Object.keys(BINANCE_SYMBOL_MAP);

// ─── Candle type ─────────────────────────────────────────────────────────────

export interface BinanceCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ─── REST client (market data) ───────────────────────────────────────────────

function getBinanceInterval(granularitySeconds: number): string {
  // Binance intervals: 1m, 5m, 15m, 30m, 1h, 4h, 1d
  const map: Record<number, string> = {
    60: "1m",
    300: "5m",
    900: "15m",
    1800: "30m",
    3600: "1h",
    14400: "4h",
    86400: "1d",
  };
  return map[granularitySeconds] ?? "15m";
}

export async function fetchBinanceCandles(
  symbol: string,
  granularitySeconds: number,
  count: number,
): Promise<BinanceCandle[]> {
  const binanceSymbol = BINANCE_SYMBOL_MAP[symbol] ?? symbol;
  const interval = getBinanceInterval(granularitySeconds);
  const url = `${BINANCE_REST_URL}/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${count}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines failed: ${res.status}`);
  const data = (await res.json()) as number[][];
  // Binance returns: [openTime, open, high, low, close, volume, closeTime, ...]
  return data.map((c) => ({
    epoch: Math.floor(c[0] / 1000),
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
  }));
}

export async function getBinancePrice(symbol: string): Promise<number> {
  const binanceSymbol = BINANCE_SYMBOL_MAP[symbol] ?? symbol;
  const url = `${BINANCE_REST_URL}/api/v3/ticker/price?symbol=${binanceSymbol}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ticker failed: ${res.status}`);
  const data = (await res.json()) as { price: string };
  return Number(data.price);
}

// ─── Authenticated REST client ───────────────────────────────────────────────

function signBinanceRequest(apiSecret: string, queryString: string): string {
  return createHmac("sha256", apiSecret).update(queryString).digest("hex");
}

async function binancePrivateRequest(
  apiKey: string,
  apiSecret: string,
  endpoint: string,
  params: Record<string, string> = {},
  method: "GET" | "POST" | "DELETE" = "GET",
): Promise<Record<string, unknown>> {
  const timestamp = Date.now().toString();
  const allParams = { ...params, timestamp };
  const queryString = new URLSearchParams(allParams).toString();
  const signature = signBinanceRequest(apiSecret, queryString);
  const url = `${BINANCE_REST_URL}${endpoint}?${queryString}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: { "X-MBX-APIKEY": apiKey },
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Binance ${endpoint} failed: ${res.status} ${errBody}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

// ─── Trading connection ──────────────────────────────────────────────────────

export interface BinanceOrderResult {
  orderId: number;
  buyPrice: number;
}

export interface BinancePositionUpdate {
  orderId: number;
  profit: number;
  status: "open" | "won" | "lost";
}

export class BinanceTradingConnection {
  constructor(
    private apiKey: string,
    private apiSecret: string,
  ) {}

  get isOpen(): boolean {
    return true; // Binance REST is stateless, always "open"
  }

  async getBalance(): Promise<{ balance: number; currency: string } | null> {
    try {
      const result = await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/account");
      const balances = (result as { balances?: Array<{ asset: string; free: string }> }).balances ?? [];
      const usdt = balances.find((b) => b.asset === "USDT");
      return { balance: Number(usdt?.free ?? 0), currency: "USDT" };
    } catch {
      return null;
    }
  }

  async getAssetPrice(symbol: string): Promise<number> {
    return getBinancePrice(symbol);
  }

  /**
   * Place a market order on Binance (spot buy/sell).
   * Binance uses quoteOrderQty for buying with a specific USD amount.
   * Stop-loss/take-profit are placed as separate STOP_MARKET/TAKE_PROFIT orders.
   */
  async placeMarketOrder(params: {
    symbol: string;
    direction: "BUY" | "SELL";
    quoteAmount: number; // amount in USD (for BUY) or base amount (for SELL)
    baseAmount?: number; // amount in base currency (for SELL)
    stopLossPrice?: number;
    takeProfitPrice?: number;
  }): Promise<BinanceOrderResult> {
    const binanceSymbol = BINANCE_SYMBOL_MAP[params.symbol] ?? params.symbol;

    // Place the market order
    const orderParams: Record<string, string> = {
      symbol: binanceSymbol,
      side: params.direction,
      type: "MARKET",
    };

    if (params.direction === "BUY") {
      // Buy with USD amount — Binance handles the conversion
      orderParams.quoteOrderQty = params.quoteAmount.toFixed(2);
    } else {
      // Sell specific base amount
      orderParams.quantity = (params.baseAmount ?? 0).toFixed(8);
    }

    const result = await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/order", orderParams, "POST");
    const orderId = (result as { orderId?: number }).orderId ?? 0;

    // Get the executed price from the order
    const fills = (result as { fills?: Array<{ price: string }> }).fills ?? [];
    const avgPrice = fills.length > 0
      ? fills.reduce((sum, f) => sum + Number(f.price), 0) / fills.length
      : await this.getAssetPrice(params.symbol);

    // Place stop-loss as a separate STOP_MARKET order (sell if we bought, buy if we sold)
    if (params.stopLossPrice) {
      try {
        const slSide = params.direction === "BUY" ? "SELL" : "BUY";
        const slQuantity = params.direction === "BUY"
          ? undefined // will use sell-repays-quote later
          : (params.baseAmount ?? 0).toFixed(8);
        const slParams: Record<string, string> = {
          symbol: binanceSymbol,
          side: slSide,
          type: "STOP_MARKET",
          stopPrice: params.stopLossPrice.toFixed(8),
          ...(slQuantity ? { quantity: slQuantity } : { closePosition: "true" }),
        };
        await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/order", slParams, "POST");
      } catch (e) {
        console.error(`[binance] Stop-loss échoué: ${(e as Error).message}`);
      }
    }

    // Place take-profit as a separate TAKE_PROFIT_MARKET order
    if (params.takeProfitPrice) {
      try {
        const tpSide = params.direction === "BUY" ? "SELL" : "BUY";
        const tpParams: Record<string, string> = {
          symbol: binanceSymbol,
          side: tpSide,
          type: "TAKE_PROFIT_MARKET",
          stopPrice: params.takeProfitPrice.toFixed(8),
          closePosition: "true",
        };
        await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/order", tpParams, "POST");
      } catch (e) {
        console.error(`[binance] Take-profit échoué: ${(e as Error).message}`);
      }
    }

    return { orderId, buyPrice: avgPrice };
  }

  /**
   * Close a position by placing a reverse market order.
   */
  async closeOrder(orderId: number, symbol: string, baseAmount: number): Promise<void> {
    const binanceSymbol = BINANCE_SYMBOL_MAP[symbol] ?? symbol;
    // Cancel any open conditional orders first
    try {
      await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/order", {
        symbol: binanceSymbol,
        orderId: orderId.toString(),
      }, "DELETE");
    } catch { /* ignore if already filled */ }

    // Place reverse market order to close
    await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/order", {
      symbol: binanceSymbol,
      side: "SELL",
      type: "MARKET",
      quantity: baseAmount.toFixed(8),
    }, "POST");
  }

  async getOrderInfo(orderId: number, symbol: string): Promise<{ status: string; executedQty: number; avgPrice: number }> {
    const binanceSymbol = BINANCE_SYMBOL_MAP[symbol] ?? symbol;
    const result = await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/order", {
      symbol: binanceSymbol,
      orderId: orderId.toString(),
    });
    return {
      status: String((result as { status?: string }).status ?? "UNKNOWN"),
      executedQty: Number((result as { executedQty?: string }).executedQty ?? 0),
      avgPrice: Number((result as { avgPrice?: string }).avgPrice ?? 0),
    };
  }

  async getOpenOrders(symbol?: string): Promise<Array<{ orderId: number; symbol: string; side: string; type: string }>> {
    const params: Record<string, string> = {};
    if (symbol) {
      params.symbol = BINANCE_SYMBOL_MAP[symbol] ?? symbol;
    }
    const result = await binancePrivateRequest(this.apiKey, this.apiSecret, "/api/v3/openOrders", params);
    const orders = (result as unknown as Array<{ orderId: number; symbol: string; side: string; type: string }>) ?? [];
    return orders.map((o) => ({ orderId: o.orderId, symbol: o.symbol, side: o.side, type: o.type }));
  }

  close() {
    // Binance REST is stateless — nothing to close
  }
}

// ─── Shared market data socket (all users) ───────────────────────────────────

let binanceWs: WebSocket | null = null;

export function closeBinanceSocket(): void {
  try { binanceWs?.close(); } catch { /* ignore */ }
  binanceWs = null;
}
