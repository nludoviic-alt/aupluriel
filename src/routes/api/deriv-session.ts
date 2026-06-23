import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { getUserFromRequest } from "@/lib/auth.server";

const TRADING_V1 = "https://api.derivws.com/trading/v1/options";
const DERIV_WS_V3 = "wss://ws.binaryws.com/websockets/v3?app_id=1089&l=EN&brand=deriv";

interface DerivAccount {
  account_id: string;
  account_type: "demo" | "real";
  balance: string;
  currency: string;
  status: string;
}

interface DerivSessionResponse {
  wsUrl: string;
  authToken: string;
  loginId: string;
  balance: number;
  currency: string;
  accountType: "demo" | "live";
  accounts: { id: string; type: "demo" | "live"; balance: number; currency: string }[];
}

export const Route = createFileRoute("/api/deriv-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          token?: string;
          account_type?: "demo" | "live";
        };

        const db = getDb();
        const settings = db
          .prepare("SELECT deriv_token, account_type FROM user_settings WHERE user_id = ?")
          .get(auth.userId) as { deriv_token?: string; account_type?: string } | undefined;

        const token = body.token ?? settings?.deriv_token;
        if (!token) return json({ error: "Aucun token Deriv configuré" }, 400);

        const preferredType = body.account_type ?? (settings?.account_type as "demo" | "live" | undefined) ?? "demo";

        const headers = {
          Authorization: `Bearer ${token}`,
          "Deriv-App-ID": "33zECGFcSA3ZubKPdQJqm",
          "Content-Type": "application/json",
        };

        // Fetch account list to verify token and get account info
        const accRes = await fetch(`${TRADING_V1}/accounts`, { headers });
        if (!accRes.ok) {
          const text = await accRes.text();
          return json({ error: `Authentification échouée (${accRes.status}): ${text.slice(0, 200)}` }, 401);
        }
        const accData = (await accRes.json()) as { data: DerivAccount[] };
        const accounts = accData.data ?? [];

        // Pick account matching preferred type
        const wantedType = preferredType === "live" ? "real" : "demo";
        const chosen =
          accounts.find((a) => a.account_type === wantedType && a.status === "active") ??
          accounts.find((a) => a.status === "active");

        if (!chosen) return json({ error: "Aucun compte actif trouvé" }, 400);

        // Use standard Deriv v3 WebSocket — client will authorize with the API token
        const response: DerivSessionResponse = {
          wsUrl: DERIV_WS_V3,
          authToken: token,
          loginId: chosen.account_id,
          balance: parseFloat(chosen.balance),
          currency: chosen.currency,
          accountType: chosen.account_type === "real" ? "live" : "demo",
          accounts: accounts.map((a) => ({
            id: a.account_id,
            type: a.account_type === "real" ? "live" : "demo",
            balance: parseFloat(a.balance),
            currency: a.currency,
          })),
        };

        return json(response);
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
