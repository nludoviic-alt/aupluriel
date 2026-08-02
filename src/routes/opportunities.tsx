import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Clock3,
  Eye,
  Loader2,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/opportunities")({
  head: () => ({ meta: [{ title: "Opportunités — Au Pluriel" }] }),
  component: OpportunitiesPage,
});

type Decision = "take" | "wait" | "avoid";
type Preset = "default" | "boom" | "crash" | "scalping";

interface OpportunityItem {
  id: string;
  preset: Preset;
  presetLabel: string;
  symbol: string;
  label: string;
  market: string;
  decision: Decision;
  direction: "CALL" | "PUT" | null;
  directionLabel: string;
  confidence: number;
  agreement: number;
  risk: "faible" | "modere" | "eleve";
  mode: "manual" | "demo" | "auto";
  instrument: "binary" | "multiplier";
  durationMinutes: number;
  takeProfitUsd: number | null;
  stopLossUsd: number | null;
  reasons: string[];
  blockers: string[];
  stats: {
    trades: number;
    winRate: number | null;
    pnl: number;
    expectancy: number | null;
    profitFactor: number | null;
  };
  updatedAt: number;
}

interface AvoidItem {
  preset: Preset;
  presetLabel: string;
  symbol: string;
  label: string;
  reason: string;
  stats: OpportunityItem["stats"];
}

interface OpportunitiesResponse {
  generatedAt: number;
  opportunities: OpportunityItem[];
  avoidList: AvoidItem[];
  summary: {
    take: number;
    wait: number;
    avoid: number;
    presets: number;
  };
}

const DECISION_COPY: Record<Decision, { label: string; icon: typeof Target; soft: string }> = {
  take: {
    label: "Prendre",
    icon: CheckCircle2,
    soft: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  },
  wait: {
    label: "Attendre",
    icon: Clock3,
    soft: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  },
  avoid: {
    label: "Éviter",
    icon: ShieldAlert,
    soft: "bg-rose-500/10 text-rose-300 border-rose-500/25",
  },
};

const PRESET_STYLE: Record<Preset, string> = {
  default: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  boom: "border-orange-500/25 bg-orange-500/10 text-orange-300",
  crash: "border-cyan-500/25 bg-cyan-500/10 text-cyan-300",
  scalping: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
};

function money(v: number) {
  return `${v >= 0 ? "+" : ""}$${v.toFixed(2)}`;
}

function pf(v: number | null) {
  return v === null ? "∞" : v.toFixed(2);
}

function OpportunitiesPage() {
  const [data, setData] = useState<OpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Decision>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<OpportunitiesResponse>("/api/opportunities"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(() => {
    const rows = data?.opportunities ?? [];
    return filter === "all" ? rows : rows.filter((o) => o.decision === filter);
  }, [data?.opportunities, filter]);

  const topTake = data?.opportunities.find((o) => o.decision === "take");

  return (
    <div className="p-4 md:p-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            <Target className="h-3.5 w-3.5 text-emerald-300" />
            Copilote Deriv
          </div>
          <h1 className="mt-3 text-xl md:text-2xl font-black tracking-tight">Opportunités</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Analyse les marchés, explique le risque, puis propose une action claire.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualiser
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="À prendre" value={data?.summary.take ?? 0} tone="emerald" />
        <SummaryCard label="À attendre" value={data?.summary.wait ?? 0} tone="amber" />
        <SummaryCard label="À éviter" value={data?.summary.avoid ?? 0} tone="rose" />
        <SummaryCard label="Presets surveillés" value={data?.summary.presets ?? 0} tone="cyan" />
      </div>

      {topTake && (
        <section className="glass-panel rounded-xl border border-emerald-500/20 p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-md border px-2 py-1 text-xs font-bold", DECISION_COPY.take.soft)}>Meilleure opportunité</span>
                <span className={cn("rounded-md border px-2 py-1 text-xs font-bold", PRESET_STYLE[topTake.preset])}>{topTake.presetLabel}</span>
              </div>
              <h2 className="mt-3 text-lg md:text-xl font-black tracking-tight">
                {topTake.label} · {topTake.directionLabel}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Confiance {Math.round(topTake.confidence)}% · Accord {topTake.agreement}/4 · Risque {riskLabel(topTake.risk)}
              </p>
            </div>
            <ActionStrip item={topTake} />
          </div>
        </section>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", "take", "wait", "avoid"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors",
              filter === f ? "border-primary/40 bg-primary/15 text-primary" : "border-border/50 bg-card/30 text-muted-foreground hover:text-foreground",
            )}
          >
            {f === "all" ? "Tout" : DECISION_COPY[f].label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="glass-panel rounded-xl py-16 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />
          Analyse des opportunités en cours…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((item) => (
            <OpportunityCard key={item.id} item={item} />
          ))}
          {visible.length === 0 && (
            <div className="glass-panel rounded-xl py-12 text-center text-sm text-muted-foreground lg:col-span-2">
              Rien dans ce filtre pour le moment.
            </div>
          )}
        </div>
      )}

      {!!data?.avoidList.length && (
        <section className="glass-panel rounded-xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-300" />
            <h2 className="text-base font-bold">Marchés à éviter</h2>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {data.avoidList.slice(0, 12).map((item) => (
              <div key={`${item.preset}:${item.symbol}`} className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold">{item.label}</span>
                  <span className={cn("shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold", PRESET_STYLE[item.preset])}>{item.presetLabel}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.stats.trades} trades · P&L {money(item.stats.pnl)} · PF {pf(item.stats.profitFactor)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" | "cyan" }) {
  const cls = {
    emerald: "text-emerald-300 border-emerald-500/15",
    amber: "text-amber-300 border-amber-500/15",
    rose: "text-rose-300 border-rose-500/15",
    cyan: "text-cyan-300 border-cyan-500/15",
  }[tone];
  return (
    <div className={cn("glass-panel rounded-xl border p-4", cls)}>
      <div className="text-2xl font-black">{value}</div>
      <div className="mt-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function OpportunityCard({ item }: { item: OpportunityItem }) {
  const copy = DECISION_COPY[item.decision];
  const Icon = copy.icon;
  return (
    <article className="glass-panel rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold", copy.soft)}>
              <Icon className="h-3.5 w-3.5" />
              {copy.label}
            </span>
            <span className={cn("rounded-md border px-2 py-1 text-xs font-bold", PRESET_STYLE[item.preset])}>{item.presetLabel}</span>
          </div>
          <h3 className="mt-3 truncate text-lg font-black tracking-tight">{item.label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{item.directionLabel}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-black">{Math.round(item.confidence)}%</div>
          <div className="text-xs text-muted-foreground">{item.agreement}/4 TF</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <Metric label="Risque" value={riskLabel(item.risk)} />
        <Metric label="P&L hist." value={money(item.stats.pnl)} />
        <Metric label="PF" value={pf(item.stats.profitFactor)} />
      </div>

      <div className="mt-4 space-y-1.5">
        {item.reasons.slice(0, 3).map((reason) => (
          <div key={reason} className="flex gap-2 text-sm text-muted-foreground">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
            <span>{reason}</span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{item.instrument === "binary" ? "Binaire" : "Multiplier"}</span>
        <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
        <span>{item.durationMinutes} min</span>
        {item.takeProfitUsd !== null && (
          <>
            <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
            <span>TP {money(item.takeProfitUsd)}</span>
          </>
        )}
        {item.stopLossUsd !== null && (
          <>
            <span className="h-1 w-1 rounded-full bg-muted-foreground/50" />
            <span>SL -${item.stopLossUsd.toFixed(2)}</span>
          </>
        )}
      </div>

      <ActionStrip item={item} className="mt-4" />
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-bold text-foreground">{value}</div>
    </div>
  );
}

function riskLabel(risk: OpportunityItem["risk"]) {
  if (risk === "faible") return "faible";
  if (risk === "modere") return "modéré";
  return "élevé";
}

function ActionStrip({ item, className }: { item: OpportunityItem; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <Link
        to="/signals"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <Eye className="h-3.5 w-3.5" />
        Observer
      </Link>
      <a
        href="https://mt5-demo-web.deriv.com/terminal"
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
        Manuel
      </a>
      <Link
        to="/autotrader"
        className={cn(
          "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors",
          item.decision === "take"
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15"
            : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground",
        )}
      >
        <Bot className="h-3.5 w-3.5" />
        Auto
      </Link>
      <Link
        to="/autotrader"
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:text-foreground"
        title="Réglages du preset"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
