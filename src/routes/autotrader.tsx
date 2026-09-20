import { createFileRoute, redirect } from "@tanstack/react-router";

// Page archivée le 2026-09-20 (presets de trading archivés) : l'ancien contenu est dans
// archived-routes/autotrader.tsx. La redirection garde les anciens liens et notifications valides.
export const Route = createFileRoute("/autotrader")({
  beforeLoad: () => {
    throw redirect({ to: "/effet-lundi" });
  },
});
