import { syncHistoricalCandles } from "../src/lib/deriv-bigdata.server.ts";

async function main() {
  const r1 = await syncHistoricalCandles("frxXAUUSD", 900, 5000);
  console.log("M15:", r1);
  const r2 = await syncHistoricalCandles("frxXAUUSD", 300, 15000);
  console.log("M5:", r2);
}

main().catch(console.error);
