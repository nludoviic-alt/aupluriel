import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, FlaskConical, ShieldCheck, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { AutoTraderConfig } from "@/lib/signal-core";

export const Route = createFileRoute("/piste")({
  head: () => ({ meta: [{ title: "Piste — PLURIEL" }] }),
  component: PistePage,
});

type PresetKey = "boomv2" | "scalpingv2" | "liquidityv2" | "goldv2";
type BotStatus = { enabled: boolean; running: boolean; todayCount: number; todayPnl: number; allTimeStats?: { count: number; profitFactor: number; expectancy: number }; savedConfig: AutoTraderConfig | null };

const TRACKS: Array<{ key: PresetKey; name: string; market: string; thesis: string; engine: string; validation: string; color: string }> = [
  { key: "boomv2", name: "Boom V2", market: "BOOM500", thesis: "Confluence 4/4 et exposition contrôlée sur le seul Boom à suivre.", engine: "Moteur confluence + filtre horaire", validation: "PF ≥ 1,20 et espérance positive à 50 puis 100 trades.", color: "border-sky-500/30 bg-sky-500/[0.05]" },
  { key: "scalpingv2", name: "Scalping V2", market: "BOOM500", thesis: "Accumulation M1/M5 avant spike, au lieu du pullback structurel V1.", engine: "Spike Hunter", validation: "Démo, 1 position ; comparer séparément au Scalping V1.", color: "border-cyan-500/30 bg-cyan-500/[0.05]" },
  { key: "liquidityv2", name: "Liquidity V2", market: "XAU/USD", thesis: "Balayage d’un extrême M15, réintégration et retournement RSI.", engine: "Liquidity sweep / reintegration", validation: "Au moins 50 trades avant tout changement de mise.", color: "border-fuchsia-500/30 bg-fuchsia-500/[0.05]" },
  { key: "goldv2", name: "Gold V2", market: "XAU/USD", thesis: "Cassure de range Londres/New York, pullback sur le niveau, puis reprise.", engine: "Session breakout + pullback", validation: "Au moins 50 trades, news filter actif et aucune hausse de mise.", color: "border-amber-500/30 bg-amber-500/[0.05]" },
];

function metric(value: number | undefined, fallback = "—") { return Number.isFinite(value) ? value!.toFixed(2) : fallback; }

function PistePage() {
  const [tab, setTab] = useState<"new" | "validation">("new");
  const [statuses, setStatuses] = useState<Partial<Record<PresetKey, BotStatus>>>({});
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState<PresetKey | null>(null);

  const refresh = async () => {
    try {
      const data = await api.get<{ presets: Record<string, BotStatus> }>("/api/bot");
      const next: Partial<Record<PresetKey, BotStatus>> = {};
      for (const track of TRACKS) next[track.key] = data.presets?.[track.key];
      setStatuses(next);
    } catch { toast.error("Impossible de charger les données de validation."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const toggleTrack = async (key: PresetKey) => {
    setChanging(key);
    try {
      const running = statuses[key]?.running;
      const result = await api.post<{ error?: string }>("/api/bot", { action: running ? "stop" : "start", preset: key, config: {} });
      if (result.error) throw new Error(result.error);
      toast.success(running ? "Validation arrêtée" : "Validation démarrée en démo");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "La modification n’a pas pu être appliquée.");
    } finally { setChanging(null); }
  };

  const totalTrades = useMemo(() => TRACKS.reduce((sum, track) => sum + (statuses[track.key]?.allTimeStats?.count ?? 0), 0), [statuses]);

  return <main className="mx-auto max-w-[1400px] space-y-6 p-4 md:p-6">
    <header className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-amber-400" /><h1 className="text-2xl font-black tracking-tight">Piste</h1></div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Laboratoire des hypothèses : chaque V2 possède son moteur, sa configuration et son journal. Aucun résultat n’est mélangé à la version historique.</p>
      </div>
      <Link to="/autotrader" className="text-sm font-semibold text-amber-300 hover:text-amber-200">Ouvrir l’Auto-Trader →</Link>
    </header>

    <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 text-sm text-emerald-100">
      <p className="font-black">Expérience active : Multi M2</p>
      <p className="mt-1 text-emerald-100/75">Démo · mise 5 $ · confiance minimale 75 % · accord 4 TF · paramètres gelés jusqu’à 50 clôtures. Boom, Crash et Or restent en validation hors exécution automatique.</p>
    </div>

    <div className="flex w-fit rounded-xl border border-white/10 bg-white/[0.03] p-1">
      <button onClick={() => setTab("new")} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "new" ? "bg-amber-500/15 text-amber-300" : "text-muted-foreground"}`}>Nouveaux presets</button>
      <button onClick={() => setTab("validation")} className={`rounded-lg px-4 py-2 text-sm font-bold ${tab === "validation" ? "bg-amber-500/15 text-amber-300" : "text-muted-foreground"}`}>Validation</button>
    </div>

    {tab === "new" ? <section className="grid gap-4 md:grid-cols-2">
      {TRACKS.map((track) => {
        const status = statuses[track.key];
        return <article key={track.key} className={`rounded-2xl border p-5 ${track.color}`}>
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-black">{track.name}</h2><p className="mt-0.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">{track.market} · Démo seulement</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${status?.running ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-muted-foreground"}`}>{status?.running ? "ACTIF" : "PRÊT À VALIDER"}</span></div>
          <p className="mt-4 text-sm leading-6 text-foreground/90">{track.thesis}</p>
          <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-3 text-xs"><span className="font-bold text-foreground">Moteur : </span><span className="text-muted-foreground">{track.engine}</span></div>
          <div className="mt-3 flex items-center gap-2 text-xs text-amber-200"><ShieldCheck className="h-3.5 w-3.5" />{track.validation}</div>
          <Button className="mt-4 w-full" variant={status?.running ? "outline" : "default"} disabled={changing === track.key} onClick={() => void toggleTrack(track.key)}>{changing === track.key ? "Mise à jour…" : status?.running ? "Arrêter la validation" : "Démarrer en démo"}</Button>
        </article>;
      })}
    </section> : <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase text-muted-foreground">Trades V2 cumulés</p><p className="mt-1 text-2xl font-black">{loading ? "…" : totalTrades}</p></div><div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase text-muted-foreground">Règle de passage</p><p className="mt-1 text-sm font-bold">20 → exploration · 50 → décision · 100 → confirmation</p></div><div className="rounded-xl border border-white/10 bg-white/[0.03] p-4"><p className="text-xs uppercase text-muted-foreground">Protection</p><p className="mt-1 text-sm font-bold text-emerald-300">Démo forcée · exposition limitée</p></div></div>
      <div className="overflow-hidden rounded-2xl border border-white/10"><table className="w-full text-left text-sm"><thead className="bg-white/[0.04] text-xs uppercase text-muted-foreground"><tr><th className="p-4">Preset</th><th className="p-4">État</th><th className="p-4">Trades</th><th className="p-4">P&L</th><th className="p-4">PF</th><th className="p-4">Espérance</th></tr></thead><tbody>{TRACKS.map((track) => { const s = statuses[track.key]; const stats = s?.allTimeStats; return <tr key={track.key} className="border-t border-white/8"><td className="p-4 font-bold">{track.name}</td><td className="p-4">{s?.running ? <span className="inline-flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-4 w-4" />Actif</span> : <span className="inline-flex items-center gap-1 text-muted-foreground"><CircleDashed className="h-4 w-4" />En attente</span>}</td><td className="p-4">{stats?.count ?? 0}</td><td className={`p-4 font-mono ${(s?.todayPnl ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{metric(s?.todayPnl, "0.00")}$</td><td className="p-4 font-mono">{metric(stats?.profitFactor)}</td><td className="p-4 font-mono">{metric(stats?.expectancy)}$</td></tr>; })}</tbody></table></div>
      <div className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-sm text-amber-100"><TrendingUp className="h-4 w-4 shrink-0" />Une bonne série courte ne suffit pas : aucune augmentation de mise ne doit être faite avant le seuil 50 puis la confirmation à 100 trades.</div>
    </section>}
  </main>;
}
