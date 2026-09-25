// Admin API — exécute un skill sur le VPS et retourne le rapport.
// Le skill tourne directement sur le VPS (accès DB production), le résultat
// est retourné au frontend pour affichage.
import { createFileRoute } from "@tanstack/react-router";
import { requireAdmin } from "@/lib/auth.server";
import { execSync } from "child_process";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Map: skill name → script path on VPS
const SKILL_SCRIPTS: Record<string, string> = {
  "adaptive-trading-optimizer": ".devin/skills/adaptive-trading-optimizer/scripts/optimize.mjs",
  "daily-pnl-review": ".devin/skills/daily-pnl-review/scripts/daily-review.mjs",
  "risk-optimizer": ".devin/skills/risk-optimizer/scripts/risk-optimize.mjs",
  "session-timing-analyzer": ".devin/skills/session-timing-analyzer/scripts/timing-analyze.mjs",
  "backtest-vs-live-validator": ".devin/skills/backtest-vs-live-validator/scripts/validate.mjs",
  "audit-trading-production": ".agents/skills/audit-trading-production/scripts/audit-production.mjs",
};

// Extra args per skill
const SKILL_DEFAULT_ARGS: Record<string, string> = {
  "risk-optimizer": "--bankroll=100",
};

export const Route = createFileRoute("/api/admin/run-skill")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          skill: string;
          args?: string;
        };

        const { skill, args } = body;
        if (!skill || !SKILL_SCRIPTS[skill]) {
          return json({ error: `Skill inconnu. Disponibles: ${Object.keys(SKILL_SCRIPTS).join(", ")}` }, 400);
        }

        const scriptPath = SKILL_SCRIPTS[skill];
        const dbPath = "/home/ubuntu/data/lio23.db";
        const extraArgs = args?.trim() || SKILL_DEFAULT_ARGS[skill] || "";

        // Execute locally — we ARE on the VPS already
        try {
          const cmd = `node ${scriptPath} ${dbPath} ${extraArgs} 2>&1`;
          const output = execSync(cmd, {
            cwd: "/home/ubuntu/app",
            timeout: 60000,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          });
          return json({ success: true, skill, output });
        } catch (e: any) {
          const output = e.stdout || e.stderr || e.message || String(e);
          return json({ success: false, skill, output, error: e.message }, 500);
        }
      },
    },
  },
});
