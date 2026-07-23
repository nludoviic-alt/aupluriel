// Node-side Kraken client for the SERVER auto-trader.
//
// Kraken uses a REST API with HMAC-SHA512 authentication for private endpoints,
// and a WebSocket for real-time market data and order updates.
//
// API docs: https://docs.kraken.com/rest/, https://docs.kraken.com/websockets/
//
// Requires Node >= 18 (global fetch, global WebSocket, global crypto.subtle).

import { createHmac } from "node:crypto";

const KRAKEN_REST_URL = "https://api.kraken.com";
const KRAKEN_WS_URL = "wss://ws.kraken.com";
const KRAKEN_AUTH_WS_URL = "wss://ws-auth.kraken.com";

// ─── Symbol mapping: Deriv crypto → Kraken ───────────────────────────────────

const KRAKEN_SYMBOL_MAP: Record<string, string> = {
  "cryBTCUSD": "XBT/USD",
  "cryETHUSD": "ETH/USD",
  "cryLTCUSD": "LTC/USD",
  "cryBTCUSDT": "XBT/USDT",
  "cryETHUSDT": "ETH/USDT",
};

const KRAKEN_WS_SYMBOL_MAP: Record<string, string> = {
  "XBT/USD": "XBT/USD",
  "ETH/USD": "ETH/USD",
  "LTC/USD": "LTC/USD",
  "XBT/USDT": "XBT/USDT",
  "ETH/USDT": "ETH/USDT",
};

export function derivToKrakenSymbol(derivSymbol: string): string | null {
  return KRAKEN_SYMBOL_MAP[derivSymbol] ?? null;
}

export function isKrakenSymbol(derivSymbol: string): boolean {
  return derivSymbol in KRAKEN_SYMBOL_MAP;
}

export const KRAKEN_DERIV_SYMBOLS = Object.keys(KRAKEN_SYMBOL_MAP);

// ─── Candle type (same shape as Deriv ServerCandle) ──────────────────────────

export interface KrakenCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ─── REST client (market data + private endpoints) ───────────────────────────

function getKrakenInterval(granularitySeconds: number): number {
  // Kraken OHLC intervals: 1, 5, 15, 30, 60, 240, 1440, 10080, 21600
  const valid = [60, 300, 900, 1800, 3600, 14400, 86400, 604800, 21600];
  return valid.reduce((prev, curr) =>
    Math.abs(curr - granularitySeconds) < Math.abs(prev - granularitySeconds) ? curr : prev
  );
}

export async function fetchKrakenCandles(
  symbol: string,
  granularitySeconds: number,
  count: number,
): Promise<KrakenCandle[]> {
  const krakenSymbol = KRAKEN_SYMBOL_MAP[symbol] ?? symbol;
  const interval = getKrakenInterval(granularitySeconds);
  const url = `${KRAKEN_REST_URL}/0/public/OHLC?pair=${encodeURIComponent(krakenSymbol)}&interval=${interval}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kraken OHLC failed: ${res.status}`);
  const data = (await res.json()) as { error?: string[]; result?: Record<string, unknown> };
  if (data.error?.length) throw new Error(`Kraken error: ${data.error.join(", ")}`);
  if (!data.result) return [];
  // result has the pair name as key (last key is "last" timestamp)
  const pairKey = Object.keys(data.result).find((k) => k !== "last");
  if (!pairKey) return [];
  const candles = (data.result[pairKey] as number[][]).map((c) => ({
    epoch: c[0],
    open: Number(c[1]),
    high: Number(c[2]),
    low: Number(c[3]),
    close: Number(c[4]),
  }));
  // Kraken returns oldest→newest; we want newest first to match Deriv convention
  return candles.slice(-count).reverse();
}

export async function getKrakenPrice(symbol: string): Promise<number> {
  const krakenSymbol = KRAKEN_SYMBOL_MAP[symbol] ?? symbol;
  const url = `${KRAKEN_REST_URL}/0/public/Ticker?pair=${encodeURIComponent(krakenSymbol)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kraken ticker failed: ${res.status}`);
  const data = (await res.json()) as { error?: string[]; result?: Record<string, Record<string, string[]>> };
  if (data.error?.length) throw new Error(`Kraken error: ${data.error.join(", ")}`);
  if (!data.result) return 0;
  const pairKey = Object.keys(data.result)[0];
  const ticker = data.result[pairKey];
  // "c" = last trade price: [price, volume]
  return Number(ticker?.c?.[0] ?? 0);
}

// ─── Authenticated REST client ───────────────────────────────────────────────

function signKrakenRequest(
  apiSecret: string,
  urlPath: string,
  nonce: string,
  postData: Record<string, string>,
): string {
  const postDataStr = new URLSearchParams(postData).toString();
  const encoded = new URLSearchParams({ ...postData, nonce }).toString();
  // Step 1: SHA256 of nonce + postdata
  const sha256 = createHmac("sha256", "");
  // Kraken uses: HMAC-SHA512 of (urlPath + SHA256(nonce + postdata)) with base64-decoded apiSecret
  const message = urlPath + createHmac("sha256", nonce + encoded).digest();
  // Actually, Kraken's signing is: base64(HMAC-SHA512(urlPath + SHA256(nonce + postdata), base64decode(apiSecret)))
  // Let's do it properly:
  const step1 = createHmac("sha256", Buffer.from(nonce + encoded)).digest();
  const secret = Buffer.from(apiSecret, "base64");
  const signature = createHmac("sha512", secret).update(urlPath + step1).digest("base64");
  return signature;
}

export async function krakenPrivateRequest(
  apiKey: string,
  apiSecret: string,
  endpoint: string,
  params: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const urlPath = `/0/private/${endpoint}`;
  const nonce = Date.now().toString() + "000";
  const postData = { ...params, nonce };
  const signature = signKrakenRequest(apiSecret, urlPath, nonce, postData);

  const res = await fetch(`${KRAKEN_REST_URL}${urlPath}`, {
    method: "POST",
    headers: {
      "API-Key": apiKey,
      "API-Sign": signature,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(postData).toString(),
  });

  if (!res.ok) throw new Error(`Kraken ${endpoint} failed: ${res.status}`);
  const data = (await res.json()) as { error?: string[]; result?: Record<string, unknown> };
  if (data.error?.length) throw new Error(`Kraken error: ${data.error.join(", ")}`);
  return data.result ?? {};
}

// ─── Trading connection (mirrors DerivTradingConnection interface) ───────────

export interface KrakenOrderResult {
  orderId: string;
  buyPrice: number;
}

export interface KrakenPositionUpdate {
  orderId: string;
  profit: number;
  status: "open" | "won" | "lost";
}

export class KrakenTradingConnection {
  private ws: WebSocket | null = null;
  private authWs: WebSocket | null = null;
  private closedByUs = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private orderUpdateListeners = new Set<(u: KrakenPositionUpdate) => void>();

  constructor(
    private apiKey: string,
    private apiSecret: string,
  ) {}

  get isOpen(): boolean {
    return this.authWs !== null && this.authWs.readyState === WebSocket.OPEN;
  }

  async getBalance(): Promise<{ balance: number; currency: string } | null> {
    try {
      const result = await krakenPrivateRequest(this.apiKey, this.apiSecret, "Balance");
      // Kraken returns balances per asset: { "XXBT": "0.5", "ZUSD": "100", ... }
      const usd = result["ZUSD"] ?? result["USD"] ?? "0";
      return { balance: Number(usd), currency: "USD" };
    } catch {
      return null;
    }
  }

  async getAssetPrice(symbol: string): Promise<number> {
    return getKrakenPrice(symbol);
  }

  /**
   * Place a market order on Kraken (spot buy/sell).
   * For a BUY: buy `volume` worth of the base asset at market price.
   * For a SELL: sell `volume` worth of the base asset at market price.
   *
   * Kraken doesn't have "binaire" — this is spot trading. The bot uses
   * stop-loss/take-profit via separate orders after the market order fills.
   */
  async placeMarketOrder(params: {
    symbol: string;
    direction: "BUY" | "SELL";
    volume: number; // amount in base currency (e.g. BTC amount)
    stopLossPrice?: number;
    takeProfitPrice?: number;
  }): Promise<KrakenOrderResult> {
    const krakenSymbol = KRAKEN_SYMBOL_MAP[params.symbol] ?? params.symbol;
    const side = params.direction === "BUY" ? "buy" : "sell";

    // Place the market order
    const orderParams: Record<string, string> = {
      pair: krakenSymbol,
      type: side,
      ordertype: "market",
      volume: params.volume.toFixed(8),
    };

    const result = await krakenPrivateRequest(this.apiKey, this.apiSecret, "AddOrder", orderParams);
    const txid = (result as { txid?: string[] }).txid;
    if (!txid?.length) throw new Error("Kraken: aucune transaction retournée");

    // Place stop-loss as a separate conditional close order
    if (params.stopLossPrice) {
      try {
        await krakenPrivateRequest(this.apiKey, this.apiSecret, "AddOrder", {
          pair: krakenSymbol,
          type: side === "buy" ? "sell" : "buy",
          ordertype: "stop-loss",
          price: params.stopLossPrice.toFixed(8),
          volume: params.volume.toFixed(8),
          trigger: "last",
        });
      } catch (e) {
        console.error(`[kraken] Stop-loss échoué: ${(e as Error).message}`);
      }
    }

    // Place take-profit as a separate conditional close order
    if (params.takeProfitPrice) {
      try {
        await krakenPrivateRequest(this.apiKey, this.apiSecret, "AddOrder", {
          pair: krakenSymbol,
          type: side === "buy" ? "sell" : "buy",
          ordertype: "take-profit",
          price: params.takeProfitPrice.toFixed(8),
          volume: params.volume.toFixed(8),
          trigger: "last",
        });
      } catch (e) {
        console.error(`[kraken] Take-profit échoué: ${(e as Error).message}`);
      }
    }

    const currentPrice = await this.getAssetPrice(params.symbol);
    return { orderId: txid[0], buyPrice: currentPrice };
  }

  /**
   * Close a position by placing a reverse market order.
   */
  async closeOrder(orderId: string, symbol: string, volume: number): Promise<void> {
    const krakenSymbol = KRAKEN_SYMBOL_MAP[symbol] ?? symbol;
    // First cancel any open orders
    try {
      await krakenPrivateRequest(this.apiKey, this.apiSecret, "CancelOrder", { txid: orderId });
    } catch { /* ignore if already filled */ }

    // Place reverse market order to close
    const position = await this.getOrderInfo(orderId);
    const side = position.type === "buy" ? "sell" : "buy";
    await krakenPrivateRequest(this.apiKey, this.apiSecret, "AddOrder", {
      pair: krakenSymbol,
      type: side,
      ordertype: "market",
      volume: volume.toFixed(8),
    });
  }

  async getOrderInfo(orderId: string): Promise<{ type: string; status: string; volume: number; price: number }> {
    const result = await krakenPrivateRequest(this.apiKey, this.apiSecret, "QueryOrders", { txid: orderId });
    const order = (result as Record<string, Record<string, string>>)[orderId];
    if (!order) throw new Error("Kraken: ordre introuvable");
    return {
      type: order.type ?? "buy",
      status: order.status ?? "unknown",
      volume: Number(order.vol ?? 0),
      price: Number(order.price ?? 0),
    };
  }

  async getOpenPositions(): Promise<Array<{ orderId: string; symbol: string; volume: number; type: string }>> {
    const result = await krakenPrivateRequest(this.apiKey, this.apiSecret, "OpenOrders");
    const open = (result as { open?: Record<string, Record<string, unknown>> }).open;
    if (!open) return [];
    return Object.entries(open).map(([id, order]) => {
      const descr = (order as { descr?: { pair?: string; type?: string } }).descr;
      return {
        orderId: id,
        symbol: String(descr?.pair ?? ""),
        volume: Number((order as { vol?: string }).vol ?? 0),
        type: String(descr?.type ?? "buy"),
      };
    });
  }

  async getTradeHistory(limit = 20): Promise<Array<{ orderId: string; profit: number }>> {
    const result = await krakenPrivateRequest(this.apiKey, this.apiSecret, "TradesHistory", { ofs: "0" });
    const trades = (result as { trades?: Record<string, Record<string, unknown>> }).trades;
    if (!trades) return [];
    return Object.entries(trades)
      .slice(0, limit)
      .map(([id, trade]) => ({
        orderId: id,
        profit: Number(trade.fee ?? 0) * -1, // fee is a cost, not profit
      }));
  }

  /**
   * Subscribe to order updates via Kraken's auth WebSocket.
   * Returns an unsubscribe function.
   */
  subscribeOrderUpdates(onUpdate: (u: KrakenPositionUpdate) => void): () => void {
    this.orderUpdateListeners.add(onUpdate);
    return () => this.orderUpdateListeners.delete(onUpdate);
  }

  close() {
    this.closedByUs = true;
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    try { this.ws?.close(); } catch { /* ignore */ }
    try { this.authWs?.close(); } catch { /* ignore */ }
    this.ws = null;
    this.authWs = null;
  }
}

// ─── Shared market data socket (all users) ───────────────────────────────────

let krakenWs: WebSocket | null = null;

function getKrakenWs(): WebSocket {
  if (krakenWs && krakenWs.readyState === WebSocket.OPEN) return krakenWs;
  krakenWs = new WebSocket(KRAKEN_WS_URL);
  krakenWs.onclose = () => { krakenWs = null; };
  return krakenWs;
}

export function closeKrakenSocket(): void {
  try { krakenWs?.close(); } catch { /* ignore */ }
  krakenWs = null;
}
