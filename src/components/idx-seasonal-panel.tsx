// Panneau "Index Seasonal" (piste A) pour la page /piste — preset autonome,
// hors ServerBotEngine, donc son propre endpoint /api/idx-seasonal.
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface IdxTrade {
  id: string;
  symbol: string;
  direction: string;
  stake: number;
  payout: number;
  status: string;
  profit: number;
  durationMinutes: number;
  time: number;
  closedAt: number | null;
  exitReason: string | null;
}
interface IdxSeasonalData {
  enabled: boolean;
  updatedAt: number | null;
  killSwitch: { active: boolean; pf: number; n: number } | null;
  stats: {
    count: number; open: number; wins: number; losses: number;
    winRate: number; profitFactor: number; expectancy: number; pnl: number;
  };
  trades: IdxTrade[];
}

const fmtPf = (pf: number) => (pf === Infinity ? "∞" : pf.toFixed(2));
const fmtUsd = (n: number) => `${n >= 0 ? "+" : ""}$${n.toFixed(2)}`;
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function IdxSeasonalPanel() {
  const [data, setData] = useState<IdxSeasonalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(() => {
    api.get<IdxSeasonalData>("/api/idx-seasonal")
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    if (!data) return;
    setToggling(true);
    try {
      await api.post("/api/idx-seasonal", { enabled: !data.enabled });
      toast.success(!data.enabled ? "Index Seasonal armé" : "Index Seasonal désarmé");
      load();
    } catch {
      toast.error("Échec du changement d'état");
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-3xl border border-sky-500/20 bg-sky-500/[0.04] p-6">
        <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
      </section>
    );
  }
  if (!data) return null;

  const s = data.stats;
  const tiles = [
    { label: "Trades clôturés", value: String(s.count), sub: s.open ? `${s.open} ouvert(s)` : undefined },
    { label: "Win rate", value: s.count ? `${(s.winRate * 100).toFixed(0)}%` : "—", sub: s.count ? `${s.wins}V / ${s.losses}D` : undefined },
    { label: "Profit Factor", value: s.count ? fmtPf(s.profitFactor) : "—", sub: "cible > 1.30" },
    { label: "P&L cumulé", value: s.count ? fmtUsd(s.pnl) : "—", sub: s.count ? `${fmtUsd(s.expectancy)}/trade` : undefined, pos: s.pnl >= 0 },
  ];

  return (
    <section className="rounded-3xl border border-sky-500/20 bg-gradient-to-br from-sky-500/[0.06] via-black/40 to-black/70 p-5 md:p-6 space-y-5 backdrop-blur-xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-300">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-black text-foreground">Index Seasonal <span className="text-sky-400/70 text-xs font-semibold">piste A</span></h2>
            <p className="text-[11px] text-muted-foreground">
              Effet lundi haussier · 10 indices actions · binaire CALL, hold séance · démo
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wide",
              data.enabled
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                : "bg-white/5 text-muted-foreground border border-white/10",
            )}
          >
            {data.enabled ? "Armé" : "Inactif"}
          </span>
          <button
            onClick={toggle}
            disabled={toggling}
            className={cn(
              "rounded-xl px-4 py-2 text-xs font-bold transition-all border",
              data.enabled
                ? "border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                : "border-emerald-500/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
            )}
          >
            {toggling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : data.enabled ? "Désarmer" : "Armer"}
          </button>
        </div>
      </div>

      {data.killSwitch?.active && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
          🛑 Kill-switch actif — PF 28 j {fmtPf(data.killSwitch.pf)} &lt; 1.00 sur {data.killSwitch.n} trades. Entrées suspendues automatiquement.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-white/10 bg-black/30 p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</div>
            <div className={cn("mt-1 text-xl font-black", t.pos === false && "text-rose-300", t.pos === true && "text-emerald-300", t.pos === undefined && "text-foreground")}>
              {t.value}
            </div>
            {t.sub && <div className="text-[10px] text-muted-foreground mt-0.5">{t.sub}</div>}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="text-muted-foreground">
            <tr className="border-b border-white/10">
              <th className="px-2 py-1.5 font-semibold">Ouvert</th>
              <th className="px-2 py-1.5 font-semibold">Indice</th>
              <th className="px-2 py-1.5 font-semibold">Durée</th>
              <th className="px-2 py-1.5 font-semibold">Statut</th>
              <th className="px-2 py-1.5 font-semibold text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {data.trades.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-4 text-center text-muted-foreground">Aucun trade — première salve lundi.</td></tr>
            )}
            {data.trades.slice(0, 40).map((t) => (
              <tr key={t.id} className="border-b border-white/5">
                <td className="px-2 py-1.5 text-muted-foreground">{fmtTime(t.time)}</td>
                <td className="px-2 py-1.5 font-mono">{t.symbol.replace("OTC_", "")}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{t.durationMinutes} min</td>
                <td className="px-2 py-1.5">
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    t.status === "won" && "bg-emerald-500/15 text-emerald-300",
                    t.status === "lost" && "bg-rose-500/15 text-rose-300",
                    t.status === "open" && "bg-sky-500/15 text-sky-300",
                    !["won", "lost", "open"].includes(t.status) && "bg-white/5 text-muted-foreground",
                  )}>
                    {t.status}
                  </span>
                </td>
                <td className={cn("px-2 py-1.5 text-right font-semibold", t.profit > 0 ? "text-emerald-300" : t.profit < 0 ? "text-rose-300" : "text-muted-foreground")}>
                  {t.status === "open" ? "—" : fmtUsd(t.profit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
