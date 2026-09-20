import assert from "node:assert/strict";
import test from "node:test";
import { PAPER_COST_PCT, PAPER_NOTIONAL_USD, paperProfit } from "../idx-seasonal.server";

test("paperProfit: +0.5% move nets 0.5% minus the 0.03% cost", () => {
  const pnl = paperProfit(100, 100.5);
  assert.ok(Math.abs(pnl - PAPER_NOTIONAL_USD * (0.005 - PAPER_COST_PCT)) < 1e-9);
});

test("paperProfit: flat exit still pays the cost", () => {
  assert.ok(Math.abs(paperProfit(100, 100) + PAPER_NOTIONAL_USD * PAPER_COST_PCT) < 1e-9);
});

test("paperProfit: a drop is a loss, bounded by notional", () => {
  assert.ok(paperProfit(100, 99) < 0);
  assert.ok(paperProfit(100, 1) > -PAPER_NOTIONAL_USD - 1e-9);
});

test("paperProfit: invalid prices yield 0, never NaN", () => {
  assert.equal(paperProfit(0, 100), 0);
  assert.equal(paperProfit(100, NaN), 0);
  assert.equal(paperProfit(-5, 100), 0);
});

test("idx_paper_trades exists and is isolated from bot_trades", async () => {
  const { getDb } = await import("../db.server");
  const db = getDb();
  const before = (db.prepare("SELECT COUNT(*) AS n FROM bot_trades").get() as { n: number }).n;
  db.prepare(
    `INSERT INTO idx_paper_trades (id,user_id,symbol,notional,status,profit,entry_price,duration_minutes,time)
     VALUES ('t1',1,'OTC_NDX',1000,'lost',-12,100,300,?)`,
  ).run(Date.now());
  const after = (db.prepare("SELECT COUNT(*) AS n FROM bot_trades").get() as { n: number }).n;
  assert.equal(after, before, "paper rows must never land in bot_trades");
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM idx_paper_trades WHERE id='t1'").get() as { n: number }).n, 1);
});
