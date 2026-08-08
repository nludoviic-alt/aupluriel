import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Bot,
  CheckCircle2,
  Clock3,
  Eye,
  Loader2,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Target,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { relayPush } from "@/lib/notify-push";
import {
  getExistingPushSubscription,
  isIosNonSafari,
  isIosNonStandalone,
  isPushSupported,
  subscribeToPush,
} from "@/lib/push";

export const Route = createFileRoute("/opportunities")({
  head: () => ({ meta: [{ title: "Opportunités — Au Pluriel" }] }),
  component: OpportunitiesPage,
});

type Decision = "take" | "wait" | "avoid";
type Preset = "default" | "boom" | "crash" | "scalping" | "liquidity";

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

const DECISION_COPY: Record<Decision, { label: string; icon: typeof Target; soft: string; badge: string }> = {
  take: {
    label: "Prendre",
    icon: CheckCircle2,
    soft: "bg-up/10 text-up border-up/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]",
    badge: "bg-up text-white",
  },
  wait: {
    label: "Attendre",
    icon: Clock3,
    soft: "bg-amber-500/10 text-amber-300 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.2)]",
    badge: "bg-amber-500 text-white",
  },
  avoid: {
    label: "Éviter",
    icon: ShieldAlert,
    soft: "bg-down/10 text-down border-down/30 shadow-[0_0_12px_rgba(239,68,68,0.2)]",
    badge: "bg-down text-white",
  },
};

const PRESET_STYLE: Record<Preset, string> = {
  default: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  boom: "border-orange-500/30 bg-orange-500/10 text-orange-300",
  crash: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  scalping: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  liquidity: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300",
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
  const [now, setNow] = useState(Date.now());
  const [hasPushSub, setHasPushSub] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    getExistingPushSubscription().then((sub) => setHasPushSub(!!sub)).catch(() => {});
  }, []);

  async function handleSubscribePush() {
    setPushLoading(true);
    try {
      if (isIosNonSafari()) {
        toast.error("Sur iOS, veuillez utiliser Safari pour activer les notifications Push.");
        return;
      }
      if (isIosNonStandalone()) {
        toast.info("Sur iPhone/iPad: Touchez Partager ➔ 'Sur l'écran d'accueil' pour recevoir les notifications Push réelles avec l'écran verrouillé.", { duration: 8000 });
      }
      await subscribeToPush();
      setHasPushSub(true);
      toast.success("🔔 Notifications Push Mobile activées avec succès !");
      relayPush("⚡ Radar d'Opportunités Actif", "Vous recevrez désormais les signaux d'opportunités en direct sur votre téléphone.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur activation push");
    } finally {
      setPushLoading(false);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<OpportunitiesResponse>("/api/opportunities");
      setData(res);

      // Trigger real OS mobile push notification when a high confidence trade is ready
      if (res.summary.take > 0 && res.opportunities.length > 0) {
        const top = res.opportunities.find((o) => o.decision === "take");
        if (top) {
          relayPush(
            `⚡ Signal Opportunité : ${top.label}`,
            `Signal prêt (${top.directionLabel}) · Confiance ${Math.round(top.confidence)}% · Preset ${top.presetLabel}`,
            `/manual-trader?symbol=${top.symbol}&direction=${top.direction}&preset=${top.preset}&take=1`
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const refreshId = window.setInterval(() => void load(), 30_000);
    const clockId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearInterval(refreshId);
      window.clearInterval(clockId);
    };
  }, []);

  const scanAgeSeconds = data ? Math.max(0, Math.floor((now - data.generatedAt) / 1_000)) : null;

  const visible = useMemo(() => {
    const rows = data?.opportunities ?? [];
    return filter === "all" ? rows : rows.filter((o) => o.decision === filter);
  }, [data?.opportunities, filter]);

  const topTake = data?.opportunities.find((o) => o.decision === "take");

  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-4 sm:px-6 lg:px-8">
      {/* ── Header Cockpit ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-up/30 bg-up/10 text-up shadow-[0_0_20px_rgba(16,185,129,0.15)]">
            <Target className="h-5.5 w-5.5 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-up opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-up"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">Radar d'Opportunités</h1>
              <span className="rounded-full border border-up/30 bg-up/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-up">
                En direct
              </span>
            </div>
            <p className="text-xs font-semibold text-muted-foreground/80 mt-0.5 hidden md:block">
              Analyse algorithmique continue · Détection de signaux optimaux & analyse de risques multi-marchés.
            </p>
            {scanAgeSeconds !== null && (
              <p className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/60">
                <Clock3 className="h-3 w-3" /> Analyse mise à jour il y a {scanAgeSeconds}s · actualisation auto toutes les 30s
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            onClick={handleSubscribePush}
            disabled={pushLoading}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs font-bold transition-all shadow-sm",
              hasPushSub
                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                : "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
            )}
          >
            <Bell className={cn("h-4 w-4", hasPushSub ? "text-emerald-400" : "text-amber-400 animate-bounce")} />
            <span>{hasPushSub ? "Push Mobile Actif" : "Notifications Mobile"}</span>
          </button>

          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-xs font-bold text-muted-foreground transition-all hover:bg-white/[0.08] hover:text-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <RefreshCw className="h-4 w-4 text-primary" />}
            <span>Actualiser le Radar</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-down/30 bg-down/10 px-4 py-3 text-xs font-bold text-down">
          ⚠️ {error}
        </div>
      )}

      {/* ── Summary KPI Strip ── */}
      <div className="grid gap-3.5 grid-cols-2 md:grid-cols-4">
        <SummaryCard label="À prendre (Signal prêt)" value={data?.summary.take ?? 0} tone="emerald" />
        <SummaryCard label="À attendre (En formation)" value={data?.summary.wait ?? 0} tone="amber" />
        <SummaryCard label="À éviter (Risqué)" value={data?.summary.avoid ?? 0} tone="rose" />
        <SummaryCard label="Presets surveillés" value={data?.summary.presets ?? 0} tone="cyan" />
      </div>

      {/* ── Hero Feature: Meilleure Opportunité ── */}
      {topTake && (
        <section className="relative overflow-hidden rounded-3xl border border-up/40 bg-gradient-to-br from-up/10 via-neutral-950 to-black p-6 md:p-7 shadow-2xl backdrop-blur-xl">
          <div className="absolute -right-16 -top-16 h-60 w-60 rounded-full bg-up/20 blur-3xl pointer-events-none" />

          <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider border shadow-sm", DECISION_COPY.take.soft)}>
                  <CheckCircle2 className="h-4 w-4" /> Meilleure Opportunité
                </span>
                <span className={cn("rounded-full border px-3 py-1 text-xs font-black uppercase tracking-wider", PRESET_STYLE[topTake.preset])}>
                  {topTake.presetLabel}
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground">
                {topTake.label} · <span className={cn(topTake.direction === "CALL" ? "text-up" : "text-down")}>{topTake.directionLabel}</span>
              </h2>

              <div className="flex flex-wrap items-center gap-3 text-xs font-bold text-muted-foreground">
                <span>Confiance : <strong className="text-foreground font-mono">{Math.round(topTake.confidence)}%</strong></span>
                <span>•</span>
                <span>Accord : <strong className="text-foreground font-mono">{topTake.agreement}/4 TF</strong></span>
                <span>•</span>
                <span>Risque : <strong className="text-up uppercase">{riskLabel(topTake.risk)}</strong></span>
                <span>•</span>
                <span>Durée : <strong className="text-foreground">{topTake.durationMinutes} min</strong></span>
              </div>

              {topTake.reasons?.[0] && (
                <p className="text-xs font-medium text-neutral-300 leading-relaxed max-w-2xl">
                  💡 {topTake.reasons[0]}
                </p>
              )}
            </div>

            <div className="shrink-0 flex flex-col gap-2.5 pt-3 lg:pt-0 border-t border-white/10 lg:border-t-0 lg:border-l lg:border-white/10 lg:pl-6">
              <ActionStrip item={topTake} />
            </div>
          </div>
        </section>
      )}

      {/* ── Filter Tabs ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 border-b border-white/10">
        {(["all", "take", "wait", "avoid"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "shrink-0 rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-wider transition-all",
              filter === f
                ? "border-primary/50 bg-primary/20 text-primary shadow-[0_0_12px_rgba(139,92,246,0.2)]"
                : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
            )}
          >
            {f === "all" ? "Toutes les Opportunités" : DECISION_COPY[f].label}
          </button>
        ))}
      </div>

      {/* ── Opportunity Grid ── */}
      {loading && !data ? (
        <div className="rounded-2xl border border-white/10 bg-neutral-950/60 p-16 text-center text-sm font-semibold text-muted-foreground backdrop-blur-md">
          <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-primary" />
          Analyse des marchés et calcul des opportunités en cours…
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visible.map((item) => (
            <OpportunityCard key={item.id} item={item} />
          ))}
          {visible.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-neutral-950/60 p-12 text-center text-xs font-semibold text-muted-foreground lg:col-span-2">
              Aucun résultat pour ce filtre actuellement.
            </div>
          )}
        </div>
      )}

      {/* ── Avoid List ── */}
      {!!data?.avoidList.length && (
        <section className="rounded-2xl border border-down/30 bg-neutral-950/60 p-5 space-y-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3">
            <AlertTriangle className="h-5 w-5 text-down" />
            <h2 className="text-sm font-black uppercase tracking-wider text-foreground">Marchés sous Surveillance / À Éviter</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.avoidList.slice(0, 12).map((item) => (
              <div key={`${item.preset}:${item.symbol}`} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-black text-foreground">{item.label}</span>
                  <span className={cn("shrink-0 rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider", PRESET_STYLE[item.preset])}>
                    {item.presetLabel}
                  </span>
                </div>
                <p className="text-[11px] font-medium leading-relaxed text-down">⚠ {item.reason}</p>
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground/80 pt-1 border-t border-white/5">
                  <span>{item.stats.trades} trades</span>
                  <span>P&L {money(item.stats.pnl)}</span>
                  <span>PF {pf(item.stats.profitFactor)}</span>
                </div>
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
    emerald: "text-up border-up/30 bg-up/5 shadow-[0_0_15px_rgba(16,185,129,0.1)]",
    amber: "text-amber-300 border-amber-500/30 bg-amber-500/5 shadow-[0_0_15px_rgba(245,158,11,0.1)]",
    rose: "text-down border-down/30 bg-down/5 shadow-[0_0_15px_rgba(239,68,68,0.1)]",
    cyan: "text-cyan border-cyan/30 bg-cyan/5 shadow-[0_0_15px_rgba(6,182,212,0.1)]",
  }[tone];

  return (
    <div className={cn("rounded-2xl border p-4 backdrop-blur-md transition-all duration-300", cls)}>
      <div className="text-2xl sm:text-3xl font-black font-mono-tabular tracking-tight">{value}</div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-wider text-muted-foreground/80">{label}</div>
    </div>
  );
}

function OpportunityCard({ item }: { item: OpportunityItem }) {
  const copy = DECISION_COPY[item.decision];
  const Icon = copy.icon;
  return (
    <article className="rounded-2xl border border-white/10 bg-neutral-950/60 p-5 space-y-4 shadow-xl backdrop-blur-xl hover:border-white/20 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider shadow-sm", copy.soft)}>
              <Icon className="h-3.5 w-3.5" />
              {copy.label}
            </span>
            <span className={cn("rounded-xl border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider", PRESET_STYLE[item.preset])}>
              {item.presetLabel}
            </span>
          </div>

          <h3 className="truncate text-lg font-black tracking-tight text-foreground">{item.label}</h3>
          <p className={cn("text-xs font-black uppercase tracking-wide", item.direction === "CALL" ? "text-up" : "text-down")}>
            {item.directionLabel}
          </p>
        </div>

        <div className="shrink-0 text-right space-y-0.5">
          <div className="text-2xl font-black font-mono text-foreground">{Math.round(item.confidence)}%</div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{item.agreement}/4 TF</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Metric label="Risque" value={riskLabel(item.risk)} />
        <Metric label="P&L Hist." value={money(item.stats.pnl)} />
        <Metric label="PF" value={pf(item.stats.profitFactor)} />
      </div>

      <div className="space-y-1.5 pt-1">
        {item.reasons.slice(0, 3).map((reason) => (
          <div key={reason} className="flex items-start gap-2 text-xs font-medium text-muted-foreground/90">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span className="leading-relaxed">{reason}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-muted-foreground/80 pt-2 border-t border-white/5">
        <span>{item.instrument === "binary" ? "Binaire" : "Multiplier"}</span>
        <span>•</span>
        <span>{item.durationMinutes} min</span>
        {item.takeProfitUsd !== null && (
          <>
            <span>•</span>
            <span className="text-up">TP {money(item.takeProfitUsd)}</span>
          </>
        )}
        {item.stopLossUsd !== null && (
          <>
            <span>•</span>
            <span className="text-down">SL -${item.stopLossUsd.toFixed(2)}</span>
          </>
        )}
      </div>

      <ActionStrip item={item} />
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
      <div className="mt-0.5 truncate font-extrabold text-xs text-foreground font-mono">{value}</div>
    </div>
  );
}

function riskLabel(risk: OpportunityItem["risk"]) {
  if (risk === "faible") return "faible";
  if (risk === "modere") return "modéré";
  return "élevé";
}

function ActionStrip({ item, className }: { item: OpportunityItem; className?: string }) {
  const isTake = item.decision === "take";

  return (
    <div className={cn("flex flex-wrap items-center gap-2 pt-2", className)}>
      <Link
        to="/manual-trader"
        search={{
          symbol: item.symbol,
          direction: item.direction || undefined,
          preset: item.preset,
          take: "1",
        }}
        className={cn(
          "inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-6 text-xs font-black uppercase tracking-wider transition-all shadow-md",
          isTake
            ? "border-up/50 bg-up text-black hover:bg-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.4)]"
            : "border-white/10 bg-white/[0.04] text-foreground hover:bg-white/[0.08]",
        )}
      >
        <Zap className="h-4 w-4 fill-current" />
        {isTake ? "Prendre ce Trade" : "Ouvrir en Prise Directe"}
      </Link>

      <Link
        to="/signals"
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-muted-foreground transition-all hover:bg-white/[0.08] hover:text-foreground"
      >
        <Eye className="h-3.5 w-3.5 text-primary" />
        Observer
      </Link>
    </div>
  );
}
