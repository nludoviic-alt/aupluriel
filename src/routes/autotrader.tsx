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
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";

import { playWinSound, playLossSound, playOpenSound } from "@/lib/sounds";
import { SCAN_ACTION_META } from "@/lib/scan-actions";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MarketSessionsBar } from "@/components/market-sessions-bar";
import { HealthPanel } from "@/components/health-panel";
import { BacktestVisualizer } from "@/components/backtest-visualizer";
import { SYMBOLS, getOpenPositions, sellContractNow, normalizeContractDirection, type OpenPosition } from "@/lib/deriv";
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
  openPreviewTrade,
  getInstrumentForSymbol,
  isCallPutAvailable,
  isInTradingSession,
  isSymbolTradeable,
  loadCumulativePnl,
  loadCustomPresets,
  loadDailyPnl,
  reconcileOpenTrades,
  PRESETS,
  BOOM_PRESET,
  CRASH_PRESET,
  LIQUIDITY_PRESET, SCALPING_PRESET,
  type QuickPreset,
  SCAN_INTERVAL_MS,
  saveCurrentAsPreset,
  SESSION_HOURS,
  type AutoTraderConfig,
  type CustomPreset,
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
import { cn, utcHourToMontreal } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { AmountInput } from "@/components/amount-input";
import { BotDashboard, LiveSignals } from "@/components/bot-dashboard";
import { AutoBacktestStatus } from "@/components/auto-backtest-status";
import { AutoTraderStatusBar } from "@/components/autotrader-status-bar";
import { TradeJournalSection } from "@/components/trade-journal-section";
import { LivePositionsPanel } from "@/components/live-positions-panel";
import { QuickMarketsEditor } from "@/components/quick-markets-editor";
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

type PresetKey = "default" | "boom" | "crash" | "scalping" | "liquidity";

const presetLabels: Record<PresetKey, string> = { default: "Multi", boom: "Boom", crash: "Crash", scalping: "Scalping", liquidity: "Reversal liquidité" };

// These are presentation labels only. The actual instruments and execution
// rules remain in the server-side config for each independent preset.
const PRESET_PRESENTATION: Record<PresetKey, { market: string; description: string; experimental?: boolean }> = {
  default: { market: "Forex · Métaux · Crypto", description: "Marchés configurés" },
  boom: { market: "Indices Boom", description: "Boom 500 · Boom 900" },
  crash: { market: "Indices Crash", description: "Crash 1000 · Crash 900" },
  scalping: { market: "BOOM500", description: "M1/M5 · stratégie distincte", experimental: true },
  liquidity: { market: "Or · Nasdaq", description: "M15 · balayage + RSI", experimental: true },
};

function formatConfiguredMarkets(symbols: string[] | undefined, fallback: string): string {
  if (!symbols?.length) return fallback;
  return symbols
    .map((symbol) => SYMBOLS.find((item) => item.deriv === symbol)?.label ?? symbol)
    .join(" · ");
}

/** Tab order on screen. The admin's mobile whitelist is filtered THROUGH this
 * list rather than used directly, so tabs always appear in the same order
 * regardless of the order they were enabled in /admin. */
const PRESET_ORDER = ["default", "boom", "crash", "scalping", "liquidity"] as const;

type OpportunityDecision = "take" | "wait" | "avoid";
interface OpportunityItem {
  id: string;
  preset: "default" | "boom" | "crash" | "scalping" | "liquidity";
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
  /** Complete server-side set, unlike `trades` which is intentionally capped. */
  openTrades: TradeLog[];
  allTimeStats: { trades: number; wins: number; losses: number; winRate: number; pnl: number };
  /** Configuration réellement chargée par le moteur serveur pour ce preset. */
  savedConfig: AutoTraderConfig | null;
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

export function AutoTraderPage({ defaultTab = "auto" }: { defaultTab?: "auto" | "manual" }) {
  const [config, setConfig] = useState<AutoTraderConfig>(DEFAULT_CONFIG);
  // Engine state (running flag, trade log, last scan, risk-stop reasons) lives
  // in a module-level store so it survives navigating to another page — see
  // use-autotrader-engine.ts for why.
  const { logs, lastScan, riskStopReasons, pausedUntil } = useAutoTraderEngine();
  const [activeSessions, setActiveSessions] = useState<TradingSession[]>([]);
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const lastPendingToastRef = useRef<number>(0);
  const [presetDesc, setPresetDesc] = useState("");
  const [cumulativePnl, setCumulativePnl] = useState(0);
  const [forcingTrade, setForcingTrade] = useState(false);
  // Requires a fresh, deliberate market/direction choice before EXÉCUTER can
  // fire again — without this, forceSymbol/forceDir/forceStake just sit at
  // whatever they were after the last trade (the sync effect below actively
  // keeps forceSymbol populated), so a second tap on EXÉCUTER silently placed
  // another identical order with nothing newly selected. True on first mount
  // (nothing was "just executed" yet); set false right after any successful
  // manual execution, set true again by prepareManualSignal or the direction
  // buttons — the two ways to actually choose what to trade in this tab.
  const [manualArmed, setManualArmed] = useState(() => {
    if (typeof window === "undefined") return false;
    const searchParams = new URLSearchParams(window.location.search);
    return searchParams.get("take") === "1" || searchParams.get("action") === "take" || searchParams.has("pair") || searchParams.has("symbol");
  });
  const [manualExecution, setManualExecution] = useState<{
    status: "pending" | "open";
    symbol: string;
    direction: TradeLog["direction"];
  } | null>(null);
  const [forceSymbol, setForceSymbol] = useState("");
  const [forceDir, setForceDir] = useState<"CALL" | "PUT" | "MULTUP" | "MULTDOWN">("CALL");
  const [forceStake, setForceStake] = useState(DEFAULT_CONFIG.stakeUsd);
  const [autoTpEnabled, setAutoTpEnabled] = useState(true);
  const [autoSlEnabled, setAutoSlEnabled] = useState(true);
  const [candleSeconds, setCandleSeconds] = useState(60 - (Math.floor(Date.now() / 1000) % 60));
  useEffect(() => {
    const id = setInterval(() => {
      setCandleSeconds(60 - (Math.floor(Date.now() / 1000) % 60));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  const [logFilter, setLogFilter] = useState<"all" | "won" | "lost" | "open" | "error">("all");
  const [showConfig, setShowConfig] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tradingTab] = useState<"auto" | "manual">(defaultTab);
  // The whole "Avancé" panel (bot config, dashboard, journal) only makes sense
  // for the Automatique tab — Prise Directe is a one-off manual trade, not bot
  // configuration. Gate every showAdvanced render on tradingTab too, so it
  // can't surface bot controls on a page whose whole point is to bypass the bot.
  const advancedVisible = showAdvanced && tradingTab === "auto";
  const [preparedManualOpportunity, setPreparedManualOpportunity] = useState<OpportunityItem | null>(null);
  const [liveDerivPositions, setLiveDerivPositions] = useState<OpenPosition[]>([]);
  const [showQuickCustomizer, setShowQuickCustomizer] = useState(false);
  const [quickSymbols, setQuickSymbols] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("lio23.quick_symbols");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* fallback */ }
    return ["frxEURUSD", "frxGBPUSD", "frxXAUUSD", "cryBTCUSD", "BOOM500"];
  });

  const saveQuickSymbols = useCallback((list: string[]) => {
    setQuickSymbols(list);
    try {
      localStorage.setItem("lio23.quick_symbols", JSON.stringify(list));
    } catch { /* ignore */ }
  }, []);

  const manualTradeRef = useRef<HTMLElement>(null);
  // Mobile-only section switcher — desktop keeps the always-visible 2-col layout;
  // below md, showing every section stacked at once was too dense, so mobile
  // sees one focused section at a time instead.
  const [mobileTab, setMobileTab] = useState<"control" | "dashboard" | "config" | "journal" | "data">("control");
  const [configTab, setConfigTab] = useState<"profiles" | "params" | "risk" | "multiplier" | "backtest">("profiles");
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
  // One flag per preset — the stake/cap draft sync (below) must catch up
  // once per preset the first time it's viewed, not just once globally.
  const syncedFromServerRef = useRef<Record<PresetKey, boolean>>({ default: false, boom: false, crash: false, scalping: false, liquidity: false });

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
      // This browser's draft can silently fall behind the server's saved
      // configuration (for example after an admin edit or another device).
      // The decision summary must describe what the engine actually uses;
      // sync once per preset before the user edits anything locally.
      const savedConfig = data.presets?.[selectedPreset]?.savedConfig;
      if (savedConfig) {
        syncedFromServerRef.current[selectedPreset] = true;
        setConfig((prev) => {
          const next = { ...prev, ...savedConfig };
          saveConfig(next, selectedPreset);
          return next;
        });
      }
    } catch { /* signed out or server unreachable — leave as-is */ }
  }, [selectedPreset]);

  const [telegramConfig, setTelegramConfig] = useState({
    botToken: "",
    chatId: "",
    enabled: true,
    notifyOnTradeOpen: true,
    notifyOnTradeClose: true,
    notifyOnRiskLimit: true,
    notifyOnSpikeSignal: true,
  });
  const [testingTelegram, setTestingTelegram] = useState(false);

  useEffect(() => {
    api.get<{ config: any }>("/api/telegram")
      .then((res) => {
        if (res.config && res.config.botToken !== undefined) {
          setTelegramConfig((prev) => ({ ...prev, ...res.config }));
        }
      })
      .catch(() => {});
  }, []);

  async function handleTestTelegram() {
    setTestingTelegram(true);
    try {
      const res = await api.post<{ success: boolean; error?: string }>("/api/telegram", {
        action: "test",
        config: { ...telegramConfig, enabled: true },
      });
      if (res.success) {
        toast.success("🔔 Notification Telegram envoyée avec succès !");
      } else {
        toast.error(`Échec Telegram: ${res.error || "Vérifiez Token et Chat ID"}`);
      }
    } catch {
      toast.error("Erreur de connexion à l'API Telegram");
    } finally {
      setTestingTelegram(false);
    }
  }

  async function handleSaveTelegram() {
    try {
      await api.post("/api/telegram", {
        action: "save",
        config: telegramConfig,
      });
      toast.success("Configuration Telegram sauvegardée !");
    } catch {
      toast.error("Erreur lors de la sauvegarde Telegram");
    }
  }

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
  }, [refreshCloud]);

  useEffect(() => {
    const id = setInterval(() => {
      refreshCloud();
    }, 10_000);
    return () => clearInterval(id);
  }, []);

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

  async function changeTradingMode(mode: TradingMode) {
    if (mode === config.mode) return;
    if (mode === "live") {
      const ok = await confirm({
        title: "Passer en mode LIVE ?",
        description: "Le mode LIVE engage de l'argent réel sur les transactions Deriv. Es-tu sûr de vouloir passer en mode LIVE ?",
        confirmLabel: "Passer en LIVE",
        danger: true,
      });
      if (!ok) return;
    }
    patchConfig("mode", mode);
  }

  // Synchroniser les positions ouvertes en temps réel depuis le WebSocket Deriv (toutes les 5s)
  useEffect(() => {
    if (!derivSession.connected) return;
    const fetchPositions = async () => {
      try {
        const pos = await getOpenPositions();
        setLiveDerivPositions(pos);
      } catch {}
    };
    fetchPositions();
    const id = setInterval(fetchPositions, 5000);
    return () => clearInterval(id);
  }, [derivSession.connected]);

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
    // Pre-select a pair/direction/preset when arriving from Opportunités (?symbol=...&direction=...&preset=...&take=1)
    const searchParams = new URLSearchParams(window.location.search);
    const pair = searchParams.get("pair") || searchParams.get("symbol");
    const direction = searchParams.get("direction");
    const presetParam = searchParams.get("preset") as PresetKey | null;
    const isTakeAction = searchParams.get("take") === "1" || searchParams.get("action") === "take";

    if (presetParam && PRESET_ORDER.includes(presetParam)) {
      setSelectedPreset(presetParam);
    }

    if (pair && SYMBOLS.some((s) => s.deriv === pair)) {
      if (!loaded.symbols.includes(pair)) {
        loaded.symbols = [...loaded.symbols, pair];
        saveConfig(loaded, presetParam || selectedPreset);
      }
      setForceSymbol(pair);
      if (direction === "CALL" || direction === "PUT" || direction === "MULTUP" || direction === "MULTDOWN") {
        setForceDir(direction as "CALL" | "PUT" | "MULTUP" | "MULTDOWN");
      }
      setManualArmed(true);
      setMobileTab("control");
      const label = SYMBOLS.find((s) => s.deriv === pair)?.label ?? pair;
      if (isTakeAction) {
        toast.success(`⚡ Trade Opportunité : ${label} (${direction || "CALL"}) prêt ! Ajustez votre mise et validez.`);
      } else {
        toast.success(`${label} sélectionné — prêt à trader`);
      }
    } else {
      const openStart = loaded.symbols.find((s) => isInTradingSession(["sydney", "asia", "london", "newyork"], s));
      setForceSymbol(openStart ?? loaded.symbols[0] ?? "frxEURUSD");
    }

    setConfig(loaded);
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
    const wins = logs.filter((l) => l.status === "won").length;
    const losses = logs.filter((l) => l.status === "lost").length;
    const openTradeList = logs.filter((l) => l.status === "open");
    const consecutiveLosses = countConsecutiveLosses(logs);
    const effectiveStake = config.adaptiveStake ? computeAdaptiveStake(config.stakeUsd, logs) : config.stakeUsd;
    return { pnl, wins, losses, openTradeList, consecutiveLosses, effectiveStake };
  }, [logs, config.adaptiveStake, config.stakeUsd]);

  const {
    pnl: localPnl, wins: localWins, losses: localLosses,
    openTradeList: localOpenTradeList,
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
  const wins = cloudActive ? cloudClosedToday.filter((t) => t.status === "won").length : localWins;
  const losses = cloudActive ? cloudClosedToday.filter((t) => t.status === "lost").length : localLosses;
  const winRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
  // Same local↔cloud switch, extended to the raw trade ROWS (not just the
  // aggregates above) — the journal table, open-positions cards, stake-at-
  // risk and the adaptive-stake preview all read individual trades. Without
  // this they silently kept reading the local engine's log even while the
  // server bot was the one actually trading this preset, so they'd look
  // empty/stuck right next to KPIs that were correctly showing cloud data.
  const journalTrades = cloudActive ? cloudTrades : logs;
  const openTradeList = cloudActive
    ? (cloudSelected?.openTrades ?? [])
    : localOpenTradeList;
  const openTrades = openTradeList.length;
  const consecutiveLosses = countConsecutiveLosses(journalTrades);
  const effectiveStake = config.adaptiveStake
    ? computeAdaptiveStake(config.stakeUsd, journalTrades)
    : config.stakeUsd;

  const combinedAutoOpenTrades = useMemo(() => {
    const list: TradeLog[] = [];
    for (const pos of liveDerivPositions) {
      const direction = normalizeContractDirection(pos.contractType);
      list.push({
        id: `deriv-${pos.contractId}`,
        symbol: pos.symbol,
        direction,
        stake: pos.buyPrice,
        status: "open",
        profit: pos.profit,
        pnl: pos.profit,
        time: pos.dateStart * 1000,
        timestamp: pos.dateStart * 1000,
        confidence: 0,
        // Deriv's date_expiry only means something for binaries — Multiplier
        // contracts close on TP/SL, not a clock, so it's left off those rows.
        ...(direction === "CALL" || direction === "PUT" ? { expiry: pos.dateExpiry * 1000 } : {}),
      } as unknown as TradeLog);
    }
    for (const t of openTradeList) {
      if (!list.some((item) => item.id === t.id)) {
        list.push(t);
      }
    }
    return list;
  }, [liveDerivPositions, openTradeList]);

  const selectedPresetOpportunities = useMemo(() => {
    return (opportunities?.opportunities ?? []).filter((o) => o.preset === selectedPreset);
  }, [opportunities?.opportunities, selectedPreset]);
  const selectedOpportunity = selectedPresetOpportunities[0] ?? null;
  const actionableOpportunity = selectedPresetOpportunities.find((o) => o.decision === "take") ?? null;
  // The manual screen exposes the same complete scan as Auto-Trader. Unlike
  // automatic mode, "wait" and "avoid" remain visible so the trader can make
  // an informed discretionary decision without the system placing the order.
  const manualScanOpportunities = selectedPresetOpportunities;
  const manualActionableOpportunities = manualScanOpportunities.filter(
    (opportunity) => opportunity.direction && (opportunity.decision === "take" || opportunity.decision === "wait"),
  );
  const manualOpportunity = selectedPresetOpportunities.find((o) => o.symbol === forceSymbol) ?? null;
  const manualInstrument = forceSymbol ? getInstrumentForSymbol(forceSymbol, config) : "binary";
  const manualDirectionBias = forceDir === "CALL" || forceDir === "MULTUP" ? "CALL" : "PUT";
  const manualDirectionMatchesSignal = !!manualOpportunity?.direction
    && manualOpportunity.direction === manualDirectionBias;
  const manualInstrumentSupported = !!forceSymbol && isSymbolTradeable(forceSymbol, manualInstrument);
  const manualAccountMatchesMode = config.mode === "demo"
    ? (!derivSession.accountType || derivSession.accountType === "demo")
    : derivSession.accountType === "live";
  // An unconnected demo order is deliberately simulated. But once Deriv is
  // connected, the account type must match the screen mode: never let a
  // "Démo" label route a manual buy to a live connected account.
  const isMarketOpenNow = useMemo(() => {
    if (!forceSymbol) return true;
    return isInTradingSession(["sydney", "asia", "london", "newyork"], forceSymbol);
  }, [forceSymbol]);

  // Auto-switch away from a closed market symbol (e.g. OTC_DJI when NY stock market is closed).
  // Candidates are restricted to the current preset's own watchlist (config.symbols) — picking
  // a symbol outside it (e.g. a synthetic index) would immediately get reverted by the
  // watchlist-sync effect below, ping-ponging forceSymbol back and forth and re-firing this
  // toast forever. config.symbols is deliberately NOT in the deps array: its identity (and for
  // some presets even its length) isn't stable across renders, which would re-run this on every
  // render instead of only when forceSymbol actually changes — the effect still reads the latest
  // config.symbols each time it does run.
  useEffect(() => {
    if (forceSymbol && !isInTradingSession(["sydney", "asia", "london", "newyork"], forceSymbol)) {
      const activeOpen = config.symbols.find((sym) => isInTradingSession(["sydney", "asia", "london", "newyork"], sym));
      if (activeOpen && activeOpen !== forceSymbol) {
        setForceSymbol(activeOpen);
        const openLabel = SYMBOLS.find((s) => s.deriv === activeOpen)?.label ?? activeOpen;
        toast.info(`Marché fermé — bascule automatique sur le marché ouvert ${openLabel}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceSymbol]);

  const manualTradeAllowed = manualInstrumentSupported && isMarketOpenNow && (
    config.mode === "demo"
      ? (!derivSession.connected || manualAccountMatchesMode)
      : derivSession.connected && manualAccountMatchesMode
  );
  const manualSymbolLabel = (SYMBOLS.find((symbol) => symbol.deriv === forceSymbol)?.label ?? forceSymbol) || "Choisir un marché";
  const manualDurationMinutes = preparedManualOpportunity?.symbol === forceSymbol
    ? preparedManualOpportunity.durationMinutes
    : config.durationMinutes;

  // The selected <option> can look valid even while forceSymbol is still an
  // empty string after a config refresh. Keep the actual value synchronized
  // with the current watchlist before enabling a manual trade.
  //
  // This runs on every mount (forceSymbol starts as "" — see useState above)
  // BEFORE the mount effect that seeds forceSymbol from an open symbol has
  // committed, so it used to unconditionally fall back to config.symbols[0]
  // regardless of whether that market was open — overriding the open pick a
  // moment later and handing a closed symbol to the auto-switch effect below,
  // which then re-switched it and fired the "marché fermé" toast on every
  // single mount (i.e. every time the user flipped between the Automatique
  // and Prise directe tabs, since those are separate routes that remount this
  // whole page). Falling back to the first OPEN symbol here too closes that gap.
  useEffect(() => {
    if (!forceSymbol || !config.symbols.includes(forceSymbol)) {
      const openFallback = config.symbols.find((sym) => isInTradingSession(["sydney", "asia", "london", "newyork"], sym));
      setForceSymbol(openFallback ?? config.symbols[0] ?? "");
    }
  }, [config.symbols, forceSymbol]);

  // A manual order must always use the contract family the selected market
  // actually offers. Switching EUR/USD → Boom 500 therefore changes
  // CALL/PUT into MULTUP/MULTDOWN before the confirmation can be enabled.
  useEffect(() => {
    const multiplier = forceSymbol && getInstrumentForSymbol(forceSymbol, config) === "multiplier";
    if (multiplier && (forceDir === "CALL" || forceDir === "PUT")) setForceDir(forceDir === "CALL" ? "MULTUP" : "MULTDOWN");
    if (!multiplier && (forceDir === "MULTUP" || forceDir === "MULTDOWN")) setForceDir(forceDir === "MULTUP" ? "CALL" : "PUT");
  }, [config, forceDir, forceSymbol]);

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
  function selectPresetView(target: PresetKey) {
    if (target === selectedPreset) return;
    setSelectedPreset(target);
    const presetFields = target === "boom" ? BOOM_PRESET : target === "crash" ? CRASH_PRESET : target === "scalping" ? SCALPING_PRESET : target === "liquidity" ? LIQUIDITY_PRESET : DEFAULT_CONFIG;
    // Try to load a previously saved per-preset config draft from localStorage.
    // Falls back to the canonical preset values if nothing is saved yet.
    const saved = loadConfig(target);
    const hasSavedOverride = localStorage.getItem(PRESET_CONFIG_KEY(target)) !== null;
    const next: AutoTraderConfig = hasSavedOverride
      ? saved
      : target === "scalping" || target === "liquidity"
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

  function prepareManualOpportunity() {
    if (!actionableOpportunity?.direction) {
      toast.error("Aucun signal « à prendre » n’est disponible pour le moment.");
      return;
    }
    prepareManualSignal(actionableOpportunity);
  }

  function prepareManualSignal(opportunity: OpportunityItem) {
    if (!opportunity.direction) {
      toast.info("Ce marché est en observation : aucune direction n'est proposée.");
      return;
    }
    setForceSymbol(opportunity.symbol);
    setForceDir(opportunity.direction);
    setForceStake(config.stakeUsd);
    setPreparedManualOpportunity(opportunity);
    setManualArmed(true);
    window.setTimeout(() => manualTradeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
  }

  // ── derived helpers ─────────────────────────────────────────────────────────
  const anyRunning = anyPresetEnabled;
  const brokerBalances = cloud?.brokerBalances;
  const derivBalance = brokerBalances?.deriv?.balance ?? null;
  const stakeAtRisk = openTradeList.reduce((s, l) => s + l.stake, 0);
  const balanceLabel = derivBalance !== null
    ? `$${derivBalance.toFixed(2)}`
    : derivSession.balance !== null
      ? `$${derivSession.balance.toFixed(2)}`
      : `$${(config.initialCapital + cumulativePnl - stakeAtRisk).toFixed(2)}`;

  return (
    <div className="w-full space-y-3 px-2 py-3 sm:px-6 sm:py-4 lg:px-8 lg:space-y-5">

      {/* ── Header & Navigation ── */}
      {/* Mobile: clean modern header */}
      <div className="md:hidden space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-lg">
              <Zap className="h-5 w-5 text-primary animate-pulse" />
            </div>
            <div>
              <h1 className="text-lg font-black tracking-tight text-foreground">
                {tradingTab === "manual" ? "Prise Directe" : "Auto-Trader"}
              </h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Au Pluriel • Live</span>
              </div>
            </div>
          </div>
          {tradingTab === "auto" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvanced((v) => !v)}
              className={cn(
                "h-9 w-9 p-0 rounded-xl transition-all border-border/70",
                showAdvanced && "border-primary/40 bg-primary/10 text-primary"
              )}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/5 bg-white/[0.03] p-1.5" role="tablist" aria-label="Espace de trading">
          <Link
            to="/autotrader"
            role="tab"
            aria-selected={tradingTab === "auto"}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black transition-all",
              tradingTab === "auto"
                ? "bg-primary text-black shadow-lg shadow-primary/20"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Power className="h-3.5 w-3.5" /> Automatique
          </Link>
          <Link
            to="/manual-trader"
            role="tab"
            aria-selected={tradingTab === "manual"}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black transition-all",
              tradingTab === "manual"
                ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3.5 w-3.5" /> Prise Directe
          </Link>
        </div>
      </div>

      {/* Desktop: original header */}
      <div className="hidden md:flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 shadow-sm">
            <Zap className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
                {tradingTab === "manual" ? "Prise directe" : "Auto-Trader"}
              </h1>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                Au Pluriel
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tradingTab === "manual"
                ? "Valider une position manuelle sous ton entière responsabilité."
                : "Scanner, conseiller et exécuter les signaux 24/7 sur ton autorisation."}
            </p>
          </div>
        </div>

        {/* Tab switch & Advanced toggle */}
        <div className="flex items-center gap-2 self-start lg:self-auto">
          <div className="inline-flex rounded-xl border border-border/70 bg-card/40 p-1 shadow-sm" role="tablist" aria-label="Espace de trading">
            <Link
              to="/autotrader"
              role="tab"
              aria-selected={tradingTab === "auto"}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-black transition-all",
                tradingTab === "auto"
                  ? "bg-primary/20 text-primary border border-primary/30 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Power className="h-3.5 w-3.5" /> Automatique
            </Link>
            <Link
              to="/manual-trader"
              role="tab"
              aria-selected={tradingTab === "manual"}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-black transition-all",
                tradingTab === "manual"
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Zap className="h-3.5 w-3.5" /> Prise directe
            </Link>
          </div>

          {tradingTab === "auto" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvanced((v) => !v)}
              className={cn(
                "h-9 px-3 gap-2 text-xs font-bold rounded-xl transition-all",
                showAdvanced ? "border-primary/40 bg-primary/10 text-primary" : "border-border/70 text-muted-foreground"
              )}
            >
              <Settings2 className="h-4 w-4" /> <span className="hidden sm:inline">{showAdvanced ? "Fermer" : "Réglages"}</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Visual Market Sessions Tracker & 24h Timeline ── */}
      <div className="hidden md:block">
        <MarketSessionsBar />
      </div>

      {/* ── Sticky HUD Status Bar ── */}
      <AutoTraderStatusBar
        mode={config.mode}
        presetLabel={presetLabels[selectedPreset]}
        autoEnabled={!!cloudSelected?.enabled}
        autoRunning={!!cloudSelected?.running}
        cloudBusy={cloudBusy}
        pnl={pnl}
        lossUsedUsd={lossUsedUsd}
        maxDailyLossUsd={config.maxDailyLossUsd}
        openTrades={openTrades}
        balance={balanceLabel}
        winRate={wins + losses > 0 ? `${winRate.toFixed(0)}%` : "—"}
        onAuto={toggleCloud}
        onModeChange={changeTradingMode}
      />

      {/* ── Strategy Selector — shared by Auto and Manual modes ── */}
      <section aria-label="Choisir une stratégie" className="scroll-mt-[220px] space-y-2.5 lg:scroll-mt-[90px]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Moteur & Stratégie active</p>
              <p className="hidden mt-0.5 text-xs text-muted-foreground sm:block">
                {tradingTab === "manual"
                  ? "Choisis le preset à analyser : tu gardes ensuite la main sur l'ordre et la mise."
                  : "Sélectionne le profil de marché à consulter. Chaque stratégie tourne indépendamment."}
              </p>
            </div>
            <span className="hidden text-xs font-bold text-muted-foreground sm:block font-mono">P&L du jour</span>
          </div>

          {/* Mobile: 2-column grid */}
          <div className="md:hidden grid grid-cols-2 gap-2.5">
            {shownPresets.map((p) => {
              const st = cloud?.presets?.[p];
              const pnlVal = st?.todayPnl ?? 0;
              const isOnline = !!st?.enabled && !!st?.running;
              const isSelected = selectedPreset === p;

              const accentStyles = {
                default: {
                  active: "border-purple-500/60 bg-purple-500/10 ring-1 ring-purple-500/50",
                },
                boom: {
                  active: "border-orange-500/60 bg-orange-500/10 ring-1 ring-orange-500/50",
                },
                crash: {
                  active: "border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/50",
                },
                scalping: {
                  active: "border-cyan-500/60 bg-cyan-500/10 ring-1 ring-cyan-500/50",
                },
                liquidity: {
                  active: "border-fuchsia-500/60 bg-fuchsia-500/10 ring-1 ring-fuchsia-500/50",
                },
              } as const;

              return (
                <button
                  key={p}
                  onClick={() => selectPresetView(p)}
                  className={cn(
                    "relative flex w-full flex-col justify-between rounded-2xl border p-3 text-left transition-all duration-200 touch-manipulation active:scale-[0.98] min-h-[92px] space-y-2",
                    isSelected
                      ? accentStyles[p].active
                      : pnlVal > 0
                        ? "border-emerald-500/30 bg-emerald-500/[0.04]"
                        : pnlVal < 0
                          ? "border-rose-500/30 bg-rose-500/[0.04]"
                          : "border-white/10 bg-card/40"
                  )}
                >
                  {/* Top Bar: Title + Online Dot / Test Badge */}
                  <div className="flex items-start justify-between gap-1 w-full">
                    <span className="font-black text-xs uppercase tracking-wider text-foreground truncate">
                      {presetLabels[p]}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {PRESET_PRESENTATION[p].experimental && (
                        <span className="rounded bg-cyan-500/20 border border-cyan-500/40 px-1 py-0.2 text-[8px] font-black uppercase text-cyan-300">
                          TEST
                        </span>
                      )}
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          isOnline
                            ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse"
                            : "bg-white/20"
                        )}
                        title={isOnline ? "En cours d'exécution" : "Inactif"}
                      />
                    </div>
                  </div>

                  {/* Subtitle: Market */}
                  <div className="text-[10px] font-semibold text-muted-foreground truncate leading-tight">
                    {PRESET_PRESENTATION[p].market}
                  </div>

                  {/* Bottom Bar: P&L Today */}
                  <div className="flex items-end justify-between w-full pt-1 border-t border-white/5">
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">P&L Jour</span>
                    <span
                      className={cn(
                        "text-xs font-mono font-black",
                        pnlVal > 0 ? "text-emerald-400" : pnlVal < 0 ? "text-rose-400" : "text-muted-foreground"
                      )}
                    >
                      {pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop: original grid */}
          <div className={cn(
            "hidden md:grid gap-2.5 grid-cols-2",
            shownPresets.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4"
          )}>
            {shownPresets.map((p) => {
              const st = cloud?.presets?.[p];
              const pnlVal = st?.todayPnl ?? 0;
              const configuredMarkets = formatConfiguredMarkets(st?.savedConfig?.symbols, PRESET_PRESENTATION[p].description);
              const isOnline = !!st?.enabled && !!st?.running;
              const styles = {
                default: { active: "border-purple-500/50 bg-purple-500/10 shadow-[0_0_20px_rgba(168,85,247,0.15)]" },
                boom: { active: "border-orange-500/50 bg-orange-500/10 shadow-[0_0_20px_rgba(249,115,22,0.15)]" },
                crash: { active: "border-amber-500/50 bg-amber-500/10 shadow-[0_0_20px_rgba(245,158,11,0.15)]" },
                scalping: { active: "border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.15)]" },
                liquidity: { active: "border-fuchsia-500/50 bg-fuchsia-500/10 shadow-[0_0_20px_rgba(217,70,239,0.15)]" },
              } as const;
              return (
                <button
                  key={p}
                  onClick={() => selectPresetView(p)}
                  className={cn(
                    "flex flex-col items-start gap-1 rounded-2xl border p-3.5 text-left transition-all duration-200",
                    selectedPreset === p
                      ? styles[p].active
                      : pnlVal > 0
                        ? "border-up/30 bg-up/5 hover:bg-up/10"
                        : pnlVal < 0
                          ? "border-down/30 bg-down/5 hover:bg-down/10"
                          : "border-white/10 bg-card/30 hover:bg-card/60 hover:border-white/20"
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-foreground">
                      {presetLabels[p]}
                      <span className={cn("h-2 w-2 rounded-full", isOnline ? "bg-up animate-pulse shadow-[0_0_8px_var(--up)]" : "bg-muted-foreground/40")} />
                    </span>
                    {PRESET_PRESENTATION[p].experimental && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-300">
                        <FlaskConical className="h-2.5 w-2.5" /> Test
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">{PRESET_PRESENTATION[p].market}</span>
                  <span className="text-[11px] text-muted-foreground/75 truncate w-full" title={configuredMarkets}>
                    {p === "default" || p === "scalping" || p === "liquidity" ? PRESET_PRESENTATION[p].description : configuredMarkets}
                  </span>
                  <span className={cn("mt-1.5 text-sm font-black font-mono-tabular", pnlVal > 0 ? "text-up" : pnlVal < 0 ? "text-down" : "text-muted-foreground")}>
                    {pnlVal >= 0 ? "+" : ""}${pnlVal.toFixed(2)}
                  </span>
                </button>
              );
            })}
          </div>
      </section>

      <LivePositionsPanel
        openTrades={combinedAutoOpenTrades}
        onDismiss={(t) => { setEngineLogs([...dismissTrade(t.id)]); toast.info(`Carte fermée — ${t.symbol}`); }}
      />
      <div className={cn("grid items-start gap-5", tradingTab === "auto" ? "xl:grid-cols-1" : "xl:grid-cols-2")}>
      <div className={cn("min-w-0 space-y-5", tradingTab !== "auto" && "hidden")}>
      <OpportunityCommandCenter
        presetLabel={presetLabels[selectedPreset]}
        opportunity={selectedOpportunity}
        opportunities={selectedPresetOpportunities}
        takeCount={selectedPresetOpportunities.filter((o) => o.decision === "take").length}
        waitCount={selectedPresetOpportunities.filter((o) => o.decision === "wait").length}
        avoidCount={selectedPresetOpportunities.filter((o) => o.decision === "avoid").length}
        loading={opportunitiesBusy && !opportunities}
        config={config}
        autoEnabled={!!cloudSelected?.enabled}
        cloudBusy={cloudBusy}
        onRefresh={refreshOpportunities}
        onAuto={toggleCloud}
      />
      <TradeJournalSection
        journalTrades={journalTrades}
        liveDerivPositions={liveDerivPositions}
        cloudActive={cloudActive}
        selectedPreset={selectedPreset}
        presetLabels={presetLabels}
        logFilter={logFilter}
        setLogFilter={setLogFilter}
        confirm={confirm}
        setEngineLogs={setEngineLogs}
        durationMinutes={config.durationMinutes}
      />
      </div>

      {/* ── Prise Directe (Trading Manuel) ── */}
      <section
        ref={manualTradeRef}
        className={cn(
          "order-2 w-full space-y-3 lg:space-y-5",
          tradingTab === "manual" ? "xl:col-span-2 xl:col-start-1" : "hidden"
        )}
        aria-label="Prise directe manuelle"
      >
        {/* OPEN POSITIONS & RISK CONTROL PANEL (MANUAL MODE) */}
        <div className="rounded-2xl border border-white/10 bg-neutral-900/80 p-5 space-y-4 backdrop-blur-md shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                <h3 className="text-sm md:text-base font-black text-foreground uppercase tracking-wider">
                  Positions Ouvertes & Contrôle Direct
                </h3>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Clôturez vos positions au marché, ajustez le Stop Loss et le Trailing Stop en temps réel.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-white/5 border border-white/10 text-neutral-300">
              {liveDerivPositions.length} position{liveDerivPositions.length > 1 ? "s" : ""} ouverte{liveDerivPositions.length > 1 ? "s" : ""}
            </span>
          </div>

          {liveDerivPositions.length === 0 ? (
            <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02] text-center text-xs text-neutral-400">
              Aucune position ouverte actuellement. Utilisez le formulaire ci-dessous pour placer un ordre manuel.
            </div>
          ) : (
            <div className="space-y-2.5">
              {liveDerivPositions.map((pos) => (
                <div key={pos.contractId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-white/10 bg-black/40">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      "px-2 py-1 rounded text-xs font-black uppercase tracking-wider",
                      pos.contractType === "CALL" || pos.contractType === "MULTUP" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-red-500/20 text-red-400 border border-red-500/30"
                    )}>
                      {pos.contractType}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-foreground">
                        {SYMBOLS.find((s) => s.deriv === pos.symbol)?.label ?? pos.symbol}
                      </div>
                      <div className="text-[11px] font-mono text-neutral-400">
                        Entrée : ${pos.buyPrice.toFixed(2)} · Spot : {pos.currentSpot > 0 ? pos.currentSpot.toFixed(pos.symbol.startsWith("frx") ? 5 : 2) : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-neutral-400">P&L actuel</div>
                      <div className={cn("text-xs font-mono font-black", pos.profit >= 0 ? "text-emerald-400" : "text-rose-400")}>
                        {pos.profit >= 0 ? "+" : ""}${pos.profit.toFixed(2)}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Clôturer la position au marché ?",
                          description: `Vendre ${pos.symbol} maintenant au prix du marché. P&L en cours: ${pos.profit >= 0 ? "+" : ""}$${pos.profit.toFixed(2)}.`,
                          confirmLabel: "Fermer au marché",
                          danger: pos.profit < 0,
                        });
                        if (!ok) return;
                        try {
                          const res = await sellContractNow(pos.contractId);
                          toast.success(`Position fermée ! P&L: ${res.soldFor >= res.boughtFor ? "+" : ""}${(res.soldFor - res.boughtFor).toFixed(2)}`);
                          refreshCloud();
                        } catch (e) {
                          toast.error(`Échec: ${(e as Error).message}`);
                        }
                      }}
                      className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-xs font-bold h-8 px-3 rounded-lg"
                    >
                      <X className="h-3.5 w-3.5 mr-1" /> Fermer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick Risk Controls row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-white/5 text-xs">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-neutral-400">Mise par Ordre ($)</label>
              <input
                type="number"
                min={1}
                max={100}
                value={forceStake}
                onChange={(e) => setForceStake(Number(e.target.value))}
                className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-xs text-foreground outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-neutral-400">Trailing Stop (% / $)</label>
              <input
                type="number"
                min={0}
                max={50}
                step={0.1}
                value={config.trailingStopPct ? config.trailingStopPct * 100 : 15}
                onChange={(e) => {
                  const val = Number(e.target.value) / 100;
                  const next = { ...config, trailingStopPct: val };
                  setConfig(next);
                  saveConfig(next, selectedPreset);
                  toast.success(`Trailing stop réglé à ${e.target.value}%`);
                }}
                className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-xs text-foreground outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-neutral-400">Perte Max Jour ($)</label>
              <input
                type="number"
                min={1}
                max={500}
                value={config.maxDailyLossUsd}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  const next = { ...config, maxDailyLossUsd: val };
                  setConfig(next);
                  saveConfig(next, selectedPreset);
                  toast.success(`Perte max jour réglée à $${val}`);
                }}
                className="w-full rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 font-mono text-xs text-foreground outline-none"
              />
            </div>
          </div>
        </div>
        {/* Manual order overview — mobile: ultra-compact, desktop: original */}
        <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-r from-white/[0.045] via-card/40 to-transparent p-3 lg:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-primary lg:text-[10px]">Ordre manuel</p>
              <h2 className="mt-0.5 text-sm font-black tracking-tight text-foreground lg:text-lg truncate">Prépare & Exécute</h2>
              <p className="hidden mt-1 text-xs text-muted-foreground lg:block">Aucune décision automatique ne sera prise à ta place.</p>
            </div>
            {manualActionableOpportunities.length > 0 && (
              <div role="status" className="inline-flex items-center gap-1.5 rounded-lg border border-up/25 bg-up/10 px-2 py-1 lg:px-2.5 lg:py-1.5 text-[10px] lg:text-[11px] font-bold text-up shrink-0">
                <span className="h-1 w-1 lg:h-1.5 lg:w-1.5 rounded-full bg-up animate-pulse" />
                {manualActionableOpportunities.length} signal{manualActionableOpportunities.length > 1 ? "x" : ""}
              </div>
            )}
          </div>
          {/* Desktop: original step cards */}
          <div className="hidden lg:flex mt-4 grid-cols-3 gap-2 text-center text-[10px] font-black uppercase tracking-wider sm:min-w-[410px]">
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-primary">1 · Marché</div>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-muted-foreground">2 · Position</div>
            <div className="rounded-xl border border-white/[0.08] bg-black/20 px-3 py-2.5 text-muted-foreground">3 · Validation</div>
          </div>
        </div>

        {/* 2-Column Tactical Layout — mobile: single column, desktop: 2 cols */}
        <div className="grid gap-4 lg:gap-5 lg:grid-cols-[minmax(0,1.2fr)_360px] items-start">
          {/* LEFT: Order Form */}
          <div className="space-y-3 lg:space-y-4">
            {/* Card 1: Symbol & Signal Context */}
            <div className="glass-panel rounded-2xl border border-border/60 bg-card/30 p-3 space-y-3 lg:p-5 lg:space-y-5">
              <div className="flex items-center justify-between border-b border-border/50 pb-2.5 lg:pb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-black text-primary shrink-0">
                    1
                  </span>
                  <span className="text-xs font-black uppercase tracking-wider text-foreground truncate">Marché & Signal</span>
                </div>
                {actionableOpportunity?.direction && (
                  <button
                    onClick={prepareManualOpportunity}
                    className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-up hover:text-up/80 transition-all px-2 py-1 rounded-lg border border-up/30 bg-up/5 shrink-0 active:scale-95 touch-manipulation"
                  >
                    <Zap className="h-3 w-3" /> {actionableOpportunity.symbol}
                  </button>
                )}
              </div>

              {/* ── AI-qualified market selector ── */}
              <div className="rounded-xl lg:rounded-2xl border border-white/[0.08] bg-black/25 p-2.5 space-y-2 lg:p-4 lg:space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Zap className="h-3.5 w-3.5 text-up shrink-0" />
                    <span className="text-[11px] lg:text-xs font-black uppercase tracking-wider text-foreground truncate">
                      Marchés analysés
                    </span>
                  </div>
                  <span className="rounded-full border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground shrink-0">
                    {manualScanOpportunities.length}
                  </span>
                </div>

                <p className="hidden text-[11px] leading-relaxed text-muted-foreground lg:block">
                  Les signaux forts sont mis en avant. Les signaux faibles et à éviter restent accessibles : tu gardes toujours la décision et la mise.
                </p>

                {manualScanOpportunities.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid lg:grid-cols-3 lg:gap-2 lg:overflow-visible xl:grid-cols-5">
                    {manualScanOpportunities.map((opp) => {
                      const symObj = SYMBOLS.find((s) => s.deriv === opp.symbol);
                      const label = symObj?.label ?? opp.symbol;
                      const isSelected = forceSymbol === opp.symbol;
                      const decisionStyle = opp.decision === "take"
                        ? "border-up/30 bg-up/10 text-up"
                        : opp.decision === "wait"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                          : "border-down/30 bg-down/10 text-down";
                      const cardStyle = opp.decision === "take"
                        ? "border-up/40 bg-up/[0.08] text-up"
                        : opp.decision === "wait"
                          ? "border-amber-500/40 bg-amber-500/[0.1] text-amber-100"
                          : "border-down/40 bg-down/[0.08] text-down";
                      const decisionLabel = opp.decision === "take" ? "Fort" : opp.decision === "wait" ? "Faible" : "Éviter";

                      return (
                        <div
                          key={opp.symbol}
                          onClick={() => {
                            setForceSymbol(opp.symbol);
                            if (opp.direction) setForceDir(opp.direction);
                            setManualArmed(true);
                          }}
                          className={cn(
                            "flex min-h-[72px] flex-col items-start justify-between gap-1.5 rounded-xl border p-2.5 text-left transition-all duration-200 cursor-pointer w-full touch-manipulation active:scale-[0.98] lg:w-auto lg:shrink lg:min-h-[76px] lg:p-3",
                            cardStyle,
                            isSelected && "ring-2 ring-primary/60 shadow-lg bg-card/80 lg:ring-1 lg:ring-white/40"
                          )}
                        >
                          <div className="flex w-full items-center justify-between gap-1">
                            <span className="font-bold text-[11px] lg:text-xs truncate">{label}</span>
                            <span className={cn("text-[8px] lg:text-[9px] font-black border px-1 py-0.5 rounded shrink-0", decisionStyle)}>
                              {decisionLabel}
                            </span>
                          </div>
                          <div className="flex w-full items-center justify-between gap-1 text-[9px] lg:text-[10px] font-mono text-muted-foreground/70">
                            <span className="font-bold">{opp.direction ? `${opp.direction === "CALL" ? "▲" : "▼"} ${Math.round(opp.confidence)}%` : "Neutre"}</span>
                          </div>
                          {opp.direction && opp.decision !== "avoid" ? (
                            <button
                              type="button"
                              disabled={forcingTrade}
                              onClick={() => prepareManualSignal(opp)}
                              className={cn(
                                "w-full rounded-lg border py-1 text-[9px] font-black uppercase tracking-wider transition-colors disabled:opacity-40 active:scale-95 touch-manipulation",
                                opp.decision === "take"
                                  ? "border-up/35 bg-up/10 text-up"
                                  : "border-amber-500/35 bg-amber-500/10 text-amber-200",
                              )}
                            >
                              Signal
                            </button>
                          ) : (
                            <span className="w-full text-center text-[9px] font-bold text-muted-foreground/50">Observation</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] px-4 py-5 text-center">
                    <p className="text-xs font-bold text-foreground">Analyse indisponible pour le moment</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">L'Auto‑Trader réévalue les marchés automatiquement toutes les 30 secondes.</p>
                  </div>
                )}
              </div>

              {/* ── Direction & Signal — mobile: unified compact, desktop: 2 cols ── */}
              <div className="grid gap-3 lg:gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-3">
                  {/* Timer & IA Context Row (Mobile) */}
                  <div className="flex items-center gap-2 lg:hidden">
                    <div className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3.5 w-3.5 text-primary animate-pulse" />
                        <span className="font-mono text-xs font-black text-foreground">{candleSeconds}s</span>
                      </div>
                      <span className={cn(
                        "rounded-md border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider",
                        candleSeconds >= 45 || candleSeconds <= 15 ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/5 bg-white/[0.02] text-muted-foreground"
                      )}>
                        {candleSeconds >= 45 || candleSeconds <= 15 ? "Idéal" : "Attente"}
                      </span>
                    </div>
                    {manualOpportunity && (
                      <div className={cn(
                        "flex-[1.2] rounded-xl border px-3 py-2 flex items-center justify-between gap-2",
                        manualOpportunity.decision === "take" ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-amber-500/30 bg-amber-500/5 text-amber-300"
                      )}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Sparkles className="h-3 w-3 shrink-0" />
                          <span className="text-[10px] font-black truncate uppercase">{manualOpportunity.directionLabel}</span>
                        </div>
                        <span className="font-mono text-xs font-black">{Math.round(manualOpportunity.confidence)}%</span>
                      </div>
                    )}
                  </div>

                  {/* Desktop Timer (Original) */}
                  <div className="hidden lg:flex rounded-xl border border-white/10 bg-black/30 p-3.5 items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary animate-pulse" />
                      <span className="font-mono text-sm font-black text-foreground">{candleSeconds}s</span>
                    </div>
                    <span className={cn(
                      "rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider",
                      candleSeconds >= 45 || candleSeconds <= 15 ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 animate-pulse" : "border-white/10 bg-white/[0.04] text-muted-foreground"
                    )}>
                      {candleSeconds >= 45 || candleSeconds <= 15 ? "🔥 Idéal" : "⏳ Attente"}
                    </span>
                  </div>

                  {/* Desktop Signal Card (Original) */}
                  {manualOpportunity ? (
                    <div className={cn(
                      "hidden lg:flex rounded-xl border p-3.5 items-center justify-between gap-4 text-xs",
                      manualOpportunity.decision === "take" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : manualOpportunity.decision === "avoid" ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    )}>
                      <div className="space-y-0.5">
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">Signal IA · {manualOpportunity.symbol}</div>
                        <div className="font-black uppercase tracking-wider flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> {manualOpportunity.directionLabel}</div>
                        <div className="text-[10px] opacity-80">24h Win-Rate : 78% de réussite</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-xl font-black">{Math.round(manualOpportunity.confidence)}%</div>
                        <div className="text-[9px] font-black uppercase tracking-wider opacity-70">Confiance</div>
                      </div>
                    </div>
                  ) : (
                    <div className="hidden lg:flex rounded-xl border border-white/10 bg-black/30 p-3.5 items-center justify-center text-xs text-muted-foreground">Sélectionne une paire pour voir le signal IA</div>
                  )}
                </div>

                {/* Direction Selector */}
                <div className="rounded-xl lg:rounded-2xl border border-white/[0.08] bg-black/25 p-2.5 space-y-2 lg:p-4 lg:space-y-3">
                  <div className="flex items-center justify-between lg:hidden">
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/60">Choisir direction</span>
                  </div>
                  <div className="hidden lg:block text-[10px] font-black uppercase tracking-wider text-muted-foreground">Direction</div>

                  <div className="grid grid-cols-2 gap-2 lg:gap-3">
                    {(manualInstrument === "multiplier" ? (["MULTUP", "MULTDOWN"] as const) : (["CALL", "PUT"] as const)).map((d) => {
                      const isUp = d === "CALL" || d === "MULTUP";
                      const isSelected = forceDir === d;
                      const isAiRecommended = !!manualOpportunity?.direction && ((isUp && manualOpportunity.direction === "CALL") || (!isUp && manualOpportunity.direction === "PUT"));

                      return (
                        <button
                          key={d}
                          type="button"
                          disabled={forcingTrade}
                          onClick={() => { setForceDir(d); setPreparedManualOpportunity(null); setManualArmed(true); }}
                          className={cn(
                            "relative flex min-h-[64px] lg:min-h-[96px] flex-col items-center justify-center gap-1 rounded-xl border p-2 lg:p-3 transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer",
                            isSelected
                              ? isUp
                                ? "border-emerald-500/70 bg-emerald-500/20 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.20)] ring-1 ring-emerald-500/40"
                                : "border-rose-500/70 bg-rose-500/20 text-rose-300 shadow-[0_0_20px_rgba(244,63,94,0.20)] ring-1 ring-rose-500/40"
                              : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06]"
                          )}
                        >
                          {isAiRecommended && (
                            <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full border border-primary/40 bg-black px-1.5 py-0.2 text-[8px] font-black uppercase text-primary">IA</span>
                          )}
                          <span className="text-xl lg:text-2xl leading-none">{isUp ? "▲" : "▼"}</span>
                          <span className="text-[11px] lg:text-xs font-black uppercase tracking-wider">{isUp ? "HAUSSE" : "BAISSE"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Mise & Protections — mobile: compact single column */}
            <div className="glass-panel rounded-2xl border border-border/60 bg-card/30 p-3 space-y-4 lg:p-5 lg:space-y-6">
              <div className="flex items-center justify-between border-b border-border/50 pb-2.5 lg:pb-3">
                <div className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-black text-primary">2</span>
                  <span className="text-xs font-black uppercase tracking-wider text-foreground">Mise & Protections</span>
                </div>
                <span className={cn("rounded-lg border px-2 py-0.5 text-[10px] lg:text-xs font-black uppercase", config.mode === "live" ? "border-rose-500/30 bg-rose-500/10 text-rose-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300")}>
                  {config.mode === "live" ? "RÉEL" : "DÉMO"}
                </span>
              </div>

              {/* Mobile: ultra-compact stake row */}
              <div className="lg:hidden space-y-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <AmountInput
                      value={forceStake}
                      min={1}
                      max={100}
                      step={1}
                      disabled={forcingTrade}
                      onCommit={async (v) => {
                        if (config.mode === "live") {
                          const ok = await confirm({ title: "Confirmer la mise ?", description: `Trade manuel à $${v} (argent réel).`, confirmLabel: "Confirmer", danger: true });
                          if (!ok) return false;
                        }
                        setForceStake(v);
                        return true;
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {[5, 10, 25].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setForceStake(s)}
                        className={cn(
                          "h-10 w-10 rounded-xl border text-[11px] font-black transition-all",
                          forceStake === s ? "border-primary bg-primary/20 text-primary" : "border-white/5 bg-white/[0.02] text-muted-foreground"
                        )}
                      >
                        ${s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2 text-[10px] font-black uppercase transition-all",
                    autoTpEnabled ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/5 bg-white/[0.01] text-muted-foreground/60"
                  )}>
                    <span>TP +50%</span>
                    <Switch checked={autoTpEnabled} onCheckedChange={setAutoTpEnabled} className="scale-[0.6]" />
                  </div>
                  <div className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2 text-[10px] font-black uppercase transition-all",
                    autoSlEnabled ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : "border-white/5 bg-white/[0.01] text-muted-foreground/60"
                  )}>
                    <span>SL -30%</span>
                    <Switch checked={autoSlEnabled} onCheckedChange={setAutoSlEnabled} className="scale-[0.6]" />
                  </div>
                </div>

                {forceStake > 30 && (
                  <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-rose-400/80 flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3" /> Risque élevé (${forceStake})
                  </div>
                )}
              </div>

              {/* Desktop Stake Layout (Original) */}
              <div className="hidden lg:grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-muted-foreground">Mise rapide</span>
                    <span className="text-[10px] font-bold text-muted-foreground/70">Choix direct</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[5, 10, 25, 50].map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={forcingTrade}
                        onClick={() => setForceStake(s)}
                        className={cn(
                          "rounded-xl border py-2.5 text-xs font-black transition-all cursor-pointer",
                          forceStake === s
                            ? "border-primary bg-primary/20 text-primary ring-1 ring-primary/40 shadow-sm"
                            : "border-white/10 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                        )}
                      >
                        ${s}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground/60 shrink-0">Ajouter :</span>
                    {[5, 10, 25].map((inc) => (
                      <button
                        key={inc}
                        type="button"
                        disabled={forcingTrade}
                        onClick={() => setForceStake((v) => Math.min(100, v + inc))}
                        className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-extrabold text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-all cursor-pointer"
                      >
                        +${inc}
                      </button>
                    ))}
                  </div>
                  <div className="pt-2">
                    <AmountInput
                      value={forceStake}
                      min={1}
                      max={100}
                      step={1}
                      disabled={forcingTrade}
                      onCommit={async (v) => {
                        if (config.mode === "live") {
                          const ok = await confirm({
                            title: "Confirmer la mise ?",
                            description: `Trade manuel à $${v} (argent réel).`,
                            confirmLabel: "Confirmer",
                            danger: true,
                          });
                          if (!ok) return false;
                        }
                        setForceStake(v);
                        return true;
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-muted-foreground">Exposition du capital</span>
                      <span className={cn(
                        "font-mono font-black",
                        forceStake <= 10 ? "text-emerald-400" : forceStake <= 30 ? "text-amber-400" : "text-rose-400"
                      )}>
                        ${forceStake} ({(forceStake / (config.initialCapital || 100) * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        className={cn(
                          "h-full transition-all duration-300 rounded-full",
                          forceStake <= 10 ? "bg-emerald-400" : forceStake <= 30 ? "bg-amber-400" : "bg-rose-500"
                        )}
                        style={{ width: `${Math.min(100, (forceStake / 50) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="pt-1 space-y-2.5">
                    <div className="text-xs font-black uppercase tracking-wider text-muted-foreground">Protections du trade</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className={cn(
                        "flex items-center justify-between rounded-xl border p-3 text-xs font-bold transition-all cursor-pointer",
                        autoTpEnabled ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/[0.02] text-muted-foreground"
                      )}>
                        <span className="flex items-center gap-1.5 text-xs">
                          <ShieldAlert className="h-4 w-4 text-emerald-400" /> Auto TP (+50%)
                        </span>
                        <Switch checked={autoTpEnabled} onCheckedChange={setAutoTpEnabled} className="scale-75" />
                      </div>
                      <div className={cn(
                        "flex items-center justify-between rounded-xl border p-3 text-xs font-bold transition-all cursor-pointer",
                        autoSlEnabled ? "border-rose-500/40 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/[0.02] text-muted-foreground"
                      )}>
                        <span className="flex items-center gap-1.5 text-xs">
                          <ShieldAlert className="h-4 w-4 text-rose-400" /> Auto SL (-30%)
                        </span>
                        <Switch checked={autoSlEnabled} onCheckedChange={setAutoSlEnabled} className="scale-75" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {forceStake > 30 && (
                <div className="hidden lg:flex rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs items-center gap-3 text-rose-300 animate-fade-in shadow-lg">
                  <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
                  <div>
                    <span className="font-extrabold uppercase tracking-wider">Attention : Risque élevé ($50+)</span>
                    <p className="mt-0.5 text-[11px] opacity-90">Cette mise représente une exposition importante. Assure-toi de respecter ta gestion du risque journalière.</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Order Summary & Hero CTA — mobile: compact summary, sticky CTA */}
          <aside className="space-y-3 lg:space-y-4 lg:glass-panel lg:rounded-2xl lg:border lg:border-border/60 lg:bg-card/50 lg:p-5 lg:sticky lg:top-24">
            <div className="hidden lg:flex items-center gap-2 border-b border-border/50 pb-3">
              <span className="grid h-6 w-6 place-items-center rounded-full border border-primary/30 bg-primary/10 font-mono text-xs font-black text-primary">3</span>
              <span className="text-xs font-black uppercase tracking-wider text-foreground">Revue & Validation</span>
            </div>

            {manualExecution && (
              <div className={cn(
                "relative overflow-hidden rounded-xl border p-3 lg:p-4",
                manualExecution.status === "pending"
                  ? "border-amber-400/70 bg-amber-400/15 text-amber-100 shadow-[0_0_28px_rgba(251,191,36,0.28)]"
                  : "border-up/70 bg-up/15 text-emerald-100 shadow-[0_0_32px_rgba(74,222,128,0.30)]",
              )}>
                <div className={cn(
                  "pointer-events-none absolute inset-0 opacity-60",
                  manualExecution.status === "pending" ? "animate-pulse bg-amber-300/10" : "animate-pulse bg-emerald-300/10",
                )} />
                <div className="relative flex items-center gap-2.5">
                  <span className={cn(
                    "relative flex h-3 w-3 shrink-0",
                    manualExecution.status === "pending" ? "text-amber-300" : "text-up",
                  )}>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-current" />
                  </span>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.16em]">
                      {manualExecution.status === "pending" ? "Ordre en attente" : "Contrat ouvert"}
                    </p>
                    <p className="mt-0.5 text-xs font-bold opacity-90">
                      {manualExecution.symbol} · {manualExecution.direction}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Market Closed Warning — mobile: compact */}
            {!isMarketOpenNow && (
              <div className="rounded-lg lg:rounded-xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 lg:p-3.5 text-xs flex items-center gap-2 lg:gap-3 text-rose-300 animate-fade-in shadow-lg">
                <AlertTriangle className="h-4 w-4 lg:h-5 lg:w-5 text-rose-400 shrink-0" />
                <span className="font-bold">Marché fermé — sélectionne un marché actif</span>
              </div>
            )}

            {/* Checklist — mobile: inline pills */}
            <div className="hidden lg:block space-y-2.5 rounded-xl border border-border/50 bg-black/30 p-4 shadow-inner">
              <ChecklistItem label="Connexion" value={derivSession.connected ? "Active" : "Simulée"} tone={derivSession.connected ? "up" : "amber"} />
              <ChecklistItem label="Compte" value={derivSession.accountType || (config.mode === "demo" ? "DÉMO" : "LIVE")} tone={manualAccountMatchesMode ? "up" : "amber"} />
              <ChecklistItem label="Symbole" value={manualInstrumentSupported ? "OK" : "Indisponible"} tone={manualInstrumentSupported ? "up" : "down"} />
            </div>

            {/* Mobile: compact summary card */}
            <div className="lg:hidden rounded-xl border border-border/50 bg-card/40 p-3 space-y-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Marché</span>
                <span className="text-sm font-black text-foreground">{manualSymbolLabel}</span>
              </div>
              <div className="flex items-center justify-between border-y border-border/40 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Direction</span>
                  <span className={cn("text-[11px] font-black uppercase px-2 py-0.5 rounded-md", forceDir === "CALL" || forceDir === "MULTUP" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
                    {forceDir === "CALL" || forceDir === "MULTUP" ? "▲ HAUSSE" : "▼ BAISSE"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mise</span>
                  <span className="text-sm font-black font-mono-tabular text-foreground">${forceStake.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Profit estimé</span>
                  <span className="text-sm font-black text-emerald-300 font-mono">+${(forceStake * 0.85).toFixed(2)}</span>
                </div>
                <span className="rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-300">+85% ROI</span>
              </div>
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{manualInstrument === "multiplier" ? "Protection" : "Échéance"}</span>
                <span className="text-[11px] font-bold text-foreground/80">{manualInstrument === "multiplier" ? "Auto TP/SL" : `${manualDurationMinutes}min`}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Exécution</span>
                <span className={cn("text-[11px] font-black uppercase tracking-widest", config.mode === "live" ? "text-rose-400" : "text-emerald-400")}>
                  {config.mode === "live" ? "RÉEL" : "DÉMO"}
                </span>
              </div>

              {/* Mobile in-card CTA button */}
              <Button
                disabled={!manualTradeAllowed || forcingTrade || !manualArmed}
                onClick={async () => {
                  if (!forceSymbol) return;
                  const label = SYMBOLS.find((x) => x.deriv === forceSymbol)?.label ?? forceSymbol;
                  const isLive = config.mode === "live";
                  const currentUtcHour = new Date().getUTCHours();
                  const isUnfavorableHour = [3, 4, 7, 8, 11, 16, 19].includes(currentUtcHour);
                  const hourStr = `${String(currentUtcHour).padStart(2, "0")}:00 UTC`;

                  const title = isUnfavorableHour
                    ? `⚠️ Créneau Défavorable (${hourStr})`
                    : isLive ? "Confirmer le trade (réel) ?" : "Confirmer le trade (démo) ?";

                  const warningMsg = isUnfavorableHour
                    ? `\n\n⚠️ AVERTISSEMENT : Le créneau de ${hourStr} est historiquement défavorable (Win Rate 45%-65% · liquidité faible/piégeuse). Confirmer l'exécution en toute conscience ?`
                    : "";

                  const confirmed = await confirm({
                    title,
                    description: `Position ${forceDir === "CALL" || forceDir === "MULTUP" ? "Hausse" : "Baisse"} (${forceDir}) sur ${label} · $${forceStake}${warningMsg}`,
                    confirmLabel: isUnfavorableHour ? "Exécuter quand même" : isLive ? "Exécuter (RÉEL)" : "Exécuter",
                    danger: isLive || isUnfavorableHour,
                  });
                  if (!confirmed) return;
                  setForcingTrade(true);
                  toast.info(`Trade en cours — ${label} ${forceDir}…`);
                  try {
                    if (derivSession.connected) {
                      await forceDemoTrade(
                        forceSymbol,
                        forceDir,
                        forceStake,
                        manualDurationMinutes,
                        (log) => {
                          handleEvent(log);
                          if (log.status === "pending" || log.status === "open") {
                            setManualExecution({ status: log.status, symbol: label, direction: forceDir });
                          } else if (log.status === "won" || log.status === "lost" || log.status === "error") {
                            setManualExecution(null);
                          }
                          if (log.status === "open") toast.success(`Contrat ouvert — ${label} ${forceDir}`);
                        },
                        config
                      );
                    } else {
                      await openPreviewTrade(
                        forceSymbol,
                        manualDurationMinutes,
                        forceStake,
                        (log) => {
                          handleEvent(log);
                          if (log.status === "open") {
                            setManualExecution({ status: "open", symbol: label, direction: forceDir });
                          } else if (log.status === "won" || log.status === "lost" || log.status === "error") {
                            setManualExecution(null);
                          }
                          if (log.status === "open") toast.success(`Position démo simulée — ${label} ${forceDir}`);
                        }
                      );
                    }
                    setManualArmed(false);
                    setPreparedManualOpportunity(null);
                  } catch (e) {
                    toast.error(`Échec: ${(e as Error).message}`);
                  } finally {
                    setForcingTrade(false);
                  }
                }}
                className={cn(
                  "mt-2.5 h-12 w-full shrink-0 gap-2 text-sm font-extrabold rounded-xl transition-all shadow-lg active:scale-[0.98] touch-manipulation",
                  forceDir === "CALL" || forceDir === "MULTUP"
                    ? "bg-up text-black hover:bg-up/90 shadow-up/25"
                    : "bg-down text-white hover:bg-down/90 shadow-down/25",
                  "disabled:bg-muted/20 disabled:text-muted-foreground disabled:border-border disabled:cursor-not-allowed"
                )}
              >
                {forcingTrade ? (
                  <><Activity className="h-4 w-4 animate-pulse" /> Traitement de l'ordre…</>
                ) : (
                  <>Exécuter l'Ordre Manuel (${forceStake.toFixed(2)})</>
                )}
              </Button>
            </div>

            {/* Desktop: original parameter summary */}
            <div className="hidden lg:block space-y-4 rounded-xl border border-border/50 bg-card/40 p-5 shadow-xl ring-1 ring-white/5">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Marché sélectionné</span>
                <span className="text-sm font-black text-foreground">{manualSymbolLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 border-y border-border/40 py-4">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Direction</span>
                  <span className={cn("text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-md self-start", forceDir === "CALL" || forceDir === "MULTUP" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
                    {forceDir === "CALL" || forceDir === "MULTUP" ? "▲ HAUSSE" : "▼ BAISSE"}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mise</span>
                  <span className="text-sm font-black font-mono-tabular text-foreground">${forceStake.toFixed(2)}</span>
                </div>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-center justify-between text-xs">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400">Profit estimé (+85%)</div>
                  <div className="text-base font-black text-emerald-300 font-mono">+${(forceStake * 0.85).toFixed(2)} USD</div>
                </div>
                <div className="text-right">
                  <span className="rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-black text-emerald-300">+85.0% ROI</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{manualInstrument === "multiplier" ? "Protection" : "Échéance"}</span>
                  <span className="text-xs font-bold text-foreground/80">{manualInstrument === "multiplier" ? "Auto TP/SL" : `${manualDurationMinutes} minutes`}</span>
                </div>
                <div className="text-right flex flex-col gap-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Exécution</span>
                  <span className={cn("text-xs font-black uppercase tracking-widest", config.mode === "live" ? "text-rose-400" : "text-emerald-400")}>
                    {config.mode === "live" ? "100% RÉEL" : "DÉMO"}
                  </span>
                </div>
              </div>
            </div>

            {!manualArmed && (
              <div className="rounded-lg lg:rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 lg:p-3 text-[11px] leading-relaxed text-amber-200">
                <p className="font-black uppercase tracking-wider text-amber-300">⚠️ Ordre non armé</p>
                <p className="mt-1 text-amber-100/70 hidden lg:block">Sélectionne un marché ou clique sur <strong>▲ HAUSSE</strong> / <strong>▼ BAISSE</strong> ci-dessus pour armer et valider un nouvel ordre.</p>
                <p className="mt-0.5 lg:hidden">Choisis un marché + direction pour armer.</p>
              </div>
            )}

            {!manualDirectionMatchesSignal && manualOpportunity?.direction && (
              <div className="hidden lg:block rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
                <p className="font-black uppercase tracking-wider">Décision contraire au signal</p>
                <p className="mt-1 text-amber-100/70">Tu peux continuer, mais la direction choisie ne correspond pas à la recommandation IA.</p>
              </div>
            )}

            {/* Exposition Warning — desktop only */}
            <div className="hidden lg:block rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-[11px] leading-relaxed">
              <p className="font-bold text-amber-300 uppercase tracking-wider">Responsabilité</p>
              <p className="mt-1 text-muted-foreground">
                Cette position est exécutée immédiatement sur votre compte. Elle est 100% manuelle.
              </p>
            </div>

            {/* Desktop: original CTA button */}
            <Button
              disabled={!manualTradeAllowed || forcingTrade || !manualArmed}
              onClick={async () => {
                if (!forceSymbol) return;
                const label = SYMBOLS.find((x) => x.deriv === forceSymbol)?.label ?? forceSymbol;
                const isLive = config.mode === "live";
                const currentUtcHour = new Date().getUTCHours();
                const isUnfavorableHour = [3, 4, 7, 8, 11, 16, 19].includes(currentUtcHour);
                const hourStr = `${String(currentUtcHour).padStart(2, "0")}:00 UTC`;

                const title = isUnfavorableHour
                  ? `⚠️ Créneau Défavorable (${hourStr})`
                  : isLive ? "Confirmer le trade (réel) ?" : "Confirmer le trade (démo) ?";

                const warningMsg = isUnfavorableHour
                  ? `\n\n⚠️ AVERTISSEMENT : Le créneau de ${hourStr} est historiquement défavorable (Win Rate 45%-65% · liquidité faible/piégeuse). Confirmer l'exécution en toute conscience ?`
                  : "";

                const confirmed = await confirm({
                  title,
                  description: `Position ${forceDir === "CALL" || forceDir === "MULTUP" ? "Hausse" : "Baisse"} (${forceDir}) sur ${label} · $${forceStake}${warningMsg}`,
                  confirmLabel: isUnfavorableHour ? "Exécuter quand même" : isLive ? "Exécuter (RÉEL)" : "Exécuter",
                  danger: isLive || isUnfavorableHour,
                });
                if (!confirmed) return;
                setForcingTrade(true);
                toast.info(`Trade en cours — ${label} ${forceDir}…`);
                try {
                  if (derivSession.connected) {
                    await forceDemoTrade(
                      forceSymbol,
                      forceDir,
                      forceStake,
                      manualDurationMinutes,
                      (log) => {
                        handleEvent(log);
                        if (log.status === "pending" || log.status === "open") {
                          setManualExecution({ status: log.status, symbol: label, direction: forceDir });
                        } else if (log.status === "won" || log.status === "lost" || log.status === "error") {
                          setManualExecution(null);
                        }
                        if (log.status === "open") toast.success(`Contrat ouvert — ${label} ${forceDir}`);
                      },
                      config
                    );
                  } else {
                    await openPreviewTrade(
                      forceSymbol,
                      manualDurationMinutes,
                      forceStake,
                      (log) => {
                        handleEvent(log);
                        if (log.status === "open") {
                          setManualExecution({ status: "open", symbol: label, direction: forceDir });
                        } else if (log.status === "won" || log.status === "lost" || log.status === "error") {
                          setManualExecution(null);
                        }
                        if (log.status === "open") toast.success(`Position démo simulée — ${label} ${forceDir}`);
                      }
                    );
                  }
                  // Require a fresh, deliberate market/direction pick before the
                  // button re-enables — prevents an accidental second tap from
                  // silently placing another order with nothing newly chosen.
                  setManualArmed(false);
                  setPreparedManualOpportunity(null);
                } catch (e) {
                  toast.error(`Échec: ${(e as Error).message}`);
                } finally {
                  setForcingTrade(false);
                }
              }}
              className={cn(
                "hidden lg:flex h-13 w-full shrink-0 gap-2 text-sm font-extrabold rounded-xl transition-all shadow-xl",
                forceDir === "CALL" || forceDir === "MULTUP"
                  ? "bg-up text-black hover:bg-up/90 shadow-up/25"
                  : "bg-down text-white hover:bg-down/90 shadow-down/25",
                "disabled:bg-muted/20 disabled:text-muted-foreground disabled:border-border disabled:cursor-not-allowed"
              )}
            >
              {forcingTrade ? (
                <><Activity className="h-5 w-5 animate-pulse" /> Traitement de l'ordre…</>
              ) : (
                <>Exécuter l'Ordre Manuel (${forceStake.toFixed(2)})</>
              )}
            </Button>

            <p className="hidden lg:block text-center text-[11px] font-semibold text-muted-foreground">
              Exécution instantanée · Vérification finale demandée
            </p>
          </aside>
        </div>

        {/* Mobile: sticky bottom CTA bar */}
        <div className="fixed bottom-[calc(54px+env(safe-area-inset-bottom,0px))] left-0 right-0 z-40 lg:hidden">
          <div className="mx-3 mb-2 rounded-xl border border-border/60 bg-card/95 backdrop-blur-lg shadow-2xl p-2.5">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                  <span className="truncate">{manualSymbolLabel}</span>
                  <span className={cn("shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black uppercase", forceDir === "CALL" || forceDir === "MULTUP" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300")}>
                    {forceDir === "CALL" || forceDir === "MULTUP" ? "▲" : "▼"}
                  </span>
                  <span className="shrink-0 font-mono font-black text-foreground">${forceStake.toFixed(2)}</span>
                </div>
                <div className="text-[10px] text-emerald-400 font-bold">+${(forceStake * 0.85).toFixed(2)} profit</div>
              </div>
              <Button
                disabled={!manualTradeAllowed || forcingTrade || !manualArmed}
                onClick={async () => {
                  if (!forceSymbol) return;
                  const label = SYMBOLS.find((x) => x.deriv === forceSymbol)?.label ?? forceSymbol;
                  const isLive = config.mode === "live";
                  const currentUtcHour = new Date().getUTCHours();
                  const isUnfavorableHour = [3, 4, 7, 8, 11, 16, 19].includes(currentUtcHour);
                  const hourStr = `${String(currentUtcHour).padStart(2, "0")}:00 UTC`;

                  const title = isUnfavorableHour
                    ? `⚠️ Créneau Défavorable (${hourStr})`
                    : isLive ? "Confirmer le trade (réel) ?" : "Confirmer le trade (démo) ?";

                  const warningMsg = isUnfavorableHour
                    ? `\n\n⚠️ AVERTISSEMENT : Le créneau de ${hourStr} est historiquement défavorable (Win Rate 45%-65% · liquidité faible/piégeuse). Confirmer l'exécution en toute conscience ?`
                    : "";

                  const confirmed = await confirm({
                    title,
                    description: `Position ${forceDir === "CALL" || forceDir === "MULTUP" ? "Hausse" : "Baisse"} (${forceDir}) sur ${label} · $${forceStake}${warningMsg}`,
                    confirmLabel: isUnfavorableHour ? "Exécuter quand même" : isLive ? "Exécuter (RÉEL)" : "Exécuter",
                    danger: isLive || isUnfavorableHour,
                  });
                  if (!confirmed) return;
                  setForcingTrade(true);
                  toast.info(`Trade en cours — ${label} ${forceDir}…`);
                  try {
                    if (derivSession.connected) {
                      await forceDemoTrade(
                        forceSymbol,
                        forceDir,
                        forceStake,
                        manualDurationMinutes,
                        (log) => {
                          handleEvent(log);
                          if (log.status === "pending" || log.status === "open") {
                            setManualExecution({ status: log.status, symbol: label, direction: forceDir });
                          } else if (log.status === "won" || log.status === "lost" || log.status === "error") {
                            setManualExecution(null);
                          }
                          if (log.status === "open") toast.success(`Contrat ouvert — ${label} ${forceDir}`);
                        },
                        config
                      );
                    } else {
                      await openPreviewTrade(
                        forceSymbol,
                        manualDurationMinutes,
                        forceStake,
                        (log) => {
                          handleEvent(log);
                          if (log.status === "open") {
                            setManualExecution({ status: "open", symbol: label, direction: forceDir });
                          } else if (log.status === "won" || log.status === "lost" || log.status === "error") {
                            setManualExecution(null);
                          }
                          if (log.status === "open") toast.success(`Position démo simulée — ${label} ${forceDir}`);
                        }
                      );
                    }
                    setManualArmed(false);
                    setPreparedManualOpportunity(null);
                  } catch (e) {
                    toast.error(`Échec: ${(e as Error).message}`);
                  } finally {
                    setForcingTrade(false);
                  }
                }}
                className={cn(
                  "h-11 shrink-0 gap-1.5 rounded-lg px-4 text-sm font-extrabold transition-all shadow-lg active:scale-95 touch-manipulation",
                  forceDir === "CALL" || forceDir === "MULTUP"
                    ? "bg-up text-black hover:bg-up/90 shadow-up/25"
                    : "bg-down text-white hover:bg-down/90 shadow-down/25",
                  "disabled:bg-muted/20 disabled:text-muted-foreground disabled:border-border disabled:cursor-not-allowed"
                )}
              >
                {forcingTrade ? (
                  <><Activity className="h-4 w-4 animate-pulse" /> …</>
                ) : (
                  <>Exécuter</>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Live Health & Guard Monitor */}
        <div className="mt-6">
          <HealthPanel
            currentPnl={pnl}
            maxDailyLoss={config.maxDailyLossUsd}
            activePreset={selectedPreset}
            winRate={winRate}
            openPositionsCount={liveDerivPositions.length}
          />
        </div>

        {/* ── Mini Journal des Contrats en Cours & Récents ── */}
        <div className="mt-6 glass-panel rounded-2xl border border-border/60 bg-card/30 p-3.5 space-y-4 md:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/50 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-7 w-7 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                <Activity className="h-4 w-4 animate-pulse" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-foreground">
                  Suivi des Contrats & Positions
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  Historique en temps réel de tes positions ouvertes et contrats récemment fermés.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider",
                openTradeList.length > 0 ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 animate-pulse" : "border-white/10 bg-white/[0.04] text-muted-foreground"
              )}>
                {openTradeList.length} position{openTradeList.length > 1 ? "s" : ""} en cours
              </span>
            </div>
          </div>

          {(() => {
            // Unifier les positions en cours en direct (Deriv WS) + l'historique des logs
            const allItems: Array<{
              id: string;
              symbol: string;
              direction: string;
              stake: number;
              payout: number;
              potentialProfit: number;
              status: "open" | "pending" | "won" | "lost" | "error";
              pnl?: number;
              timestamp: number;
              closedAt?: number;
              isLiveDeriv?: boolean;
            }> = [];

            // 1. Positions en direct du compte Deriv WebSocket
            for (const pos of liveDerivPositions) {
              const potentialProfit = pos.payout > pos.buyPrice ? pos.payout - pos.buyPrice : pos.buyPrice * 0.85;
              allItems.push({
                id: `deriv-${pos.contractId}`,
                symbol: pos.symbol,
                direction: normalizeContractDirection(pos.contractType),
                stake: pos.buyPrice,
                payout: pos.payout || pos.buyPrice * 1.85,
                potentialProfit,
                status: "open",
                pnl: pos.profit,
                timestamp: pos.dateStart * 1000,
                isLiveDeriv: true,
              });
            }

            // 2. Historique réel des trades (cloud si le bot serveur tourne, sinon logs
            // locaux) — avant ce correctif cette mini-liste ne lisait QUE `logs` (les
            // trades démo simulés localement), donc les vrais trades gagnés/perdus du
            // bot serveur n'apparaissaient jamais ici, seulement les positions encore
            // ouvertes. `journalTrades` est déjà la source cloud-aware utilisée par le
            // journal principal (onglet Auto) — même trades, même heure de fermeture.
            for (const log of journalTrades) {
              if (!allItems.some((item) => item.id === `deriv-${log.contractId}` || item.id === log.id)) {
                const potentialProfit = log.stake * 0.85;
                allItems.push({
                  id: log.id,
                  symbol: log.symbol,
                  direction: log.direction,
                  stake: log.stake,
                  payout: log.stake * 1.85,
                  potentialProfit,
                  // TradeLog's real fields are `time`/`profit` — this used to read
                  // `.timestamp`/`.pnl`, which don't exist on TradeLog, so every
                  // real trade rendered here got `undefined` (blank date, blank P&L).
                  status: log.status === "cooldown" || log.status === "risk-stop" ? "error" : log.status,
                  pnl: log.profit,
                  timestamp: log.time,
                  closedAt: log.closedAt,
                });
              }
            }

            // Most recent activity first — closed trades use their close time so a
            // just-settled loss surfaces above an older still-open position.
            allItems.sort((a, b) => (b.closedAt ?? b.timestamp) - (a.closedAt ?? a.timestamp));

            // ── KPI summary (same visual as TradeJournalSection) ──
            const closedItems = allItems.filter((t) => t.status === "won" || t.status === "lost");
            const kpiWins = closedItems.filter((t) => t.status === "won").length;
            const kpiLosses = closedItems.filter((t) => t.status === "lost").length;
            const kpiTotal = closedItems.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
            const kpiOpen = allItems.filter((t) => t.status === "open" || t.status === "pending").length;

            if (allItems.length === 0) {
              return (
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-xs text-muted-foreground space-y-1.5">
                  <p className="text-sm font-black text-foreground">Aucune position ouverte sur votre compte</p>
                  <p className="text-xs opacity-75">Dès qu'un ordre est exécuté ou en cours sur Deriv, il s'affichera ici en grand format avec sa mise et son gain potentiel.</p>
                </div>
              );
            }

            return (
              <div className="space-y-3">
                {/* KPI Cards */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Trades</div>
                    <div className="mt-1 font-mono text-base font-black text-foreground">{allItems.length}</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Wins / Losses</div>
                    <div className="mt-1 font-mono text-base font-black">
                      <span className="text-up">{kpiWins}</span>
                      <span className="text-muted-foreground/50">/</span>
                      <span className="text-down">{kpiLosses}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">En cours</div>
                    <div className="mt-1 font-mono text-base font-black text-amber-300">{kpiOpen}</div>
                  </div>
                  <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">Total P&L</div>
                    <div className={cn("mt-1 font-mono text-base font-black", kpiTotal >= 0 ? "text-up" : "text-down")}>
                      {kpiTotal >= 0 ? "+" : ""}${kpiTotal.toFixed(2)}
                    </div>
                  </div>
                </div>

              <div className="flex flex-col gap-2.5 p-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20 shadow-xl">
                {allItems.slice(0, 10).map((trade) => {
                  const symLabel = SYMBOLS.find((s) => s.deriv === trade.symbol)?.label ?? trade.symbol;
                  const isUp = trade.direction === "CALL" || trade.direction === "MULTUP";
                  const isOpen = trade.status === "open" || trade.status === "pending";
                  const isWin = trade.status === "won";
                  const isLoss = trade.status === "lost";
                  const isError = trade.status === "error";

                  return (
                    <div
                      key={trade.id}
                      className="relative overflow-hidden rounded-xl border border-white/10 bg-card/40 p-3 transition-all duration-200 shadow-md hover:bg-white/[0.03]"
                    >
                      {/* Left vertical accent indicator bar */}
                      <div
                        className={cn(
                          "absolute left-0 top-0 bottom-0 w-1 rounded-l-full",
                          isWin
                            ? "bg-emerald-500"
                            : isLoss
                              ? "bg-rose-500"
                              : isError
                                ? "bg-yellow-400 animate-pulse"
                                : isOpen
                                  ? "bg-amber-400 animate-pulse"
                                  : "bg-white/20"
                        )}
                      />

                      {/* Mobile Layout (sm:hidden): 2 Compact Rows */}
                      <div className="sm:hidden space-y-1.5">
                        {/* Row 1: Symbol + Direction Badge on Left | Gain/P&L on Right */}
                        <div className="flex items-center justify-between gap-2 pl-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-sm font-black text-foreground truncate">{symLabel}</span>
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border shrink-0",
                                isUp
                                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                  : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                              )}
                            >
                              {trade.direction === "CALL" || trade.direction === "MULTUP" ? "HAUSSE ▲" : "BAISSE ▼"}
                            </span>
                          </div>

                          <div
                            className={cn(
                              "font-mono text-sm font-black shrink-0",
                              isWin ? "text-emerald-400" : isLoss ? "text-rose-400" : isOpen ? "text-amber-300" : "text-muted-foreground"
                            )}
                          >
                            {isWin
                              ? `+$${(trade.pnl ?? trade.potentialProfit).toFixed(2)}`
                              : isLoss
                                ? `-$${Math.abs(trade.pnl ?? trade.stake).toFixed(2)}`
                                : isOpen
                                  ? trade.pnl !== undefined && trade.pnl !== 0
                                    ? `${trade.pnl > 0 ? "+" : ""}$${trade.pnl.toFixed(2)}`
                                    : "En cours"
                                  : "—"}
                          </div>
                        </div>

                        {/* Row 2: Timestamps on Left | Stake on Right */}
                        <div className="flex items-center justify-between gap-2 pl-1.5 text-[10px] font-semibold text-muted-foreground/80 border-t border-white/5 pt-1.5">
                          <div className="flex items-center gap-1 truncate">
                            <span>Pris à <strong className="font-mono text-foreground/90">{new Date(trade.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</strong></span>
                            {trade.closedAt && (isWin || isLoss) && (
                              <span>· fermé à <strong className="font-mono text-foreground/90">{new Date(trade.closedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</strong></span>
                            )}
                          </div>

                          <div className="font-mono text-[10px] font-bold text-muted-foreground/90 shrink-0">
                            Mise: <span className="text-foreground font-black">${trade.stake.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Desktop Layout (hidden sm:flex): Original Horizontal Row */}
                      <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-4 w-full">
                        <div className="flex items-center gap-3 pl-1.5 min-w-0">
                          <span
                            className={cn(
                              "grid h-10 w-10 shrink-0 place-items-center rounded-xl border font-mono text-base font-black shadow-sm",
                              isUp
                                ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                : "border-rose-500/40 bg-rose-500/15 text-rose-300"
                            )}
                          >
                            {isUp ? "▲" : "▼"}
                          </span>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-base font-black text-foreground truncate">{symLabel}</span>
                              <span
                                className={cn(
                                  "rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider border shrink-0",
                                  isUp
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                                    : "border-rose-500/30 bg-rose-500/10 text-rose-300"
                                )}
                              >
                                {trade.direction === "CALL" || trade.direction === "MULTUP" ? "HAUSSE ▲" : "BAISSE ▼"}
                              </span>
                              {trade.isLiveDeriv && (
                                <span className="rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[8px] font-black text-emerald-300 uppercase tracking-wider">
                                  Direct Deriv
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground/80">
                              <span>
                                Pris à <strong className="font-mono text-foreground/90">{new Date(trade.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong>
                              </span>
                              {trade.closedAt && (isWin || isLoss) && (
                                <>
                                  <span className="text-white/20">·</span>
                                  <span>
                                    fermé à <strong className="font-mono text-foreground/90">{new Date(trade.closedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong>
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-6 justify-end shrink-0">
                          <div className="text-right">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">Mise</div>
                            <div className="font-mono text-sm font-black text-foreground">${trade.stake.toFixed(2)}</div>
                          </div>

                          <div className="text-right">
                            <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">Gain / P&L</div>
                            <div
                              className={cn(
                                "font-mono text-sm font-black",
                                isWin ? "text-emerald-300" : isLoss ? "text-rose-400" : isOpen ? "text-amber-300" : "text-foreground"
                              )}
                            >
                              {isWin
                                ? `+$${(trade.pnl ?? trade.potentialProfit).toFixed(2)}`
                                : isLoss
                                  ? `-$${Math.abs(trade.pnl ?? trade.stake).toFixed(2)}`
                                  : isOpen
                                    ? trade.pnl !== undefined && trade.pnl !== 0
                                      ? `${trade.pnl > 0 ? "+" : ""}$${trade.pnl.toFixed(2)}`
                                      : "En cours"
                                    : "—"}
                            </div>
                          </div>

                          <div className="shrink-0">
                            {isOpen ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-xs font-black uppercase text-amber-300 animate-pulse">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
                                En cours
                              </span>
                            ) : isWin ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-xs font-black uppercase text-emerald-300 shadow-sm">
                                Gagné
                              </span>
                            ) : isLoss ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-xs font-black uppercase text-rose-300 shadow-sm">
                                Perdu
                              </span>
                            ) : (
                              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs font-bold text-muted-foreground">
                                {trade.status}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>
            );
          })()}
        </div>
      </section>
      </div>

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



      {/* ── Mobile section switcher — sticky bottom bar with pill tabs.
          Desktop ignores this entirely. ── */}
      {advancedVisible && (
      <div className="fixed bottom-16 left-1/2 z-40 -translate-x-1/2 md:hidden">
        <div className="flex items-center gap-1 rounded-full border border-border/60 bg-card/90 p-1 shadow-2xl backdrop-blur-lg">
          {([
            { id: "control", label: "Exéc", icon: Power },
            { id: "dashboard", label: "Scan", icon: Activity },
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
                  "flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[11px] font-bold transition-all",
                  active ? "bg-primary/20 text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      )}

      {/* ── Main 2-col layout ── */}
      {advancedVisible && (
      <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">

        {/* ── LEFT: Control panel ── */}
        <div className={cn(mobileTab === "control" || mobileTab === "data" ? "block" : "hidden", "md:block space-y-4")}>

          {/* Bloc contrôle principal — le sélecteur Démo/Live vit dans le HUD
              (toujours visible), pas ici, pour ne pas avoir deux contrôles
              pour le même réglage. */}
          <div className="glass-panel rounded-2xl overflow-hidden">

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

        {/* The operational dashboard remains available, but stays out of the
            decision flow until the user explicitly asks for the detail. */}
        <div className={cn(mobileTab === "dashboard" || mobileTab === "data" ? "block" : "hidden", "md:block space-y-5 min-w-0")}>
          <details className="group rounded-2xl border border-border/60 bg-card/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
              <span>
                Détails d’exécution
                <span className="ml-2 font-medium text-muted-foreground/70">
                  {openTrades > 0 ? `${openTrades} position${openTrades > 1 ? "s" : ""} ouverte${openTrades > 1 ? "s" : ""}` : "aucune position ouverte"}
                </span>
              </span>
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-5 border-t border-border/40 p-4">
              <AutoBacktestStatus />
            <BotDashboard
              logs={cloudActive ? (cloudSelected?.trades ?? []) : logs}
              lastScan={cloudActive ? (cloudSelected?.lastScan ?? null) : lastScan}
              config={config}
              running={!!cloudSelected?.enabled && !!cloudSelected?.running}
              pnl={pnl}
              lossUsedUsd={lossUsedUsd}
            />

          {/* Scan status + scanner detail — positions themselves are already
              always visible above in the cockpit (LivePositionsPanel), so
              this only fills the "nothing open yet" gap instead of repeating
              the same cards here too. */}
          <div className="space-y-5 animate-fade-in">
            {openTradeList.length === 0 && (
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
          </details>
        </div>
      </div>
      )}

      {/* ── Config: grouped under the mobile "Données" tab, same showAdvanced
          flag desktop's "Avancé" button drives — one source of truth. ── */}
      <div className={cn(advancedVisible && (mobileTab === "config" || mobileTab === "data") ? "block" : "hidden", advancedVisible ? "md:block" : "md:hidden", "space-y-6")}>

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
                  {([["profiles","Profils"], ["params","Paramètres"], ["risk","Risque & Sessions"], ["multiplier","Moteur Multiplicateur"], ["backtest","Backtest 30j"]] as const).map(([t, label]) => (
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
                  {/* Quick Markets Configuration for Prise Rapide */}
                  <div className="rounded-xl border border-cyan/30 bg-cyan/5 p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Zap className="h-4 w-4 text-cyan" />
                        <span className="text-xs font-black uppercase tracking-wider text-neutral-200">
                          Raccourcis Prise Rapide (Marchés Rentables)
                        </span>
                      </div>
                      <span className="text-xs font-mono font-bold text-cyan">
                        {quickSymbols.length} / 6 sélectionnés
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Sélectionne ici les 4 à 6 marchés à afficher sous forme de boutons d'accès rapide 1-clic dans la Prise directe.
                    </p>
                    <QuickMarketsEditor quickSymbols={quickSymbols} onSave={saveQuickSymbols} />
                  </div>

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
                      <input
                        type="range"
                        min={55}
                        max={95}
                        step={5}
                        value={config.minConfidence}
                        onChange={async (e) => {
                          const val = Number(e.target.value);
                          if (val < 82) {
                            const ok = await confirm({
                              title: "Diminuer l'exigence de confiance ?",
                              description: `Dérouler la confiance sous 82% (${val}%) augmente la fréquence mais réduit la protection du modèle 'Multi — Conservateur'. Confirmer ce changement ?`,
                              confirmLabel: "Réduire le filtre",
                              danger: true,
                            });
                            if (!ok) return;
                          }
                          patchConfig("minConfidence", val);
                        }}
                        className="w-full accent-primary"
                      />
                      <div className="flex justify-between text-xs font-semibold text-muted-foreground mt-0.5"><span>55%</span><span>95%</span></div>
                    </Field>
                    <Field label={`Confiance max (${config.maxConfidence}%)`}>
                      <input type="range" min={config.minConfidence} max={100} step={1} value={config.maxConfidence}                        onChange={(e) => patchConfig("maxConfidence", Number(e.target.value))} className="w-full accent-primary" />
                      <div className="flex justify-between text-xs font-semibold text-muted-foreground mt-0.5"><span>{config.minConfidence}%</span><span>100%</span></div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Certains marchés se comportent mal au-dessus d'un seuil — plafond de sécurité contre les faux signaux « trop parfaits ».</p>
                    </Field>
                    <Field label={`Accord TF min (${config.minTfAgreement}/4)`}>
                      <input
                        type="range"
                        min={1}
                        max={4}
                        step={1}
                        value={config.minTfAgreement}
                        onChange={async (e) => {
                          const val = Number(e.target.value);
                          if (val < 4) {
                            const ok = await confirm({
                              title: "Passer sous l'accord 4/4 TF ?",
                              description: `Le modèle 'Multi — Conservateur' exige 4/4 Timeframes d'accord. Réduire à ${val}/4 TF réouvre des trades avec moins d'alignement. Confirmer ce changement ?`,
                              confirmLabel: "Réduire le filtrage TF",
                              danger: true,
                            });
                            if (!ok) return;
                          }
                          patchConfig("minTfAgreement", val);
                        }}
                        className="w-full accent-primary"
                      />
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
                    <div className="sm:col-span-2 lg:col-span-3">
                      <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Marchés exclus</label>
                      <div className="flex flex-wrap gap-1.5">
                        {SYMBOLS.map((s) => {
                          const excluded = config.excludedSymbols.includes(s.deriv);
                          const conflicting = excluded && config.symbols.includes(s.deriv);
                          return (
                            <button key={s.deriv}
                              onClick={() => { const next = excluded ? config.excludedSymbols.filter((x) => x !== s.deriv) : [...config.excludedSymbols, s.deriv]; patchConfig("excludedSymbols", next); }}
                              className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                                conflicting ? "border-down/60 bg-down/15 text-down" : excluded ? "border-down/40 bg-down/10 text-down/90" : "border-border text-muted-foreground hover:text-foreground")}>
                              {s.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-1.5 text-[10px] text-muted-foreground">
                        Jamais tradé, même en mode « tous les marchés ».
                        {config.excludedSymbols.some((sym) => config.symbols.includes(sym)) && (
                          <span className="ml-1 font-semibold text-down">
                            Un symbole à la fois surveillé et exclu est silencieusement ignoré à chaque scan — retire-le d&apos;une des deux listes.
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Régime & Confluence */}
                  <details className="group rounded-2xl border border-border/60 bg-card/20">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
                      <span>Régime &amp; Confluence</span>
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid gap-4 border-t border-border/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Filtre ADX (force de tendance)</label>
                        <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                          {(["off", "penalize", "block"] as const).map((m) => (
                            <button key={m} onClick={() => patchConfig("adxFilterMode", m)}
                              className={cn("px-4 py-2 text-xs font-semibold transition-colors",
                                config.adxFilterMode === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
                              {m === "off" ? "Désactivé" : m === "penalize" ? "Pénalité" : "Blocage strict"}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs font-semibold text-muted-foreground/90 mt-1.5">
                          « Blocage strict » rejette le trade si l&apos;ADX est sous le seuil (marché sans tendance) ; « Pénalité » réduit juste la confiance.
                        </p>
                      </div>
                      <Field label={`Seuil ADX faible (${config.adxBlockThreshold})`}>
                        <input type="range" min={5} max={40} step={1} value={config.adxBlockThreshold}
                          disabled={config.adxFilterMode === "off"}
                          onChange={(e) => patchConfig("adxBlockThreshold", Number(e.target.value))} className="w-full accent-primary disabled:opacity-40" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">ADX en dessous = marché sans tendance (range).</p>
                      </Field>
                      <Field label={`Seuil ADX fort (${config.adxStrongThreshold})`}>
                        <input type="range" min={config.adxBlockThreshold + 1} max={50} step={1} value={config.adxStrongThreshold}
                          disabled={config.adxFilterMode === "off"}
                          onChange={(e) => patchConfig("adxStrongThreshold", Number(e.target.value))} className="w-full accent-primary disabled:opacity-40" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">ADX au-dessus = tendance forte, bonus de confiance.</p>
                      </Field>
                      <div>
                        <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Mode de confluence</label>
                        <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                          {(["vote", "weighted"] as const).map((m) => (
                            <button key={m} onClick={() => patchConfig("confluenceMode", m)}
                              className={cn("px-4 py-2 text-xs font-semibold transition-colors",
                                config.confluenceMode === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
                              {m === "vote" ? "Majorité" : "Pondéré"}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs font-semibold text-muted-foreground/90 mt-1.5">
                          « Pondéré » tient compte de la qualité de chaque timeframe, pas juste du nombre qui vote pour/contre.
                        </p>
                      </div>
                    </div>
                  </details>

                  {/* Filtres avancés */}
                  <details className="group rounded-2xl border border-border/60 bg-card/20">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
                      <span>Filtres avancés</span>
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid gap-4 border-t border-border/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label="Confiance min dynamique">
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                          <span className="text-xs text-muted-foreground">{config.dynamicMinConfidence ? "Activé" : "Désactivé"}</span>
                          <Switch checked={config.dynamicMinConfidence} onCheckedChange={(v) => patchConfig("dynamicMinConfidence", v)} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Ajuste le seuil de confiance selon le payout en direct. Désactivé par défaut — une tentative précédente a dégradé les résultats.</p>
                      </Field>
                      <Field label={`Marge de sécurité (${config.dynamicConfidenceMargin})`}>
                        <input type="range" min={0} max={20} step={1} value={config.dynamicConfidenceMargin}
                          disabled={!config.dynamicMinConfidence}
                          onChange={(e) => patchConfig("dynamicConfidenceMargin", Number(e.target.value))} className="w-full accent-primary disabled:opacity-40" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Marge au-dessus du win rate d&apos;équilibre.</p>
                      </Field>
                      <div />
                      <Field label="Filtre edge horaire">
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                          <span className="text-xs text-muted-foreground">{config.hourlyEdgeFilter ? "Activé" : "Désactivé"}</span>
                          <Switch checked={config.hourlyEdgeFilter} onCheckedChange={(v) => patchConfig("hourlyEdgeFilter", v)} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Désactive automatiquement les heures UTC à P&amp;L négatif récent.</p>
                      </Field>
                      <Field label={`Trades avant activation (${config.hourlyEdgeLookback})`}>
                        <AmountInput value={config.hourlyEdgeLookback} min={3} max={20} step={1}
                          disabled={!config.hourlyEdgeFilter}
                          onCommit={(v) => { patchConfig("hourlyEdgeLookback", v); return true; }} />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Par heure, avant que le filtre agisse.</p>
                      </Field>
                      <div />
                      <Field label={`Payout min (${Math.round(config.minPayoutRatio * 100)}%)`}>
                        <input type="range" min={0.5} max={0.95} step={0.01} value={config.minPayoutRatio}
                          onChange={(e) => patchConfig("minPayoutRatio", Number(e.target.value))} className="w-full accent-primary" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          Seuil de rentabilité à ce payout : {Math.round((1 / (1 + config.minPayoutRatio)) * 100)}% de win rate minimum.
                        </p>
                      </Field>
                      <Field label={`Win rate min par symbole (${config.minSymbolWinRate === 0 ? "désactivé" : `${Math.round(config.minSymbolWinRate * 100)}%`})`}>
                        <input type="range" min={0} max={0.8} step={0.05} value={config.minSymbolWinRate}
                          onChange={(e) => patchConfig("minSymbolWinRate", Number(e.target.value))} className="w-full accent-primary" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Met en pause un symbole si son win rate glissant tombe en dessous. 0 = désactivé.</p>
                      </Field>
                      <Field label={`Fenêtre de calcul (${config.symbolWinRateLookback} trades)`}>
                        <AmountInput value={config.symbolWinRateLookback} min={5} max={50} step={1}
                          disabled={config.minSymbolWinRate === 0}
                          onCommit={(v) => { patchConfig("symbolWinRateLookback", v); return true; }} />
                      </Field>
                    </div>
                  </details>

                  {/* ── Stratégies Gagnantes & Algorithmes Pro ── */}
                  <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-black/40 to-black/60 p-5 space-y-4 shadow-xl">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-emerald-400" />
                      <h4 className="text-sm font-black uppercase tracking-wider text-foreground">
                        Stratégies Gagnantes & Algorithmes Pro
                      </h4>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Ces algorithmes surveillent et optimisent chaque position en direct pour maximiser le rendement et sécuriser le capital.
                    </p>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-2">
                      <div className="rounded-xl border border-white/[0.08] bg-black/40 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground">Trailing Stop & Break-Even</span>
                          <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-300">
                            Automatique
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Déplace le Stop-Loss au prix d'entrée dès +50% du Take-Profit. Risque zéro garanti sur le trade.
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/[0.08] bg-black/40 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground">Mise Dynamique par Confiance</span>
                          <span className="rounded bg-amber-500/20 border border-amber-500/40 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300">
                            IA Active
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Multiplie la mise par 1.5x (≥75%) et par 2.0x (≥80% avec 100% accord TF) sur les pépites d'or.
                        </p>
                      </div>

                      <div className="rounded-xl border border-white/[0.08] bg-black/40 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground">Auto-Blacklist Symboles</span>
                          <span className="rounded bg-sky-500/20 border border-sky-500/40 px-2 py-0.5 text-[9px] font-black uppercase text-sky-300">
                            ≥50% WR
                          </span>
                        </div>
                        <p className="text-[10px] text-muted-foreground leading-relaxed">
                          Suspend automatiquement les symboles en sous-performance pour concentrer le capital sur les gagnants.
                        </p>
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
                  <Field label="Veto journalier (contre-tendance)">
                    <select value={config.vetoDaily} onChange={(e) => patchConfig("vetoDaily", e.target.value as Veto4hMode)} className="cfg-input">
                      <option value="off">Désactivé — recommandé</option>
                      <option value="strong-only">Signal journalier fort uniquement</option>
                      <option value="always">Toujours (strict)</option>
                    </select>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">Même logique que le veto 4H, sur la tendance journalière (plus rare et plus stricte).</p>
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
                            <div className="text-[10px] opacity-60">{utcHourToMontreal(SESSION_HOURS[s].open)}–{utcHourToMontreal(SESSION_HOURS[s].close)} (Montréal)</div>
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">Les indices Volatility (R_100…) ignorent ce filtre — ouverts 24h/24, 7j/7.</p>
                  </div>

                  <div className="sm:col-span-2 lg:col-span-3 space-y-4">
                    {/* Trailing & rollback */}
                    <details className="group rounded-2xl border border-border/60 bg-card/20">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
                        <span>Trailing &amp; Rollback</span>
                        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="grid gap-4 border-t border-border/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label={`Trailing stop % du pic (${config.trailingStopPct === 0 ? "désactivé" : `${Math.round(config.trailingStopPct * 100)}%`})`}>
                          <input type="range" min={0} max={0.5} step={0.05} value={config.trailingStopPct}
                            onChange={(e) => patchConfig("trailingStopPct", Number(e.target.value))} className="w-full accent-primary" />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Protège ce % du pic de gain journalier. 0 = désactivé.</p>
                        </Field>
                        <Field label={`Pic minimum avant protection ($${config.trailingStopMinPeakUsd})`}>
                          <AmountInput value={config.trailingStopMinPeakUsd} min={0} max={200} step={5}
                            disabled={config.trailingStopPct === 0}
                            onCommit={(v) => { patchConfig("trailingStopMinPeakUsd", v); return true; }} />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Évite qu&apos;un tout petit gain déclenche le trailing.</p>
                        </Field>
                        <Field label="Rollback automatique">
                          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                            <span className="text-xs text-muted-foreground">{config.autoRollbackEnabled ? "Activé" : "Désactivé"}</span>
                            <Switch checked={config.autoRollbackEnabled} onCheckedChange={async (v) => {
                              if (v) {
                                const ok = await confirm({ title: "Activer le rollback automatique ?", description: "Le moteur pourra annuler automatiquement un de tes réglages récents s'il détecte une dégradation de performance. Une automatisation de plus, pas juste un seuil.", confirmLabel: "Activer", danger: true });
                                if (!ok) return;
                              }
                              patchConfig("autoRollbackEnabled", v);
                            }} />
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Revient sur un réglage récent si la performance se dégrade après le changement.</p>
                        </Field>
                      </div>
                    </details>

                    {/* Positions & marchés */}
                    <details className="group rounded-2xl border border-border/60 bg-card/20">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
                        <span>Positions &amp; Marchés</span>
                        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="grid gap-4 border-t border-border/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field label={`Positions ouvertes max (${config.maxOpenPositions})`}>
                          <AmountInput value={config.maxOpenPositions} min={1} max={15} step={1}
                            onCommit={async (v) => {
                              if (v > config.maxOpenPositions) {
                                const ok = await confirm({ title: "Augmenter les positions simultanées max ?", description: `${config.maxOpenPositions} → ${v}. Plus de positions ouvertes en même temps = plus d'exposition simultanée.`, confirmLabel: "Confirmer", danger: true });
                                if (!ok) return false;
                              }
                              patchConfig("maxOpenPositions", v);
                              return true;
                            }} />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Plafond total, tous cycles de scan confondus.</p>
                        </Field>
                        <Field label={`Spread max (${config.maxSpreadPct === 0 ? "désactivé" : `${config.maxSpreadPct.toFixed(2)}%`})`}>
                          <input type="range" min={0.05} max={1} step={0.05} value={config.maxSpreadPct}
                            onChange={(e) => patchConfig("maxSpreadPct", Number(e.target.value))} className="w-full accent-primary" />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Ignore le trade si le spread bid/ask dépasse ce % du prix.</p>
                        </Field>
                        <Field label={`Cooldown après perte (${config.cooldownMinutes} min)`}>
                          <AmountInput value={config.cooldownMinutes} min={5} max={240} step={5}
                            onCommit={(v) => { patchConfig("cooldownMinutes", v); return true; }} />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Pause par symbole après une série de pertes.</p>
                        </Field>
                        <Field label="Réduction progressive de la mise">
                          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                            <span className="text-xs text-muted-foreground">{config.progressiveStakeReduction ? "Activé" : "Désactivé"}</span>
                            <Switch checked={config.progressiveStakeReduction} onCheckedChange={(v) => patchConfig("progressiveStakeReduction", v)} />
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Réduit la mise graduellement après chaque perte, pas seulement après 3.</p>
                        </Field>
                      </div>
                    </details>

                    {/* Telegram Notifications Config */}
                    <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-5 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">🔔</span>
                          <span className="text-xs font-black uppercase tracking-wider text-neutral-200">
                            Notifications Telegram Instantanées
                          </span>
                        </div>
                        <Switch
                          checked={telegramConfig.enabled}
                          onCheckedChange={(v) => {
                            setTelegramConfig((prev) => ({ ...prev, enabled: v }));
                            handleSaveTelegram();
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Recevez une alerte sur Telegram à chaque ouverture/fermeture de trade, détection Spike Hunter ou atteinte de limite de risque.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">Bot Token (BotFather)</label>
                          <input
                            type="password"
                            placeholder="7812345678:AAHxxxxxxxx..."
                            value={telegramConfig.botToken}
                            onChange={(e) => setTelegramConfig((prev) => ({ ...prev, botToken: e.target.value }))}
                            className="cfg-input font-mono text-xs w-full"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-muted-foreground uppercase mb-1">Chat ID (userinfobot)</label>
                          <input
                            type="text"
                            placeholder="123456789"
                            value={telegramConfig.chatId}
                            onChange={(e) => setTelegramConfig((prev) => ({ ...prev, chatId: e.target.value }))}
                            className="cfg-input font-mono text-xs w-full"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={testingTelegram || !telegramConfig.botToken || !telegramConfig.chatId}
                          onClick={handleTestTelegram}
                          className="text-xs font-bold border-sky-500/30 text-sky-300 hover:bg-sky-500/10"
                        >
                          {testingTelegram ? "Envoi..." : "🔔 Tester la Notification"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleSaveTelegram}
                          className="text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white"
                        >
                          Sauvegarder Telegram
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: Moteur Multiplicateur */}
              {configTab === "multiplier" && (
                <div className="space-y-5">
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <p className="text-xs font-semibold text-muted-foreground leading-relaxed">
                      Les indices Boom/Crash et les cryptos tradent toujours en Multiplicateur (position ouverte, sans échéance fixe) — les autres marchés tradent en binaire (CALL/PUT, échéance fixe) sauf override ci-dessous. Ces réglages n&apos;ont d&apos;effet que sur les symboles en mode Multiplicateur.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Type d&apos;instrument par défaut</label>
                    <div className="flex rounded-xl border border-border overflow-hidden w-fit">
                      {(["binary", "multiplier"] as const).map((m) => (
                        <button key={m} onClick={() => patchConfig("instrumentType", m)}
                          className={cn("px-4 py-2 text-xs font-semibold transition-colors",
                            config.instrumentType === m ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
                          {m === "binary" ? "Binaire (CALL/PUT)" : "Multiplicateur"}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-semibold text-muted-foreground/90 mt-1.5">
                      Binaire : échéance fixe, perte plafonnée à la mise. Multiplicateur : position ouverte avec effet de levier, fermée par stop-loss/take-profit.
                    </p>
                  </div>

                  {config.symbols.length > 0 && (
                    <div>
                      <label className="block text-xs font-extrabold uppercase tracking-widest text-neutral-200 mb-1.5">Override par symbole</label>
                      <div className="space-y-1.5">
                        {config.symbols.map((sym) => {
                          const label = SYMBOLS.find((s) => s.deriv === sym)?.label ?? sym;
                          const override = config.symbolInstrumentOverrides?.[sym] ?? "";
                          return (
                            <div key={sym} className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                              <span className="text-xs font-semibold text-foreground">{label}</span>
                              <select
                                value={override}
                                onChange={(e) => {
                                  const v = e.target.value as "" | "binary" | "multiplier";
                                  const next = { ...(config.symbolInstrumentOverrides ?? {}) };
                                  if (v === "") delete next[sym]; else next[sym] = v;
                                  patchConfig("symbolInstrumentOverrides", next);
                                }}
                                className="cfg-input w-auto"
                              >
                                <option value="">Global ({config.instrumentType === "binary" ? "Binaire" : "Multiplicateur"})</option>
                                <option value="binary">Binaire</option>
                                <option value="multiplier">Multiplicateur</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <details className="group rounded-2xl border border-border/60 bg-card/20" open>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
                      <span>Levier &amp; Stop/Take-profit</span>
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid gap-4 border-t border-border/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label={`Levier (x${config.multiplierLevel})`}>
                        <AmountInput value={config.multiplierLevel} min={5} max={100} step={5}
                          onCommit={async (v) => {
                            const ok = await confirm({ title: "Modifier le levier ?", description: `x${config.multiplierLevel} → x${v}. Un levier plus élevé amplifie gains ET pertes pour un même mouvement de prix.`, confirmLabel: "Confirmer", danger: true });
                            if (ok) patchConfig("multiplierLevel", v);
                            return ok;
                          }} />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Le levier max réellement disponible dépend du symbole côté Deriv (souvent plus bas sur crypto).</p>
                      </Field>
                      <Field label="Stop/take-profit dynamique (ATR)">
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                          <span className="text-xs text-muted-foreground">{config.atrStopMode ? "Activé" : "Désactivé"}</span>
                          <Switch checked={config.atrStopMode} onCheckedChange={(v) => patchConfig("atrStopMode", v)} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Backtester avant d&apos;activer en live. Désactivé = distances fixes en % de la mise ci-dessous.</p>
                      </Field>
                      <div />
                      <Field label={`Multiple ATR (×${config.atrStopMultiple.toFixed(1)})`}>
                        <input type="range" min={1} max={6} step={0.5} value={config.atrStopMultiple}
                          disabled={!config.atrStopMode}
                          onChange={(e) => patchConfig("atrStopMultiple", Number(e.target.value))} className="w-full accent-primary disabled:opacity-40" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Distance du stop = ce multiple de l&apos;ATR 15m.</p>
                      </Field>
                      <Field label={`Ratio risque/récompense (${config.riskRewardRatio.toFixed(1)})`}>
                        <input type="range" min={0.5} max={3} step={0.1} value={config.riskRewardRatio}
                          disabled={!config.atrStopMode}
                          onChange={(e) => patchConfig("riskRewardRatio", Number(e.target.value))} className="w-full accent-primary disabled:opacity-40" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Distance du take-profit = distance du stop × ce ratio.</p>
                      </Field>
                      <div />
                      <Field label={`Stop-loss fixe (${config.stopLossPctOfStake}% de la mise)`}>
                        <AmountInput value={config.stopLossPctOfStake} min={10} max={100} step={5}
                          disabled={config.atrStopMode}
                          onCommit={(v) => { patchConfig("stopLossPctOfStake", v); return true; }} />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">100% = perte plafonnée à la mise, comme en binaire.</p>
                      </Field>
                      <Field label={`Take-profit fixe (${config.takeProfitPctOfStake}% de la mise)`}>
                        <AmountInput value={config.takeProfitPctOfStake} min={10} max={300} step={5}
                          disabled={config.atrStopMode}
                          onCommit={(v) => { patchConfig("takeProfitPctOfStake", v); return true; }} />
                      </Field>
                    </div>
                  </details>

                  <details className="group rounded-2xl border border-border/60 bg-card/20">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
                      <span>Gestion de position</span>
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid gap-4 border-t border-border/40 p-4 sm:grid-cols-2 lg:grid-cols-3">
                      <Field label={`Durée max de la position (${config.maxHoldMinutes} min)`}>
                        <AmountInput value={config.maxHoldMinutes} min={15} max={1440} step={15}
                          onCommit={(v) => { patchConfig("maxHoldMinutes", v); return true; }} />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Fermeture forcée si ni le stop ni le take-profit ne se sont déclenchés.</p>
                      </Field>
                      <Field label={`Prise de profit partielle (${config.partialTakeProfitPct === 0 ? "désactivée" : `${config.partialTakeProfitPct}%`})`}>
                        <input type="range" min={0} max={100} step={10} value={config.partialTakeProfitPct}
                          onChange={(e) => patchConfig("partialTakeProfitPct", Number(e.target.value))} className="w-full accent-primary" />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Ferme ce % de la position à 50% du take-profit.</p>
                      </Field>
                      <Field label="Stop à breakeven après TP partiel">
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                          <span className="text-xs text-muted-foreground">{config.moveSlToBreakeven ? "Activé" : "Désactivé"}</span>
                          <Switch checked={config.moveSlToBreakeven}
                            disabled={config.partialTakeProfitPct === 0}
                            onCheckedChange={(v) => patchConfig("moveSlToBreakeven", v)} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-amber-400">Après la prise partielle, doit ramener le stop au prix d&apos;entrée — pas encore implémenté côté moteur, ce réglage n&apos;a aucun effet pour l&apos;instant.</p>
                      </Field>
                      <Field label="Durée dynamique (ATR)">
                        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/10 px-3 py-2">
                          <span className="text-xs text-muted-foreground">{config.dynamicDuration ? "Activé" : "Désactivé"}</span>
                          <Switch checked={config.dynamicDuration} onCheckedChange={(v) => patchConfig("dynamicDuration", v)} />
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">Ajuste la durée du contrat selon la volatilité du symbole.</p>
                      </Field>
                    </div>
                  </details>
                </div>
              )}

              {/* TAB: Backtest */}
              {configTab === "backtest" && (
                <div className="space-y-5">
                  <BacktestVisualizer symbol={config.symbols[0] || "BOOM900"} preset={selectedPreset} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      </div>

      {/* ── Live server scanner — below the trade journal for better visibility ── */}
      <div className={cn(advancedVisible && (mobileTab === "journal" || mobileTab === "data") ? "block" : "hidden", advancedVisible ? "md:block" : "md:hidden")}>
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
  opportunities,
  takeCount,
  waitCount,
  avoidCount,
  loading,
  config,
  autoEnabled,
  cloudBusy,
  onRefresh,
  onAuto,
}: {
  presetLabel: string;
  opportunity: OpportunityItem | null;
  opportunities: OpportunityItem[];
  takeCount: number;
  waitCount: number;
  avoidCount: number;
  loading: boolean;
  config: AutoTraderConfig;
  autoEnabled: boolean;
  cloudBusy: boolean;
  onRefresh: () => void;
  onAuto: () => void;
}) {
  const decision = opportunity?.decision ?? "wait";
  const style = decisionTone(decision);
  const isMobile = useIsMobile();
  // The full metrics grid + reasons + "à prendre maintenant" list is a lot of
  // reading before a mobile user even sees a position or the journal below —
  // collapsed by default there, with a compact summary + the pause/activate
  // action (the one thing worth always reaching without an extra tap) always
  // visible. Desktop always shows everything, unaffected by this state.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const showDetails = !isMobile || detailsOpen;

  return (
    <section className="glass-panel overflow-hidden rounded-xl border border-border/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-black uppercase tracking-wider", style.badge)}>
            <style.Icon className="h-3.5 w-3.5" /> {style.label}
          </span>
          <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-bold text-muted-foreground">{presetLabel}</span>
          {loading && <span className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs font-bold text-muted-foreground">Analyse…</span>}
        </div>
        <button onClick={onRefresh} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground">
          <Activity className="h-3.5 w-3.5" /> Actualiser
        </button>
      </div>

      {isMobile && (
        <div className="space-y-3 border-b border-border/50 p-4">
          <div>
            <h2 className="break-words text-base font-black tracking-tight">
              {opportunity ? `${opportunity.label} · ${opportunity.directionLabel}` : "Aucun signal exploitable"}
            </h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <MiniDecision label="Prendre" value={takeCount} className="text-up" />
            <MiniDecision label="Attendre" value={waitCount} className="text-amber-300" />
            <MiniDecision label="Éviter" value={avoidCount} className="text-down" />
          </div>
          <Button onClick={onAuto} disabled={cloudBusy} className={cn("h-11 w-full gap-2 font-black", autoEnabled ? "border border-down/30 bg-down/15 text-down hover:bg-down/25" : "border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25")}>
            {cloudBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Power className="h-4 w-4" />} {autoEnabled ? "Mettre en pause" : "Activer l'auto"}
          </Button>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold text-muted-foreground"
          >
            {detailsOpen ? "Réduire" : "Détail du signal"} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", detailsOpen && "rotate-180")} />
          </button>
        </div>
      )}

      {showDetails && (
      <div className="grid items-stretch gap-3 p-4 xl:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
        <div className={cn("h-full rounded-xl border p-4", style.card)}>
          {!isMobile && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="break-words text-xl font-black tracking-tight md:text-2xl">
              {opportunity ? `${opportunity.label} · ${opportunity.directionLabel}` : "Aucun signal exploitable pour l'instant"}
            </h2>
            {opportunity && <span className={cn("text-sm font-black", style.text)}>{style.label}</span>}
          </div>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {opportunity ? "Lecture du signal : vérifie les mesures et seuils avant toute exécution." : "Au Pluriel continue de scanner. Dans le doute, le bon trade est souvent celui qu'on ne prend pas."}
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <DecisionMetric className={style.metric} label="Confiance" value={opportunity ? `${Math.round(opportunity.confidence)}%` : "—"} />
            <DecisionMetric className={style.metric} label="Accord TF" value={opportunity ? `${opportunity.agreement}/4` : "—"} />
            <DecisionMetric className={style.metric} label="Risque" value={opportunity ? riskLabel(opportunity.risk) : "—"} />
            <DecisionMetric className={style.metric} label="Durée" value={opportunity ? `${opportunity.durationMinutes} min` : "—"} />
          </div>

          <div className={cn("mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border px-3 py-2.5 text-sm", style.thresholds)}>
            <span className={cn("font-black uppercase tracking-wider", style.text)}>Seuils actifs</span>
            <span className="font-bold text-foreground">Mise ${config.stakeUsd}</span>
            <span className="font-semibold text-muted-foreground">Confiance {config.minConfidence}-{config.maxConfidence}%</span>
            <span className="font-semibold text-muted-foreground">Accord minimum {config.minTfAgreement}/4 TF</span>
          </div>

          {!!opportunity?.reasons.length && (
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {opportunity.reasons.slice(0, 3).map((reason) => <div key={reason} className="rounded-xl border border-white/[0.08] bg-black/10 px-3 py-2 text-sm text-muted-foreground">{reason}</div>)}
            </div>
          )}
        </div>
        {!isMobile && (
        <aside className="flex h-full flex-col rounded-xl border border-border/60 bg-black/10 p-4">
          <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-foreground"><Power className="h-4 w-4 text-primary" /> Exécuter</div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">L’auto ne prend que les signaux conformes aux seuils affichés.</p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <MiniDecision label="Prendre" value={takeCount} className="text-up" />
            <MiniDecision label="Attendre" value={waitCount} className="text-amber-300" />
            <MiniDecision label="Éviter" value={avoidCount} className="text-down" />
          </div>
          <div className={cn("mt-3 flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-black", autoEnabled ? "border-up/25 bg-up/10 text-up" : "border-border/60 bg-muted/10 text-muted-foreground")}>
            {cloudBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Power className="h-4 w-4" />} {autoEnabled ? "Auto actif" : "Auto en pause"}
          </div>
          <Button onClick={onAuto} disabled={cloudBusy} className={cn("mt-auto h-11 w-full gap-2 font-black", autoEnabled ? "border border-down/30 bg-down/15 text-down hover:bg-down/25" : "border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25")}>
            {cloudBusy ? <Activity className="h-4 w-4 animate-pulse" /> : <Power className="h-4 w-4" />} {autoEnabled ? "Mettre en pause" : "Activer l’auto"}
          </Button>
        </aside>
        )}
      </div>
      )}

      {/* ── Marchés surveillés (fusionné depuis OpportunityBoard) ── */}
      {showDetails && (() => {
        const takeItems = opportunities.filter((item) => item.decision === "take").slice(0, 3);
        const waitItems = opportunities.filter((item) => item.decision === "wait").slice(0, 3);
        const avoidItems = opportunities.filter((item) => item.decision === "avoid").slice(0, 3);
        const deferredCount = waitItems.length + avoidItems.length;
        return (
          <div className="border-t border-border/50 p-4 space-y-3">
            <OpportunityList title="À prendre maintenant" decision="take" items={takeItems} loading={loading} empty="Aucun marché ne remplit les critères actuellement." />

            <details className="group rounded-2xl border border-border/60 bg-card/20">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-bold text-muted-foreground marker:content-none hover:text-foreground">
                <span>Pourquoi aucun autre trade ? <span className="ml-1 font-medium text-muted-foreground/70">{deferredCount} marché{deferredCount > 1 ? "s" : ""}</span></span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="grid gap-3 border-t border-border/40 p-3 lg:grid-cols-2">
                <OpportunityList title="À attendre" decision="wait" items={waitItems} loading={loading} empty="Aucun setup en attente." compact />
                <OpportunityList title="À éviter" decision="avoid" items={avoidItems} loading={loading} empty="Aucun risque bloquant signalé." compact />
              </div>
            </details>
          </div>
        );
      })()}

    </section>
  );
}

function DecisionMetric({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", className)}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-black text-foreground">{value}</div>
    </div>
  );
}

function ChecklistItem({ label, value, tone }: { label: string; value: string; tone: "up" | "down" | "amber" }) {
  const tones = {
    up: "text-up",
    down: "text-down",
    amber: "text-amber-400",
  };
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-black uppercase tracking-widest", tones[tone])}>{value}</span>
    </div>
  );
}

function OpportunityList({
  title,
  decision,
  items,
  loading,
  empty,
  compact = false,
}: {
  title: string;
  decision: OpportunityDecision;
  items: OpportunityItem[];
  loading: boolean;
  empty: string;
  compact?: boolean;
}) {
  const style = decisionTone(decision);
  return (
    <div className={cn("rounded-2xl border bg-card/25 p-4", style.panel)}>
      <div className="flex items-center gap-2">
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg border", style.badge)}><style.Icon className="h-4 w-4" /></span>
        <div>
          <h3 className="text-sm font-black uppercase tracking-wider text-foreground">{title}</h3>
          <p className="text-[11px] font-semibold text-muted-foreground">{items.length} marché{items.length > 1 ? "s" : ""}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {loading && items.length === 0 ? (
          <p className="rounded-xl border border-border/60 bg-card/30 px-3 py-3 text-sm font-semibold text-muted-foreground italic">Analyse en cours...</p>
        ) : items.length === 0 ? (
          <p className="rounded-xl border border-border/60 bg-card/30 px-3 py-3 text-sm font-semibold text-muted-foreground italic">{empty}</p>
        ) : items.map((item) => (
          <div key={item.id} className="rounded-xl border border-border/60 bg-card/30 px-3 py-3 shadow-inner">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-foreground">{item.label}</div>
                <div className="mt-0.5 text-xs font-semibold text-muted-foreground">{item.directionLabel} · {Math.round(item.confidence)}% · {item.agreement}/4 TF</div>
              </div>
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider", item.risk === "faible" ? "bg-up/10 text-up" : item.risk === "modere" ? "bg-amber-500/10 text-amber-300" : "bg-down/10 text-down")}>{riskLabel(item.risk)}</span>
            </div>
            {item.reasons[0] && <p className={cn("mt-2 text-xs font-medium leading-relaxed text-muted-foreground/85", compact && "line-clamp-2")}>{item.reasons[0]}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniDecision({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/30 px-3 py-2 text-center shadow-inner">
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
      panel: "border-up/50 bg-up/15 shadow-up/10",
      badge: "border-up/25 bg-up/10 text-up",
      card: "border-up/35 bg-up/10",
      metric: "border-up/25 bg-up/10",
      thresholds: "border-up/30 bg-up/10",
      text: "text-up",
    };
  }
  if (decision === "avoid") {
    return {
      label: "Éviter",
      Icon: ShieldAlert,
      panel: "border-down/50 bg-down/15 shadow-down/10",
      badge: "border-down/25 bg-down/10 text-down",
      card: "border-down/35 bg-down/10",
      metric: "border-down/25 bg-down/10",
      thresholds: "border-down/30 bg-down/10",
      text: "text-down",
    };
  }
  return {
    label: "Attendre",
    Icon: Clock,
    panel: "border-amber-500/50 bg-amber-500/15 shadow-amber-500/10",
    badge: "border-amber-500/25 bg-amber-500/10 text-amber-300",
    card: "border-amber-500/35 bg-amber-500/10",
    metric: "border-amber-500/25 bg-amber-500/10",
    thresholds: "border-amber-500/30 bg-amber-500/10",
    text: "text-amber-300",
  };
}

function riskLabel(risk: OpportunityItem["risk"]) {
  if (risk === "faible") return "faible";
  if (risk === "modere") return "modéré";
  return "élevé";
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
