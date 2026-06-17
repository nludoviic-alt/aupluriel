import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock,
  Globe,
  Power,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SYMBOLS } from "@/lib/deriv";
import {
  computeAdaptiveStake,
  countConsecutiveLosses,
  currentActiveSessions,
  DEFAULT_CONFIG,
  isInTradingSession,
  loadTradeLog,
  openPreviewTrade,
  PRUDENT_CONFIG,
  PRESETS,
  SESSION_HOURS,
  startAutoTrader,
  todayPnl,
  todayTradeCount,
  type AutoTraderConfig,
  type PresetConfig,
  type RiskProfile,
  type TradingMode,
  type TradingSession,
  type TradeLog,
} from "@/lib/autotrader";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { AmountInput } from "@/components/amount-input";
import { VOICE_ACTION_EVENT } from "@/components/voice-control";
import { activeStrategySymbols } from "@/lib/strategies";
import { LiveTradeCard } from "@/components/live-trade-card";

export const Route = createFileRoute("/autotrader")({
  head: () => ({ meta: [{ title: "Auto-Trader — LIO23" }] }),
  component: AutoTraderPage,
});

const CONFIG_KEY = "lio23.autotrader_config";

function loadConfig(): AutoTraderConfig {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}") };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(c: AutoTraderConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {}
}

function AutoTraderPage() {
  const [config, setConfig] = useState<AutoTraderConfig>(DEFAULT_CONFIG);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<TradeLog[]>([]);
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [activeSessions, setActiveSessions] = useState<TradingSession[]>([]);
  const [riskStopReasons, setRiskStopReasons] = useState<string[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const { confirmState, confirm } = useConfirm();

  useEffect(() => {
    const loaded = loadConfig();
    // Pre-select a pair when arriving from the market coach (?pair=…)
    const pair = new URLSearchParams(window.location.search).get("pair");
    if (pair && SYMBOLS.some((s) => s.deriv === pair) && !loaded.symbols.includes(pair)) {
      loaded.symbols = [...loaded.symbols, pair];
      saveConfig(loaded);
      const label = SYMBOLS.find((s) => s.deriv === pair)?.label ?? pair;
      toast.success(`${label} ajoutée aux paires surveillées — prêt à trader`);
    }
    setConfig(loaded);
    setLogs(loadTradeLog());
    const accepted = localStorage.getItem("lio23.disclaimer_accepted") === "1";
    setDisclaimerAccepted(accepted);
    // Update active sessions every minute
    setActiveSessions(currentActiveSessions());
    const id = setInterval(() => setActiveSessions(currentActiveSessions()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Memoize expensive calculations to prevent recalculation on every render
  const stats = useMemo(() => {
    const pnl = todayPnl(logs);
    const tradeCount = todayTradeCount(logs);
    const wins = logs.filter((l) => l.status === "won").length;
    const losses = logs.filter((l) => l.status === "lost").length;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
    const openTradeList = logs.filter((l) => l.status === "open");
    const consecutiveLosses = countConsecutiveLosses(logs);
    const effectiveStake = config.adaptiveStake ? computeAdaptiveStake(config.stakeUsd, logs) : config.stakeUsd;
    return { pnl, tradeCount, wins, losses, winRate, openTradeList, consecutiveLosses, effectiveStake };
  }, [logs, config.adaptiveStake, config.stakeUsd]);

  const { pnl, tradeCount, wins, losses, winRate, openTradeList, consecutiveLosses, effectiveStake } = stats;
  const openTrades = openTradeList.length;
  const inCooldown = Date.now() < cooldownUntil;
  const cooldownSecsLeft = inCooldown ? Math.ceil((cooldownUntil - Date.now()) / 1000) : 0;

  function patchConfig<K extends keyof AutoTraderConfig>(k: K, v: AutoTraderConfig[K]) {
    const next = { ...config, [k]: v };
    setConfig(next);
    saveConfig(next);
  }

  const handleEvent = useCallback((log: TradeLog, meta?: { cooldownUntil?: number }) => {
    setLogs(loadTradeLog());
    if (log.status === "won") toast.success(`✅ ${log.symbol} — Gagné +$${log.profit.toFixed(2)}`);
    if (log.status === "lost") toast.error(`❌ ${log.symbol} — Perdu -$${Math.abs(log.profit).toFixed(2)}`);
    if (log.status === "error") toast.error(`⚠️ Erreur sur ${log.symbol}`);
    if (log.status === "pending") toast.info(`🎯 Position favorable détectée — ${log.symbol} ${log.direction}`);
    if (log.status === "cooldown") {
      setCooldownUntil(meta?.cooldownUntil ?? 0);
      toast.warning(`⏸ Cooldown activé — ${log.note}`);
    }
  }, []);

  const handleRiskStop = useCallback((reasons: string[]) => {
    setRunning(false);
    setRiskStopReasons(reasons);
    setLogs(loadTradeLog());
    toast.error(`🛑 Auto-trader ARRÊTÉ — ${reasons[0]}`, { duration: 10000 });
  }, []);

  async function toggleEngine() {
    if (running) {
      // Stopping is reversible and low-risk — no confirmation
      stopRef.current?.();
      stopRef.current = null;
      setRunning(false);
      toast.info("Auto-trader arrêté");
    } else {
      if (!disclaimerAccepted) {
        setShowDisclaimer(true);
        return;
      }
      if ((config.mode === "demo" || config.mode === "live") && !localStorage.getItem("lio23.deriv_token")) {
        toast.error("Configure un token API Deriv dans Paramètres d'abord (requis pour demo et live)");
        return;
      }
      // Confirm ONLY when real money is at stake (LIVE mode)
      if (config.mode === "live") {
        const ok = await confirm({
          title: "Démarrer en mode LIVE ?",
          description: `Le bot va trader avec du VRAI argent. Mise : $${config.stakeUsd} par trade. Limite journalière : $${config.maxDailyLossUsd}.`,
          confirmLabel: "Démarrer en réel",
          danger: true,
        });
        if (!ok) return;
      }
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission();
      }
      setRiskStopReasons([]);
      // Merge active strategy symbols into the watchlist
      const stratSymbols = activeStrategySymbols();
      const mergedSymbols = [...new Set([...config.symbols, ...stratSymbols])];
      const effectiveConfig = mergedSymbols.length > config.symbols.length
        ? { ...config, symbols: mergedSymbols }
        : config;
      if (stratSymbols.length) {
        toast.info(`${stratSymbols.length} paire(s) ajoutée(s) via Stratégies actives`);
      }
      stopRef.current = startAutoTrader(effectiveConfig, handleEvent, handleRiskStop);
      setRunning(true);
      toast.success(`Auto-trader démarré en mode ${config.mode.toUpperCase()}`);
    }
  }

  // Voice commands: start/stop the bot from anywhere
  useEffect(() => {
    function onVoice(e: Event) {
      const type = (e as CustomEvent<{ type: string }>).detail?.type;
      if (type === "start-bot" && !running) toggleEngine();
      if (type === "stop-bot" && running) toggleEngine();
    }
    window.addEventListener(VOICE_ACTION_EVENT, onVoice);
    return () => window.removeEventListener(VOICE_ACTION_EVENT, onVoice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, config, disclaimerAccepted]);

  function acceptDisclaimer() {
    localStorage.setItem("lio23.disclaimer_accepted", "1");
    setDisclaimerAccepted(true);
    setShowDisclaimer(false);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    setRiskStopReasons([]);
    stopRef.current = startAutoTrader(config, handleEvent, handleRiskStop);
    setRunning(true);
    toast.success(`Auto-trader démarré en mode ${config.mode.toUpperCase()}`);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-5 w-5 text-[color:var(--brand-cyan)]" />
            Auto-Trader
          </h1>
          <p className="text-sm text-muted-foreground">
            Exécute des trades automatiquement quand les conditions du marché sont favorables.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={running}
            onClick={() => {
              const next = { ...config, ...PRUDENT_CONFIG };
              setConfig(next);
              saveConfig(next);
              toast.success(
                "🛡️ Mode Prudent activé — DEMO, signaux premium, 4/4 TF, confiance ≥82%, max 5 trades/jour. Ta mise et tes paires sont conservées.",
                { duration: 7000 },
              );
            }}
            className="gap-2 text-xs border-[color:var(--bull)]/40 text-[color:var(--bull)] hover:bg-[color:var(--bull)]/10"
            title="Applique un preset de réglages sécurisés en un clic"
          >
            <ShieldCheck className="h-4 w-4" />
            Mode Prudent
          </Button>
          <Button
            variant="outline"
            disabled={config.symbols.every((s) => openTradeList.some((t) => t.symbol === s))}
            onClick={async () => {
              // One position per symbol — pick the first watched pair without an open trade
              const openSymbols = new Set(openTradeList.map((t) => t.symbol));
              const sym = config.symbols.find((s) => !openSymbols.has(s));
              if (!sym) {
                toast.error("Toutes les paires surveillées ont déjà une position ouverte.");
                return;
              }
              const label = SYMBOLS.find((x) => x.deriv === sym)?.label ?? sym;
              toast.info(`🎬 Aperçu — position sur ${label}…`);
              await openPreviewTrade(sym, config.durationMinutes, config.stakeUsd, handleEvent);
            }}
            className="gap-2 text-xs"
            title="Ouvre une position démo (1 par paire) pour voir le visuel live"
          >
            <Activity className="h-4 w-4" />
            Aperçu live
          </Button>
          {/* Quick mode switch — simulation / demo / live */}
          <div className="inline-flex rounded-md border border-border p-0.5" title={running ? "Arrête le bot pour changer de mode" : "Simulation locale, compte demo Deriv, ou argent réel"}>
            {(["simulation", "demo", "live"] as TradingMode[]).map((m) => (
              <button
                key={m}
                disabled={running}
                onClick={() => patchConfig("mode", m)}
                className={cn(
                  "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                  config.mode === m
                    ? m === "simulation"
                      ? "bg-muted text-foreground"
                      : m === "demo"
                        ? "bg-[color:var(--bull)]/15 text-[color:var(--bull)]"
                        : "bg-[color:var(--bear)]/15 text-[color:var(--bear)]"
                    : "text-muted-foreground hover:text-foreground",
                  running && "opacity-50 cursor-not-allowed",
                )}
              >
                {m === "live" && <AlertTriangle className="mr-1 inline h-3 w-3" />}
                {m === "simulation" ? "simu" : m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs rounded-md border border-border px-3 py-1.5">
            <CircleDot className={cn(
              "h-3.5 w-3.5",
              running
                ? config.mode === "live"
                  ? "text-[color:var(--bear)] animate-ping" // LIVE: blinking red
                  : config.mode === "demo"
                    ? "text-[color:var(--bull)] animate-pulse" // DEMO: pulsing green
                    : "text-muted-foreground animate-pulse" // SIMULATION: gray pulse
                : "text-muted-foreground"
            )} />
            <span className={cn(
              "font-semibold",
              running
                ? config.mode === "live"
                  ? "text-[color:var(--bear)] animate-pulse" // LIVE: blinking text
                  : config.mode === "demo"
                    ? "text-[color:var(--bull)]" // DEMO: green
                    : "text-muted-foreground" // SIMULATION: gray
                : "text-muted-foreground"
            )}>
              {running
                ? config.mode === "live"
                  ? "LIVE ⚠️"
                  : config.mode === "demo"
                    ? "DEMO ✅"
                    : "SIMULATION"
                : "ARRÊTÉ"}
            </span>
          </div>
          <Button
            onClick={toggleEngine}
            className={cn(
              "font-semibold gap-2",
              running
                ? "bg-[color:var(--bear)]/20 text-[color:var(--bear)] border border-[color:var(--bear)]/30 hover:bg-[color:var(--bear)]/30"
                : "bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] hover:opacity-90",
            )}
          >
            <Power className="h-4 w-4" />
            {running ? "Arrêter" : "Démarrer"}
          </Button>
        </div>
      </div>

      {/* Warning banner */}
      <div className="rounded-xl border border-[color:var(--bear)]/30 bg-[color:var(--bear)]/5 p-4 flex gap-3">
        <ShieldAlert className="h-5 w-5 shrink-0 text-[color:var(--bear)] mt-0.5" />
        <div className="text-sm">
          <div className="font-semibold text-[color:var(--bear)]">Avertissement de risque</div>
          <p className="mt-0.5 text-muted-foreground leading-relaxed">
            Aucun algorithme ne gagne à 100%. Les signaux ont ~62% de win rate historique — les 38% restants
            seront des pertes. Le circuit-breaker arrête automatiquement le bot si la perte journalière dépasse
            ton seuil. <strong className="text-foreground">Commence toujours en mode DEMO.</strong>
          </p>
        </div>
      </div>

      {/* Risk-stop banner */}
      {riskStopReasons.length > 0 && (
        <div className="rounded-xl border border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 p-4 flex gap-3">
          <ShieldAlert className="h-5 w-5 shrink-0 text-[color:var(--bear)] mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-bold text-[color:var(--bear)]">🛑 Auto-trader arrêté — risque détecté</div>
            <ul className="mt-1.5 space-y-1">
              {riskStopReasons.map((r, i) => (
                <li key={i} className="flex gap-1.5 text-foreground">
                  <span className="text-[color:var(--bear)]">•</span>
                  {r}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Vérifie les conditions du marché avant de relancer le bot.
            </p>
          </div>
          <button
            onClick={() => setRiskStopReasons([])}
            className="text-muted-foreground hover:text-foreground text-xs shrink-0"
          >
            Ignorer
          </button>
        </div>
      )}

      {/* Cooldown banner */}
      {inCooldown && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-center gap-3 text-sm text-amber-400">
          <Clock className="h-4 w-4 shrink-0" />
          <span>
            <strong>Cooldown actif</strong> — {consecutiveLosses} pertes consécutives.
            Reprise dans <strong>{Math.floor(cooldownSecsLeft / 60)}m {cooldownSecsLeft % 60}s</strong>.
          </span>
        </div>
      )}

      {/* Session status */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Globe className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Sessions actives :</span>
        {(["asia", "london", "newyork"] as TradingSession[]).map((s) => {
          const isActive = activeSessions.includes(s);
          const inConfig = config.tradingSessions.includes(s);
          return (
            <span key={s} className={cn(
              "rounded-md px-2 py-0.5 font-medium",
              isActive && inConfig ? "bg-[color:var(--bull)]/15 text-[color:var(--bull)]"
              : isActive ? "bg-muted/30 text-muted-foreground"
              : "bg-muted/20 text-muted-foreground/50"
            )}>
              {SESSION_HOURS[s].label}
              {isActive ? " ●" : " ○"}
            </span>
          );
        })}
        {config.adaptiveStake && effectiveStake < config.stakeUsd && (
          <span className="rounded-md bg-amber-500/10 text-amber-400 px-2 py-0.5 font-medium">
            Mise réduite: ${effectiveStake.toFixed(2)}
          </span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="P&L Aujourd'hui"
          value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
          tone={pnl >= 0 ? "bull" : "bear"}
          sub={`${tradeCount} trades`}
        />
        <Kpi label="Win Rate" value={`${winRate.toFixed(0)}%`} tone="cyan" sub={`${wins}W / ${losses}L`} />
        <Kpi
          label="Pertes consécutives"
          value={`${consecutiveLosses} / ${config.maxConsecutiveLosses}`}
          tone={consecutiveLosses >= config.maxConsecutiveLosses - 1 ? "bear" : consecutiveLosses > 0 ? "violet" : "default"}
          sub={inCooldown ? "cooldown en cours" : "avant cooldown"}
        />
        <Kpi
          label="Limite journalière"
          value={`$${Math.abs(pnl).toFixed(0)} / $${config.maxDailyLossUsd}`}
          tone={Math.abs(pnl) > config.maxDailyLossUsd * 0.7 ? "bear" : "default"}
          sub="circuit-breaker"
        />
      </div>

      {/* Live open positions — visual movement */}
      {openTradeList.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[color:var(--brand-cyan)] animate-pulse" />
            <h2 className="text-base font-semibold">Positions en direct ({openTradeList.length})</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {openTradeList.map((t) => (
              <LiveTradeCard key={t.id} trade={t} />
            ))}
          </div>
        </div>
      )}

      {/* Config */}
      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Configuration</h2>
        </div>

        {/* Preset Selector */}
        <div className="mb-5 rounded-xl border border-border bg-muted/30 p-4">
          <label className="mb-3 block text-xs uppercase tracking-wider text-muted-foreground">
            🎯 Choisir un profil de trading
          </label>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(PRESETS) as RiskProfile[]).map((key) => {
              const preset = PRESETS[key];
              const isActive = config.minConfidence === preset.minConfidence &&
                              config.minTfAgreement === preset.minTfAgreement;
              return (
                <button
                  key={key}
                  disabled={running}
                  onClick={() => {
                    const { name, description, emoji, recommendedCapital, targetWinRate, expectedTradesPerDay, ...presetConfig } = preset;
                    setConfig((prev) => ({ ...prev, ...presetConfig }));
                    toast.success(`Profil ${preset.name} appliqué`, {
                      description: `${preset.description} Capital recommandé: ${preset.recommendedCapital}`,
                    });
                  }}
                  className={cn(
                    "relative rounded-lg border p-3 text-left transition-all",
                    isActive
                      ? key === "conservative"
                        ? "border-yellow-500 bg-yellow-500/10"  // Jaune léger
                        : key === "moderate"
                          ? "border-blue-500 bg-blue-500/10"    // Bleu léger
                          : "border-green-500 bg-green-500/10"   // Vert léger
                      : "border-border bg-background hover:border-muted-foreground/50",
                    running && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">{preset.emoji}</span>
                    <span className="text-xs font-semibold">{preset.name}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    {preset.description.slice(0, 40)}...
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted">{preset.recommendedCapital}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted">{preset.targetWinRate}</span>
                  </div>
                  {isActive && (
                    <div className="absolute top-1 right-1">
                      <div className={cn(
                        "h-2 w-2 rounded-full",
                        key === "conservative" ? "bg-yellow-500" :
                        key === "moderate" ? "bg-blue-500" :
                        "bg-green-500"
                      )} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            💡 Choisis selon ton capital et ton appétence au risque. Le mode conservateur recommande simulation, les autres demo obligatoire.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Mode */}
          <div>
            <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">Mode</label>
            <div className="flex gap-1">
              {(["simulation", "demo", "live"] as TradingMode[]).map((m) => (
                <button
                  key={m}
                  disabled={running}
                  onClick={() => patchConfig("mode", m)}
                  className={cn(
                    "flex-1 rounded-md border py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                    config.mode === m
                      ? m === "simulation"
                        ? "border-muted bg-muted text-foreground"
                        : m === "demo"
                          ? "border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                          : "border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                      : "border-border text-muted-foreground hover:text-foreground",
                    running && "opacity-50 cursor-not-allowed",
                  )}
                >
                  {m === "live" && <AlertTriangle className="inline h-3 w-3 mr-1" />}
                  {m === "simulation" ? "simu" : m}
                </button>
              ))}
            </div>
            {config.mode === "simulation" && (
              <p className="mt-1 text-xs text-muted-foreground">Simulation locale — pas de vrais trades</p>
            )}
            {config.mode === "demo" && (
              <p className="mt-1 text-xs text-[color:var(--bull)]">✅ Compte demo Deriv — trades réels avec faux argent</p>
            )}
            {config.mode === "live" && (
              <p className="mt-1 text-xs text-[color:var(--bear)]">⚠️ Argent réel — sois très prudent</p>
            )}
          </div>

          {/* Stake */}
          <Field label="Mise par trade ($)">
            <AmountInput
              value={config.stakeUsd}
              min={1}
              max={100}
              step={1}
              disabled={running}
              onCommit={(next) => {
                patchConfig("stakeUsd", next);
                return true;
              }}
            />
          </Field>

          {/* Duration */}
          <Field label="Durée contrat (minutes)">
            <select
              value={config.durationMinutes}
              disabled={running}
              onChange={(e) => patchConfig("durationMinutes", Number(e.target.value))}
              className="cfg-input"
            >
              <option value={5}>5 min</option>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 heure</option>
            </select>
          </Field>

          {/* Min confidence */}
          <Field label={`Confiance minimum (${config.minConfidence}%)`}>
            <input
              type="range"
              min={55}
              max={95}
              step={5}
              value={config.minConfidence}
              disabled={running}
              onChange={(e) => patchConfig("minConfidence", Number(e.target.value))}
              className="w-full accent-[color:var(--brand-cyan)]"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
              <span>55% (+ trades)</span><span>95% (rare)</span>
            </div>
          </Field>

          {/* TF agreement */}
          <Field label={`Accord timeframes (${config.minTfAgreement}/4 minimum)`}>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={config.minTfAgreement}
              disabled={running}
              onChange={(e) => patchConfig("minTfAgreement", Number(e.target.value))}
              className="w-full accent-[color:var(--brand-cyan)]"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
              <span>1 (+ trades)</span><span>4 (très sélectif)</span>
            </div>
          </Field>

          {/* Max daily loss — editable even while running, no confirmation */}
          <Field label="Perte max journalière ($)">
            <AmountInput
              value={config.maxDailyLossUsd}
              min={5}
              max={500}
              step={5}
              onCommit={(next) => {
                patchConfig("maxDailyLossUsd", next);
                return true;
              }}
            />
            <p className="mt-0.5 text-xs text-muted-foreground">Modifiable en temps réel, même bot actif</p>
          </Field>

          {/* Max trades — editable even while running, no confirmation */}
          <Field label="Trades max par jour">
            <AmountInput
              value={config.maxTradesPerDay}
              min={1}
              max={50}
              step={1}
              onCommit={(next) => {
                patchConfig("maxTradesPerDay", next);
                return true;
              }}
            />
            <p className="mt-0.5 text-xs text-muted-foreground">Modifiable en temps réel, même bot actif</p>
          </Field>

          {/* Symbols */}
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
              Paires surveillées
            </label>
            <div className="flex flex-wrap gap-2">
              {SYMBOLS.map((s) => {
                const active = config.symbols.includes(s.deriv);
                return (
                  <button
                    key={s.deriv}
                    disabled={running}
                    onClick={() => {
                      const next = active
                        ? config.symbols.filter((x) => x !== s.deriv)
                        : [...config.symbols, s.deriv];
                      if (next.length === 0) return;
                      patchConfig("symbols", next);
                    }}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]"
                        : "border-border text-muted-foreground hover:text-foreground",
                      running && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Risk protection section */}
        <div className="mt-5 pt-5 border-t border-border/40">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[color:var(--brand-cyan)]" />
            Protections anti-perte
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Consecutive losses */}
            <Field label="Pertes consécutives max">
              <input
                type="number"
                min={1}
                max={10}
                step={1}
                value={config.maxConsecutiveLosses}
                disabled={running}
                onChange={(e) => patchConfig("maxConsecutiveLosses", Number(e.target.value))}
                className="cfg-input"
              />
              <p className="mt-0.5 text-xs text-muted-foreground">Arrêt immédiat après N pertes d'affilée</p>
            </Field>

            {/* Max volatility */}
            <Field label="Volatilité max (ATR %)">
              <select
                value={config.maxVolatilityPct}
                disabled={running}
                onChange={(e) => patchConfig("maxVolatilityPct", Number(e.target.value))}
                className="cfg-input"
              >
                <option value={2}>2% (prudent)</option>
                <option value={3}>3%</option>
                <option value={4}>4% (équilibré)</option>
                <option value={6}>6% (agressif)</option>
              </select>
              <p className="mt-0.5 text-xs text-muted-foreground">Arrêt si le marché devient trop volatil</p>
            </Field>

            {/* Premium only */}
            <Field label="Positions PREMIUM uniquement">
              <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {config.premiumOnly ? "Activé" : "Désactivé"}
                </span>
                <Switch
                  checked={config.premiumOnly}
                  disabled={running}
                  onCheckedChange={(v) => patchConfig("premiumOnly", v)}
                />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ne trade que les signaux les plus favorables (grade PREMIUM)
              </p>
            </Field>

            {/* Stop on risk */}
            <Field label="Arrêt immédiat sur risque">
              <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {config.stopOnRisk ? "Activé" : "Désactivé"}
                </span>
                <Switch
                  checked={config.stopOnRisk}
                  disabled={running}
                  onCheckedChange={(v) => patchConfig("stopOnRisk", v)}
                />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Stoppe tout + notification dès qu'un danger est détecté
              </p>
            </Field>

            {/* Adaptive stake */}
            <Field label="Mise adaptative (Kelly)">
              <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                <span className="text-sm text-muted-foreground">
                  {config.adaptiveStake ? "Activée" : "Désactivée"}
                </span>
                <Switch
                  checked={config.adaptiveStake}
                  disabled={running}
                  onCheckedChange={(v) => patchConfig("adaptiveStake", v)}
                />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Réduit la mise si win rate &lt; 55% (jusqu'à -75%)
              </p>
            </Field>

            {/* Trading sessions */}
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                Sessions de trading autorisées
              </label>
              <div className="flex flex-wrap gap-2">
                {(["asia", "london", "newyork"] as TradingSession[]).map((s) => {
                  const active = config.tradingSessions.includes(s);
                  const isOpen = activeSessions.includes(s);
                  return (
                    <button
                      key={s}
                      disabled={running}
                      onClick={() => {
                        const next = active
                          ? config.tradingSessions.filter((x) => x !== s)
                          : [...config.tradingSessions, s];
                        if (next.length === 0) return;
                        patchConfig("tradingSessions", next);
                      }}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors text-left",
                        active
                          ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]"
                          : "border-border text-muted-foreground hover:text-foreground",
                        running && "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <div>{SESSION_HOURS[s].label}</div>
                      <div className="text-xs opacity-70">
                        {SESSION_HOURS[s].open}h–{SESSION_HOURS[s].close}h UTC
                        {isOpen ? " · Ouvert" : ""}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Les cryptos (BTC, ETH) ignorent ce filtre — elles tradent 24h/24.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Trade log */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <button
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/10 transition-colors"
          onClick={() => setShowLogs((v) => !v)}
        >
          <span>Journal des trades ({logs.length})</span>
          {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {showLogs && (
          <div>
            {logs.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Aucun trade — démarre le bot pour commencer.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Heure</th>
                      <th className="px-4 py-2.5 text-left">Paire</th>
                      <th className="px-4 py-2.5 text-center">Direction</th>
                      <th className="px-4 py-2.5 text-right">Mise</th>
                      <th className="px-4 py-2.5 text-right">Conf.</th>
                      <th className="px-4 py-2.5 text-right">TF</th>
                      <th className="px-4 py-2.5 text-right">P&L</th>
                      <th className="px-4 py-2.5 text-center">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((t) => (
                      <tr key={t.id} className="border-t border-border/40">
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {new Date(t.time).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-2 font-medium text-xs">
                          {t.status === "cooldown" || t.status === "risk-stop"
                            ? <span className="text-muted-foreground italic">{t.note}</span>
                            : SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold",
                            t.direction === "CALL"
                              ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                              : "bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
                          )}>
                            {t.direction === "CALL"
                              ? <TrendingUp className="h-3 w-3" />
                              : <TrendingDown className="h-3 w-3" />}
                            {t.direction}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">${t.stake}</td>
                        <td className="px-4 py-2 text-right text-xs">{t.confidence}%</td>
                        <td className="px-4 py-2 text-right text-xs">{t.tfAgreement}/4</td>
                        <td className={cn(
                          "px-4 py-2 text-right font-semibold",
                          t.profit > 0
                            ? "text-[color:var(--bull)]"
                            : t.profit < 0
                              ? "text-[color:var(--bear)]"
                              : "text-muted-foreground",
                        )}>
                          {t.profit !== 0 ? `${t.profit > 0 ? "+" : ""}$${t.profit.toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <StatusBadge status={t.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {logs.length > 0 && (
                  <div className="flex justify-end px-4 py-2">
                    <button
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Effacer le journal ?",
                          description: "Tout l'historique des trades sera supprimé définitivement.",
                          confirmLabel: "Effacer",
                          danger: true,
                        });
                        if (!ok) return;
                        localStorage.removeItem("lio23.autotrader_log");
                        setLogs([]);
                      }}
                      className="text-xs text-muted-foreground hover:text-[color:var(--bear)] transition-colors"
                    >
                      Effacer le journal
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disclaimer modal */}
      {showDisclaimer && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-sm p-4">
          <div className="glass-panel w-full max-w-md rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-[color:var(--bear)]/10 text-[color:var(--bear)]">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-bold">Confirmation requise</h2>
            </div>
            <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
              <p>Avant d'activer le trading automatique, tu dois comprendre et accepter :</p>
              <ul className="space-y-2">
                {[
                  "Aucun algorithme ne garantit des gains — des pertes sont inévitables.",
                  "Les signaux sont basés sur des indicateurs techniques passés, pas sur le futur.",
                  "Le circuit-breaker limite les pertes mais ne les élimine pas.",
                  "En mode LIVE, du vrai argent est engagé à chaque trade.",
                  "LIO23 est un outil d'analyse, pas un conseiller financier agréé.",
                ].map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[color:var(--bear)]" />
                    {t}
                  </li>
                ))}
              </ul>
              <p className="font-semibold text-foreground">
                En cliquant "J'accepte", tu confirmes avoir lu et compris ces risques.
              </p>
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowDisclaimer(false)}>
                Annuler
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-semibold"
                onClick={acceptDisclaimer}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                J'accepte — Démarrer
              </Button>
            </div>
          </div>
        </div>
      )}

      <style>{`.cfg-input { width:100%; border-radius:6px; border:1px solid var(--border); background:var(--background); padding:8px 12px; font-size:14px; color:var(--foreground); }`}</style>

      <ConfirmDialog state={confirmState} />
    </div>
  );
}

function StatusBadge({ status }: { status: TradeLog["status"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:  { label: "En attente", cls: "bg-muted/40 text-muted-foreground" },
    open:     { label: "Ouvert",     cls: "bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)] animate-pulse" },
    won:      { label: "Gagné ✓",   cls: "bg-[color:var(--bull)]/10 text-[color:var(--bull)]" },
    lost:     { label: "Perdu ✗",   cls: "bg-[color:var(--bear)]/10 text-[color:var(--bear)]" },
    error:    { label: "Erreur",     cls: "bg-muted/40 text-muted-foreground" },
    cooldown: { label: "⏸ Cooldown", cls: "bg-amber-500/10 text-amber-400" },
    "risk-stop": { label: "🛑 Arrêt risque", cls: "bg-[color:var(--bear)]/15 text-[color:var(--bear)]" },
  };
  const { label, cls } = map[status] ?? map.pending;
  return (
    <span className={cn("inline-flex rounded-md px-2 py-0.5 text-xs font-medium", cls)}>
      {label}
    </span>
  );
}

function Kpi({ label, value, tone, sub }: { label: string; value: string; tone: string; sub?: string }) {
  const cls =
    tone === "bull" ? "text-[color:var(--bull)]"
    : tone === "bear" ? "text-[color:var(--bear)]"
    : tone === "cyan" ? "text-[color:var(--brand-cyan)]"
    : tone === "violet" ? "text-[color:var(--brand-violet)]"
    : "text-foreground";
  return (
    <div className="glass-panel rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-2 text-2xl font-bold tracking-tight", cls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
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
