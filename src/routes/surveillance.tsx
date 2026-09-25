import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { HealthPanel } from "@/components/health-panel";
import { ChangelogPanel } from "@/components/changelog-panel";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/surveillance")({
  head: () => ({ meta: [{ title: "Surveillance — Au Pluriel" }] }),
  component: SurveillancePage,
});

function SurveillancePage() {
  const { user } = useAuth();
  const isAdmin = user?.is_admin === 1;

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="h-14 w-14 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4">
          <Activity className="h-7 w-7 text-rose-400" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Acces reserve</h1>
        <p className="text-sm text-muted-foreground mt-2">
          Cette page est reserveee aux administrateurs.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 md:px-8 lg:px-12 py-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 flex items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]">
          <Activity className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight text-foreground leading-none">Surveillance</h1>
          <p className="text-xs text-muted-foreground mt-1">Etat des fonctionnalites et journal des bugs.</p>
        </div>
      </div>

      <HealthPanel />
      <ChangelogPanel />
    </div>
  );
}
