// Read-only reconcile for orphaned bot_trades rows whose engine was stopped
// (preset disabled) while a position was still open. Uses the account's Deriv
// profit_table (settled contracts only) to write final status/profit/closed_at
// back to the row. Never sells or opens anything.
//
// Run ON the VPS:
//   DB_PATH=/home/ubuntu/data/lio23.db npx --yes tsx@4 scripts/reconcile-orphan-contract.ts

import { getDb } from "../src/lib/db.server";
import { DerivTradingConnection } from "../src/lib/deriv.server";

async function main() {
  const db = getDb();
  const orphans = db
    .prepare(
      `SELECT bt.id, bt.user_id, bt.preset, bt.contract_id, bt.symbol, bt.time
         FROM bot_trades bt
        WHERE bt.status IN ('open','pending') AND bt.contract_id IS NOT NULL`,
    )
    .all() as {
    id: string;
    user_id: number;
    preset: string;
    contract_id: number;
    symbol: string;
    time: number;
  }[];

  if (!orphans.length) {
    console.log("no orphaned positions");
    return;
  }
  console.log(`${orphans.length} orphaned row(s):`, orphans.map((o) => o.contract_id).join(", "));

  const byUser = new Map<number, typeof orphans>();
  for (const o of orphans) {
    if (!byUser.has(o.user_id)) byUser.set(o.user_id, []);
    byUser.get(o.user_id)!.push(o);
  }

  for (const [userId, rows] of byUser) {
    const s = db
      .prepare("SELECT deriv_token FROM user_settings WHERE user_id = ?")
      .get(userId) as { deriv_token?: string } | undefined;
    if (!s?.deriv_token) {
      console.log(`user ${userId}: no deriv token — skipped`);
      continue;
    }
    const conn = new DerivTradingConnection(s.deriv_token, "demo");
    try {
      const settled = await conn.getProfitTable(100);
      const openPos = await conn.getOpenPositions();
      const stillOpen = new Set(
        (openPos.positions ?? []).map((p) => p.contractId),
      );
      for (const r of rows) {
        const hit = settled.find((t) => t.contractId === r.contract_id);
        if (hit) {
          const status = hit.profit >= 0 ? "won" : "lost";
          const upd = db
            .prepare(
              `UPDATE bot_trades SET status = ?, profit = ?, closed_at = ?
               WHERE id = ? AND status IN ('open','pending')`,
            )
            .run(status, hit.profit, Math.floor(Date.now() / 1000), r.id);
          console.log(
            `user ${userId} ${r.contract_id}: SETTLED ${status} profit=${hit.profit.toFixed(2)} — row updated (${upd.changes})`,
          );
        } else if (stillOpen.has(r.contract_id)) {
          console.log(`user ${userId} ${r.contract_id}: still open on Deriv — leaving as-is`);
        } else {
          console.log(
            `user ${userId} ${r.contract_id}: not in profit_table(100) and not in portfolio — needs a wider lookback or manual check`,
          );
        }
      }
    } catch (e) {
      console.error(`user ${userId}: ${(e as Error).message}`);
    } finally {
      try {
        conn.close();
      } catch {}
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 800));
