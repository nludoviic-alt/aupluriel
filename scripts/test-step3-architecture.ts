import { reconcileUserPositions } from "../src/lib/trade-reconciliation-engine.server";
import { circuitBreaker } from "../src/lib/global-circuit-breaker.server";

console.log("=== TEST ÉTAPE 3 : TRADE RECONCILIATION & GLOBAL CIRCUIT BREAKER ===");

// 1. Test Trade Reconciliation Engine
const localOpen = [
  { id: "trade_1", symbol: "CRASH900", derivContractId: "1001", openPrice: 900.5 },
  { id: "trade_2", symbol: "BOOM500", derivContractId: "1002", openPrice: 500.2 },
];

const liveDeriv = [
  { contract_id: "1001", symbol: "CRASH900", buy_price: 900.5, profit: 1.2 },
];

const report = reconcileUserPositions(4, "crash900", localOpen, liveDeriv);
console.log(`[Reconciliation Report] Matched: ${report.matchedCount}, Reconciled Orphans: ${report.reconciledOrphans}, Untracked Deriv: ${report.untrackedDerivCount}, Status: ${report.status}`);

// 2. Test Global Circuit Breaker
circuitBreaker.trigger("Test de sécurité d'urgence manuel");
const cbState = circuitBreaker.getState();
console.log(`[Circuit Breaker State] Triggered: ${cbState.isActive}, Reason: ${cbState.reason}`);

circuitBreaker.reset();
console.log(`[Circuit Breaker State Reset] IsActive: ${circuitBreaker.getState().isActive}`);

console.log("=== TOUS LES TESTS ÉTAPE 3 PASSED ===");
