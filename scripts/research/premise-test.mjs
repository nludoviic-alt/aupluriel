// Test du postulat "trend pullback" sur 1HZ75V : y a-t-il de la persistance de tendance ?
// Lecture seule : bougies publiques Deriv, aucun ordre.
const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
let rid = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = pend.get(d.req_id); if (p) { pend.delete(d.req_id); d.error ? p.rej(new Error(d.error.message)) : p.res(d); } };
const req = (o) => new Promise((res, rej) => { const id = ++rid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ ...o, req_id: id })); });
await new Promise((r) => (ws.onopen = r));

async function m5(symbol, pages) {
  const all = new Map(); let end = "latest";
  for (let i = 0; i < pages; i++) {
    const r = await req({ ticks_history: symbol, style: "candles", granularity: 300, count: 5000, end }).catch(() => null);
    if (!r?.candles?.length) break;
    let added = 0; for (const c of r.candles) if (!all.has(c.epoch)) { all.set(c.epoch, c); added++; }
    if (!added) break; end = r.candles[0].epoch - 1;
  }
  return [...all.values()].sort((a, b) => a.epoch - b.epoch);
}
const sym = process.argv[2] || "1HZ75V";
const c5 = await m5(sym, 14);
ws.close();
const span = `${new Date(c5[0].epoch * 1000).toISOString().slice(0, 10)}..${new Date(c5.at(-1).epoch * 1000).toISOString().slice(0, 10)}`;
console.log(`${sym}: ${c5.length} bougies M5, ${span}`);

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const ema = (v, n) => { const k = 2 / (n + 1); const o = []; let e = v[0]; for (const x of v) { e = x * k + e * (1 - k); o.push(e); } return o; };
const sma = (v, n) => v.map((_, i) => (i < n - 1 ? NaN : mean(v.slice(i - n + 1, i + 1))));

function agg(c, k) { const o = []; for (let i = 0; i + k <= c.length; i += k) { const s = c.slice(i, i + k); o.push({ epoch: s[0].epoch, open: s[0].open, high: Math.max(...s.map((x) => x.high)), low: Math.min(...s.map((x) => x.low)), close: s.at(-1).close }); } return o; }
const atr = (c, n = 14) => { const tr = c.map((x, i) => i ? Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)) : x.high - x.low); const o = []; let a = mean(tr.slice(0, n)); for (let i = 0; i < tr.length; i++) { if (i < n) { o.push(NaN); continue; } a = (a * (n - 1) + tr[i]) / n; o.push(a); } return o; };

for (const [name, cs] of [["M5", c5], ["M15", agg(c5, 3)]]) {
  const r = cs.slice(1).map((x, i) => Math.log(x.close / cs[i].close));
  const n = r.length, m = mean(r), v = sd(r) ** 2;
  const ci = 1.96 / Math.sqrt(n);
  const ac = [1, 2, 3, 4, 5, 6].map((L) => { let s = 0; for (let i = L; i < n; i++) s += (r[i] - m) * (r[i - L] - m); return s / (n - L) / v; });
  console.log(`\n[${name}] n=${n} — autocorrélation des rendements lags 1..6 (IC 95 % ±${ci.toFixed(4)}) :`, ac.map((x) => x.toFixed(4)).join(" "), ac.some((x) => Math.abs(x) > ci) ? "(≥1 lag hors IC)" : "(tous dans l'IC → bruit)");
  const vrs = [2, 4, 8, 16].map((q) => { const rq = []; for (let i = q; i <= n; i++) rq.push(r.slice(i - q, i).reduce((a, b) => a + b, 0)); const vq = sd(rq) ** 2; const VR = vq / (q * v); const z = (VR - 1) / Math.sqrt((2 * (2 * q - 1) * (q - 1)) / (3 * q * n)); return `VR(${q})=${VR.toFixed(3)} z=${z.toFixed(2)}`; });
  console.log(`[${name}] variance ratio (1.0 = marche aléatoire ; >1 = tendance) :`, vrs.join(" | "));
}

// Volatilité : le concept de "régime de volatilité" existe-t-il sur V75 ?
const a5 = atr(c5), sa = sma(a5, 50);
const ratio = a5.map((x, i) => x / sa[i]).filter(Number.isFinite).sort((x, y) => x - y);
const q = (p) => ratio[Math.floor(p * (ratio.length - 1))].toFixed(2);
console.log(`\nATR(14)/SMA(ATR,50) sur M5 : p1=${q(0.01)} p10=${q(0.1)} p50=${q(0.5)} p90=${q(0.9)} p99=${q(0.99)} max=${ratio.at(-1).toFixed(2)}  → part > 1,3 : ${(100 * ratio.filter((x) => x > 1.3).length / ratio.length).toFixed(1)} %, > 1,5 : ${(100 * ratio.filter((x) => x > 1.5).length / ratio.length).toFixed(1)} %`);

// Test direct du signal de ton cahier des charges : régime M15 (EMA20>50>200 & prix>EMA20) -> rendement à +1 h en ATR
const c15 = agg(c5, 3), cl = c15.map((x) => x.close), e20 = ema(cl, 20), e50 = ema(cl, 50), e200 = ema(cl, 200), a15 = atr(c15);
const H = 4; const samples = [];
for (let i = 210; i + H < c15.length; i += H) { // pas de chevauchement
  const up = e20[i] > e50[i] && e50[i] > e200[i] && cl[i] > e20[i];
  const dn = e20[i] < e50[i] && e50[i] < e200[i] && cl[i] < e20[i];
  if (!up && !dn) continue;
  samples.push((up ? 1 : -1) * (cl[i + H] - cl[i]) / a15[i]);
}
const t = mean(samples) / (sd(samples) / Math.sqrt(samples.length));
console.log(`\nSignal "tendance M15 alignée" → rendement des 60 min suivantes, dans le sens de la tendance, en unités d'ATR M15 :`);
console.log(`  n=${samples.length} (non chevauchants)  moyenne=${mean(samples).toFixed(4)} ATR  écart-type=${sd(samples).toFixed(3)}  t=${t.toFixed(2)}  → part positive ${(100 * samples.filter((x) => x > 0).length / samples.length).toFixed(1)} %`);
