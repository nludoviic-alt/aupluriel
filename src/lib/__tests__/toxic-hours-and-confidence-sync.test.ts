import { test } from "node:test";
import assert from "node:assert/strict";
import { isHighRiskWindow, DEFAULT_CONFIG } from "../signal-core.server";

test("isHighRiskWindow blocks toxic UTC hours 4, 11, 13, 14", () => {
  // Test that DEFAULT_CONFIG maxConfidence is capped at 89
  assert.equal(DEFAULT_CONFIG.maxConfidence, 89, "DEFAULT_CONFIG.maxConfidence must be 89");

  // Test the function returns boolean blocked
  const res = isHighRiskWindow();
  assert.equal(typeof res.blocked, "boolean");

  const currentHour = new Date().getUTCHours();
  if ([4, 11, 13, 14].includes(currentHour)) {
    assert.equal(res.blocked, true, `Hour ${currentHour} UTC should be blocked`);
    assert.match(res.reason ?? "", /Pause horaire statistique/);
  }
});
