// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Split each route's component into its own chunk so heavy routes (charts, autotrader)
    // aren't bundled into every page's initial load.
    router: { autoCodeSplitting: true },
  },
  // Force a Node server build (default target is Cloudflare, which can't run
  // better-sqlite3). Produces `.output/server/index.mjs` — run with `node`.
  // Setting an explicit preset also force-enables Nitro outside the sandbox.
  nitro: { preset: "node-server" },
});
