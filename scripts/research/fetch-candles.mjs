import { writeFileSync } from "node:fs";
const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
let rid = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); const p = pend.get(d.req_id); if (p) { pend.delete(d.req_id); d.error ? p.rej(new Error(d.error.message)) : p.res(d); } };
const req = (o) => new Promise((res, rej) => { const id = ++rid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ ...o, req_id: id })); });
await new Promise((r) => (ws.onopen = r));
const all = new Map(); let end = "latest", pages = 0;
for (; pages < 60; pages++) {
  const r = await req({ ticks_history: process.argv[2], style: "candles", granularity: 300, count: 5000, end }).catch((e) => ({ err: e.message }));
  if (r.err || !r.candles?.length) { console.log("stop:", r.err ?? "vide"); break; }
  let added = 0; for (const c of r.candles) if (!all.has(c.epoch)) { all.set(c.epoch, c); added++; }
  if (!added) break; end = r.candles[0].epoch - 1;
}
const bars = [...all.values()].sort((a, b) => a.epoch - b.epoch).map((c) => [c.epoch, +c.open, +c.high, +c.low, +c.close]);
writeFileSync(`${process.argv[2]}-m5.json`, JSON.stringify(bars));
const gaps = bars.slice(1).filter((b, i) => b[0] - bars[i][0] !== 300).length;
console.log(`${bars.length} bougies M5 en ${pages} pages, ${new Date(bars[0][0]*1000).toISOString().slice(0,10)}..${new Date(bars.at(-1)[0]*1000).toISOString().slice(0,10)}, trous: ${gaps}`);
ws.close();
