import assert from "node:assert/strict";
import test from "node:test";
import { getDb } from "../db.server";
import { statsFor } from "../opportunities.server";

test("opportunity statistics isolate account, mode, preset and closed trades", () => {
  assert.equal(process.env.DB_PATH, ":memory:", "This test requires an isolated in-memory database");
  const db = getDb();
  db.prepare("INSERT INTO users(id,email,username,password_hash) VALUES (901,'test901@example.invalid','test901','unused'),(902,'test902@example.invalid','test902','unused')").run();
  const insert = db.prepare("INSERT INTO bot_trades(id,user_id,time,symbol,direction,stake,status,profit,preset,mode) VALUES (?,?,1,'CRASH900','PUT',5,?,?,?,?)");
  insert.run('own-win',901,'won',4,'crash','demo');
  insert.run('own-loss',901,'lost',-5,'crash','demo');
  insert.run('other-user',902,'won',100,'crash','demo');
  insert.run('live',901,'won',100,'crash','live');
  insert.run('v2',901,'won',100,'crash900','demo');
  insert.run('open',901,'open',100,'crash','demo');
  const stats = statsFor(901,'crash','CRASH900');
  assert.equal(stats.trades,2);
  assert.equal(stats.pnl,-1);
  assert.equal(stats.expectancy,-0.5);
  assert.equal(stats.profitFactor,0.8);
  assert.equal(statsFor(902,'crash','CRASH900').pnl,100);
});
