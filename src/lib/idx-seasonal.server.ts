// Piste A — "Index Seasonal" : effet lundi haussier sur les indices actions.
//
// Recherche (RESEARCH-A-index-monday.md, 2026-09-03) : LONG un indice à
// l'ouverture du lundi, sortie à la clôture du lundi. 10 marchés mondiaux sur
// 10 nets positifs en out-of-sample, PF OOS ~2.3, WR ~60 %, médiane ≈ moyenne
// (pas porté par 2 lundis), encore actif dans les données récentes. Anomalie
// connue ("weekend effect" inversé sur les marchés électroniques).
//
// L'effet n'existe PAS heure par heure (~52 % à chaque heure) — il faut tenir
// toute la séance. Deriv n'offre pas de multiplicateur sur les OTC indices
// (testé le 2026-09-03 : "MULTUP indisponible"), donc : un binaire CALL "Rise"
// avec la plus longue durée que Deriv accepte sur le symbole, entré le lundi
// matin, qui se règle tout seul.
//
// Scheduler AUTONOME, hors du moteur TA (ServerBotEngine) : un signal calendaire
// n'a rien à faire dans la cascade d'analyse technique. Journalise dans
// bot_trades avec preset='idxseasonal' — Journal et stats existants OK.
//
// On/off : ligne idx_seasonal_state (id=1). enabled=0 -> no-op total.
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
// session de tous les indices (Tokyo tôt -> New York).
const ENTRY_UTC_HOUR_START = 7;
const ENTRY_UTC_HOUR_END = 14;
// Durées de hold visées (minutes), de la plus longue à la plus courte. On prend
// la première que Deriv accepte pour le symbole (bornée par contracts_for).
const HOLD_LADDER_MIN = [480, 360, 240, 180, 120, 60];
const SETTLE_BUFFER_MS = 90_000; // marge après expiration avant de lire le P&L

const STAKE_USD = 5;

const KILL_SWITCH_WINDOW_MS = 28 * 24 * 3600_000;
const KILL_SWITCH_MIN_TRADES = 20;
const KILL_SWITCH_MIN_PF = 1.0;

interface OpenPos {
  tradeId: string;
  contractId: number;
  symbol: string;
  entryTime: number;
  durationMin: number;
}

let timer: ReturnType<typeof setInterval> | null = null;
let conn: DerivTradingConnection | null = null;
const openPositions = new Map<string, OpenPos>();
let lastKillSwitchLog = 0;
let durationsLogged = false;

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

// Dedicated row, not bot_state: restoreBots() force-disables any bot_state
// entry whose preset isn't in ACTIVE_PRESETS, which killed this scheduler on
// every restart (2026-09-03). See idx_seasonal_state in db.server.ts.
function isEnabled(): boolean {
  const row = db()
    .prepare(`SELECT enabled FROM idx_seasonal_state WHERE id = 1`)
    .get() as { enabled: number } | undefined;
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
  tradeId: string; userId: number; symbol: string; entryPrice: number;
  contractId: number; durationMin: number; payout: number;
}): void {
  db()
    .prepare(
      `INSERT INTO bot_trades
        (id, user_id, time, symbol, direction, stake, payout, status, profit,
         confidence, tf_agreement, contract_id, note, strategy, strategy_version,
         entry_price, duration_minutes, mode, preset, entry_time, market_type, execution_mode)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.tradeId, p.userId, Date.now(), p.symbol, "CALL", STAKE_USD, p.payout, "open", 0,
      65, 0, String(p.contractId), "Index Seasonal — lundi haussier", "IDX_SEASONAL", "v1",
      p.entryPrice, p.durationMin, "demo", IDX_SEASONAL_PRESET, Date.now(), "DERIV_INDEX", "LIVE",
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
      `Index Seasonal — réglé (${reason})`,
      pos.tradeId,
    );
}

async function getConn(token: string): Promise<DerivTradingConnection> {
  if (!conn) conn = new DerivTradingConnection(token, "demo");
  return conn;
}

async function realizedProfit(c: DerivTradingConnection, contractId: number): Promise<number | null> {
  const table = await c.getProfitTable(50).catch(() => []);
  const hit = table.find((t) => t.contractId === contractId);
  return hit ? hit.profit : null;
}

async function tick(): Promise<void> {
  const account = resolveAccount();
  if (!account) return;
  const enabled = isEnabled();

  const now = new Date();
  const isMonday = now.getUTCDay() === 1;
  const hour = now.getUTCHours();
  const c = openPositions.size || enabled ? await getConn(account.token) : null;

  // ── Règlement des binaires expirés (toujours, même si désarmé) ──
  if (c) {
    for (const pos of [...openPositions.values()]) {
      const expiresAt = pos.entryTime + pos.durationMin * 60_000;
      if (Date.now() < expiresAt + SETTLE_BUFFER_MS) continue;
      const pnl = await realizedProfit(c, pos.contractId);
      if (pnl === null) {
        // pas encore dans le profit_table — on retente au prochain tick,
        // sauf si ça traîne depuis > 30 min après expiration (contrat perdu).
        if (Date.now() > expiresAt + 30 * 60_000) {
          closeTrade(pos, -STAKE_USD, "settle-timeout");
          openPositions.delete(pos.symbol);
          console.warn(`[idx-seasonal] ${pos.symbol} règlement introuvable — clôturé -$${STAKE_USD}`);
        }
        continue;
      }
      closeTrade(pos, pnl, "expiry");
      openPositions.delete(pos.symbol);
      console.log(`[idx-seasonal] ${pos.symbol} réglé P&L ${pnl.toFixed(2)}`);
    }
  }

  if (!enabled) return;

  // ── Entrées : lundi, fenêtre horaire, kill-switch off ──
  // IDX_SEASONAL_TEST_MODE=1 : ignore la fenêtre lundi/heure pour vérifier la
  // plomberie un jour de semaine (respecte marché ouvert, 1/symbole/jour, kill-switch).
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

  const conn2 = await getConn(account.token);

  if (!durationsLogged) {
    durationsLogged = true;
    const b = await conn2.getRiseFallDurationBounds("OTC_NDX").catch(() => null);
    console.log(
      `[idx-seasonal] Rise/Fall OTC_NDX bornes: ${b ? `${(b.minSec / 60).toFixed(0)}min .. ${(b.maxSec / 60).toFixed(0)}min` : "inconnues"}`,
    );
  }

  for (const symbol of SYMBOLS) {
    if (openPositions.has(symbol)) continue;
    if (tradedThisUtcDay(symbol)) continue;
    const mkt = await getMarketState(symbol).catch(() => null);
    if (!mkt || !mkt.open || mkt.suspended) continue;

    // borne la durée par ce que Deriv accepte pour ce symbole
    const bounds = await conn2.getRiseFallDurationBounds(symbol).catch(() => null);
    const maxMin = bounds ? Math.floor(bounds.maxSec / 60) : Infinity;
    const minMin = bounds ? Math.ceil(bounds.minSec / 60) : 1;
    const ladder = HOLD_LADDER_MIN.filter((d) => d <= maxMin && d >= minMin);
    if (!ladder.length) ladder.push(Math.min(60, maxMin === Infinity ? 60 : maxMin));

    let placed = false;
    for (const durationMin of ladder) {
      try {
        const bought = await conn2.proposeAndBuy({
          symbol, amount: STAKE_USD, contractType: "CALL", durationMinutes: durationMin,
        });
        const tradeId = `idxs_${Date.now()}_${symbol}`;
        insertOpenTrade({
          tradeId, userId: account.userId, symbol,
          entryPrice: bought.buyPrice, contractId: bought.contractId,
          durationMin, payout: bought.payout,
        });
        openPositions.set(symbol, {
          tradeId, contractId: bought.contractId, symbol,
          entryTime: Date.now(), durationMin,
        });
        console.log(`[idx-seasonal] LONG ${symbol} CALL ${durationMin}min $${STAKE_USD} — contrat ${bought.contractId} (payout ${bought.payout})`);
        placed = true;
        break;
      } catch (e) {
        const msg = (e as Error).message;
        if (!/not offered|not available|duration/i.test(msg)) {
          console.error(`[idx-seasonal] échec entrée ${symbol} (${durationMin}min):`, msg);
          break; // erreur non liée à la durée — inutile de descendre le ladder
        }
        // sinon : durée refusée, on essaie la suivante
      }
    }
    if (!placed) console.error(`[idx-seasonal] ${symbol} : aucune durée acceptée`);
  }
}

export function startIdxSeasonalScheduler(): void {
  if (timer) return;
  // reprise : recharger les positions ouvertes journalisées avant un restart.
  try {
    const rows = db()
      .prepare(
        `SELECT id, symbol, contract_id, entry_time, duration_minutes
           FROM bot_trades WHERE preset = ? AND status = 'open'`,
      )
      .all(IDX_SEASONAL_PRESET) as {
        id: string; symbol: string; contract_id: string; entry_time: number; duration_minutes: number;
      }[];
    for (const r of rows) {
      const cid = Number(r.contract_id);
      if (!Number.isFinite(cid)) continue;
      openPositions.set(r.symbol, {
        tradeId: r.id, contractId: cid, symbol: r.symbol,
        entryTime: r.entry_time || Date.now(),
        durationMin: r.duration_minutes || HOLD_LADDER_MIN[0],
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
  setTimeout(() => tick().catch(() => {}), 15_000);
}

export function stopIdxSeasonalScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; }
  conn?.close();
  conn = null;
}
