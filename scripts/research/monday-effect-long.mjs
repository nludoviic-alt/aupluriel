const IDX = { "^GSPC": "S&P 500", "^NDX": "Nasdaq 100", "^DJI": "Dow", "^GDAXI": "DAX", "^FCHI": "CAC 40", "^STOXX50E": "Euro Stoxx 50", "^SSMI": "SMI", "^N225": "Nikkei", "^HSI": "Hang Seng", "^AXJO": "ASX 200" };
const P1 = Math.floor(Date.UTC(2000, 0, 1) / 1000), P2 = Math.floor(Date.now() / 1000);
const data = {};
for (const sym of Object.keys(IDX)) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${P1}&period2=${P2}&interval=1d`;
  const j = await (await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" } })).json().catch(() => null);
  const r = j?.chart?.result?.[0]; if (!r) { console.log(sym, "indisponible"); continue; }
  const q = r.indicators.quote[0]; const off = r.meta.gmtoffset ?? 0; const rows = [];
  r.timestamp.forEach((t, i) => { const o = q.open[i], c = q.close[i]; if (o > 0 && c > 0) { const d = new Date((t + off) * 1000); rows.push({ y: d.getUTCFullYear(), dow: d.getUTCDay(), ret: c / o - 1 }); } });
  data[sym] = rows; console.log(sym.padEnd(10), IDX[sym].padEnd(14), rows.length, "jours", rows[0].y, "→", rows.at(-1).y);
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const COST = 0.0003; // 0,03 % / trade, comme dans le backtest Deriv
const win = (lo, hi) => (rows) => rows.filter((r) => r.y >= lo && r.y <= hi);
console.log("\nEffet LUNDI (long ouverture→clôture, coût 0,03 % déduit) vs mardi-vendredi, par période — moyenne poolée des 10 indices :");
for (const [name, lo, hi] of [["2000-2009", 2000, 2009], ["2010-2019", 2010, 2019], ["2020-2023", 2020, 2023], ["2024-2026", 2024, 2026], ["2025-2026", 2025, 2026]]) {
  const mon = [], oth = [];
  for (const rows of Object.values(data)) for (const r of win(lo, hi)(rows)) { if (r.dow === 1) mon.push(r.ret - COST); else if (r.dow >= 2 && r.dow <= 5) oth.push(r.ret - COST); }
  const t = mean(mon) / (sd(mon) / Math.sqrt(mon.length));
  console.log(`  ${name}: lundi n=${String(mon.length).padStart(4)} moy=${(mean(mon) * 100).toFixed(3).padStart(7)}% t=${t.toFixed(2).padStart(5)} WR=${(100 * mon.filter((x) => x > 0).length / mon.length).toFixed(0)}%  | mar-ven moy=${(mean(oth) * 100).toFixed(3).padStart(7)}%`);
}
console.log("\nPar indice, lundi net (%), 2000-2026 / 2020-2026 / 2024-2026 :");
for (const [sym, rows] of Object.entries(data)) {
  const m = (lo) => { const x = rows.filter((r) => r.dow === 1 && r.y >= lo).map((r) => r.ret - COST); return `${(mean(x) * 100).toFixed(3).padStart(7)}% (t=${(mean(x) / (sd(x) / Math.sqrt(x.length))).toFixed(1)})`; };
  console.log(" ", IDX[sym].padEnd(14), m(2000), "|", m(2020), "|", m(2024));
}
