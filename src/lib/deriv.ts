// Browser-side Deriv WebSocket client.
// Trading: OTP-authenticated WS from the Options Trading API (api.derivws.com).
//   The OTP URL comes from /api/deriv-session; it is SINGLE-USE and expires in
//   120s — every reconnect needs a fresh URL (handled via onDerivDisconnect).
// Market data: legacy v3 public WS (no auth) — still serves the same symbols.

export const DERIV_APP_ID = 1089;
export const DERIV_WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

let derivSessionUrl: string | null = null;
let sessionUrlConsumed = false; // OTP URLs are single-use — never reconnect with one
let derivTargetAccount: string | null = null;
let _disconnectCallback: (() => void) | null = null;
// Real currency of the target account (EUR, BTC, tUSDT…) — proposals MUST
// use it or Deriv rejects the buy on non-USD accounts.
let accountCurrency: string | null = null;

/** Register a callback fired whenever the authenticated WS session closes unexpectedly. */
export function onDerivDisconnect(cb: (() => void) | null): void {
  _disconnectCallback = cb;
}

/** Call after fetching /api/deriv-session to wire up the authenticated WS. */
export function setDerivSession(wsUrl: string, targetAccount?: string, currency?: string): void {
  derivSessionUrl = wsUrl;
  sessionUrlConsumed = false;
  derivTargetAccount = targetAccount ?? null;
  if (currency) accountCurrency = currency;
  if (sharedSocket) {
    expectedCloseSocket = sharedSocket; // our own close — don't trigger reconnect
    sharedSocket.close();
    sharedSocket = null;
  }
  connecting = null;
}

// Socket we closed on purpose — its onclose must not fire the disconnect callback.
let expectedCloseSocket: WebSocket | null = null;

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
// NOTE: crypto pairs only offer MULTIPLIER contracts on the Options API — the
// auto-trader (CALL/PUT) cannot trade them. Synthetic indices trade 24/7 with
// durations from 15s and are the best fit for the bot. Stock indices (OTC_*)
// offer CALL/PUT 15m→1h during their exchange's hours only.
export const SYMBOLS: { label: string; deriv: string; market: "crypto" | "forex" | "commodity" | "synthetic" | "indices" }[] = [
  // ── Synthétiques (24/7, CALL/PUT dès 15s) ──
  { label: "Volatility 100", deriv: "R_100", market: "synthetic" },
  { label: "Volatility 75", deriv: "R_75", market: "synthetic" },
  { label: "Volatility 50", deriv: "R_50", market: "synthetic" },
  { label: "Volatility 25", deriv: "R_25", market: "synthetic" },
  { label: "Volatility 10", deriv: "R_10", market: "synthetic" },
  { label: "Volatility 100 (1s)", deriv: "1HZ100V", market: "synthetic" },
  { label: "Jump 100", deriv: "JD100", market: "synthetic" },
  { label: "Step Index 100", deriv: "stpRNG", market: "synthetic" },
  { label: "Bull Market", deriv: "RDBULL", market: "synthetic" },
  { label: "Bear Market", deriv: "RDBEAR", market: "synthetic" },
  // ── Indices boursiers (heures de bourse) ──
  { label: "US 500", deriv: "OTC_SPC", market: "indices" },
  { label: "US Tech 100", deriv: "OTC_NDX", market: "indices" },
  { label: "Wall Street 30", deriv: "OTC_DJI", market: "indices" },
  { label: "Germany 40", deriv: "OTC_GDAXI", market: "indices" },
  { label: "UK 100", deriv: "OTC_FTSE", market: "indices" },
  { label: "Japan 225", deriv: "OTC_N225", market: "indices" },
  { label: "Hong Kong 50", deriv: "OTC_HSI", market: "indices" },
  // ── Forex (sessions, CALL/PUT dès 15 min) ──
  { label: "EUR/USD", deriv: "frxEURUSD", market: "forex" },
  { label: "GBP/USD", deriv: "frxGBPUSD", market: "forex" },
  { label: "USD/JPY", deriv: "frxUSDJPY", market: "forex" },
  { label: "AUD/USD", deriv: "frxAUDUSD", market: "forex" },
  { label: "USD/CAD", deriv: "frxUSDCAD", market: "forex" },
  { label: "USD/CHF", deriv: "frxUSDCHF", market: "forex" },
  { label: "EUR/GBP", deriv: "frxEURGBP", market: "forex" },
  { label: "EUR/JPY", deriv: "frxEURJPY", market: "forex" },
  { label: "GBP/JPY", deriv: "frxGBPJPY", market: "forex" },
  // ── Matières premières ──
  { label: "XAU/USD (Or)", deriv: "frxXAUUSD", market: "commodity" },
  { label: "XAG/USD (Argent)", deriv: "frxXAGUSD", market: "commodity" },
  // ── Crypto (graphiques uniquement — pas de CALL/PUT) ──
  { label: "BTC/USD", deriv: "cryBTCUSD", market: "crypto" },
  { label: "ETH/USD", deriv: "cryETHUSD", market: "crypto" },
];

export const GRANULARITY: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
};

// ── PRIVATE SOCKET — authenticated operations (balance, trades) ──────────────
let sharedSocket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let reqId = 0;

type Listener = (msg: Record<string, unknown>) => void;
const listeners = new Set<Listener>();

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}
const pendingRequests = new Map<number, PendingRequest>();

function nextId(): number {
  reqId = (reqId + 1) % 9000000000;
  return reqId;
}

function startHeartbeat(ws: WebSocket) {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ ping: 1 })); } catch { /* ignore */ }
    }
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

// Active contract subscriptions — re-established automatically after a reconnect
// so open positions keep resolving even if the socket dropped mid-trade.
interface ContractSub {
  contractId: number;
  listener: Listener;
}
const activeContractSubs = new Set<ContractSub>();

function resubscribeAllActive() {
  for (const sub of activeContractSubs) {
    listeners.add(sub.listener);
    derivRequest({ proposal_open_contract: 1, contract_id: sub.contractId, subscribe: 1 }).catch(() => {});
  }
}

// ── PUBLIC SOCKET — market data (ticks, candles) — no auth, starts immediately
let pubSocket: WebSocket | null = null;
let pubConnecting: Promise<WebSocket> | null = null;
let pubHeartbeat: ReturnType<typeof setInterval> | null = null;
const pubListeners = new Set<Listener>();
const pendingPubReqs = new Map<number, PendingRequest>();
let pubReqId = 0;

interface PubTickSub {
  symbol: string;
  onTick: (tick: DerivTick) => void;
  listener: Listener;
}
const activePubSubs = new Set<PubTickSub>();

function nextPubId(): number {
  pubReqId = (pubReqId + 1) % 9000000000;
  return pubReqId;
}

function resubscribePubActive() {
  for (const sub of activePubSubs) {
    pubListeners.add(sub.listener);
    pubRequest({ ticks: sub.symbol, subscribe: 1 }).catch(() => {});
  }
}

function getPublicSocket(): Promise<WebSocket> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (pubSocket && pubSocket.readyState === WebSocket.OPEN) return Promise.resolve(pubSocket);
  if (pubConnecting) return pubConnecting;
  pubConnecting = new Promise((resolve, reject) => {
    const ws = new WebSocket(DERIV_WS_URL);
    ws.onerror = (e) => { pubConnecting = null; reject(e); };
    ws.onclose = () => {
      pubSocket = null;
      pubConnecting = null;
      if (pubHeartbeat) { clearInterval(pubHeartbeat); pubHeartbeat = null; }
      for (const [, req] of pendingPubReqs.entries()) req.reject(new Error("Public socket closed"));
      pendingPubReqs.clear();
      pubListeners.clear();
      setTimeout(() => getPublicSocket().then(() => resubscribePubActive()).catch(() => {}), 2000);
    };
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        for (const l of pubListeners) l(data);
      } catch { /* ignore */ }
    };
    ws.onopen = () => {
      pubSocket = ws;
      pubConnecting = null;
      pubHeartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ ping: 1 })); } catch { /* ignore */ }
        }
      }, 30000);
      resolve(ws);
    };
  });
  return pubConnecting;
}

async function pubRequest<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T> {
  const ws = await getPublicSocket();
  const id = nextPubId();
  return new Promise<T>((resolve, reject) => {
    const l: Listener = (msg) => {
      if (msg.req_id === id) {
        pubListeners.delete(l);
        pendingPubReqs.delete(id);
        if (msg.error) reject(new Error(String((msg.error as { message?: string }).message ?? "Deriv error")));
        else resolve(msg as T);
      }
    };
    pubListeners.add(l);
    pendingPubReqs.set(id, { resolve, reject });
    try {
      ws.send(JSON.stringify({ ...payload, req_id: id }));
    } catch (err) {
      pubListeners.delete(l);
      pendingPubReqs.delete(id);
      reject(err);
    }
  });
}

function getSocket(): Promise<WebSocket> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (sharedSocket && sharedSocket.readyState === WebSocket.OPEN) return Promise.resolve(sharedSocket);
  if (connecting) return connecting;
  if (!derivSessionUrl) return Promise.reject(new Error("Session Deriv non initialisée"));
  if (sessionUrlConsumed) {
    // The OTP URL was already used by a previous connection — a fresh one must
    // be fetched via /api/deriv-session. Notify the session manager and fail fast.
    _disconnectCallback?.();
    return Promise.reject(new Error("Session Deriv expirée — reconnexion en cours"));
  }
  connecting = new Promise((resolve, reject) => {
    const ws = new WebSocket(derivSessionUrl!);

    ws.onerror = (e) => {
      connecting = null;
      reject(e);
    };
    ws.onclose = () => {
      const expected = expectedCloseSocket === ws;
      if (expected) expectedCloseSocket = null;
      if (sharedSocket === ws) sharedSocket = null;
      connecting = null;
      stopHeartbeat();

      for (const [, req] of pendingRequests.entries()) {
        req.reject(new Error("Connection closed"));
      }
      pendingRequests.clear();
      listeners.clear();

      // The OTP URL is dead either way (consumed or expired) — ask the session
      // manager for a fresh one, unless we closed this socket ourselves.
      if (!expected) _disconnectCallback?.();
    };
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        for (const l of listeners) l(data);
      } catch {
        /* ignore */
      }
    };

    ws.onopen = () => {
      // The OTP in the URL is now consumed — this socket is authenticated and
      // scoped to the target account; no authorize message is needed.
      sessionUrlConsumed = true;
      sharedSocket = ws;
      connecting = null;
      startHeartbeat(ws);
      resubscribeAllActive();
      resolve(ws);
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

// Guard: register window listeners only once (HMR can re-execute module code)
if (typeof window !== "undefined" && !(window as unknown as Record<string, boolean>).__lio23_deriv_listeners__) {
  (window as unknown as Record<string, boolean>).__lio23_deriv_listeners__ = true;

  // Eagerly start the public socket so ticks are ready before any component mounts
  getPublicSocket().catch(() => {});

  window.addEventListener("online", () => {
    reconnectAttempts = 0;
    handleMobileReconnect();
    // Also reconnect public socket on network restore
    getPublicSocket().then(() => resubscribePubActive()).catch(() => {});
  });

  window.addEventListener("offline", () => {
    sharedSocket = null;
    stopHeartbeat();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      reconnectAttempts = 0;
      if (!sharedSocket || sharedSocket.readyState !== WebSocket.OPEN) {
        handleMobileReconnect();
      }
      // Also ensure public socket is alive when tab comes back into focus
      if (!pubSocket || pubSocket.readyState !== WebSocket.OPEN) {
        getPublicSocket().then(() => resubscribePubActive()).catch(() => {});
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
        pendingRequests.delete(id);
        if (msg.error) reject(new Error(String((msg.error as { message?: string }).message ?? "Deriv error")));
        else resolve(msg as T);
      }
    };
    listeners.add(l);
    pendingRequests.set(id, { resolve, reject });
    try {
      ws.send(JSON.stringify({ ...payload, req_id: id }));
    } catch (err) {
      listeners.delete(l);
      pendingRequests.delete(id);
      reject(err);
    }
  });
}

/** Subscribe to live ticks via the public socket (no auth required — fast start). */
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

  const subObj: PubTickSub = { symbol, onTick, listener: l };
  activePubSubs.add(subObj);
  pubListeners.add(l);

  pubRequest({ ticks: symbol, subscribe: 1 }).catch(() => { /* ignore */ });

  return () => {
    if (stopped) return;
    stopped = true;
    activePubSubs.delete(subObj);
    pubListeners.delete(l);
    if (subId) pubRequest({ forget: subId }).catch(() => {});
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
      const res = await pubRequest<{ candles?: DerivCandle[] }>({
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
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        if (pubSocket?.readyState !== WebSocket.OPEN) pubSocket = null;
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
    if (res.balance) {
      accountCurrency = res.balance.currency;
      return { balance: Number(res.balance.balance), currency: res.balance.currency };
    }
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
    // Deriv rejects stakes with >2 decimals (percent-based stakes produce them)
    amount: Math.round(params.amount * 100) / 100,
    basis: "stake",
    contract_type: params.contractType,
    currency: params.currency ?? accountCurrency ?? "USD",
    duration: params.durationMinutes,
    duration_unit: "m",
    // Options Trading API expects `underlying_symbol` (legacy `symbol` is rejected)
    underlying_symbol: params.symbol,
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
  let subId: string | undefined;
  const l: Listener = (msg) => {
    const p = (msg as { proposal_open_contract?: Record<string, unknown> }).proposal_open_contract;
    if (!p || p.contract_id !== contractId) return;
    const subscription = (msg as { subscription?: { id?: string } }).subscription;
    if (subscription?.id) subId = subscription.id;
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
  const subObj: ContractSub = { contractId, listener: l };
  activeContractSubs.add(subObj);
  listeners.add(l);
  derivRequest({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }).catch(() => {});
  return () => {
    if (stopped) return;
    stopped = true;
    activeContractSubs.delete(subObj);
    listeners.delete(l);
    // Forget ONLY this contract's stream — never forget_all, which would kill
    // tracking of other concurrently open positions.
    if (subId) derivRequest({ forget: subId }).catch(() => {});
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
          underlying_symbol?: string;
          contract_type?: string;
          buy_price: number;
          sell_price: number;
          profit?: number; // absent on the Options Trading API — derive it
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
        symbol: t.underlying_symbol ?? parts[1] ?? "—",
        contractType: t.contract_type ?? parts[0] ?? "—",
        buyPrice: Number(t.buy_price),
        sellPrice: Number(t.sell_price),
        profit: t.profit !== undefined ? Number(t.profit) : Number(t.sell_price) - Number(t.buy_price),
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

  const targetLoginId = derivTargetAccount; // capture at subscription time for filtering

  const l: Listener = (msg) => {
    const b = (msg as { balance?: { balance: number; currency: string; loginid?: string } }).balance;
    if (b?.balance === undefined) return;
    // Ignore balance events for other accounts (e.g. during account_switch)
    if (targetLoginId && b.loginid && b.loginid !== targetLoginId) return;

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

  // Wait for socket to be fully ready (auth + switch complete) before registering the listener.
  // Without this, intermediate balance events emitted by Deriv during auth/switch are caught,
  // causing the balance to flicker between the old and new account values.
  getSocket().then(() => {
    if (stopped) return;
    listeners.add(l);
    derivRequest({ balance: 1, subscribe: 1 }).catch(() => {});
  }).catch(() => {});

  return () => {
    if (stopped) return;
    stopped = true;
    if (timeoutId) clearTimeout(timeoutId);
    listeners.delete(l);
    derivRequest({ forget_all: "balance" }).catch(() => {});
  };
}