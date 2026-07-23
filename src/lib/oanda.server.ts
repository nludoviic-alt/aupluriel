// Node-side OANDA client for the SERVER auto-trader.
//
// OANDA uses REST v20 API with Bearer token authentication and streaming
// for real-time candles. This is for users in Canada (OANDA is IIROC-regulated).
//
// API docs: https://developer.oanda.com/rest-live-v20/introduction/
//
// Requires Node >= 18 (global fetch, global WebSocket).

const OANDA_REST_URL = "https://api-fxtrade.oanda.com/v3";
const OANDA_PRACTICE_URL = "https://api-fxpractice.oanda.com/v3";

// ─── Symbol mapping: Deriv forex → OANDA ─────────────────────────────────────

const OANDA_SYMBOL_MAP: Record<string, string> = {
  "frxEURUSD": "EUR_USD",
  "frxGBPUSD": "GBP_USD",
  "frxUSDJPY": "USD_JPY",
  "frxAUDUSD": "AUD_USD",
  "frxUSDCAD": "USD_CAD",
  "frxUSDCHF": "USD_CHF",
  "frxEURGBP": "EUR_GBP",
  "frxEURJPY": "EUR_JPY",
  "frxGBPJPY": "GBP_JPY",
  "frxXAUUSD": "XAU_USD",
  "frxXAGUSD": "XAG_USD",
};

export function derivToOandaSymbol(derivSymbol: string): string | null {
  return OANDA_SYMBOL_MAP[derivSymbol] ?? null;
}

export function isOandaSymbol(derivSymbol: string): boolean {
  return derivSymbol in OANDA_SYMBOL_MAP;
}

export const OANDA_DERIV_SYMBOLS = Object.keys(OANDA_SYMBOL_MAP);

// ─── Candle type ─────────────────────────────────────────────────────────────

export interface OandaCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ─── REST client ─────────────────────────────────────────────────────────────

function getOandaGranularity(granularitySeconds: number): string {
  // OANDA granularities: S5, S10, S15, S30, M1, M5, M15, M30, H1, H4, D
  const map: Record<number, string> = {
    60: "M1",
    300: "M5",
    900: "M15",
    1800: "M30",
    3600: "H1",
    14400: "H4",
    86400: "D",
  };
  return map[granularitySeconds] ?? "M15";
}

export async function fetchOandaCandles(
  symbol: string,
  granularitySeconds: number,
  count: number,
  apiKey: string,
  accountId: string,
  isPractice: boolean,
): Promise<OandaCandle[]> {
  const oandaSymbol = OANDA_SYMBOL_MAP[symbol] ?? symbol;
  const granularity = getOandaGranularity(granularitySeconds);
  const baseUrl = isPractice ? OANDA_PRACTICE_URL : OANDA_REST_URL;
  const url = `${baseUrl}/instruments/${oandaSymbol}/candles?granularity=${granularity}&count=${count}&price=Mid`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OANDA candles failed: ${res.status}`);
  const data = (await res.json()) as { candles?: Array<{ time: string; mid: { o: string; h: string; l: string; c: string } }> };
  return (data.candles ?? []).map((c) => ({
    epoch: Math.floor(new Date(c.time).getTime() / 1000),
    open: Number(c.mid.o),
    high: Number(c.mid.h),
    low: Number(c.mid.l),
    close: Number(c.mid.c),
  }));
}

export async function getOandaPrice(
  symbol: string,
  apiKey: string,
  accountId: string,
  isPractice: boolean,
): Promise<{ bid: number; ask: number; mid: number }> {
  const oandaSymbol = OANDA_SYMBOL_MAP[symbol] ?? symbol;
  const baseUrl = isPractice ? OANDA_PRACTICE_URL : OANDA_REST_URL;
  const url = `${baseUrl}/instruments/${oandaSymbol}/pricing?instruments=${oandaSymbol}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`OANDA pricing failed: ${res.status}`);
  const data = (await res.json()) as { prices?: Array<{ bids?: Array<{ price: string }>; asks?: Array<{ price: string }> }> };
  const price = data.prices?.[0];
  const bid = Number(price?.bids?.[0]?.price ?? 0);
  const ask = Number(price?.asks?.[0]?.price ?? 0);
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ─── Trading connection ──────────────────────────────────────────────────────

export interface OandaOrderResult {
  orderId: string;
  buyPrice: number;
}

export interface OandaPositionUpdate {
  orderId: string;
  profit: number;
  status: "open" | "won" | "lost";
}

export class OandaTradingConnection {
  private baseUrl: string;

  constructor(
    public readonly apiKey: string,
    public readonly accountId: string,
    public readonly isPractice: boolean = true,
  ) {
    this.baseUrl = isPractice ? OANDA_PRACTICE_URL : OANDA_REST_URL;
  }

  get isOpen(): boolean {
    return true; // OANDA REST is stateless
  }

  private async request(endpoint: string, method: "GET" | "POST" | "PUT" | "DELETE" = "GET", body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Accept-Datetime-Format": "RFC3339",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OANDA ${endpoint} failed: ${res.status} ${errBody}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async getBalance(): Promise<{ balance: number; currency: string } | null> {
    try {
      const result = await this.request(`/accounts/${this.accountId}/summary`);
      const summary = (result as { account?: { balance: string; currency: string } }).account;
      if (!summary) return null;
      return { balance: Number(summary.balance), currency: summary.currency };
    } catch {
      return null;
    }
  }

  async getAssetPrice(symbol: string): Promise<number> {
    const { mid } = await getOandaPrice(symbol, this.apiKey, this.accountId, this.isPractice);
    return mid;
  }

  /**
   * Place a market order on OANDA (spot forex).
   * OANDA uses units (in the base currency) and supports stop-loss/take-profit
   * natively in the same order via stopLoss/takeProfit fields.
   *
   * For a BUY: buy `units` of the base currency.
   * For a SELL: sell `units` of the base currency (short).
   */
  async placeMarketOrder(params: {
    symbol: string;
    direction: "BUY" | "SELL";
    units: number; // amount in base currency
    stopLossPrice?: number;
    takeProfitPrice?: number;
  }): Promise<OandaOrderResult> {
    const oandaSymbol = OANDA_SYMBOL_MAP[params.symbol] ?? params.symbol;
    const side = params.direction === "BUY" ? params.units : -params.units;

    const orderBody: Record<string, unknown> = {
      order: {
        type: "MARKET",
        instrument: oandaSymbol,
        units: String(side),
        timeInForce: "FOK",
        positionFill: "DEFAULT",
      },
    };

    // Add stop-loss and take-profit as child orders
    if (params.stopLossPrice) {
      (orderBody.order as Record<string, unknown>).stopLossOnFill = {
        price: params.stopLossPrice.toFixed(5),
      };
    }
    if (params.takeProfitPrice) {
      (orderBody.order as Record<string, unknown>).takeProfitOnFill = {
        price: params.takeProfitPrice.toFixed(5),
      };
    }

    const result = await this.request(`/accounts/${this.accountId}/orders`, "POST", orderBody);
    const orderFill = (result as { orderFillTransaction?: { id: string; price: string } }).orderFillTransaction;
    if (!orderFill) throw new Error("OANDA: aucune transaction retournée");

    return { orderId: orderFill.id, buyPrice: Number(orderFill.price) };
  }

  /**
   * Close a position by placing a reverse market order.
   */
  async closePosition(symbol: string): Promise<void> {
    const oandaSymbol = OANDA_SYMBOL_MAP[symbol] ?? symbol;
    await this.request(`/accounts/${this.accountId}/positions/${oandaSymbol}/close`, "PUT", {});
  }

  /**
   * Get open positions for this account.
   */
  async getOpenPositions(): Promise<Array<{ instrument: string; units: number; unrealizedPL: number }>> {
    const result = await this.request(`/accounts/${this.accountId}/openPositions`);
    const positions = (result as { positions?: Array<{ instrument: string; long?: { units: string }; short?: { units: string }; unrealizedPL: string }> }).positions ?? [];
    return positions.map((p) => ({
      instrument: p.instrument,
      units: Number(p.long?.units ?? p.short?.units ?? 0),
      unrealizedPL: Number(p.unrealizedPL ?? 0),
    }));
  }

  /**
   * Get the details of a specific trade.
   */
  async getTradeInfo(tradeId: string): Promise<{ state: string; units: number; price: number; unrealizedPL: number }> {
    const result = await this.request(`/accounts/${this.accountId}/trades/${tradeId}`);
    const trade = (result as { trade?: { state?: string; currentUnits?: string; price?: string; unrealizedPL?: string } }).trade;
    if (!trade) throw new Error("OANDA: trade introuvable");
    return {
      state: trade.state ?? "OPEN",
      units: Number(trade.currentUnits ?? 0),
      price: Number(trade.price ?? 0),
      unrealizedPL: Number(trade.unrealizedPL ?? 0),
    };
  }

  /**
   * Close a specific trade by ID.
   */
  async closeTrade(tradeId: string, units: number): Promise<void> {
    await this.request(`/accounts/${this.accountId}/trades/${tradeId}/close`, "PUT", { units: String(units) });
  }

  close() {
    // OANDA REST is stateless — nothing to close
  }
}

// ─── Shutdown ────────────────────────────────────────────────────────────────

export function closeOandaSocket(): void {
  // OANDA REST is stateless — nothing to close
}
