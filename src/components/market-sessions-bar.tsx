import { useEffect, useState } from "react";
import { Flame, Globe } from "lucide-react";
import { cn, utcHourToMontreal } from "@/lib/utils";
import { SESSION_HOURS, type TradingSession } from "@/lib/signal-core";

const SESSIONS_ORDER: TradingSession[] = ["asia", "london", "newyork", "sydney"];

const SESSION_META: Record<TradingSession, { flag: string; name: string }> = {
  asia: { flag: "🇯🇵", name: "Tokyo" },
  london: { flag: "🇬🇧", name: "Londres" },
  newyork: { flag: "🇺🇸", name: "New York" },
  sydney: { flag: "🇦🇺", name: "Sydney" },
};

function getSessionStatus(session: TradingSession, nowUtcMins: number) {
  const { open, close } = SESSION_HOURS[session];
  const start = open * 60;
  const end = close * 60;

  const isActive = open > close
    ? nowUtcMins >= start || nowUtcMins < end
    : nowUtcMins >= start && nowUtcMins < end;

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
  if (h === 0) return `${m}m`;
  return `${h}h${m < 10 ? "0" : ""}${m}`;
}

export function MarketSessionsBar({ className }: { className?: string }) {
  const [utcMins, setUtcMins] = useState<number>(0);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setUtcMins(now.getUTCHours() * 60 + now.getUTCMinutes());
    };
    update();
    const id = setInterval(update, 10_000);
    return () => clearInterval(id);
  }, []);

  const sessionStatuses = SESSIONS_ORDER.map((session) => {
    const status = getSessionStatus(session, utcMins);
    return { session, meta: SESSION_META[session], hours: SESSION_HOURS[session], ...status };
  });

  const isLondonNyOverlap = sessionStatuses.find((s) => s.session === "london")?.isActive && sessionStatuses.find((s) => s.session === "newyork")?.isActive;

  return (
    <div className={cn("glass-panel rounded-xl border border-white/10 bg-card/40 p-2.5 sm:p-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between shadow-lg", className)}>
      {/* Left: Compact Title & Overlap Alert */}
      <div className="flex items-center gap-2.5">
        <Globe className="h-4 w-4 text-primary animate-pulse shrink-0" />
        <span className="text-xs font-black uppercase tracking-wider text-foreground">Sessions de Marché</span>
        {isLondonNyOverlap && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-400/15 px-2 py-0.2 text-[9px] font-black uppercase text-amber-300 animate-pulse">
            <Flame className="h-3 w-3 text-amber-400" /> Volatilité Max (Londres + NY)
          </span>
        )}
      </div>

      {/* Right: 4 Compact Simple Pills (VERT = OUVERT, ROUGE = FERMÉ) */}
      <div className="grid grid-cols-2 gap-1.5 sm:flex sm:items-center sm:gap-2">
        {sessionStatuses.map(({ session, meta, hours, isActive, minsToOpen, minsToClose }) => (
          <div
            key={session}
            className={cn(
              "flex flex-col justify-center gap-0.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all",
              isActive
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                : "border-rose-500/40 bg-rose-500/10 text-rose-300/80"
            )}
          >
            <div className="flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-1.5">
                <span>{meta.flag}</span>
                <span className="font-extrabold">{meta.name}</span>
              </div>

              <div className="flex items-center gap-1 font-mono text-[10px]">
                {isActive ? (
                  <span className="inline-flex items-center gap-1 font-black text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    OUVERT ({formatMins(minsToClose)})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                    FERMÉ ({formatMins(minsToOpen)})
                  </span>
                )}
              </div>
            </div>
            <div className="font-mono text-[9px] font-medium opacity-60">
              {utcHourToMontreal(hours.open)}–{utcHourToMontreal(hours.close)} (Montréal)
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
