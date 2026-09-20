// Tendance diversifiée basse fréquence (time-series momentum), 2000-2026, données quotidiennes Yahoo.
// Lecture seule. Position(t) décidée avec les données jusqu'à t-1. Coût = 2 bps par unité de rotation.
const A = { "^GSPC":"S&P500","^NDX":"Nasdaq100","^GDAXI":"DAX","^N225":"Nikkei","^HSI":"HangSeng","GC=F":"Or","SI=F":"Argent","CL=F":"Pétrole","HG=F":"Cuivre","EURUSD=X":"EURUSD","USDJPY=X":"USDJPY","GBPUSD=X":"GBPUSD","AUDUSD=X":"AUDUSD","TLT":"Oblig.US 20a","NG=F":"Gaz nat." };
const P1 = Math.floor(Date.UTC(2000,0,1)/1000), P2 = Math.floor(Date.now()/1000);
const series = {};
for (const s of Object.keys(A)) {
  const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?period1=${P1}&period2=${P2}&interval=1d`, { headers: { "User-Agent": "Mozilla/5.0" } })).json().catch(() => null);
  const r = j?.chart?.result?.[0]; if (!r) { console.log("indispo", s); continue; }
  const px = (r.indicators.adjclose?.[0]?.adjclose ?? r.indicators.quote[0].close); const m = new Map();
  r.timestamp.forEach((t, i) => { if (px[i] > 0) m.set(new Date(t*1000).toISOString().slice(0,10), px[i]); });
  series[s] = [...m.entries()].sort((a,b)=>a[0]<b[0]?-1:1);
}
const names = Object.keys(series); console.log(`${names.length} marchés :`, names.map(n=>A[n]).join(", "));
const COST = 0.0002, TV = 0.10, LB = [63,126,252];
const SWAP_L = +process.env.SWAP_L || 0, SWAP_S = +process.env.SWAP_S || 0;
global.__gross = { L: 0, S: 0, n: 0 };
const sd = (a) => { const m = a.reduce((x,y)=>x+y,0)/a.length; return Math.sqrt(a.reduce((x,y)=>x+(y-m)**2,0)/(a.length-1)); };
// par actif : rendements journaliers nets stratégie (dict date->ret), avec option de décalage du signal pour le témoin nul
function assetPnl(rows, shift = 0) {
  const d = rows.map(r=>r[0]), p = rows.map(r=>r[1]), r = p.map((x,i)=> i? x/p[i-1]-1 : 0), out = new Map(); let prev = 0;
  const sig = new Array(rows.length).fill(0);
  for (let i = 253; i < rows.length; i++) { let s = 0; for (const L of LB) s += Math.sign(p[i]/p[i-L]-1); sig[i] = s/LB.length; }
  const vol = new Array(rows.length).fill(NaN); for (let i = 61; i < rows.length; i++) vol[i] = sd(r.slice(i-60,i+1))*Math.sqrt(252);
  const N = rows.length;
  for (let i = 254; i < N; i++) {
    const k = ((i - 1 - shift) % N + N) % N; // signal décalé circulairement pour le témoin nul
    if (!(vol[i-1] > 0) && shift === 0) continue;
    const v = Number.isFinite(vol[k]) ? vol[k] : vol[i-1]; if (!(v > 0)) continue;
    const pos = Math.max(-3, Math.min(3, sig[k] * TV / v));
    // swap : % annuel du notionnel, appliqué par jour de bourse (×365/252 pour couvrir week-ends/triple swap)
    const swapDay = (365 / 252) / 365; const sw = pos > 0 ? -pos * (SWAP_L / 100) * swapDay : -pos * (SWAP_S / 100) * swapDay;
    out.set(d[i], pos * r[i] - Math.abs(pos - prev) * COST + sw); if (shift === 0) { global.__gross.L += Math.max(pos, 0); global.__gross.S += Math.max(-pos, 0); global.__gross.n++; } prev = pos;
  }
  return out;
}
function portfolio(shift) { const by = new Map(); for (const n of names) for (const [dt, x] of assetPnl(series[n], shift)) { const e = by.get(dt) ?? []; e.push(x); by.set(dt, e); } return [...by.entries()].sort((a,b)=>a[0]<b[0]?-1:1).map(([dt, a]) => [dt, a.reduce((x,y)=>x+y,0)/a.length]); }
const stats = (rows) => { const x = rows.map(r=>r[1]); const mu = x.reduce((a,b)=>a+b,0)/x.length*252, v = sd(x)*Math.sqrt(252); return { sharpe: mu/v, ret: mu, vol: v }; };
const base = portfolio(0);
const scale = TV / stats(base).vol; const scaled = base.map(([d,x]) => [d, x*scale]);
console.log(`\nPortefeuille tendance diversifié (${names.length} marchés, 3 horizons 3/6/12 mois, cible 10 % de volatilité, coût 2 bps/rotation) :`);
const per = (lo, hi) => scaled.filter(([d]) => +d.slice(0,4) >= lo && +d.slice(0,4) <= hi);
for (const [n, lo, hi] of [["2001-2026 (tout)",2001,2026],["2001-2009",2001,2009],["2010-2019",2010,2019],["2020-2026",2020,2026],["2022-2026",2022,2026]]) { const s = stats(per(lo,hi)); console.log(`  ${n.padEnd(17)} Sharpe ${s.sharpe.toFixed(2).padStart(5)}   rendement ${(s.ret*100).toFixed(1).padStart(5)}%/an (vol 10 %)`); }
let eq = 1, pk = 1, mdd = 0; for (const [,x] of scaled) { eq *= 1+x; pk = Math.max(pk, eq); mdd = Math.min(mdd, eq/pk-1); }
const byY = {}; for (const [d,x] of scaled) (byY[d.slice(0,4)] ??= []).push(x);
const yr = Object.entries(byY).map(([y,a])=>[y, a.reduce((p,q)=>p*(1+q),1)-1]);
console.log(`  perte max (drawdown) : ${(mdd*100).toFixed(0)} % | années négatives : ${yr.filter(([,v])=>v<0).length}/${yr.length} | pire année : ${yr.sort((a,b)=>a[1]-b[1])[0][0]} ${(yr[0][1]*100).toFixed(0)} %`);
// témoin nul : mêmes signaux décalés dans le temps de 1 à 5 ans
const nulls = []; for (const sh of [300,450,600,750,900,1050,1200,1350,1500,1650,1800,1950]) { const pn = portfolio(sh); const s = stats(pn); nulls.push(s.sharpe); }
nulls.sort((a,b)=>a-b);
console.log(`\nTémoin nul (mêmes signaux décalés de 1 à 8 ans → aucune information) : Sharpe min ${nulls[0].toFixed(2)}, médiane ${nulls[6].toFixed(2)}, max ${nulls.at(-1).toFixed(2)}`);
console.log(`Réel : ${stats(base).sharpe.toFixed(2)}`);
