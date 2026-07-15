// Feature health dashboard — mirrors health-monitor.server.ts's checks
// (bots running, backtest scheduler, push subscriptions, email config,
// Deriv tokens). The server already pushes admins on any status change;
// this panel is the always-current "go look" view.
import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { CollapsibleBlock } from "@/components/collapsible-section";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

type Status = "ok" | "warn" | "error";

interface HealthCheck {
  checkKey: string;
  label: string;
  status: Status;
  detail: string;
  checkedAt: number;
}

const STATUS_META: Record<Status, { dot: string; label: string; className: string }> = {
  ok: { dot: "bg-emerald-500", label: "OK", className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  warn: { dot: "bg-amber-500", label: "Attention", className: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  error: { dot: "bg-rose-500", label: "Panne", className: "text-rose-400 bg-rose-500/10 border-rose-500/20" },
};

function relativeTime(unixSeconds: number): string {
  const diffMin = Math.round((Date.now() - unixSeconds * 1000) / 60_000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  return `il y a ${Math.round(diffMin / 60)}h`;
}

export function HealthPanel() {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ checks: HealthCheck[] }>("/api/admin/health");
      setChecks(data.checks);
    } catch {
      // signed out or server unreachable — leave last-known state visible
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const worst: Status = checks.some((c) => c.status === "error")
    ? "error"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";

  return (
    <CollapsibleBlock
      className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
      header={
        <div className="flex items-center gap-2.5">
          <div className={cn("h-8 w-8 flex items-center justify-center rounded-xl border", STATUS_META[worst].className)}>
            <Activity className="h-4.5 w-4.5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">Surveillance des fonctionnalités</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {loading
                ? "Chargement…"
                : checks.length === 0
                  ? "Premier cycle pas encore passé — réessaie dans une minute."
                  : worst === "ok"
                    ? "Tout fonctionne normalement."
                    : `${checks.filter((c) => c.status !== "ok").length} point(s) à vérifier.`}
            </p>
          </div>
        </div>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {checks.map((c) => {
          const meta = STATUS_META[c.status];
          return (
            <div key={c.checkKey} className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-3.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
                  <h3 className="text-sm font-semibold text-foreground truncate">{c.label}</h3>
                </div>
                <span className={cn("shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border", meta.className)}>
                  {meta.label}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{c.detail}</p>
              <p className="text-[10px] text-muted-foreground/60">Vérifié {relativeTime(c.checkedAt)}</p>
            </div>
          );
        })}
      </div>
    </CollapsibleBlock>
  );
}
