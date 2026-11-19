import assert from "node:assert/strict";
import test from "node:test";
import { AccountLimitStreak } from "../account-limit-alert";

test("fires once when the threshold is reached", () => {
  const s = new AccountLimitStreak(3);
  assert.deepEqual([s.recordRejection(), s.recordRejection(), s.recordRejection(), s.recordRejection()], [false, false, true, false]);
});

test("re-arms after reset", () => {
  const s = new AccountLimitStreak(2);
  s.recordRejection();
  assert.equal(s.recordRejection(), true);
  s.reset();
  s.recordRejection();
  assert.equal(s.recordRejection(), true);
});

test("does not fire below the threshold", () => {
  const s = new AccountLimitStreak(5);
  for (let i = 0; i < 4; i++) assert.equal(s.recordRejection(), false);
});
