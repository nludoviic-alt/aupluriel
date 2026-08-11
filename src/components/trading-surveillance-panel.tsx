import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Database,
  PauseCircle,
  RefreshCw,
} from "lucide-react";
import { CollapsibleBlock } from "@/components/collapsible-section";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Preset = "default" | "boom" | "crash" | "scalping";

interface BotStatus {
  userId: number;
  username: string;
  preset: Preset;
  enabled: boolean;
  running: boolean;
  pausedUntil: number | null;
  lastScanAt: number | null;
  hasToken: boolean;
  mode: "demo" | "live" | null;
  lastError: string | null;
  autoBacktestEnabled: boolean;
  openTrades: number;
  outOfConfigOpenTrades: { symbol: string; confidence: number; tfAgreement: number }[];
  config: {
    symbols: string[];
    excludedSymbols: string[];
    minConfidence: number;
    maxConfidence: number;
    minTfAgreement: number;
    maxOpenPositions: number;
  } | null;
}

interface OptimizerSegment {
  name: string;
  preset: string;
  rule: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
  expectancy: number;
  profitFactor: number | null;
  reliable: boolean;
}

interface SurveillanceData {
  statuses: BotStatus[];
  autoBacktest: {
    checked: boolean;
    favorable?: boolean;
    winRate?: number;
    breakEvenWinRate?: number;
    checkedAt?: number;
  };
  strategies: {
    total: number;
    enabled: number;
    serverOverlayEnabled: boolean;
    autoPromotionEnabled: boolean;
  };
}

interface OptimizerAudit {
  activeSegments: OptimizerSegment[];
  blockedSegments: { preset: string; label: string; reason: string }[];
}

const PRESET_LABELS: Record<Preset, string> = {
  default: "Multi",
  boom: "Boom500",
  crash: "Crash900",
  scalping: "Scalping",
};

function relativeTime(time: number | null): string {
  if (!time) return "aucun scan";
  const diffMinutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (diffMinutes < 1) return "à l’instant";
  if (diffMinutes < 60) return `il y a ${diffMinutes} min`;
  return `il y a ${Math.round(diffMinutes / 60)} h`;
}

function entryState(status: BotStatus) {
  if (status.lastError) return { label: "Erreur", className: "text-rose-300 border-rose-500/25 bg-rose-500/10" };
  if (!status.enabled) return { label: "Arrêté", className: "text-neutral-300 border-white/10 bg-white/[0.04]" };
  if (!status.running) return { label: "À relancer", className: "text-rose-300 border-rose-500/25 bg-rose-500/10" };
  if (status.pausedUntil) return { label: "Surveillance seulement", className: "text-amber-300 border-amber-500/25 bg-amber-500/10" };
  return { label: "Entrées autorisées", className: "text-emerald-300 border-emerald-500/25 bg-emerald-500/10" };
}

export function TradingSurveillancePanel() {
  const [data, setData] = useState<SurveillanceData | null>(null);
  const [optimizer, setOptimizer] = useState<OptimizerAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRuntime = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setData(await api.get<SurveillanceData>("/api/admin/bot"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadOptimizer = useCallback(async () => {
    try {
      const result = await api.get<{ optimizerAudit?: OptimizerAudit }>("/api/admin/stats");
      setOptimizer(result.optimizerAudit ?? null);
    } catch {
      // Keep the last successful audit visible if this slower aggregate call fails.
    }
  }, []);

  useEffect(() => {
    void loadRuntime();
    void loadOptimizer();
    const runtimeId = setInterval(() => void loadRuntime(), 20_000);
    const optimizerId = setInterval(() => void loadOptimizer(), 120_000);
    return () => {
      clearInterval(runtimeId);
      clearInterval(optimizerId);
    };
  }, [loadOptimizer, loadRuntime]);

  const alerts = useMemo(() => {
    if (!data) return 0;
    return data.statuses.filter((s) =>
      s.lastError || (s.enabled && !s.running) || s.outOfConfigOpenTrades.length > 0
    ).length;
  }, [data]);

  return (
    <CollapsibleBlock
      defaultOpen
      className="glass-panel rounded-2xl border border-emerald-500/10 bg-[#0A0A0A]/50 p-5 backdrop-blur-xl"
      header={
        <div className="flex items-start justify-between gap-3 pr-2">
          <div className="flex items-center gap-2.5">
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-xl border",
              alerts > 0
                ? "border-amber-500/20 bg-amber-500/10 text-amber-300"
                : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300",
            )}>
              <Bot className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Surveillance trading</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {loading ? "Chargement…" : alerts > 0 ? `${alerts} point(s) à vérifier.` : "Moteurs, filtres et automatisations à jour."}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadRuntime(true)}
            aria-label="Actualiser la surveillance trading"
            title="Actualiser"
            className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground sm:flex"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </button>
        </div>
      }
    >
      <div className="mt-4 space-y-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-white/[0.07] text-[10px] font-bold uppercase text-muted-foreground">
              <tr>
                <th className="pb-2 pr-4">Compte / preset</th>
                <th className="pb-2 pr-4">État des entrées</th>
                <th className="pb-2 pr-4">Configuration active</th>
                <th className="pb-2 pr-4">Positions</th>
                <th className="pb-2">Dernier scan</th>
              </tr>
            </thead>
            <tbody>
              {(data?.statuses ?? []).map((status) => {
                const state = entryState(status);
                return (
                  <tr key={`${status.userId}-${status.preset}`} className="border-b border-white/[0.05] align-top last:border-0">
                    <td className="py-3 pr-4">
                      <p className="font-bold text-foreground">{status.username}</p>
                      <p className="mt-0.5 text-muted-foreground">{PRESET_LABELS[status.preset]} · {status.mode ?? "mode inconnu"}</p>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={cn("inline-flex rounded-md border px-2 py-1 text-[10px] font-black uppercase", state.className)}>
                        {state.label}
                      </span>
                      {status.lastError && <p className="mt-1.5 max-w-52 text-[10px] text-rose-300">{status.lastError}</p>}
                    </td>
                    <td className="py-3 pr-4">
                      {status.config ? (
                        <>
                          <p className="max-w-80 font-semibold text-foreground">{status.config.symbols.join(", ") || "Tous les symboles autorisés"}</p>
                          <p className="mt-1 text-muted-foreground">
                            Confiance {status.config.minConfidence}-{status.config.maxConfidence}% · TF ≥{status.config.minTfAgreement}
                          </p>
                        </>
                      ) : <span className="text-muted-foreground">Non configuré</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <p className="font-mono font-bold text-foreground">{status.openTrades} ouverte(s)</p>
                      {status.outOfConfigOpenTrades.length > 0 && (
                        <p className="mt-1 text-[10px] font-semibold text-amber-300">
                          {status.outOfConfigOpenTrades.length} hors filtre: {status.outOfConfigOpenTrades.map((t) => t.symbol).join(", ")}
                        </p>
                      )}
                    </td>
                    <td className="py-3">
                      <p className="text-foreground">{relativeTime(status.lastScanAt)}</p>
                      {status.pausedUntil && (
                        <p className="mt-1 text-[10px] text-amber-300">
                          Pause jusqu’à {new Date(status.pausedUntil).toLocaleTimeString("fr-CA", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && data?.statuses.length === 0 && (
            <p className="py-5 text-center text-xs text-muted-foreground">Aucun moteur serveur configuré.</p>
          )}
        </div>

        <div className="grid gap-4 border-t border-white/[0.07] pt-5 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {data?.autoBacktest.checked && data.autoBacktest.favorable
                ? <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                : <PauseCircle className="h-4 w-4 text-amber-300" />}
              <h3 className="text-sm font-bold text-foreground">Backtest automatique Multi</h3>
            </div>
            {data?.autoBacktest.checked ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Verdict <strong className={data.autoBacktest.favorable ? "text-emerald-300" : "text-amber-300"}>
                  {data.autoBacktest.favorable ? "favorable" : "défavorable"}
                </strong> · réussite {((data.autoBacktest.winRate ?? 0) * 100).toFixed(1)}% · seuil rentable {((data.autoBacktest.breakEvenWinRate ?? 0) * 100).toFixed(1)}%.
                Ce verdict ne commande pas Boom ni Crash.
                {!data.autoBacktest.favorable
                  && (data.autoBacktest.winRate ?? 0) >= (data.autoBacktest.breakEvenWinRate ?? 1)
                  && " Le seuil est dépassé, mais la validation exige au moins 20 trades."}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">Aucun calcul disponible.</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-sky-300" />
              <h3 className="text-sm font-bold text-foreground">Stratégies serveur</h3>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {data?.strategies.total ?? 0} sauvegardée(s), {data?.strategies.enabled ?? 0} active(s).
              Les stratégies sont synchronisées, mais elles ne pilotent pas encore le moteur serveur et aucun segment positif n’est promu automatiquement.
            </p>
          </div>
        </div>

        {optimizer && (
          <div className="space-y-4 border-t border-white/[0.07] pt-5">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-emerald-300" />
              <h3 className="text-sm font-bold text-foreground">Segments optimisés actifs</h3>
            </div>
            <div className="grid gap-x-6 lg:grid-cols-3">
              {optimizer.activeSegments.map((segment) => (
                <div key={segment.preset} className="border-b border-white/[0.06] py-3 lg:border-b-0 lg:border-r lg:pr-6 lg:last:border-r-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-foreground">{segment.name}</p>
                    <span className={cn("text-[10px] font-bold uppercase", segment.reliable ? "text-emerald-300" : "text-amber-300")}>
                      {segment.reliable ? "échantillon validé" : "à confirmer"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{segment.rule}</p>
                  <p className="mt-2 font-mono text-xs text-foreground">
                    {segment.trades} trades · {segment.winRate.toFixed(1)}% ·
                    <span className={segment.pnl >= 0 ? " text-emerald-300" : " text-rose-300"}>
                      {" "}{segment.pnl >= 0 ? "+" : ""}{segment.pnl.toFixed(2)} $
                    </span> · PF {segment.profitFactor === null ? "∞" : segment.profitFactor.toFixed(2)}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex items-start gap-2 border-t border-amber-500/10 pt-3">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
              <div>
                <p className="text-[10px] font-black uppercase text-amber-300">Filtres maintenus bloqués</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-100/70">
                  {optimizer.blockedSegments.map((segment) => segment.label).join(" · ")}
                </p>
              </div>
            </div>
          </div>
        )}

        {data?.statuses.some((s) => s.outOfConfigOpenTrades.length > 0) && (
          <div className="flex items-start gap-2 border-t border-amber-500/10 pt-4 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Une position hors nouvelle configuration reste gérée jusqu’à sa fermeture; elle ne signifie pas que le filtre autorise une nouvelle entrée.</p>
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}
