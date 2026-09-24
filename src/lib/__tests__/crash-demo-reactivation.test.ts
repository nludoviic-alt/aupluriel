import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_PRESETS, lockPresetSymbols, startBotForUser } from "../bot-engine.server";
import { DEFAULT_CONFIG } from "../signal-core";

test("reactivated production presets are available in ACTIVE_PRESETS", () => {
  for (const active of ["default", "boom", "crash", "scalping", "vol75", "rb100"] as const) {
    assert.ok(ACTIVE_PRESETS.includes(active), `${active} must be active`);
  }
  for (const retired of ["crash900", "boomv2", "gold", "liquidity"] as const) {
    assert.ok(!ACTIVE_PRESETS.includes(retired as any), `${retired} must not be in ACTIVE_PRESETS`);
  }
});

test("non-active presets are rejected before account access or broker execution", async () => {
  for (const preset of ["crash900", "boomv2", "gold", "liquidity"] as const) {
    await assert.rejects(startBotForUser(-1, preset as any, DEFAULT_CONFIG), /désactivé/);
  }
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
