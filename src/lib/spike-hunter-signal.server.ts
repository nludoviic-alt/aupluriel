import { rsi } from "./indicators";
import type { ServerCandle } from "./deriv.server";

export interface SpikeHunterSignal {
  symbol: string;
  direction: "CALL" | "PUT";
  confidence: number;
  spikeProbability: number;
  reason: string;
  suggestedStakeMultiplier: number;
}

/**
 * Specialized Spike Hunter algorithm for Boom & Crash synthetic markets.
 * Detects liquidity consolidation/distribution before explosive spike delivery.
 */
export function generateSpikeHunterSignal(
  symbol: string,
  candlesM1: ServerCandle[],
  candlesM5: ServerCandle[],
): SpikeHunterSignal | null {
  if (candlesM1.length < 30 || candlesM5.length < 15) return null;

  const isBoom = symbol.toUpperCase().includes("BOOM");
  const isCrash = symbol.toUpperCase().includes("CRASH");
  if (!isBoom && !isCrash) return null;

  const currentM1 = candlesM1[candlesM1.length - 1];
  const tailM1 = candlesM1.slice(-20);
  const closesM1 = candlesM1.map((c) => c.close);
  const rsiM1 = rsi(closesM1, 14);
  const currentRsiM1 = rsiM1[rsiM1.length - 1] ?? 50;

  const tailM5 = candlesM5.slice(-10);
  const closesM5 = candlesM5.map((c) => c.close);
  const rsiM5 = rsi(closesM5, 14);
  const currentRsiM5 = rsiM5[rsiM5.length - 1] ?? 50;

  // 1. Calculate Recent Spike Activity on M1
  const m1Ranges = tailM1.map((c) => c.high - c.low);
  const avgRangeM1 = m1Ranges.reduce((a, b) => a + b, 0) / m1Ranges.length;
  let lastSpikeIdx = -1;
  for (let i = tailM1.length - 1; i >= 0; i--) {
    if (tailM1[i].high - tailM1[i].low > avgRangeM1 * 2.5) {
      lastSpikeIdx = i;
      break;
    }
  }
  const minutesSinceLastSpike = lastSpikeIdx >= 0 ? tailM1.length - 1 - lastSpikeIdx : 10;

  if (isBoom) {
    // ── BOOM SPIKE HUNTER (CALL) ──
    // Boom spikes upwards. We look for a period of low-volatility accumulation (small candles)
    // touching a key support/FVG with RSI oversold (RSI M1 <= 38, RSI M5 <= 45).
    const inAccumulationPhase = minutesSinceLastSpike >= 4 && minutesSinceLastSpike <= 18;
    const isOversold = currentRsiM1 <= 38 && currentRsiM5 <= 48;

    // Check Fair Value Gap / Order Block support
    const lowestLowM5 = Math.min(...tailM5.map((c) => c.low));
    const nearSupport = currentM1.close <= lowestLowM5 * 1.0008;

    if (inAccumulationPhase && isOversold) {
      const spikeProb = Math.min(96, Math.round(75 + (38 - currentRsiM1) * 0.8 + (nearSupport ? 10 : 0)));
      const confidence = Math.min(95, Math.round(spikeProb * 0.95));

      return {
        symbol,
        direction: "CALL",
        confidence,
        spikeProbability: spikeProb,
        reason: `Accumulation BOOM M1 (${minutesSinceLastSpike} min post-spike), RSI M1 survendu (${currentRsiM1.toFixed(0)}), support proche.`,
        suggestedStakeMultiplier: confidence >= 82 ? 2.0 : 1.5,
      };
    }
  } else if (isCrash) {
    // ── CRASH SPIKE HUNTER (PUT) ──
    // Crash spikes downwards. We look for a period of distribution (creeping up)
    // touching a key resistance/FVG with RSI overbought (RSI M1 >= 62, RSI M5 >= 55).
    const inDistributionPhase = minutesSinceLastSpike >= 4 && minutesSinceLastSpike <= 18;
    const isOverbought = currentRsiM1 >= 62 && currentRsiM5 >= 52;

    const highestHighM5 = Math.max(...tailM5.map((c) => c.high));
    const nearResistance = currentM1.close >= highestHighM5 * 0.9992;

    if (inDistributionPhase && isOverbought) {
      const spikeProb = Math.min(96, Math.round(75 + (currentRsiM1 - 62) * 0.8 + (nearResistance ? 10 : 0)));
      const confidence = Math.min(95, Math.round(spikeProb * 0.95));

      return {
        symbol,
        direction: "PUT",
        confidence,
        spikeProbability: spikeProb,
        reason: `Distribution CRASH M1 (${minutesSinceLastSpike} min post-spike), RSI M1 suracheté (${currentRsiM1.toFixed(0)}), résistance proche.`,
        suggestedStakeMultiplier: confidence >= 82 ? 2.0 : 1.5,
      };
    }
  }

  return null;
}
