import Database from "better-sqlite3";

const db = new Database("lio23.db", { readonly: true });

console.log("=== CHECKING ALL USER_IDS AND MODES IN BOT_TRADES ===");
const summary = db.prepare(`
  SELECT user_id, mode, status, COUNT(*) as count
  FROM bot_trades
  GROUP BY user_id, mode, status
`).all();
console.log(summary);

console.log("\n=== TRADES WITH UTC DATE VS LOCAL DATE FOR 2026-08-10 ===");
const utcVsLocal = db.prepare(`
  SELECT 
    id, user_id, symbol, preset, mode, status, profit, confidence, tf_agreement,
    datetime(time/1000, 'unixepoch') as utc_time,
    date(datetime(time/1000, 'unixepoch')) as utc_date,
    datetime(time/1000, 'unixepoch', 'localtime') as local_time,
    date(datetime(time/1000, 'unixepoch', 'localtime')) as local_date
  FROM bot_trades
  WHERE status IN ('won', 'lost')
    AND (
      date(datetime(time/1000, 'unixepoch')) IN ('2026-08-10', '2026-08-11')
      OR date(datetime(time/1000, 'unixepoch', 'localtime')) IN ('2026-08-10', '2026-08-11')
    )
  ORDER BY time DESC
`).all();

console.log(`Total trades found in window: ${utcVsLocal.length}`);
console.log("Sample of trades:");
for (const t of utcVsLocal.slice(0, 15)) {
  console.log(`[ID ${t.id}] User: ${t.user_id} | Mode: ${t.mode} | Symbol: ${t.symbol} | Preset: ${t.preset} | UTC: ${t.utc_time} | Local: ${t.local_time} | Profit: ${t.profit} | Status: ${t.status}`);
}

// Let's filter specifically for user 4 / user 23 / etc and UTC dates
console.log("\n=== UTC DATE 2026-08-10 METRICS BY SYMBOL & PRESET ===");
const tradesUtc10 = utcVsLocal.filter(t => t.utc_date === '2026-08-10');
console.log(`UTC 2026-08-10 count: ${tradesUtc10.length}`);
const crash900_10 = tradesUtc10.filter(t => t.symbol === 'CRASH900');
console.log(`CRASH900 count UTC 2026-08-10: ${crash900_10.length}`);

console.log("\n=== UTC DATE 2026-08-11 METRICS ===");
const tradesUtc11 = utcVsLocal.filter(t => t.utc_date === '2026-08-11');
console.log(`UTC 2026-08-11 count: ${tradesUtc11.length}`);
for (const t of tradesUtc11) {
  console.log(`[ID ${t.id}] User: ${t.user_id} | Symbol: ${t.symbol} | UTC: ${t.utc_time} | Profit: ${t.profit} | Status: ${t.status}`);
}

db.close();
