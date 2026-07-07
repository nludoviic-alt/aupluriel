// Healthcheck endpoint — Railway pings this right after every deploy. Loading
// this module pulls in the SSR environment, whose boot hook (src/server.ts)
// restores enabled server bots; without the ping, nitro lazy-loads user code
// on the FIRST request only, so a restart with zero traffic would leave the
// auto-trader dormant until someone visited the site.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
