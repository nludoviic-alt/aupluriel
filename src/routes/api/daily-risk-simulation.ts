import { createFileRoute } from "@tanstack/react-router";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { getDailyRiskSimulation } from "@/lib/daily-risk-simulation.server";
import { ACTIVE_PRESETS, type Preset } from "@/lib/bot-engine.server";

export const Route = createFileRoute("/api/daily-risk-simulation")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return Response.json({ error: "Non authentifié" }, { status: 401 });
        const preset = new URL(request.url).searchParams.get("preset") as Preset | null;
        if (!preset || !ACTIVE_PRESETS.includes(preset))
          return Response.json({ error: "Preset inconnu" }, { status: 400 });
        return Response.json({ preset, cohorts: getDailyRiskSimulation(user.id, preset) });
      },
    },
  },
});
