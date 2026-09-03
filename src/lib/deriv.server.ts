// Node-side Deriv client for the SERVER auto-trader (bot-engine.server.ts).
//
// Market data: legacy v3 public WS (no auth) — one shared connection.
// Trading: the Options Trading API. Like the browser client, a `pat_` token
// cannot authorize the legacy WS directly: we exchange it for a single-use OTP
// WebSocket URL via REST, then speak the same JSON protocol over that socket.
// OTP URLs die on disconnect, so every reconnect fetches a fresh one.
//
// Requires Node ≥ 22 (global WebSocket).

import { FEATURE_FLAGS } from "./feature-flags.server";

const DERIV_APP_ID = 1089;
const PUBLIC_WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${DERIV_APP_ID}`;
const TRADING_V1 = "https://api.derivws.com/trading/v1/options";
const DERIV_REST_APP_ID = "33zECGFcSA3ZubKPdQJqm";

function getCurrencyDecimals(currency = "USD"): number {
  const c = currency.toUpperCase();
  if (c === "BTC") return 8;
  if (c === "ETH") return 6;
  if (c === "LTC") return 5;
  if (
    c === "USD" ||
    c === "EUR" ||
    c === "GBP" ||
    c === "AUD" ||
    c === "CAD" ||
    c === "CHF" ||
    c === "JPY"
  )
    return 2;
  return 2;
}

function roundToCurrency(num: number, currency = "USD"): number {
  const dec = getCurrencyDecimals(currency);
  const factor = Math.pow(10, dec);
  return Math.round((num + Number.EPSILON) * factor) / factor;
}

/**
 * The multiplier actually used for a Multiplier order — crypto is capped at
 * x10 regardless of the configured level, since its volatility makes higher
 * leverage disproportionately risky. Exported so the stop-loss/take-profit
 * $ calc (bot-engine.server.ts, computeAtrStopUsd) can use the SAME number
 * that ends up on the wire: computing the stop off the uncapped config value
 * while the order opens at the capped one miscalibrates the stop distance
 * (was silently 2x off for crypto — 20 assumed vs 10 actually applied).
 */
export function effectiveMultiplier(symbol: string, requestedMultiplier: number): number {
  return symbol.startsWith("cry") ? Math.min(requestedMultiplier, 10) : requestedMultiplier;
}

export type DerivPortfolioResult =
  | {
      success: true;
      positions: Array<{ contractId: number; symbol: string; buyPrice: number; profit: number }>;
    }
  | { success: false; error: string };

type Msg = Record<string, unknown>;
export class DerivApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
type Listener = (msg: Msg) => void;

/**
 * Reject a promise that never settles. Node's global `fetch` and a WebSocket
 * that connects at the TCP layer but never completes the HTTP/WS handshake
 * (stale NAT mapping after a long idle, broker-side hang) will otherwise await
 * forever. A single un-timed await here used to brick a whole bot engine with
 * no error and no log: `connect()` cached the forever-pending promise in
 * `this.connecting` and handed it to every later `request()` (incident
 * 2026-08-29 — vol75 froze mid-scan, then crash500 two days later).
 */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

// Per-attempt budget for each OTP-exchange REST call. Lower than it used to be
// (15s) because fetchOtpUrl now retries transient failures up to 3× — the outer
// SOCKET_CONNECT_TIMEOUT_MS below has to cover the whole retry sequence.
const OTP_FETCH_TIMEOUT_MS = 6_000;
// Wraps getUrl() + the WS handshake. Must exceed the worst-case fetchOtpUrl
// retry sequence: 2 sequential REST calls, each up to 3 attempts of 6s with
// 0.5s+1s backoff (~19s per call, ~38s total), plus the 15s WS handshake.
// 60s covers a full transient-failure storm; a genuinely dead connection still
// fails within the minute and simply retries on the next scan tick.
const SOCKET_CONNECT_TIMEOUT_MS = 60_000;

// Deriv's REST edge intermittently returns 5xx (502/503/524) and, less often,
// times out — ~10 lost trades over 5 days (2026-09) were all transient auth
// failures, not bad tokens. Retry those; never retry 401/403 (a rejected
// credential fails identically on retry, and the engine must fail closed on it).
const OTP_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504, 522, 524]);
const OTP_MAX_ATTEMPTS = 3;

async function derivRestFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(OTP_FETCH_TIMEOUT_MS),
      });
      if (res.ok || !OTP_RETRYABLE_STATUS.has(res.status) || attempt === OTP_MAX_ATTEMPTS) {
        return res;
      }
      lastError = new Error(`${label}: HTTP ${res.status}`);
    } catch (e) {
      // AbortError (timeout) and network errors (TypeError) are transient.
      lastError = e;
      if (attempt === OTP_MAX_ATTEMPTS) throw e;
    }
    await sleep(attempt * 500);
  }
  throw lastError ?? new Error(`${label}: échec après ${OTP_MAX_ATTEMPTS} tentatives`);
}

export interface ServerCandle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

// ─── Generic request/subscription socket ─────────────────────────────────────

class DerivSocket {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private reqId = 0;
  private listeners = new Set<Listener>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private closedByUs = false;

  constructor(
    private getUrl: () => Promise<string>,
    private label: string,
  ) {}

  onMessage(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  get isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private async connect(): Promise<void> {
    if (this.isOpen) return;
    if (this.connecting) return this.connecting;
    const doConnect = async () => {
      const url = await this.getUrl();
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error(`${this.label}: timeout connexion`));
        }, 15_000);
        ws.onopen = () => {
          clearTimeout(timer);
          this.ws = ws;
          this.closedByUs = false;
          this.heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              try {
                ws.send(JSON.stringify({ ping: 1 }));
              } catch {
                /* ignore */
              }
            }
          }, 30_000);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error(`${this.label}: échec connexion WS`));
        };
        ws.onclose = () => {
          if (this.ws === ws) this.ws = null;
          if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
          }
        };
        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(String(evt.data)) as Msg;
            for (const l of [...this.listeners]) l(data);
          } catch {
            /* ignore */
          }
        };
      });
    };
    this.connecting = withTimeout(
      doConnect(),
      SOCKET_CONNECT_TIMEOUT_MS,
      `${this.label}: connexion`,
    );
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async request<T extends Msg = Msg>(payload: Msg, timeoutMs = 20_000): Promise<T> {
    await this.connect();
    const ws = this.ws;
    if (!ws) throw new Error(`${this.label}: socket indisponible`);
    const id = ++this.reqId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`${this.label}: timeout requête`));
      }, timeoutMs);
      const off = this.onMessage((msg) => {
        if (msg.req_id !== id) return;
        clearTimeout(timer);
        off();
        if (msg.error) {
          const error = msg.error as { code?: string; message?: string };
          reject(
            new DerivApiError(
              String(error.code ?? "DERIV_ERROR"),
              String(error.message ?? "Deriv error"),
            ),
          );
        } else resolve(msg as T);
      });
      try {
        ws.send(JSON.stringify({ ...payload, req_id: id }));
      } catch (e) {
        clearTimeout(timer);
        off();
        reject(e);
      }
    });
  }

  close() {
    this.closedByUs = true;
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

// ─── Shared public socket (market data, all users) ───────────────────────────

let publicSocket: DerivSocket | null = null;

// All server engines share one public Deriv socket. A per-engine concurrency
// cap is not enough: several users/presets can otherwise burst dozens of
// ticks_history requests together. Serialize, coalesce, and briefly cache.
const PUBLIC_HISTORY_SPACING_MS = 300;
const PUBLIC_HISTORY_CACHE_MS = 8_000;
const PUBLIC_HISTORY_RATE_LIMIT_COOLDOWN_MS = 5_000;
const PUBLIC_HISTORY_MAX_ATTEMPTS = 3;
let publicHistoryQueue: Promise<void> = Promise.resolve();
let nextPublicHistoryAt = 0;
const publicHistoryCache = new Map<string, { expiresAt: number; value: unknown }>();
const publicHistoryInflight = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown): boolean {
  const apiError =
    error instanceof DerivApiError ? `${error.code} ${error.message}` : String(error);
  return /rate[ _-]?limit|too many requests/i.test(apiError);
}

function queuePublicHistoryRequest<T>(request: () => Promise<T>): Promise<T> {
  const run = publicHistoryQueue.then(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < PUBLIC_HISTORY_MAX_ATTEMPTS; attempt++) {
      const waitMs = Math.max(0, nextPublicHistoryAt - Date.now());
      if (waitMs > 0) await sleep(waitMs);
      nextPublicHistoryAt = Date.now() + PUBLIC_HISTORY_SPACING_MS;
      try {
        return await request();
      } catch (error) {
        lastError = error;
        if (!isRateLimitError(error) || attempt === PUBLIC_HISTORY_MAX_ATTEMPTS - 1) throw error;
        // Deriv limits the shared public socket, not one user or preset.
        nextPublicHistoryAt = Math.max(
          nextPublicHistoryAt,
          Date.now() + PUBLIC_HISTORY_RATE_LIMIT_COOLDOWN_MS * (attempt + 1),
        );
      }
    }
    throw lastError;
  });
  publicHistoryQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function getPublicHistory<T>(
  key: string,
  request: () => Promise<T>,
  cacheMs = PUBLIC_HISTORY_CACHE_MS,
): Promise<T> {
  const cached = publicHistoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);
  const inflight = publicHistoryInflight.get(key);
  if (inflight) return inflight as Promise<T>;
  const pending = queuePublicHistoryRequest(request)
    .then((value) => {
      publicHistoryCache.set(key, { value, expiresAt: Date.now() + cacheMs });
      return value;
    })
    .finally(() => publicHistoryInflight.delete(key));
  publicHistoryInflight.set(key, pending);
  return pending;
}

function getPublicSocket(): DerivSocket {
  if (!publicSocket) publicSocket = new DerivSocket(async () => PUBLIC_WS_URL, "deriv-public");
  return publicSocket;
}

/** Process shutdown: the shared market-data socket would otherwise keep the
 * event loop alive past SIGTERM (see shutdownAllEngines in bot-engine.server.ts). */
export function closePublicSocket(): void {
  publicSocket?.close();
  publicSocket = null;
  publicHistoryCache.clear();
  publicHistoryInflight.clear();
  nextPublicHistoryAt = 0;
}

export async function fetchCandlesServer(
  symbol: string,
  granularitySeconds: number,
  count: number,
  end: number | "latest" = "latest",
): Promise<ServerCandle[]> {
  const key = `candles:${symbol}:${granularitySeconds}:${count}:${end}`;
  return getPublicHistory(
    key,
    async () => {
      const res = await getPublicSocket().request<{
        candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
      }>({
        ticks_history: symbol,
        style: "candles",
        granularity: granularitySeconds,
        count,
        end,
      });
      return (res.candles ?? []).map((c) => ({
        epoch: c.epoch,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));
    },
    end === "latest" ? PUBLIC_HISTORY_CACHE_MS : 60_000,
  );
}

/** Recent tick prices for micro-momentum confirmation.  Consumers must not
 * infer a spike from the number of ticks returned: the count is transport
 * metadata, not a market signal. */
export async function fetchRecentTicksServer(symbol: string, count = 120): Promise<number[]> {
  return getPublicHistory(`ticks:${symbol}:${count}`, async () => {
    const res = await getPublicSocket().request<{ history?: { prices?: Array<string | number> } }>({
      ticks_history: symbol,
      style: "ticks",
      count,
      end: "latest",
    });
    return (res.history?.prices ?? []).map(Number).filter(Number.isFinite);
  });
}

export interface MarketState {
  /** exchange_is_open from Deriv — 0 during weekends, holidays, the daily
   *  forex rollover, and each instrument's own maintenance breaks. */
  open: boolean;
  /** is_trading_suspended — a transient halt distinct from a scheduled close. */
  suspended: boolean;
  /** false only when the symbol was actually absent from the catalogue. */
  known: boolean;
}

/**
 * Per-symbol market open/suspended state from `active_symbols: full`, cached
 * 5 min (trading hours don't shift intraday). This gates every binary
 * proposal: a fixed-expiry contract whose window overlaps a close is
 * hard-rejected by Deriv ("Contract must expire during trading hours" /
 * "Trading is not available from HH:MM"), and a storm of those rejections
 * wedged the scan loop (2026-09-01). Unknown symbol → treated as open; the
 * proposal itself stays the definitive gate.
 */
export async function getMarketState(symbol: string): Promise<MarketState> {
  const rows = await getPublicHistory(
    "active_symbols:full",
    async () => {
      const res = await getPublicSocket().request<{
        active_symbols?: Array<{
          symbol?: string;
          underlying_symbol?: string;
          exchange_is_open?: 0 | 1;
          is_trading_suspended?: 0 | 1;
        }>;
      }>({ active_symbols: "full" });
      return res.active_symbols ?? [];
    },
    5 * 60_000,
  );
  const row = rows.find((s) => s.symbol === symbol || s.underlying_symbol === symbol);
  if (!row) return { open: true, suspended: false, known: false };
  return {
    open: row.exchange_is_open !== 0,
    suspended: row.is_trading_suspended === 1,
    known: true,
  };
}

// ─── Per-user authenticated trading connection ────────────────────────────────

async function fetchOtpUrl(
  patToken: string,
  accountType: "demo" | "live",
): Promise<{ url: string; currency: string; loginId: string; balance: number }> {
  const headers = {
    Authorization: `Bearer ${patToken}`,
    "Deriv-App-ID": DERIV_REST_APP_ID,
    "Content-Type": "application/json",
  };
  const accRes = await derivRestFetch(`${TRADING_V1}/accounts`, { headers }, "Deriv /accounts");
  // A 401 is not a transient proposal failure.  The engine must be able to
  // distinguish it from timeouts/rate limits and stop future entries safely.
  // derivRestFetch has already retried any transient 5xx/timeout by this point.
  if (!accRes.ok) {
    throw new DerivApiError(
      accRes.status === 401 ? "DERIV_AUTH_INVALID" : "DERIV_ACCOUNTS_FAILED",
      `Deriv auth échouée (${accRes.status})`,
    );
  }
  const accData = (await accRes.json()) as {
    data?: Array<{
      account_id: string;
      account_type: string;
      balance: string;
      currency: string;
      status: string;
    }>;
  };
  const accounts = accData.data ?? [];
  const wantedType = accountType === "live" ? "real" : "demo";
  const chosen =
    accounts.find((a) => a.account_type === wantedType && a.status === "active") ??
    accounts.find((a) => a.status === "active");
  if (!chosen) throw new Error("Aucun compte Deriv actif");

  const otpRes = await derivRestFetch(
    `${TRADING_V1}/accounts/${chosen.account_id}/otp`,
    { method: "POST", headers },
    "Deriv /otp",
  );
  if (!otpRes.ok) {
    throw new DerivApiError(
      otpRes.status === 401 ? "DERIV_AUTH_INVALID" : "DERIV_OTP_FAILED",
      `OTP WebSocket refusé (${otpRes.status})`,
    );
  }
  const otpData = (await otpRes.json()) as { data?: { url?: string } };
  if (!otpData.data?.url) throw new Error("URL WebSocket OTP manquante");
  return {
    url: otpData.data.url,
    currency: chosen.currency,
    loginId: chosen.account_id,
    balance: parseFloat(chosen.balance),
  };
}

export interface ServerContractUpdate {
  contractId: number;
  profit: number;
  status: "open" | "won" | "lost";
}

export class DerivTradingConnection {
  private socket: DerivSocket;
  private currency = "USD";

  constructor(
    private patToken: string,
    private accountType: "demo" | "live",
  ) {
    this.socket = new DerivSocket(async () => {
      const otp = await fetchOtpUrl(this.patToken, this.accountType);
      this.currency = otp.currency;
      return otp.url;
    }, "deriv-trading");
  }

  /** Read-only contract gate. It never sends `buy`: a valid proposal is the
   * only prerequisite for a Boom900 multiplier order. */
  async validateMultiplierContract(params: {
    symbol: string;
    direction: "CALL" | "PUT";
    multiplier: number;
    amount: number;
  }) {
    const contractType = params.direction === "CALL" ? "MULTUP" : "MULTDOWN";
    const at = Date.now();
    try {
      const active = await this.socket.request<{
        active_symbols?: Array<{ symbol?: string; underlying_symbol?: string }>;
      }>({ active_symbols: "brief" });
      const activeSymbols = active.active_symbols ?? [];
      // Some Deriv Options sessions acknowledge active_symbols with an empty
      // list (observed even for BOOM500/CRASH900 that are tradable on the
      // same account). Keep the mandatory metadata request, but only reject
      // when it returned an actual, non-empty catalogue that excludes symbol.
      // contracts_for + proposal remain the definitive account-level gate.
      if (
        activeSymbols.length > 0 &&
        !activeSymbols.some(
          (s) => s.symbol === params.symbol || s.underlying_symbol === params.symbol,
        )
      ) {
        return {
          status: "CONTRACT_UNAVAILABLE" as const,
          at,
          contractType,
          error: { code: "SYMBOL_UNAVAILABLE", message: "Symbole absent de active_symbols" },
        };
      }
      const contracts = await this.socket.request<{
        contracts_for?: { available?: Array<{ contract_type?: string }> };
      }>({ contracts_for: params.symbol });
      if (!(contracts.contracts_for?.available ?? []).some((c) => c.contract_type === contractType))
        return {
          status: "CONTRACT_UNAVAILABLE" as const,
          at,
          contractType,
          error: {
            code: "CONTRACT_UNAVAILABLE",
            message: `${contractType} indisponible pour ${params.symbol}`,
          },
        };
      const proposal = await this.socket.request<{ proposal?: { id: string; ask_price: number } }>({
        proposal: 1,
        amount: roundToCurrency(params.amount, this.currency),
        basis: "stake",
        contract_type: contractType,
        currency: this.currency,
        underlying_symbol: params.symbol,
        multiplier: params.multiplier,
      });
      return {
        status: "AVAILABLE" as const,
        at,
        contractType,
        currency: this.currency,
        amount: params.amount,
        proposalId: proposal.proposal?.id,
        askPrice: proposal.proposal?.ask_price,
      };
    } catch (error) {
      const e =
        error instanceof DerivApiError
          ? error
          : new DerivApiError("TEMPORARY_ERROR", (error as Error).message);
      const lower = e.message.toLowerCase();
      const status =
        lower.includes("stake amount") || lower.includes("amount")
          ? "INVALID_STAKE"
          : lower.includes("multiplier")
            ? "INVALID_MULTIPLIER"
            : lower.includes("authorize") || lower.includes("account")
              ? "ACCOUNT_RESTRICTED"
              : "TEMPORARILY_DISABLED";
      return {
        status,
        at,
        contractType,
        currency: this.currency,
        amount: params.amount,
        error: { code: e.code, message: e.message },
      };
    }
  }

  get isOpen(): boolean {
    return this.socket.isOpen;
  }

  async getBalance(): Promise<{ balance: number; currency: string } | null> {
    try {
      const res = await this.socket.request<{ balance?: { balance: number; currency: string } }>({
        balance: 1,
      });
      if (res.balance) {
        this.currency = res.balance.currency;
        return { balance: Number(res.balance.balance), currency: res.balance.currency };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Read-only payout quote (no money committed — a proposal is just a price
   * check) as (payout - stake) / stake. Deriv's actual payout varies by
   * instrument/duration/volatility and isn't the flat ~85% often assumed —
   * lets the caller reject a trade whose current payout is too thin to be
   * worth the risk, before the confidence score alone would greenlight it.
   */
  async getPayoutRatio(params: {
    symbol: string;
    amount: number;
    contractType: "CALL" | "PUT";
    durationMinutes: number;
  }): Promise<number | null> {
    try {
      const prop = await this.socket.request<{ proposal?: { ask_price: number; payout: number } }>({
        proposal: 1,
        amount: roundToCurrency(params.amount, this.currency),
        basis: "stake",
        contract_type: params.contractType,
        currency: this.currency,
        duration: params.durationMinutes,
        duration_unit: "m",
        underlying_symbol: params.symbol,
      });
      if (!prop.proposal || !prop.proposal.ask_price) return null;
      const ratio = (prop.proposal.payout - prop.proposal.ask_price) / prop.proposal.ask_price;
      return ratio > 0 && ratio < 5 ? ratio : null;
    } catch {
      return null;
    }
  }

  async proposeAndBuy(
    params: {
      symbol: string;
      amount: number;
      contractType: "CALL" | "PUT";
      durationMinutes: number;
    },
    maxAttempts = 3,
  ): Promise<{ contractId: number; buyPrice: number; payout: number }> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const prop = await this.socket.request<{
          proposal?: { id: string; ask_price: number; payout: number };
        }>({
          proposal: 1,
          amount: roundToCurrency(params.amount, this.currency),
          basis: "stake",
          contract_type: params.contractType,
          currency: this.currency,
          duration: params.durationMinutes,
          duration_unit: "m",
          underlying_symbol: params.symbol,
        });
        if (!prop.proposal) throw new Error("Proposal failed");
        const buy = await this.socket.request<{
          buy?: { contract_id: number; buy_price: number; payout: number };
        }>({
          buy: prop.proposal.id,
          // Deriv rejects a `price` with >2 decimals — the 1.05 slippage buffer must be re-rounded.
          price: roundToCurrency(Number(prop.proposal.ask_price) * 1.05, this.currency),
        });
        if (!buy.buy) throw new Error("Buy failed");
        return {
          contractId: buy.buy.contract_id,
          buyPrice: Number(buy.buy.buy_price),
          payout: Number(buy.buy.payout),
        };
      } catch (e) {
        lastError = e as Error;
        // Validation errors (invalid price/stake/contract) fail identically on retry —
        // only transient failures (proposal expired, network) are worth another attempt.
        if (/price|amount|stake|decimal|invalid|not available|not offered/i.test(lastError.message))
          break;
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
    throw lastError ?? new Error("Échec achat");
  }

  /**
   * Open a Multiplier position (MULTUP/MULTDOWN) — no fixed expiry, stays open
   * until stop_loss/take_profit triggers or it's sold manually. stop_loss and
   * take_profit are ABSOLUTE loss/profit amounts in account currency (positive
   * numbers — Deriv closes when the loss/profit reaches that amount), not a
   * price or a percentage.
   */
  async proposeAndBuyMultiplier(
    params: {
      symbol: string;
      amount: number;
      direction: "CALL" | "PUT";
      multiplier: number;
      stopLossUsd: number;
      takeProfitUsd: number;
    },
    maxAttempts = 4,
  ): Promise<{ contractId: number; buyPrice: number }> {
    const contractType = params.direction === "CALL" ? "MULTUP" : "MULTDOWN";
    // Every multiplier order, irrespective of feature flags or symbol, must
    // receive a current valid proposal before it can reach `buy`.
    const validation = await this.validateMultiplierContract(params);
    if (validation.status !== "AVAILABLE") {
      const detail = validation.error;
      throw new DerivApiError(
        detail?.code ?? validation.status,
        detail?.message ?? `${params.symbol} ${validation.status}`,
      );
    }
    let lastError: Error | null = null;
    const currentMultiplier = effectiveMultiplier(params.symbol, params.multiplier);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const prop = await this.socket.request<{ proposal?: { id: string; ask_price: number } }>({
          proposal: 1,
          amount: roundToCurrency(params.amount, this.currency),
          basis: "stake",
          contract_type: contractType,
          currency: this.currency,
          underlying_symbol: params.symbol,
          multiplier: currentMultiplier,
          limit_order: {
            stop_loss: roundToCurrency(params.stopLossUsd, this.currency),
            take_profit: roundToCurrency(params.takeProfitUsd, this.currency),
          },
        });
        if (!prop.proposal) throw new Error("Proposal failed");
        const buy = await this.socket.request<{ buy?: { contract_id: number; buy_price: number } }>(
          {
            buy: prop.proposal.id,
            // Same >2-decimal rejection as binary buys — re-round after the slippage buffer.
            price: roundToCurrency(Number(prop.proposal.ask_price) * 1.05, this.currency),
          },
        );
        if (!buy.buy) throw new Error("Buy failed");
        return { contractId: buy.buy.contract_id, buyPrice: Number(buy.buy.buy_price) };
      } catch (e) {
        lastError = e as Error;
        if (
          /price|amount|stake|decimal|invalid|not available|not offered|multiplier|limit_order/i.test(
            lastError.message,
          )
        ) {
          break;
        }
        if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
    throw lastError ?? new Error("Échec achat multiplicateur");
  }

  /** Close an open position immediately at market price (used for the max-hold-time safety net). */
  async sellContract(contractId: number): Promise<void> {
    await this.socket.request({ sell: contractId, price: 0 });
  }

  /** Subscribe to a contract's lifecycle; returns an unsubscribe function. */
  subscribeContract(contractId: number, onUpdate: (u: ServerContractUpdate) => void): () => void {
    let subId: string | undefined;
    const off = this.socket.onMessage((msg) => {
      const p = (msg as { proposal_open_contract?: Record<string, unknown> })
        .proposal_open_contract;
      if (!p || p.contract_id !== contractId) return;
      const subscription = (msg as { subscription?: { id?: string } }).subscription;
      if (subscription?.id) subId = subscription.id;
      const done = p.is_expired || p.is_settleable || p.is_sold;
      onUpdate({
        contractId,
        profit: Number(p.profit ?? 0),
        status: done ? (Number(p.profit ?? 0) > 0 ? "won" : "lost") : "open",
      });
    });
    this.socket
      .request({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })
      .catch(() => {});
    return () => {
      off();
      if (subId) this.socket.request({ forget: subId }).catch(() => {});
    };
  }

  async getProfitTable(limit = 50): Promise<Array<{ contractId: number; profit: number }>> {
    try {
      const res = await this.socket.request<{
        profit_table?: {
          transactions?: Array<{
            contract_id: number;
            buy_price: number;
            sell_price: number;
            profit?: number;
          }>;
        };
      }>({ profit_table: 1, limit, sort: "DESC" });
      return (res.profit_table?.transactions ?? []).map((t) => ({
        contractId: t.contract_id,
        profit:
          t.profit !== undefined ? Number(t.profit) : Number(t.sell_price) - Number(t.buy_price),
      }));
    } catch {
      return [];
    }
  }

  async getOpenPositions(): Promise<DerivPortfolioResult> {
    try {
      const res = await this.socket.request<{
        portfolio?: {
          contracts?: Array<{
            contract_id: number;
            symbol: string;
            buy_price: number;
          }>;
        };
      }>({ portfolio: 1 });
      const positions = (res.portfolio?.contracts ?? []).map((c) => ({
        contractId: c.contract_id,
        symbol: c.symbol,
        buyPrice: Number(c.buy_price || 0),
        profit: 0,
      }));
      return { success: true, positions };
    } catch (e) {
      return { success: false, error: (e as Error).message ?? "Failed to fetch portfolio" };
    }
  }

  close() {
    this.socket.close();
  }
}
