import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface AutoBacktestState {
  checked: boolean;
  favorable?: boolean;
  winRate?: number;
  breakEvenWinRate?: number;
  checkedAt?: number;
}

function relativeTime(ms: number): string {
  const diffMin = Math.round((Date.now() - ms) / 60_000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `il y a ${diffMin} min`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `il y a ${hours}h`;
  return `il y a ${Math.round(hours / 24)}j`;
}

/** Status readout for the periodic auto-backtest verdict — used in Paramètres
 * (next to the toggle) and Auto-Trader (next to the server bot control), so
 * "Backtest automatique" isn't a silent on/off with no feedback. */
export function AutoBacktestStatus({ className }: { className?: string }) {
  const [state, setState] = useState<AutoBacktestState | null>(null);

  useEffect(() => {
    let alive = true;
    function load() {
      api.get<AutoBacktestState>("/api/auto-backtest").then((s) => { if (alive) setState(s); }).catch(() => {});
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!state || !state.checked) {
    return (
      <div className={cn("flex items-center gap-2 text-[11px] text-muted-foreground", className)}>
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse shrink-0" />
        En attente du premier calcul — ~15 min après le démarrage du serveur.
      </div>
    );
  }

  return (
    <div className={cn(
      "flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-[11px] md:text-xs",
      state.favorable ? "border-up/25 bg-up/5" : "border-down/25 bg-down/5",
      className,
    )}>
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full shrink-0", state.favorable ? "bg-up animate-pulse" : "bg-down")} />
        <span className={cn("font-bold", state.favorable ? "text-up" : "text-down")}>
          {state.favorable ? "Favorable" : "Défavorable"}
        </span>
        <span className="text-muted-foreground font-mono-tabular">
          {((state.winRate ?? 0) * 100).toFixed(1)}%
          <span className="opacity-60"> vs seuil {((state.breakEvenWinRate ?? 0) * 100).toFixed(1)}%</span>
        </span>
      </div>
      <span className="text-muted-foreground/70 shrink-0">{relativeTime(state.checkedAt ?? Date.now())}</span>
    </div>
  );
}
