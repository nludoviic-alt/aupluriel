import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Crosshair,
  Radio,
  TrendingUp,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ScanItem {
  symbol: string;
  action: string;
  direction?: "CALL" | "PUT" | null;
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
  operationalStatus?: string;
  lastScan?: {
    time: number;
    results: ScanItem[];
  } | null;
  savedConfig?: {
    stakeUsd?: number;
    minConfidence?: number;
    minTfAgreement?: number;
    symbols?: string[];
  } | null;
}

interface LiveScannerRadarCockpitProps {
  cloudPresets?: Record<string, PresetState> | null;
  selectedPreset: "crash" | "vol75" | string;
  onSelectPreset: (preset: "crash" | "vol75") => void;
  cloudBusy?: boolean;
}

export function LiveScannerRadarCockpit({
  cloudPresets,
  selectedPreset,
  onSelectPreset,
}: LiveScannerRadarCockpitProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const crashState = cloudPresets?.crash;
  const vol75State = cloudPresets?.vol75;

  const crashScanTime = crashState?.lastScan?.time ?? 0;
  const vol75ScanTime = vol75State?.lastScan?.time ?? 0;
  const mostRecentScanTime = Math.max(crashScanTime, vol75ScanTime);

  const secsAgo = mostRecentScanTime > 0 ? Math.floor((now - mostRecentScanTime) / 1000) : 0;
  const countdownSecs = mostRecentScanTime > 0 ? Math.max(0, 60 - (secsAgo % 60)) : 60;

  const crashResult = crashState?.lastScan?.results?.[0];
  const vol75Result = vol75State?.lastScan?.results?.[0];

  return (
    <div className="rounded-3xl border border-cyan/25 bg-gradient-to-b from-cyan/10 via-black/50 to-black/70 p-4 sm:p-6 shadow-[0_0_40px_rgba(6,182,212,0.1)] backdrop-blur-2xl space-y-6">
      {/* ── Cockpit Header with Radar Beacon ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan/20 border border-cyan/40 text-cyan shadow-[0_0_20px_rgba(6,182,212,0.35)]">
            <Radio className="h-6 w-6 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.9)]" />
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-black tracking-wider uppercase text-foreground">
                Radar & Recherche de Positions en Direct
              </h2>
              <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-2.5 py-0.5 text-[11px] font-bold text-emerald-400 uppercase tracking-widest shadow-sm">
                Surveillance Active
              </span>
            </div>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Analyse continue des ticks Deriv et détection d'opportunités à haute confluence (M1 à H1)
            </p>
          </div>
        </div>

        {/* Live Timer & Telemetry Badge */}
        <div className="flex items-center gap-3 self-start sm:self-auto bg-black/60 border border-white/15 rounded-2xl px-4 py-2.5 text-xs sm:text-sm font-mono shadow-inner">
          <Clock className="h-4 w-4 text-cyan animate-spin [animation-duration:8s]" />
          <span className="text-muted-foreground font-medium">Prochain scan :</span>
          <span className="font-black text-cyan text-base tabular-nums">
            {countdownSecs}s
          </span>
          <span className="text-white/20">|</span>
          <span className="text-xs text-muted-foreground">
            Dernier scan :{" "}
            <span className="text-foreground font-bold">
              {mostRecentScanTime > 0 ? `${secsAgo}s` : "En cours"}
            </span>
          </span>
        </div>
      </div>

      {/* ── Grandes Cartes Carrées (Format Carré Spacieux & Textes Très Lisibles) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-6 max-w-5xl mx-auto w-full">
        {/* Strategy 1: Crash 900 (Grande Carte Carrée) */}
        <div
          onClick={() => onSelectPreset("crash")}
          className={cn(
            "aspect-square min-h-[380px] sm:min-h-[440px] rounded-3xl border p-5 sm:p-7 flex flex-col justify-between transition-all duration-300 cursor-pointer text-left relative overflow-hidden group shadow-xl",
            selectedPreset === "crash"
              ? "border-purple-500/80 bg-purple-500/20 shadow-[0_0_40px_rgba(168,85,247,0.35)] ring-2 ring-purple-500/70 scale-[1.01]"
              : "border-white/15 bg-black/50 hover:border-white/30 hover:bg-white/[0.05]",
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-500/25 text-purple-300 border border-purple-500/50 text-2xl font-bold shrink-0 shadow-md">
                📉
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg sm:text-xl font-black text-foreground uppercase tracking-wide">
                    Crash 900
                  </h3>
                  {selectedPreset === "crash" && (
                    <span className="text-[11px] font-black uppercase tracking-widest bg-purple-500/30 border border-purple-500/50 text-purple-200 px-2 py-0.5 rounded-md shadow-sm">
                      Actif
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-purple-300/80 font-mono font-medium mt-0.5">
                  CRASH900 · 1.00$ Démo
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 pt-1">
              <span
                className={cn(
                  "h-3 w-3 rounded-full",
                  crashState?.running
                    ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)] animate-pulse"
                    : "bg-white/30",
                )}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
                {crashState?.running ? "En veille" : "Prêt"}
              </span>
            </div>
          </div>

          {/* Diagnostic Box Agrandie & Textes Très Clairs */}
          <div className="rounded-2xl bg-black/70 border border-white/10 p-4 sm:p-5 space-y-3.5 shadow-inner">
            <div className="flex items-center justify-between text-xs sm:text-sm font-mono border-b border-white/5 pb-2.5">
              <span className="text-muted-foreground flex items-center gap-2 font-bold shrink-0">
                <Crosshair className="h-4 w-4 text-purple-400" />
                Scan en direct :
              </span>
              <span className="font-bold text-foreground text-right truncate pl-2 text-xs sm:text-sm">
                {crashResult?.action === "traded" ? (
                  <span className="text-emerald-400 flex items-center gap-1.5 justify-end font-black">
                    <CheckCircle2 className="h-4 w-4" /> Position ouverte
                  </span>
                ) : (
                  <span className="text-purple-300 font-semibold truncate">
                    {crashResult?.note || "Surveillance bougies M1 / M5"}
                  </span>
                )}
              </span>
            </div>

            {/* Grille 2x2 des 4 filtres Agrandie */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 text-xs sm:text-sm font-mono">
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  Accord TF
                </span>
                <span className="font-black text-foreground text-xs sm:text-sm">
                  4/4 requis
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  Confiance
                </span>
                <span className="font-black text-foreground text-xs sm:text-sm">
                  ≥ 75%
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  TP / SL
                </span>
                <span className="font-black text-emerald-400 text-xs sm:text-sm">
                  +$1.00 / -$0.50
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  Stop Jour
                </span>
                <span className="font-black text-rose-400 text-xs sm:text-sm">
                  Max -$5.00
                </span>
              </div>
            </div>
          </div>

          {/* Footer Agrandi */}
          <div className="flex items-center justify-between text-xs sm:text-sm text-muted-foreground pt-3 border-t border-white/10">
            <div className="font-mono text-xs sm:text-sm flex items-center gap-1.5">
              <span>Trades du jour :</span>
              <strong className="text-foreground text-sm sm:text-base font-black">
                {crashState?.todayCount ?? 0}
              </strong>
            </div>
            <span className="flex items-center gap-1.5 font-black text-purple-300 text-xs sm:text-sm uppercase tracking-wider bg-purple-500/20 border border-purple-500/40 px-3 py-1.5 rounded-xl group-hover:bg-purple-500/30 group-hover:translate-x-0.5 transition-all shadow-sm">
              Sélectionner <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>

        {/* Strategy 2: Volatility 75 (Grande Carte Carrée) */}
        <div
          onClick={() => onSelectPreset("vol75")}
          className={cn(
            "aspect-square min-h-[380px] sm:min-h-[440px] rounded-3xl border p-5 sm:p-7 flex flex-col justify-between transition-all duration-300 cursor-pointer text-left relative overflow-hidden group shadow-xl",
            selectedPreset === "vol75"
              ? "border-lime-500/80 bg-lime-500/20 shadow-[0_0_40px_rgba(132,204,22,0.35)] ring-2 ring-lime-500/70 scale-[1.01]"
              : "border-white/15 bg-black/50 hover:border-white/30 hover:bg-white/[0.05]",
          )}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3.5">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lime-500/25 text-lime-300 border border-lime-500/50 text-2xl font-bold shrink-0 shadow-md">
                📈
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg sm:text-xl font-black text-foreground uppercase tracking-wide">
                    Volatility 75
                  </h3>
                  {selectedPreset === "vol75" && (
                    <span className="text-[11px] font-black uppercase tracking-widest bg-lime-500/30 border border-lime-500/50 text-lime-200 px-2 py-0.5 rounded-md shadow-sm">
                      Actif
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-lime-300/80 font-mono font-medium mt-0.5">
                  1HZ75V · 1.00$ Démo
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 pt-1">
              <span
                className={cn(
                  "h-3 w-3 rounded-full",
                  vol75State?.running
                    ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.9)] animate-pulse"
                    : "bg-white/30",
                )}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-mono">
                {vol75State?.running ? "En veille" : "Prêt"}
              </span>
            </div>
          </div>

          {/* Diagnostic Box Agrandie & Textes Très Clairs */}
          <div className="rounded-2xl bg-black/70 border border-white/10 p-4 sm:p-5 space-y-3.5 shadow-inner">
            <div className="flex items-center justify-between text-xs sm:text-sm font-mono border-b border-white/5 pb-2.5">
              <span className="text-muted-foreground flex items-center gap-2 font-bold shrink-0">
                <TrendingUp className="h-4 w-4 text-lime-400" />
                Scan en direct :
              </span>
              <span className="font-bold text-foreground text-right truncate pl-2 text-xs sm:text-sm">
                {vol75Result?.action === "traded" ? (
                  <span className="text-emerald-400 flex items-center gap-1.5 justify-end font-black">
                    <CheckCircle2 className="h-4 w-4" /> Position ouverte
                  </span>
                ) : (
                  <span className="text-lime-300 font-semibold truncate">
                    {vol75Result?.note || "Surveillance tendance H1 & Pullback"}
                  </span>
                )}
              </span>
            </div>

            {/* Grille 2x2 des 4 filtres Agrandie */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 text-xs sm:text-sm font-mono">
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  Accord TF
                </span>
                <span className="font-black text-foreground text-xs sm:text-sm">
                  4/4 requis
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  Confiance
                </span>
                <span className="font-black text-foreground text-xs sm:text-sm">
                  ≥ 75%
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  TP / SL
                </span>
                <span className="font-black text-emerald-400 text-xs sm:text-sm">
                  +$1.00 / -$0.50
                </span>
              </div>
              <div className="rounded-xl bg-white/[0.04] p-2.5 sm:p-3 border border-white/10 shadow-sm">
                <span className="text-muted-foreground block text-[10px] sm:text-xs uppercase font-sans font-bold tracking-wider mb-0.5">
                  Stop Jour
                </span>
                <span className="font-black text-rose-400 text-xs sm:text-sm">
                  Max -$5.00
                </span>
              </div>
            </div>
          </div>

          {/* Footer Agrandi */}
          <div className="flex items-center justify-between text-xs sm:text-sm text-muted-foreground pt-3 border-t border-white/10">
            <div className="font-mono text-xs sm:text-sm flex items-center gap-1.5">
              <span>Trades du jour :</span>
              <strong className="text-foreground text-sm sm:text-base font-black">
                {vol75State?.todayCount ?? 0}
              </strong>
            </div>
            <span className="flex items-center gap-1.5 font-black text-lime-300 text-xs sm:text-sm uppercase tracking-wider bg-lime-500/20 border border-lime-500/40 px-3 py-1.5 rounded-xl group-hover:bg-lime-500/30 group-hover:translate-x-0.5 transition-all shadow-sm">
              Sélectionner <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </div>

      {/* ── Live Telemetry Feed (Comment le bot prend position) ── */}
      <div className="rounded-2xl border border-white/15 bg-black/60 p-4 sm:p-5 space-y-3.5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs sm:text-sm font-mono border-b border-white/10 pb-3">
          <span className="flex items-center gap-2 font-bold text-foreground uppercase tracking-wide">
            <Sparkles className="h-4 w-4 text-cyan" />
            Mécanique de Prise de Position Automatique
          </span>
          <span className="text-[11px] font-bold text-muted-foreground bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg">
            Règle stricte : 4/4 Confluence Timeframes + Zéro Martingale
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs sm:text-sm">
          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 space-y-1.5">
            <div className="text-[11px] uppercase font-bold text-cyan tracking-wider">1. Scan & Détection</div>
            <p className="text-xs text-foreground/90 leading-relaxed">
              Le bot interroge Deriv toutes les 60s sur <strong>CRASH900</strong> et <strong>1HZ75V</strong>.
            </p>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 space-y-1.5">
            <div className="text-[11px] uppercase font-bold text-purple-300 tracking-wider">2. Filtre de Confluence</div>
            <p className="text-xs text-foreground/90 leading-relaxed">
              Les 4 unités de temps (M1, M5, M15, H1) doivent pointer dans la même direction (score 4/4).
            </p>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 space-y-1.5">
            <div className="text-[11px] uppercase font-bold text-emerald-400 tracking-wider">3. Validation Risque</div>
            <p className="text-xs text-foreground/90 leading-relaxed">
              Mise fixe <strong>1.00$</strong>. Take Profit à <strong>+1.00$</strong> et Stop Loss serré à <strong>-0.50$</strong>.
            </p>
          </div>

          <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3.5 space-y-1.5">
            <div className="text-[11px] uppercase font-bold text-amber-300 tracking-wider">4. Exécution Sécurisée</div>
            <p className="text-xs text-foreground/90 leading-relaxed">
              Contrat Deriv acheté avec proposition validée. Si condition non remplie : rejet sans risque.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
