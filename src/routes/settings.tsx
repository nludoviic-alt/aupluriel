import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Bell,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Loader2,
  LogOut,
  ShieldAlert,
  Sliders,
  UserCircle,
  Wifi,
  WifiOff,
  Sparkles,
  ArrowUpRight,
  Send,
  Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { api, clearToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { loadDefaultStake, saveDefaultStake } from "@/lib/stake";
import { AutoBacktestStatus } from "@/components/auto-backtest-status";
import { getExistingPushSubscription, isIosNonSafari, isIosNonStandalone, isPushSupported, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { AvatarPicker } from "@/components/avatar-picker";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Au Pluriel" }] }),
  component: SettingsPage,
});

const KEYS = {
  token: "lio23.deriv_token",
  account: "lio23.account_type",
  riskPerTrade: "lio23.risk_per_trade",
  maxDrawdown: "lio23.max_drawdown",
};

type CategoryTab = "all" | "brokers" | "risk" | "automation" | "notifications";

export function SettingsPage() {
  const { user, refresh: refreshAuth } = useAuth();
  const [activeTab, setActiveTab] = useState<CategoryTab>("all");
  
  const [avatar, setAvatar] = useState(user?.avatar ?? "");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState<"online" | "offline">(user?.online_status ?? "online");
  const [statusSaving, setStatusSaving] = useState(false);

  // Deriv
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [account, setAccount] = useState<"demo" | "live">("demo");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ id?: string; balance?: number; currency?: string } | null>(null);

  // Risk & Stake
  const [risk, setRisk] = useState(2);
  const [maxDd, setMaxDd] = useState(5);
  const [stake, setStake] = useState(5);
  const [maxDailyLoss, setMaxDailyLoss] = useState(15);
  const [maxDailyLossSaving, setMaxDailyLossSaving] = useState(false);

  // Auto-Backtest
  const [autoBacktestEnabled, setAutoBacktestEnabled] = useState(false);
  const [autoBacktestSaving, setAutoBacktestSaving] = useState(false);

  // Push & Telegram
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [pushChecked, setPushChecked] = useState(false);
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramSaving, setTelegramSaving] = useState(false);

  // Kraken
  const [krakenKey, setKrakenKey] = useState("");
  const [krakenSecret, setKrakenSecret] = useState("");
  const [krakenShow, setKrakenShow] = useState(false);
  const [krakenLoading, setKrakenLoading] = useState(false);

  // Binance
  const [binanceKey, setBinanceKey] = useState("");
  const [binanceSecret, setBinanceSecret] = useState("");
  const [binanceShow, setBinanceShow] = useState(false);
  const [binanceLoading, setBinanceLoading] = useState(false);

  // OANDA
  const [oandaKey, setOandaKey] = useState("");
  const [oandaAccountId, setOandaAccountId] = useState("");
  const [oandaPractice, setOandaPractice] = useState(true);
  const [oandaShow, setOandaShow] = useState(false);
  const [oandaLoading, setOandaLoading] = useState(false);

  // Broker Toggles
  const [enableDeriv, setEnableDeriv] = useState(true);
  const [enableKraken, setEnableKraken] = useState(true);
  const [enableBinance, setEnableBinance] = useState(true);
  const [enableOanda, setEnableOanda] = useState(true);

  const { confirmState, confirm } = useConfirm();

  useEffect(() => {
    if (typeof window === "undefined") return;
    setToken(localStorage.getItem(KEYS.token) ?? "");
    setAccount((localStorage.getItem(KEYS.account) as "demo" | "live") ?? "demo");
    setRisk(Number(localStorage.getItem(KEYS.riskPerTrade) ?? 2));
    setMaxDd(Number(localStorage.getItem(KEYS.maxDrawdown) ?? 5));
    setStake(loadDefaultStake());

    api.get<Record<string, unknown>>("/api/settings").then((s) => {
      if (s.deriv_token) setToken(s.deriv_token as string);
      if (s.account_type) setAccount(s.account_type as "demo" | "live");
      if (s.risk_per_trade) setRisk(s.risk_per_trade as number);
      if (s.max_drawdown) setMaxDd(s.max_drawdown as number);
      if (s.default_stake_usd) { setStake(s.default_stake_usd as number); saveDefaultStake(s.default_stake_usd as number); }
      if (s.avatar) setAvatar(s.avatar as string);
      if (s.online_status) setOnlineStatus(s.online_status as "online" | "offline");
      if (s.kraken_api_key) setKrakenKey(s.kraken_api_key as string);
      if (s.kraken_api_secret) setKrakenSecret(s.kraken_api_secret as string);
      if (s.binance_api_key) setBinanceKey(s.binance_api_key as string);
      if (s.binance_api_secret) setBinanceSecret(s.binance_api_secret as string);
      if (s.oanda_api_key) setOandaKey(s.oanda_api_key as string);
      if (s.oanda_account_id) setOandaAccountId(s.oanda_account_id as string);
      if (s.oanda_is_practice !== undefined) setOandaPractice(!!s.oanda_is_practice);
      
      if (s.bot_config) {
        try {
          const cfg = typeof s.bot_config === "string" ? JSON.parse(s.bot_config) : s.bot_config;
          if (cfg.enableDeriv !== undefined) setEnableDeriv(cfg.enableDeriv);
          if (cfg.enableKraken !== undefined) setEnableKraken(cfg.enableKraken);
          if (cfg.enableBinance !== undefined) setEnableBinance(cfg.enableBinance);
          if (cfg.enableOanda !== undefined) setEnableOanda(cfg.enableOanda);
          // maxDailyLossUsd is NOT read from here — see the /api/bot fetch
          // below, which is the value the bot actually runs with.
        } catch { /* ignore */ }
      }
      setAutoBacktestEnabled(!!s.auto_backtest_enabled);
    }).catch(() => {});

    // Perte Max Jour must show what the Default preset's bot actually runs
    // with (same source as the Dashboard's "Quota risque du jour" card) —
    // not a separate value from /api/settings that was never wired to the
    // live engine, which is what made this field look "unsynced".
    api.get<{ presets?: Record<string, { savedConfig?: { maxDailyLossUsd?: number } }> }>("/api/bot").then((res) => {
      const live = res.presets?.default?.savedConfig?.maxDailyLossUsd;
      if (live !== undefined) setMaxDailyLoss(live);
    }).catch(() => {});

    api.get<{ config?: { botToken?: string } }>("/api/telegram").then((res) => {
      if (res.config?.botToken) setTelegramToken(res.config.botToken);
    }).catch(() => {});

    getExistingPushSubscription()
      .then((sub) => setPushEnabled(!!sub))
      .catch(() => {})
      .finally(() => setPushChecked(true));
  }, []);

  useEffect(() => {
    if (user?.avatar) setAvatar(user.avatar);
    if (user?.online_status) setOnlineStatus(user.online_status as "online" | "offline");
  }, [user]);

  async function handleAvatarSelect(newAvatar: string) {
    setAvatar(newAvatar);
    setAvatarSaving(true);
    try {
      await api.put("/api/settings", { avatar: newAvatar });
      await refreshAuth();
      toast.success("Avatar mis à jour avec succès");
    } catch {
      toast.error("Échec de la mise à jour de l'avatar");
    } finally {
      setAvatarSaving(false);
    }
  }

  async function toggleStatus(v: boolean) {
    const newStatus = v ? "online" : "offline";
    setOnlineStatus(newStatus);
    setStatusSaving(true);
    try {
      await api.put("/api/settings", { online_status: newStatus });
      await refreshAuth();
      toast.success(v ? "Vous êtes maintenant en ligne" : "Vous êtes maintenant hors ligne");
    } catch {
      setOnlineStatus(onlineStatus);
      toast.error("Échec de la mise à jour du statut");
    } finally {
      setStatusSaving(false);
    }
  }

  async function togglePush(v: boolean) {
    setPushSaving(true);
    try {
      if (v) {
        await subscribeToPush();
        toast.success("Notifications push activées");
      } else {
        await unsubscribeFromPush();
        toast.info("Notifications push désactivées");
      }
      setPushEnabled(v);
    } catch (e) {
      toast.error((e as Error).message || "Échec de l'activation des notifications");
    } finally {
      setPushSaving(false);
    }
  }

  async function toggleAutoBacktest(v: boolean) {
    setAutoBacktestSaving(true);
    setAutoBacktestEnabled(v);
    try {
      await api.put("/api/settings", { auto_backtest_enabled: v });
      toast.success(v ? "Backtest automatique activé" : "Backtest automatique désactivé");
    } catch {
      setAutoBacktestEnabled(!v);
      toast.error("Échec de l'enregistrement");
    } finally {
      setAutoBacktestSaving(false);
    }
  }

  async function saveKraken() {
    setKrakenLoading(true);
    try {
      await api.put("/api/settings", {
        kraken_api_key: krakenKey || null,
        kraken_api_secret: krakenSecret || null,
      });
      toast.success("Clés API Kraken enregistrées");
    } catch {
      toast.error("Échec de l'enregistrement Kraken");
    } finally {
      setKrakenLoading(false);
    }
  }

  async function saveBinance() {
    setBinanceLoading(true);
    try {
      await api.put("/api/settings", {
        binance_api_key: binanceKey || null,
        binance_api_secret: binanceSecret || null,
      });
      toast.success("Clés API Binance enregistrées");
    } catch {
      toast.error("Échec de l'enregistrement Binance");
    } finally {
      setBinanceLoading(false);
    }
  }

  async function saveOanda() {
    setOandaLoading(true);
    try {
      await api.put("/api/settings", {
        oanda_api_key: oandaKey || null,
        oanda_account_id: oandaAccountId || null,
        oanda_is_practice: oandaPractice,
      });
      toast.success("Configuration OANDA enregistrée");
    } catch {
      toast.error("Échec de l'enregistrement OANDA");
    } finally {
      setOandaLoading(false);
    }
  }

  async function saveTelegramToken() {
    if (!telegramToken) return;
    setTelegramSaving(true);
    try {
      await api.post("/api/telegram", { action: "save", config: { botToken: telegramToken, enabled: true } });
      toast.success("Token Telegram enregistré");
    } catch {
      toast.error("Échec de l'enregistrement Telegram");
    } finally {
      setTelegramSaving(false);
    }
  }

  async function toggleBroker(broker: "enableDeriv" | "enableKraken" | "enableBinance" | "enableOanda", value: boolean) {
    if (broker === "enableDeriv") setEnableDeriv(value);
    if (broker === "enableKraken") setEnableKraken(value);
    if (broker === "enableBinance") setEnableBinance(value);
    if (broker === "enableOanda") setEnableOanda(value);
    try {
      await api.put("/api/settings", { [broker]: value });
      toast.success("Statut du broker mis à jour");
    } catch {
      if (broker === "enableDeriv") setEnableDeriv(!value);
      if (broker === "enableKraken") setEnableKraken(!value);
      if (broker === "enableBinance") setEnableBinance(!value);
      if (broker === "enableOanda") setEnableOanda(!value);
      toast.error("Échec de la mise à jour du broker");
    }
  }

  const [savingAll, setSavingAll] = useState(false);

  async function saveAllSettings() {
    setSavingAll(true);
    localStorage.setItem(KEYS.token, token);
    localStorage.setItem(KEYS.account, account);
    localStorage.setItem(KEYS.riskPerTrade, String(risk));
    localStorage.setItem(KEYS.maxDrawdown, String(maxDd));
    saveDefaultStake(stake);

    try {
      await api.put("/api/settings", {
        deriv_token: token || null,
        account_type: account,
        risk_per_trade: risk,
        max_drawdown: maxDd,
        default_stake_usd: stake,
        maxDailyLossUsd: maxDailyLoss,
        kraken_api_key: krakenKey || null,
        kraken_api_secret: krakenSecret || null,
        binance_api_key: binanceKey || null,
        binance_api_secret: binanceSecret || null,
        oanda_api_key: oandaKey || null,
        oanda_account_id: oandaAccountId || null,
        oanda_is_practice: oandaPractice,
        enableDeriv,
        enableKraken,
        enableBinance,
        enableOanda,
        auto_backtest_enabled: autoBacktestEnabled,
      });

      if (telegramToken) {
        await api.post("/api/telegram", {
          action: "save",
          config: { botToken: telegramToken, enabled: true },
        });
      }

      // Push to the live Default preset config — /api/settings above only
      // wrote to a separate field the bot never reads, which is why this
      // field could show one number here while the Dashboard's "Quota
      // risque du jour" (same value, read from bot_state) showed another.
      // Scoped to Default only: Boom/Crash keep their own tuned caps.
      try {
        await api.post("/api/bot", { action: "update", preset: "default", config: { maxDailyLossUsd: maxDailyLoss } });
      } catch { /* non-fatal — the rest of settings still saved */ }

      // Sync local storage autotrader config drafts so Auto-Trader HUD immediately sees the new daily loss limit & stake
      const presetsList = ["default", "boom", "crash", "scalping", "liquidity", "gold"];
      for (const p of presetsList) {
        const pKey = `lio23.autotrader_config.${p}`;
        try {
          const existing = JSON.parse(localStorage.getItem(pKey) ?? "{}");
          existing.maxDailyLossUsd = maxDailyLoss;
          existing.stakeUsd = stake;
          localStorage.setItem(pKey, JSON.stringify(existing));
        } catch {}
      }
      try {
        const globalCfg = JSON.parse(localStorage.getItem("lio23.autotrader_config") ?? "{}");
        globalCfg.maxDailyLossUsd = maxDailyLoss;
        globalCfg.stakeUsd = stake;
        localStorage.setItem("lio23.autotrader_config", JSON.stringify(globalCfg));
      } catch {}

      toast.success("Toutes les modifications ont été enregistrées !");
    } catch {
      toast.error("Échec de l'enregistrement de certaines modifications");
    } finally {
      setSavingAll(false);
    }
  }

  async function testConnection() {
    if (!token) {
      toast.error("Veuillez d'abord saisir un token API Deriv");
      return;
    }
    setLoading(true);
    try {
      await saveAllSettings();
      const res = await api.post<{
        wsUrl?: string;
        loginId?: string;
        balance?: number;
        currency?: string;
        accountType?: string;
        error?: string;
      }>("/api/deriv-session", { token, account_type: account });
      if (res.error || !res.wsUrl) throw new Error(res.error ?? "Connexion échouée");
      setInfo({ id: res.loginId, balance: res.balance, currency: res.currency });
      toast.success(`Connecté à Deriv: ${res.loginId} (${res.accountType})`);
    } catch (e) {
      toast.error(`Échec: ${(e as Error).message}`);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  const showTab = (tab: CategoryTab) => activeTab === "all" || activeTab === tab;

  return (
    <div className="p-4 sm:p-6 md:p-10 space-y-8 max-w-[1440px] mx-auto pb-16 text-foreground">
      {/* HEADER PANEL */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-neutral-900/90 via-neutral-950/80 to-neutral-900/90 p-6 md:p-8 backdrop-blur-xl shadow-2xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-12 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center p-2.5 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Sliders className="h-6 w-6" />
              </span>
              <div>
                <h1 className="text-2xl md:text-3xl font-black tracking-tight bg-gradient-to-r from-white via-neutral-100 to-neutral-400 bg-clip-text text-transparent">
                  Paramètres & Configuration
                </h1>
                <p className="text-xs md:text-sm text-neutral-400">
                  Gérez vos clés API brokers, vos limites de risque et vos préférences de notification.
                </p>
              </div>
            </div>
          </div>

          {/* User Quick Info & Logout */}
          <div className="flex items-center gap-4 bg-white/[0.03] border border-white/10 p-2.5 pl-4 rounded-2xl backdrop-blur-md">
            <div className="flex items-center gap-3">
              <div className="relative">
                {avatar ? (
                  <img src={avatar} alt="User Avatar" className="w-10 h-10 rounded-full object-cover border border-white/20" />
                ) : (
                  <UserCircle className="w-10 h-10 text-neutral-400" />
                )}
                <span className={cn(
                  "absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-neutral-950",
                  onlineStatus === "online" ? "bg-emerald-500" : "bg-neutral-500"
                )} />
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-xs font-bold text-neutral-200">{user?.email || "Utilisateur"}</div>
                <div className="text-[10px] text-neutral-400 capitalize">{user?.role || "Trader"}</div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { clearToken(); window.location.href = "/login"; }}
              className="text-red-400 hover:text-red-300 hover:bg-red-500/15 border border-red-500/20 rounded-xl text-xs h-9 px-3 transition-all"
            >
              <LogOut className="h-4 w-4 mr-1.5" /> Déconnexion
            </Button>
          </div>
        </div>

        {/* CATEGORY NAV TABS */}
        <div className="mt-8 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none border-t border-white/5 pt-6">
          {[
            { id: "all", label: "Toutes les cartes", icon: Layers },
            { id: "brokers", label: "Connecteurs Brokers", icon: KeyRound, badge: "4" },
            { id: "risk", label: "Gestion du Risque", icon: ShieldAlert },
            { id: "automation", label: "Automatisation", icon: Cpu },
            { id: "notifications", label: "Notifications", icon: Bell },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as CategoryTab)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-300 border",
                  isActive
                    ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                    : "bg-white/[0.02] border-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-white/[0.05]"
                )}
              >
                <Icon className={cn("h-4 w-4", isActive ? "text-cyan-400" : "text-neutral-400")} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span className={cn(
                    "px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold",
                    isActive ? "bg-cyan-500/30 text-cyan-200" : "bg-white/10 text-neutral-400"
                  )}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* GRID CONTENT SECTIONS */}
      {showTab("brokers") && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-violet-400">
              <KeyRound className="h-4 w-4" /> Connecteurs API Brokers
            </div>
            <span className="text-xs text-neutral-400">Multi-broker actif & prêt pour le trading</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* DERIV CARD */}
            <div className={cn(
              "relative rounded-2xl border transition-all duration-300 p-6 space-y-5 backdrop-blur-md",
              enableDeriv ? "border-red-500/30 bg-neutral-900/80 shadow-[0_0_25px_rgba(239,68,68,0.05)]" : "border-white/10 bg-neutral-950/40 opacity-75"
            )}>
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-red-500/15 text-red-400 border border-red-500/30">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">Deriv API</h3>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-red-500/20 text-red-300 border border-red-500/30">
                        Forex / Synthetics
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">Accès aux indices synthétiques, Forex & Multiplicateurs.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-400">Actif</span>
                  <Switch checked={enableDeriv} onCheckedChange={(v) => toggleBroker("enableDeriv", v)} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Token API Deriv</label>
                  <div className="relative">
                    <input
                      type={show ? "text" : "password"}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="ex: a1b2c3d4e5f6..."
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 pr-10 text-xs md:text-sm font-mono text-white focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShow((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Mode de Compte</label>
                  <div className="flex bg-black/50 p-1.5 rounded-xl border border-white/10 gap-2">
                    {(["demo", "live"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={async () => {
                          if (t === "live") {
                            const ok = await confirm({
                              title: "Passer en mode LIVE ?",
                              description: "Le mode LIVE engage de l'argent réel sur les transactions Deriv. Confirmez-vous le passage en mode réel ?",
                              confirmLabel: "Passer en LIVE",
                              danger: true,
                            });
                            if (!ok) return;
                          }
                          setAccount(t);
                        }}
                        className={cn(
                          "flex-1 py-2 text-xs uppercase tracking-wider font-bold rounded-lg transition-all text-center",
                          account === t
                            ? t === "demo"
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-sm"
                              : "bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse shadow-sm"
                            : "text-neutral-400 hover:text-white border border-transparent"
                        )}
                      >
                        {t === "demo" ? "🧪 Démo" : "🔥 Live (Réel)"}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={testConnection}
                  disabled={loading || !token}
                  className="w-full bg-gradient-to-r from-red-500/20 via-pink-500/20 to-red-500/20 hover:from-red-500/30 hover:to-pink-500/30 text-red-300 border border-red-500/40 font-bold h-10 text-xs rounded-xl shadow-md transition-all"
                >
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Tester & Enregistrer Deriv
                </Button>

                {info && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs space-y-1 font-mono">
                    <div className="font-bold text-emerald-400 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                      Connecté : {info.id}
                    </div>
                    {info.balance !== undefined && (
                      <div className="text-neutral-200">
                        Solde Disponible : <span className="font-bold text-white">{info.balance.toFixed(2)} {info.currency}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* KRAKEN CARD */}
            <div className={cn(
              "relative rounded-2xl border transition-all duration-300 p-6 space-y-5 backdrop-blur-md",
              enableKraken ? "border-violet-500/30 bg-neutral-900/80 shadow-[0_0_25px_rgba(139,92,246,0.05)]" : "border-white/10 bg-neutral-950/40 opacity-75"
            )}>
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-violet-500/15 text-violet-400 border border-violet-500/30">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">Kraken API</h3>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-violet-500/20 text-violet-300 border border-violet-500/30">
                        Crypto Spot
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">Crypto Spot (BTC, ETH). Stockage sécurisé serveur.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-400">Actif</span>
                  <Switch checked={enableKraken} onCheckedChange={(v) => toggleBroker("enableKraken", v)} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Clé API Kraken</label>
                  <input
                    type={krakenShow ? "text" : "password"}
                    value={krakenKey}
                    onChange={(e) => setKrakenKey(e.target.value)}
                    placeholder="ex: k1a2b3c4..."
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs md:text-sm font-mono text-white focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Secret API Kraken</label>
                  <div className="relative">
                    <input
                      type={krakenShow ? "text" : "password"}
                      value={krakenSecret}
                      onChange={(e) => setKrakenSecret(e.target.value)}
                      placeholder="ex: s5d6f7g8..."
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 pr-10 text-xs md:text-sm font-mono text-white focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/50 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setKrakenShow((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                    >
                      {krakenShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  onClick={saveKraken}
                  disabled={krakenLoading || (!krakenKey && !krakenSecret)}
                  className="w-full bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-violet-500/20 hover:from-violet-500/30 hover:to-fuchsia-500/30 text-violet-300 border border-violet-500/40 font-bold h-10 text-xs rounded-xl shadow-md transition-all"
                >
                  {krakenLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Enregistrer Kraken
                </Button>

                {krakenKey && (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-300 font-mono flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-violet-400" />
                    Clefs Kraken sauvegardées avec succès
                  </div>
                )}
              </div>
            </div>

            {/* BINANCE CARD */}
            <div className={cn(
              "relative rounded-2xl border transition-all duration-300 p-6 space-y-5 backdrop-blur-md",
              enableBinance ? "border-yellow-500/30 bg-neutral-900/80 shadow-[0_0_25px_rgba(234,179,8,0.05)]" : "border-white/10 bg-neutral-950/40 opacity-75"
            )}>
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">Binance API</h3>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
                        Crypto & P2P
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">Spot Trading & Mobile Money P2P (MTN, Orange).</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-400">Actif</span>
                  <Switch checked={enableBinance} onCheckedChange={(v) => toggleBroker("enableBinance", v)} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Clé API Binance</label>
                  <input
                    type={binanceShow ? "text" : "password"}
                    value={binanceKey}
                    onChange={(e) => setBinanceKey(e.target.value)}
                    placeholder="ex: b1a2c3d4..."
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs md:text-sm font-mono text-white focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Secret API Binance</label>
                  <div className="relative">
                    <input
                      type={binanceShow ? "text" : "password"}
                      value={binanceSecret}
                      onChange={(e) => setBinanceSecret(e.target.value)}
                      placeholder="ex: s5d6f7g8..."
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 pr-10 text-xs md:text-sm font-mono text-white focus:border-yellow-500/50 focus:ring-1 focus:ring-yellow-500/50 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setBinanceShow((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                    >
                      {binanceShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  onClick={saveBinance}
                  disabled={binanceLoading || (!binanceKey && !binanceSecret)}
                  className="w-full bg-gradient-to-r from-yellow-500/20 via-amber-500/20 to-yellow-500/20 hover:from-yellow-500/30 hover:to-amber-500/30 text-yellow-300 border border-yellow-500/40 font-bold h-10 text-xs rounded-xl shadow-md transition-all"
                >
                  {binanceLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Enregistrer Binance
                </Button>

                {binanceKey && (
                  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300 font-mono flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-yellow-400" />
                    Clefs Binance sauvegardées avec succès
                  </div>
                )}
              </div>
            </div>

            {/* OANDA CARD */}
            <div className={cn(
              "relative rounded-2xl border transition-all duration-300 p-6 space-y-5 backdrop-blur-md",
              enableOanda ? "border-emerald-500/30 bg-neutral-900/80 shadow-[0_0_25px_rgba(16,185,129,0.05)]" : "border-white/10 bg-neutral-950/40 opacity-75"
            )}>
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-white">OANDA API</h3>
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Forex Regulated
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mt-0.5">Forex Spot régulé IIROC / Canada. Practice ou Live.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-400">Actif</span>
                  <Switch checked={enableOanda} onCheckedChange={(v) => toggleBroker("enableOanda", v)} />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Clé API OANDA</label>
                  <input
                    type={oandaShow ? "text" : "password"}
                    value={oandaKey}
                    onChange={(e) => setOandaKey(e.target.value)}
                    placeholder="ex: o1a2b3c4..."
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs md:text-sm font-mono text-white focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">ID de Compte OANDA</label>
                  <div className="relative">
                    <input
                      type={oandaShow ? "text" : "password"}
                      value={oandaAccountId}
                      onChange={(e) => setOandaAccountId(e.target.value)}
                      placeholder="ex: 001-001-123456-001"
                      className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 pr-10 text-xs md:text-sm font-mono text-white focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 outline-none transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setOandaShow((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-white"
                    >
                      {oandaShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Environnement OANDA</label>
                  <div className="flex bg-black/50 p-1.5 rounded-xl border border-white/10 gap-2">
                    {[true, false].map((isPractice) => (
                      <button
                        key={String(isPractice)}
                        onClick={() => setOandaPractice(isPractice)}
                        className={cn(
                          "flex-1 py-1.5 text-xs uppercase tracking-wider font-bold rounded-lg transition-all text-center",
                          oandaPractice === isPractice
                            ? isPractice
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-red-500/20 text-red-400 border border-red-500/30"
                            : "text-neutral-400 hover:text-white border border-transparent"
                        )}
                      >
                        {isPractice ? "Practice (Démo)" : "Live (Réel)"}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={saveOanda}
                  disabled={oandaLoading || (!oandaKey && !oandaAccountId)}
                  className="w-full bg-gradient-to-r from-emerald-500/20 via-teal-500/20 to-emerald-500/20 hover:from-emerald-500/30 hover:to-teal-500/30 text-emerald-300 border border-emerald-500/40 font-bold h-10 text-xs rounded-xl shadow-md transition-all"
                >
                  {oandaLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Enregistrer OANDA
                </Button>

                {oandaKey && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 font-mono flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    Configuration OANDA sauvegardée ({oandaPractice ? "Practice" : "Live"})
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: GESTION DU RISQUE */}
      {showTab("risk") && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
            <ShieldAlert className="h-4 w-4" /> Paramètres de Risque & Management
          </div>

          <div className="rounded-2xl border border-amber-500/20 bg-neutral-900/80 p-6 backdrop-blur-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  Protection Automatique du Capital
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Appliqué en temps réel à chaque signal et transaction automatisée.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 shrink-0">
                Limites globales de sécurité
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
              {/* Stake */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Mise par défaut ($)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 font-mono text-sm">$</span>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    step={1}
                    value={stake}
                    onChange={(e) => setStake(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 pl-8 pr-3.5 py-2.5 text-sm font-mono text-white focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 outline-none"
                  />
                </div>
              </div>

              {/* Risk per trade */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Risque par Trade (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={0.1}
                    max={10}
                    step={0.1}
                    value={risk}
                    onChange={(e) => setRisk(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm font-mono text-white focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 outline-none"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 font-mono text-sm">%</span>
                </div>
              </div>

              {/* Max Drawdown */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Drawdown Max (%)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={maxDd}
                    onChange={(e) => setMaxDd(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-sm font-mono text-white focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 outline-none"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 font-mono text-sm">%</span>
                </div>
              </div>

              {/* Daily Max Loss */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Perte Max Jour ($)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400 font-mono text-sm">$</span>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    step={1}
                    value={maxDailyLoss}
                    onChange={(e) => setMaxDailyLoss(Number(e.target.value))}
                    className="w-full rounded-xl border border-white/10 bg-black/40 pl-8 pr-3.5 py-2.5 text-sm font-mono text-white focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 outline-none"
                  />
                </div>
              </div>
            </div>

            {risk > 2 && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300 font-medium flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-red-200">Avertissement sur le risque (Risque &gt; 2%)</div>
                  Un risque supérieur à 2% par position peut exposer votre capital à un risque de ruine accéléré en cas de série de pertes consécutives.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 4: AUTOMATISATION & BACKTEST */}
      {showTab("automation") && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
            <Cpu className="h-4 w-4" /> Pipeline & Auto-Backtest
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-neutral-900/80 p-6 backdrop-blur-md space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">
                  <FlaskConical className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Backtest Automatique Rétrospectif</h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Ré-évalue les stratégies toutes les 6 heures pour optimiser le win-rate.
                  </p>
                </div>
              </div>
              <Switch
                checked={autoBacktestEnabled}
                disabled={autoBacktestSaving}
                onCheckedChange={toggleAutoBacktest}
              />
            </div>

            {autoBacktestEnabled && (
              <div className="pt-2 border-t border-white/5">
                <AutoBacktestStatus />
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 5: NOTIFICATIONS */}
      {showTab("notifications") && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
            <Bell className="h-4 w-4" /> Centre de Notifications
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* PUSH NOTIFICATIONS */}
            <div className="rounded-2xl border border-white/10 bg-neutral-900/80 p-6 backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <Bell className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Push Navigateur</h3>
                    <p className="text-xs text-neutral-400">Alertes sur écran verrouillé.</p>
                  </div>
                </div>
              </div>

              {isIosNonSafari() ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-300 leading-relaxed">
                  Sur iPhone, utilisez <span className="font-bold text-white">Safari</span> pour enregistrer l'application sur l'écran d'accueil afin d'activer le push.
                </div>
              ) : !isPushSupported() ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 text-xs text-neutral-400">
                  Les notifications push ne sont pas supportées par votre navigateur.
                </div>
              ) : isIosNonStandalone() ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-300 leading-relaxed">
                  Sur iPhone, ajoutez Au Pluriel à l'écran d'accueil (Partager → « Sur l'écran d'accueil ») pour recevoir les alertes.
                </div>
              ) : (
                <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                  <div>
                    <div className="text-xs font-bold text-white">Recevoir les Push</div>
                    <div className="text-[11px] text-neutral-400">Clôture des trades & alertes risque</div>
                  </div>
                  <Switch
                    checked={pushEnabled}
                    disabled={pushSaving || !pushChecked}
                    onCheckedChange={togglePush}
                  />
                </div>
              )}
            </div>

            {/* TELEGRAM NOTIFICATIONS */}
            <div className="rounded-2xl border border-white/10 bg-neutral-900/80 p-6 backdrop-blur-md space-y-4">
              <div className="flex items-center justify-between border-b border-white/5 pb-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-sky-500/15 text-sky-400 border border-sky-500/30">
                    <Send className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Bot Telegram</h3>
                    <p className="text-xs text-neutral-400">Alertes Spike Hunter & Exécutions</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-neutral-300">Bot Token Telegram</label>
                  <input
                    type="password"
                    value={telegramToken}
                    onChange={(e) => setTelegramToken(e.target.value)}
                    placeholder="7812345678:AAHxxxxxxxx..."
                    className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-xs md:text-sm font-mono text-white focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/50 outline-none"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <Button
                    onClick={saveTelegramToken}
                    disabled={telegramSaving || !telegramToken}
                    className="bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-bold h-9 text-xs rounded-xl transition-all"
                  >
                    {telegramSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                    Enregistrer Token
                  </Button>

                  <Link to="/autotrader" className="text-xs font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1">
                    Auto-Trader <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* UNIFIED ACTION BAR (NORMAL FLOW) */}
      <div className="mt-8 rounded-2xl border border-white/10 bg-neutral-900/80 p-6 backdrop-blur-md">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-[11px] md:text-xs text-neutral-400 max-w-2xl text-center sm:text-left leading-relaxed">
            Avertissement : Au Pluriel est un outil d'analyse et d'exécution. Le trading comporte des risques majeurs de perte en capital.
          </p>

          <Button
            onClick={saveAllSettings}
            disabled={savingAll}
            className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-cyan-400 via-teal-400 to-violet-500 hover:opacity-90 text-neutral-950 font-black text-xs md:text-sm rounded-xl shadow-[0_0_25px_rgba(34,211,238,0.3)] transition-all duration-300 h-11 shrink-0"
          >
            {savingAll ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin text-neutral-950" /> Enregistrement...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> Enregistrer toutes les modifications
              </>
            )}
          </Button>
        </div>
      </div>

      <ConfirmDialog state={confirmState} />
    </div>
  );
}