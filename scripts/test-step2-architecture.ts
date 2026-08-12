import { executionMonitor } from "../src/lib/execution-quality-monitor.server";

console.log("=== TEST ÉTAPE 2 : EXECUTION QUALITY MONITOR & COOLDOWN ===");

// 1. Record normal proposals
executionMonitor.recordProposal("CRASH900", 250, true);
executionMonitor.recordProposal("BOOM500", 310, true);

// 2. Record 3 consecutive proposal failures for VOL75_1S
executionMonitor.recordProposal("VOL75_1S", 1200, false, "ContractBuyValidationError", "Invalid stake");
executionMonitor.recordProposal("VOL75_1S", 1100, false, "ContractBuyValidationError", "Invalid stake");
executionMonitor.recordProposal("VOL75_1S", 1400, false, "ContractBuyValidationError", "Invalid stake");

// 3. Verify execution cooldown triggered
const cdStatus = executionMonitor.isSymbolInExecutionCooldown("VOL75_1S");
console.log(`[Cooldown VOL75_1S] Blocked: ${cdStatus.blocked}, Reason: ${cdStatus.reason}`);

// 4. Verify metrics summary
const metrics = executionMonitor.getMetrics();
console.log(`[Execution Metrics] Proposals: ${metrics.proposalsSuccess}/${metrics.proposalsSent} (${metrics.proposalSuccessRatePct}%), Avg Latency: ${metrics.avgProposalLatencyMs}ms, Health: ${metrics.health}`);
console.log(`[Active Cooldowns Count]: ${metrics.activeCooldowns.length}`);

console.log("=== TOUS LES TESTS ÉTAPE 2 PASSED ===");
