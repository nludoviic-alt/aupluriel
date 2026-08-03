import type { AutoTraderConfig } from "./signal-core";
import { getLearnedWeightsServer } from "./indicator-weights.server";

/**
 * The options analyzeSymbolCore needs to score a symbol, resolved the same
 * way everywhere it's called server-side (advisor + live bot) so the two
 * never compute a different confidence for the same candles. Previously the
 * advisor (opportunities.server.ts) built this object by hand without
 * `weights`, silently diverging from the bot's version.
 */
export function buildAnalyzeOptsServer(symbol: string, config: AutoTraderConfig) {
  let weights: ReturnType<typeof getLearnedWeightsServer> | undefined;
  try {
    weights = getLearnedWeightsServer(symbol);
  } catch {
    /* base weights */
  }
  return {
    weights,
    veto4h: config.veto4h ?? "strong-only",
    vetoDaily: config.vetoDaily ?? "off",
    confluenceMode: config.confluenceMode ?? "vote",
    adxFilterMode: config.adxFilterMode ?? "off",
    adxBlockThreshold: config.adxBlockThreshold,
    adxStrongThreshold: config.adxStrongThreshold,
  };
}
