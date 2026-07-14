// Node-side Deriv client for the SERVER auto-trader (bot-engine.server.ts).
//
// Market data: legacy v3 public WS (no auth) — one shared connection.
// Trading: the Options Trading API. Like the browser client, a `pat_` token
// cannot authorize the legacy WS directly: we exchange it for a single-use OTP
// WebSocket URL via REST, then speak the same JSON protocol over that socket.
// OTP URLs die on disconnect, so every reconnect fetches a fresh one.
//
// Requires Node ≥ 22 (global WebSocket).

const DERIV_APP_ID = 1089;
const PUBLIC_WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;
const TRADING_V1 = "https://api.derivws.com/trading/v1/options";
const DERIV_REST_APP_ID = "33zECGFcSA3ZubKPdQJqm";

function getCurrencyDecimals(currency = "USD"): number {
  const c = currency.toUpperCase();
  if (c === "BTC") return 8;
  if (c === "ETH") return 6;
  if (c === "LTC") return 5;
  if (c === "USD" || c === "EUR" || c === "GBP" || c === "AUD" || c === "CAD" || c === "CHF" || c === "JPY") return 2;
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

type Msg = Record<string, unknown>;
type Listener = (msg: Msg) => void;

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

  constructor(private getUrl: () => Promise<string>, private label: string) {}

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
    this.connecting = (async () => {
      const url = await this.getUrl();
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => { try { ws.close(); } catch { /* ignore */ } reject(new Error(`${this.label}: timeout connexion`)); }, 15_000);
        ws.onopen = () => {
          clearTimeout(timer);
          this.ws = ws;
          this.closedByUs = false;
          this.heartbeat = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify({ ping: 1 })); } catch { /* ignore */ } }
          }, 30_000);
          resolve();
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error(`${this.label}: échec connexion WS`)); };
        ws.onclose = () => {
          if (this.ws === ws) this.ws = null;
          if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
        };
        ws.onmessage = (evt) => {
          try {
            const data = JSON.parse(String(evt.data)) as Msg;
            for (const l of [...this.listeners]) l(data);
          } catch { /* ignore */ }
        };
      });
    })();
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
      const timer = setTimeout(() => { off(); reject(new Error(`${this.label}: timeout requête`)); }, timeoutMs);
      const off = this.onMessage((msg) => {
        if (msg.req_id !== id) return;
        clearTimeout(timer);
        off();
        if (msg.error) reject(new Error(String((msg.error as { message?: string }).message ?? "Deriv error")));
        else resolve(msg as T);
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
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }
}

// ─── Shared public socket (market data, all users) ───────────────────────────

let publicSocket: DerivSocket | null = null;

function getPublicSocket(): DerivSocket {
  if (!publicSocket) publicSocket = new DerivSocket(async () => PUBLIC_WS_URL, "deriv-public");
  return publicSocket;
}

/** Process shutdown: the shared market-data socket would otherwise keep the
 * event loop alive past SIGTERM (see shutdownAllEngines in bot-engine.server.ts). */
export function closePublicSocket(): void {
  publicSocket?.close();
  publicSocket = null;
}

export async function fetchCandlesServer(symbol: string, granularitySeconds: number, count: number): Promise<ServerCandle[]> {
  const res = await getPublicSocket().request<{
    candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }>;
  }>({
    ticks_history: symbol,
    style: "candles",
    granularity: granularitySeconds,
    count,
    end: "latest",
  });
  return (res.candles ?? []).map((c) => ({
    epoch: c.epoch, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
  }));
}

// ─── Per-user authenticated trading connection ────────────────────────────────

async function fetchOtpUrl(patToken: string, accountType: "demo" | "live"): Promise<{ url: string; currency: string; loginId: string; balance: number }> {
  const headers = {
    Authorization: `Bearer ${patToken}`,
    "Deriv-App-ID": DERIV_REST_APP_ID,
    "Content-Type": "application/json",
  };
  const accRes = await fetch(`${TRADING_V1}/accounts`, { headers });
  if (!accRes.ok) throw new Error(`Deriv auth échouée (${accRes.status})`);
  const accData = (await accRes.json()) as { data?: Array<{ account_id: string; account_type: string; balance: string; currency: string; status: string }> };
  const accounts = accData.data ?? [];
  const wantedType = accountType === "live" ? "real" : "demo";
  const chosen =
    accounts.find((a) => a.account_type === wantedType && a.status === "active") ??
    accounts.find((a) => a.status === "active");
  if (!chosen) throw new Error("Aucun compte Deriv actif");

  const otpRes = await fetch(`${TRADING_V1}/accounts/${chosen.account_id}/otp`, { method: "POST", headers });
  if (!otpRes.ok) throw new Error(`OTP WebSocket refusé (${otpRes.status})`);
  const otpData = (await otpRes.json()) as { data?: { url?: string } };
  if (!otpData.data?.url) throw new Error("URL WebSocket OTP manquante");
  return { url: otpData.data.url, currency: chosen.currency, loginId: chosen.account_id, balance: parseFloat(chosen.balance) };
}

export interface ServerContractUpdate {
  contractId: number;
  profit: number;
  status: "open" | "won" | "lost";
}

export class DerivTradingConnection {
  private socket: DerivSocket;
  private currency = "USD";

  constructor(private patToken: string, private accountType: "demo" | "live") {
    this.socket = new DerivSocket(async () => {
      const otp = await fetchOtpUrl(this.patToken, this.accountType);
      this.currency = otp.currency;
      return otp.url;
    }, "deriv-trading");
  }

  get isOpen(): boolean {
    return this.socket.isOpen;
  }

  async getBalance(): Promise<{ balance: number; currency: string } | null> {
    try {
      const res = await this.socket.request<{ balance?: { balance: number; currency: string } }>({ balance: 1 });
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

  async proposeAndBuy(params: {
    symbol: string;
    amount: number;
    contractType: "CALL" | "PUT";
    durationMinutes: number;
  }, maxAttempts = 3): Promise<{ contractId: number; buyPrice: number; payout: number }> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const prop = await this.socket.request<{ proposal?: { id: string; ask_price: number; payout: number } }>({
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
        const buy = await this.socket.request<{ buy?: { contract_id: number; buy_price: number; payout: number } }>({
          buy: prop.proposal.id,
          // Deriv rejects a `price` with >2 decimals — the 1.05 slippage buffer must be re-rounded.
          price: roundToCurrency(Number(prop.proposal.ask_price) * 1.05, this.currency),
        });
        if (!buy.buy) throw new Error("Buy failed");
        return { contractId: buy.buy.contract_id, buyPrice: Number(buy.buy.buy_price), payout: Number(buy.buy.payout) };
      } catch (e) {
        lastError = e as Error;
        // Validation errors (invalid price/stake/contract) fail identically on retry —
        // only transient failures (proposal expired, network) are worth another attempt.
        if (/price|amount|stake|decimal|invalid|not available|not offered/i.test(lastError.message)) break;
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
  async proposeAndBuyMultiplier(params: {
    symbol: string;
    amount: number;
    direction: "CALL" | "PUT";
    multiplier: number;
    stopLossUsd: number;
    takeProfitUsd: number;
  }, maxAttempts = 4): Promise<{ contractId: number; buyPrice: number }> {
    const contractType = params.direction === "CALL" ? "MULTUP" : "MULTDOWN";
    let lastError: Error | null = null;
    let currentMultiplier = effectiveMultiplier(params.symbol, params.multiplier);

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
        const buy = await this.socket.request<{ buy?: { contract_id: number; buy_price: number } }>({
          buy: prop.proposal.id,
          // Same >2-decimal rejection as binary buys — re-round after the slippage buffer.
          price: roundToCurrency(Number(prop.proposal.ask_price) * 1.05, this.currency),
        });
        if (!buy.buy) throw new Error("Buy failed");
        return { contractId: buy.buy.contract_id, buyPrice: Number(buy.buy.buy_price) };
      } catch (e) {
        lastError = e as Error;
        const errMsg = lastError.message;
        
        // Auto-guérison : si le multiplicateur ou la limit_order est invalide
        if (errMsg.toLowerCase().includes("multiplier") || errMsg.toLowerCase().includes("limit_order")) {
          // Extraction des multiplicateurs autorisés dans le message d'erreur
          const numbers = errMsg.match(/\b\d+\b/g)?.map(Number).filter(n => n >= 1 && n <= 1000);
          if (numbers && numbers.length > 0) {
            const closest = numbers.reduce((prev, curr) => 
              Math.abs(curr - currentMultiplier) < Math.abs(prev - currentMultiplier) ? curr : prev
            );
            if (closest !== currentMultiplier) {
              console.log(`[bot] Auto-guérison : Ajustement du multiplicateur pour ${params.symbol} de ${currentMultiplier} à ${closest} (via message d'erreur)`);
              currentMultiplier = closest;
              continue; // Réessayer immédiatement
            }
          } else {
            // Fallback en dur si aucun chiffre n'est extrait
            let fallbackMultipliers = [20, 50, 100];
            if (params.symbol.startsWith("cry")) {
              fallbackMultipliers = [10, 20, 50, 100];
            } else if (!params.symbol.startsWith("frx")) {
              fallbackMultipliers = [100, 200, 500];
            }
            const closest = fallbackMultipliers.reduce((prev, curr) => 
              Math.abs(curr - currentMultiplier) < Math.abs(prev - currentMultiplier) ? curr : prev
            );
            if (closest !== currentMultiplier) {
              console.log(`[bot] Auto-guérison : Ajustement du multiplicateur pour ${params.symbol} de ${currentMultiplier} à ${closest} (via fallback)`);
              currentMultiplier = closest;
              continue; // Réessayer immédiatement
            }
          }
        }
        
        if (/price|amount|stake|decimal|invalid|not available|not offered/i.test(lastError.message)) {
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
      const p = (msg as { proposal_open_contract?: Record<string, unknown> }).proposal_open_contract;
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
    this.socket.request({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 }).catch(() => {});
    return () => {
      off();
      if (subId) this.socket.request({ forget: subId }).catch(() => {});
    };
  }

  async getProfitTable(limit = 50): Promise<Array<{ contractId: number; profit: number }>> {
    try {
      const res = await this.socket.request<{
        profit_table?: { transactions?: Array<{ contract_id: number; buy_price: number; sell_price: number; profit?: number }> };
      }>({ profit_table: 1, limit, sort: "DESC" });
      return (res.profit_table?.transactions ?? []).map((t) => ({
        contractId: t.contract_id,
        profit: t.profit !== undefined ? Number(t.profit) : Number(t.sell_price) - Number(t.buy_price),
      }));
    } catch {
      return [];
    }
  }

  close() {
    this.socket.close();
  }
}
