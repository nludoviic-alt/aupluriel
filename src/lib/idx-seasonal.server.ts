// Piste A — "Index Seasonal" : effet lundi haussier sur les indices actions.
//
// Recherche (RESEARCH-A-index-monday.md, 2026-09-03) : LONG un indice à
// l'ouverture du lundi, sortie à la clôture du lundi. 10 marchés mondiaux sur
// 10 nets positifs en out-of-sample, PF OOS ~2.3, WR ~60 %, médiane ≈ moyenne
// (pas porté par 2 lundis), encore actif dans les données récentes. Anomalie
// connue ("weekend effect" inversé sur les marchés électroniques).
//
// Scheduler AUTONOME, volontairement hors du moteur TA (ServerBotEngine) :
// un signal calendaire n'a rien à faire dans la cascade d'analyse technique.
// Il ouvre/ferme des positions multiplicateur via DerivTradingConnection et
// journalise dans bot_trades avec preset='idxseasonal' — tout l'affichage et
// les stats existants (Journal, requêtes) fonctionnent tels quels.
//
// On/off : ligne bot_state (userId, 'idxseasonal'). enabled=0 -> no-op total.
// Kill-switch : PF glissant 28 j < 1.0 sur >= 20 trades clôturés -> pause.
// Démo uniquement en V1. Mise fixe, pas de Kelly/adaptatif — on mesure d'abord.

import { getDb } from "./db.server";
import { DerivTradingConnection, getMarketState } from "./deriv.server";

export const IDX_SEASONAL_PRESET = "idxseasonal";

// Les 10 indices validés en OOS (RESEARCH-A). Deriv OTC index CFDs.
const SYMBOLS = [
  "OTC_NDX", "OTC_SPC", "OTC_DJI", "OTC_GDAXI", "OTC_N225",
  "OTC_HSI", "OTC_FCHI", "OTC_AS51", "OTC_SX5E", "OTC_SSMI",
] as const;

const TICK_MS = 5 * 60_000;
// Fenêtre d'entrée : lundi, entre 07:00 et 14:00 UTC — couvre l'ouverture de
// session de tous les indices (Tokyo tôt -> New York). On entre une fois par
// symbole dès qu'il est ouvert dans cette fenêtre.
const ENTRY_UTC_HOUR_START = 7;
const ENTRY_UTC_HOUR_END = 14;
// Sortie : clôture de session détectée, ou au plus tard après MAX_HOLD.
const MAX_HOLD_MINUTES = 9 * 60;

const STAKE_USD = 5;
const MULTIPLIER = 20;               // x20 : un lundi à -3% -> -60% de la mise (~-$3)
const STOP_LOSS_USD = STAKE_USD;     // perte plafonnée à 100 % de la mise
const TAKE_PROFIT_USD = STAKE_USD * 4;

const KILL_SWITCH_WINDOW_MS = 28 * 24 * 3600_000;
const KILL_SWITCH_MIN_TRADES = 20;
const KILL_SWITCH_MIN_PF = 1.0;

interface OpenPos {
  tradeId: string;
  contractId: number;
  symbol: string;
  entryTime: number;
  entryPrice: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let conn: DerivTradingConnection | null = null;
const openPositions = new Map<string, OpenPos>();
let lastKillSwitchLog = 0;

function db() {
  return getDb();
}

/** Admin account (owner) + son token Deriv démo. */
function resolveAccount(): { userId: number; token: string } | null {
  const row = db()
    .prepare(
      `SELECT u.id AS userId, us.deriv_token AS token
         FROM users u JOIN user_settings us ON us.user_id = u.id
        WHERE u.is_admin = 1 AND us.deriv_token IS NOT NULL AND us.deriv_token != ''
        ORDER BY u.id LIMIT 1`,
    )
    .get() as { userId: number; token: string } | undefined;
  return row ?? null;
}

function isEnabled(userId: number): boolean {
  const row = db()
    .prepare(`SELECT enabled FROM bot_state WHERE user_id = ? AND preset = ?`)
    .get(userId, IDX_SEASONAL_PRESET) as { enabled: number } | undefined;
  return !!row && row.enabled === 1;
}

/** PF glissant 28 j sur les trades idxseasonal clôturés. null si échantillon trop petit. */
function trailingProfitFactor(): { pf: number; n: number } | null {
  const rows = db()
    .prepare(
      `SELECT profit FROM bot_trades
        WHERE preset = ? AND status IN ('won','lost') AND time >= ?`,
    )
    .all(IDX_SEASONAL_PRESET, Date.now() - KILL_SWITCH_WINDOW_MS) as { profit: number }[];
  if (rows.length < KILL_SWITCH_MIN_TRADES) return null;
  let gp = 0, gl = 0;
  for (const r of rows) {
    if (r.profit > 0) gp += r.profit;
    else gl += -r.profit;
  }
  return { pf: gl === 0 ? Infinity : gp / gl, n: rows.length };
}

function tradedThisUtcDay(symbol: string): boolean {
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const row = db()
    .prepare(
      `SELECT 1 FROM bot_trades WHERE preset = ? AND symbol = ? AND time >= ? LIMIT 1`,
    )
    .get(IDX_SEASONAL_PRESET, symbol, dayStart) as unknown;
  return !!row;
}

function insertOpenTrade(p: {
  tradeId: string; userId: number; symbol: string; entryPrice: number; contractId: number;
}): void {
  db()
    .prepare(
      `INSERT INTO bot_trades
        (id, user_id, time, symbol, direction, stake, payout, status, profit,
         confidence, tf_agreement, contract_id, note, strategy, strategy_version,
         entry_price, multiplier, stop_loss, take_profit, mode, preset,
         entry_time, configured_max_hold_seconds, market_type, execution_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.tradeId, p.userId, Date.now(), p.symbol, "CALL", STAKE_USD, 0, "open", 0,
      65, 0, String(p.contractId), "Index Seasonal — lundi haussier", "IDX_SEASONAL", "v1",
      p.entryPrice, MULTIPLIER, STOP_LOSS_USD, TAKE_PROFIT_USD, "demo", IDX_SEASONAL_PRESET,
      Date.now(), MAX_HOLD_MINUTES * 60, "DERIV_INDEX", "LIVE",
    );
}

function closeTrade(pos: OpenPos, profit: number, reason: string): void {
  const now = Date.now();
  db()
    .prepare(
      `UPDATE bot_trades SET
         status = ?, profit = ?, closed_at = ?, exit_time = ?,
         hold_duration_seconds = ?, exit_reason = ?, note = ?
       WHERE id = ?`,
    )
    .run(
      profit >= 0 ? "won" : "lost",
      profit,
      now,
      now,
      Math.round((now - pos.entryTime) / 1000),
      reason,
      `Index Seasonal — clôturé (${reason})`,
      pos.tradeId,
    );
}

async function getConn(token: string): Promise<DerivTradingConnection> {
  if (!conn) conn = new DerivTradingConnection(token, "demo");
  return conn;
}

async function realizedProfit(c: DerivTradingConnection, contractId: number): Promise<number> {
  for (let i = 0; i < 3; i++) {
    const table = await c.getProfitTable(25).catch(() => []);
    const hit = table.find((t) => t.contractId === contractId);
    if (hit) return hit.profit;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 0;
}

async function tick(): Promise<void> {
  const account = resolveAccount();
  if (!account) return;
  if (!isEnabled(account.userId)) {
    // arrêt propre : si des positions traînent encore ouvertes, les fermer.
    if (openPositions.size && conn) {
      for (const pos of [...openPositions.values()]) {
        try {
          await conn.sellContract(pos.contractId);
          const pnl = await realizedProfit(conn, pos.contractId);
          closeTrade(pos, pnl, "disabled");
        } catch { /* réessai au prochain tick */ }
        openPositions.delete(pos.symbol);
      }
    }
    return;
  }

  const c = await getConn(account.token);
  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const hour = now.getUTCHours();

  // ── Sorties ──
  for (const pos of [...openPositions.values()]) {
    const heldMin = (Date.now() - pos.entryTime) / 60_000;
    let reason: string | null = null;
    if (heldMin >= MAX_HOLD_MINUTES) reason = "max-hold";
    else {
      const mkt = await getMarketState(pos.symbol).catch(() => null);
      if (mkt && mkt.known && !mkt.open) reason = "session-close";
    }
    if (!reason) continue;
    try {
      await c.sellContract(pos.contractId);
      const pnl = await realizedProfit(c, pos.contractId);
      closeTrade(pos, pnl, reason);
      console.log(`[idx-seasonal] ${pos.symbol} clôturé (${reason}) P&L ${pnl.toFixed(2)}`);
    } catch (e) {
      console.error(`[idx-seasonal] échec clôture ${pos.symbol}:`, (e as Error).message);
      continue; // on retentera
    }
    openPositions.delete(pos.symbol);
  }

  // ── Entrées : lundi, fenêtre horaire, kill-switch off ──
  // IDX_SEASONAL_TEST_MODE=1 : ignore la fenêtre lundi/heure pour vérifier la
  // plomberie d'exécution un jour de semaine (respecte quand même marché ouvert,
  // 1 trade/symbole/jour, et le kill-switch). À retirer après validation.
  const testMode = process.env.IDX_SEASONAL_TEST_MODE === "1";
  if (!testMode && (!isMonday || hour < ENTRY_UTC_HOUR_START || hour >= ENTRY_UTC_HOUR_END)) return;

  const ks = trailingProfitFactor();
  if (ks && ks.pf < KILL_SWITCH_MIN_PF) {
    if (Date.now() - lastKillSwitchLog > 6 * 3600_000) {
      console.warn(`[idx-seasonal] KILL-SWITCH actif — PF 28j ${ks.pf.toFixed(2)} < ${KILL_SWITCH_MIN_PF} sur ${ks.n} trades. Entrées suspendues.`);
      lastKillSwitchLog = Date.now();
    }
    return;
  }

  for (const symbol of SYMBOLS) {
    if (openPositions.has(symbol)) continue;
    if (tradedThisUtcDay(symbol)) continue;
    const mkt = await getMarketState(symbol).catch(() => null);
    if (!mkt || !mkt.open || mkt.suspended) continue;

    try {
      const bought = await c.proposeAndBuyMultiplier({
        symbol,
        amount: STAKE_USD,
        direction: "CALL",
        multiplier: MULTIPLIER,
        stopLossUsd: STOP_LOSS_USD,
        takeProfitUsd: TAKE_PROFIT_USD,
      });
      const tradeId = `idxs_${Date.now()}_${symbol}`;
      insertOpenTrade({
        tradeId, userId: account.userId, symbol,
        entryPrice: bought.buyPrice, contractId: bought.contractId,
      });
      openPositions.set(symbol, {
        tradeId, contractId: bought.contractId, symbol,
        entryTime: Date.now(), entryPrice: bought.buyPrice,
      });
      console.log(`[idx-seasonal] LONG ${symbol} x${MULTIPLIER} $${STAKE_USD} — contrat ${bought.contractId}`);
    } catch (e) {
      console.error(`[idx-seasonal] échec entrée ${symbol}:`, (e as Error).message);
    }
  }
}

export function startIdxSeasonalScheduler(): void {
  if (timer) return;
  // reprise : recharger les positions ouvertes journalisées avant un restart.
  try {
    const rows = db()
      .prepare(
        `SELECT id, symbol, contract_id, entry_price, entry_time
           FROM bot_trades WHERE preset = ? AND status = 'open'`,
      )
      .all(IDX_SEASONAL_PRESET) as {
        id: string; symbol: string; contract_id: string; entry_price: number; entry_time: number;
      }[];
    for (const r of rows) {
      const cid = Number(r.contract_id);
      if (!Number.isFinite(cid)) continue;
      openPositions.set(r.symbol, {
        tradeId: r.id, contractId: cid, symbol: r.symbol,
        entryTime: r.entry_time || Date.now(), entryPrice: r.entry_price || 0,
      });
    }
    if (rows.length) console.log(`[idx-seasonal] ${rows.length} position(s) ouverte(s) rechargée(s).`);
  } catch (e) {
    console.error("[idx-seasonal] reprise échouée:", (e as Error).message);
  }

  timer = setInterval(() => {
    tick().catch((e) => console.error("[idx-seasonal] tick:", (e as Error).message));
  }, TICK_MS);
  console.log("[idx-seasonal] Scheduler démarré (contrôle toutes les 5 min).");
  // premier tick rapide
  setTimeout(() => tick().catch(() => {}), 15_000);
}

export function stopIdxSeasonalScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
  conn?.close();
  conn = null;
}
