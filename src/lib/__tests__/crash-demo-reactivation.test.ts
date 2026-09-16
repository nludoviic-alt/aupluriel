import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_PRESETS, lockPresetSymbols, startBotForUser } from "../bot-engine.server";
import { DEFAULT_CONFIG } from "../signal-core";

test("historical Crash and Scalping are available while V2 remains archived", () => {
  assert.ok(ACTIVE_PRESETS.includes("crash"));
  assert.ok(ACTIVE_PRESETS.includes("scalping"));
  assert.ok(!ACTIVE_PRESETS.includes("crash900"));
});

test("stale live Crash config is constrained to demo and CRASH1000 without changing risk parameters", () => {
  const saved = { ...DEFAULT_CONFIG, mode: "live" as const, symbols: ["CRASH1000"], stakeUsd: 25, takeProfitPctOfStake: 10, stopLossPctOfStake: 10 };
  const config = lockPresetSymbols("crash", saved);
  assert.equal(config.mode, "demo");
  assert.deepEqual(config.symbols, ["CRASH1000"]);
  assert.equal(config.stakeUsd, saved.stakeUsd);
  assert.equal(config.takeProfitPctOfStake, saved.takeProfitPctOfStake);
  assert.equal(config.stopLossPctOfStake, saved.stopLossPctOfStake);
  assert.equal(saved.mode, "live");
  assert.deepEqual(saved.symbols, ["CRASH1000"]);
});

test("Multi retains its explicitly selected mode", () => {
  const config = { ...DEFAULT_CONFIG, mode: "live" as const };
  assert.equal(lockPresetSymbols("default", config).mode, "live");
});

test("archived V2 is rejected before account access or broker execution", async () => {
  await assert.rejects(startBotForUser(-1, "crash900", DEFAULT_CONFIG), /désactivé/);
});
