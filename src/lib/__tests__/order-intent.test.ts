import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { createOrderIntentStore } from "../order-intent.server";

test("persistent order intent blocks a second unresolved account order", () => {
  const db = new Database(":memory:");
  const store = createOrderIntentStore(db);
  const id = store.reserve("account-a");
  store.sent(id);
  assert.throws(() => store.reserve("account-a"), /reconciliation required/);
  store.resolve(id, { reference: "portfolio-check-1", contractId: null, noPurchaseConfirmed: true });
  assert.doesNotThrow(() => store.reserve("account-a"));
  db.close();
});

test("order intent requires explicit broker evidence", () => {
  const db = new Database(":memory:");
  const store = createOrderIntentStore(db);
  const id = store.reserve("account-b");
  assert.throws(() => store.resolve(id, { reference: "", contractId: null, noPurchaseConfirmed: false }), /evidence/);
  assert.throws(() => store.resolve(id, { reference: "check", contractId: 0, noPurchaseConfirmed: false }), /evidence/);
  store.resolve(id, { reference: "contract-123", contractId: 123, noPurchaseConfirmed: false });
  assert.doesNotThrow(() => store.reserve("account-b"));
  db.close();
});
