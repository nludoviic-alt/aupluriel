import assert from "node:assert/strict";
import test from "node:test";
import { IDX_UNIVERSE, nextMondayPlan } from "../idx-seasonal-plan";

const at = (iso: string) => new Date(iso);

test("universe is limited to the two US indices", () => {
  assert.deepEqual(IDX_UNIVERSE.map((l) => l.mt5Name).sort(), ["US SP 500", "US Tech 100"]);
});

test("Sunday points at the next day (Monday) with 14:00 entry and 19:00 exit UTC", () => {
  const plan = nextMondayPlan(at("2026-09-20T12:00:00Z"));
  assert.equal(plan.mondayUtc, "2026-09-21");
  for (const leg of plan.legs) {
    assert.equal(new Date(leg.entryAtMs).toISOString(), "2026-09-21T14:00:00.000Z");
    assert.equal(new Date(leg.exitAtMs).toISOString(), "2026-09-21T19:00:00.000Z");
  }
});

test("Monday before the last exit still points at the same Monday", () => {
  assert.equal(nextMondayPlan(at("2026-09-21T15:00:00Z")).mondayUtc, "2026-09-21");
  assert.equal(nextMondayPlan(at("2026-09-21T00:10:00Z")).mondayUtc, "2026-09-21");
});

test("Monday after the last exit rolls to the following Monday", () => {
  assert.equal(nextMondayPlan(at("2026-09-21T19:30:00Z")).mondayUtc, "2026-09-28");
});

test("midweek and Saturday point at the next Monday", () => {
  assert.equal(nextMondayPlan(at("2026-09-23T10:00:00Z")).mondayUtc, "2026-09-28");
  assert.equal(nextMondayPlan(at("2026-09-26T23:59:00Z")).mondayUtc, "2026-09-28");
});

test("exit is always before the 20:59 GMT MT5 rollover (no swap)", () => {
  for (const leg of nextMondayPlan(at("2026-09-20T12:00:00Z")).legs) {
    const exit = new Date(leg.exitAtMs);
    assert.ok(exit.getUTCHours() * 60 + exit.getUTCMinutes() < 20 * 60 + 59);
  }
});
