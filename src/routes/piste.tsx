import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, Eye, EyeOff, Filter, FlaskConical, Layers, Search, ShieldCheck, Sparkles, TrendingUp, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { AutoTraderConfig } from "@/lib/signal-core";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/piste")({
  head: () => ({ meta: [{ title: "Laboratoire Piste — PLURIEL" }] }),
  component: PistePage,
});

type PresetKey = "default" | "boom" | "boom900" | "vol75" | "rb100" | "vol50" | "crash" | "crash500" | "scalping" | "liquidity" | "gold" | "crash900" | "boomv2" | "scalpingv2" | "liquidityv2" | "goldv2";

type BotStatus = {
  enabled: boolean;
  running: boolean;
  todayCount: number;
  todayPnl: number;
  allTimeStats?: { count: number; profitFactor: number; expectancy: number; winRate?: number };
  savedConfig: AutoTraderConfig | null;
};

interface Track {
  key: PresetKey;
  name: string;
  category: "boom" | "crash" | "synthetic" | "gold" | "multi";
  market: string;
  badge: string;
  thesis: string;
  engine: string;
  validation: string;
  color: string;
  borderColor: string;
  bgTone: string;
}

const TRACKS: Track[] = [
  { key: "vol75", name: "Volatility 75 (1s)", category: "synthetic", market: "1HZ75V (1s)", badge: "📈 Volatility 75 (1s)", thesis: "M15 Trend → M5 Regime → M1 Pullback/Breakout à haute fréquence.", engine: "Vol75 Multi-Timeframe", validation: "Démo · Score min. 74/100 · ATR 1s.", color: "text-lime-300", borderColor: "border-lime-500/30", bgTone: "bg-lime-500/10" },
  { key: "rb100", name: "Range Break 100", category: "synthetic", market: "RB100", badge: "↔ Range Break 100", thesis: "Rebond de bornes 25/75 puis cassure contrôlée après compression.", engine: "RB100 Dual-Engine", validation: "Démo · Exclusion zone médiane.", color: "text-amber-300", borderColor: "border-amber-500/30", bgTone: "bg-amber-500/10" },
  { key: "vol50", name: "Volatility 50 (1s)", category: "synthetic", market: "1HZ50V (1s)", badge: "📊 Volatility 50 (1s)", thesis: "M15 Contexte → M5 Tendance → M1 Pullback (0.40 ATR) & Breakout Retest.", engine: "Vol50 Dual Engine V1", validation: "Démo · Score min. 76/100 · Anti-Chop.", color: "text-emerald-300", borderColor: "border-emerald-500/30", bgTone: "bg-emerald-500/10" },
  { key: "boom", name: "Boom500", category: "boom", market: "BOOM500", badge: "⚡ Boom500", thesis: "Spike Hunter M1/M5 et Drift Scalper avec filtres de volatilité.", engine: "Boom500 Core", validation: "Démo · Rejet Spike décalé.", color: "text-rose-400", borderColor: "border-rose-500/30", bgTone: "bg-rose-500/10" },
  { key: "boom900", name: "Boom900", category: "boom", market: "BOOM900", badge: "⚡ Boom900", thesis: "Validation isolée sur l'indice Boom900 avec filtres stricts.", engine: "Boom900 Isolated", validation: "Démo · Statistiques isolées.", color: "text-sky-300", borderColor: "border-sky-500/30", bgTone: "bg-sky-500/10" },
  { key: "boomv2", name: "Boom V2", category: "boom", market: "BOOM500", badge: "⚡ Boom V2", thesis: "Algorithme Boom V2 avec ajustement dynamique de mise.", engine: "Boom V2 Controlled", validation: "Démo · Exposition bridée.", color: "text-sky-300", borderColor: "border-sky-500/30", bgTone: "bg-sky-500/10" },
  { key: "crash", name: "Crash900", category: "crash", market: "CRASH900", badge: "📉 Crash900", thesis: "Détection des baisses brutales et suivi du drift de récupération.", engine: "Crash900 Principal", validation: "Démo · Risque contrôlé.", color: "text-purple-400", borderColor: "border-purple-500/30", bgTone: "bg-purple-500/10" },
  { key: "crash500", name: "Crash500", category: "crash", market: "CRASH500", badge: "📉 Crash500", thesis: "Moteur Crash500 indépendant avec gestion des réintégrations.", engine: "Crash500 Engine", validation: "Démo · Statistiques séparées.", color: "text-violet-300", borderColor: "border-violet-500/30", bgTone: "bg-violet-500/10" },
  { key: "crash900", name: "Crash900 V2", category: "crash", market: "CRASH900", badge: "📉 Crash900 V2", thesis: "Moteur Joker optimisé sur données récentes Crash900.", engine: "Crash900 Data-Optimized", validation: "Démo · Validation données.", color: "text-orange-400", borderColor: "border-orange-500/30", bgTone: "bg-orange-500/10" },
  { key: "scalping", name: "Scalping BOOM", category: "boom", market: "BOOM500", badge: "🎯 Scalping", thesis: "Micro-scalping price-action M1/M5 à rotation rapide.", engine: "Scalping Engine", validation: "Démo · Rotation M1/M5.", color: "text-cyan-400", borderColor: "border-cyan-500/30", bgTone: "bg-cyan-500/10" },
  { key: "scalpingv2", name: "Scalping V2", category: "boom", market: "BOOM500", badge: "🎯 Scalping V2", thesis: "Scalping V2 combiné au Spike Hunter.", engine: "Scalping V2 Hunter", validation: "Démo · Chasseur de Spikes.", color: "text-cyan-300", borderColor: "border-cyan-500/30", bgTone: "bg-cyan-500/10" },
  { key: "default", name: "Multi-Marchés", category: "multi", market: "Forex · Métaux · Crypto", badge: "📊 Multi", thesis: "Panier diversifié sur Forex Majors, XAU/USD et BTC/USD.", engine: "Multi-Asset Core", validation: "Paramètres gelés jusqu'à 50 clôtures.", color: "text-amber-400", borderColor: "border-amber-500/30", bgTone: "bg-amber-500/10" },
  { key: "liquidity", name: "Gold Liquidity Sweep", category: "gold", market: "XAU/USD", badge: "🥇 Liquidity Sweep", thesis: "Sweep de liquidité de session et réintégration M15.", engine: "OANDA Liquidity Engine", validation: "Démo OANDA XAU/USD.", color: "text-fuchsia-300", borderColor: "border-fuchsia-500/30", bgTone: "bg-fuchsia-500/10" },
  { key: "liquidityv2", name: "Liquidity V2", category: "gold", market: "XAU/USD", badge: "💧 Liquidity V2", thesis: "Sweep de liquidité V2 sur les sommets/creux asiatiques.", engine: "Liquidity V2 Asian Sweep", validation: "Démo XAU/USD.", color: "text-fuchsia-300", borderColor: "border-fuchsia-500/30", bgTone: "bg-fuchsia-500/10" },
  { key: "gold", name: "Gold Trend Pullback", category: "gold", market: "XAU/USD", badge: "🥇 Trend Pullback", thesis: "Suivi de tendance Or avec entrée sur repli EMA20/EMA50.", engine: "OANDA Trend Engine", validation: "Démo OANDA XAU/USD.", color: "text-lime-300", borderColor: "border-lime-500/30", bgTone: "bg-lime-500/10" },
  { key: "goldv2", name: "Gold Breakout", category: "gold", market: "XAU/USD", badge: "🥇 Gold Breakout", thesis: "Cassure de range de session Or avec retest de zone.", engine: "OANDA Breakout Engine", validation: "Démo OANDA XAU/USD.", color: "text-amber-300", borderColor: "border-amber-500/30", bgTone: "bg-amber-500/10" },
];

function metric(value: number | undefined, fallback = "—") {
  return Number.isFinite(value) ? value!.toFixed(2) : fallback;
}

function PistePage() {
  const { user, loading: authLoading } = useAuth();
  const [tab, setTab] = useState<"cards" | "matrix">("cards");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statuses, setStatuses] = useState<Partial<Record<PresetKey, BotStatus>>>({});
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<PresetKey | null>(null);
  const [visible, setVisible] = useState<PresetKey[]>([]);

  useEffect(() => {
    if (!authLoading && !user?.is_admin) window.location.replace("/");
  }, [authLoading, user?.is_admin]);

  const refresh = async () => {
    try {
      const data = await api.get<{ presets: Record<string, BotStatus>; visiblePresets?: PresetKey[] }>("/api/bot");
      const next: Partial<Record<PresetKey, BotStatus>> = {};
      for (const track of TRACKS) next[track.key] = data.presets?.[track.key];
      setStatuses(next);
      setVisible(data.visiblePresets ?? []);
    } catch {
      toast.error("Impossible de charger les données de la Piste.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.is_admin) void refresh();
  }, [user?.is_admin]);

  const toggleTrack = async (key: PresetKey) => {
    setChanging(key);
    try {
      const next = visible.includes(key) ? visible.filter((p) => p !== key) : [...visible, key];
      if (!next.length) throw new Error("Conserve au moins un preset affiché.");
      await api.patch("/api/admin/visible-presets", { visiblePresets: next });
      toast.success(
        visible.includes(key)
          ? `Preset ${TRACKS.find((t) => t.key === key)?.name} retiré des écrans`
          : `Preset ${TRACKS.find((t) => t.key === key)?.name} ajouté à Auto-Trader et Portfolio`
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La modification n’a pas pu être appliquée.");
    } finally {
      setChanging(null);
    }
  };

  const filteredTracks = useMemo(() => {
    return TRACKS.filter((track) => {
      if (categoryFilter === "visible" && !visible.includes(track.key)) return false;
      if (categoryFilter === "hidden" && visible.includes(track.key)) return false;
      if (categoryFilter !== "all" && categoryFilter !== "visible" && categoryFilter !== "hidden" && track.category !== categoryFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        return (
          track.name.toLowerCase().includes(q) ||
          track.market.toLowerCase().includes(q) ||
          track.thesis.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [categoryFilter, searchQuery, visible]);

  const totalTrades = useMemo(
    () => TRACKS.reduce((sum, track) => sum + (statuses[track.key]?.allTimeStats?.count ?? 0), 0),
    [statuses]
  );

  const activeCount = useMemo(
    () => TRACKS.filter((t) => statuses[t.key]?.running).length,
    [statuses]
  );

  if (authLoading || !user?.is_admin) return null;

  return (
    <main className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6">
      {/* ── HEADER & LABORATORY HERO BANNER ── */}
      <header className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/[0.08] via-black/40 to-black/80 p-6 backdrop-blur-xl shadow-2xl space-y-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                <FlaskConical className="h-5 w-5" />
              </span>
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground">
                Piste de Validation & Laboratoire
              </h1>
            </div>
            <p className="max-w-3xl text-xs md:text-sm text-muted-foreground leading-relaxed">
              Catalogue de recherche et de validation des 15 presets d'algorithmes. Activez ou retirez n'importe quelle stratégie des écrans d'exécution Auto-Trader et de suivi Portfolio.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <Link
              to="/autotrader"
              className="inline-flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-xs font-bold text-amber-200 transition-all hover:bg-amber-500/25 hover:border-amber-500/60 shadow-lg"
            >
              <Zap className="h-4 w-4 text-amber-400" /> Ouvrir l'Auto-Trader →
            </Link>
          </div>
        </div>

        {/* STATS TICKER STRIP */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-white/10 text-xs font-mono">
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-muted-foreground">Presets sur Écrans</span>
            <div className="text-lg font-black text-amber-400 mt-0.5">{visible.length} / {TRACKS.length}</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-muted-foreground">Bots Actifs Live</span>
            <div className="text-lg font-black text-emerald-400 mt-0.5">{loading ? "…" : activeCount} en cours</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-muted-foreground">Trades en Validation</span>
            <div className="text-lg font-black text-foreground mt-0.5">{loading ? "…" : totalTrades} trades</div>
          </div>
          <div className="rounded-xl border border-white/5 bg-black/40 p-3">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-muted-foreground">Règle de Passage</span>
            <div className="text-xs font-sans font-bold text-amber-300 mt-1">20 exp. · 50 déc. · 100 conf.</div>
          </div>
        </div>
      </header>

      {/* ── CONTROLS: CATEGORY FILTERS, SEARCH & VIEW TOGGLE ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between rounded-2xl border border-white/10 bg-black/40 p-3 backdrop-blur-md">
        {/* Left: Category pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button
            onClick={() => setCategoryFilter("all")}
            className={cn(
              "rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer",
              categoryFilter === "all" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            Tous ({TRACKS.length})
          </button>
          <button
            onClick={() => setCategoryFilter("visible")}
            className={cn(
              "rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer flex items-center gap-1.5",
              categoryFilter === "visible" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            <Eye className="h-3.5 w-3.5" /> Sur les Écrans ({visible.length})
          </button>
          <button
            onClick={() => setCategoryFilter("synthetic")}
            className={cn(
              "rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer",
              categoryFilter === "synthetic" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            Synthétiques
          </button>
          <button
            onClick={() => setCategoryFilter("boom")}
            className={cn(
              "rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer",
              categoryFilter === "boom" ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            Boom
          </button>
          <button
            onClick={() => setCategoryFilter("crash")}
            className={cn(
              "rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer",
              categoryFilter === "crash" ? "bg-purple-500/20 text-purple-300 border border-purple-500/40" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            Crash
          </button>
          <button
            onClick={() => setCategoryFilter("gold")}
            className={cn(
              "rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer",
              categoryFilter === "gold" ? "bg-lime-500/20 text-lime-300 border border-lime-500/40" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            Or (XAU)
          </button>
          <button
            onClick={() => setCategoryFilter("multi")}
            className={cn(
              "rounded-lg px-3 py-1.5 font-bold transition-all cursor-pointer",
              categoryFilter === "multi" ? "bg-amber-500/20 text-amber-300 border border-amber-500/40" : "text-muted-foreground hover:text-foreground hover:bg-white/5"
            )}
          >
            Multi
          </button>
        </div>

        {/* Right: Search & View Mode Switch */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 lg:w-60">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher un preset..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full rounded-xl border border-white/10 bg-black/60 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-amber-500/40 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/60 p-1">
            <button
              onClick={() => setTab("cards")}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
                tab === "cards" ? "bg-amber-500/20 text-amber-300 shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Layers className="h-3.5 w-3.5" /> Cartes
            </button>
            <button
              onClick={() => setTab("matrix")}
              className={cn(
                "rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5",
                tab === "matrix" ? "bg-amber-500/20 text-amber-300 shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <TrendingUp className="h-3.5 w-3.5" /> Matrice
            </button>
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT: CARDS VIEW VS MATRIX VIEW ── */}
      {tab === "cards" ? (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredTracks.map((track) => {
            const status = statuses[track.key];
            const isVisibleOnScreens = visible.includes(track.key);
            const pnl = status?.todayPnl ?? 0;
            const isRunning = !!status?.running;

            return (
              <article
                key={track.key}
                className={cn(
                  "rounded-2xl border p-5 flex flex-col justify-between gap-4 transition-all duration-200 bg-black/30 backdrop-blur-md relative overflow-hidden group hover:border-white/20",
                  track.borderColor,
                  isVisibleOnScreens && "ring-1 shadow-[0_0_20px_rgba(245,158,11,0.08)]"
                )}
              >
                {/* TOP HEADER: BADGE & SCREEN VISIBILITY INDICATOR */}
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-lg border shadow-sm", track.borderColor, track.bgTone, track.color)}>
                    {track.badge}
                  </span>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
                        isVisibleOnScreens
                          ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                          : "bg-white/5 text-muted-foreground border-white/10"
                      )}
                    >
                      {isVisibleOnScreens ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                      {isVisibleOnScreens ? "Écrans" : "Masqué"}
                    </span>
                  </div>
                </div>

                {/* MID BODY: THESIS & ENGINE INFO */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-foreground">{track.name}</span>
                    <span className="text-[11px] font-mono text-muted-foreground uppercase">{track.market}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {track.thesis}
                  </p>
                </div>

                {/* STATS SUMMARY BOX */}
                <div className="rounded-xl border border-white/5 bg-black/40 p-3 grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-[10px] font-sans text-muted-foreground uppercase font-bold">P&L Jour : </span>
                    <span className={cn("font-bold block text-sm mt-0.5", pnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
                      {pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] font-sans text-muted-foreground uppercase font-bold">Statut Bot : </span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={cn("h-2 w-2 rounded-full", isRunning ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" : "bg-white/20")} />
                      <span className="text-[11px] font-bold text-foreground">{isRunning ? "Actif" : "Prêt"}</span>
                    </div>
                  </div>
                </div>

                {/* ENGINE TAG & VALIDATION REQUIREMENT */}
                <div className="flex items-center justify-between text-[11px] text-amber-200/90 pt-1">
                  <span className="flex items-center gap-1 font-semibold">
                    <ShieldCheck className="h-3.5 w-3.5 text-amber-400" />
                    {track.validation}
                  </span>
                  <span className="font-mono text-muted-foreground text-[10px]">{track.engine}</span>
                </div>

                {/* ACTION BUTTON: TOGGLE VISIBILITY ON AUTO-TRADER & PORTFOLIO */}
                <Button
                  className={cn(
                    "w-full rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer",
                    isVisibleOnScreens
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 hover:border-emerald-500/60"
                      : "bg-amber-500 text-black hover:bg-amber-400 font-black"
                  )}
                  variant={isVisibleOnScreens ? "outline" : "default"}
                  disabled={changing === track.key}
                  onClick={() => void toggleTrack(track.key)}
                >
                  {changing === track.key ? (
                    "Mise à jour…"
                  ) : isVisibleOnScreens ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Sur vos Écrans (Cliquer pour Retirer)
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-black" /> Ajouter à l'Auto-Trader & Portfolio
                    </span>
                  )}
                </Button>
              </article>
            );
          })}
        </section>
      ) : (
        /* ── MATRIX VIEW TABLE ── */
        <section className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-md shadow-2xl">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-white/[0.04] text-[10px] uppercase tracking-wider text-muted-foreground font-sans font-bold">
                <tr>
                  <th className="p-4">Preset & Thématique</th>
                  <th className="p-4">Marché</th>
                  <th className="p-4">Affichage Écrans</th>
                  <th className="p-4">État Engine</th>
                  <th className="p-4">Trades Clôturés</th>
                  <th className="p-4 text-right">P&L Jour</th>
                  <th className="p-4 text-right">Profit Factor</th>
                  <th className="p-4 text-right">Espérance</th>
                  <th className="p-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredTracks.map((track) => {
                  const s = statuses[track.key];
                  const stats = s?.allTimeStats;
                  const isVisibleOnScreens = visible.includes(track.key);

                  return (
                    <tr key={track.key} className="hover:bg-white/[0.02] transition-colors">
                      <td className="p-4 font-sans font-bold">
                        <span className={cn("text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded border mr-2", track.borderColor, track.bgTone, track.color)}>
                          {track.badge}
                        </span>
                        <span className="text-foreground">{track.name}</span>
                      </td>
                      <td className="p-4 text-muted-foreground font-bold">{track.market}</td>
                      <td className="p-4">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border",
                            isVisibleOnScreens
                              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                              : "bg-white/5 text-muted-foreground border-white/10"
                          )}
                        >
                          {isVisibleOnScreens ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                          {isVisibleOnScreens ? "Actif sur Écrans" : "Masqué"}
                        </span>
                      </td>
                      <td className="p-4">
                        {s?.running ? (
                          <span className="inline-flex items-center gap-1.5 text-emerald-300 font-bold">
                            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" /> Actif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-muted-foreground font-semibold">
                            <CircleDashed className="h-3.5 w-3.5" /> En attente
                          </span>
                        )}
                      </td>
                      <td className="p-4 font-bold text-foreground">{stats?.count ?? 0}</td>
                      <td className={`p-4 text-right font-black ${(s?.todayPnl ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {metric(s?.todayPnl, "0.00")}$
                      </td>
                      <td className="p-4 text-right text-foreground font-bold">{metric(stats?.profitFactor)}</td>
                      <td className="p-4 text-right text-foreground font-bold">{metric(stats?.expectancy)}$</td>
                      <td className="p-4 text-center">
                        <Button
                          size="sm"
                          variant={isVisibleOnScreens ? "outline" : "default"}
                          disabled={changing === track.key}
                          onClick={() => void toggleTrack(track.key)}
                          className={cn(
                            "h-7 text-[11px] font-bold cursor-pointer",
                            isVisibleOnScreens ? "border-emerald-500/30 text-emerald-300" : "bg-amber-500 text-black font-black"
                          )}
                        >
                          {isVisibleOnScreens ? "Retirer" : "+ Ajouter"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-xs text-amber-200">
            <TrendingUp className="h-4 w-4 shrink-0 text-amber-400" />
            <span>
              <strong>Règle de validation en laboratoire :</strong> Une série courte positive ne suffit pas. Aucune augmentation de mise ne doit être effectuée avant le premier seuil de 50 clôtures puis la confirmation définitive à 100 trades.
            </span>
          </div>
        </section>
      )}
    </main>
  );
}
