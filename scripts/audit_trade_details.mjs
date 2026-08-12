import Database from "better-sqlite3";

try {
  const db = new Database("lio23.db", { readonly: true, fileMustExist: true });

  console.log("=== LAST 20 TRADES IN DB ===");
  const lastTrades = db.prepare(`
    SELECT id, user_id, symbol, confidence, tf_agreement, stake, profit, status,
           datetime(time/1000, 'unixepoch', 'localtime') as entry_time
    FROM bot_trades
    ORDER BY time DESC LIMIT 20
  `).all();

  for (const t of lastTrades) {
    console.log(`Trade #${t.id} | ${t.entry_time} | ${t.symbol} | Conf: ${t.confidence}% | TF: ${t.tf_agreement} | Stake: $${t.stake} | Profit: $${t.profit} (${t.status})`);
  }

  db.close();
} catch (e) {
  console.error("ERROR DETECTED:", e);
}
