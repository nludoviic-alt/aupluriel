import { KpiCard } from "@/components/kpi-card";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FlaskConical,
  Globe,
  Power,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

function playWinSound() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx() as AudioContext;
    if (ctx.state === "suspended") {
      ctx.resume();
    }
    
    // Notes : C5, E5, G5, C6 (Arpège ascendant avec un carillon métallique scintillant)
    const notes = [
      { freq: 523.25, delay: 0, dur: 0.4 },   // C5
      { freq: 659.25, delay: 0.08, dur: 0.4 }, // E5
      { freq: 783.99, delay: 0.16, dur: 0.4 }, // G5
      { freq: 1046.50, delay: 0.24, dur: 0.6 }, // C6
    ];
    
    notes.forEach(({ freq, delay, dur }) => {
      // 1. Oscillateur principal sinusoïdal pour un son pur
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      
      // 2. Oscillateur secondaire triangulaire (une octave plus haut, gain très faible pour l'attaque "clochette/pièce")
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.type = "triangle";
      osc2.frequency.setValueAtTime(freq * 2, ctx.currentTime + delay);
      
      const t = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      
      gain2.gain.setValueAtTime(0, t);
      gain2.gain.linearRampToValueAtTime(0.04, t + 0.005);
      gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.15); // décroissance ultra rapide pour l'attaque métallique
      
      osc.start(t);
      osc.stop(t + dur + 0.1);
      
      osc2.start(t);
      osc2.stop(t + dur + 0.1);
    });
  } catch {}
}
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SYMBOLS } from "@/lib/deriv";
import {
  addToCumulativePnl,
  backtestMultiTf,
  computeAdaptiveStake,
  CORRELATION_GROUPS,
  countConsecutiveLosses,
  currentActiveSessions,
  DEFAULT_CONFIG,
  deleteCustomPreset,
  dismissTrade,
  forceDemoTrade,
  isCallPutAvailable,
  isInTradingSession,
  loadCumulativePnl,
  loadCustomPresets,
  loadTradeLogCached,
  openPreviewTrade,
  reconcileOpenTrades,
  saveBacktestStats,
  PRUDENT_CONFIG,
  PRESETS,
  SCAN_INTERVAL_MS,
  saveCurrentAsPreset,
  SESSION_HOURS,
  startAutoTrader,
  todayPnl,
  todayTradeCount,
  type AutoTraderConfig,
  type CustomPreset,
  type MultiTfBacktestResult,
  type PresetConfig,
  type RiskProfile,
  type ScanResult,
  type TradingMode,
  type TradingSession,
  type TradeLog,
} from "@/lib/autotrader";
import { loadDefaultStake, saveDefaultStake } from "@/lib/stake";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { AmountInput } from "@/components/amount-input";
import { VOICE_ACTION_EVENT } from "@/components/voice-control";
import { activeStrategySymbols } from "@/lib/strategies";
import { getComponentBreakdown } from "@/lib/indicator-weights";
import { LiveTradeCard } from "@/components/live-trade-card";
import { BotDashboard } from "@/components/bot-dashboard";
import { useDerivSession, refreshDerivBalance, reinitDerivSession } from "@/hooks/use-deriv-session";

export const Route = createFileRoute("/autotrader")({
  head: () => ({ meta: [{ title: "Auto-Trader — Vertex" }] }),
  component: AutoTraderPage,
});

const CONFIG_KEY = "lio23.autotrader_config";

// Crypto pairs only offer multiplier contracts on the Deriv Options API —
// migrate saved watchlists to the equivalent Volatility indices (tradables 24/7).
const CRYPTO_MIGRATION: Record<string, string> = {
  cryBTCUSD: "R_100",
  cryETHUSD: "R_75",
  cryLTCUSD: "R_50",
};

function loadConfig(): AutoTraderConfig {
  try {
    const cfg: AutoTraderConfig = {
      ...DEFAULT_CONFIG,
      stakeUsd: loadDefaultStake(),
      ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}"),
    };
    const migrated = [...new Set(cfg.symbols.map((s) => CRYPTO_MIGRATION[s] ?? s))];
    if (migrated.some((s, i) => s !== cfg.symbols[i]) || migrated.length !== cfg.symbols.length) {
      cfg.symbols = migrated;
      saveConfig(cfg);
      toast.info("Paires crypto remplacées par les indices Volatility — CALL/PUT indisponible sur crypto");
    }
    return cfg;
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
  const [showWeights, setShowWeights] = useState(false);
  const [activeSessions, setActiveSessions] = useState<TradingSession[]>([]);
  const [riskStopReasons, setRiskStopReasons] = useState<string[]>([]);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const lastPendingToastRef = useRef<number>(0);
  const [presetDesc, setPresetDesc] = useState("");
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [cumulativePnl, setCumulativePnl] = useState(0);
  const [forcingTrade, setForcingTrade] = useState(false);
  const [forceSymbol, setForceSymbol] = useState("");
  const [forceDir, setForceDir] = useState<"CALL" | "PUT">("CALL");
  const [forceStake, setForceStake] = useState(DEFAULT_CONFIG.stakeUsd);
  const [draftDuration, setDraftDuration] = useState(DEFAULT_CONFIG.durationMinutes);
  const [draftMaxTrades, setDraftMaxTrades] = useState(DEFAULT_CONFIG.maxTradesPerDay);
  const [showSaveParams, setShowSaveParams] = useState(false);
  const [logFilter, setLogFilter] = useState<"all" | "won" | "lost" | "open" | "error">("all");
  const [showConfig, setShowConfig] = useState(false);
  const [configTab, setConfigTab] = useState<"profiles" | "params" | "risk" | "backtest">("profiles");
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestResults, setBacktestResults] = useState<Record<string, MultiTfBacktestResult & { symbol: string }>>({});
  const stopRef = useRef<(() => void) | null>(null);
  const balanceRef = useRef<number | undefined>(undefined);
  const { confirmState, confirm } = useConfirm();
  const derivSession = useDerivSession(config.mode === "demo" || config.mode === "live");

  // Keep balanceRef in sync with the live Deriv balance
  useEffect(() => { balanceRef.current = derivSession.balance ?? undefined; }, [derivSession.balance]);

  // Réconcilie les positions réelles avec Deriv après chaque (re)connexion :
  // re-suit les contrats encore ouverts, règle ceux fermés pendant l'absence.
  useEffect(() => {
    if (!derivSession.connected) return;
    reconcileOpenTrades((log) => {
      setLogs((prev) => {
        const exists = prev.find((l) => l.id === log.id);
        if (exists) return prev.map((l) => (l.id === log.id ? log : l));
        return [log, ...prev].slice(0, 50);
      });
      if (log.status === "won" || log.status === "lost") {
        setCumulativePnl(loadCumulativePnl());
        refreshDerivBalance();
      }
    }).catch(() => {});
  }, [derivSession.connected]);

  useEffect(() => {
    // Load custom presets
    setCustomPresets(loadCustomPresets());

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
    setDraftDuration(loaded.durationMinutes);
    setDraftMaxTrades(loaded.maxTradesPerDay);
    setForceSymbol(loaded.symbols[0] ?? "R_100");
    setForceStake(loaded.stakeUsd);
    setLogs(loadTradeLogCached());
    setCumulativePnl(loadCumulativePnl());
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
    const closedLogs = logs.filter((l) => l.status === "won" || l.status === "lost");
    const wins = logs.filter((l) => l.status === "won").length;
    const losses = logs.filter((l) => l.status === "lost").length;
    const errors = logs.filter((l) => l.status === "error").length;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
    const totalWon = closedLogs.filter((l) => l.status === "won").reduce((s, l) => s + l.profit, 0);
    const totalLost = closedLogs.filter((l) => l.status === "lost").reduce((s, l) => s + l.profit, 0);
    const openTradeList = logs.filter((l) => l.status === "open");
    const consecutiveLosses = countConsecutiveLosses(logs);
    const effectiveStake = config.adaptiveStake ? computeAdaptiveStake(config.stakeUsd, logs) : config.stakeUsd;
    return { pnl, tradeCount, wins, losses, errors, winRate, totalWon, totalLost, openTradeList, consecutiveLosses, effectiveStake };
  }, [logs, config.adaptiveStake, config.stakeUsd]);

  const { pnl, tradeCount, wins, losses, errors, winRate, totalWon, totalLost, openTradeList, consecutiveLosses, effectiveStake } = stats;
  const openTrades = openTradeList.length;

  // Reads localStorage per configured symbol (indicator-weights.ts) — only recompute
  // when the watchlist changes or a trade closes (logs update), not on every render.
  const breakdowns = useMemo(() => {
    return config.symbols
      .map((sym) => ({ sym, rows: getComponentBreakdown(sym) }))
      .filter((b) => b.rows.length > 0);
  }, [config.symbols, logs]);

  function patchConfig<K extends keyof AutoTraderConfig>(k: K, v: AutoTraderConfig[K]) {
    const next = { ...config, [k]: v };
    setConfig(next);
    saveConfig(next);
  }

  const handleEvent = useCallback((log: TradeLog, meta?: { cooldownUntil?: number }) => {
    // Optimized: append to existing state instead of reloading all logs
    setLogs((prev) => {
      const exists = prev.find((l) => l.id === log.id);
      if (exists) {
        // Update existing
        return prev.map((l) => (l.id === log.id ? log : l));
      }
      // Add new (keep max 50)
      return [log, ...prev].slice(0, 50);
    });
    if (log.status === "won") {
      playWinSound();
      toast.success(`✅ ${log.symbol} — Gagné +$${log.profit.toFixed(2)}`);
      
      // Notification de bureau native (HTML5 API) pour alerter en tâche de fond
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(`🎯 LIO23 : Trade GAGNANT ! (+ $${log.profit.toFixed(2)})`, {
          body: `La position sur ${log.symbol} s'est clôturée avec succès (${config.mode.toUpperCase()}).`,
        });
      }
      
      setCumulativePnl(loadCumulativePnl());
      if (config.mode === "demo" || config.mode === "live") refreshDerivBalance();
    }
    if (log.status === "lost") {
      toast.error(`❌ ${log.symbol} — Perdu -$${Math.abs(log.profit).toFixed(2)}`);
      setCumulativePnl(loadCumulativePnl());
      if (config.mode === "demo" || config.mode === "live") refreshDerivBalance();
    }
    if (log.status === "error") toast.error(`⚠️ Erreur sur ${log.symbol}`);
    if (log.status === "pending") {
      // Throttle pending toasts - max 1 per 5 seconds to prevent spam
      const now = Date.now();
      if (now - lastPendingToastRef.current > 5000) {
        lastPendingToastRef.current = now;
        toast.info(`🎯 ${log.symbol} ${log.direction} — Trade détecté`);
      }
    }
    if (log.status === "cooldown") {
      toast.warning(`⏸ ${log.note}`);
    }
  }, [config.mode]);

  const handleRiskStop = useCallback((reasons: string[]) => {
    setRunning(false);
    setRiskStopReasons(reasons);
    setLogs(loadTradeLogCached());
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
      if ((config.mode === "demo" || config.mode === "live") && !derivSession.connected) {
        if (derivSession.connecting) {
          toast.info("Connexion Deriv en cours, réessaie dans quelques secondes…");
        } else {
          toast.error("Session Deriv non connectée — clique 'Reconnecter' dans le panneau de configuration");
          reinitDerivSession();
        }
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
      stopRef.current = startAutoTrader(effectiveConfig, handleEvent, handleRiskStop, (scan) => setLastScan(scan), () => balanceRef.current);
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

  async function runBacktest() {
    setBacktestRunning(true);
    setBacktestResults({});
    const results: Record<string, MultiTfBacktestResult & { symbol: string }> = {};
    for (const sym of config.symbols) {
      try {
        const result = await backtestMultiTf(sym, {
          minConfidence: config.minConfidence,
          minTfAgreement: config.minTfAgreement,
          durationMinutes: config.durationMinutes,
          stakeUsd: config.stakeUsd,
        });
        results[sym] = { ...result, symbol: sym };
        // Feed the measured win-rate/payout into the persisted store so "Kelly"
        // stake sizing has real data to size positions from instead of guessing.
        if (result.trades > 0) {
          saveBacktestStats(sym, { winRate: result.winRate, payoutPct: result.payoutPct, trades: result.trades });
        }
      } catch {
        // skip failed symbols silently
      }
    }
    setBacktestResults(results);
    setBacktestRunning(false);
    const total = Object.values(results).reduce((s, r) => s + r.trades, 0);
    toast.success(`Backtest terminé — ${total} trades simulés sur ${config.symbols.length} paires`);
  }

  function acceptDisclaimer() {
    localStorage.setItem("lio23.disclaimer_accepted", "1");
    setDisclaimerAccepted(true);
    setShowDisclaimer(false);
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
    setRiskStopReasons([]);
    const stratSymbols = activeStrategySymbols();
    const mergedSymbols = [...new Set([...config.symbols, ...stratSymbols])];
    const effectiveConfig = mergedSymbols.length > config.symbols.length
      ? { ...config, symbols: mergedSymbols }
      : config;
    if (stratSymbols.length) toast.info(`${stratSymbols.length} paire(s) ajoutée(s) via Stratégies actives`);
    stopRef.current = startAutoTrader(effectiveConfig, handleEvent, handleRiskStop, (scan) => setLastScan(scan), () => balanceRef.current);
    setRunning(true);
    toast.success(`Auto-trader démarré en mode ${config.mode.toUpperCase()}`);
  }

  // ── derived helpers ─────────────────────────────────────────────────────────
  // Power button: always green when running, gold on hover when stopped
  const modeGlow = running
    ? "shadow-[0_0_56px_rgba(34,197,94,0.45)]"
    : "shadow-[0_0_32px_rgba(255,215,0,0.18)] hover:shadow-[0_0_60px_rgba(255,215,0,0.35)]";

  const modeRing = running
    ? "ring-2 ring-up/60"
    : "ring-1 ring-primary/30 hover:ring-primary/60";

  const modeIcon = running ? "text-up" : "text-primary";

  const modeBg = running
    ? "bg-up/12"
    : "bg-primary/10 hover:bg-primary/18";

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none">Auto-Trader</h1>
            <p className="text-sm text-muted-foreground mt-1">Algorithme multi-indicateurs · 4 timeframes · Patterns japonais</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={running}
            onClick={() => { const next = { ...config, ...PRUDENT_CONFIG }; setConfig(next); saveConfig(next);
              setDraftDuration(next.durationMinutes); setDraftMaxTrades(next.maxTradesPerDay);
              toast.success("🛡️ Mode Prudent activé", { description: "DEMO · PREMIUM · 4/4 TF · confiance ≥82% · max 5 trades/jour" }); }}
            className="gap-2 text-sm border-up/40 text-up hover:bg-up/10 h-9 px-4">
            <ShieldCheck className="h-4 w-4" /> Mode Prudent
          </Button>
          <Button variant="outline" size="sm"
            disabled={config.symbols.every((s) => openTradeList.some((t) => t.symbol === s))}
            onClick={async () => {
              const openSymbols = new Set(openTradeList.map((t) => t.symbol));
              const sym = config.symbols.find((s) => !openSymbols.has(s));
              if (!sym) { toast.error("Toutes les paires ont déjà une position ouverte."); return; }
              toast.info(`🎬 Aperçu — ${SYMBOLS.find((x) => x.deriv === sym)?.label ?? sym}…`);
              await openPreviewTrade(sym, config.durationMinutes, config.stakeUsd, handleEvent);
            }}
            className="gap-2 text-sm h-9 px-4">
            <Activity className="h-4 w-4" /> Aperçu live
          </Button>
        </div>
      </div>

      {/* ── Alert banners ── */}
      {riskStopReasons.length > 0 && (
        <div className="rounded-xl border border-down/40 bg-down/8 p-5 flex gap-4">
          <ShieldAlert className="h-6 w-6 shrink-0 text-down mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold uppercase tracking-wide text-down mb-2">🛑 Bot arrêté — risque détecté</div>
            {riskStopReasons.map((r, i) => <div key={i} className="text-sm text-foreground">• {r}</div>)}
            <p className="mt-2 text-xs text-muted-foreground">Vérifie les conditions avant de relancer.</p>
          </div>
          <button onClick={() => setRiskStopReasons([])} className="text-muted-foreground hover:text-foreground text-xl leading-none shrink-0">×</button>
        </div>
      )}
      {config.mode === "simulation" && derivSession.connected && !running && (
        <div className="rounded-xl border border-up/30 bg-up/6 p-4 flex items-center gap-4">
          <span className="text-2xl shrink-0">🎮</span>
          <div className="flex-1">
            <span className="text-sm font-semibold text-up">Deriv est connecté</span>
            <span className="text-sm text-muted-foreground ml-2">— passe en mode Demo pour envoyer de vraies positions (argent de test)</span>
          </div>
          <button
            onClick={() => { patchConfig("mode", "demo"); toast.success("Mode Demo activé — trades réels sur compte démo Deriv"); }}
            className="shrink-0 rounded-lg bg-up/20 px-4 py-2 text-sm font-semibold text-up hover:bg-up/30 transition-colors">
            Passer en Demo
          </button>
        </div>
      )}

      <CooldownBanner lastScan={lastScan} />

      {/* ── KPI strip — pleine largeur ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Fonds disponibles"
          value={(config.mode === "demo" || config.mode === "live") && derivSession.balance !== null
            ? `$${derivSession.balance.toFixed(2)}`
            : `$${(config.initialCapital + cumulativePnl).toFixed(2)}`}
          tone={cumulativePnl >= 0 ? "bull" : "bear"}
          delta={(config.mode === "demo" || config.mode === "live") && derivSession.balance !== null
            ? `${config.mode.toUpperCase()} · ${derivSession.currency}`
            : `cumul ${cumulativePnl >= 0 ? "+" : ""}$${cumulativePnl.toFixed(2)}`}
        />
        <KpiCard
          label="P&L Aujourd'hui"
          value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
          tone={pnl >= 0 ? "bull" : "bear"}
          delta={`Gains $${totalWon.toFixed(2)} · Pertes $${Math.abs(totalLost).toFixed(2)}`}
        />
        <KpiCard
          label="Win Rate"
          value={wins + losses > 0 ? `${winRate.toFixed(0)}%` : "—"}
          tone={winRate >= 55 ? "bull" : winRate >= 45 ? "cyan" : wins + losses > 0 ? "bear" : "default"}
          delta={`${wins} gagnés · ${losses} perdus · ${tradeCount} total`}
        />
        <KpiCard
          label="Limite de perte"
          value={`${Math.round((Math.abs(Math.min(0, pnl)) / config.maxDailyLossUsd) * 100)}%`}
          tone={Math.abs(pnl) > config.maxDailyLossUsd * 0.7 ? "bear" : Math.abs(pnl) > config.maxDailyLossUsd * 0.4 ? "bear" : "default"}
          delta={`$${Math.abs(Math.min(0, pnl)).toFixed(0)} utilisés / $${config.maxDailyLossUsd} max`}
        />
      </div>

      {/* ── Main 2-col layout ── */}
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">

        {/* ── LEFT: Control panel ── */}
        <div className="space-y-4">

          {/* Bloc contrôle principal */}
          <div className="glass-panel rounded-2xl overflow-hidden">

            {/* Mode selector — 3 colonnes égales */}
            <div className="grid grid-cols-3 border-b border-border/40">
              {(["simulation", "demo", "live"] as TradingMode[]).map((m) => {
                const isSelected = config.mode === m;
                return (
                  <button key={m} disabled={running} onClick={() => patchConfig("mode", m)}
                    className={cn(
                      "flex flex-col items-center gap-1.5 py-4 text-center transition-all duration-200 border-r last:border-r-0 border-border/40",
                      isSelected
                        ? m === "live" ? "bg-down/10 text-down" : m === "demo" ? "bg-up/10 text-up" : "bg-muted/30 text-foreground"
                        : "text-muted-foreground hover:bg-muted/10 hover:text-foreground",
                      running && "opacity-40 cursor-not-allowed pointer-events-none",
                    )}>
                    <span className="text-xl leading-none">{m === "simulation" ? "🧪" : m === "demo" ? "🎮" : "⚡"}</span>
                    <span className="text-xs font-bold uppercase tracking-wider leading-none">
                      {m === "simulation" ? "Simu" : m === "demo" ? "Démo" : "Live"}
                    </span>
                    {isSelected && (
                      <span className={cn("h-0.5 w-8 rounded-full", m === "live" ? "bg-down" : m === "demo" ? "bg-up" : "bg-muted-foreground")} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Power button + statuts */}
            <div className="p-6 flex flex-col items-center gap-5">
              <div className="relative w-32 h-32">
                {running && <span className="absolute inset-0 rounded-full animate-ping bg-up opacity-20" />}
                <button onClick={toggleEngine}
                  className={cn("relative w-full h-full rounded-full flex items-center justify-center transition-all duration-300 group", modeBg, modeRing, modeGlow)}>
                  <Power className={cn("h-12 w-12 transition-transform duration-200 group-hover:scale-110", modeIcon)} />
                </button>
              </div>

              {/* Statuts */}
              <div className="w-full space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-muted/15 px-4 py-2.5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Statut</span>
                  <span className={cn("text-sm font-bold", running ? "text-up" : "text-muted-foreground")}>
                    {running ? "● Actif" : "○ Arrêté"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/15 px-4 py-2.5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Mode</span>
                  <span className={cn("text-sm font-bold",
                    config.mode === "live" ? "text-down" : config.mode === "demo" ? "text-up" : "text-muted-foreground")}>
                    {config.mode === "simulation" ? "🧪 Simulation" : config.mode === "demo" ? "🎮 Démo" : "⚡ Live Réel"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/15 px-4 py-2.5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Paires</span>
                  <span className="text-sm font-bold text-foreground">{config.symbols.length} surveillées</span>
                </div>
                {config.mode !== "simulation" && (
                  <div className="flex items-center justify-between rounded-lg bg-muted/15 px-4 py-2.5">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Deriv</span>
                    <span className={cn("text-sm font-bold flex items-center gap-2",
                      derivSession.connected ? "text-up" : derivSession.connecting ? "text-amber-400" : "text-down")}>
                      <span className={cn("h-2 w-2 rounded-full",
                        derivSession.connected ? "bg-up" : derivSession.connecting ? "bg-amber-400 animate-pulse" : "bg-down")} />
                      {derivSession.connected
                        ? derivSession.balance !== null ? `$${derivSession.balance.toFixed(2)}` : "Connecté"
                        : derivSession.connecting ? "Connexion…"
                        : <button onClick={reinitDerivSession} className="underline">Reconnecter</button>}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Force Trade panel — toujours visible en mode demo/live pour éviter les clignotements de l'interface */}
          {(config.mode === "demo" || config.mode === "live") && (
            <div className={cn("glass-panel rounded-xl px-4 py-3 border border-amber-500/20 transition-all duration-300",
              !derivSession.connected && "opacity-60")}>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3 w-3 text-amber-400" />
                  <span className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold">Test pipeline Deriv</span>
                </div>
                {!derivSession.connected && (
                  <span className="text-[9px] bg-muted/40 text-amber-400/80 px-1.5 py-0.5 rounded font-medium animate-pulse">Déconnecté</span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground mb-3 leading-relaxed">
                Ouvre un vrai trade immédiatement, sans vérification de signal. Vérifie que la connexion Deriv fonctionne de bout en bout.
              </p>
              <div className="space-y-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <select
                    value={forceSymbol}
                    disabled={!derivSession.connected || forcingTrade}
                    onChange={(e) => setForceSymbol(e.target.value)}
                    className="w-full sm:flex-1 h-9 rounded-lg border border-border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
                  >
                    {config.symbols.map((s) => (
                      <option key={s} value={s}>{SYMBOLS.find((x) => x.deriv === s)?.label ?? s}</option>
                    ))}
                  </select>
                  <div className="flex rounded-lg border border-border overflow-hidden h-9 w-full sm:w-auto shrink-0">
                    {(["CALL", "PUT"] as const).map((d) => (
                      <button key={d}
                        disabled={!derivSession.connected || forcingTrade}
                        onClick={() => setForceDir(d)}
                        className={cn("flex-1 sm:flex-none sm:px-3 py-1.5 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                          forceDir === d
                            ? d === "CALL" ? "bg-up/20 text-up" : "bg-down/20 text-down"
                            : "text-muted-foreground hover:text-foreground")}>
                        {d === "CALL" ? "▲ CALL" : "▼ PUT"}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Mise pour ce trade forcé ($)">
                  <AmountInput value={forceStake} min={1} max={100} step={1} disabled={!derivSession.connected || forcingTrade}
                    onCommit={async (v) => {
                      if (config.mode === "live") {
                        const ok = await confirm({ title: "Confirmer la mise ?", description: `Trade forcé à $${v} (argent réel).`, confirmLabel: "Confirmer", danger: true });
                        if (!ok) return false;
                      }
                      setForceStake(v);
                      return true;
                    }} />
                </Field>
                <Button
                  size="sm"
                  disabled={!derivSession.connected || forcingTrade}
                  onClick={async () => {
                    if (!forceSymbol) return;
                    setForcingTrade(true);
                    const label = SYMBOLS.find((x) => x.deriv === forceSymbol)?.label ?? forceSymbol;
                    toast.info(`🚀 Trade forcé en cours — ${label} ${forceDir}…`);
                    try {
                      await forceDemoTrade(forceSymbol, forceDir, forceStake, config.durationMinutes, (log) => {
                        handleEvent(log);
                        if (log.status === "open") toast.success(`✅ Contrat ouvert — ${label} ${forceDir} · ID ${log.contractId}`);
                      });
                    } catch (e) {
                      toast.error(`Échec: ${(e as Error).message}`);
                    } finally {
                      setForcingTrade(false);
                    }
                  }}
                  className="w-full gap-1.5 text-xs h-8 bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:bg-muted/10 disabled:text-muted-foreground disabled:border-border disabled:cursor-not-allowed">
                  {forcingTrade
                    ? <><Activity className="h-3.5 w-3.5 animate-pulse" /> Envoi en cours…</>
                    : !derivSession.connected
                    ? <><Zap className="h-3.5 w-3.5" /> Connexion Deriv requise</>
                    : <><Zap className="h-3.5 w-3.5" /> Forcer un trade (${forceStake})</>}
                </Button>
              </div>
            </div>
          )}

          {/* Sessions marchés */}
          <div className="glass-panel rounded-xl px-4 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sessions marchés</span>
            </div>
            <div className="space-y-2">
              {(["sydney", "asia", "london", "newyork"] as TradingSession[]).map((s) => {
                const isActive = activeSessions.includes(s);
                const inCfg = config.tradingSessions.includes(s);
                return (
                  <div key={s} className="flex items-center justify-between rounded-lg bg-muted/10 px-4 py-2.5">
                    <span className="text-sm text-muted-foreground font-medium">{SESSION_HOURS[s].label}</span>
                    <span className={cn("text-xs font-bold",
                      isActive && inCfg ? "text-up" : isActive ? "text-muted-foreground" : "text-muted-foreground/40")}>
                      {isActive && inCfg ? "● Ouverte & active" : isActive ? "● Ouverte" : "○ Fermée"}
                    </span>
                  </div>
                );
              })}
              {config.adaptiveStake && effectiveStake < config.stakeUsd && (
                <div className="flex items-center justify-between rounded-lg bg-amber-500/10 px-4 py-2.5">
                  <span className="text-sm text-amber-400 font-semibold">Mise Kelly réduite</span>
                  <span className="text-sm font-bold text-amber-400">${effectiveStake.toFixed(2)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── RIGHT: Dashboard + positions ── */}
        <div className="space-y-5 min-w-0">
          <BotDashboard logs={logs} lastScan={lastScan} config={config} running={running} pnl={pnl} />

          {openTradeList.length > 0 ? (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="h-2.5 w-2.5 rounded-full bg-up animate-pulse" />
                <h2 className="text-sm font-bold uppercase tracking-wider text-up">Positions en direct ({openTradeList.length})</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {openTradeList.map((t) => (
                  <LiveTradeCard key={t.id} trade={t}
                    onDismiss={() => { setLogs([...dismissTrade(t.id)]); toast.info(`Carte fermée — ${t.symbol}`); }} />
                ))}
              </div>
            </div>
          ) : running ? (
            <div className="glass-panel rounded-2xl p-10 flex flex-col items-center justify-center gap-5 text-center min-h-[200px]">
              <div className="relative">
                <div className="h-14 w-14 rounded-full border-2 border-up/30 border-t-up animate-spin" />
                <Activity className="absolute inset-0 m-auto h-6 w-6 text-up" />
              </div>
              <div>
                <div className="text-base font-semibold text-foreground">En attente de signal</div>
                <div className="text-sm text-muted-foreground mt-1.5">
                  <ScanCountdown lastScan={lastScan} SCAN_INTERVAL_MS={SCAN_INTERVAL_MS} config={config} />
                </div>
              </div>
            </div>
          ) : (
            <div className="glass-panel rounded-2xl p-10 flex flex-col items-center justify-center gap-4 text-center min-h-[200px]">
              <Power className="h-10 w-10 text-muted-foreground/20" />
              <div className="text-sm text-muted-foreground">Lance le bot pour voir les positions en direct</div>
            </div>
          )}
        </div>
      </div>

      {/* ── Config panel (collapsible + tabbed) ── */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <button
          className="flex w-full items-center justify-between px-5 py-4 hover:bg-muted/10 transition-colors"
          onClick={() => setShowConfig((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Configuration</span>
            {running && <span className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-2 py-0.5">Arrête le bot pour modifier</span>}
          </div>
          {showConfig ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showConfig && (
          <div className="border-t border-border/40">
            {/* Tab nav */}
            <div className="flex flex-col gap-3 border-b border-border/40 px-5 pt-3 pb-3 sm:flex-row sm:items-center sm:gap-2 sm:pt-2 sm:pb-0">
              <div className="flex overflow-x-auto scrollbar-none gap-1 -mb-px">
                {([["profiles","Profils"],["params","Paramètres"],["risk","Risque & Sessions"],["backtest","Backtest"]] as const).map(([t, label]) => (
                  <button key={t} onClick={() => setConfigTab(t)}
                    className={cn("px-4 py-3 text-xs font-bold rounded-t-lg transition-colors whitespace-nowrap border-b-2 sm:py-2",
                      configTab === t ? "text-foreground border-primary bg-muted/20" : "text-muted-foreground border-transparent hover:text-foreground")}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="sm:ml-auto pb-1 sm:pb-2 self-center w-full sm:w-auto">
                <button onClick={() => setShowSavePreset(true)} disabled={running}
                  className="flex items-center justify-center gap-1.5 text-xs px-3 py-2.5 w-full sm:w-auto rounded-lg bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40 font-bold sm:text-[10px] sm:px-2 sm:py-1 sm:font-semibold">
                  <Save className="h-4 w-4 sm:h-3 sm:w-3" /> Sauvegarder config
                </button>
              </div>
            </div>

            <div className="p-5">
              {/* TAB: Profils */}
              {configTab === "profiles" && (
                <div className="space-y-4">
                  {/* Test rapide — bouton dédié pour tester le pipeline en démo */}
                  <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-base">🧪</span>
                        <span className="text-sm font-bold">Mode Test Démo</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Seuils très bas (confiance ≥60%, 2/4 TF) pour tester le pipeline Deriv. Utilise uniquement en démo.
                      </p>
                    </div>
                    <button disabled={running}
                      onClick={() => {
                        const next = { ...config, mode: "demo" as TradingMode, minConfidence: 60, minTfAgreement: 2, maxTradesPerDay: 20, premiumOnly: false, stopOnRisk: false, maxConsecutiveLosses: 10 };
                        setConfig(next); saveConfig(next);
                        setDraftMaxTrades(20);
                        toast.success("🧪 Mode Test activé — Démo · confiance ≥60% · 2/4 TF", { description: "Arrête le bot pour changer les seuils" });
                      }}
                      className={cn("w-full sm:w-auto shrink-0 rounded-xl border border-amber-500/50 bg-amber-500/15 px-4 py-2.5 text-xs font-bold text-amber-300 hover:bg-amber-500/25 transition-all sm:py-2 sm:font-semibold",
                        running && "opacity-40 cursor-not-allowed")}>
                      Appliquer
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(Object.keys(PRESETS) as RiskProfile[]).map((key) => {
                      const preset = PRESETS[key];
                      const isActive = config.minConfidence === preset.minConfidence && config.minTfAgreement === preset.minTfAgreement
                        && config.premiumOnly === preset.premiumOnly && config.maxTradesPerDay === preset.maxTradesPerDay
                        && config.maxConsecutiveLosses === preset.maxConsecutiveLosses;
                      return (
                        <button key={key} disabled={running}
                          onClick={() => {
                            const { name, description, emoji, recommendedCapital, targetWinRate, expectedTradesPerDay, ...pc } = preset;
                            const next = { ...config, ...pc, stakeUsd: config.stakeUsd, maxDailyLossUsd: config.maxDailyLossUsd };
                            setConfig(next); saveConfig(next);
                            setDraftDuration(next.durationMinutes);
                            setDraftMaxTrades(next.maxTradesPerDay);
                            toast.success(`${preset.emoji} Profil ${preset.name} appliqué`, { description: `Mise conservée: $${config.stakeUsd}` });
                          }}
                          className={cn("relative rounded-xl border p-4 text-left transition-all",
                            isActive ? key === "conservative" ? "border-yellow-500/60 bg-yellow-500/8"
                              : key === "moderate" ? "border-blue-500/60 bg-blue-500/8" : "border-green-500/60 bg-green-500/8"
                              : "border-border bg-muted/10 hover:border-muted-foreground/40 hover:bg-muted/20",
                            running && "opacity-40 cursor-not-allowed")}>
                          <div className="text-xl mb-2">{preset.emoji}</div>
                          <div className="text-sm font-bold mb-1">{preset.name}</div>
                          <p className="text-xs text-muted-foreground leading-snug mb-3">{preset.description}</p>
                          <div className="flex flex-wrap gap-1">
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground font-medium">{preset.recommendedCapital}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground font-medium">{preset.targetWinRate}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground font-medium">{preset.expectedTradesPerDay}/j</span>
                          </div>
                          {isActive && <div className={cn("absolute top-2 right-2 h-2 w-2 rounded-full",
                            key === "conservative" ? "bg-yellow-500" : key === "moderate" ? "bg-blue-500" : "bg-green-500")} />}
                        </button>
                      );
                    })}
                  </div>
                  {customPresets.length > 0 && (
                    <div className="pt-3 border-t border-border/40">
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Mes presets</div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {customPresets.map((preset) => {
                          const isActive = config.minConfidence === preset.minConfidence && config.minTfAgreement === preset.minTfAgreement
                            && config.premiumOnly === preset.premiumOnly && config.maxTradesPerDay === preset.maxTradesPerDay
                            && config.maxConsecutiveLosses === preset.maxConsecutiveLosses;
                          return (
                            <div key={preset.id} className={cn("relative rounded-xl border p-3 transition-all group",
                              isActive ? "border-primary/60 bg-primary/8" : "border-border bg-muted/10 hover:border-muted-foreground/40")}>
                              <button disabled={running} className="w-full text-left"
                                onClick={() => {
                                  const { id, name, description, emoji, recommendedCapital, targetWinRate, expectedTradesPerDay, createdAt, performance, ...pc } = preset;
                                  setConfig({ ...config, ...pc, stakeUsd: config.stakeUsd, maxDailyLossUsd: config.maxDailyLossUsd });
                                  saveConfig({ ...config, ...pc, stakeUsd: config.stakeUsd, maxDailyLossUsd: config.maxDailyLossUsd });
                                  toast.success(`Preset "${preset.name}" appliqué`);
                                }}>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <span>{preset.emoji}</span>
                                  <span className="text-xs font-semibold truncate">{preset.name}</span>
                                </div>
                                {preset.performance && (
                                  <div className="flex gap-1 mt-1">
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-up/20 text-up">{preset.performance.winRate.toFixed(0)}% win</span>
                                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded", preset.performance.totalProfit >= 0 ? "bg-up/20 text-up" : "bg-down/20 text-down")}>
                                      ${preset.performance.totalProfit.toFixed(2)}
                                    </span>
                                  </div>
                                )}
                              </button>
                              <button onClick={() => { deleteCustomPreset(preset.id); setCustomPresets(loadCustomPresets()); toast.success(`"${preset.name}" supprimé`); }}
                                className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-down/20 text-down transition-all">
                                <Trash2 className="h-3 w-3" />
                              </button>
                              {isActive && <div className="absolute top-2 left-2 h-1.5 w-1.5 rounded-full bg-primary" />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: Paramètres */}
              {configTab === "params" && (
                <div className="space-y-5">
                  {/* Capital */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                    <div className="flex-1 w-full">
                      <Field label="Capital de départ ($)">
                        <AmountInput value={config.initialCapital} min={10} max={100000} step={10} disabled={running}
                          onCommit={async (v) => { patchConfig("initialCapital", v); return true; }} />
                      </Field>
                      <p className="mt-1.5 text-xs text-muted-foreground">Base de calcul des fonds disponibles.</p>
                    </div>
                    <div className="text-left sm:text-right w-full sm:w-auto pt-3 border-t border-border/40 sm:pt-0 sm:border-t-0">
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 font-semibold">Gains cumulés</div>
                      <div className={cn("font-mono-tabular text-2xl font-bold", cumulativePnl >= 0 ? "text-up" : "text-down")}>
                        {cumulativePnl >= 0 ? "+" : ""}${cumulativePnl.toFixed(2)}
                      </div>
                      <button onClick={async () => {
                        const ok = await confirm({ title: "Réinitialiser les gains cumulés ?", description: "Cette action est irréversible.", confirmLabel: "Réinitialiser", danger: true });
                        if (ok) { const { resetCumulativePnl } = await import("@/lib/autotrader"); resetCumulativePnl(); setCumulativePnl(0); toast.success("Gains cumulés réinitialisés"); }
                      }} className="text-xs text-muted-foreground/80 hover:text-down transition-colors mt-1.5 underline decoration-dashed">Remettre à zéro</button>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {/* Stake mode toggle */}
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">Mode de mise</label>
                      <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                        {(["fixed", "percent", "kelly"] as const).map((m) => (
                          <button key={m} disabled={running} onClick={() => patchConfig("stakeMode", m)}
                            className={cn("px-4 py-2 text-xs font-semibold transition-colors",
                              config.stakeMode === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground",
                              running && "opacity-40 cursor-not-allowed")}>
                            {m === "fixed" ? "$ Fixe" : m === "percent" ? "% Capital" : "Kelly"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Field label={config.stakeMode === "percent" ? `Mise par trade (${config.stakePercent}% du capital)` : config.stakeMode === "kelly" ? "Mise Kelly — mise de secours ($)" : "Mise par trade ($)"}>
                      {config.stakeMode === "percent" ? (
                        <div>
                          <input type="range" min={0.5} max={5} step={0.5} value={config.stakePercent} disabled={running}
                            onChange={(e) => patchConfig("stakePercent", Number(e.target.value))} className="w-full accent-primary" />
                          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                            <span>0.5%</span>
                            {derivSession.balance !== null && (
                              <span className="text-primary font-semibold">≈ ${((derivSession.balance * config.stakePercent) / 100).toFixed(2)}</span>
                            )}
                            <span>5%</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-1">Recommandé : 1–2% du capital par trade</p>
                        </div>
                      ) : (
                        <AmountInput value={config.stakeUsd} min={1} max={100} step={1} disabled={running}
                          onCommit={async (v) => {
                            const ok = await confirm({ title: "Modifier la mise ?", description: `$${config.stakeUsd} → $${v} par trade${config.mode === "live" ? " (argent réel)" : ""}`, confirmLabel: "Confirmer", danger: config.mode === "live" });
                            if (ok) { patchConfig("stakeUsd", v); saveDefaultStake(v); toast.success(`Mise: $${v}`); }
                            return ok;
                          }} />
                      )}
                    </Field>
                    {config.stakeMode === "kelly" && (
                      <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-border/60 bg-muted/10 p-3.5">
                        <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">
                          Fraction de Kelly ({(config.kellyFraction * 100).toFixed(0)}%)
                        </label>
                        <input type="range" min={0.1} max={1} step={0.05} value={config.kellyFraction} disabled={running}
                          onChange={(e) => patchConfig("kellyFraction", Number(e.target.value))} className="w-full accent-primary" />
                        <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                          Mise = fraction de Kelly (f* = gain − perte/payout) calculée à partir du win rate et du payout
                          <strong> réellement mesurés au backtest</strong> pour chaque paire — pas une estimation. 50%
                          (demi-Kelly) est recommandé pour amortir l'incertitude d'échantillon. Sans backtest récent
                          (≥20 trades) pour une paire, la mise de secours ($ Fixe) est utilisée à la place.
                        </p>
                      </div>
                    )}
                    <Field label={`Durée contrat${draftDuration !== config.durationMinutes ? " ●" : ""}`}>
                      <select
                        value={draftDuration}
                        disabled={running}
                        onChange={(e) => setDraftDuration(Number(e.target.value))}
                        className={cn("cfg-input transition-colors", draftDuration !== config.durationMinutes && "border-amber-500/60 ring-1 ring-amber-500/30")}
                      >
                        <option value={5}>5 min</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={60}>1 heure</option>
                      </select>
                      {draftDuration !== config.durationMinutes && (
                        <span className="text-[10px] text-amber-400 mt-1 block">
                          Actuellement sauvegardé : {config.durationMinutes} min
                        </span>
                      )}
                    </Field>
                    <Field label={`Trades max / jour${draftMaxTrades !== config.maxTradesPerDay ? " ●" : ""}`}>
                      <div className={cn(draftMaxTrades !== config.maxTradesPerDay && "ring-1 ring-amber-500/30 rounded-lg")}>
                        <AmountInput
                          value={draftMaxTrades}
                          min={1}
                          max={50}
                          step={1}
                          onCommit={(v) => { setDraftMaxTrades(v); return true; }}
                        />
                      </div>
                      {draftMaxTrades !== config.maxTradesPerDay && (
                        <span className="text-[10px] text-amber-400 mt-1 block">
                          Actuellement sauvegardé : {config.maxTradesPerDay}
                        </span>
                      )}
                    </Field>
                    <Field label={`Confiance min (${config.minConfidence}%)`}>
                      <input type="range" min={55} max={95} step={5} value={config.minConfidence} disabled={running}
                        onChange={(e) => patchConfig("minConfidence", Number(e.target.value))} className="w-full accent-primary" />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>55%</span><span>95%</span></div>
                    </Field>
                    <Field label={`Accord TF min (${config.minTfAgreement}/4)`}>
                      <input type="range" min={1} max={4} step={1} value={config.minTfAgreement} disabled={running}
                        onChange={(e) => patchConfig("minTfAgreement", Number(e.target.value))} className="w-full accent-primary" />
                      <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>1 TF</span><span>4 TF</span></div>
                    </Field>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">Mode de scan</label>
                      <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                        {(["watchlist", "all-markets"] as const).map((m) => (
                          <button key={m} disabled={running} onClick={() => patchConfig("symbolMode", m)}
                            className={cn("px-4 py-2 text-xs font-semibold transition-colors",
                              config.symbolMode === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground",
                              running && "opacity-40 cursor-not-allowed")}>
                            {m === "watchlist" ? "Paires choisies" : `Tous les marchés (${SYMBOLS.filter((s) => isCallPutAvailable(s.deriv)).length})`}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1.5 leading-relaxed">
                        {config.symbolMode === "all-markets"
                          ? "Analyse toutes les paires CALL/PUT en parallèle à chaque cycle et trade les meilleures opportunités classées par confiance — les filtres de qualité ci-dessus s'appliquent toujours."
                          : "Ne trade que les paires cochées ci-dessous."}
                      </p>
                    </div>
                    {config.symbolMode === "all-markets" && (
                      <Field label={`Trades max par cycle (${config.maxSimultaneousTrades})`}>
                        <input type="range" min={1} max={10} step={1} value={config.maxSimultaneousTrades} disabled={running}
                          onChange={(e) => patchConfig("maxSimultaneousTrades", Number(e.target.value))} className="w-full accent-primary" />
                        <p className="text-[10px] text-muted-foreground mt-0.5">Limite les nouvelles positions ouvertes en un seul cycle de scan.</p>
                      </Field>
                    )}
                    <div className={cn("sm:col-span-2 lg:col-span-1", config.symbolMode === "all-markets" && "opacity-40 pointer-events-none")}>
                      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">Paires surveillées</label>
                      <div className="flex flex-wrap gap-1.5">
                        {SYMBOLS.map((s) => {
                          const active = config.symbols.includes(s.deriv);
                          return (
                            <button key={s.deriv} disabled={running || config.symbolMode === "all-markets"}
                              onClick={() => { const next = active ? config.symbols.filter((x) => x !== s.deriv) : [...config.symbols, s.deriv]; if (next.length > 0) patchConfig("symbols", next); }}
                              className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                                active ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]" : "border-border text-muted-foreground hover:text-foreground",
                                running && "opacity-40 cursor-not-allowed")}>
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Unsaved params banner */}
                  {(draftDuration !== config.durationMinutes || draftMaxTrades !== config.maxTradesPerDay) && (
                    <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3">
                      <div className="text-xs">
                        <span className="font-semibold text-amber-300">Modifications non sauvegardées</span>
                        <span className="text-muted-foreground ml-2">
                          {draftDuration !== config.durationMinutes && `Durée : ${draftDuration} min`}
                          {draftDuration !== config.durationMinutes && draftMaxTrades !== config.maxTradesPerDay && " · "}
                          {draftMaxTrades !== config.maxTradesPerDay && `Max trades : ${draftMaxTrades}/jour`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => { setDraftDuration(config.durationMinutes); setDraftMaxTrades(config.maxTradesPerDay); }}
                          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1">
                          Annuler
                        </button>
                        <button
                          onClick={() => setShowSaveParams(true)}
                          className="flex items-center gap-1 rounded-lg bg-amber-500/20 px-3 py-1.5 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30 transition-colors">
                          <Save className="h-3 w-3" /> Sauvegarder
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB: Risque & Sessions */}
              {configTab === "risk" && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Perte max / jour ($)">
                    <AmountInput value={config.maxDailyLossUsd} min={5} max={500} step={5}
                      onCommit={async (v) => {
                        const ok = await confirm({ title: "Modifier la limite ?", description: `$${config.maxDailyLossUsd} → $${v}${config.mode === "live" ? " (argent réel)" : ""}`, confirmLabel: "Confirmer", danger: config.mode === "live" });
                        if (ok) { patchConfig("maxDailyLossUsd", v); toast.success(`Limite: $${v}`); }
                        return ok;
                      }} />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Modifiable même bot actif</p>
                  </Field>
                  <Field label={`Gain cible / jour ($${config.maxDailyProfitUsd === 0 ? " — off" : config.maxDailyProfitUsd})`}>
                    <AmountInput value={config.maxDailyProfitUsd} min={0} max={1000} step={5}
                      onCommit={(v) => { patchConfig("maxDailyProfitUsd", v); toast.success(v === 0 ? "Gain cible désactivé" : `Objectif: $${v}`); return true; }} />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">0 = désactivé</p>
                  </Field>
                  <Field label="Pertes consécutives max">
                    <input type="number" min={1} max={10} value={config.maxConsecutiveLosses} disabled={running}
                      onChange={(e) => patchConfig("maxConsecutiveLosses", Number(e.target.value))} className="cfg-input" />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Arrêt / cooldown après N pertes</p>
                  </Field>
                  <Field label="Volatilité max (ATR%)">
                    <select value={config.maxVolatilityPct} disabled={running} onChange={(e) => patchConfig("maxVolatilityPct", Number(e.target.value))} className="cfg-input">
                      <option value={2}>2% — prudent</option><option value={3}>3%</option>
                      <option value={4}>4% — équilibré</option><option value={6}>6% — agressif</option>
                    </select>
                  </Field>
                  {([
                    ["premiumOnly","Signaux PREMIUM uniquement","Ne trade que les meilleurs signaux"],
                    ["stopOnRisk","Arrêt immédiat sur risque","Hard-stop + notification"],
                    ["adaptiveStake","Mise Kelly adaptative","Réduit la mise quand win rate < 55%"],
                  ] as const).map(([key, label, desc]) => (
                    <Field key={key} label={label}>
                      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                        <span className="text-xs text-muted-foreground">{config[key] ? "Activé" : "Désactivé"}</span>
                        <Switch checked={config[key] as boolean} disabled={running} onCheckedChange={(v) => patchConfig(key, v)} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{desc}</p>
                    </Field>
                  ))}
                  <Field label={`Trailing stop — drawdown ($${config.trailingStopUsd === 0 ? " off" : config.trailingStopUsd})`}>
                    <AmountInput value={config.trailingStopUsd} min={0} max={500} step={5}
                      onCommit={(v) => { patchConfig("trailingStopUsd", v); toast.success(v === 0 ? "Trailing stop désactivé" : `Trailing stop: $${v} sous le pic`); return true; }} />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Arrêt si le P&amp;L recule de ce montant depuis son pic. 0 = désactivé</p>
                  </Field>
                  <Field label="Bloquer les paires corrélées">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                      <span className="text-xs text-muted-foreground">{config.blockCorrelated ? "Activé" : "Désactivé"}</span>
                      <Switch checked={config.blockCorrelated} disabled={running} onCheckedChange={(v) => { patchConfig("blockCorrelated", v); toast.success(v ? "Corrélation activée — une paire par groupe" : "Corrélation désactivée"); }} />
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Évite d&apos;ouvrir deux paires corrélées en même temps.{" "}
                      {CORRELATION_GROUPS.map((g, i) => <span key={i} className="opacity-60">{g.map(s => s.replace(/^(frx|cry)/, "")).join("+")} </span>)}
                    </p>
                  </Field>
                  <Field label={`Buffer ouverture/clôture session (${config.sessionEdgeMinutes} min)`}>
                    <input type="range" min={0} max={60} step={15} value={config.sessionEdgeMinutes} disabled={running}
                      onChange={(e) => patchConfig("sessionEdgeMinutes", Number(e.target.value))} className="w-full accent-primary" />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0</span><span>15</span><span>30</span><span>45</span><span>60 min</span></div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Évite les faux breakouts à l'ouverture/clôture des sessions Forex</p>
                  </Field>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1.5">Sessions autorisées</label>
                    <div className="flex flex-wrap gap-2">
                      {(["sydney","asia","london","newyork"] as TradingSession[]).map((s) => {
                        const active = config.tradingSessions.includes(s);
                        const isOpen = activeSessions.includes(s);
                        return (
                          <button key={s} disabled={running}
                            onClick={() => { const next = active ? config.tradingSessions.filter((x) => x !== s) : [...config.tradingSessions, s]; if (next.length > 0) patchConfig("tradingSessions", next); }}
                            className={cn("rounded-xl border px-4 py-2 text-xs font-medium transition-colors text-left",
                              active ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]" : "border-border text-muted-foreground hover:text-foreground",
                              running && "opacity-40 cursor-not-allowed")}>
                            <div className="font-semibold">{SESSION_HOURS[s].label} {isOpen ? "●" : ""}</div>
                            <div className="text-[10px] opacity-60">{SESSION_HOURS[s].open}h–{SESSION_HOURS[s].close}h UTC</div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">Les indices Volatility (R_100…) ignorent ce filtre — ouverts 24h/24, 7j/7.</p>
                  </div>
                </div>
              )}

              {/* TAB: Backtest */}
              {configTab === "backtest" && (
                <div className="space-y-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start justify-between">
                    <div>
                      <p className="text-xs text-muted-foreground leading-relaxed max-w-lg">
                        Rejoue le <strong>pipeline live exact</strong> — 4 timeframes (5m/15m/1H/4H), véto 4H, score
                        d'alignement de tendance et bonus de patterns — sur des données historiques réelles et
                        synchronisées, sans anticipation (chaque timeframe ne voit que les bougies déjà closes).
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-1.5">
                        Payout réel utilisé (coté en direct, pas une estimation) : seuil de rentabilité ≈
                        <strong className="text-amber-400"> {(1 / (1 + (Object.values(backtestResults)[0]?.payoutPct ?? 0.85)) * 100).toFixed(1)}% win rate minimum</strong>
                      </p>
                    </div>
                    <Button size="sm" onClick={runBacktest} disabled={backtestRunning}
                      className="w-full sm:w-auto shrink-0 gap-2 h-11 sm:h-9 text-sm sm:text-xs font-bold sm:font-semibold">
                      <FlaskConical className={cn("h-4 w-4 sm:h-3.5 sm:w-3.5", backtestRunning && "animate-pulse")} />
                      {backtestRunning ? "Analyse…" : "Lancer le backtest"}
                    </Button>
                  </div>

                  {backtestRunning && (
                    <div className="space-y-2">
                      {config.symbols.map((sym) => (
                        <div key={sym} className="h-10 rounded-lg bg-muted/20 animate-pulse" />
                      ))}
                    </div>
                  )}

                  {Object.keys(backtestResults).length > 0 && !backtestRunning && (() => {
                    const allResults = Object.values(backtestResults);
                    const totalTrades = allResults.reduce((s, r) => s + r.trades, 0);
                    const totalWins = allResults.reduce((s, r) => s + r.wins, 0);
                    const globalWinRate = totalTrades > 0 ? totalWins / totalTrades : 0;
                    const totalPnl = allResults.reduce((s, r) => s + r.pnl, 0);
                    const breakEven = allResults[0]?.breakEvenWinRate ?? 0.541;
                    const edge = globalWinRate - breakEven;
                    return (
                      <div className="space-y-3">
                        <div className={cn("rounded-xl border p-4 flex flex-wrap gap-4 items-center",
                          globalWinRate >= breakEven ? "border-up/30 bg-up/5" : "border-down/30 bg-down/5")}>
                          <div className="flex-1 min-w-[120px]">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Win Rate global</div>
                            <div className={cn("text-2xl font-bold font-mono-tabular mt-0.5",
                              globalWinRate >= breakEven ? "text-up" : "text-down")}>
                              {(globalWinRate * 100).toFixed(1)}%
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">seuil rentabilité : {(breakEven * 100).toFixed(1)}%</div>
                          </div>
                          <div className="flex-1 min-w-[100px]">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">P&L simulé</div>
                            <div className={cn("text-xl font-bold font-mono-tabular mt-0.5",
                              totalPnl >= 0 ? "text-up" : "text-down")}>
                              {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">mise ${config.stakeUsd}/trade</div>
                          </div>
                          <div className="flex-1 min-w-[100px]">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">Edge théorique</div>
                            <div className={cn("text-xl font-bold font-mono-tabular mt-0.5",
                              edge >= 0 ? "text-up" : "text-down")}>
                              {edge >= 0 ? "+" : ""}{(edge * 100).toFixed(1)}%
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">{totalTrades} trades analysés</div>
                          </div>
                          <div className={cn("rounded-lg px-3 py-2 text-xs font-bold text-center",
                            globalWinRate >= breakEven + 0.05 ? "bg-up/20 text-up"
                            : globalWinRate >= breakEven ? "bg-amber-500/20 text-amber-400"
                            : "bg-down/20 text-down")}>
                            {globalWinRate >= breakEven + 0.05 ? "✓ Edge positif"
                              : globalWinRate >= breakEven ? "⚠ Limite rentable"
                              : "✗ Edge négatif"}
                          </div>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-border/40">
                          <table className="w-full text-xs">
                            <thead className="bg-muted/15 text-[10px] uppercase tracking-wider text-muted-foreground">
                              <tr>
                                <th className="px-4 py-2.5 text-left">Paire</th>
                                <th className="px-4 py-2.5 text-right">Trades</th>
                                <th className="px-4 py-2.5 text-right">Win Rate</th>
                                <th className="px-4 py-2.5 text-right">P&L sim.</th>
                                <th className="px-4 py-2.5 text-right">Conf. moy.</th>
                                <th className="px-4 py-2.5 text-center">Verdict</th>
                              </tr>
                            </thead>
                            <tbody>
                              {allResults.map((r) => {
                                const wr = r.winRate;
                                const be = r.breakEvenWinRate;
                                const label = SYMBOLS.find((s) => s.deriv === r.symbol)?.label ?? r.symbol;
                                return (
                                  <tr key={r.symbol} className="border-t border-border/30 hover:bg-muted/5">
                                    <td className="px-4 py-2.5 font-medium">{label}</td>
                                    <td className="px-4 py-2.5 text-right text-muted-foreground">{r.trades}</td>
                                    <td className={cn("px-4 py-2.5 text-right font-bold",
                                      wr >= be ? "text-up" : "text-down")}>
                                      {r.trades > 0 ? `${(wr * 100).toFixed(1)}%` : "—"}
                                    </td>
                                    <td className={cn("px-4 py-2.5 text-right font-bold",
                                      r.pnl >= 0 ? "text-up" : "text-down")}>
                                      {r.trades > 0 ? `${r.pnl >= 0 ? "+" : ""}$${r.pnl.toFixed(2)}` : "—"}
                                    </td>
                                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                                      {r.trades > 0 ? `${r.avgConfidence}%` : "—"}
                                    </td>
                                    <td className="px-4 py-2.5 text-center">
                                      {r.trades === 0 ? (
                                        <span className="text-[10px] text-muted-foreground">Pas de signal</span>
                                      ) : wr >= be + 0.05 ? (
                                        <span className="text-[10px] font-bold text-up bg-up/10 px-2 py-0.5 rounded">Edge +</span>
                                      ) : wr >= be ? (
                                        <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">Limite</span>
                                      ) : (
                                        <span className="text-[10px] font-bold text-down bg-down/10 px-2 py-0.5 rounded">Edge −</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {(() => {
                          const combined: Record<number, { trades: number; wins: number }> = { 1: { trades: 0, wins: 0 }, 2: { trades: 0, wins: 0 }, 3: { trades: 0, wins: 0 }, 4: { trades: 0, wins: 0 } };
                          for (const r of allResults) {
                            for (const k of [1, 2, 3, 4] as const) {
                              combined[k].trades += r.byAgreement?.[k]?.trades ?? 0;
                              combined[k].wins += r.byAgreement?.[k]?.wins ?? 0;
                            }
                          }
                          const anyData = Object.values(combined).some((v) => v.trades > 0);
                          if (!anyData) return null;
                          return (
                            <div className="rounded-xl border border-border/40 p-4">
                              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-2.5">
                                Win rate par niveau d'accord entre timeframes
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                {[1, 2, 3, 4].map((k) => {
                                  const d = combined[k];
                                  const wr = d.trades > 0 ? d.wins / d.trades : null;
                                  return (
                                    <div key={k} className="rounded-lg bg-muted/15 px-2 py-2.5 text-center">
                                      <div className="text-[10px] text-muted-foreground">{k}/4 TF</div>
                                      <div className={cn("text-sm font-bold font-mono-tabular mt-0.5", wr === null ? "text-muted-foreground" : wr >= breakEven ? "text-up" : "text-down")}>
                                        {wr === null ? "—" : `${(wr * 100).toFixed(0)}%`}
                                      </div>
                                      <div className="text-[9px] text-muted-foreground/70 mt-0.5">{d.trades} trades</div>
                                    </div>
                                  );
                                })}
                              </div>
                              <p className="mt-2 text-[10px] text-muted-foreground/60">
                                Si le win rate ne monte pas avec le nombre de TF d'accord, le seuil "minTfAgreement" n'apporte pas l'edge qu'on lui suppose.
                              </p>
                            </div>
                          );
                        })()}

                        <p className="text-[10px] text-muted-foreground/60">
                          Pipeline live réel (4 timeframes, véto 4H, alignement de tendance, patterns) — pas une approximation single-TF.
                          Fenêtre testée limitée (~37h par paire) : reste indicatif, pas une garantie de performance future.
                        </p>
                      </div>
                    );
                  })()}

                  {Object.keys(backtestResults).length === 0 && !backtestRunning && (
                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                      <FlaskConical className="h-8 w-8 text-muted-foreground/20" />
                      <p className="text-xs text-muted-foreground">Lance le backtest pour voir si le signal a un edge statistique sur les paires configurées.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Adaptive indicator weights — the real "learns from its mistakes" mechanism ── */}
      {(() => {
        if (!breakdowns.length) return null;
        return (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <button className="flex w-full items-center justify-between px-5 py-4 hover:bg-muted/10 transition-colors"
              onClick={() => setShowWeights((v) => !v)}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">🧠 Poids adaptatifs</span>
                <span className="text-[10px] bg-muted/40 text-muted-foreground rounded-md px-2 py-0.5">
                  {breakdowns.length} paire{breakdowns.length > 1 ? "s" : ""} avec historique
                </span>
              </div>
              {showWeights ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            {showWeights && (
              <div className="border-t border-border/40 p-5 space-y-4">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Chaque indicateur part avec un poids neutre (1.0×). Après chaque trade clôturé, le poids des
                  composants qui l'ont déclenché est recalculé selon leur taux de réussite réel — c'est le
                  mécanisme qui fait que le bot ajuste sa confiance dans chaque indicateur au fil des trades,
                  au lieu de garder des poids fixes pour toujours.
                </p>
                {breakdowns.map(({ sym, rows }) => (
                  <div key={sym}>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
                      {SYMBOLS.find((s) => s.deriv === sym)?.label ?? sym}
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-border/40">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/15 text-[10px] uppercase tracking-wider text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left">Composant</th>
                            <th className="px-3 py-2 text-right">Gagnés / Perdus</th>
                            <th className="px-3 py-2 text-right">Poids actuel</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.name} className="border-t border-border/30">
                              <td className="px-3 py-2 font-medium">{r.name}</td>
                              <td className="px-3 py-2 text-right text-muted-foreground">{r.wins} / {r.losses}</td>
                              <td className={cn("px-3 py-2 text-right font-bold font-mono-tabular",
                                r.weight > 1.02 ? "text-up" : r.weight < 0.98 ? "text-down" : "text-muted-foreground")}>
                                {r.weight.toFixed(2)}×
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Trade Journal ── */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <button className="flex w-full items-center justify-between px-5 py-4 hover:bg-muted/10 transition-colors"
          onClick={() => setShowLogs((v) => !v)}>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Journal</span>
            <span className="text-[10px] bg-muted/40 text-muted-foreground rounded-md px-2 py-0.5">{logs.length} trades</span>
            {wins > 0 && <span className="text-[10px] bg-up/15 text-up rounded-md px-2 py-0.5">{wins} gagnés</span>}
            {losses > 0 && <span className="text-[10px] bg-down/15 text-down rounded-md px-2 py-0.5">{losses} perdus</span>}
          </div>
          {showLogs ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showLogs && (
          <div className="border-t border-border/40">
            {logs.length > 0 && (
              <div className="flex gap-1 px-5 pt-3 pb-1 flex-wrap">
                {(["all","won","lost","open","error"] as const).map((f) => {
                  const count = f === "all" ? logs.length : logs.filter((l) => l.status === f).length;
                  return (
                    <button key={f} onClick={() => setLogFilter(f)}
                      className={cn("rounded-lg px-3 py-1 text-[10px] font-semibold transition-colors",
                        logFilter === f
                          ? f === "won" ? "bg-up/20 text-up" : f === "lost" ? "bg-down/20 text-down"
                            : f === "open" ? "bg-[color:var(--brand-cyan)]/20 text-[color:var(--brand-cyan)]" : "bg-muted/50 text-foreground"
                          : "text-muted-foreground hover:text-foreground")}>
                      {f === "all" ? "Tous" : f === "won" ? "Gagnés" : f === "lost" ? "Perdus" : f === "open" ? "Ouverts" : "Erreurs"} ({count})
                    </button>
                  );
                })}
              </div>
            )}
            {(() => {
              const fl = logFilter === "all" ? logs : logs.filter((l) => l.status === logFilter);
              return fl.length === 0 ? (
                <div className="px-5 py-10 text-center text-xs text-muted-foreground">
                  {logFilter === "all" ? "Aucun trade — démarre le bot." : `Aucun trade "${logFilter}".`}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/15 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-5 py-2.5 text-left">Heure</th>
                        <th className="px-5 py-2.5 text-left">Paire</th>
                        <th className="px-4 py-2.5 text-center">Dir.</th>
                        <th className="px-4 py-2.5 text-right">Mise</th>
                        <th className="px-4 py-2.5 text-right">Conf.</th>
                        <th className="px-4 py-2.5 text-right">P&L</th>
                        <th className="px-4 py-2.5 text-center">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fl.map((t) => (
                        <tr key={t.id} className={cn("border-t border-border/30 hover:bg-muted/5 transition-colors",
                          t.status === "won" && "bg-up/3", t.status === "lost" && "bg-down/3")}>
                          <td className="px-5 py-2.5 text-muted-foreground whitespace-nowrap">{new Date(t.time).toLocaleTimeString()}</td>
                          <td className="px-5 py-2.5 max-w-[160px]">
                            {t.status === "cooldown" || t.status === "risk-stop"
                              ? <span className="text-muted-foreground italic text-[10px]">{t.note}</span>
                              : <span className={cn("font-medium", t.status === "error" && "text-down")}>
                                  {SYMBOLS.find((s) => s.deriv === t.symbol)?.label ?? t.symbol}
                                  {t.note && <span className="block text-[10px] text-muted-foreground truncate">{t.note}</span>}
                                </span>}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {t.status !== "cooldown" && t.status !== "risk-stop" && (
                              <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                                t.direction === "CALL" ? "bg-up/10 text-up" : "bg-down/10 text-down")}>
                                {t.direction === "CALL" ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                                {t.direction}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">{t.stake > 0 ? `$${t.stake.toFixed(2)}` : "—"}</td>
                          <td className="px-4 py-2.5 text-right text-muted-foreground">{t.confidence > 0 ? `${t.confidence}%` : "—"}</td>
                          <td className={cn("px-4 py-2.5 text-right font-bold",
                            t.profit > 0 ? "text-up" : t.profit < 0 ? "text-down" : "text-muted-foreground")}>
                            {t.status === "won" && `+$${t.profit.toFixed(2)}`}
                            {t.status === "lost" && `-$${Math.abs(t.profit).toFixed(2)}`}
                            {t.status !== "won" && t.status !== "lost" && "—"}
                          </td>
                          <td className="px-4 py-2.5 text-center"><StatusBadge status={t.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-end px-5 py-2.5 border-t border-border/30">
                    <button onClick={async () => {
                      const ok = await confirm({ title: "Effacer le journal ?", description: "Tout l'historique sera supprimé.", confirmLabel: "Effacer", danger: true });
                      if (!ok) return;
                      localStorage.removeItem("lio23.autotrader_log");
                      setLogs([]);
                    }} className="text-[10px] text-muted-foreground hover:text-down transition-colors">
                      Effacer le journal
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Disclaimer modal ── */}
      {/* ── Save params popup ── */}
      {showSaveParams && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-md p-4">
          <div className="glass-panel w-full max-w-sm rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-400">
                <Save className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold">Sauvegarder les paramètres</h2>
                <p className="text-[11px] text-muted-foreground">Ces valeurs remplaceront la configuration actuelle.</p>
              </div>
            </div>

            <div className="space-y-2">
              {draftDuration !== config.durationMinutes && (
                <div className="flex items-center justify-between rounded-xl bg-muted/20 px-4 py-3 text-xs">
                  <span className="text-muted-foreground font-medium">Durée de contrat</span>
                  <div className="flex items-center gap-2">
                    <span className="line-through text-muted-foreground/40">{config.durationMinutes} min</span>
                    <span className="text-amber-300 font-bold">→ {draftDuration} min</span>
                  </div>
                </div>
              )}
              {draftMaxTrades !== config.maxTradesPerDay && (
                <div className="flex items-center justify-between rounded-xl bg-muted/20 px-4 py-3 text-xs">
                  <span className="text-muted-foreground font-medium">Trades max / jour</span>
                  <div className="flex items-center gap-2">
                    <span className="line-through text-muted-foreground/40">{config.maxTradesPerDay} trades</span>
                    <span className="text-amber-300 font-bold">→ {draftMaxTrades} trades</span>
                  </div>
                </div>
              )}
            </div>

            {running && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px] text-amber-400 flex gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Bot actif — les nouvelles valeurs seront effectives dès le prochain scan.
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowSaveParams(false)}>
                Annuler
              </Button>
              <Button className="flex-1 bg-amber-500/20 text-amber-200 border border-amber-500/40 hover:bg-amber-500/30"
                onClick={() => {
                  if (draftDuration !== config.durationMinutes) patchConfig("durationMinutes", draftDuration);
                  if (draftMaxTrades !== config.maxTradesPerDay) patchConfig("maxTradesPerDay", draftMaxTrades);
                  setShowSaveParams(false);
                  toast.success("Paramètres sauvegardés", {
                    description: [
                      draftDuration !== config.durationMinutes ? `Durée : ${draftDuration} min` : null,
                      draftMaxTrades !== config.maxTradesPerDay ? `Max trades : ${draftMaxTrades}/jour` : null,
                    ].filter(Boolean).join(" · "),
                  });
                }}>
                <Save className="mr-2 h-4 w-4" /> Confirmer
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDisclaimer && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-md p-4">
          <div className="glass-panel w-full max-w-md rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-down/10 text-down"><ShieldAlert className="h-5 w-5" /></div>
              <h2 className="text-sm font-bold">Avant de commencer</h2>
            </div>
            <ul className="space-y-2.5 text-xs text-muted-foreground">
              {["Aucun algorithme ne garantit des gains — des pertes sont inévitables.",
                "Les signaux sont basés sur des indicateurs passés, pas sur le futur.",
                "Le circuit-breaker limite les pertes mais ne les élimine pas.",
                "En mode LIVE, du vrai argent est engagé à chaque trade.",
                "Vertex est un outil d'analyse, pas un conseiller financier agréé."
              ].map((t, i) => (
                <li key={i} className="flex gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-down" />
                  {t}
                </li>
              ))}
            </ul>
            <p className="text-xs font-semibold text-foreground">En acceptant, tu confirmes avoir lu et compris ces risques.</p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowDisclaimer(false)}>Annuler</Button>
              <Button className="flex-1 bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-background font-semibold" onClick={acceptDisclaimer}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> J'accepte — Démarrer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Save preset modal ── */}
      {showSavePreset && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 backdrop-blur-md p-4">
          <div className="glass-panel w-full max-w-sm rounded-2xl p-6 space-y-4 shadow-2xl">
            <h2 className="text-sm font-bold">Sauvegarder cette configuration</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Nom</label>
                <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Mon preset agressif…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground mb-1">Description</label>
                <input value={presetDesc} onChange={(e) => setPresetDesc(e.target.value)} placeholder="Fonctionne bien sur BTC le matin…"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setShowSavePreset(false); setPresetName(""); setPresetDesc(""); }}>Annuler</Button>
              <Button className="flex-1" disabled={!presetName.trim()} onClick={() => {
                saveCurrentAsPreset(config, presetName.trim(), presetDesc.trim() || presetName.trim());
                setCustomPresets(loadCustomPresets());
                setShowSavePreset(false); setPresetName(""); setPresetDesc("");
                toast.success(`Preset "${presetName}" sauvegardé`);
              }}>
                <Save className="mr-2 h-4 w-4" /> Sauvegarder
              </Button>
            </div>
          </div>
        </div>
      )}

      <style>{`.cfg-input{width:100%;border-radius:8px;border:1px solid var(--border);background:var(--background);padding:8px 12px;font-size:13px;color:var(--foreground)}`}</style>
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
      <div className="text-xs text-muted-foreground uppercase tracking-widest font-medium">{label}</div>
      <div className={cn("mt-2 font-mono-tabular text-2xl font-bold leading-none", cls)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground uppercase tracking-widest font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Cooldown is now tracked per-symbol in the engine (a losing streak on one
 * instrument no longer pauses every other symbol) — derive the banner from the
 * latest scan instead of a single global timer. */
function CooldownBanner({ lastScan }: { lastScan: ScanResult | null }) {
  if (!lastScan) return null;
  const paused = lastScan.results.filter((r) => r.action === "cooldown");
  if (!paused.length) return null;

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4 flex items-center gap-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
        <Clock className="h-5 w-5 text-amber-400" />
      </div>
      <div>
        <span className="text-sm font-semibold text-amber-300">
          {paused.length} paire{paused.length > 1 ? "s" : ""} en pause
        </span>
        <span className="text-sm text-amber-400/80 ml-2">
          {paused.map((p) => SYMBOLS.find((s) => s.deriv === p.symbol)?.label ?? p.symbol).join(", ")}
          {" "}— trop de pertes consécutives, reprise automatique après le délai configuré.
        </span>
      </div>
    </div>
  );
}

function ScanCountdown({
  lastScan,
  SCAN_INTERVAL_MS,
  config,
}: {
  lastScan: { time: number } | null;
  SCAN_INTERVAL_MS: number;
  config: { minConfidence: number; minTfAgreement: number };
}) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!lastScan) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lastScan]);

  if (!lastScan) {
    return "Première analyse en cours…";
  }

  const secsLeft = Math.max(0, Math.ceil((lastScan.time + SCAN_INTERVAL_MS - now) / 1000));
  return secsLeft > 0
    ? `Prochain scan dans ${secsLeft}s · confiance min ${config.minConfidence}% · ${config.minTfAgreement}/4 TF`
    : "Scan en cours…";
}
