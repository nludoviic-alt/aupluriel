import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Crosshair,
  Radio,
  TrendingDown,
  TrendingUp,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CRASH_PRESET, VOL75_PRESET, type AutoTraderConfig } from "@/lib/autotrader";

interface ScanItem {
  symbol: string;
  action: string;
  note?: string;
}

interface PresetState {
  enabled: boolean;
  running: boolean;
  mode: "demo" | "live";
  todayPnl: number;
  todayCount: number;
  operationalStatus?: string;
  blockReason?: string | null;
  lastScan?: {
    time: number;
    results: ScanItem[];
  } | null;
  /** Configuration réellement chargée par le moteur serveur pour ce preset. */
  savedConfig?: Partial<AutoTraderConfig> | null;
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

      {/* ── Cartes stratégie ── */}
      <div
        className={cn(
          "grid grid-cols-1 gap-4 p-4 lg:gap-6 lg:p-6",
          presets.length > 1 && "sm:grid-cols-2",
        )}
      >
        {presets.map((preset) => {
          const state = cloudPresets?.[preset.key];
          const result = state?.lastScan?.results?.[0];
          const isSelected = selectedPreset === preset.key;
          const status = describeStatus(state);
          const usesDefaults = !!state && !state.savedConfig;
          const { stake, filters } = describeConfig(state?.savedConfig ?? preset.defaults);
          const pnl = state?.todayPnl ?? 0;
          // Engine notes are prefixed with an internal code ("DATA_QUALITY_BLOCK: …").
          const scanNote = !state
            ? "…"
            : result?.note?.replace(/^[A-Z0-9_]+:\s*/, "") ||
              (state.running ? preset.idleNote : "Arrêtée");

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
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                      preset.chip,
                      preset.text,
                    )}
                  >
                    <preset.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold uppercase tracking-wider text-foreground">
                        {preset.name}
                      </h3>
                    </div>
                    <p className="mt-0.5 font-mono text-sm text-muted-foreground">
                      {preset.symbol} · {stake} · {state?.mode === "live" ? "Réel" : "Démo"}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5 pt-1">
                  <span className={cn("h-2.5 w-2.5 rounded-full", status.dot)} />
                  <span className={cn("text-xs font-bold uppercase tracking-wider", status.text)}>
                    {status.label}
                  </span>
                </div>
              </div>

              <div className="flex w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
                <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <preset.ScanIcon className={cn("h-4 w-4", preset.text)} />
                  Scan
                </span>
                {result?.action === "traded" ? (
                  <span className="flex items-center gap-1.5 font-bold text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> Position ouverte
                  </span>
                ) : (
                  <span className="min-w-0 truncate font-semibold text-foreground" title={scanNote}>
                    {scanNote}
                  </span>
                )}
              </div>

              <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
                {filters.map((f) => (
                  <div
                    key={f.label}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                  >
                    <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {f.label}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm font-bold tabular-nums",
                        f.tone ?? "text-foreground",
                      )}
                    >
                      {f.value}
                    </span>
                  </div>
                ))}
              </div>

              {state?.blockReason && (
                <p className="w-full rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                  {state.blockReason}
                </p>
              )}
              {usesDefaults && (
                <p className="w-full text-sm text-muted-foreground">
                  Valeurs par défaut — jamais lancée.
                </p>
              )}

              <div className="flex w-full items-center justify-between border-t border-border/40 pt-3 text-sm text-muted-foreground">
                <span>
                  <strong className="whitespace-nowrap font-mono font-bold tabular-nums text-foreground">
                    {state?.todayCount ?? 0} trades
                  </strong>
                  <strong
                    className={cn(
                      "ml-2 font-mono font-bold tabular-nums",
                      pnl >= 0 ? "text-emerald-400" : "text-rose-400",
                    )}
                  >
                    {pnl >= 0 ? `+${usd(pnl)}` : `-${usd(Math.abs(pnl))}`}
                  </strong>
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-sm font-bold uppercase tracking-wider",
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
