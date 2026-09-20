// À lancer pendant les heures de marché (lundi) : quelles durées Deriv offre-t-il
// sur les 10 indices OTC de idxseasonal, et dans quelles unités (m/h/d) ?
// Répond à : peut-on exécuter le hold de 4-7 h en binaire au lieu du suivi papier ?
// Données publiques, aucun token, aucun ordre.
//   node scripts/check-idx-durations.mjs
const SYMBOLS = ["OTC_NDX", "OTC_SPC", "OTC_DJI", "OTC_GDAXI", "OTC_FCHI", "OTC_SX5E", "OTC_SSMI", "OTC_N225", "OTC_HSI", "OTC_AS51"];
const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
await new Promise((r) => (ws.onopen = r));
const ask = (o) =>
  new Promise((res) => {
    const id = (Math.random() * 1e9) | 0;
    const h = (m) => { const d = JSON.parse(m.data); if (d.req_id === id) { ws.removeEventListener("message", h); res(d); } };
    ws.addEventListener("message", h);
    ws.send(JSON.stringify({ ...o, req_id: id }));
  });
for (const s of SYMBOLS) {
  const r = await ask({ contracts_for: s, currency: "USD" });
  if (r.error) { console.log(s.padEnd(10), "—", r.error.message); continue; }
  const seen = new Set();
  for (const c of r.contracts_for.available) {
    if (!/^(CALL|PUT|MULTUP|MULTDOWN)$/.test(c.contract_type)) continue;
    seen.add(`${c.contract_type} ${c.expiry_type} durée ${c.min_contract_duration}..${c.max_contract_duration}`);
  }
  console.log(s.padEnd(10), [...seen].join(" | ") || "aucun CALL/PUT/MULT");
}
ws.close();
