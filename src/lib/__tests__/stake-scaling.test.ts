import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStakeScalingApproved,
  describeStakeScaling,
  evaluateStakeScalingReadiness,
  getStakeScalingPolicy,
  scalingConfigFingerprint,
  STAKE_SCALING_TIERS,
} from "../stake-scaling.server";
import { getDb } from "../db.server";

function finalStake(requested: number, strategy: number, risk: number, broker: number) {
  return Math.min(requested, strategy, risk, broker);
}

test("stake scaling exposes future tiers without auto-increasing a request", () => {
  assert.deepEqual(STAKE_SCALING_TIERS, [25, 50, 100, 250, 500, 1000]);
  const stake = finalStake(25, 1000, 500, 1000);
  assert.equal(stake, 25);
  const audit = describeStakeScaling(25, stake, 12.5, 1_000, "crash");
  assert.equal(audit.tier, 25);
  assert.equal(audit.reason, "MANUAL_REQUEST_ONLY_NO_AUTO_SCALE");
  assert.equal(audit.riskPctOfEquity, 1.25);
});

test("legacy stakes below $25 have no stake-scaling tier", () => {
  const audit = describeStakeScaling(5, 5, 5, 1_000, "crash");
  assert.equal(audit.tier, null);
});

test("risk or broker can reduce a high manual request but never increase it", () => {
  const stake = finalStake(1000, 1000, 250, 500);
  const audit = describeStakeScaling(1000, stake, 250, 10_000, "crash500");
  assert.equal(stake, 250);
  assert.equal(audit.reason, "RISK_OR_BROKER_REDUCED");
  assert.equal(audit.riskPctOfEquity, 2.5);
});

test("each preset retains an explicit non-activating scaling policy", () => {
  assert.equal(getStakeScalingPolicy("rb100").maxDailyLossUsd, 2);
  assert.equal(getStakeScalingPolicy("boom900").brokerMaxStakeUsd, 0.9);
  assert.equal(getStakeScalingPolicy("vol75").maxStakeUsd, 500);
});

test("a higher tier remains ineligible until every readiness gate passes", () => {
  const policy = getStakeScalingPolicy("crash");
  const blocked = evaluateStakeScalingReadiness(
    {
      closedTrades: 99,
      profitFactor: 1.2,
      expectancy: 1,
      maxDrawdownUsd: 10,
      executionAnomalies: 0,
      stakeSafetyViolations: 0,
      homogeneousConfig: true,
      brokerCapKnown: false,
    },
    policy,
  );
  assert.equal(blocked.eligible, false);
  assert.deepEqual(blocked.reasons, ["INSUFFICIENT_SAMPLE", "BROKER_CAP_UNKNOWN"]);
});

test("a stake above $1000 is rejected rather than bypassing approval", () => {
  const config = { stakeUsd: 5, stakeMode: "fixed", stakePercent: 1 } as any;
  assert.throws(
    () =>
      assertStakeScalingApproved(
        987654,
        "crash",
        config,
        { ...config, stakeUsd: 1001 },
        { strategyVersion: "V1", riskVersion: "R4", executionVersion: "E3" },
      ),
    /MAX_STAKE_USD|dernier palier/,
  );
});

test("a percent-mode change requires an existing approved tier", () => {
  const config = { stakeUsd: 5, stakeMode: "fixed", stakePercent: 1 } as any;
  assert.throws(
    () =>
      assertStakeScalingApproved(
        987655,
        "crash",
        config,
        { ...config, stakeMode: "percent" },
        { strategyVersion: "V1", riskVersion: "R4", executionVersion: "E3" },
      ),
    /PERCENT_STAKE_REQUIRES_APPROVED_TIER/,
  );
});

test("TEST A: restoring an identical $25 stake with no approval on file starts", () => {
  const config = { stakeUsd: 25, stakeMode: "fixed", stakePercent: 1 } as any;
  assert.doesNotThrow(() =>
    assertStakeScalingApproved(987656, "crash", config, config, {
      strategyVersion: "V1",
      riskVersion: "R4",
      executionVersion: "E3",
    }),
  );
});

test("TEST B: requesting $50 with no approval on file is blocked", () => {
  const current = { stakeUsd: 25, stakeMode: "fixed", stakePercent: 1 } as any;
  assert.throws(
    () =>
      assertStakeScalingApproved(
        987657,
        "crash",
        current,
        { ...current, stakeUsd: 50 },
        { strategyVersion: "V1", riskVersion: "R4", executionVersion: "E3" },
      ),
    /Palier \$50 non activé/,
  );
});

test("TEST C: requesting $50 with a matching $50 approval on file starts", () => {
  const db = getDb();
  const current = { stakeUsd: 25, stakeMode: "fixed", stakePercent: 1 } as any;
  const next = { ...current, stakeUsd: 50 };
  const versions = { strategyVersion: "V1", riskVersion: "R4", executionVersion: "E3" };
  db.prepare(
    "INSERT INTO users (email, username, password_hash, status) VALUES (?, ?, 'x', 'approved')",
  ).run("test-stake-tier-c@example.invalid", "test-stake-tier-c");
  const { id: userId } = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get("test-stake-tier-c@example.invalid") as { id: number };
  try {
    db.prepare(
      `INSERT INTO stake_scaling_approvals
         (user_id, preset, approved_tier, config_hash, evidence_json, approved_at, strategy_version, risk_version, execution_version)
       VALUES (?, 'crash', 50, ?, '{}', unixepoch(), ?, ?, ?)`,
    ).run(
      userId,
      scalingConfigFingerprint(current),
      versions.strategyVersion,
      versions.riskVersion,
      versions.executionVersion,
    );
    assert.doesNotThrow(() =>
      assertStakeScalingApproved(userId, "crash", current, next, versions),
    );
  } finally {
    db.prepare("DELETE FROM stake_scaling_approvals WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  }
});

test("TEST D: dropping from $50 to $25 with no approval on file starts (downgrade)", () => {
  const current = { stakeUsd: 50, stakeMode: "fixed", stakePercent: 1 } as any;
  assert.doesNotThrow(() =>
    assertStakeScalingApproved(
      987658,
      "crash",
      current,
      { ...current, stakeUsd: 25 },
      { strategyVersion: "V1", riskVersion: "R4", executionVersion: "E3" },
    ),
  );
});

test("TEST E/F: a full restore cycle (5 presets at their saved stake) never requires approval", () => {
  const presets = ["crash", "crash500", "vol50", "vol75", "boom"] as const;
  for (const preset of presets) {
    const saved = { stakeUsd: 25, stakeMode: "fixed", stakePercent: 1 } as any;
    assert.doesNotThrow(
      () =>
        assertStakeScalingApproved(987659, preset, saved, saved, {
          strategyVersion: "V1",
          riskVersion: "R4",
          executionVersion: "E3",
        }),
      `restoring ${preset} at its saved $25 stake must not require approval`,
    );
  }
});
