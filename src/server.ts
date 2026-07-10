import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// Resume server-side auto-traders after a (re)start — this is what lets the
// bot keep trading with the user's phone locked / app closed. Deferred a few
// seconds so DB and env are fully ready; guarded against dev-mode HMR
// re-execution spawning duplicate engines.
const g = globalThis as unknown as { __lio23_bot_boot__?: boolean; __lio23_shutdown__?: boolean };
if (!g.__lio23_bot_boot__) {
  g.__lio23_bot_boot__ = true;
  setTimeout(() => {
    import("./lib/bot-engine.server")
      .then((m) => m.restoreBots())
      .catch((e) => console.error("[bot] Restauration au boot échouée:", e));
  }, 3000);

  // Graceful shutdown: without this, open Deriv WebSockets + bot intervals kept
  // the process alive ~90s past SIGTERM until systemd SIGKILLed it — a full 502
  // window on every deploy. Engines are stopped WITHOUT flipping bot_state, so
  // restoreBots() resumes them when the new process boots.
  const shutdown = (signal: string) => {
    if (g.__lio23_shutdown__) return;
    g.__lio23_shutdown__ = true;
    console.log(`[shutdown] ${signal} reçu — fermeture des moteurs et sockets Deriv`);
    // Hard-exit backstop in case a handle still hangs; unref so IT never keeps us alive.
    setTimeout(() => process.exit(0), 5000).unref();
    Promise.all([
      import("./lib/bot-engine.server").then((m) => m.shutdownAllEngines()),
      import("./lib/deriv.server").then((m) => m.closePublicSocket()),
    ])
      .catch(() => { /* exiting regardless */ })
      .finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
