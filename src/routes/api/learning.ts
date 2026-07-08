// Apprentissage partagé — expose les statistiques win/loss par composant de
// signal, agrégées sur les trades serveur de TOUS les utilisateurs. Permet de
// suivre "l'entraînement" collectif du moteur : quels indicateurs gagnent,
// quels poids le moteur applique désormais.
import { createFileRoute } from "@tanstack/react-router";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { getDb } from "@/lib/db.server";
import { getComponentBreakdownServer } from "@/lib/indicator-weights.server";

export const Route = createFileRoute("/api/learning")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const url = new URL(request.url);
        const symbol = url.searchParams.get("symbol") ?? undefined;
        const stats = getComponentBreakdownServer(symbol);

        // Volume d'entraînement : combien de trades fermés ont nourri les stats,
        // et par combien de comptes distincts — la métrique "entraîné à N personnes".
        const totals = getDb()
          .prepare(
            `SELECT COUNT(*) AS trades, COUNT(DISTINCT user_id) AS contributors
             FROM bot_trades WHERE status IN ('won','lost') AND components IS NOT NULL`,
          )
          .get() as { trades: number; contributors: number };

        return json({
          stats,
          trainedOnTrades: totals.trades,
          contributors: totals.contributors,
        });
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
