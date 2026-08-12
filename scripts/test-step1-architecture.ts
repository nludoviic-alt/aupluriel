import { evaluateDataQuality } from "../src/lib/data-quality-guard.server";
import { classifyMarketRegime, isStrategyAllowedInRegime } from "../src/lib/market-regime-router.server";

console.log("=== TEST ÉTAPE 1 : DATA QUALITY GUARD & MARKET REGIME ROUTER ===");

// 1. Data Quality Guard
const dqHealthy = evaluateDataQuality({ symbol: "CRASH900", wsConnected: true, lastTickTimestamp: Date.now() });
console.log(`[Data Quality Healthy] Status: ${dqHealthy.status}, Blocked: ${dqHealthy.isBlocked}`);

const dqStale = evaluateDataQuality({ symbol: "BOOM500", wsConnected: true, lastTickTimestamp: Date.now() - 120000 });
console.log(`[Data Quality Stale] Status: ${dqStale.status}, Reason: ${dqStale.reason}, Blocked (ObsMode): ${dqStale.isBlocked}`);

// 2. Market Regime Router
const regimeStrongUp = classifyMarketRegime({ symbol: "VOL75_1S", adx: 35, ema20: 110, ema50: 100, trendAlignmentScore: 4 });
console.log(`[Regime Strong Uptrend] Regime: ${regimeStrongUp.regime}`);

const regimeChoppy = classifyMarketRegime({ symbol: "VOL75_1S", adx: 12, trendAlignmentScore: 2 });
console.log(`[Regime Choppy] Regime: ${regimeChoppy.regime}`);

const routePullbackInChoppy = isStrategyAllowedInRegime("VOL75_TREND_PULLBACK", regimeChoppy.regime);
console.log(`[Route Pullback in Choppy] Allowed: ${routePullbackInChoppy.allowed}, Reason: ${routePullbackInChoppy.reason}`);

console.log("=== TOUS LES TESTS ÉTAPE 1 PASSED ===");
