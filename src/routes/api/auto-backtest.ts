// Read-only status endpoint for the periodic auto-backtest verdict (see
// src/lib/auto-backtest.server.ts) — surfaced in Paramètres and Auto-Trader
// so "Backtest automatique" isn't a silent toggle with no feedback.
import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "@/lib/auth.server";
import { getDb } from "@/lib/db.server";

export const Route = createFileRoute("/api/auto-backtest")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const row = getDb()
          .prepare("SELECT favorable, win_rate, break_even_win_rate, checked_at FROM auto_backtest_state WHERE id = 1")
          .get() as { favorable: number; win_rate: number; break_even_win_rate: number; checked_at: number } | undefined;

        if (!row) return json({ checked: false });

        return json({
          checked: true,
          favorable: !!row.favorable,
          winRate: row.win_rate,
          breakEvenWinRate: row.break_even_win_rate,
          checkedAt: row.checked_at * 1000, // stored as unixepoch seconds
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
