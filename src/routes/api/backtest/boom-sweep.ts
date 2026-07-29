// Parameter sweep for the Boom preset — used by the Backtest page's "Boom
// Multiplier Sweep" mode. Real historical Deriv candles, not guesswork; see
// src/lib/boom-sweep.server.ts for why it fetches candles once per symbol
// instead of once per combo (naive version took hours for a full grid).
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "@/lib/auth.server";
import { sweepBoomPreset } from "@/lib/boom-sweep.server";
import { BOOM_SYMBOLS } from "@/lib/autotrader";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/backtest/boom-sweep")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const symbolsParam = url.searchParams.get("symbols");
        const symbols = symbolsParam ? symbolsParam.split(",").map((s) => s.trim()).filter(Boolean) : BOOM_SYMBOLS;
        if (symbols.length === 0 || symbols.length > 4) {
          return json({ error: "1 à 4 symboles Boom requis." }, 400);
        }
        const candles = Math.min(500, Math.max(50, Number(url.searchParams.get("candles") ?? 150)));
        const stake = Math.min(100, Math.max(1, Number(url.searchParams.get("stake") ?? 5)));
        const leverage = Math.min(1000, Math.max(1, Number(url.searchParams.get("leverage") ?? 100)));
        const hold = Math.min(720, Math.max(5, Number(url.searchParams.get("hold") ?? 60)));
        const quick = url.searchParams.get("quick") === "1";

        try {
          const report = await sweepBoomPreset({ symbols, candles, stake, leverage, hold, quick });
          return json(report);
        } catch (err) {
          return json({ error: err instanceof Error ? err.message : "Erreur du sweep" }, 500);
        }
      },
    },
  },
});
