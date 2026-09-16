import assert from "node:assert/strict";
import test from "node:test";
import { computeOpportunityStake } from "../signal-core";

test("computeOpportunityStake dynamically assigns stakes based on confidence tiers", () => {
  // Tier 1: Standard Confidence (< 85%) => $5
  assert.equal(computeOpportunityStake(75), 5);
  assert.equal(computeOpportunityStake(80), 5);
  assert.equal(computeOpportunityStake(84.9), 5);

  // Tier 2: High Confidence (85% - 89.9%) => $10
  assert.equal(computeOpportunityStake(85), 10);
  assert.equal(computeOpportunityStake(87), 10);
  assert.equal(computeOpportunityStake(89.9), 10);

  // Tier 3: Maximum Confidence (>= 90%) => $15
  assert.equal(computeOpportunityStake(90), 15);
  assert.equal(computeOpportunityStake(95), 15);
  assert.equal(computeOpportunityStake(100), 15);
});
