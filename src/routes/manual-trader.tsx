import { createFileRoute } from "@tanstack/react-router";
import { AutoTraderPage } from "./autotrader";

export const Route = createFileRoute("/manual-trader")({
  head: () => ({ meta: [{ title: "Prise directe — Au Pluriel" }] }),
  component: ManualTraderPage,
});

function ManualTraderPage() {
  return <AutoTraderPage defaultTab="manual" />;
}
