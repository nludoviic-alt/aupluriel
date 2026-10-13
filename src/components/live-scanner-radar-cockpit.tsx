import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Crosshair,
  Radio,
  TrendingDown,
  TrendingUp,
  ArrowRight,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CRASH_PRESET, VOL75_PRESET, type AutoTraderConfig } from "@/lib/autotrader";

interface ScanItem {
  symbol: string;
  action: string;
  confidence?: number;
  agreement?: number;
  note?: string;
}

interface PresetState {
  enabled: boolean;
  running: boolean;
  mode: "demo" | "live";
  todayPnl: number;
  todayCount: number;
  todayWins?: number;
  todayLosses?: number;
  todayTotalWon?: number;
  todayTotalLost?: number;
  operationalStatus?: string;
  blockReason?: string | null;
  lastScan?: {
    time: number;
    results: ScanItem[];
  } | null;
  /** Configuration réellement chargée par le moteur serveur pour ce preset. */
  savedConfig?: Partial<AutoTraderConfig> | null;
  trades?: any[];
}

type CockpitPresetKey = "crash" | "vol75";

interface LiveScannerRadarCockpitProps {
  cloudPresets?: Record<string, PresetState> | null;
  /** Presets the account is allowed to see; hidden ones get no card. */
  visiblePresets: readonly string[];
  selectedPreset: string;
  onSelectPreset: (preset: CockpitPresetKey) => void;
}

const COCKPIT_PRESETS: {
  key: CockpitPresetKey;
  name: string;
  symbol: string;
  Icon: LucideIcon;
  ScanIcon: LucideIcon;
  idleNote: string;
  /** Used only until the server has a saved config for this preset. */
  defaults: Partial<AutoTraderConfig>;
  text: string;
  chip: string;
  selected: string;
}[] = [
  {
    key: "vol75",
    name: "Volatility 75",
    symbol: "1HZ75V",
    Icon: TrendingUp,
    ScanIcon: TrendingUp,
    idleNote: "Surveillance tendance H1 & Pullback",
    defaults: VOL75_PRESET,
    text: "text-lime-300",
    chip: "border-lime-500/30 bg-lime-500/10",
    selected: "border-lime-500/50 bg-lime-500/[0.06]",
  },
  {
    key: "crash",
    name: "Crash 900",
    symbol: "CRASH900",
    Icon: TrendingDown,
    ScanIcon: Crosshair,
    idleNote: "Surveillance bougies M1 / M5",
    defaults: CRASH_PRESET,
    text: "text-purple-400",
    chip: "border-purple-500/30 bg-purple-500/10",
    selected: "border-purple-500/50 bg-purple-500/[0.06]",
  },
];

const usd = (n: number) => `$${n.toFixed(2)}`;

function describeStatus(state: PresetState | undefined): {
  label: string;
  dot: string;
  text: string;
} {
  const muted = { dot: "bg-white/25", text: "text-muted-foreground" };
  const amber = { dot: "bg-amber-400", text: "text-amber-300" };
  if (!state) return { label: "…", ...muted };
  switch (state.operationalStatus) {
    case "ACTIVE":
      return { label: "Actif", dot: "animate-pulse bg-emerald-400", text: "text-emerald-300" };
    case "COOLDOWN":
      return { label: "Pause sécurité", ...amber };
    case "PAUSED":
      return { label: "En pause", ...amber };
    case "AUTO_SHADOW":
      return { label: "Shadow", dot: "bg-cyan", text: "text-cyan" };
    case "BROKER_CONFIGURATION_REQUIRED":
      return { label: "Broker à configurer", dot: "bg-rose-400", text: "text-rose-300" };
    case "DISABLED":
      return { label: "Arrêté", ...muted };
    default:
      return state.enabled && state.running
        ? { label: "Actif", dot: "animate-pulse bg-emerald-400", text: "text-emerald-300" }
        : { label: "Arrêté", ...muted };
  }
}

/** Plain-language verdict of the last scan (engine notes carry internal codes). */
function describeScan(
  result: ScanItem | undefined,
  state: PresetState,
  neverStarted: boolean,
  idleNote: string,
): string {
  if (!state.running) return neverStarted ? "Jamais lancée" : "Arrêtée";
  if (!result) return idleNote;
  switch (result.action) {
    case "no-signal":
      return "Pas de signal";
    case "low-confidence":
      return result.confidence != null
        ? `Confiance ${result.confidence}% — sous le seuil`
        : "Confiance sous le seuil";
    case "low-agreement":
      return result.agreement != null
        ? `Accord ${result.agreement}/4 — insuffisant`
        : "Accord insuffisant";
    default:
      return result.note?.replace(/^[A-Z0-9_]+:\s*/, "") || idleNote;
  }
}

function describeConfig(cfg: Partial<AutoTraderConfig>) {
  const percentStake = cfg.stakeMode === "percent";
  const stakeUsd = cfg.stakeUsd ?? 0;
  const tpPct = cfg.takeProfitPctOfStake;
  const slPct = cfg.stopLossPctOfStake;
  const minConf = cfg.minConfidence;
  const maxConf = cfg.maxConfidence ?? 100;
  return {
    stake: percentStake ? `${cfg.stakePercent ?? 0}% du capital` : usd(stakeUsd),
    filters: [
      {
        label: "Accord TF",
        value: cfg.minTfAgreement != null ? `${cfg.minTfAgreement}/4 min` : "—",
      },
      {
        label: "Confiance",
        value: minConf == null ? "—" : maxConf >= 100 ? `≥ ${minConf}%` : `${minConf}–${maxConf}%`,
      },
      {
        label: "TP / SL",
        value:
          tpPct == null || slPct == null
            ? "—"
            : percentStake
              ? `+${tpPct}% / -${slPct}% mise`
              : `+${usd((stakeUsd * tpPct) / 100)} / -${usd((stakeUsd * slPct) / 100)}`,
      },
      {
        label: "Stop Jour",
        value: cfg.maxDailyLossUsd != null ? `-${usd(cfg.maxDailyLossUsd)}` : "—",
        tone: "text-rose-400",
      },
    ] as { label: string; value: string; tone?: string }[],
  };
}

export function LiveScannerRadarCockpit({
  cloudPresets,
  visiblePresets,
  selectedPreset,
  onSelectPreset,
}: LiveScannerRadarCockpitProps) {
  const presets = COCKPIT_PRESETS.filter((p) => visiblePresets.includes(p.key));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const mostRecentScanTime = Math.max(
    0,
    ...presets.map((p) => cloudPresets?.[p.key]?.lastScan?.time ?? 0),
  );

  const secsAgo = mostRecentScanTime > 0 ? Math.floor((now - mostRecentScanTime) / 1000) : 0;
  const countdownSecs = mostRecentScanTime > 0 ? Math.max(0, 60 - (secsAgo % 60)) : 60;

  // Calcul agrégé des gains & pertes du jour (tous presets confondus)
  const todayStats = Object.values(cloudPresets ?? {}).reduce(
    (acc, p) => {
      acc.pnl += p.todayPnl ?? 0;
      acc.won += p.todayTotalWon ?? 0;
      acc.lost += p.todayTotalLost ?? 0;
      acc.wins += p.todayWins ?? 0;
      acc.losses += p.todayLosses ?? 0;
      acc.count += p.todayCount ?? 0;
      return acc;
    },
    { pnl: 0, won: 0, lost: 0, wins: 0, losses: 0, count: 0 },
  );

  // Sécurité de secours : calcul via les trades si todayTotalWon/Lost pas encore agrégés
  if (todayStats.won === 0 && todayStats.lost === 0) {
    const isToday = (ms: number) => new Date(ms).toDateString() === new Date().toDateString();
    for (const p of Object.values(cloudPresets ?? {})) {
      for (const t of p.trades ?? []) {
        if ((t.status === "won" || t.status === "lost") && isToday(t.time ?? t.timestamp ?? 0)) {
          if (t.profit > 0) todayStats.won += t.profit;
          else if (t.profit < 0) todayStats.lost += Math.abs(t.profit);
        }
      }
    }
  }

  const netPnl = todayStats.pnl;
  const winRate =
    todayStats.wins + todayStats.losses > 0
      ? Math.round((todayStats.wins / (todayStats.wins + todayStats.losses)) * 100)
      : null;

  return (
    <div className="glass-panel overflow-hidden rounded-2xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-4 lg:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan/30 bg-cyan/10 text-cyan">
            <Radio className="h-4 w-4" />
          </span>
          <h2 className="text-base font-bold uppercase tracking-wider text-foreground">Radar</h2>
        </div>

        <div className="flex shrink-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
          <Clock className="h-4 w-4 text-cyan" />
          <span className="hidden text-muted-foreground sm:inline">Prochain scan</span>
          <span className="font-mono text-base font-bold tabular-nums text-cyan">
            {countdownSecs}s
          </span>
          <span className="h-3.5 w-px bg-white/10" />
          <span className="text-muted-foreground">Dernier</span>
          <span className="font-mono font-bold tabular-nums text-foreground">
            {mostRecentScanTime > 0 ? `${secsAgo}s` : "En cours"}
          </span>
        </div>
      </div>

      {/* ── Cartes stratégie & Bilan Gains / Pertes (100% Responsive) ── */}
      <div className="mx-auto grid w-full grid-cols-1 gap-4 p-3 sm:p-4 md:grid-cols-2 xl:grid-cols-3 lg:gap-6 lg:p-6 max-w-[1440px]">
        {/* ── 1ère Carte : Visuel Direct Gains & Pertes (Priorité Visuelle - Avant les bots) ── */}
        <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/[0.12] p-4 lg:p-5 shadow-lg shadow-black/25 hover:border-emerald-500/40 transition-colors backdrop-blur-md">
          {/* En-tête */}
          <div className="flex w-full items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-sm">
                <Coins className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-lg font-black uppercase tracking-wider text-foreground">
                  Gains & Pertes
                </h3>
                <p className="mt-0.5 font-mono text-sm font-semibold text-muted-foreground">
                  Bilan du jour · En direct
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 pt-0.5">
              <span className="h-2.5 w-2.5 rounded-full animate-pulse bg-emerald-400" />
              <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-300">
                Aujourd'hui
              </span>
            </div>
          </div>

          {/* Ligne Résultat Net Central (P&L) */}
          <div
            className={cn(
              "flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm",
              netPnl > 0
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : netPnl < 0
                  ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                  : "border-white/10 bg-white/[0.04] text-foreground",
            )}
          >
            <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-muted-foreground">
              P&L Net
            </span>
            <span
              className={cn(
                "font-mono text-lg sm:text-xl font-black tracking-tight tabular-nums",
                netPnl >= 0 ? "text-emerald-400" : "text-rose-400",
              )}
            >
              {netPnl >= 0 ? `+${usd(netPnl)}` : `-${usd(Math.abs(netPnl))}`}
            </span>
          </div>

          {/* Grille Visuelle Directe : 2 Blocs Gains vs Pertes */}
          <div className="grid w-full grid-cols-2 gap-2.5 sm:gap-3">
            {/* Bloc GAINS */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.08] p-3 sm:p-3.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-400">
                  Gains ▲
                </span>
                <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 font-mono text-xs font-black text-emerald-300">
                  {todayStats.wins} win{todayStats.wins > 1 ? "s" : ""}
                </span>
              </div>
              <span className="mt-2 block font-mono text-xl sm:text-2xl lg:text-3xl font-black text-emerald-300 tabular-nums truncate">
                +${todayStats.won.toFixed(2)}
              </span>
            </div>

            {/* Bloc PERTES */}
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/[0.08] p-3 sm:p-3.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-rose-400">
                  Pertes ▼
                </span>
                <span className="rounded-md bg-rose-500/20 px-2 py-0.5 font-mono text-xs font-black text-rose-300">
                  {todayStats.losses} loss
                </span>
              </div>
              <span className="mt-2 block font-mono text-xl sm:text-2xl lg:text-3xl font-black text-rose-400 tabular-nums truncate">
                -${todayStats.lost.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Pied de carte aligné */}
          <div className="mt-auto flex w-full items-center justify-between border-t border-border/40 pt-3 text-sm text-muted-foreground">
            <span>
              <strong className="font-mono text-sm sm:text-base font-black tabular-nums text-foreground">
                {todayStats.count} trade{todayStats.count > 1 ? "s" : ""}
              </strong>
            </span>
            <span
              className={cn(
                "font-mono font-black uppercase tracking-wider text-xs sm:text-sm",
                winRate != null && winRate >= 50
                  ? "text-emerald-400"
                  : winRate != null
                    ? "text-rose-400"
                    : "text-muted-foreground",
              )}
            >
              {winRate != null ? `${winRate}% Win Rate` : "0% Win Rate"}
            </span>
          </div>
        </div>

        {/* ── Cartes Bots (Volatility 75 puis Crash 900) ── */}
        {presets.map((preset) => {
          const state = cloudPresets?.[preset.key];
          const result = state?.lastScan?.results?.[0];
          const isSelected = selectedPreset === preset.key;
          const status = describeStatus(state);
          const usesDefaults = !!state && !state.savedConfig;
          const { stake, filters } = describeConfig(state?.savedConfig ?? preset.defaults);
          const pnl = state?.todayPnl ?? 0;
          // One status line per card, same slot whatever the state, so cards
          // stay the same height: blocked > traded > last scan verdict.
          const line: { text: string; tone: "block" | "ok" | "neutral" } = !state
            ? { text: "…", tone: "neutral" }
            : state.blockReason
              ? { text: state.blockReason, tone: "block" }
              : result?.action === "traded"
                ? { text: "Position ouverte", tone: "ok" }
                : {
                    text: describeScan(result, state, usesDefaults, preset.idleNote),
                    tone: "neutral",
                  };

          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onSelectPreset(preset.key)}
              aria-pressed={isSelected}
              className={cn(
                "group flex min-w-0 cursor-pointer flex-col gap-4 rounded-2xl border p-4 text-left transition-colors lg:p-5",
                isSelected
                  ? preset.selected
                  : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]",
              )}
            >
              <div className="flex w-full items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm",
                      preset.chip,
                      preset.text,
                    )}
                  >
                    <preset.Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-black uppercase tracking-wider text-foreground">
                        {preset.name}
                      </h3>
                    </div>
                    <p className="mt-0.5 font-mono text-sm font-semibold text-muted-foreground">
                      {stake} · {state?.mode === "live" ? "Réel" : "Démo"}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 pt-0.5">
                  <span className={cn("h-2.5 w-2.5 rounded-full", status.dot)} />
                  <span className={cn("text-xs sm:text-sm font-black uppercase tracking-wider", status.text)}>
                    {status.label}
                  </span>
                </div>
              </div>

              <div
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-semibold",
                  line.tone === "block"
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
                    : line.tone === "ok"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : "border-white/10 bg-white/[0.04] text-foreground",
                )}
              >
                {line.tone === "ok" ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <preset.ScanIcon
                    className={cn("h-4 w-4 shrink-0", line.tone === "neutral" && preset.text)}
                  />
                )}
                <span className="min-w-0 truncate font-bold" title={line.text}>
                  {line.text}
                </span>
              </div>

              <div className="grid w-full grid-cols-2 gap-3">
                {filters.map((f) => (
                  <div
                    key={f.label}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5"
                  >
                    <span className="block text-xs font-black uppercase tracking-wider text-muted-foreground/80">
                      {f.label}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-base font-black tabular-nums",
                        f.tone ?? "text-foreground",
                      )}
                    >
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-auto flex w-full items-center justify-between border-t border-border/40 pt-3 text-sm text-muted-foreground">
                <span>
                  <strong className="whitespace-nowrap font-mono text-sm sm:text-base font-black tabular-nums text-foreground">
                    {state?.todayCount ?? 0} trades
                  </strong>
                  <strong
                    className={cn(
                      "ml-2.5 font-mono text-base sm:text-lg font-black tabular-nums",
                      pnl >= 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {pnl >= 0 ? `+${usd(pnl)}` : `-${usd(Math.abs(pnl))}`}
                  </strong>
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-xs sm:text-sm font-black uppercase tracking-wider",
                    preset.text,
                  )}
                >
                  {isSelected ? "Sélectionné" : "Sélectionner"}
                  {!isSelected && (
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
