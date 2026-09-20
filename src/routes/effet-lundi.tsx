import { createFileRoute } from "@tanstack/react-router";
import { IdxSeasonalPanel } from "@/components/idx-seasonal-panel";

export const Route = createFileRoute("/effet-lundi")({
  head: () => ({ meta: [{ title: "Effet lundi — Au Pluriel" }] }),
  component: EffetLundiPage,
});

function EffetLundiPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <IdxSeasonalPanel />
    </div>
  );
}
