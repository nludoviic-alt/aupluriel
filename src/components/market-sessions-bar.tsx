import { useEffect, useState } from "react";
import { Clock, Flame, Globe, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { SESSION_HOURS, type TradingSession } from "@/lib/signal-core";

const SESSIONS_ORDER: TradingSession[] = ["asia", "london", "newyork", "sydney"];

const SESSION_META: Record<TradingSession, { flag: string; city: string; liquidity: string; color: string; bgActive: string; borderActive: string; textActive: string }> = {
  asia: {
    flag: "🇯🇵",
    city: "Tokyo / Asie",
    liquidity: "Modérée",
    color: "cyan",
    bgActive: "bg-cyan-500/15",
    borderActive: "border-cyan-400/40",
    textActive: "text-cyan-300",
  },
  london: {
    flag: "🇬🇧",
    city: "Londres (Europe)",
    liquidity: "Très Élevée",
    color: "emerald",
    bgActive: "bg-emerald-500/15",
    borderActive: "border-emerald-400/40",
    textActive: "text-emerald-300",
  },
  newyork: {
    flag: "🇺🇸",
    city: "New York (US)",
    liquidity: "Maximale",
    color: "amber",
    bgActive: "bg-amber-500/15",
    borderActive: "border-amber-400/40",
    textActive: "text-amber-300",
  },
  sydney: {
    flag: "🇦🇺",
    city: "Sydney (Pacifique)",
    liquidity: "Calme",
    color: "purple",
    bgActive: "bg-purple-500/15",
    borderActive: "border-purple-400/40",
    textActive: "text-purple-300",
  },
};

function getSessionStatus(session: TradingSession, nowUtcMins: number) {
  const { open, close } = SESSION_HOURS[session];
  const start = open * 60;
  const end = close * 60;

  const isActive = open > close
    ? nowUtcMins >= start || nowUtcMins < end
    : nowUtcMins >= start && nowUtcMins < end;

  // Minutes until open / close
  let minsToOpen = 0;
  let minsToClose = 0;

  if (isActive) {
    minsToClose = end > nowUtcMins ? end - nowUtcMins : (24 * 60 - nowUtcMins) + end;
  } else {
    minsToOpen = start > nowUtcMins ? start - nowUtcMins : (24 * 60 - nowUtcMins) + start;
  }

  return { isActive, minsToOpen, minsToClose };
}

function formatMins(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h === 0) return `${m}min`;
  return `${h}h ${m < 10 ? "0" : ""}${m}m`;
}

export function MarketSessionsBar({ className }: { className?: string }) {
  const [timeInfo, setTimeInfo] = useState<{ utcMins: number; localTime: string; utcTime: string }>({
    utcMins: 0,
    localTime: "",
    utcTime: "",
  });

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      const localTime = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
      const utcTime = `${now.getUTCHours().toString().padStart(2, "0")}:${now.getUTCMinutes().toString().padStart(2, "0")} UTC`;
      setTimeInfo({ utcMins, localTime, utcTime });
    };
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, []);

  const sessionStatuses = SESSIONS_ORDER.map((session) => {
    const status = getSessionStatus(session, timeInfo.utcMins);
    return { session, meta: SESSION_META[session], hours: SESSION_HOURS[session], ...status };
  });

  const activeCount = sessionStatuses.filter((s) => s.isActive).length;
  const isLondonNyOverlap = sessionStatuses.find((s) => s.session === "london")?.isActive && sessionStatuses.find((s) => s.session === "newyork")?.isActive;

  // 24h Progress pin percentage
  const currentPinPct = (timeInfo.utcMins / (24 * 60)) * 100;

  return (
    <div className={cn("glass-panel rounded-2xl border border-white/10 bg-card/30 p-4 sm:p-5 space-y-4 shadow-xl", className)}>
      {/* Header bar: Time & Liquidity status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <Globe className="h-5 w-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-foreground">Horaires & Sessions de Marché</h3>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9px] font-mono font-bold text-muted-foreground">
                {timeInfo.utcTime} · Heure locale {timeInfo.localTime}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Suivi 24h/24 des ouvertures de Bourses & chevauchements de liquidité.
            </p>
          </div>
        </div>

        {/* Global Market Overlap Badge */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {isLondonNyOverlap ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.25)] animate-pulse">
              <Flame className="h-4 w-4 text-amber-400" /> Chevauchement Londres / NY · Volatilité Max
            </span>
          ) : activeCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-emerald-300">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" /> {activeCount} Session{activeCount > 1 ? "s" : ""} en cours
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-bold text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> Marchés Calmes
            </span>
          )}
        </div>
      </div>

      {/* 24h Timeline Bar */}
      <div className="space-y-1.5 pt-1">
        <div className="flex justify-between text-[9px] font-mono font-bold text-muted-foreground/60 px-0.5">
          <span>00:00 UTC</span>
          <span>06:00 UTC</span>
          <span>12:00 UTC</span>
          <span>18:00 UTC</span>
          <span>24:00 UTC</span>
        </div>
        <div className="relative h-3 w-full rounded-full bg-black/40 overflow-hidden border border-white/10">
          {/* Active Session Overlays */}
          {sessionStatuses.map(({ session, hours, isActive, meta }) => {
            const openPct = (hours.open / 24) * 100;
            const closePct = (hours.close / 24) * 100;

            if (hours.open > hours.close) {
              return (
                <div key={session}>
                  <div
                    className={cn("absolute top-0 bottom-0 opacity-40 transition-all", isActive ? meta.bgActive : "bg-white/5")}
                    style={{ left: `${openPct}%`, right: "0%" }}
                  />
                  <div
                    className={cn("absolute top-0 bottom-0 opacity-40 transition-all", isActive ? meta.bgActive : "bg-white/5")}
                    style={{ left: "0%", width: `${closePct}%` }}
                  />
                </div>
              );
            }

            return (
              <div
                key={session}
                className={cn("absolute top-0 bottom-0 opacity-40 transition-all", isActive ? meta.bgActive : "bg-white/5")}
                style={{ left: `${openPct}%`, width: `${closePct - openPct}%` }}
              />
            );
          })}

          {/* Current Time Indicator Pin */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_12px_#ffffff] z-10"
            style={{ left: `${currentPinPct}%` }}
          />
        </div>
      </div>

      {/* 4 Sessions Cards Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sessionStatuses.map(({ session, meta, hours, isActive, minsToOpen, minsToClose }) => (
          <div
            key={session}
            className={cn(
              "flex flex-col justify-between rounded-xl border p-3.5 transition-all duration-200",
              isActive
                ? cn(meta.borderActive, meta.bgActive, "shadow-md")
                : "border-white/[0.08] bg-black/20 text-muted-foreground hover:bg-black/30"
            )}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{meta.flag}</span>
                  <span className="text-xs font-black uppercase tracking-wider text-foreground">{meta.city}</span>
                </div>
                {isActive ? (
                  <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider animate-pulse", meta.borderActive, meta.textActive)}>
                    En cours
                  </span>
                ) : (
                  <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.2 text-[9px] font-bold text-muted-foreground/60">
                    Fermé
                  </span>
                )}
              </div>

              {/* Hours readout */}
              <div className="mt-2.5 flex items-center justify-between text-[11px] font-mono">
                <span className="text-muted-foreground/75">Horaire UTC :</span>
                <span className="font-bold text-foreground">
                  {hours.open.toString().padStart(2, "0")}:00 – {hours.close.toString().padStart(2, "0")}:00
                </span>
              </div>

              {/* Countdown / Time remaining */}
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground/75">{isActive ? "Ferme dans :" : "Ouvre dans :"}</span>
                <span className={cn("font-mono font-bold", isActive ? meta.textActive : "text-foreground/80")}>
                  {isActive ? formatMins(minsToClose) : formatMins(minsToOpen)}
                </span>
              </div>
            </div>

            {/* Bottom Liquidity Tag */}
            <div className="mt-3 border-t border-white/5 pt-2 flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground/60">Liquidité :</span>
              <span className={cn("font-extrabold uppercase tracking-wider", isActive ? meta.textActive : "text-muted-foreground/60")}>
                {meta.liquidity}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
