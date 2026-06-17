// Browser-side Deriv WebSocket client.
// Public ticks/candles use the v3 public endpoint; authenticated ops use a v1 OTP URL set via setDerivSession().

export const DERIV_APP_ID = 1089;
export const DERIV_WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

let derivSessionUrl: string | null = null;

/** Call after fetching /api/deriv-session to wire up the authenticated WS. */
export function setDerivSession(wsUrl: string): void {
  derivSessionUrl = wsUrl;
  if (sharedSocket) { sharedSocket.close(); sharedSocket = null; }
  connecting = null;
}

export interface DerivCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DerivTick {
  epoch: number;
  quote: number;
  symbol: string;
}

// Map common labels to Deriv symbols.
export const SYMBOLS: { label: string; deriv: string; market: "crypto" | "forex" | "commodity" }[] = [
  { label: "BTC/USD", deriv: "cryBTCUSD", market: "crypto" },
  { label: "ETH/USD", deriv: "cryETHUSD", market: "crypto" },
  { label: "EUR/USD", deriv: "frxEURUSD", market: "forex" },
  { label: "GBP/USD", deriv: "frxGBPUSD", market: "forex" },
  { label: "GBP/JPY", deriv: "frxGBPJPY", market: "forex" },
  { label: "XAU/USD", deriv: "frxXAUUSD", market: "commodity" },
];

export const GRANULARITY: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
};

let sharedSocket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reqId = 0;
type Listener = (msg: Record<string, unknown>) => void;
const listeners = new Set<Listener>();

/** Generate unique request ID (monotonically increasing with wraparound) */
function nextId(): number {
  reqId = (reqId + 1) % 9000000000; // wrap around at 9 billion to stay within safe int
  return reqId;
}

/** Start heartbeat to keep connection alive on mobile networks */
function startHeartbeat(ws: WebSocket) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      // Send ping every 30s to keep connection alive on mobile
      try {
        ws.send(JSON.stringify({ ping: 1 }));
      } catch {
        /* ignore */
      }
    }
  }, 30000);
}

/** Stop heartbeat */
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function getSocket(): Promise<WebSocket> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN) return Promise.resolve(sharedSocket);
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    const ws = new WebSocket(derivSessionUrl ?? DERIV_WS_URL);
    ws.onopen = () => {
      sharedSocket = ws;
      connecting = null;
      startHeartbeat(ws);
      resolve(ws);
    };
    ws.onerror = (e) => {
      connecting = null;
      reject(e);
    };
    ws.onclose = () => {
      sharedSocket = null;
      stopHeartbeat();
    };
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        for (const l of listeners) l(data);
      } catch {
        /* ignore */
      }
    };
  });
  return connecting;
}

/** Mobile connection manager - handles network changes and tab visibility */
let mobileReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function handleMobileReconnect() {
  // Clear any pending reconnect
  if (mobileReconnectTimer) {
    clearTimeout(mobileReconnectTimer);
    mobileReconnectTimer = null;
  }
  
  // If socket is closed or closing, reset and schedule reconnect
  if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
    sharedSocket = null;
    stopHeartbeat();
    
    // Exponential backoff for mobile: 1s, 2s, 4s, max 8s
    const delay = Math.min(1000 * Math.pow(2, (reconnectAttempts++)), 8000);
    mobileReconnectTimer = setTimeout(() => {
      // Trigger a new connection attempt
      getSocket().catch(() => {});
    }, delay);
  }
}

let reconnectAttempts = 0;

// Handle mobile network changes
if (typeof window !== "undefined") {
  // Network online/offline events (mobile specific)
  window.addEventListener("online", () => {
    reconnectAttempts = 0;
    handleMobileReconnect();
  });
  
  window.addEventListener("offline", () => {
    sharedSocket = null;
    stopHeartbeat();
  });
  
  // Handle tab visibility changes (mobile browsers suspend tabs)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      // Tab became active - check connection
      reconnectAttempts = 0;
      if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
        handleMobileReconnect();
      }
    }
  });
}

export async function derivRequest<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
): Promise<T> {
  const ws = await getSocket();
  const id = nextId();
  return new Promise<T>((resolve, reject) => {
    const l: Listener = (msg) => {
      if (msg.req_id === id) {
        listeners.delete(l);
        if (msg.error) reject(new Error(String((msg.error as { message?: string }).message ?? "Deriv error")));
        else resolve(msg as T);
      }
    };
    listeners.add(l);
    ws.send(JSON.stringify({ ...payload, req_id: id }));
  });
}

/** Subscribe to live ticks. Returns an unsubscribe function. */
export function subscribeTicks(
  symbol: string,
  onTick: (tick: DerivTick) => void,
): () => void {
  let stopped = false;
  let subId: string | undefined;

  const l: Listener = (msg) => {
    if (msg.msg_type === "tick" && (msg as { tick?: { symbol?: string } }).tick?.symbol === symbol) {
      const t = (msg as { tick: DerivTick & { id?: string } }).tick;
      if (t.id) subId = t.id;
      onTick({ epoch: t.epoch, quote: Number(t.quote), symbol: t.symbol });
    }
  };
  listeners.add(l);
  derivRequest({ ticks: symbol, subscribe: 1 }).catch(() => {
    /* ignore */
  });

  return () => {
    if (stopped) return;
    stopped = true;
    listeners.delete(l);
    if (subId) derivRequest({ forget: subId }).catch(() => {});
  };
}

export async function fetchCandles(
  symbol: string,
  granularity: number,
  count = 200,
  maxRetries = 2,
): Promise<DerivCandle[]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Ensure socket is connected before making request
      const ws = await getSocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
      }

      const res = await derivRequest<{
        candles?: DerivCandle[];
      }>({
        ticks_history: symbol,
        style: "candles",
        granularity,
        count,
        end: "latest",
      });

      if (!res.candles || res.candles.length === 0) {
        throw new Error("No candles returned from Deriv");
      }

      return res.candles;
    } catch (e) {
      lastError = e as Error;
      if (attempt < maxRetries) {
        // Wait before retrying (exponential backoff)
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        // Reset socket to force reconnection
        if (sharedSocket?.readyState !== WebSocket.OPEN) {
          sharedSocket = null;
        }
      }
    }
  }

  throw new Error(`Failed to fetch candles after ${maxRetries + 1} attempts: ${lastError?.message}`);
}


export async function getBalance(): Promise<{ balance: number; currency: string } | null> {
  try {
    const res = await derivRequest<{ balance?: { balance: number; currency: string } }>({
      balance: 1,
    });
    if (res.balance) return { balance: Number(res.balance.balance), currency: res.balance.currency };
    return null;
  } catch {
    return null;
  }
}

export interface ProposalResult {
  id: string;
  askPrice: number;
  payout: number;
  longcode: string;
}

export async function proposalContract(params: {
  symbol: string;
  amount: number;
  contractType: "CALL" | "PUT";
  durationMinutes: number;
  currency?: string;
}): Promise<ProposalResult> {
  const res = await derivRequest<{
    proposal?: {
      id: string;
      ask_price: number;
      payout: number;
      longcode: string;
    };
    error?: { message: string };
  }>({
    proposal: 1,
    amount: params.amount,
    basis: "stake",
    contract_type: params.contractType,
    currency: params.currency ?? "USD",
    duration: params.durationMinutes,
    duration_unit: "m",
    symbol: params.symbol,
  });
  if (!res.proposal) throw new Error("Proposal failed");
  return {
    id: res.proposal.id,
    askPrice: Number(res.proposal.ask_price),
    payout: Number(res.proposal.payout),
    longcode: res.proposal.longcode,
  };
}

export interface BuyResult {
  contractId: number;
  buyPrice: number;
  payout: number;
  startTime: number;
}

export async function buyContract(proposalId: string, maxPrice: number): Promise<BuyResult> {
  const res = await derivRequest<{
    buy?: {
      contract_id: number;
      buy_price: number;
      payout: number;
      start_time: number;
    };
  }>({
    buy: proposalId,
    price: maxPrice,
  });
  if (!res.buy) throw new Error("Buy failed");
  return {
    contractId: res.buy.contract_id,
    buyPrice: Number(res.buy.buy_price),
    payout: Number(res.buy.payout),
    startTime: res.buy.start_time,
  };
}

export interface ContractUpdate {
  contractId: number;
  currentSpot: number;
  profit: number;
  status: "open" | "won" | "lost" | "sold";
  sellPrice?: number;
}

export function subscribeContract(
  contractId: number,
  onUpdate: (update: ContractUpdate) => void,
): () => void {
  let stopped = false;
  const l: Listener = (msg) => {
    const p = (msg as { proposal_open_contract?: Record<string, unknown> }).proposal_open_contract;
    if (!p || p.contract_id !== contractId) return;
    const status =
      p.is_expired || p.is_settleable || p.is_sold
        ? p.profit !== undefined && Number(p.profit) > 0
          ? "won"
          : "lost"
        : "open";
    onUpdate({
      contractId: contractId,
      currentSpot: Number(p.current_spot ?? 0),
      profit: Number(p.profit ?? 0),
      status: p.is_sold ? "sold" : status,
      sellPrice: p.sell_price !== undefined ? Number(p.sell_price) : undefined,
    });
  };
  listeners.add(l);
  derivRequest({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }).catch(() => {});
  return () => {
    if (stopped) return;
    stopped = true;
    listeners.delete(l);
    derivRequest({ forget_all: "proposal_open_contract" }).catch(() => {});
  };
}

export async function sellContractNow(contractId: number): Promise<number> {
  const res = await derivRequest<{ sell?: { sold_for: number } }>({
    sell: contractId,
    price: 0,
  });
  return Number(res.sell?.sold_for ?? 0);
}

export interface OpenPosition {
  contractId: number;
  symbol: string;
  contractType: string;
  buyPrice: number;
  payout: number;
  profit: number;
  currentSpot: number;
  dateStart: number;
  dateExpiry: number;
  shortcode: string;
}

export async function getOpenPositions(): Promise<OpenPosition[]> {
  try {
    const res = await derivRequest<{
      portfolio?: {
        contracts?: Array<{
          contract_id: number;
          symbol: string;
          contract_type: string;
          buy_price: number;
          payout: number;
          profit: number;
          current_spot: number;
          date_start: number;
          date_expiry: number;
          shortcode: string;
        }>;
      };
    }>({ portfolio: 1 });
    return (res.portfolio?.contracts ?? []).map((c) => ({
      contractId: c.contract_id,
      symbol: c.symbol,
      contractType: c.contract_type,
      buyPrice: Number(c.buy_price),
      payout: Number(c.payout),
      profit: Number(c.profit ?? 0),
      currentSpot: Number(c.current_spot ?? 0),
      dateStart: c.date_start,
      dateExpiry: c.date_expiry,
      shortcode: c.shortcode,
    }));
  } catch {
    return [];
  }
}

export interface ProfitRecord {
  contractId: number;
  symbol: string;
  contractType: string;
  buyPrice: number;
  sellPrice: number;
  profit: number;
  purchaseTime: number;
  sellTime: number;
}

export async function getProfitTable(limit = 50): Promise<ProfitRecord[]> {
  try {
    const res = await derivRequest<{
      profit_table?: {
        transactions?: Array<{
          contract_id: number;
          shortcode: string;
          buy_price: number;
          sell_price: number;
          profit: number;
          purchase_time: number;
          sell_time: number;
          app_id?: number;
        }>;
      };
    }>({ profit_table: 1, limit, sort: "DESC" });
    return (res.profit_table?.transactions ?? []).map((t) => {
      const parts = t.shortcode?.split("_") ?? [];
      return {
        contractId: t.contract_id,
        symbol: parts[1] ?? "—",
        contractType: parts[0] ?? "—",
        buyPrice: Number(t.buy_price),
        sellPrice: Number(t.sell_price),
        profit: Number(t.profit),
        purchaseTime: t.purchase_time,
        sellTime: t.sell_time,
      };
    });
  } catch {
    return [];
  }
}

export function subscribeBalance(
  onUpdate: (balance: number, currency: string) => void,
  throttleMs = 1000, // Throttle updates to prevent excessive re-renders
): () => void {
  let stopped = false;
  let lastUpdate = 0;
  let pendingBalance: number | null = null;
  let pendingCurrency: string | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (pendingBalance !== null && pendingCurrency !== null) {
      onUpdate(pendingBalance, pendingCurrency);
      pendingBalance = null;
      pendingCurrency = null;
    }
    timeoutId = null;
  };

  const l: Listener = (msg) => {
    const b = (msg as { balance?: { balance: number; currency: string } }).balance;
    if (b?.balance === undefined) return;

    const now = Date.now();
    pendingBalance = Number(b.balance);
    pendingCurrency = b.currency;

    if (now - lastUpdate >= throttleMs) {
      lastUpdate = now;
      flush();
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastUpdate = Date.now();
        flush();
      }, throttleMs - (now - lastUpdate));
    }
  };

  listeners.add(l);
  derivRequest({ balance: 1, subscribe: 1 }).catch(() => {});

  return () => {
    if (stopped) return;
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
    listeners.delete(l);
    derivRequest({ forget_all: "balance" }).catch(() => {});
  };
}