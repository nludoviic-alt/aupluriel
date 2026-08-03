import { KpiCard } from "@/components/kpi-card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FlaskConical,
  Power,
  Save,
  Settings2,
  ShieldAlert,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";

import { playWinSound, playLossSound, playOpenSound } from "@/lib/sounds";
import { SCAN_ACTION_META } from "@/lib/scan-actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { SYMBOLS } from "@/lib/deriv";
import {
  addToCumulativePnl,
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
  loadDailyPnl,
  reconcileOpenTrades,
  PRESETS,
  BOOM_PRESET,
  CRASH_PRESET,
  SCALPING_PRESET,
  type QuickPreset,
  SCAN_INTERVAL_MS,
  saveCurrentAsPreset,
  SESSION_HOURS,
  todayTradeCount,
  type AutoTraderConfig,
  type CustomPreset,
  type PresetConfig,
  type RiskProfile,
  type ScanResult,
  type TradingMode,
  type TradingSession,
  type TradeLog,
  type Veto4hMode,
} from "@/lib/autotrader";
import { api } from "@/lib/api";
import { relayPush } from "@/lib/notify-push";
import { loadDefaultStake, saveDefaultStake } from "@/lib/stake";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { AmountInput } from "@/components/amount-input";
import { LiveTradeCard } from "@/components/live-trade-card";
import { BotDashboard, LiveSignals } from "@/components/bot-dashboard";
import { AutoBacktestStatus } from "@/components/auto-backtest-status";
import { useDerivSession, refreshDerivBalance, reinitDerivSession } from "@/hooks/use-deriv-session";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useAutoTraderEngine,
  setEngineLogs,
  setEngineRiskStopReasons,
} from "@/hooks/use-autotrader-engine";

export const Route = createFileRoute("/autotrader")({
  head: () => ({ meta: [{ title: "Auto-Trader — Au Pluriel" }] }),
  component: AutoTraderPage,
});

const CONFIG_KEY = "lio23.autotrader_config";
const PRESET_CONFIG_KEY = (preset: string) => `lio23.autotrader_config.${preset}`;

type PresetKey = "default" | "boom" | "crash" | "scalping";

const presetLabels: Record<PresetKey, string> = { default: "Multi", boom: "Boom", crash: "Crash", scalping: "Scalping" };

/** Tab order on screen. The admin's mobile whitelist is filtered THROUGH this
 * list rather than used directly, so tabs always appear in the same order
 * regardless of the order they were enabled in /admin. */
const PRESET_ORDER = ["default", "boom", "crash", "scalping"] as const;

type OpportunityDecision = "take" | "wait" | "avoid";
interface OpportunityItem {
  id: string;
  preset: "default" | "boom" | "crash" | "scalping";
  presetLabel: string;
  symbol: string;
  label: string;
  decision: OpportunityDecision;
  direction: "CALL" | "PUT" | null;
  directionLabel: string;
  confidence: number;
  agreement: number;
  risk: "faible" | "modere" | "eleve";
  instrument: "binary" | "multiplier";
  durationMinutes: number;
  takeProfitUsd: number | null;
  stopLossUsd: number | null;
  reasons: string[];
  blockers: string[];
  stats: {
    trades: number;
    winRate: number | null;
    pnl: number;
    expectancy: number | null;
    profitFactor: number | null;
  };
  updatedAt: number;
}

interface OpportunitiesResponse {
  generatedAt: number;
  opportunities: OpportunityItem[];
  summary: { take: number; wait: number; avoid: number; presets: number };
}

function loadConfig(preset?: string): AutoTraderConfig {
  try {
    const key = preset ? PRESET_CONFIG_KEY(preset) : CONFIG_KEY;
    const cfg: AutoTraderConfig = {
      ...DEFAULT_CONFIG,
      stakeUsd: loadDefaultStake(),
      ...JSON.parse(localStorage.getItem(key) ?? "{}"),
    };
    // A stale mode:"simulation" saved before that option was removed would
    // otherwise load as a literal string the rest of the app can't handle.
    if ((cfg.mode as string) !== "demo" && (cfg.mode as string) !== "live") cfg.mode = "demo";
    return cfg;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(c: AutoTraderConfig, preset?: string) {
  try {
    const key = preset ? PRESET_CONFIG_KEY(preset) : CONFIG_KEY;
    localStorage.setItem(key, JSON.stringify(c));
  } catch {}
}

interface PresetStatus {
  enabled: boolean;
  running: boolean;
  mode: "demo" | "live";
  pausedUntil: number | null;
  lastError?: string | null;
  lastScan?: ScanResult | null;
  todayPnl: number;
  todayFloatingLoss: number;
  todayRiskPnl: number;
  todayCount: number;
  trades: TradeLog[];
  allTimeStats: { trades: number; wins: number; losses: number; winRate: number; pnl: number };
  savedConfig: { stakeUsd: number; maxDailyLossUsd: number; mode: "demo" | "live" } | null;
}

interface CloudStatus {
  presets: Record<PresetKey, PresetStatus>;
  visiblePresets?: PresetKey[];
  brokerBalances?: {
    deriv: { balance: number; currency: string } | null;
    kraken: { balance: number; currency: string } | null;
    binance: { balance: number; currency: string } | null;
    oanda: { balance: number; currency: string } | null;
  };
}

function AutoTraderPage() {
  const [config, setConfig] = useState<AutoTraderConfig>(DEFAULT_CONFIG);
  // Engine state (running flag, trade log, last scan, risk-stop reasons) lives
  // in a module-level store so it survives navigating to another page — see
  // use-autotrader-engine.ts for why.
  const { logs, lastScan, riskStopReasons, pausedUntil } = useAutoTraderEngine();
  const [showLogs, setShowLogs] = useState(true);
  const [activeSessions, setActiveSessions] = useState<TradingSession[]>([]);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const lastPendingToastRef = useRef<number>(0);
  const [presetDesc, setPresetDesc] = useState("");
  const [cumulativePnl, setCumulativePnl] = useState(0);
  const [forcingTrade, setForcingTrade] = useState(false);
  const [forceSymbol, setForceSymbol] = useState("");
  const [forceDir, setForceDir] = useState<"CALL" | "PUT">("CALL");
  const [forceStake, setForceStake] = useState(DEFAULT_CONFIG.stakeUsd);
  const [logFilter, setLogFilter] = useState<"all" | "won" | "lost" | "open" | "error">("all");
  const [showConfig, setShowConfig] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Mobile-only section switcher — desktop keeps the always-visible 2-col layout;
  // below md, showing every section stacked at once was too dense, so mobile
  // sees one focused section at a time instead.
  const [mobileTab, setMobileTab] = useState<"control" | "dashboard" | "config" | "journal" | "data">("control");
  const [configTab, setConfigTab] = useState<"profiles" | "params" | "risk">("profiles");
  const { confirmState, confirm } = useConfirm();
  const derivSession = useDerivSession(config.mode === "demo" || config.mode === "live");
  // Drives the preset-tab filter below. Same 768px breakpoint as Tailwind's
  // `md:`, so the JS filter and the CSS md:hidden/hidden md:flex split can't
  // disagree about what counts as mobile.
  const isMobile = useIsMobile();

  // ── Server-side bot (runs with the app closed / phone locked) ──
  // Up to three fully independent engines per account now (2026-08-01):
  // Default/"Multi", Boom, Crash. `selectedPreset` is purely a VIEW selector
  // — which one's dashboard/config/journal is on screen — not a switch that
  // stops the others. Each can be started/stopped on its own.
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>("default");
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [opportunities, setOpportunities] = useState<OpportunitiesResponse | null>(null);
  const [opportunitiesBusy, setOpportunitiesBusy] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  // One flag per preset — the stake/cap draft sync (below) must catch up
  // once per preset the first time it's viewed, not just once globally.
  const syncedFromServerRef = useRef<Record<PresetKey, boolean>>({ default: false, boom: false, crash: false, scalping: false });

  // Mobile shows at most 3 of the 4 preset tabs (admin choice) — four didn't
  // fit a phone-width strip. Desktop is never filtered. Falls back to all four
  // until /api/bot answers, so the tabs never flicker down to a subset.
  const mobilePresets: PresetKey[] = cloud?.visiblePresets?.length ? cloud.visiblePresets : [...PRESET_ORDER];
  const shownPresets: PresetKey[] = isMobile ? mobilePresets : [...PRESET_ORDER];

  const cloudSelected: PresetStatus | undefined = cloud?.presets?.[selectedPreset];
  // True the moment ANY of the three presets is enabled — used for guards
  // that care about "is something trading on this account" regardless of
  // which one is currently selected for viewing.
  const anyPresetEnabled = !!cloud?.presets && Object.values(cloud.presets).some((p) => p.enabled);

  const refreshCloud = useCallback(async () => {
    try {
      const data = await api.get<CloudStatus>("/api/bot");
      setCloud(data);
      // This browser's saved draft (stakeUsd/maxDailyLossUsd) can silently
      // fall behind whatever was last changed server-side (support fix, or
      // another device) — the START action always sends THIS draft, so a
      // stale one quietly overwrites the server's value the next time
      // anyone hits start. Sync once per preset, before the user can touch
      // anything, so opening this page (or switching preset tabs) is always
      // enough to catch up — never overwrites a value being actively edited.
      const savedConfig = data.presets?.[selectedPreset]?.savedConfig;
      if (!syncedFromServerRef.current[selectedPreset] && savedConfig) {
        syncedFromServerRef.current[selectedPreset] = true;
        setConfig((prev) => {
          const next = { ...prev, stakeUsd: savedConfig.stakeUsd, maxDailyLossUsd: savedConfig.maxDailyLossUsd };
          saveConfig(next, selectedPreset);
          return next;
        });
      }
    } catch { /* signed out or server unreachable — leave as-is */ }
  }, [selectedPreset]);

  const refreshOpportunities = useCallback(async () => {
    setOpportunitiesBusy(true);
    try {
      setOpportunities(await api.get<OpportunitiesResponse>("/api/opportunities"));
    } catch {
      setOpportunities(null);
    } finally {
      setOpportunitiesBusy(false);
    }
  }, []);

  useEffect(() => {
    refreshCloud();
    const id = setInterval(refreshCloud, 10_000);
    return () => clearInterval(id);
  }, [refreshCloud]);

  useEffect(() => {
    refreshOpportunities();
    const id = setInterval(refreshOpportunities, 30_000);
    return () => clearInterval(id);
  }, [refreshOpportunities]);

  // If the admin hides a preset that was currently selected, the tab strip
  // would lose its active button — silently jump to the first visible one.
  useEffect(() => {
    if (shownPresets.length && !shownPresets.includes(selectedPreset)) {
      selectPresetView(shownPresets[0]);
    }
  }, [shownPresets, selectedPreset]);

  async function toggleCloud() {
    if (cloudBusy) return;
    setCloudBusy(true);
    try {
      if (cloudSelected?.enabled) {
        await api.post("/api/bot", { action: "stop", preset: selectedPreset });
        toast.info(`Auto-exécution (${presetLabels[selectedPreset]}) arrêtée`);
      } else {
        // Real money — confirm with an up-to-the-second track record, not
        // whatever `cloud` last polled up to 20s ago.
        if (config.mode === "live") {
          let stats = cloudSelected?.allTimeStats;
          try {
            const fresh = await api.get<CloudStatus>("/api/bot");
            stats = fresh.presets?.[selectedPreset]?.allTimeStats;
          } catch { /* fall back to last-known stats below */ }

          const trades = stats?.trades ?? 0;
          const winRate = stats ? Math.round(stats.winRate * 100) : 0;
          const sampleLine = trades < 20
            ? `⚠️ Seulement ${trades} trade(s) enregistré(s) sur ton compte — échantillon trop faible pour juger la fiabilité de la stratégie.`
            : `Historique : ${trades} trades, ${winRate}% de réussite, P&L cumulé ${stats!.pnl >= 0 ? "+" : ""}$${stats!.pnl.toFixed(2)}.`;
          const riskLine = trades >= 5 && winRate < 50
            ? `\n\n🔴 Win rate actuel sous 50% — passer en live maintenant reviendrait à trader en argent réel avec un historique perdant.`
            : "";

          const ok = await confirm({
            title: "Démarrer l'auto-exécution en mode LIVE ?",
            description: `Au Pluriel va trader avec du VRAI argent, 24/7, même téléphone verrouillé. Mise : $${config.stakeUsd} par trade. Limite journalière : $${config.maxDailyLossUsd}.\n\n${sampleLine}${riskLine}\n\nAu Pluriel n'exécute que les signaux qu'il classe « à prendre ».`,
            confirmLabel: "Démarrer en réel",
            danger: true,
          });
          if (!ok) return;
        } else {
          // Demo — lighter confirmation so a stray tap can't start the bot.
          const ok = await confirm({
            title: `Démarrer l'auto-exécution — ${presetLabels[selectedPreset]} (Démo) ?`,
            description: `Au Pluriel va scanner les marchés ${presetLabels[selectedPreset]} et trader automatiquement sur ton compte de démonstration Deriv, 24/7, même téléphone verrouillé. Mise : $${config.stakeUsd} par trade.\n\nAu Pluriel n'exécute que les signaux qu'il classe « à prendre ».`,
            confirmLabel: "Démarrer",
          });
          if (!ok) return;
        }
        const started = await api.post<{ maxDailyLossUsd: number; adjustedLossCap: boolean }>("/api/bot", { action: "start", preset: selectedPreset, config });
        toast.success(config.mode === "live"
          ? `Auto-exécution (${presetLabels[selectedPreset]}) démarrée en LIVE — argent réel`
          : `Auto-exécution (${presetLabels[selectedPreset]}) démarrée — elle tourne même téléphone verrouillé`);
        if (started.adjustedLossCap) {
          toast.info(`Limite de perte journalière relevée à $${started.maxDailyLossUsd} — la mise dépassait l'ancien plafond, une perte normale n'aurait laissé aucun trade de la journée.`);
        }
      }
      await refreshCloud();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur auto-exécution");
    } finally {
      setCloudBusy(false);
    }
  }

  // Réconcilie les positions réelles avec Deriv après chaque (re)connexion :
  // re-suit les contrats encore ouverts, règle ceux fermés pendant l'absence.
  useEffect(() => {
    if (!derivSession.connected) return;
    reconcileOpenTrades((log) => {
      setEngineLogs((prev) => {
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
      saveConfig(loaded, selectedPreset);
      const label = SYMBOLS.find((s) => s.deriv === pair)?.label ?? pair;
      toast.success(`${label} ajoutée aux paires surveillées — prêt à trader`);
    }
    setConfig(loaded);
    setForceSymbol(loaded.symbols[0] ?? "frxEURUSD");
    setForceStake(loaded.stakeUsd);
    setCumulativePnl(loadCumulativePnl());
    // Update active sessions every minute
    setActiveSessions(currentActiveSessions());
    const id = setInterval(() => setActiveSessions(currentActiveSessions()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Memoize expensive calculations to prevent recalculation on every render
  const stats = useMemo(() => {
    // Rollup persisté (jamais tronqué) — la somme du journal perdait les gains
    // du début de journée dès que le log dépassait sa fenêtre de rétention.
    const pnl = loadDailyPnl().pnl;
    const tradeCount = todayTradeCount(logs);
    const closedLogs = logs.filter((l) => l.status === "won" || l.status === "lost");
    const wins = logs.filter((l) => l.status === "won").length;
    const losses = logs.filter((l) => l.status === "lost").length;
    const errors = logs.filter((l) => l.status === "error").length;
    const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
    const totalWon = closedLogs.filter((l) => l.status === "won").reduce((s, l) => s + l.profit, 0);
    const totalLost = closedLogs.filter((l) => l.status === "lost").reduce((s, l) => s + l.profit, 0);
    const openTradeList = logs.filter((l) => l.status === "open");
    const recentClosedTrades = [...closedLogs].sort((a, b) => b.time - a.time).slice(0, 6);
    const consecutiveLosses = countConsecutiveLosses(logs);
    const effectiveStake = config.adaptiveStake ? computeAdaptiveStake(config.stakeUsd, logs) : config.stakeUsd;
    return { pnl, tradeCount, wins, losses, errors, winRate, totalWon, totalLost, openTradeList, recentClosedTrades, consecutiveLosses, effectiveStake };
  }, [logs, config.adaptiveStake, config.stakeUsd]);

  const {
    pnl: localPnl, tradeCount: localTradeCount, wins: localWins, losses: localLosses, errors,
    totalWon: localTotalWon, totalLost: localTotalLost,
    openTradeList: localOpenTradeList, recentClosedTrades,
  } = stats;

  // The server bot's trades never touch the browser's localStorage rollup
  // (loadDailyPnl/addToDailyPnl live in the LOCAL engine only) — so when the
  // ☁️ server bot is the active engine, the KPI strip below would show a
  // stuck/zero P&L even as real gains land server-side. Prefer the
  // SQL-computed, never-trimmed cloud numbers whenever the server bot is on.
  const cloudActive = !!cloudSelected?.enabled;
  const isToday = (ms: number) => new Date(ms).toDateString() === new Date().toDateString();
  const cloudTrades = cloudSelected?.trades ?? [];
  const cloudClosedToday = cloudActive
    ? cloudTrades.filter((t) => (t.status === "won" || t.status === "lost") && isToday(t.time))
    : [];
  const pnl = cloudActive ? (cloudSelected?.todayPnl ?? 0) : localPnl;
  const lossUsedUsd = cloudActive
    ? Math.abs(Math.min(0, cloudSelected?.todayRiskPnl ?? pnl))
    : Math.abs(Math.min(0, pnl));
  const tradeCount = cloudActive ? (cloudSelected?.todayCount ?? 0) : localTradeCount;
  const wins = cloudActive ? cloudClosedToday.filter((t) => t.status === "won").length : localWins;
  const losses = cloudActive ? cloudClosedToday.filter((t) => t.status === "lost").length : localLosses;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  const totalWon = cloudActive
    ? cloudClosedToday.filter((t) => t.status === "won").reduce((s, t) => s + t.profit, 0)
    : localTotalWon;
  const totalLost = cloudActive
    ? cloudClosedToday.filter((t) => t.status === "lost").reduce((s, t) => s + t.profit, 0)
    : localTotalLost;

  // Same local↔cloud switch, extended to the raw trade ROWS (not just the
  // aggregates above) — the journal table, open-positions cards, stake-at-
  // risk and the adaptive-stake preview all read individual trades. Without
  // this they silently kept reading the local engine's log even while the
  // server bot was the one actually trading this preset, so they'd look
  // empty/stuck right next to KPIs that were correctly showing cloud data.
  const journalTrades = cloudActive ? cloudTrades : logs;
  const openTradeList = cloudActive
    ? cloudTrades.filter((t) => t.status === "open" || t.status === "pending")
    : localOpenTradeList;
  const openTrades = openTradeList.length;
  const consecutiveLosses = countConsecutiveLosses(journalTrades);
  const effectiveStake = config.adaptiveStake
    ? computeAdaptiveStake(config.stakeUsd, journalTrades)
    : config.stakeUsd;

  const selectedPresetOpportunities = useMemo(() => {
    return (opportunities?.opportunities ?? []).filter((o) => o.preset === selectedPreset);
  }, [opportunities?.opportunities, selectedPreset]);
  const selectedOpportunity = selectedPresetOpportunities[0] ?? null;
  const actionableOpportunity = selectedPresetOpportunities.find((o) => o.decision === "take") ?? null;

  function patchConfig<K extends keyof AutoTraderConfig>(k: K, v: AutoTraderConfig[K]) {
    const next = { ...config, [k]: v };
    setConfig(next);
    saveConfig(next, selectedPreset);
  }

  /**
   * Switches which preset's dashboard/config/journal is on screen. This is a
   * VIEW selector now, not a strategy switch (2026-08-01) — Default/Boom/
   * Crash run as three fully independent server engines, each start/stopped
   * on its own via the ☁️ Bot serveur toggle. Selecting a preset here never
   * starts, stops, or reconfigures anything server-side; it only swaps the
   * local `config` draft to that preset's canonical shape (for display and
   * as a starting point if the user edits it) so the CONFIG tab shows
   * sensible values instead of whatever the previous selection left behind.
   */
  function selectPresetView(target: "boom" | "crash" | "default" | "scalping") {
    if (target === selectedPreset) return;
    setSelectedPreset(target);
    const presetFields = target === "boom" ? BOOM_PRESET : target === "crash" ? CRASH_PRESET : target === "scalping" ? SCALPING_PRESET : DEFAULT_CONFIG;
    // Try to load a previously saved per-preset config draft from localStorage.
    // Falls back to the canonical preset values if nothing is saved yet.
    const saved = loadConfig(target);
    const hasSavedOverride = localStorage.getItem(PRESET_CONFIG_KEY(target)) !== null;
    const next: AutoTraderConfig = hasSavedOverride
      ? saved
      : target === "scalping"
        ? { ...DEFAULT_CONFIG, ...presetFields }
        : {
            ...DEFAULT_CONFIG, ...presetFields,
            stakeUsd: config.stakeUsd, maxDailyLossUsd: config.maxDailyLossUsd, mode: config.mode,
          };
    setConfig(next);
  }

  const handleEvent = useCallback((log: TradeLog, meta?: { cooldownUntil?: number }) => {
    // Log state itself is owned by the engine store (use-autotrader-engine.ts)
    // so it keeps updating even while this page isn't mounted — this callback
    // only needs to handle side effects (toasts, sounds, notifications).
    if (log.status === "won") {
      playWinSound();
      toast.success(`🎉 ${log.symbol} — Gagné +$${log.profit.toFixed(2)}`);
      relayPush(
        `🎉 Au Pluriel — Trade gagnant (+$${log.profit.toFixed(2)})`,
        `La position sur ${log.symbol} s'est clôturée avec succès (${config.mode.toUpperCase()}).`,
        "/autotrader"
      );

      setCumulativePnl(loadCumulativePnl());
      if (config.mode === "demo" || config.mode === "live") refreshDerivBalance();
    }
    if (log.status === "lost") {
      playLossSound();
      toast.error(`${log.symbol} — Perdu -$${Math.abs(log.profit).toFixed(2)}`);

      setCumulativePnl(loadCumulativePnl());
      if (config.mode === "demo" || config.mode === "live") refreshDerivBalance();
    }
    if (log.status === "open") {
      playOpenSound();
      toast.info(`Position ouverte — ${log.symbol} ${log.direction} · ID ${log.contractId}`);
    }
    if (log.status === "error") toast.error(`Erreur sur ${log.symbol}`);
    if (log.status === "pending") {
      // Throttle pending toasts - max 1 per 5 seconds to prevent spam
      const now = Date.now();
      if (now - lastPendingToastRef.current > 5000) {
        lastPendingToastRef.current = now;
        toast.info(`${log.symbol} ${log.direction} — Trade détecté`);
      }
    }
    if (log.status === "cooldown") {
      toast.warning(log.note ?? "Auto-trader en pause");
    }
  }, [config.mode]);

  async function executeManualOpportunity() {
    if (!actionableOpportunity?.direction) {
      toast.error("Aucun signal 'Prendre' disponible sur ce preset.");
      return;
    }
    if (!derivSession.connected) {
      toast.error("Connexion Deriv requise avant d'exécuter.");
      return;
    }

    const isLive = config.mode === "live";
    const stake = config.stakeUsd;
    const confirmed = await confirm({
      title: isLive ? "Exécuter ce signal en LIVE ?" : "Exécuter ce signal en démo ?",
      description: `${actionableOpportunity.label} · ${actionableOpportunity.directionLabel} · confiance ${Math.round(actionableOpportunity.confidence)}% · mise $${stake}.`,
      confirmLabel: isLive ? "Exécuter en réel" : "Exécuter en démo",
      danger: isLive,
    });
    if (!confirmed) return;

    setManualBusy(true);
    toast.info(`Exécution manuelle — ${actionableOpportunity.label} ${actionableOpportunity.direction}…`);
    try {
      await forceDemoTrade(
        actionableOpportunity.symbol,
        actionableOpportunity.direction,
        stake,
        actionableOpportunity.durationMinutes || config.durationMinutes,
        (log) => {
          handleEvent(log);
          if (log.status === "open") {
            toast.success(`Position ouverte — ${actionableOpportunity.label} ${actionableOpportunity.direction}`);
          }
        },
      );
      await refreshOpportunities();
    } catch (e) {
      toast.error(`Échec exécution: ${(e as Error).message}`);
    } finally {
      setManualBusy(false);
    }
  }

  // ── derived helpers ─────────────────────────────────────────────────────────
  const anyRunning = anyPresetEnabled;
  // Rendered twice — inline in the desktop header, and as its own full-width
  return (
    <div className="mx-auto max-w-[1480px] space-y-6 px-4 py-4 sm:px-6 lg:px-8">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-none sm:text-xl">Auto-Trader</h1>
            <p className="hidden sm:block text-sm text-muted-foreground mt-0.5">
              Scanner, conseiller, exécuter — sur ton autorisation.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowAdvanced((v) => !v)}
          className="shrink-0 gap-2 text-sm h-9 px-3 self-start sm:self-auto"
        >
          <Settings2 className="h-4 w-4" /> <span className="hidden lg:inline">{showAdvanced ? "Masquer" : "Avancé"}</span>
        </Button>
      </div>

      {/* ── P&L par système — l'unique sélecteur de preset. Les 3 presets
          tournent indépendamment (2026-08-01) ; le solde total ("Fonds
          disponibles" plus bas) ne dit pas lequel a généré quoi, donc ce
          comparatif est la seule vue qui répond directement à "qu'est-ce qui
          gagne en ce moment", en plus de servir de sélecteur. Cliquer saute
          sur cet onglet. ── */}
      <div className={cn("grid gap-2", shownPresets.length === 3 ? "grid-cols-3" : "grid-cols-4")}>
        {shownPresets.map((p) => {
          const st = cloud?.presets?.[p];
          const pnlVal = st?.todayPnl ?? 0;
          // Static class strings only — Tailwind's JIT scanner can't see
          // dynamically-built names like `border-${accent}-500/40`, so those
          // would silently produce no CSS at all in the production build.
          const isOnline = !!st?.enabled && !!st?.running;
          const styles = {
            default: { active: "border-violet-500/40 bg-violet-500/10" },
            boom: { active: "border-orange-500/40 bg-orange-500/10" },
            crash: { active: "border-yellow-500/40 bg-yellow-500/10" },
            scalping: { active: "border-cyan-500/40 bg-cyan-500/10" },
          } as const;
          return (
            <button
              key={p}
              onClick={() => selectPresetView(p)}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2.5 transition-all",
                selectedPreset === p
                  ? styles[p].active
                  : pnlVal > 0
                    ? "border-up/30 bg-up/8"
                    : pnlVal < 0
                      ? "border-down/30 bg-down/8"
                      : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]",
              )}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {presetLabels[p]}
                <span className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-up animate-pulse" : "bg-down")} />
              </span>
              <span className={cn("text-sm font-extrabold font-mono-tabular", pnlVal > 0 ? "text-up" : pnlVal < 0 ? "text-down" : "text-muted-foreground")}>
                {pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── 1. BANDEAU DE MÉTRIQUES FINANCIÈRES (Grille unifiée 4 cartes) ── */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4 animate-fade-in">
        {(() => {
          const bb = cloud?.brokerBalances;
          const total = (bb?.deriv?.balance ?? 0) + (bb?.kraken?.balance ?? 0) + (bb?.binance?.balance ?? 0) + (bb?.oanda?.balance ?? 0);
          const hasAny = bb && (bb.deriv || bb.kraken || bb.binance || bb.oanda);
          const stakeAtRisk = openTradeList.reduce((s, l) => s + l.stake, 0);
          const value = hasAny
            ? `$${total.toFixed(2)}`
            : derivSession.balance !== null
              ? `$${derivSession.balance.toFixed(2)}`
              : `$${(config.initialCapital + cumulativePnl - stakeAtRisk).toFixed(2)}`;
          const delta = hasAny
            ? `${config.mode?.toUpperCase() ?? "DEMO"} · ${(bb?.deriv ? "DERIV " : "")}`
            : derivSession.balance !== null
              ? `${config.mode.toUpperCase()} · ${derivSession.currency}`
              : `cumul ${cumulativePnl >= 0 ? "+" : ""}$${cumulativePnl.toFixed(2)}`;
          return (
            <KpiCard
              label="Fonds disponibles"
              value={value}
              tone={cumulativePnl >= 0 ? "bull" : "bear"}
              delta={delta}
            />
          );
        })()}

        <KpiCard
          label="P&L Aujourd'hui"
          value={`${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`}
          tone={pnl >= 0 ? "bull" : "bear"}
          delta={`${tradeCount} trade${tradeCount > 1 ? "s" : ""} · Gains $${totalWon.toFixed(2)}`}
        />

        <KpiCard
          label="Win Rate"
          value={wins + losses > 0 ? `${winRate.toFixed(0)}%` : "—"}
          tone={winRate >= 55 ? "bull" : winRate >= 45 ? "cyan" : wins + losses > 0 ? "bear" : "default"}
          delta={`${wins} gagnés · ${losses} perdus`}
        />

        <KpiCard
          label="Limite de perte"
          value={`${Math.round((lossUsedUsd / config.maxDailyLossUsd) * 100)}%`}
          tone={lossUsedUsd > config.maxDailyLossUsd * 0.7 ? "bear" : lossUsedUsd > config.maxDailyLossUsd * 0.4 ? "cyan" : "default"}
          delta={`$${lossUsedUsd.toFixed(2)} / $${config.maxDailyLossUsd}`}
        />
      </div>

      {/* ── Quick Trade Bar — manual trading in ≤2 clicks, always visible ── */}
      <div className="glass-panel rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-400" />
            <span className="text-xs font-black uppercase tracking-wider text-foreground">Trade manuel</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className={cn("h-2 w-2 rounded-full",
              derivSession.connected ? "bg-up" : derivSession.connecting ? "bg-amber-400 animate-pulse" : "bg-down")} />
            <span className={cn("font-bold",
              derivSession.connected ? "text-up" : derivSession.connecting ? "text-amber-400" : "text-down")}>
              {derivSession.connected
                ? derivSession.balance !== null ? `$${derivSession.balance.toFixed(2)}` : "Connecté"
                : derivSession.connecting ? "Connexion…" : "Déconnecté"}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Symbole</label>
            <select
              value={forceSymbol}
              disabled={!derivSession.connected || forcingTrade}
              onChange={(e) => setForceSymbol(e.target.value)}
              className="w-full h-10 rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50 font-semibold"
            >
              {config.symbols.map((s) => (
                <option key={s} value={s}>{SYMBOLS.find((x) => x.deriv === s)?.label ?? s}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 sm:flex-none">
            {(["CALL", "PUT"] as const).map((d) => (
              <button key={d}
                disabled={!derivSession.connected || forcingTrade}
                onClick={() => setForceDir(d)}
                className={cn(
                  "flex-1 sm:w-20 h-10 rounded-lg text-sm font-extrabold transition-all disabled:opacity-40 disabled:cursor-not-allowed border",
                  forceDir === d
                    ? d === "CALL"
                      ? "bg-up/20 text-up border-up/40 shadow-[0_0_10px_rgba(16,185,129,0.15)]"
                      : "bg-down/20 text-down border-down/40 shadow-[0_0_10px_rgba(239,68,68,0.15)]"
                    : "text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground/40",
                )}>
                {d === "CALL" ? "▲ Hausse" : "▼ Baisse"}
              </button>
            ))}
          </div>
          <div className="flex-1 sm:w-32 space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mise ($)</label>
            <AmountInput value={forceStake} min={1} max={100} step={1}
              disabled={!derivSession.connected || forcingTrade}
              onCommit={async (v) => {
                if (config.mode === "live") {
                  const ok = await confirm({ title: "Confirmer la mise ?", description: `Trade manuel à $${v} (argent réel).`, confirmLabel: "Confirmer", danger: true });
                  if (!ok) return false;
                }
                setForceStake(v);
                return true;
              }} />
          </div>
          <Button
            disabled={!derivSession.connected || forcingTrade || (forceSymbol ? !isCallPutAvailable(forceSymbol) : false)}
            onClick={async () => {
              if (!forceSymbol) return;
              const label = SYMBOLS.find((x) => x.deriv === forceSymbol)?.label ?? forceSymbol;
              const isLive = config.mode === "live";
              const confirmed = await confirm({
                title: isLive ? "⚠️ CONFIRMER LE TRADE (RÉEL) ?" : "Confirmer le trade (démo) ?",
                description: `Position ${forceDir === "CALL" ? "Hausse (CALL)" : "Baisse (PUT)"} sur ${label} · $${forceStake}`,
                confirmLabel: isLive ? "Exécuter (RÉEL)" : "Exécuter",
                danger: isLive,
              });
              if (!confirmed) return;
              setForcingTrade(true);
              toast.info(`Trade en cours — ${label} ${forceDir}…`);
              try {
                await forceDemoTrade(forceSymbol, forceDir, forceStake, config.durationMinutes, (log) => {
                  handleEvent(log);
                  if (log.status === "open") toast.success(`Contrat ouvert — ${label} ${forceDir}`);
                });
              } catch (e) {
                toast.error(`Échec: ${(e as Error).message}`);
              } finally {
                setForcingTrade(false);
              }
            }}
            className={cn("w-full sm:w-auto h-10 px-6 gap-1.5 text-sm font-bold shrink-0",
              forceDir === "CALL"
                ? "bg-up/20 text-up border border-up/40 hover:bg-up/30"
                : "bg-down/20 text-down border border-down/40 hover:bg-down/30",
              "disabled:bg-muted/10 disabled:text-muted-foreground disabled:border-border disabled:cursor-not-allowed")}>
            {forcingTrade
              ? <><Activity className="h-4 w-4 animate-pulse" /> Envoi…</>
              : <><Zap className="h-4 w-4" /> Exécuter (${forceStake})</>}
          </Button>
        </div>
        {!derivSession.connected && (
          <p className="text-[11px] text-muted-foreground font-medium">
            Connecte Deriv pour trader manuellement.
          </p>
        )}
        {derivSession.connected && forceSymbol && !isCallPutAvailable(forceSymbol) && (
          <p className="text-[11px] text-amber-400 font-medium">
            {forceSymbol.startsWith("BOOM") || forceSymbol.startsWith("CRASH")
              ? "Symbole Multiplier uniquement — le trade manuel binaire n'est pas supporté sur Boom/Crash."
              : "Symbole Multiplier uniquement — le trade manuel binaire n'est pas supporté sur les cryptos."}
          </p>
        )}
      </div>

      <OpportunityCommandCenter
        presetLabel={presetLabels[selectedPreset]}
        opportunity={selectedOpportunity}
        takeCount={selectedPresetOpportunities.filter((o) => o.decision === "take").length}
        waitCount={selectedPresetOpportunities.filter((o) => o.decision === "wait").length}
        avoidCount={selectedPresetOpportunities.filter((o) => o.decision === "avoid").length}
        loading={opportunitiesBusy && !opportunities}
        config={config}
        autoEnabled={!!cloudSelected?.enabled}
        cloudBusy={cloudBusy}
        manualBusy={manualBusy}
        derivConnected={derivSession.connected}
        onRefresh={refreshOpportunities}
        onManual={executeManualOpportunity}
        onAuto={toggleCloud}
      />

      <OpportunityBoard
        opportunities={selectedPresetOpportunities}
        loading={opportunitiesBusy && !opportunities}
        onRefresh={refreshOpportunities}
      />

      {/* ── Alert banners ── */}
      {riskStopReasons.length > 0 && (
        <div className="rounded-xl border border-down/40 bg-down/8 p-5 flex gap-4">
          <ShieldAlert className="h-6 w-6 shrink-0 text-down mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold uppercase tracking-wide text-down mb-2">⏸ Bot en pause — risque détecté</div>
            {riskStopReasons.map((r, i) => <div key={i} className="text-sm text-foreground">• {r}</div>)}
            <p className="mt-2 text-xs text-muted-foreground">
              {pausedUntil && pausedUntil > Date.now()
                ? `Reprise automatique à ${new Date(pausedUntil).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} — pas besoin de relancer.`
                : "Le bot a repris son scan automatiquement."}
            </p>
          </div>
          <button onClick={() => setEngineRiskStopReasons([])} className="text-muted-foreground hover:text-foreground text-xl leading-none shrink-0">×</button>
        </div>
      )}
      <CooldownBanner lastScan={lastScan} />



      {/* ── Mobile section switcher — 3 focused tabs instead of 4. Config
          and Journal are merged into "Données" since both are read-only
          views when the bot is running. Desktop ignores this entirely.
          Tapping "Données" also flips the same `showAdvanced` flag desktop's
          "Avancé" button controls — one source of truth, two entry points,
          instead of mobile always showing this content regardless of the
          flag desktop gates it behind. ── */}
      <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted/10 p-1.5 md:hidden">
        {([
          { id: "control", label: "Exécution", icon: Power },
          { id: "dashboard", label: "Scanner", icon: Activity },
          { id: "data", label: "Données", icon: Settings2 },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = mobileTab === t.id || (t.id === "data" && (mobileTab === "config" || mobileTab === "journal"));
          return (
            <button
              key={t.id}
              onClick={() => {
                setMobileTab(t.id as typeof mobileTab);
                if (t.id === "data") setShowAdvanced(true);
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wide transition-all",
                active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Main 2-col layout ── */}
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">

        {/* ── LEFT: Control panel ── */}
        <div className={cn(mobileTab === "control" || mobileTab === "data" ? "block" : "hidden", "md:block space-y-4")}>

          {/* Bloc contrôle principal */}
          <div className="glass-panel rounded-2xl overflow-hidden">

            {/* Mode selector — 2 colonnes égales */}
            <div className="grid grid-cols-2 border-b border-border/40">
              {(["demo", "live"] as TradingMode[]).map((m) => {
                const isSelected = config.mode === m;
                return (
                  <button key={m} onClick={async () => {
                    if (m === "live") {
                      const ok = await confirm({
                        title: "Passer en mode LIVE ?",
                        description: "Le mode LIVE engage de l'argent réel sur les transactions Deriv. Es-tu sûr de vouloir passer en mode LIVE ?",
                        confirmLabel: "Passer en LIVE",
                        danger: true,
                      });
                      if (!ok) return;
                    }
                    patchConfig("mode", m);
                  }}
                    className={cn(
                      "flex flex-col items-center gap-1.5 py-4 text-center transition-all duration-200 border-r last:border-r-0 border-border/40",
                      isSelected
                        ? m === "live" ? "bg-down/10 text-down" : "bg-up/10 text-up"
                        : "text-muted-foreground hover:bg-muted/10 hover:text-foreground",
                    )}>
                    <span className="text-xl leading-none">{m === "demo" ? "🎮" : "⚡"}</span>
                    <span className="text-xs font-bold uppercase tracking-wider leading-none">
                      {m === "demo" ? "Démo" : "Live"}
                    </span>
                    {isSelected && (
                      <span className={cn("h-0.5 w-8 rounded-full", m === "live" ? "bg-down" : "bg-up")} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Execution status */}
            <div className="p-5 space-y-4">
              <div className={cn(
                "rounded-xl border p-4 transition-colors",
                anyRunning ? "border-up/30 bg-up/8" : "border-border/60 bg-muted/10",
              )}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 rounded-full", anyRunning ? "bg-up animate-pulse" : "bg-muted-foreground")} />
                      <span className="text-sm font-black uppercase tracking-wider text-foreground">Auto-exécution</span>
                    </div>
                    <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">
                      {cloudSelected?.enabled
                        ? "Au Pluriel exécute automatiquement les signaux qu'il classe « à prendre », selon tes règles de risque."
                        : "Au Pluriel scanne et conseille, sans ouvrir de position automatiquement."}
                    </p>
                  </div>
                  <Switch
                    checked={!!cloudSelected?.enabled}
                    disabled={cloudBusy}
                    onCheckedChange={toggleCloud}
                  />
                </div>
              </div>

              <div className="w-full space-y-2">
                <div className="flex items-center justify-between rounded-lg bg-muted/15 px-4 py-2.5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Statut</span>
                  <span className={cn("text-sm font-bold",
                    !cloudSelected?.enabled ? "text-muted-foreground" : config.mode === "live" ? "text-down" : "text-up")}>
                    {cloudSelected?.enabled && cloudSelected?.running
                      ? `● Actif — ${config.mode === "live" ? "Live" : "Démo"}`
                      : cloudSelected?.enabled
                      ? "◐ Démarrage…"
                      : "○ Désactivée"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted/15 px-4 py-2.5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Risque</span>
                  <span className="text-sm font-bold text-foreground">${config.stakeUsd} · max -${config.maxDailyLossUsd}/j</span>
                </div>
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
              </div>
            </div>

            <AutoBacktestStatus className="mt-3" />
          </div>
          {/* Mise Kelly réduite — affects the actual stake in play, so it stays
              visible on mobile even though the sessions panel below doesn't. */}
          {config.adaptiveStake && effectiveStake < config.stakeUsd && (
            <div className="glass-panel rounded-xl px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm text-amber-400 font-semibold">Mise Kelly réduite</span>
              <span className="text-sm font-bold text-amber-400">${effectiveStake.toFixed(2)}</span>
            </div>
          )}


        </div>

        {/* ── RIGHT: Dashboard + positions ── */}
        <div className={cn(mobileTab === "dashboard" || mobileTab === "data" ? "block" : "hidden", "md:block space-y-5 min-w-0")}>
            
            <BotDashboard
              logs={cloudActive ? (cloudSelected?.trades ?? []) : logs}
              lastScan={cloudActive ? (cloudSelected?.lastScan ?? null) : lastScan}
              config={config}
              running={!!cloudSelected?.enabled && !!cloudSelected?.running}
              pnl={pnl}
              lossUsedUsd={lossUsedUsd}
            />

          {/* Positions en direct + scanner — always rendered together */}
          <div className="space-y-5 animate-fade-in">
            {openTradeList.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="h-2 w-2 rounded-full bg-up animate-pulse shadow-[0_0_8px_var(--up)]" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-200">Positions en direct ({openTradeList.length})</h2>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {openTradeList.map((t) => (
                    <LiveTradeCard key={t.id} trade={t}
                      onDismiss={() => { setEngineLogs([...dismissTrade(t.id)]); toast.info(`Carte fermée — ${t.symbol}`); }} />
                  ))}
                </div>
              </div>
            ) : (
              <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-neutral-950/40 p-8 flex flex-col items-center justify-center gap-5 text-center min-h-[210px] backdrop-blur-sm before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.01),transparent_70%)]">
                <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-up/20 bg-up/5">
                  <span className="absolute inline-flex h-full w-full rounded-full border border-up/25 animate-ping opacity-30" style={{ animationDuration: "2.5s" }} />
                  <span className="absolute inline-flex h-[70%] w-[70%] rounded-full border border-up/30 animate-pulse opacity-40" />
                  <Activity className="h-5 w-5 text-up animate-pulse" />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-bold uppercase tracking-wider text-neutral-200">Scan des marchés en cours</div>
                  <p className="text-xs text-muted-foreground/80 max-w-[280px] leading-relaxed mb-3">
                    Surveillance des signaux et configurations techniques CALL/PUT en temps réel.
                  </p>
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-white/5 bg-neutral-900/60 px-3 py-1 text-xs font-mono font-bold tracking-wider text-cyan shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse" />
                    <ScanCountdown lastScan={lastScan} SCAN_INTERVAL_MS={SCAN_INTERVAL_MS} config={config} />
                  </div>
                </div>
              </div>
            )}

            <ScannerSection
              cloudActive={cloudActive}
              cloudSelected={cloudSelected}
              lastScan={lastScan}
              config={config}
            />
          </div>
        </div>
      </div>

      {/* ── Config: grouped under the mobile "Données" tab, same showAdvanced
          flag desktop's "Avancé" button drives — one source of truth. ── */}
      <div className={cn(showAdvanced && (mobileTab === "config" || mobileTab === "data") ? "block" : "hidden", showAdvanced ? "md:block" : "md:hidden", "space-y-6")}>

      {/* ── Config panel (collapsible + tabbed) ── */}
      <div className="glass-panel rounded-2xl overflow-hidden">
        <button
          className="flex w-full items-center justify-between px-6 py-5 hover:bg-muted/10 transition-colors"
          onClick={() => setShowConfig((v) => !v)}
        >
          <div className="flex items-center gap-2.5">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            <span className="text-base font-black uppercase tracking-wider text-neutral-200">Configuration</span>
            {cloudSelected?.enabled && <span className="text-xs text-muted-foreground bg-muted/30 rounded-md px-2.5 py-1 font-bold">S'applique au prochain redémarrage de l'auto-exécution</span>}
          </div>
          {showConfig ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
        </button>

        {showConfig && (
          <div className="border-t border-border/40">
            {/* Tab nav */}
            <div className="border-b border-border/40">
              <div className="max-w-6xl mx-auto flex flex-col gap-4 px-6 pt-4 pb-4 sm:flex-row sm:items-center sm:gap-3 sm:pt-3 sm:pb-0">
                <div className="flex overflow-x-auto scrollbar-none gap-1.5 -mb-px">
                  {([["profiles","Profils"],["params","Paramètres"],["risk","Risque & Sessions"]] as const).map(([t, label]) => (
                    <button key={t} onClick={() => setConfigTab(t)}
                      className={cn("px-5 py-3.5 text-sm font-black uppercase tracking-wider rounded-t-lg transition-colors whitespace-nowrap border-b-2 sm:py-2.5",
                        configTab === t ? "text-foreground border-primary bg-muted/20" : "text-muted-foreground border-transparent hover:text-foreground")}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 sm:ml-auto pb-1 sm:pb-2.5 self-center w-full sm:w-auto">
                  <Link to="/backtest"
                    className="flex items-center justify-center gap-2 rounded-xl bg-muted/20 text-muted-foreground hover:bg-muted/30 hover:text-foreground border border-border/40 transition-all font-black text-sm px-4 py-2 w-full sm:w-auto sm:text-xs sm:px-3 sm:py-1.5">
                    <FlaskConical className="h-4 w-4" /> Backtester →
                  </Link>
                  <button onClick={() => setShowSavePreset(true)}
                    className="flex items-center justify-center gap-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 border border-primary/20 transition-all font-black text-sm px-4 py-2 w-full sm:w-auto sm:text-xs sm:px-3 sm:py-1.5">
                    <Save className="h-4 w-4" /> Sauvegarder config
                  </button>
                </div>
              </div>
            </div>

            <div className="max-w-6xl mx-auto w-full p-5">
              {/* TAB: Profils */}
              {configTab === "profiles" && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    {(Object.keys(PRESETS) as RiskProfile[]).map((key) => {
                      const preset = PRESETS[key];
                      const isActive = config.minConfidence === preset.minConfidence && config.minTfAgreement === preset.minTfAgreement
                        && config.premiumOnly === preset.premiumOnly && config.maxTradesPerDay === preset.maxTradesPerDay
                        && config.maxConsecutiveLosses === preset.maxConsecutiveLosses;

                      const themeMap: Record<RiskProfile, { border: string; glow: string; text: string; badge: string; dot: string; indicator: string }> = {
                        conservative: {
                          border: "border-white/5 bg-neutral-950/40 hover:border-amber-500/40 hover:bg-neutral-950/60",
                          glow: "shadow-[0_0_24px_rgba(245,158,11,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] border-amber-500/60 bg-amber-950/20 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-amber-500",
                          text: "text-amber-400",
                          badge: "bg-amber-500/10 border-amber-500/20 text-amber-300",
                          dot: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
                          indicator: "bg-amber-500/10 border-amber-500/25"
                        },
                        moderate: {
                          border: "border-white/5 bg-neutral-950/40 hover:border-cyan/40 hover:bg-neutral-950/60",
                          glow: "shadow-[0_0_24px_rgba(141,230,250,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] border-cyan/60 bg-cyan/5 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-cyan",
                          text: "text-cyan",
                          badge: "bg-cyan/10 border-cyan/20 text-cyan",
                          dot: "bg-cyan shadow-[0_0_8px_rgba(141,230,250,0.8)]",
                          indicator: "bg-cyan/10 border-cyan/25"
                        },
                        aggressive: {
                          border: "border-white/5 bg-neutral-950/40 hover:border-up/40 hover:bg-neutral-950/60",
                          glow: "shadow-[0_0_24px_rgba(16,185,129,0.12),inset_0_1px_0_rgba(255,255,255,0.05)] border-up/60 bg-up/10 before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-up",
                          text: "text-up",
                          badge: "bg-up/10 border-up/20 text-up",
                          dot: "bg-up shadow-[0_0_8px_rgba(16,185,129,0.8)]",
                          indicator: "bg-up/10 border-up/25"
                        }
                      };

                      const th = themeMap[key];

                      return (
                        <button key={key}
                          onClick={() => {
                            const { name, description, emoji, recommendedCapital, targetWinRate, expectedTradesPerDay, ...pc } = preset;
                            const next = { ...config, ...pc, stakeUsd: config.stakeUsd, maxDailyLossUsd: config.maxDailyLossUsd };
                            setConfig(next); saveConfig(next, selectedPreset);
                            toast.success(`${preset.emoji} Profil ${preset.name} appliqué`, { description: `Mise conservée: $${config.stakeUsd}` });
                          }}
                          className={cn("relative overflow-hidden rounded-xl border p-4.5 text-left transition-all duration-300 flex flex-col justify-between min-h-[220px]",
                            isActive ? th.glow : th.border)}>
                          
                          <div className="w-full relative z-10">
                            {/* Top bar: Icon + Active Dot */}
                            <div className="flex items-center justify-between mb-3">
                              <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg border text-base shadow-sm", isActive ? th.badge : "bg-neutral-900/50 border-white/5")}>
                                {preset.emoji}
                              </span>
                              {isActive && (
                                <span className="flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-neutral-300">
                                  <span className={cn("h-1.5 w-1.5 rounded-full animate-pulse", th.dot)} />
                                  Actif
                                </span>
                              )}
                            </div>

                            {/* Name & description */}
                            <div className="space-y-1 mb-4">
                              <div className="text-xs font-black uppercase tracking-widest text-neutral-200">{preset.name}</div>
                              <p className="text-[11px] text-muted-foreground/80 leading-relaxed font-medium line-clamp-3">
                                {preset.description}
                              </p>
                            </div>
                          </div>

                          {/* Labeled Micro-Metrics Grid (Scorecard Style) */}
                          <div className="w-full border-t border-white/5 pt-3 relative z-10 grid grid-cols-3 gap-2">
                            <div className="space-y-0.5">
                              <span className="block text-[8px] font-bold text-muted-foreground/60 uppercase tracking-widest leading-none">CAPITAL</span>
                              <span className="block text-[10px] font-black text-neutral-200 tracking-tight leading-normal">{preset.recommendedCapital}</span>
                            </div>
                            <div className="space-y-0.5 border-l border-white/5 pl-2">
                              <span className="block text-[8px] font-bold text-muted-foreground/60 uppercase tracking-widest leading-none">CIBLE W/R</span>
                              <span className="block text-[10px] font-black text-neutral-200 tracking-tight leading-normal">{preset.targetWinRate}</span>
                            </div>
                            <div className="space-y-0.5 border-l border-white/5 pl-2">
                              <span className="block text-[8px] font-bold text-muted-foreground/60 uppercase tracking-widest leading-none">TRADES/J</span>
                              <span className="block text-[10px] font-black text-neutral-200 tracking-tight leading-normal">{preset.expectedTradesPerDay}</span>
                            </div>
                          </div>

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
                              <button className="w-full text-left"
                                onClick={() => {
                                  const { id, name, description, emoji, recommendedCapital, targetWinRate, expectedTradesPerDay, createdAt, performance, ...pc } = preset;
                                  setConfig({ ...config, ...pc, stakeUsd: config.stakeUsd, maxDailyLossUsd: config.maxDailyLossUsd });
                                  saveConfig({ ...config, ...pc, stakeUsd: config.stakeUsd, maxDailyLossUsd: config.maxDailyLossUsd }, selectedPreset);
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
                        <AmountInput value={config.initialCapital} min={10} max={100000} step={10}                          onCommit={async (v) => { patchConfig("initialCapital", v); return true; }} />
                      </Field>
                      <p className="mt-1.5 text-xs text-muted-foreground">Base de calcul des fonds disponibles.</p>
                    </div>
                    <div className="text-left sm:text-right w-full sm:w-auto pt-3 border-t border-border/40 sm:pt-0 sm:border-t-0">
                      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 font-bold">Gains cumulés</div>
                      <div className={cn("font-mono-tabular text-3xl font-black", cumulativePnl >= 0 ? "text-up" : "text-down")}>
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
                      <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Mode de mise</label>
                      <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                        {(["fixed", "percent", "kelly"] as const).map((m) => (
                          <button key={m} onClick={() => patchConfig("stakeMode", m)}
                            className={cn("px-4 py-2 text-xs font-semibold transition-colors",
                              config.stakeMode === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
                            {m === "fixed" ? "$ Fixe" : m === "percent" ? "% Capital" : "Kelly"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Field label={config.stakeMode === "percent" ? `Mise par trade (${config.stakePercent}% du capital)` : config.stakeMode === "kelly" ? "Mise Kelly — mise de secours ($)" : "Mise par trade ($)"}>
                      {config.stakeMode === "percent" ? (
                        <div>
                          <input type="range" min={0.5} max={5} step={0.5} value={config.stakePercent}                            onChange={(e) => patchConfig("stakePercent", Number(e.target.value))} className="w-full accent-primary" />
                          <div className="flex justify-between text-xs font-semibold text-muted-foreground mt-0.5">
                            <span>0.5%</span>
                            {derivSession.balance !== null && (
                              <span className="text-primary font-semibold">≈ ${((derivSession.balance * config.stakePercent) / 100).toFixed(2)}</span>
                            )}
                            <span>5%</span>
                          </div>
                          <p className="text-xs font-semibold text-muted-foreground/90 mt-1">Recommandé : 1–2% du capital par trade</p>
                        </div>
                      ) : (
                        <AmountInput value={config.stakeUsd} min={1} max={100} step={1}                          onCommit={async (v) => {
                            const ok = await confirm({ title: "Modifier la mise ?", description: `$${config.stakeUsd} → $${v} par trade${config.mode === "live" ? " (argent réel)" : ""}`, confirmLabel: "Confirmer", danger: config.mode === "live" });
                            if (ok) { patchConfig("stakeUsd", v); saveDefaultStake(v); toast.success(`Mise: $${v}`); }
                            return ok;
                          }} />
                      )}
                    </Field>
                    {config.stakeMode === "kelly" && (
                      <div className="sm:col-span-2 lg:col-span-3 rounded-xl border border-border/60 bg-muted/10 p-3.5">
                        <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">
                          Fraction de Kelly ({(config.kellyFraction * 100).toFixed(0)}%)
                        </label>
                        <input type="range" min={0.1} max={1} step={0.05} value={config.kellyFraction}                          onChange={(e) => patchConfig("kellyFraction", Number(e.target.value))} className="w-full accent-primary" />
                        <p className="text-xs font-semibold text-muted-foreground/90 mt-1.5 leading-relaxed">
                          Mise = fraction de Kelly (f* = gain − perte/payout) calculée à partir du win rate et du payout
                          <strong> réellement mesurés au backtest</strong> pour chaque paire — pas une estimation. 50%
                          (demi-Kelly) est recommandé pour amortir l'incertitude d'échantillon. Sans backtest récent
                          (≥20 trades) pour une paire, la mise de secours ($ Fixe) is utilisée à la place.
                        </p>
                      </div>
                    )}
                    <Field label="Durée contrat">
                      <select
                        value={config.durationMinutes}
                        onChange={(e) => patchConfig("durationMinutes", Number(e.target.value))}
                        className="cfg-input"
                      >
                        <option value={5}>5 min</option>
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={60}>1 heure</option>
                      </select>
                    </Field>
                    <Field label="Trades max / jour">
                      <AmountInput
                        value={config.maxTradesPerDay}
                        min={1}
                        max={50}
                        step={1}
                        onCommit={(v) => { patchConfig("maxTradesPerDay", v); return true; }}
                      />
                    </Field>
                    <Field label={`Confiance min (${config.minConfidence}%)`}>
                      <input type="range" min={55} max={95} step={5} value={config.minConfidence}                        onChange={(e) => patchConfig("minConfidence", Number(e.target.value))} className="w-full accent-primary" />
                      <div className="flex justify-between text-xs font-semibold text-muted-foreground mt-0.5"><span>55%</span><span>95%</span></div>
                    </Field>
                    <Field label={`Accord TF min (${config.minTfAgreement}/4)`}>
                      <input type="range" min={1} max={4} step={1} value={config.minTfAgreement}                        onChange={(e) => patchConfig("minTfAgreement", Number(e.target.value))} className="w-full accent-primary" />
                      <div className="flex justify-between text-xs font-semibold text-muted-foreground mt-0.5"><span>1 TF</span><span>4 TF</span></div>
                    </Field>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Mode de scan</label>
                      <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                        {(["watchlist", "all-markets"] as const).map((m) => (
                          <button key={m} onClick={() => patchConfig("symbolMode", m)}
                            className={cn("px-4 py-2 text-xs font-semibold transition-colors",
                              config.symbolMode === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
                            {m === "watchlist" ? "Paires choisies" : `Tous les marchés (${SYMBOLS.filter((s) => isCallPutAvailable(s.deriv)).length})`}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs font-semibold text-muted-foreground/90 mt-1.5 leading-relaxed">
                        {config.symbolMode === "all-markets"
                          ? "Analyse toutes les paires CALL/PUT en parallèle à chaque cycle et trade les meilleures opportunités classées par confiance — les filtres de qualité ci-dessus s'appliquent toujours."
                          : "Ne trade que les paires cochées ci-dessous."}
                      </p>
                    </div>
                    {config.symbolMode === "all-markets" && (
                      <Field label={`Trades max par cycle (${config.maxSimultaneousTrades})`}>
                        <input type="range" min={1} max={10} step={1} value={config.maxSimultaneousTrades}                          onChange={(e) => patchConfig("maxSimultaneousTrades", Number(e.target.value))} className="w-full accent-primary" />
                        <p className="text-xs font-semibold text-muted-foreground/90 mt-0.5">Limite les nouvelles positions ouvertes en un seul cycle de scan.</p>
                      </Field>
                    )}
                    <div className={cn("sm:col-span-2 lg:col-span-1", config.symbolMode === "all-markets" && "opacity-40 pointer-events-none")}>
                      <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Paires surveillées</label>
                      <div className="flex flex-wrap gap-1.5">
                        {SYMBOLS.map((s) => {
                          const active = config.symbols.includes(s.deriv);
                          return (
                            <button key={s.deriv} disabled={config.symbolMode === "all-markets"}
                              onClick={() => { const next = active ? config.symbols.filter((x) => x !== s.deriv) : [...config.symbols, s.deriv]; if (next.length > 0) patchConfig("symbols", next); }}
                              className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                                active ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]" : "border-border text-muted-foreground hover:text-foreground")}>
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

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
                    <input type="number" min={1} max={10} value={config.maxConsecutiveLosses}                      onChange={(e) => patchConfig("maxConsecutiveLosses", Number(e.target.value))} className="cfg-input" />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Arrêt / cooldown après N pertes</p>
                  </Field>
                  <Field label="Volatilité max (ATR%)">
                    <select value={config.maxVolatilityPct} onChange={(e) => patchConfig("maxVolatilityPct", Number(e.target.value))} className="cfg-input">
                      <option value={2}>2% — prudent</option><option value={3}>3%</option>
                      <option value={4}>4% — équilibré</option><option value={6}>6% — agressif</option>
                    </select>
                  </Field>
                  {([
                    ["premiumOnly","Signaux PREMIUM uniquement","Ne trade que les meilleurs signaux"],
                    ["stopOnRisk","Pause auto sur risque","Pause + notification, reprise automatique"],
                    ["adaptiveStake","Mise Kelly adaptative","Réduit la mise quand win rate < 55%"],
                    ["newsFilter","Filtre news & ouvertures","Bloque les fenêtres à risque (NFP, Fed, ouvertures de session) sur forex/indices"],
                  ] as const).map(([key, label, desc]) => (
                    <Field key={key} label={label}>
                      <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                        <span className="text-xs text-muted-foreground">{config[key] ? "Activé" : "Désactivé"}</span>
                        <Switch checked={config[key] as boolean} onCheckedChange={(v) => patchConfig(key, v)} />
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{desc}</p>
                    </Field>
                  ))}
                  <Field label="Veto 4H (contre-tendance)">
                    <select value={config.veto4h ?? "strong-only"} onChange={(e) => patchConfig("veto4h", e.target.value as Veto4hMode)} className="cfg-input">
                      <option value="strong-only">Signal 4H fort uniquement — recommandé</option>
                      <option value="always">Toujours (strict)</option>
                      <option value="off">Désactivé</option>
                    </select>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Un 4H opposé annule le trade. « Fort uniquement » ignore les 4H hésitants — plus de trades.</p>
                  </Field>
                  <Field label={`Trailing stop — drawdown ($${config.trailingStopUsd === 0 ? " off" : config.trailingStopUsd})`}>
                    <AmountInput value={config.trailingStopUsd} min={0} max={500} step={5}
                      onCommit={(v) => { patchConfig("trailingStopUsd", v); toast.success(v === 0 ? "Trailing stop désactivé" : `Trailing stop: $${v} sous le pic`); return true; }} />
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Arrêt si le P&amp;L recule de ce montant depuis son pic. 0 = désactivé</p>
                  </Field>
                  <Field label="Bloquer les paires corrélées">
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                      <span className="text-xs text-muted-foreground">{config.blockCorrelated ? "Activé" : "Désactivé"}</span>
                      <Switch checked={config.blockCorrelated} onCheckedChange={(v) => { patchConfig("blockCorrelated", v); toast.success(v ? "Corrélation activée — une paire par groupe" : "Corrélation désactivée"); }} />
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      Évite d&apos;ouvrir deux paires corrélées en même temps.{" "}
                      {CORRELATION_GROUPS.map((g, i) => <span key={i} className="opacity-60">{g.map(s => s.replace(/^(frx|cry)/, "")).join("+")} </span>)}
                    </p>
                  </Field>
                  <Field label={`Buffer ouverture/clôture session (${config.sessionEdgeMinutes} min)`}>
                    <input type="range" min={0} max={60} step={15} value={config.sessionEdgeMinutes}                      onChange={(e) => patchConfig("sessionEdgeMinutes", Number(e.target.value))} className="w-full accent-primary" />
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
                          <button key={s} onClick={() => { const next = active ? config.tradingSessions.filter((x) => x !== s) : [...config.tradingSessions, s]; if (next.length > 0) patchConfig("tradingSessions", next); }}
                            className={cn("rounded-xl border px-4 py-2 text-xs font-medium transition-colors text-left",
                              active ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]" : "border-border text-muted-foreground hover:text-foreground")}>
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
            </div>
          </div>
        )}
      </div>

      </div>

      {/* ── Trade Journal — its own mobile tab ── */}
      <div className={cn(showAdvanced && (mobileTab === "journal" || mobileTab === "data") ? "block" : "hidden", showAdvanced ? "md:block" : "md:hidden")}>
      <div className="glass-panel rounded-2xl overflow-hidden">
        <button className="flex w-full items-center justify-between px-5 py-4 hover:bg-muted/10 transition-colors"
          onClick={() => setShowLogs((v) => !v)}>
          <div className="flex items-center gap-2.5">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-base font-black uppercase tracking-wider text-neutral-200">Journal</span>
            <span className="text-[10px] bg-muted/40 text-muted-foreground rounded-md px-2 py-0.5">{journalTrades.length} trades</span>
            {wins > 0 && <span className="text-[10px] bg-up/15 text-up rounded-md px-2 py-0.5">{wins} gagnés</span>}
            {losses > 0 && <span className="text-[10px] bg-down/15 text-down rounded-md px-2 py-0.5">{losses} perdus</span>}
            {cloudActive && (
              <span className="text-[10px] bg-[color:var(--brand-cyan)]/15 text-[color:var(--brand-cyan)] rounded-md px-2 py-0.5">
                serveur · {presetLabels[selectedPreset]}
              </span>
            )}
          </div>
          {showLogs ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {showLogs && (
          <div className="border-t border-border/40">
            {journalTrades.length > 0 && (
              <div className="flex gap-1 px-5 pt-3 pb-1 flex-wrap">
                {(["all","won","lost","open","error"] as const).map((f) => {
                  const count = f === "all" ? journalTrades.length : journalTrades.filter((l) => l.status === f).length;
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
              const fl = logFilter === "all" ? journalTrades : journalTrades.filter((l) => l.status === logFilter);
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
                                  {t.note && <span className="block text-[10px] text-muted-foreground truncate" title={t.note}>{t.note}</span>}
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
                  {!cloudActive && (
                    <div className="flex justify-end px-5 py-2.5 border-t border-border/30">
                      <button onClick={async () => {
                        const ok = await confirm({ title: "Effacer le journal ?", description: "Tout l'historique sera supprimé.", confirmLabel: "Effacer", danger: true });
                        if (!ok) return;
                        localStorage.removeItem("lio23.autotrader_log");
                        setEngineLogs([]);
                      }} className="text-[10px] text-muted-foreground hover:text-down transition-colors">
                        Effacer le journal
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
      </div>

      {/* ── Live server scanner — below the trade journal for better visibility ── */}
      <div className={cn(showAdvanced && (mobileTab === "journal" || mobileTab === "data") ? "block" : "hidden", showAdvanced ? "md:block" : "md:hidden")}>
        {cloudSelected?.enabled && cloudSelected.lastScan && (
          <CloudScanPanel lastScan={cloudSelected.lastScan} />
        )}
      </div>

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

function OpportunityCommandCenter({
  presetLabel,
  opportunity,
  takeCount,
  waitCount,
  avoidCount,
  loading,
  config,
  autoEnabled,
  cloudBusy,
  manualBusy,
  derivConnected,
  onRefresh,
  onManual,
  onAuto,
}: {
  presetLabel: string;
  opportunity: OpportunityItem | null;
  takeCount: number;
  waitCount: number;
  avoidCount: number;
  loading: boolean;
  config: AutoTraderConfig;
  autoEnabled: boolean;
  cloudBusy: boolean;
  manualBusy: boolean;
  derivConnected: boolean;
  onRefresh: () => void;
  onManual: () => void;
  onAuto: () => void;
}) {
  const decision = opportunity?.decision ?? "wait";
  const style = decisionTone(decision);
  const canManual = !!opportunity?.direction && opportunity.decision === "take" && derivConnected && !manualBusy;
  const manualHint = !derivConnected
    ? "Deriv requis"
    : opportunity?.decision !== "take"
      ? "Signal non validé"
      : "Exécuter";

  return (
    <section className={cn("glass-panel overflow-hidden rounded-2xl border", style.panel)}>
      <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
        <div className="p-4 md:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-black uppercase tracking-wider", style.badge)}>
                  <style.Icon className="h-3.5 w-3.5" />
                  {style.label}
                </span>
                <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-bold text-muted-foreground">
                  {presetLabel}
                </span>
                {loading && (
                  <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-bold text-muted-foreground">
                    Analyse…
                  </span>
                )}
              </div>

              <h2 className="mt-3 text-lg font-black tracking-tight md:text-xl">
                {opportunity ? `${opportunity.label} · ${opportunity.directionLabel}` : "Aucun signal exploitable pour l'instant"}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {opportunity
                  ? `Confiance ${Math.round(opportunity.confidence)}% · Accord ${opportunity.agreement}/4 · Risque ${riskLabel(opportunity.risk)} · ${opportunity.durationMinutes} min`
                  : "Au Pluriel continue de scanner. Dans le doute, le bon trade est souvent celui qu'on ne prend pas."}
              </p>
              <p className="mt-2 text-xs font-semibold text-muted-foreground/80">
                Configuration active : mise ${config.stakeUsd} · confiance {config.minConfidence}-{config.maxConfidence}% · accord {config.minTfAgreement}/4 TF
              </p>
            </div>

            <button
              onClick={onRefresh}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
            >
              <Activity className="h-3.5 w-3.5" />
              Actualiser
            </button>
          </div>

          {!!opportunity?.reasons.length && (
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              {opportunity.reasons.slice(0, 4).map((reason) => (
                <div key={reason} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-sm text-muted-foreground">
                  {reason}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border/40 bg-black/10 p-4 lg:border-l lg:border-t-0">
          <div className="grid grid-cols-3 gap-2">
            <MiniDecision label="Prendre" value={takeCount} className="text-up" />
            <MiniDecision label="Attendre" value={waitCount} className="text-amber-300" />
            <MiniDecision label="Éviter" value={avoidCount} className="text-down" />
          </div>

          <div className="mt-4 grid gap-2">
            <Button
              onClick={onManual}
              disabled={!canManual}
              className={cn(
                "h-11 w-full gap-2 font-black",
                canManual
                  ? "border border-up/30 bg-up/15 text-up hover:bg-up/25"
                  : "border border-border/60 bg-muted/10 text-muted-foreground",
              )}
            >
              {manualBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Zap className="h-4 w-4" />}
              {`Manuel · ${manualHint}`}
            </Button>
            <Button
              onClick={onAuto}
              disabled={cloudBusy}
              className={cn(
                "h-11 w-full gap-2 font-black",
                autoEnabled
                  ? "border border-down/30 bg-down/15 text-down hover:bg-down/25"
                  : "border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25",
              )}
            >
              {cloudBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Power className="h-4 w-4" />}
              {autoEnabled ? "Arrêter l'automatique" : "Automatique"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function OpportunityBoard({
  opportunities,
  loading,
  onRefresh,
}: {
  opportunities: OpportunityItem[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const groups: { decision: OpportunityDecision; title: string; empty: string }[] = [
    { decision: "take", title: "Prendre", empty: "Aucun marché propre à prendre." },
    { decision: "wait", title: "Attendre", empty: "Aucun setup en attente." },
    { decision: "avoid", title: "Éviter", empty: "Rien à éviter explicitement." },
  ];

  return (
    <section className="grid gap-3 lg:grid-cols-3">
      {groups.map((group) => {
        const style = decisionTone(group.decision);
        const items = opportunities.filter((o) => o.decision === group.decision).slice(0, 3);
        return (
          <div key={group.decision} className={cn("rounded-2xl border bg-card/25 p-4", style.panel)}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className={cn("grid h-8 w-8 place-items-center rounded-lg border", style.badge)}>
                  <style.Icon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wider text-foreground">{group.title}</h3>
                  <p className="text-[11px] font-semibold text-muted-foreground">{items.length} marché{items.length > 1 ? "s" : ""}</p>
                </div>
              </div>
              {group.decision === "wait" && (
                <button
                  onClick={onRefresh}
                  className="rounded-lg border border-border/60 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  Scanner
                </button>
              )}
            </div>

            <div className="mt-3 space-y-2">
              {loading && items.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-sm font-semibold text-muted-foreground">
                  Analyse en cours...
                </div>
              ) : items.length === 0 ? (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3 text-sm font-semibold text-muted-foreground">
                  {group.empty}
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-foreground">{item.label}</div>
                        <div className="mt-0.5 text-xs font-semibold text-muted-foreground">
                          {item.directionLabel} · {Math.round(item.confidence)}% · {item.agreement}/4 TF
                        </div>
                      </div>
                      <span className={cn(
                        "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                        item.risk === "faible" ? "bg-up/10 text-up" : item.risk === "modere" ? "bg-amber-500/10 text-amber-300" : "bg-down/10 text-down",
                      )}>
                        {riskLabel(item.risk)}
                      </span>
                    </div>
                    {item.reasons[0] && (
                      <p className="mt-2 line-clamp-2 text-xs font-medium leading-relaxed text-muted-foreground/85">
                        {item.reasons[0]}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function MiniDecision({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2 text-center">
      <div className={cn("text-lg font-black", className)}>{value}</div>
      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function decisionTone(decision: OpportunityDecision) {
  if (decision === "take") {
    return {
      label: "Prendre",
      Icon: CheckCircle2,
      panel: "border-up/25",
      badge: "border-up/25 bg-up/10 text-up",
    };
  }
  if (decision === "avoid") {
    return {
      label: "Éviter",
      Icon: ShieldAlert,
      panel: "border-down/25",
      badge: "border-down/25 bg-down/10 text-down",
    };
  }
  return {
    label: "Attendre",
    Icon: Clock,
    panel: "border-amber-500/25",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  };
}

function riskLabel(risk: OpportunityItem["risk"]) {
  if (risk === "faible") return "faible";
  if (risk === "modere") return "modéré";
  return "élevé";
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

function ScannerSection({ cloudActive, cloudSelected, lastScan, config }: {
  cloudActive: boolean;
  cloudSelected: PresetStatus | undefined;
  lastScan: ScanResult | null;
  config: AutoTraderConfig;
}) {
  return (
    <LiveSignals
      lastScan={cloudActive ? (cloudSelected?.lastScan ?? null) : lastScan}
      config={config}
      running={!!cloudSelected?.enabled && !!cloudSelected?.running}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-widest text-neutral-200">{label}</span>
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

function CloudScanPanel({ lastScan }: { lastScan: ScanResult }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsAgo = Math.floor((now - lastScan.time) / 1000);
  const traded = lastScan.results.filter((r) => r.action === "traded");
  const rejected = lastScan.results.filter((r) => r.action !== "traded");
  const total = lastScan.results.length;
  const labelFor = (s: string) => SYMBOLS.find((x) => x.deriv === s)?.label ?? s;

  return (
    <div className="glass-panel rounded-2xl overflow-hidden mt-4">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-cyan animate-pulse" />
          <span className="text-sm font-bold uppercase tracking-wider text-foreground">Scanner live</span>
          <span className="text-xs bg-muted/40 text-muted-foreground rounded-md px-2 py-0.5 font-mono">{total} symboles</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          il y a {secsAgo < 60 ? `${secsAgo}s` : `${Math.floor(secsAgo / 60)}min`}
        </span>
      </div>

      <div className="p-4 space-y-3">
        {traded.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {traded.map((r) => (
              <span key={r.symbol} className="inline-flex items-center gap-1.5 rounded-lg bg-up/10 border border-up/30 px-3 py-1.5 text-sm font-bold text-up" title={r.note}>
                {labelFor(r.symbol)} {r.direction} · {r.confidence}%
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {rejected.map((r) => {
            const meta = SCAN_ACTION_META[r.action] ?? { label: r.action, dot: "bg-neutral-600", text: "text-neutral-500" };
            return (
              <div key={r.symbol} className="flex items-center gap-2.5 rounded-lg bg-muted/8 px-3 py-2 text-sm" title={r.note ?? r.action}>
                <span className={cn("h-2 w-2 rounded-full shrink-0", meta.dot)} />
                <span className="text-neutral-200 truncate flex-1 font-medium">{labelFor(r.symbol)}</span>
                <span className={cn("shrink-0 text-xs font-bold", meta.text)}>{meta.label}</span>
                {r.confidence ? <span className="text-muted-foreground/60 shrink-0 text-xs tabular-nums w-8 text-right">{r.confidence}%</span> : null}
              </div>
            );
          })}
        </div>

        {total === 0 && (
          <p className="text-sm text-muted-foreground/50 text-center py-3">Aucun symbole — hors session ou en pause</p>
        )}
      </div>
    </div>
  );
}
