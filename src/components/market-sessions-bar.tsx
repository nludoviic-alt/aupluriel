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

export function MarketSessionsBar({
  className,
  hideTitle = false,
}: {
  className?: string;
  /** Drop the title on wide screens when the bar shares its row with another panel. */
  hideTitle?: boolean;
}) {
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
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-md",
        className,
      )}
    >
      {/* Left: Prominent Title & Overlap Alert */}
      <div className={cn("flex items-center gap-2.5 shrink-0", hideTitle && "min-[1700px]:hidden")}>
        <Globe className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-foreground">
          Sessions Forex
        </span>
        {isLondonNyOverlap && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/15 px-2.5 py-0.5 text-xs font-black uppercase text-amber-300">
            <Flame className="h-3.5 w-3.5 text-amber-400 animate-pulse" /> Volatilité Forte (Londres + NY)
          </span>
        )}
      </div>

      {/* Right: 4 Clear Readable Pills */}
      <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto scrollbar-none">
        {sessionStatuses.map(({ session, meta, isActive, minsToOpen, minsToClose }) => (
          <div
            key={session}
            className={cn(
              "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-bold transition-all shrink-0 shadow-sm",
              isActive
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.18)]"
                : "border-white/10 bg-black/40 text-muted-foreground",
            )}
            title={`${meta.name} · ${isActive ? `Ouvert (ferme dans ${formatMins(minsToClose)})` : `Fermé (ouvre dans ${formatMins(minsToOpen)})`}`}
          >
            <span className="text-sm">{meta.flag}</span>
            <span className="font-black text-xs sm:text-sm text-foreground">{meta.name}</span>
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isActive ? "bg-emerald-400 animate-pulse" : "bg-rose-500/60",
              )}
            />
            <span className="font-mono text-xs font-bold">
              {isActive ? (
                <span className="text-emerald-300 font-extrabold">OUVERT ({formatMins(minsToClose)})</span>
              ) : (
                <span className="text-muted-foreground/75">Fermé ({formatMins(minsToOpen)})</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
