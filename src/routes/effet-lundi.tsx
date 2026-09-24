import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/effet-lundi")({
  beforeLoad: () => {
    throw redirect({ to: "/autotrader" });
  },
});
