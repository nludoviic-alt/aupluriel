// Test de porte : "M15 trend + M5 pullback" sur V75, optimisation 70 % / validation 30 %,
// + témoin nul (séries sans dépendance, mêmes distributions de bougies).
// Lecture seule. Coûts en points de base (bps) du notionnel, aller-retour.
import { readFileSync } from "node:fs";
const FILE = process.argv[2]; const raw = JSON.parse(readFileSync(FILE, "utf8")); // [epoch,o,h,l,c]
const NULLS = +(process.argv[3] || 40);

const ema = (v, n) => { const k = 2 / (n + 1); const o = new Float64Array(v.length); let e = v[0]; for (let i = 0; i < v.length; i++) { e = v[i] * k + e * (1 - k); o[i] = e; } return o; };
function wilder(v, n, start) { const o = new Float64Array(v.length).fill(NaN); let s = 0; for (let i = start; i < start + n; i++) s += v[i]; let a = s / n; o[start + n - 1] = a; for (let i = start + n; i < v.length; i++) { a = (a * (n - 1) + v[i]) / n; o[i] = a; } return o; }
function tr(H, L, C) { const t = new Float64Array(H.length); for (let i = 0; i < H.length; i++) t[i] = i ? Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) : H[i] - L[i]; return t; }
function rsi(C, n = 14) { const g = new Float64Array(C.length), l = new Float64Array(C.length); for (let i = 1; i < C.length; i++) { const d = C[i] - C[i - 1]; g[i] = d > 0 ? d : 0; l[i] = d < 0 ? -d : 0; } const ag = wilder(g, n, 1), al = wilder(l, n, 1); return ag.map((x, i) => (al[i] === 0 ? 100 : 100 - 100 / (1 + x / al[i]))); }
function adx(H, L, C, n = 14) {
  const pdm = new Float64Array(H.length), mdm = new Float64Array(H.length);
  for (let i = 1; i < H.length; i++) { const up = H[i] - H[i - 1], dn = L[i - 1] - L[i]; pdm[i] = up > dn && up > 0 ? up : 0; mdm[i] = dn > up && dn > 0 ? dn : 0; }
  const t = tr(H, L, C); const st = wilder(t, n, 1), sp = wilder(pdm, n, 1), sm = wilder(mdm, n, 1);
  const dx = new Float64Array(H.length).fill(NaN); for (let i = 0; i < H.length; i++) { const pd = 100 * sp[i] / st[i], md = 100 * sm[i] / st[i]; dx[i] = Number.isFinite(pd + md) && pd + md > 0 ? 100 * Math.abs(pd - md) / (pd + md) : NaN; }
  const first = dx.findIndex(Number.isFinite); const clean = dx.map((x) => (Number.isFinite(x) ? x : 0));
  return wilder(clean, n, first);
}

function prepare(bars) { // bars: [epoch,o,h,l,c]
  const off = bars.findIndex((b) => b[0] % 900 === 0); const b = bars.slice(off);
  const n = b.length, O = Float64Array.from(b, (x) => x[1]), H = Float64Array.from(b, (x) => x[2]), L = Float64Array.from(b, (x) => x[3]), C = Float64Array.from(b, (x) => x[4]);
  const e20 = ema(C, 20), r = rsi(C), a = wilder(tr(H, L, C), 14, 1);
  const m = Math.floor(n / 3); const H15 = new Float64Array(m), L15 = new Float64Array(m), C15 = new Float64Array(m);
  for (let j = 0; j < m; j++) { H15[j] = Math.max(H[3 * j], H[3 * j + 1], H[3 * j + 2]); L15[j] = Math.min(L[3 * j], L[3 * j + 1], L[3 * j + 2]); C15[j] = C[3 * j + 2]; }
  const f = ema(C15, 20), s = ema(C15, 50), sl = ema(C15, 200), ad = adx(H15, L15, C15);
  const dh = new Float64Array(n).fill(NaN), dl = new Float64Array(n).fill(NaN);
  for (let k = 20; k < n; k++) { let hh = -Infinity, ll = Infinity; for (let q = k - 20; q < k; q++) { if (H[q] > hh) hh = H[q]; if (L[q] < ll) ll = L[q]; } dh[k] = hh; dl[k] = ll; }
  const up = new Uint8Array(m), dn = new Uint8Array(m), adv = ad;
  for (let j = 200; j < m; j++) { up[j] = f[j] > s[j] && s[j] > sl[j] && C15[j] > f[j] ? 1 : 0; dn[j] = f[j] < s[j] && s[j] < sl[j] && C15[j] < f[j] ? 1 : 0; }
  return { n, O, H, L, C, e20, r, a, up, dn, adx: adv, m, dh, dl };
}

const GRID = []; for (const mode of ["imm", "retest"]) for (const comp of [false, true]) for (const adxMin of [0, 25]) for (const sl of [1.2, 1.5, 2.0]) for (const R of [1.5, 2, 3]) GRID.push({ mode, comp, adxMin, sl, R });
const LOOK = 6, MAXHOLD = 48;

function run(P, g, i0, i1) { // renvoie [{gR, slFrac}] pour signaux dans [i0,i1)
  const out = []; const { n, O, H, L, C, e20, r, a, up, dn, adx: ad, m, dh, dl } = P;
  let i = Math.max(i0, 700);
  while (i < Math.min(i1, n - MAXHOLD - 2)) {
    const j = Math.floor((i - 2) / 3); // dernier M15 complet
    if (j < 201) { i++; continue; }
    const okAdx = g.adxMin === 0 || ad[j] >= g.adxMin;
    let dir = 0;
    if (okAdx && up[j]) dir = 1; else if (okAdx && dn[j]) dir = -1;
    if (dir) {
      const raw_ = (k, d) => {
        if (!(a[k] > 0) || !Number.isFinite(dh[k])) return false;
        if (H[k] - L[k] > 2.5 * a[k]) return false; // pas de bougie d'expansion excessive
        if (g.comp && dh[k] - dl[k] > 6 * a[k]) return false; // consolidation serrée exigée
        return d === 1 ? C[k] > dh[k] && r[k] > 55 : C[k] < dl[k] && r[k] < 45; // clôture au-delà + momentum
      };
      const fresh = (k, d) => raw_(k, d) && !raw_(k - 1, d);
      if (g.mode === "imm") { if (!fresh(i, dir)) dir = 0; }
      else {
        let b = -1; for (let k = i - 1; k >= i - 6; k--) if (fresh(k, dir)) { b = k; break; }
        if (b < 0) dir = 0; else {
          const lvl = dir === 1 ? dh[b] : dl[b];
          const touch = (k) => (dir === 1 ? L[k] <= lvl + 0.25 * a[k] && C[k] > lvl : H[k] >= lvl - 0.25 * a[k] && C[k] < lvl);
          let ok = touch(i); for (let k = b + 1; k < i && ok; k++) if (touch(k)) ok = false;
          if (!ok) dir = 0;
        }
      }
    }
    if (!dir || !(a[i] > 0)) { i++; continue; }
    const entry = O[i + 1], dist = g.sl * a[i], tp = g.R * dist;
    let exit = NaN, k = i + 1;
    for (; k <= i + MAXHOLD; k++) {
      const sHit = dir === 1 ? L[k] <= entry - dist : H[k] >= entry + dist;
      const tHit = dir === 1 ? H[k] >= entry + tp : L[k] <= entry - tp;
      if (sHit) { exit = entry - dir * dist; break; } // SL prioritaire si les deux (conservateur)
      if (tHit) { exit = entry + dir * tp; break; }
    }
    if (Number.isNaN(exit)) { k = i + MAXHOLD; exit = C[k]; }
    out.push({ gR: (dir * (exit - entry)) / dist, slFrac: dist / entry });
    i = k + 1;
  }
  return out;
}
const stat = (t, bps = 0) => { if (!t.length) return { n: 0, e: NaN, pf: NaN, wr: NaN }; const x = t.map((z) => z.gR - (bps / 1e4) / z.slFrac); const gp = x.filter((v) => v > 0).reduce((s, v) => s + v, 0), gl = -x.filter((v) => v < 0).reduce((s, v) => s + v, 0); return { n: x.length, e: x.reduce((s, v) => s + v, 0) / x.length, pf: gl ? gp / gl : Infinity, wr: x.filter((v) => v > 0).length / x.length }; };
const gname = (g) => `${g.mode}${g.comp ? "+compression" : ""} adx>=${g.adxMin} SL${g.sl}xATR TP${g.R}R`;

function pipeline(P) {
  const split = Math.floor(P.n * 0.7); let best = null;
  for (const g of GRID) { const t = run(P, g, 0, split); const s = stat(t); if (s.n >= 100 && (!best || s.e > best.s.e)) best = { g, s }; }
  if (!best) return null;
  const test = run(P, best.g, split, P.n);
  return { g: best.g, train: best.s, test, split };
}

// ── données réelles ──
const P = prepare(raw); const res = pipeline(P);
console.log(`Données : ${P.n} bougies M5 (~${(P.n / 288).toFixed(0)} jours). Optimisation = 70 % (${res.split} barres), validation = 30 % jamais vue.\n`);
console.log(`Grille : ${GRID.length} combinaisons. Meilleure config EN ÉCHANTILLON : ${gname(res.g)}`);
const fmt = (s) => `n=${s.n} espérance=${s.e.toFixed(3)}R PF=${s.pf.toFixed(2)} WR=${(100 * s.wr).toFixed(1)}%`;
console.log(`  optimisation (brut) : ${fmt(res.train)}`);
for (const bps of [0, 2, 5, 10]) console.log(`  VALIDATION, coût ${String(bps).padStart(2)} bps A/R : ${fmt(stat(res.test, bps))}`);
const avgSlBps = 1e4 * res.test.reduce((s, z) => s + z.slFrac, 0) / res.test.length;
console.log(`  (distance de stop moyenne ≈ ${avgSlBps.toFixed(1)} bps du prix → 1 bps de coût ≈ ${(1 / avgSlBps).toFixed(3)} R par trade)`);
const testGross = stat(res.test).e;
{ const x = res.test.map((z) => z.gR); const mu = x.reduce((p, q) => p + q, 0) / x.length; const sdv = Math.sqrt(x.reduce((p, q) => p + (q - mu) ** 2, 0) / (x.length - 1)); console.log(`  t-stat de l'espérance brute en validation : ${(mu / (sdv / Math.sqrt(x.length))).toFixed(2)} (|t| < 2 = pas distinguable de zéro)`); }
// espérance brute exprimée en bps du notionnel
console.log(`  espérance brute en validation ≈ ${(testGross * avgSlBps).toFixed(2)} bps par trade (à comparer à la commission A/R réelle)\n`);

// ── témoin nul ──
const rel = raw.map((b) => [Math.log(b[4] / b[1]), Math.log(b[2] / b[1]), Math.log(b[3] / b[1])]);
let seed = 12345; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const oos = [], trainBest = [];
for (let k = 0; k < NULLS; k++) {
  const bars = []; let px = raw[0][1], ep = 1758333600; // aligné sur 15 min (la 1re bougie réelle est isolée)
  for (let i = 0; i < raw.length; i++) { const [rc, rh, rl] = rel[Math.floor(rnd() * rel.length)]; const o = px, c = o * Math.exp(rc); bars.push([ep, o, Math.max(o * Math.exp(rh), o, c), Math.min(o * Math.exp(rl), o, c), c]); px = c; ep += 300; }
  const p = prepare(bars), rr = pipeline(p); if (!rr) continue;
  oos.push(stat(rr.test).e); trainBest.push(rr.train.e);
}
oos.sort((a, b) => a - b); trainBest.sort((a, b) => a - b);
const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(3);
const realOos = testGross, realTrain = res.train.e;
console.log(`TÉMOIN NUL (${oos.length} séries sans dépendance, même volatilité et mêmes formes de bougies, même optimisation) :`);
console.log(`  meilleure espérance EN ÉCHANTILLON sur du pur hasard : médiane ${q(trainBest, 0.5)}R, p95 ${q(trainBest, 0.95)}R, max ${trainBest.at(-1).toFixed(3)}R   (réel : ${realTrain.toFixed(3)}R)`);
console.log(`  espérance en VALIDATION sur du pur hasard          : médiane ${q(oos, 0.5)}R, p95 ${q(oos, 0.95)}R, max ${oos.at(-1).toFixed(3)}R   (réel : ${realOos.toFixed(3)}R)`);
console.log(`  → part des séries hasard qui font au moins aussi bien que le réel en validation : ${(100 * oos.filter((x) => x >= realOos).length / oos.length).toFixed(0)} %`);
