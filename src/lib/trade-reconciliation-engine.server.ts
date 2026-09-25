/**
 * Trade Reconciliation Engine (Section 35 & 36 - Spécification V3).
 * Compare périodiquement les positions enregistrées en base SQLite locale avec les contrats réellement ouverts chez Deriv.
 * Détecte les désynchronisations (trades orphelins, contrats non suivis) et garantit la reprise d'état après redémarrage.
 */

import { getDb } from "./db.server";
import { FEATURE_FLAGS } from "./feature-flags.server";

export interface ReconciliationReport {
  timestamp: string;
  preset: string;
  localOpenCount: number;
  derivOpenCount: number;
  matchedCount: number;
  reconciledOrphans: number;
  untrackedDerivCount: number;
  hasDesyncError: boolean;
  status: "OK" | "RECONCILED_ORPHANS" | "DESYNC_ERROR";
  details: string[];
}

export function reconcileUserPositions(
  userId: number,
  preset: string,
  localOpenTrades: { id: string; symbol: string; derivContractId?: string; openPrice: number }[],
  liveDerivPositions: { contract_id: string; symbol: string; buy_price: number; profit: number }[]
): ReconciliationReport {
  const db = getDb();
  const details: string[] = [];

  let matchedCount = 0;
  let reconciledOrphans = 0;
  let untrackedDerivCount = 0;

  const liveContractIds = new Set(liveDerivPositions.map((p) => String(p.contract_id)));

  // 1. Vérifier chaque trade ouvert localement en DB
  for (const localTrade of localOpenTrades) {
    if (!localTrade.derivContractId) {
      matchedCount++;
      continue;
    }

    if (liveContractIds.has(String(localTrade.derivContractId))) {
      matchedCount++;
    } else {
      // Trade marquer 'open' en DB mais fermé/fermé par TP-SL chez Deriv -> Réconciliation
      reconciledOrphans++;
      details.push(`Trade orphelin réconcilié : ${localTrade.symbol} (Contrat ID ${localTrade.derivContractId})`);

      try {
        db.prepare(`
          UPDATE bot_trades
          SET status = 'closed', profit = 0.0, exit_reason = 'RECONCILED_CLOSED_BY_BROKER'
          WHERE id = ? AND user_id = ?
        `).run(localTrade.id, userId);
      } catch (e) {
        console.error(`[reconciliation] Erreur MAJ DB pour trade ${localTrade.id}:`, (e as Error).message);
      }
    }
  }

  // 2. Vérifier les contrats ouverts chez Deriv non présents en DB
  const localContractIds = new Set(localOpenTrades.map((t) => String(t.derivContractId)).filter(Boolean));
  for (const livePos of liveDerivPositions) {
    if (!localContractIds.has(String(livePos.contract_id))) {
      untrackedDerivCount++;
      details.push(`Contrat Deriv non suivi en DB local : ${livePos.symbol} (ID ${livePos.contract_id})`);
    }
  }

  const hasDesyncError = untrackedDerivCount > 0 || reconciledOrphans > 0;
  let status: ReconciliationReport["status"] = "OK";
  if (untrackedDerivCount > 0) status = "DESYNC_ERROR";
  else if (reconciledOrphans > 0) status = "RECONCILED_ORPHANS";

  return {
    timestamp: new Date().toISOString(),
    preset,
    localOpenCount: localOpenTrades.length,
    derivOpenCount: liveDerivPositions.length,
    matchedCount,
    reconciledOrphans,
    untrackedDerivCount,
    hasDesyncError,
    status,
    details,
  };
}
