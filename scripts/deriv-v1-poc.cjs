/**
 * POC — Deriv Trading v1 API (nouveau système d'auth PAT).
 * 1. GET /accounts   -> valide que le token pat_ + app_id fonctionne, récupère accountId
 * 2. POST /accounts/{id}/otp -> URL WebSocket authentifiée
 * 3. connexion WS    -> lecture solde
 *
 * Usage: node scripts/deriv-v1-poc.cjs <PAT_TOKEN> <APP_ID>
 */
const WebSocket = require("ws");

const TOKEN = process.argv[2];
const APP_ID = process.argv[3];
const BASE = "https://api.derivws.com/trading/v1/options";

if (!TOKEN || !APP_ID) {
  console.error("Usage: node scripts/deriv-v1-poc.cjs <PAT_TOKEN> <APP_ID>");
  process.exit(1);
}

const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Deriv-App-ID": APP_ID,
  "Content-Type": "application/json",
};

async function main() {
  // --- 1. Lister les comptes ---
  console.log("→ GET", `${BASE}/accounts`);
  const accRes = await fetch(`${BASE}/accounts`, { headers });
  console.log("  status:", accRes.status, accRes.statusText);
  const accText = await accRes.text();
  console.log("  body:", accText.slice(0, 2000));
  if (!accRes.ok) {
    console.log("\n❌ L'authentification PAT a échoué — on s'arrête ici.");
    return;
  }

  let accounts;
  try { accounts = JSON.parse(accText); } catch { accounts = null; }
  const list = accounts?.data ?? accounts?.accounts ?? accounts;
  const first = Array.isArray(list) ? list[0] : Array.isArray(list?.accounts) ? list.accounts[0] : null;
  const accountId = first?.account_id ?? first?.accountId ?? first?.id ?? first?.loginid;
  console.log("\n  accountId détecté:", accountId);
  if (!accountId) { console.log("⚠️ accountId introuvable dans la réponse — voir body ci-dessus."); return; }

  // --- 2. OTP -> URL WebSocket authentifiée ---
  const otpUrl = `${BASE}/accounts/${accountId}/otp`;
  console.log("\n→ POST", otpUrl);
  const otpRes = await fetch(otpUrl, { method: "POST", headers, body: "{}" });
  console.log("  status:", otpRes.status, otpRes.statusText);
  const otpText = await otpRes.text();
  console.log("  body:", otpText.slice(0, 1000));
  if (!otpRes.ok) { console.log("\n❌ OTP a échoué."); return; }
  const otp = JSON.parse(otpText);
  const wsUrl = otp?.data?.url ?? otp?.url;
  console.log("\n  WS URL:", wsUrl);
  if (!wsUrl) { console.log("⚠️ Pas d'URL WS dans la réponse."); return; }

  // --- 3. Connexion WebSocket authentifiée ---
  console.log("\n→ Connexion WebSocket authentifiée…");
  const ws = new WebSocket(wsUrl);
  const t = setTimeout(() => { console.log("  (pas de message reçu en 8s)"); ws.close(); process.exit(0); }, 8000);
  ws.on("open", () => {
    console.log("  ✅ WS ouverte. Envoi d'une demande de solde…");
    // format à confirmer — on tente quelques variantes courantes
    ws.send(JSON.stringify({ type: "balance" }));
    ws.send(JSON.stringify({ balance: 1 }));
  });
  ws.on("message", (d) => {
    console.log("  ← message:", d.toString().slice(0, 500));
  });
  ws.on("error", (e) => { console.log("  WS error:", e.message); });
  ws.on("close", (c, r) => { clearTimeout(t); console.log("  WS fermée:", c, r.toString()); process.exit(0); });
}

main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
