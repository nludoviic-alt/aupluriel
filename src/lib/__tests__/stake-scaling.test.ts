import assert from "node:assert/strict";
import test from "node:test";
import {
  assertStakeScalingApproved,
  describeStakeScaling,
  evaluateStakeScalingReadiness,
  getStakeScalingPolicy,
  STAKE_SCALING_TIERS,
} from "../stake-scaling.server";

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
