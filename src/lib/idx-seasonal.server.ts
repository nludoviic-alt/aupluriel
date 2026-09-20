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
// Par défaut : suivi papier (voir PAPER_MODE plus bas), aucun ordre envoyé.

import { getDb } from "./db.server";
import { IDX_UNIVERSE } from "./idx-seasonal-plan";
import { DerivTradingConnection, fetchRecentTicksServer, getMarketState } from "./deriv.server";

export const IDX_SEASONAL_PRESET = "idxseasonal";

// Indices retenus (RESEARCH-A, resserré le 2026-09-20). Prix : Deriv OTC index.
//
// Un binaire Deriv sur indice DOIT expirer pendant les heures de marché
// ("Contract must expire during trading hours" — testé le 2026-09-03). Chaque
// bourse a sa propre session, donc chaque symbole a son heure d'entrée (UTC) et
// sa durée de hold, choisies pour que l'expiration tombe ~30-60 min avant la
// clôture. entryHourUtc : le tick tourne toutes les 5 min, on entre au 1er tick
// de cette heure (tradedThisUtcDay évite les doublons).
// Univers : voir idx-seasonal-plan.ts (S&P 500 et Nasdaq 100 depuis le 2026-09-20).
const IDX_CONFIG: Record<string, { entryHourUtc: number; durationMin: number }> = Object.fromEntries(
  IDX_UNIVERSE.map((l) => [l.symbol, { entryHourUtc: l.entryHourUtc, durationMin: l.durationMin }]),
);
const SYMBOLS = Object.keys(IDX_CONFIG);

const TICK_MS = 5 * 60_000;
// TEST_MODE : force une durée courte pour vérifier le cycle complet en séance.
const TEST_MODE_DURATION_MIN = 15;
const SETTLE_BUFFER_MS = 90_000; // marge après expiration avant de lire le P&L

const STAKE_USD = 5;

// Mode d'exécution. Deriv ne peut pas exprimer ce trade (un binaire OTC ne tient
// pas 4-7 h, pas de multiplicateur — voir l'audit du 2026-09-09) : par défaut le
// preset tourne en SUIVI PAPIER — entrée et sortie aux vrais prix Deriv, aucun
// ordre envoyé, journalisé avec execution_mode='PAPER'. C'est la validation
// forward prévue par RESEARCH-A (200 trades, kill-switch PF 28 j) sans le plafond
// de durée. IDX_SEASONAL_EXEC=deriv rétablit l'envoi d'ordres binaires démo.
const PAPER_MODE = process.env.IDX_SEASONAL_EXEC !== "deriv";
export const PAPER_NOTIONAL_USD = 1000;
export const PAPER_COST_PCT = 0.0003; // 0,03 % / trade, identique au backtest

/** P&L d'une position LONG papier, coût inclus. Pur, testable. */
export function paperProfit(entryPrice: number, exitPrice: number): number {
  if (!(entryPrice > 0) || !(exitPrice > 0)) return 0;
  return PAPER_NOTIONAL_USD * (exitPrice / entryPrice - 1 - PAPER_COST_PCT);
}

const KILL_SWITCH_WINDOW_MS = 28 * 24 * 3600_000;
const KILL_SWITCH_MIN_TRADES = 20;
const KILL_SWITCH_MIN_PF = 1.0;

interface OpenPos {
  tradeId: string;
  contractId: number;
  symbol: string;
  entryTime: number;
  durationMin: number;
  /** Suivi papier : pas de contrat Deriv, réglé au dernier tick. */
  paper?: boolean;
  entryPrice?: number;
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
  if (PAPER_MODE) {
    const owner = db()
      .prepare(`SELECT id AS userId FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1`)
      .get() as { userId: number } | undefined;
    return owner ? { userId: owner.userId, token: "" } : null;
  }
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
  // Mode papier : seuls les trades papier comptent (les 20 binaires 60 min des
  // 7 et 14 sept. dans bot_trades déclencheraient le kill-switch à tort).
  const rows = (PAPER_MODE
    ? db()
        .prepare(`SELECT profit FROM idx_paper_trades WHERE status IN ('won','lost') AND time >= ?`)
        .all(Date.now() - KILL_SWITCH_WINDOW_MS)
    : db()
        .prepare(
          `SELECT profit FROM bot_trades
            WHERE preset = ? AND status IN ('won','lost') AND time >= ?`,
        )
        .all(IDX_SEASONAL_PRESET, Date.now() - KILL_SWITCH_WINDOW_MS)) as { profit: number }[];
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
  const row = (PAPER_MODE
    ? db()
        .prepare(`SELECT 1 FROM idx_paper_trades WHERE symbol = ? AND time >= ? LIMIT 1`)
        .get(symbol, dayStart)
    : db()
        .prepare(`SELECT 1 FROM bot_trades WHERE preset = ? AND symbol = ? AND time >= ? LIMIT 1`)
        .get(IDX_SEASONAL_PRESET, symbol, dayStart)) as unknown;
  return !!row;
}

function insertOpenTrade(p: {
  tradeId: string; userId: number; symbol: string; entryPrice: number;
  contractId: number; durationMin: number; payout: number; paper?: boolean;
}): void {
  if (p.paper) {
    db()
      .prepare(
        `INSERT INTO idx_paper_trades
          (id, user_id, symbol, direction, notional, status, profit, entry_price, duration_minutes, time)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(p.tradeId, p.userId, p.symbol, "CALL", PAPER_NOTIONAL_USD, "open", 0, p.entryPrice, p.durationMin, Date.now());
    return;
  }
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

function closeTrade(pos: OpenPos, profit: number, reason: string, exitPrice?: number): void {
  const now = Date.now();
  if (pos.paper) {
    db()
      .prepare(
        `UPDATE idx_paper_trades SET status = ?, profit = ?, exit_price = ?, closed_at = ?, exit_reason = ? WHERE id = ?`,
      )
      .run(profit >= 0 ? "won" : "lost", profit, exitPrice ?? null, now, reason, pos.tradeId);
    return;
  }
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

/** Position papier dont le prix de sortie est introuvable : annulée, hors stats. */
function voidPaperTrade(pos: OpenPos, reason: string): void {
  db()
    .prepare(`UPDATE idx_paper_trades SET status = 'void', closed_at = ?, exit_reason = ? WHERE id = ?`)
    .run(Date.now(), reason, pos.tradeId);
}

async function lastPrice(symbol: string): Promise<number | null> {
  const prices = await fetchRecentTicksServer(symbol, 1).catch(() => [] as number[]);
  const px = prices[prices.length - 1];
  return Number.isFinite(px) && px > 0 ? px : null;
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
  const c = !PAPER_MODE && (openPositions.size || enabled) ? await getConn(account.token) : null;

  // ── Règlement des positions papier échues (toujours, même si désarmé) ──
  for (const pos of [...openPositions.values()]) {
    if (!pos.paper) continue;
    const expiresAt = pos.entryTime + pos.durationMin * 60_000;
    if (Date.now() < expiresAt) continue;
    const px = await lastPrice(pos.symbol);
    if (px === null || !pos.entryPrice) {
      if (Date.now() > expiresAt + 30 * 60_000) {
        voidPaperTrade(pos, "no-exit-price");
        openPositions.delete(pos.symbol);
        console.warn(`[idx-seasonal] ${pos.symbol} prix de sortie introuvable — position papier annulée`);
      }
      continue;
    }
    const pnl = paperProfit(pos.entryPrice, px);
    closeTrade(pos, pnl, "paper-expiry", px);
    openPositions.delete(pos.symbol);
    console.log(`[idx-seasonal] ${pos.symbol} PAPIER réglé ${pos.entryPrice} → ${px} : P&L ${pnl.toFixed(2)}`);
  }

  // ── Règlement des binaires expirés (toujours, même si désarmé) ──
  if (c) {
    for (const pos of [...openPositions.values()]) {
      if (pos.paper) continue;
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

  // IDX_SEASONAL_TEST_MODE=1 : ignore la contrainte lundi + heure-par-symbole
  // pour vérifier le cycle complet en séance (respecte marché ouvert,
  // 1/symbole/jour, kill-switch). Durée forcée courte.
  const testMode = process.env.IDX_SEASONAL_TEST_MODE === "1";
  if (!testMode && !isMonday) return;

  const ks = trailingProfitFactor();
  if (ks && ks.pf < KILL_SWITCH_MIN_PF) {
    if (Date.now() - lastKillSwitchLog > 6 * 3600_000) {
      console.warn(`[idx-seasonal] KILL-SWITCH actif — PF 28j ${ks.pf.toFixed(2)} < ${KILL_SWITCH_MIN_PF} sur ${ks.n} trades. Entrées suspendues.`);
      lastKillSwitchLog = Date.now();
    }
    return;
  }

  const conn2 = PAPER_MODE ? null : await getConn(account.token);

  if (!PAPER_MODE && conn2 && !durationsLogged) {
    durationsLogged = true;
    const b = await conn2.getRiseFallDurationBounds("OTC_NDX").catch(() => null);
    console.log(
      `[idx-seasonal] Rise/Fall OTC_NDX bornes: ${b ? `${(b.minSec / 60).toFixed(0)}min .. ${(b.maxSec / 60).toFixed(0)}min` : "inconnues"}`,
    );
  }

  for (const symbol of SYMBOLS) {
    const cfg = IDX_CONFIG[symbol];
    if (openPositions.has(symbol)) continue;
    if (!testMode && hour !== cfg.entryHourUtc) continue;
    if (tradedThisUtcDay(symbol)) continue;
    const mkt = await getMarketState(symbol).catch(() => null);
    if (!mkt || !mkt.open || mkt.suspended) continue;

    // Pas de repli sur une durée plus courte : l'edge Monday-effect est un
    // maintien de session (4-7 h). Une durée de 60 min est un autre pari
    // (pile ou face à 82 % de payout, break-even à 55 %) — les 20 trades des
    // 7 et 14 sept. se sont tous réglés à 60 min. Durée refusée = on ne trade pas.
    const ladder = testMode ? [TEST_MODE_DURATION_MIN] : [cfg.durationMin];

    let placed = false;
    if (PAPER_MODE) {
      const paperDurationMin = testMode ? TEST_MODE_DURATION_MIN : cfg.durationMin;
      const px = await lastPrice(symbol);
      if (px === null) { console.error(`[idx-seasonal] ${symbol} : prix d'entrée papier indisponible`); continue; }
      const tradeId = `idxs_${Date.now()}_${symbol}`;
      insertOpenTrade({
        tradeId, userId: account.userId, symbol, entryPrice: px, contractId: 0,
        durationMin: paperDurationMin, payout: 0, paper: true,
      });
      openPositions.set(symbol, {
        tradeId, contractId: 0, symbol, entryTime: Date.now(),
        durationMin: paperDurationMin, paper: true, entryPrice: px,
      });
      console.log(`[idx-seasonal] PAPIER LONG ${symbol} @ ${px} — sortie dans ${paperDurationMin} min`);
      continue;
    }
    for (const durationMin of ladder) {
      if (!conn2) break;
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
    const rows = (PAPER_MODE
      ? db()
          .prepare(
            `SELECT id, symbol, NULL AS contract_id, time AS entry_time, duration_minutes, entry_price, 'PAPER' AS execution_mode
               FROM idx_paper_trades WHERE status = 'open'`,
          )
          .all()
      : db()
          .prepare(
            `SELECT id, symbol, contract_id, entry_time, duration_minutes, entry_price, execution_mode
               FROM bot_trades WHERE preset = ? AND status = 'open'`,
          )
          .all(IDX_SEASONAL_PRESET)) as {
      id: string; symbol: string; contract_id: string | null; entry_time: number;
      duration_minutes: number; entry_price: number | null; execution_mode: string;
    }[];
    for (const r of rows) {
      const paper = r.execution_mode === "PAPER";
      const cid = Number(r.contract_id);
      if (!paper && !Number.isFinite(cid)) continue;
      openPositions.set(r.symbol, {
        tradeId: r.id, contractId: paper ? 0 : cid, symbol: r.symbol,
        entryTime: r.entry_time || Date.now(),
        durationMin: r.duration_minutes || IDX_CONFIG[r.symbol]?.durationMin || 240,
        paper, entryPrice: r.entry_price ?? undefined,
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
