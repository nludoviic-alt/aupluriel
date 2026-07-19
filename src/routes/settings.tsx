import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bell, CheckCircle2, Eye, EyeOff, FlaskConical, KeyRound, Loader2, LogOut, ShieldAlert, UserCircle, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { api, clearToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { loadDefaultStake, saveDefaultStake } from "@/lib/stake";
import { AutoBacktestStatus } from "@/components/auto-backtest-status";
import { CollapsibleSection } from "@/components/collapsible-section";
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

function SettingsPage() {
  const { user, refresh: refreshAuth } = useAuth();
  const [avatar, setAvatar] = useState(user?.avatar ?? "");
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [onlineStatus, setOnlineStatus] = useState<"online" | "offline">(user?.online_status ?? "online");
  const [statusSaving, setStatusSaving] = useState(false);
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [account, setAccount] = useState<"demo" | "live">("demo");
  const [risk, setRisk] = useState(2);
  const [maxDd, setMaxDd] = useState(5);
  const [stake, setStake] = useState(5);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ id?: string; balance?: number; currency?: string } | null>(null);
  const [autoBacktestEnabled, setAutoBacktestEnabled] = useState(false);
  const [autoBacktestSaving, setAutoBacktestSaving] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSaving, setPushSaving] = useState(false);
  const [pushChecked, setPushChecked] = useState(false);
  const { confirmState, confirm } = useConfirm();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Load from localStorage as immediate fallback
    setToken(localStorage.getItem(KEYS.token) ?? "");
    setAccount((localStorage.getItem(KEYS.account) as "demo" | "live") ?? "demo");
    setRisk(Number(localStorage.getItem(KEYS.riskPerTrade) ?? 2));
    setMaxDd(Number(localStorage.getItem(KEYS.maxDrawdown) ?? 5));
    setStake(loadDefaultStake());
    // Then hydrate from server
    api.get<Record<string, unknown>>("/api/settings").then((s) => {
      if (s.deriv_token) setToken(s.deriv_token as string);
      if (s.account_type) setAccount(s.account_type as "demo" | "live");
      if (s.risk_per_trade) setRisk(s.risk_per_trade as number);
      if (s.max_drawdown) setMaxDd(s.max_drawdown as number);
      if (s.default_stake_usd) { setStake(s.default_stake_usd as number); saveDefaultStake(s.default_stake_usd as number); }
      if (s.avatar) setAvatar(s.avatar as string);
      if (s.online_status) setOnlineStatus(s.online_status as "online" | "offline");
      setAutoBacktestEnabled(!!s.auto_backtest_enabled);
    }).catch(() => {});
    // Reflects the browser's actual subscription, not a saved preference —
    // permission can be revoked (iOS Settings, site data cleared) outside
    // the app, and the toggle should always show the real current state.
    getExistingPushSubscription()
      .then((sub) => setPushEnabled(!!sub))
      .catch(() => {})
      .finally(() => setPushChecked(true));
  }, []);

  async function handleAvatarSelect(newAvatar: string) {
    setAvatar(newAvatar);
    setAvatarSaving(true);
    try {
      await api.put("/api/settings", { avatar: newAvatar });
      await refreshAuth();
      toast.success("Avatar mis à jour");
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
      setOnlineStatus(onlineStatus); // revert
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

  async function saveLocal() {
    localStorage.setItem(KEYS.token, token);
    localStorage.setItem(KEYS.account, account);
    localStorage.setItem(KEYS.riskPerTrade, String(risk));
    localStorage.setItem(KEYS.maxDrawdown, String(maxDd));
    saveDefaultStake(stake);
    await api.put("/api/settings", {
      deriv_token: token || null,
      account_type: account,
      risk_per_trade: risk,
      max_drawdown: maxDd,
    }).catch(() => {});
    toast.success("Paramètres enregistrés");
  }

  async function testConnection() {
    if (!token) {
      toast.error("Entre un token API d'abord");
      return;
    }
    setLoading(true);
    try {
      await saveLocal();
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
      toast.success(`Connecté: ${res.loginId} (${res.accountType})`);
    } catch (e) {
      toast.error(`Échec: ${(e as Error).message}`);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto pb-24">
      {/* Profil & Avatar */}
      <CollapsibleSection
        title="Profil & Avatar"
        icon={<UserCircle className="h-5.5 w-5.5 shrink-0 text-amber-400" />}
        defaultOpen={true}
      >
        <div className="p-4 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5 rounded-3xl bg-white/[0.02] border border-white/[0.06] shadow-sm">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="relative h-22 w-22 rounded-3xl bg-gradient-to-br from-amber-500/30 via-amber-500/5 to-transparent p-0.5 flex items-center justify-center shrink-0">
                <div className="h-full w-full rounded-[22px] bg-[#0a0a0c] border border-amber-500/10 overflow-hidden">
                  {avatar ? (
                    <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <UserCircle className="h-10 w-10 text-amber-400/40" />
                    </div>
                  )}
                  {avatarSaving && (
                    <div className="absolute inset-0.5 bg-black/50 backdrop-blur-sm rounded-[22px] flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
                    </div>
                  )}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-foreground truncate">{user?.username}</h2>
                <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-bold uppercase tracking-wider transition-colors",
                    onlineStatus === "online"
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-amber-500/10 border-amber-500/30 text-amber-400"
                  )}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", onlineStatus === "online" ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                    {onlineStatus === "online" ? "En ligne" : "Hors ligne (Invisible)"}
                  </span>
                </div>
              </div>
            </div>

            {user?.is_admin === 1 && (
              <div className="flex items-center gap-3 shrink-0">
                {statusSaving && <Loader2 className="h-4 w-4 animate-spin text-amber-500" />}
                <div className="inline-flex p-1 rounded-full bg-white/[0.04] border border-white/[0.08]" role="radiogroup" aria-label="Mode de présence">
                  <button
                    type="button"
                    onClick={() => toggleStatus(true)}
                    disabled={statusSaving}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200",
                      onlineStatus === "online"
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Wifi className="h-3.5 w-3.5" />
                    En ligne
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleStatus(false)}
                    disabled={statusSaving}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all duration-200",
                      onlineStatus === "offline"
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <WifiOff className="h-3.5 w-3.5" />
                    Hors ligne
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-white/5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground/50 mb-4 flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-amber-500" />
              Choisir un Avatar
            </h3>
            <AvatarPicker currentAvatar={avatar} onSelect={handleAvatarSelect} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Header Panel */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 bg-white/[0.01] border border-white/5 p-4.5 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight bg-gradient-to-r from-white via-white to-white/75 bg-clip-text text-transparent">
            Paramètres
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Configurez votre accès broker et ajustez la gestion du risque.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { clearToken(); window.location.href = "/login"; }}
          className="text-red-400 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/30 h-10 text-xs md:text-sm rounded-xl transition-all duration-300 px-4"
        >
          <LogOut className="mr-1.5 h-4 w-4" /> Déconnexion
        </Button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* LEFT COLUMN: Connection & Broker */}
        <div className="space-y-6">
          <CollapsibleSection
            icon={<KeyRound className="mt-1 h-5.5 w-5.5 shrink-0 text-red-400" />}
            title="Connexion Broker"
            description="Associez votre compte réel ou de démonstration pour l'exécution des ordres."
            defaultOpen
            accentClassName="border-red-500/25 bg-gradient-to-b from-red-500/[0.02] to-transparent"
          >
            <div className="space-y-4">
              <div className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                Créez une clé d'accès sur{" "}
                <a
                  href="https://app.deriv.com/account/api-token"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:underline font-semibold"
                >
                  app.deriv.com → API token
                </a>. Stockée localement dans ce navigateur uniquement.
              </div>

              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">Token API Deriv</span>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ex: a1b2c3d4..."
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 pr-10 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">Type de Compte</span>
                <div className="flex bg-neutral-950/80 p-1.5 rounded-xl border border-white/5 gap-1.5 max-w-[200px]">
                  {(["demo", "live"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={async () => {
                        if (t === "live") {
                          const ok = await confirm({
                            title: "Passer en mode LIVE ?",
                            description: "Le mode LIVE engage de l'argent réel sur les transactions Deriv. Es-tu sûr de vouloir passer en mode LIVE ?",
                            confirmLabel: "Passer en LIVE",
                            danger: true,
                      });
                      if (!ok) return;
                    }
                    setAccount(t);
                  }}
                      className={cn(
                        "flex-1 py-1.5 text-[10px] md:text-xs uppercase tracking-wider font-bold rounded-lg transition-all text-center",
                        account === t
                          ? t === "demo"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            : "bg-red-500/15 text-red-400 border border-red-500/20 animate-pulse"
                          : "text-muted-foreground hover:text-foreground border border-transparent"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {account === "live" && (
                  <span className="text-xs text-[color:var(--bear)] flex items-center gap-1.5 font-medium">
                    <ShieldAlert className="h-4 w-4 shrink-0" /> Argent réel — sois prudent.
                  </span>
                )}
              </div>

              <div className="pt-2">
                <Button
                  onClick={testConnection}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-cyan-500/20 to-violet-500/20 hover:from-cyan-500/35 hover:to-violet-500/35 text-cyan-400 border border-cyan-500/30 font-bold h-10 text-xs md:text-sm rounded-xl shadow-sm transition-all"
                >
                  {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                  Tester & enregistrer Deriv
                </Button>
              </div>

              {info && (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 text-xs">
                  <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    Connexion active
                  </div>
                  <div className="text-muted-foreground mt-1.5 space-y-1 font-mono text-[11px] md:text-xs">
                    <div>Compte ID : <span className="text-neutral-200 font-bold">{info.id}</span></div>
                    {info.balance !== undefined && (
                      <div>Solde : <span className="text-neutral-200 font-bold">{info.balance.toFixed(2)} {info.currency}</span></div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Auto-Backtest Card */}
          <CollapsibleSection
            icon={<FlaskConical className="mt-1 h-5.5 w-5.5 text-cyan-400 shrink-0" />}
            title="Backtest automatique"
            description="Rejoue le pipeline live toutes les 6h. Si le win rate mesuré dépasse le seuil de rentabilité, le bot serveur démarre en Démo ; sinon il s'arrête. En Live, seul l'arrêt automatique s'applique — jamais de démarrage automatique, un lancement en argent réel reste toujours une confirmation manuelle."
          >
            <div
              className={cn(
                "flex items-center justify-between p-3.5 rounded-xl border transition-all",
                autoBacktestEnabled ? "bg-cyan-500/5 border-cyan-500/20" : "bg-white/[0.005] border-white/5"
              )}
            >
              <div>
                <h4 className="text-xs md:text-sm text-neutral-200 font-bold">Activer l'automatisme</h4>
                <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5">
                  Démarre/arrête le bot Démo selon le verdict du backtest. En Live : arrête seulement, jamais de démarrage automatique.
                </p>
              </div>
              <Switch checked={autoBacktestEnabled} disabled={autoBacktestSaving} onCheckedChange={toggleAutoBacktest} />
            </div>

            {autoBacktestEnabled && <AutoBacktestStatus />}
          </CollapsibleSection>
        </div>

        {/* RIGHT COLUMN: Risk & AI */}
        <div className="space-y-6">
          {/* Risk Management Card */}
          <CollapsibleSection
            icon={<ShieldAlert className="mt-1 h-5.5 w-5.5 text-amber-400 shrink-0" />}
            title="Gestion du risque"
            description="Appliqué automatiquement à tous les signaux et ordres."
            defaultOpen
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Mise par défaut ($)
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs md:text-sm">$</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={stake}
                    onChange={(e) => setStake(Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-background pl-7 pr-3 py-2.5 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">
                    Risque par trade (%)
                  </span>
                  <div className="relative">
                    <input
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={risk}
                      onChange={(e) => setRisk(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs md:text-sm">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">
                    Drawdown Max (%)
                  </span>
                  <div className="relative">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={maxDd}
                      onChange={(e) => setMaxDd(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs md:text-sm">%</span>
                  </div>
                </div>
              </div>

              {risk > 2 && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3.5 text-xs text-red-400 font-medium leading-relaxed">
                  ⚠️ Risque par trade supérieur à 2% — non recommandé pour conserver votre capital sur le long terme.
                </div>
              )}
            </div>
          </CollapsibleSection>

          {/* Push Notifications Card */}
          <CollapsibleSection
            icon={<Bell className="mt-1 h-5.5 w-5.5 text-amber-400 shrink-0" />}
            title="Notifications push"
            description="Alertes de trade et de pause risque envoyées même téléphone verrouillé."
          >
            {isIosNonSafari() ? (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3.5 text-xs text-red-400 leading-relaxed">
                Sur iPhone, Chrome ne peut pas activer les notifications — c'est une restriction d'Apple, même en l'ajoutant à l'écran d'accueil ça ne marchera pas depuis Chrome. Ouvre <span className="font-bold">aupluriel.com dans Safari</span>, puis Partager → « Sur l'écran d'accueil ».
              </div>
            ) : !isPushSupported() ? (
              <div className="rounded-xl border border-white/5 bg-white/[0.005] p-3.5 text-xs text-muted-foreground leading-relaxed">
                Notifications push non supportées par ce navigateur.
              </div>
            ) : isIosNonStandalone() ? (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-xs text-amber-400 leading-relaxed">
                Sur iPhone, ajoute Au Pluriel à l'écran d'accueil (Partager → « Sur l'écran d'accueil ») pour activer les notifications — un onglet Safari classique ne peut pas les recevoir téléphone verrouillé.
              </div>
            ) : (
              <div
                className={cn(
                  "flex items-center justify-between p-3.5 rounded-xl border transition-all",
                  pushEnabled ? "bg-amber-500/5 border-amber-500/20" : "bg-white/[0.005] border-white/5",
                )}
              >
                <div>
                  <h4 className="text-xs md:text-sm text-neutral-200 font-bold">Activer les notifications</h4>
                  <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5">
                    Trade clôturé, bot en pause (protection de risque).
                  </p>
                </div>
                <Switch checked={pushEnabled} disabled={pushSaving || !pushChecked} onCheckedChange={togglePush} />
              </div>
            )}
          </CollapsibleSection>
        </div>
      </div>

      {/* Global Unified Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/5">
        <p className="text-[11px] md:text-xs text-muted-foreground leading-normal max-w-2xl text-center sm:text-left">
          Avertissement : Au Pluriel est un outil d'analyse. Le trading de Crypto et Forex comporte un risque important
          de perte en capital. Les performances passées ne préjugent pas des performances futures.
        </p>
        <Button
          onClick={saveLocal}
          className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-cyan-400 to-violet-500 hover:opacity-90 text-background font-bold text-xs md:text-sm rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all duration-300 h-11"
        >
          <CheckCircle2 className="mr-2 h-4 w-4" /> Enregistrer toutes les modifications
        </Button>
      </div>
      <ConfirmDialog state={confirmState} />
    </div>
  );
}