// Backtest Monday-effect (session open -> session close, LONG) on Deriv OTC index hourly candles.
// Read-only: public WS market data only, no orders, no token.
import { writeFileSync } from "node:fs";

const CFG = {
  OTC_NDX: [14, 300], OTC_SPC: [14, 300], OTC_DJI: [14, 300],
  OTC_GDAXI: [8, 420], OTC_FCHI: [8, 420], OTC_SX5E: [8, 420], OTC_SSMI: [8, 420],
  OTC_N225: [1, 240], OTC_HSI: [2, 300], OTC_AS51: [1, 240],
};
const COST = 0.0003; // 0.03 % / trade, same as RESEARCH-A
const OUT = process.argv[2];

const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
let rid = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  const p = pending.get(d.req_id);
  if (p) { pending.delete(d.req_id); d.error ? p.rej(new Error(d.error.message)) : p.res(d); }
};
const req = (o) => new Promise((res, rej) => {
  const id = ++rid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ ...o, req_id: id }));
});
await new Promise((r) => (ws.onopen = r));

async function hourly(symbol) {
  const all = new Map();
  let end = "latest";
  for (let i = 0; i < 12; i++) {
    const r = await req({ ticks_history: symbol, style: "candles", granularity: 3600, count: 5000, end }).catch((e) => ({ err: e.message }));
    if (r.err || !r.candles?.length) break;
    let added = 0;
    for (const c of r.candles) if (!all.has(c.epoch)) { all.set(c.epoch, c); added++; }
    const first = r.candles[0].epoch;
    if (!added) break;
    end = first - 1;
  }
  return [...all.values()].sort((a, b) => a.epoch - b.epoch);
}

function stats(rets) {
  const n = rets.length;
  if (!n) return { n: 0 };
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
  const gp = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const gl = -rets.filter((r) => r < 0).reduce((a, b) => a + b, 0);
  return { n, mean: mean * 100, wr: (100 * rets.filter((r) => r > 0).length) / n, pf: gl ? gp / gl : Infinity, t: sd ? mean / (sd / Math.sqrt(n)) : 0 };
}

const perSym = {};
const pooledByYear = {};
const pooled = { mon: [], oth: [] };
for (const [sym, [H, D]] of Object.entries(CFG)) {
  const cs = await hourly(sym);
  const byEpoch = new Map(cs.map((c) => [c.epoch, c]));
  const nb = D / 60;
  const mon = [], oth = [];
  const seenDays = new Set();
  for (const c of cs) {
    const dt = new Date(c.epoch * 1000);
    if (dt.getUTCHours() !== H) continue;
    const day = dt.toISOString().slice(0, 10);
    if (seenDays.has(day)) continue;
    seenDays.add(day);
    const bars = [];
    for (let k = 0; k < nb; k++) { const b = byEpoch.get(c.epoch + k * 3600); if (b) bars.push(b); }
    if (bars.length < nb - 1) continue; // incomplete session / closed
    const ret = bars[bars.length - 1].close / bars[0].open - 1 - COST;
    const dow = dt.getUTCDay();
    if (dow === 1) { mon.push({ ret, year: dt.getUTCFullYear(), day }); }
    else if (dow >= 2 && dow <= 5) oth.push(ret);
  }
  perSym[sym] = { mondays: mon.map((m) => [m.day, m.ret]), oth: oth.length,
    span: cs.length ? `${new Date(cs[0].epoch * 1000).toISOString().slice(0, 10)}..${new Date(cs[cs.length - 1].epoch * 1000).toISOString().slice(0, 10)}` : "-",
    monday: stats(mon.map((m) => m.ret)),
    otherDays: stats(oth),
  };
  for (const m of mon) { (pooledByYear[m.year] ??= []).push(m.ret); pooled.mon.push(m.ret); }
  pooled.oth.push(...oth);
  console.error(sym, perSym[sym].span, "mon n=", mon.length);
}
const res = { perSym, pooled: { monday: stats(pooled.mon), otherDays: stats(pooled.oth) }, byYear: Object.fromEntries(Object.entries(pooledByYear).map(([y, r]) => [y, stats(r)])) };
writeFileSync(OUT, JSON.stringify(res, null, 2));
ws.close();
