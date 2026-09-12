import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from './db.server';

export function executionAccountKey(token: string, accountType: string): string {
  return createHash('sha256').update(`${accountType}\0${token}`).digest('hex');
}

/** Durable, non-expiring account reservation; no token or proposal secret is persisted. */
export function createOrderIntentStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS execution_order_intents (
    id TEXT PRIMARY KEY, account_key TEXT NOT NULL, state TEXT NOT NULL,
    contract_id INTEGER, evidence TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS execution_one_active_account
    ON execution_order_intents(account_key) WHERE state IN ('reserved','sent','uncertain');`);
  return {
    reserve(accountKey: string) {
      const id = randomUUID();
      try {
        db.prepare(`INSERT INTO execution_order_intents(id,account_key,state,created_at,updated_at)
          VALUES (?,?,'reserved',?,?)`).run(id, accountKey, Date.now(), Date.now());
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw Object.assign(new Error('Account has an unresolved order intent; reconciliation required'), { code: 'BUY_OUTCOME_UNKNOWN' });
        }
        throw error;
      }
      return id;
    },
    sent(id: string) {
      if (db.prepare("UPDATE execution_order_intents SET state='sent',updated_at=? WHERE id=? AND state='reserved'").run(Date.now(), id).changes !== 1) throw new Error('Order intent is not reserved');
    },
    finish(id: string, state: 'confirmed' | 'rejected' | 'uncertain', contractId?: number) {
      db.prepare('UPDATE execution_order_intents SET state=?,contract_id=?,updated_at=? WHERE id=?').run(state, contractId ?? null, Date.now(), id);
    },
    /** Operator reconciliation must identify the broker result or explicitly attest no purchase. */
    resolve(id: string, evidence: { reference: string; contractId: number | null; noPurchaseConfirmed: boolean }) {
      if (!evidence.reference.trim() || (evidence.contractId === null ? !evidence.noPurchaseConfirmed : !Number.isSafeInteger(evidence.contractId) || evidence.contractId <= 0)) throw new Error('Broker reconciliation evidence is required');
      const result = db.prepare(`UPDATE execution_order_intents SET state=?,contract_id=?,evidence=?,updated_at=?
        WHERE id=? AND state IN ('reserved','sent','uncertain')`).run(evidence.contractId === null ? 'rejected' : 'confirmed', evidence.contractId, evidence.reference, Date.now(), id);
      if (result.changes !== 1) throw new Error('No unresolved intent found');
    },
  };
}

export function listUnresolvedOrderIntents() {
  const db = getDb();
  createOrderIntentStore(db);
  return db.prepare(`SELECT id, account_key, state, contract_id, created_at, updated_at
    FROM execution_order_intents WHERE state IN ('reserved','sent','uncertain') ORDER BY created_at ASC`).all();
}

export function resolveOrderIntent(id: string, evidence: { reference: string; contractId: number | null; noPurchaseConfirmed: boolean }) {
  const db = getDb();
  return createOrderIntentStore(db).resolve(id, evidence);
}

export async function withOrderIntent<T extends { contractId: number }>(accountKey: string, execute: (markSent: () => void) => Promise<T>): Promise<T> {
  const store = createOrderIntentStore(getDb());
  const id = store.reserve(accountKey);
  let sent = false;
  try {
    const result = await execute(() => { store.sent(id); sent = true; });
    store.finish(id, 'confirmed', result.contractId);
    return result;
  } catch (error) {
    const code = (error as { code?: string }).code;
    store.finish(id, sent && (!code || code === 'BUY_OUTCOME_UNKNOWN') ? 'uncertain' : 'rejected');
    throw error;
  }
}
