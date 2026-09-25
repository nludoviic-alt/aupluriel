import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Route chunks are large on the execution screens. Start loading them on
    // intent (hover/focus) so navigation from Piste is instantaneous instead
    // of waiting for the click to fetch and parse the page bundle.
    defaultPreload: "intent",
    defaultPreloadDelay: 80,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
