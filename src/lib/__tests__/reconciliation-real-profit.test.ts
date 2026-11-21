import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";

test("reconciliation keeps real broker P&L and tags unknown ones", async () => {
  const { getDb } = await import("../db.server");
  const { reconcileUserPositions } = await import("../trade-reconciliation-engine.server");
  const db = getDb();
  db.exec("PRAGMA foreign_keys = OFF");
  const ins = db.prepare(
    `INSERT INTO bot_trades (id,user_id,time,symbol,direction,stake,status,contract_id,preset)
     VALUES (?,?,?,?,?,?,'open',?,'flux24')`,
  );
  ins.run("a", 1, Date.now(), "1HZ50V", "MULTUP", 1, "111");
  ins.run("b", 1, Date.now(), "1HZ50V", "MULTUP", 1, "222");
  ins.run("c", 1, Date.now(), "1HZ50V", "MULTUP", 1, "333");
  const open = [
    { id: "a", symbol: "1HZ50V", derivContractId: "111", openPrice: 1 },
    { id: "b", symbol: "1HZ50V", derivContractId: "222", openPrice: 1 },
    { id: "c", symbol: "1HZ50V", derivContractId: "333", openPrice: 1 },
  ];
  const live = [{ contract_id: "333", symbol: "1HZ50V", buy_price: 1, profit: 0 }];
  reconcileUserPositions(1, "flux24", open, live, new Map([["111", 0.4]]));
  const row = (id: string) =>
    db.prepare("SELECT status,profit,exit_reason FROM bot_trades WHERE id=?").get(id) as any;
  assert.deepEqual(row("a"), { status: "closed", profit: 0.4, exit_reason: "RECONCILED_CLOSED_BY_BROKER" });
  assert.deepEqual(row("b"), { status: "closed", profit: 0, exit_reason: "RECONCILED_PROFIT_UNKNOWN" });
  assert.equal(row("c").status, "open");
});
