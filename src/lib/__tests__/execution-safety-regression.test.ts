import assert from "node:assert/strict";
import test from "node:test";
import { isCooldownAlreadyServedAfterRestart } from "../bot-engine.server";

test("restart preserves a cooldown already served for the same loss streak", () => {
  assert.equal(
    isCooldownAlreadyServedAfterRestart({ id: "loss_3", time: 1_000 }, { time: 1_001 }),
    true,
  );
});

test("a newer closed trade re-arms the cooldown after restart", () => {
  assert.equal(
    isCooldownAlreadyServedAfterRestart({ id: "loss_4", time: 2_000 }, { time: 1_001 }),
    false,
  );
});

test("missing journal data never suppresses a cooldown", () => {
  assert.equal(isCooldownAlreadyServedAfterRestart(undefined, { time: 1_001 }), false);
  assert.equal(isCooldownAlreadyServedAfterRestart({ id: "loss_3", time: 1_000 }, undefined), false);
});
