import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Plus, Power, Trash2, Zap, CheckCircle2, ShieldAlert, Sliders, ArrowRight, Play, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { SYMBOLS } from "@/lib/deriv";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { type Strategy } from "@/lib/strategies";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { AutoTraderConfig } from "@/lib/signal-core";
import {
  OFFICIAL_PRESET_STRATEGIES,
  matchesLiveConfig,
  type PresetStrategyDef,
} from "@/lib/preset-strategies";

export const Route = createFileRoute("/strategies")({
  head: () => ({ meta: [{ title: "Stratégies — PLURIEL" }] }),
  component: StrategiesPage,
});

const STORAGE_KEY = "lio23.strategies";

type LivePresetConfigs = Partial<Record<PresetStrategyDef["targetPreset"], AutoTraderConfig | null>>;

const DEFAULTS: Strategy[] = [
  { id: "s1", name: "RSI Mean Reversion", pair: "BTC/USD", indicator: "RSI", buyThreshold: 30, sellThreshold: 70, stopLoss: 2, takeProfit: 4, enabled: true },
  { id: "s2", name: "EMA Trend Follow", pair: "EUR/USD", indicator: "EMA_CROSS", buyThreshold: 50, sellThreshold: 200, stopLoss: 1, takeProfit: 3, enabled: false },
];

function StrategiesPage() {
  const [items, setItems] = useState<Strategy[]>([]);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [liveConfigs, setLiveConfigs] = useState<LivePresetConfigs>({});
  const [liveConfigsLoaded, setLiveConfigsLoaded] = useState(false);
  const [activeCategoryTab, setActiveCategoryTab] = useState<"all" | "verified" | "Multi" | "Boom" | "Crash" | "Scalping" | "Best Day" | "custom">("all");
  const { confirmState, confirm } = useConfirm();

  const refreshLiveConfigs = useCallback(async () => {
    try {
      const data = await api.get<{ presets: Record<string, { savedConfig: AutoTraderConfig | null }> }>("/api/bot");
      const next: LivePresetConfigs = {};
      for (const [preset, status] of Object.entries(data.presets ?? {})) {
        next[preset as PresetStrategyDef["targetPreset"]] = status.savedConfig;
      }
      setLiveConfigs(next);
    } catch {
      // Signed out or server unreachable — badges just fall back to "not
      // active" rather than trusting a stale guess.
    } finally {
      setLiveConfigsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      setItems(raw ? JSON.parse(raw) : DEFAULTS);
    } catch {
      setItems(DEFAULTS);
    }
    refreshLiveConfigs();
  }, []);

  const activeCount = items.filter((s) => s.enabled).length;

  function persist(next: Strategy[]) {
    setItems(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function toggle(id: string) {
    persist(items.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i)));
  }

  async function remove(id: string) {
    const s = items.find((i) => i.id === id);
    const ok = await confirm({
      title: "Supprimer la stratégie ?",
      description: `"${s?.name}" sera définitivement supprimée.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    persist(items.filter((i) => i.id !== id));
    toast.success("Stratégie supprimée");
  }

  function save(s: Strategy) {
    const exists = items.some((i) => i.id === s.id);
    persist(exists ? items.map((i) => (i.id === s.id ? s : i)) : [...items, s]);
    setEditing(null);
    toast.success(`Stratégie ${exists ? "mise à jour" : "créée"}`);
  }

  async function handleApplyStrategy(strat: PresetStrategyDef) {
    setApplyingId(strat.id);
    try {
      const presetKey = strat.targetPreset;
      const localKey = presetKey === "default" ? "lio23.autotrader_config.default" : `lio23.autotrader_config.${presetKey}`;
      const raw = localStorage.getItem(localKey);
      const prev = raw ? JSON.parse(raw) : {};
      const next = { ...prev, ...strat.configOverride };
      
      localStorage.setItem(localKey, JSON.stringify(next));
      if (presetKey === "default") {
        localStorage.setItem("lio23.autotrader_config", JSON.stringify(next));
      }

      // Call API to update server bot state
      const res = await api.post<{ ok?: boolean; error?: string }>("/api/bot", {
        action: "update",
        preset: presetKey,
        config: strat.configOverride,
      });

      if (res.error) {
        toast.error(`Avertissement serveur: ${res.error}`);
      } else {
        toast.success(`Stratégie "${strat.name}" appliquée au preset Auto-Trader !`);
      }
    } catch {
      // The server is the only source of truth for "Active sur Bot" now —
      // a local-only save that silently reported success used to leave the
      // badge lying about whether the bot actually picked up the change.
      toast.error(`Échec — le bot n'a pas reçu le changement (brouillon local conservé).`);
    } finally {
      await refreshLiveConfigs();
      setApplyingId(null);
    }
  }

  const filteredPresetStrategies = useMemo(() => {
    if (activeCategoryTab === "all") return OFFICIAL_PRESET_STRATEGIES;
    if (activeCategoryTab === "verified") return OFFICIAL_PRESET_STRATEGIES.filter((s) => s.verified);
    if (activeCategoryTab === "custom") return [];
    return OFFICIAL_PRESET_STRATEGIES.filter((s) => s.category === activeCategoryTab);
  }, [activeCategoryTab]);

  // Memoize the "Active sur Bot" badge check — was recomputed on every render
  // for every strategy. Now only recomputes when live configs or the filtered
  // list actually change.
  const activeStrategyIds = useMemo(() => {
    const ids = new Set<string>();
    for (const strat of filteredPresetStrategies) {
      const live = liveConfigs[strat.targetPreset];
      if (matchesLiveConfig(strat, live)) ids.add(strat.id);
    }
    return ids;
  }, [filteredPresetStrategies, liveConfigs]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ── TOP HEADER & STRATEGY CREATION TOOLING ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-foreground">Centre de Stratégies</h1>
            <span className="rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-[10px] font-black uppercase text-amber-400">
              Direct Engine
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Créez des règles personnalisées ou appliquez des stratégies pré-optimisées en 1-clic.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          <Button
            onClick={() =>
              setEditing({
                id: `s${Date.now()}`,
                name: "Nouvelle stratégie",
                pair: "BTC/USD",
                targetPreset: "default",
                indicator: "RSI",
                buyThreshold: 30,
                sellThreshold: 70,
                stopLoss: 2,
                takeProfit: 4,
                enabled: true,
              })
            }
            className="flex-1 sm:flex-initial bg-gradient-to-r from-amber-500 to-orange-500 text-black font-extrabold h-10 text-xs px-4 shadow-lg shadow-amber-500/20"
          >
            <Plus className="mr-1.5 h-4 w-4 stroke-[3]" /> Créer une stratégie
          </Button>

          <Link to="/autotrader" className="flex-1 sm:flex-initial">
            <Button variant="outline" className="w-full border-white/10 bg-white/[0.03] text-foreground font-bold h-10 text-xs px-3.5 hover:bg-white/10">
              <Zap className="mr-1.5 h-3.5 w-3.5 text-amber-400 fill-current" /> Auto-Trader
            </Button>
          </Link>
        </div>
      </div>

      {/* ── PRESET CATEGORY TABS (JUST BELOW HEADER) ── */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-white/10 pb-3">
        {(
          [
            { id: "all", label: "Toutes les Stratégies", count: OFFICIAL_PRESET_STRATEGIES.length + items.length, green: false },
            { id: "verified", label: "Vérifiées", count: OFFICIAL_PRESET_STRATEGIES.filter((s) => s.verified).length, green: true },
            { id: "Multi", label: "Preset Multi", count: OFFICIAL_PRESET_STRATEGIES.filter((s) => s.category === "Multi").length, green: false },
            { id: "Boom", label: "Preset Boom", count: OFFICIAL_PRESET_STRATEGIES.filter((s) => s.category === "Boom").length, green: false },
            { id: "Crash", label: "Preset Crash", count: OFFICIAL_PRESET_STRATEGIES.filter((s) => s.category === "Crash").length, green: false },
            { id: "Scalping", label: "Preset Scalping", count: OFFICIAL_PRESET_STRATEGIES.filter((s) => s.category === "Scalping").length, green: false },
            { id: "Best Day", label: "Best Day", count: OFFICIAL_PRESET_STRATEGIES.filter((s) => s.category === "Best Day").length, green: true },
            { id: "custom", label: "Règles Sur-Mesure", count: items.length, green: false },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveCategoryTab(tab.id)}
            title={tab.id === "verified" ? "Symboles et seuils cross-vérifiés contre des trades réels ou un backtest réel sur données historiques" : undefined}
            className={cn(
              "shrink-0 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-wider transition-all border flex items-center gap-2",
              activeCategoryTab === tab.id
                ? tab.green
                  ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-lg shadow-emerald-500/10"
                  : "bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-lg shadow-amber-500/10"
                : tab.green
                  ? "bg-emerald-500/[0.06] text-emerald-400/80 border-emerald-500/20 hover:text-emerald-300 hover:bg-emerald-500/10"
                  : "bg-white/[0.03] text-muted-foreground border-white/10 hover:text-foreground hover:bg-white/[0.08]"
            )}
          >
            {tab.id === "verified" && <CheckCircle2 className="h-3.5 w-3.5" />}
            <span>{tab.label}</span>
            <span className={cn("rounded-full px-1.5 py-0.2 text-[10px] font-mono font-bold", tab.green ? "bg-emerald-500/20" : "bg-white/10")}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── SECTION 1: Preset Strategies Grid ── */}
      {filteredPresetStrategies.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="h-4.5 w-4.5 text-cyan" />
              <h2 className="text-sm md:text-base font-extrabold text-foreground uppercase tracking-wide">
                Modèles Prédéfinis {activeCategoryTab === "verified" ? "· Vérifiées" : activeCategoryTab !== "all" ? `· ${activeCategoryTab}` : ""}
              </h2>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPresetStrategies.map((s) => {
              const isActive = liveConfigsLoaded && activeStrategyIds.has(s.id);
              const isApplying = applyingId === s.id;

              return (
                <div
                  key={s.id}
                  className={cn(
                    "relative flex flex-col justify-between rounded-2xl border bg-black/60 p-4 transition-all duration-200 backdrop-blur-xl overflow-hidden shadow-xl",
                    isActive ? "border-amber-500/60 ring-1 ring-amber-500/30" : s.borderGlow,
                    "hover:border-white/20"
                  )}
                >
                  {/* Background glow */}
                  <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br opacity-20", s.color)} />

                  <div>
                    {/* Top badges */}
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
                          Preset {s.category}
                        </span>
                        {(s.id === "gold-trend-liquidity-sweep" || s.id === "gold-infinite-trailing") && (
                          <span className="rounded-md border border-rose-500/60 bg-rose-500 text-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider animate-pulse shadow-[0_0_12px_rgba(244,63,94,0.6)]">
                            NEW
                          </span>
                        )}
                        {s.verified && (
                          <span
                            className="rounded-md border border-emerald-500/60 bg-emerald-500/20 text-emerald-300 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider flex items-center gap-1"
                            title="Symboles et seuils vérifiés contre les trades réels de production — les autres modèles n'ont pas encore été recoupés"
                          >
                            <CheckCircle2 className="h-3 w-3" /> Vérifié
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase border",
                          isActive
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-white/[0.05] text-amber-300 border-amber-500/30"
                        )}
                      >
                        {isActive ? "✓ Active sur Bot" : s.badge}
                      </span>
                    </div>

                    {/* Title, Target Markets & Tagline */}
                    <h3 className="text-base font-bold text-foreground">{s.name}</h3>
                    <div className="mt-1 text-[11px] font-mono font-semibold text-cyan/90 bg-cyan/10 border border-cyan/20 px-2 py-0.5 rounded-md inline-block">
                      🎯 Marchés : {s.targetMarkets}
                    </div>
                    <p className="text-xs text-muted-foreground/80 mt-1.5 line-clamp-2 min-h-[32px]">
                      {s.tagline}
                    </p>

                    {/* Parameters Grid */}
                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-mono border-t border-b border-white/10 py-3 my-3">
                      <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                        <span className="text-[10px] text-muted-foreground block uppercase font-sans font-semibold">Confiance</span>
                        <strong className="text-foreground font-black text-xs">{s.params.minConfidence}% - {s.params.maxConfidence}%</strong>
                      </div>
                      <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                        <span className="text-[10px] text-muted-foreground block uppercase font-sans font-semibold">Accord TF</span>
                        <strong className="text-cyan font-black text-xs">{s.params.minTfAgreement} / 4 TF</strong>
                      </div>
                      <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                        <span className="text-[10px] text-muted-foreground block uppercase font-sans font-semibold">Durée Contrat</span>
                        <strong className="text-foreground font-black text-xs">{s.params.durationMinutes} min</strong>
                      </div>
                      <div className="bg-white/[0.03] p-2 rounded-lg border border-white/5">
                        <span className="text-[10px] text-muted-foreground block uppercase font-sans font-semibold">Mise / Perte Max</span>
                        <strong className="text-amber-400 font-black text-xs">${s.params.stakeUsd} · Max ${s.params.maxDailyLossUsd}</strong>
                      </div>
                    </div>

                    {!s.verified && s.verifiedNote && (
                      <div className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-2.5 py-2 text-[11px] leading-snug text-amber-200/80">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-[1px] text-amber-400/80" />
                        <span>{s.verifiedNote}</span>
                      </div>
                    )}
                  </div>

                  {/* Bottom CTA button */}
                  <div className="mt-2 pt-2 flex items-center gap-2">
                    <Button
                      onClick={() => handleApplyStrategy(s)}
                      disabled={isApplying}
                      className={cn(
                        "flex-1 font-bold h-10 text-xs shadow-md transition-all",
                        isActive
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                          : "bg-gradient-to-r from-amber-500 to-orange-500 text-black hover:opacity-90"
                      )}
                    >
                      {isApplying ? (
                        <span className="flex items-center gap-1.5">
                          <span className="h-3 w-3 rounded-full border-2 border-black border-t-transparent animate-spin" />
                          Application...
                        </span>
                      ) : isActive ? (
                        <span className="flex items-center gap-1.5">
                          <Check className="h-4 w-4" /> Stratégie Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <Play className="h-3.5 w-3.5 fill-current" /> Appliquer au Preset Auto-Trader
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SECTION 2: Custom Indicator Rules ── */}
      {(activeCategoryTab === "all" || activeCategoryTab === "custom") && (
        <div className="space-y-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm md:text-base font-extrabold text-foreground uppercase tracking-wide">
                Règles d'Indicateurs Sur-Mesure ({items.length})
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Vos filtres techniques personnalisés (RSI, EMA, MACD, Bollinger).
              </p>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="p-8 text-center border border-white/10 rounded-2xl bg-white/[0.02]">
              <p className="text-xs text-muted-foreground font-medium">
                Aucune règle personnalisée pour le moment. Cliquez sur « ➕ Créer une stratégie » ci-dessus pour ajouter votre premier filtre !
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((s) => {
                const presetName = s.targetPreset === "boom" ? "Boom" : s.targetPreset === "crash" ? "Crash" : s.targetPreset === "scalping" ? "Scalping" : s.targetPreset === "crash900" ? "Crash900 V2" : "Multi";

                return (
                  <div key={s.id} className="glass-panel rounded-xl p-4 border border-white/10 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-base font-semibold">{s.name}</h3>
                            <span className="rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-black text-amber-300">
                              Preset {presetName}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {s.pair} · {s.indicator} · SL {s.stopLoss}% / TP {s.takeProfit}%
                          </p>
                        </div>
                        <Switch checked={s.enabled} onCheckedChange={() => toggle(s.id)} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-md bg-muted/40 px-2 py-0.5 font-mono">
                          BUY {s.indicator === "EMA_CROSS" ? `EMA${s.buyThreshold}` : `≤ ${s.buyThreshold}`}
                        </span>
                        <span className="rounded-md bg-muted/40 px-2 py-0.5 font-mono">
                          SELL {s.indicator === "EMA_CROSS" ? `EMA${s.sellThreshold}` : `≥ ${s.sellThreshold}`}
                        </span>
                        <span className="rounded-md bg-muted/40 px-2 py-0.5 font-mono">SL {s.stopLoss}% / TP {s.takeProfit}%</span>
                        <span className={cn("rounded-md px-2 py-0.5", s.enabled ? "bg-emerald-500/10 text-emerald-400 font-bold" : "bg-muted/40 text-muted-foreground")}>
                          <Power className="mr-1 inline h-3 w-3" />
                          {s.enabled ? "Active" : "En pause"}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const targetP = s.targetPreset || "default";
                          const derivId = SYMBOLS.find((x) => x.label === s.pair)?.deriv;
                          const configOverride: Partial<AutoTraderConfig> = {};
                          if (derivId) {
                            configOverride.symbols = [derivId];
                          }
                          handleApplyStrategy({
                            id: s.id,
                            name: s.name,
                            category: presetName as "Multi" | "Boom" | "Crash" | "Scalping",
                            targetPreset: targetP,
                            targetMarkets: s.pair,
                            tagline: `Règle ${s.indicator} sur ${s.pair}`,
                            badge: `Custom ${presetName}`,
                            riskProfile: "Équilibré",
                            color: "from-blue-500/20 to-transparent",
                            borderGlow: "border-blue-500/30",
                            params: {
                              minConfidence: 75,
                              maxConfidence: 95,
                              minTfAgreement: 3,
                              durationMinutes: 15,
                              stakeUsd: 5,
                              maxDailyLossUsd: 15,
                              symbolsCount: 1,
                            },
                            configOverride,
                          });
                        }}
                        className="bg-white/10 hover:bg-white/20 text-xs font-bold text-foreground h-8"
                      >
                        <Play className="mr-1.5 h-3 w-3 fill-current" /> Appliquer à {presetName}
                      </Button>
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="sm" onClick={() => setEditing(s)} className="h-8 px-3 text-xs">
                          Éditer
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => remove(s.id)} className="text-rose-400 hover:text-rose-300 h-8 w-8 p-0 flex items-center justify-center">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {editing && <StrategyEditor strategy={editing} onCancel={() => setEditing(null)} onSave={save} />}
      <ConfirmDialog state={confirmState} />
    </div>
  );
}

function StrategyEditor({
  strategy,
  onSave,
  onCancel,
}: {
  strategy: Strategy;
  onSave: (s: Strategy) => void;
  onCancel: () => void;
}) {
  const [s, setS] = useState(strategy);
  function patch<K extends keyof Strategy>(k: K, v: Strategy[K]) {
    setS({ ...s, [k]: v });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto">
      <div className="glass-panel w-full max-w-2xl md:max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/20 bg-[#0B0F19] p-6 sm:p-8 shadow-2xl relative my-auto">
        <button
          onClick={onCancel}
          type="button"
          className="absolute top-5 right-5 p-2 rounded-xl border border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors z-10"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="mb-6 border-b border-white/10 pb-4">
          <h3 className="text-xl md:text-2xl font-black text-foreground">
            {strategy.name === "Nouvelle stratégie" ? "Créer une nouvelle stratégie" : "Éditer la stratégie"}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure tes règles techniques et choisis le preset Auto-Trader auquel l'associer.
          </p>
        </div>

        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
          <Field label="Nom de la stratégie">
            <input className="input font-semibold" value={s.name} onChange={(e) => patch("name", e.target.value)} placeholder="Ex: RSI Swing EUR/USD" />
          </Field>

          <Field label="Preset Cible Auto-Trader">
            <select
              className="input font-bold border-amber-500/40 text-amber-300 bg-amber-500/10"
              value={s.targetPreset || "default"}
              onChange={(e) => patch("targetPreset", e.target.value as Strategy["targetPreset"])}
            >
              <option value="default">Preset Multi (Forex & Indices)</option>
              <option value="boom">Preset Boom (Indices Boom)</option>
              <option value="crash">Preset Crash (Indices Crash)</option>
              <option value="scalping">Preset Scalping</option>
              <option value="crash900">Preset Crash900 V2</option>
            </select>
          </Field>

          <Field label="Paire / Marché">
            <select className="input font-medium" value={s.pair} onChange={(e) => patch("pair", e.target.value)}>
              {SYMBOLS.map((x) => (
                <option key={x.deriv}>{x.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Indicateur Principal">
            <select className="input font-medium" value={s.indicator} onChange={(e) => patch("indicator", e.target.value as Strategy["indicator"])}>
              <option value="RSI">RSI (Relative Strength Index)</option>
              <option value="MACD">MACD Histogramme</option>
              <option value="EMA_CROSS">Croisement EMA (50 / 200)</option>
              <option value="BB">Bandes de Bollinger</option>
            </select>
          </Field>

          <Field label="BUY (Seuil d'Achat)">
            <input type="number" className="input font-mono font-bold" value={s.buyThreshold} onChange={(e) => patch("buyThreshold", Number(e.target.value))} />
          </Field>

          <Field label="SELL (Seuil de Vente)">
            <input type="number" className="input font-mono font-bold" value={s.sellThreshold} onChange={(e) => patch("sellThreshold", Number(e.target.value))} />
          </Field>

          <Field label="Stop Loss (%)">
            <input type="number" className="input font-mono text-rose-400 font-bold" value={s.stopLoss} onChange={(e) => patch("stopLoss", Number(e.target.value))} />
          </Field>

          <Field label="Take Profit (%)">
            <input type="number" className="input font-mono text-emerald-400 font-bold" value={s.takeProfit} onChange={(e) => patch("takeProfit", Number(e.target.value))} />
          </Field>
        </div>

        <div className="mt-8 pt-4 border-t border-white/10 flex flex-col sm:flex-row sm:justify-end gap-3">
          <Button variant="outline" onClick={onCancel} className="h-11 px-6 text-sm font-semibold">
            Annuler
          </Button>
          <Button
            onClick={() => onSave(s)}
            className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-extrabold h-11 px-6 text-sm shadow-lg shadow-amber-500/20"
          >
            Enregistrer la Stratégie
          </Button>
        </div>
      </div>
      <style>{`.input { width:100%; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.5); padding: 12px 16px; font-size: 14px; color: var(--foreground); transition: all 0.2s; } .input:focus { outline:none; border-color: rgba(245,158,11,0.6); box-shadow: 0 0 12px rgba(245,158,11,0.2); }`}</style>
    </div>,
    document.body
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}