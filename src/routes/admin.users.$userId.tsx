import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Check, X, Trash2, Loader2, RefreshCw, KeyRound,
  ShieldOff, Pencil, StickyNote, Dices, Crosshair, Zap,
  TrendingUp, TrendingDown, BrainCircuit, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { OFFICIAL_PRESET_STRATEGIES, type PresetStrategyDef } from "@/lib/preset-strategies";

// ── Shared types (mirrors admin.tsx) ──
interface AdminUser {
  id: number; email: string; username: string; email_verified: number;
  status: string; is_admin: number; chat_enabled: number;
  admin_note: string | null; created_at: number;
  has_deriv: number; has_kraken: number; has_binance: number; has_oanda: number;
}
interface BotStatus {
  userId: number; enabled: boolean; running: boolean; hasToken: boolean;
  mode: "demo" | "live" | null;
  preset: "boom" | "crash" | "default" | "scalping" | "liquidity" | "gold" | "crash900";
  lastError: string | null; autoBacktestEnabled: boolean;
}
interface JournalTrade {
  id: string; time: number; symbol: string; direction: string;
  stake: number; payout: number; status: string; profit: number;
  confidence: number; tf_agreement: number; closed_at: number | null; note: string | null;
}
interface BreakdownRow { key: string; trades: number; wins: number; winRate: number | null; netPnl: number; }
interface Recommendation {
  type: "disable-symbol" | "raise-confidence" | "small-sample";
  message: string; symbol?: string; suggestedMinConfidence?: number;
}
interface UserInsights {
  mode: "demo" | "live"; totalTrades: number;
  bySymbol: BreakdownRow[]; byConfidence: BreakdownRow[];
  bySession: BreakdownRow[]; recommendations: Recommendation[];
}
interface UserBotConfig {
  mode: "demo" | "live"; stakeUsd: number; minConfidence: number;
  symbols: string[]; [key: string]: unknown;
}
interface PerfSummary {
  trades: number; wins: number; losses: number; winRate: number;
  netPnl: number; profitFactor: number; expectancy: number;
}
interface ConfigChangeEntry {
  id: string; changedAt: number; changedBy: string;
  source: "user" | "admin" | "auto-rollback";
  fields: Record<string, { from: unknown; to: unknown }>;
  before: PerfSummary | null; beforeSampleSize: number;
  after: PerfSummary | null; afterSampleSize: number;
}
interface UserRecap {
  userId: number; username: string; email: string;
  trades: number; wins: number; losses: number; open: number;
  winRate: number; netPnl: number; profitFactor: number | null;
  avgConfidence: number; lastTradeAt: number | null;
  balance: number | null; currency: string | null;
  tradesLive: number; netPnlLive: number;
}

const presetLabels = {
  default: "Multi",
  boom: "Boom500",
  boom900: "Boom900",
  vol75: "Volatility 75 (1s)",
  rb100: "Range Break 100",
  crash: "Crash900",
  crash500: "Crash500",
  scalping: "Scalping",
  liquidity: "GOLD LIQUIDITY SWEEP",
  gold: "GOLD TREND PULLBACK",
  crash900: "Crash900 V2",
  boomv2: "Boom V2",
  scalpingv2: "Scalping V2",
  liquidityv2: "Liquidity V2",
  goldv2: "GOLD BREAKOUT",
} as const;

type PresetKey = keyof typeof presetLabels;

const PRESET_KEYS: readonly PresetKey[] = [
  "default",
  "boom",
  "boom900",
  "vol75",
  "rb100",
  "crash",
  "crash500",
  "scalping",
  "liquidity",
  "gold",
  "crash900",
  "boomv2",
  "scalpingv2",
  "liquidityv2",
  "goldv2",
];

const PRESET_ICONS: Record<PresetKey, string> = {
  default: "🌐",
  boom: "🚀",
  boom900: "⚡",
  vol75: "📈",
  rb100: "↔",
  crash: "📉",
  crash500: "💥",
  scalping: "⏱️",
  liquidity: "◌",
  gold: "🥇",
  crash900: "⚡",
  boomv2: "🚀",
  scalpingv2: "⚡",
  liquidityv2: "💧",
  goldv2: "✨",
};


const CONFIG_FIELD_LABELS: Record<string, string> = {
  stakeUsd: "Mise", maxDailyLossUsd: "Limite perte/jour", maxDailyProfitUsd: "Objectif gain/jour",
  minConfidence: "Confiance min.", maxConfidence: "Confiance max.", minTfAgreement: "Accord TF min.",
  takeProfitPctOfStake: "TP % mise", stopLossPctOfStake: "SL % mise", multiplierLevel: "Levier",
  symbols: "Symboles", excludedSymbols: "Symboles exclus",
};

export const Route = createFileRoute("/admin/users/$userId")({
  head: () => ({ meta: [{ title: "Profil utilisateur — Admin" }] }),
  component: UserProfilePage,
});

function UserProfilePage() {
  const { userId } = useParams({ from: "/admin/users/$userId" });
  const targetUserId = parseInt(userId, 10);
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { confirmState, confirm } = useConfirm();

  const [profileUser, setProfileUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [profilePreset, setProfilePreset] = useState<PresetKey>("default");
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([]);
  const [manualTrades, setManualTrades] = useState<JournalTrade[]>([]);
  const [journalConfig, setJournalConfig] = useState<UserBotConfig | null>(null);
  const [journalInsights, setJournalInsights] = useState<{ demo: UserInsights; live: UserInsights } | null>(null);
  const [journalLoading, setJournalLoading] = useState(true);
  const [insightsMode, setInsightsMode] = useState<"demo" | "live">("demo");
  const [configChanges, setConfigChanges] = useState<ConfigChangeEntry[]>([]);
  const [configChangesLoading, setConfigChangesLoading] = useState(false);
  const [botStatus, setBotStatus] = useState<Record<string, BotStatus>>({});
  const [botBusyId, setBotBusyId] = useState<number | null>(null);
  const [presetBusy, setPresetBusy] = useState<number | null>(null);
  const [strategyBusy, setStrategyBusy] = useState<number | null>(null);
  const [autoRollbackBusy, setAutoRollbackBusy] = useState(false);
  const [applyingRec, setApplyingRec] = useState<string | null>(null);
  const [recap, setRecap] = useState<UserRecap | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);

  // Redirect non-admins
  useEffect(() => {
    if (authLoading) return;
    if (!user || !user.is_admin) navigate({ to: "/" });
  }, [authLoading, user, navigate]);

  // Load user data
  const loadUser = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ users: AdminUser[] }>("/api/admin/users");
      const found = data.users.find((u) => u.id === targetUserId);
      if (!found) { toast.error("Utilisateur introuvable"); navigate({ to: "/admin" }); return; }
      setProfileUser(found);
      setNoteDraft(found.admin_note ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
      navigate({ to: "/admin" });
    } finally { setLoading(false); }
  }, [targetUserId, navigate]);

  // Load recap
  const loadRecap = useCallback(async () => {
    try {
      const data = await api.get<{ recap: UserRecap[] }>("/api/admin/stats");
      const r = data.recap.find((x) => x.userId === targetUserId);
      setRecap(r ?? null);
    } catch { /* ignore */ }
  }, [targetUserId]);

  // Load bot status
  const loadBotStatus = useCallback(async () => {
    try {
      const data = await api.get<{ statuses: BotStatus[] }>("/api/admin/bot");
      const map: Record<string, BotStatus> = {};
      for (const s of data.statuses) map[`${s.userId}:${s.preset}`] = s;
      setBotStatus(map);
    } catch { /* ignore */ }
  }, []);

  // Load profile config
  const loadProfileConfig = useCallback(async (uid: number, preset: PresetKey) => {
    setJournalLoading(true);
    try {
      const data = await api.get<{
        trades: JournalTrade[]; manualTrades: JournalTrade[]; config: UserBotConfig | null;
        insights: { demo: UserInsights; live: UserInsights };
      }>(`/api/admin/stats?userId=${uid}&preset=${preset}`);
      setJournalTrades(data.trades);
      setManualTrades(data.manualTrades ?? []);
      setJournalConfig(data.config);
      setJournalInsights(data.insights);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setJournalLoading(false); }
    setConfigChangesLoading(true);
    try {
      const data = await api.get<{ changes: ConfigChangeEntry[] }>(`/api/admin/config-changes?userId=${uid}&preset=${preset}`);
      setConfigChanges(data.changes);
    } catch { setConfigChanges([]); }
    finally { setConfigChangesLoading(false); }
  }, []);

  // Initial load
  useEffect(() => {
    if (!user?.is_admin) return;
    loadUser(); loadRecap(); loadBotStatus();
  }, [user?.is_admin, loadUser, loadRecap, loadBotStatus]);

  // Load config when user or preset changes
  useEffect(() => {
    if (!profileUser) return;
    loadProfileConfig(profileUser.id, profilePreset);
  }, [profileUser, profilePreset, loadProfileConfig]);

  // Polling
  useEffect(() => {
    if (!user?.is_admin) return;
    const id = setInterval(() => { void Promise.all([loadBotStatus(), loadRecap()]); }, 20_000);
    return () => clearInterval(id);
  }, [user?.is_admin, loadBotStatus, loadRecap]);

  // ── Actions ──
  async function act(action: string) {
    if (!profileUser) return;
    setBusyId(profileUser.id);
    try {
      await api.post(`/api/admin/users`, { userId: profileUser.id, action });
      toast.success("Action effectuée");
      await loadUser();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setBusyId(null); }
  }

  async function toggleBot(preset: PresetKey, action: "start" | "stop") {
    if (!profileUser) return;
    setBotBusyId(profileUser.id);
    try {
      await api.post("/api/admin/bot", { userId: profileUser.id, preset, action });
      await loadBotStatus();
      toast.success(action === "start" ? "Bot démarré" : "Bot arrêté");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setBotBusyId(null); }
  }

  async function applyRecommendation(rec: Recommendation) {
    if (!profileUser) return;
    setApplyingRec(rec.message);
    try {
      const patch: { userId: number; preset: PresetKey; symbols?: string[]; minConfidence?: number } = { userId: profileUser.id, preset: profilePreset };
      if (rec.type === "disable-symbol" && rec.symbol) {
        patch.symbols = (journalConfig?.symbols ?? []).filter((s) => s !== rec.symbol);
      } else if (rec.type === "raise-confidence" && rec.suggestedMinConfidence !== undefined) {
        patch.minConfidence = rec.suggestedMinConfidence;
      } else return;
      const res = await api.patch<{ config: UserBotConfig }>("/api/admin/user-config", patch);
      setJournalConfig(res.config);
      toast.success("Recommandation appliquée");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setApplyingRec(null); }
  }

  async function toggleAutoRollback(enabled: boolean) {
    if (!profileUser) return;
    setAutoRollbackBusy(true);
    try {
      const res = await api.patch<{ config: UserBotConfig }>("/api/admin/user-config", { userId: profileUser.id, preset: profilePreset, autoRollbackEnabled: enabled });
      setJournalConfig(res.config);
      toast.success(enabled ? "Rollback auto activé" : "Rollback auto désactivé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setAutoRollbackBusy(false); }
  }

  async function saveNote() {
    if (!profileUser) return;
    setNoteSaving(true);
    try {
      await api.post("/api/admin/users", { userId: profileUser.id, action: "note", note: noteDraft });
      setNoteSavedAt(Date.now());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setNoteSaving(false); }
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!profileUser || !usernameDraft.trim()) return;
    setRenameBusy(true);
    try {
      await api.post("/api/admin/users", { userId: profileUser.id, action: "rename", username: usernameDraft.trim() });
      setProfileUser({ ...profileUser, username: usernameDraft.trim() });
      setEditingUsername(false);
      toast.success("Nom modifié");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setRenameBusy(false); }
  }

  if (loading || !profileUser) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const isAdmin = profileUser.is_admin === 1;
  const r = recap;
  const matchingStrategies = OFFICIAL_PRESET_STRATEGIES.filter((s) => s.targetPreset === profilePreset);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1280px] mx-auto w-full max-w-full overflow-x-hidden">
      {/* ── Top Navigation Bar ── */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate({ to: "/admin" })}
          className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider text-muted-foreground hover:text-cyan-400 transition-colors bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.08] px-3.5 py-2 rounded-xl backdrop-blur-sm cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Retour au Dashboard Admin
        </button>

        <span className="text-[11px] font-mono text-muted-foreground/60 hidden sm:inline-block">
          ID Utilisateur: <span className="text-foreground font-bold font-mono">#{profileUser.id}</span>
        </span>
      </div>

      {/* ── User Header Cockpit Card ── */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-neutral-900/95 via-slate-900/90 to-black/95 p-6 backdrop-blur-xl shadow-2xl space-y-6 before:absolute before:inset-0 before:bg-[radial-gradient(ellipse_at_top_right,rgba(6,182,212,0.12),transparent_60%)]">
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4.5">
            {/* Glowing Avatar */}
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 via-indigo-500 to-purple-600 text-white text-xl font-black shadow-[0_0_25px_rgba(6,182,212,0.35)] border border-white/20">
              {profileUser.username.slice(0, 2).toUpperCase()}
              {isAdmin && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] text-[9px] font-black text-black">
                  ★
                </span>
              )}
            </div>

            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-black tracking-tight text-foreground">{profileUser.username}</h1>
                {isAdmin ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-3 py-0.5 text-[10px] text-cyan-300 font-bold uppercase tracking-wider">
                    Administrateur
                  </span>
                ) : (
                  <button
                    onClick={() => { setEditingUsername(true); setUsernameDraft(profileUser.username); }}
                    className="text-muted-foreground/50 hover:text-cyan-400 transition-colors p-1 rounded-md hover:bg-white/5"
                    title="Modifier le nom d'utilisateur"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <StatusBadge status={profileUser.status} />
              </div>

              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                <span className="text-neutral-300 font-medium">{profileUser.email}</span>
                <span className="text-white/20">•</span>
                <span>Inscrit le {new Date(profileUser.created_at * 1000).toLocaleDateString("fr-FR")}</span>
              </div>
            </div>
          </div>

          {/* Quick Action Toolbar */}
          {!isAdmin && (
            <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0 border-t border-white/5 md:border-t-0">
              {profileUser.status !== "approved" && (
                <button
                  onClick={() => act("approve")}
                  disabled={busyId === profileUser.id}
                  className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs text-emerald-300 font-bold hover:bg-emerald-500/20 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <Check className="h-3.5 w-3.5" /> Approuver
                </button>
              )}
              {profileUser.status === "approved" && (
                <button
                  onClick={() => act("revoke")}
                  disabled={busyId === profileUser.id}
                  className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-300 font-bold hover:bg-amber-500/20 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <ShieldOff className="h-3.5 w-3.5" /> Révoquer
                </button>
              )}
              <button
                onClick={() => act("reset-password")}
                disabled={busyId === profileUser.id}
                className="flex items-center gap-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3.5 py-2 text-xs text-indigo-300 font-bold hover:bg-indigo-500/20 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
              >
                <KeyRound className="h-3.5 w-3.5" /> Réinitialiser MDP
              </button>
              <button
                onClick={() => act("delete")}
                disabled={busyId === profileUser.id}
                className="flex items-center gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3.5 py-2 text-xs text-rose-300/70 hover:text-rose-200 hover:bg-rose-500/15 transition-all shadow-sm disabled:opacity-50 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" /> Supprimer
              </button>
            </div>
          )}
        </div>

        {/* Rename Form Modal overlay inline */}
        {editingUsername && (
          <form onSubmit={submitRename} className="relative z-10 flex items-center gap-2 pt-2 border-t border-white/10">
            <Input
              value={usernameDraft}
              onChange={(e) => setUsernameDraft(e.target.value)}
              autoFocus
              maxLength={32}
              className="h-9 text-xs max-w-xs bg-black/40 border-cyan-500/40 text-foreground"
            />
            <Button type="submit" size="sm" disabled={renameBusy || !usernameDraft.trim()} className="h-9 px-3 bg-cyan-500 text-black hover:bg-cyan-400">
              {renameBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditingUsername(false)} disabled={renameBusy} className="h-9 px-3">
              <X className="h-4 w-4" />
            </Button>
          </form>
        )}
      </div>

      {/* ── Financial & Metrics Cockpit (Stat Cards) ── */}
      {r && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Solde Compte */}
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-black/40 to-black/60 p-4 backdrop-blur-md flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-400/80">Solde Compte</span>
            <div className="text-xl font-black font-mono text-amber-300 mt-1">
              {r.balance !== null && r.balance !== undefined
                ? `${r.currency} ${r.balance.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "—"}
            </div>
            <span className="text-[10px] text-muted-foreground mt-2">Solde disponible courtier</span>
          </div>

          {/* P&L Total Net */}
          <div className={cn(
            "rounded-2xl border p-4 backdrop-blur-md flex flex-col justify-between",
            r.netPnl >= 0 ? "border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 via-black/40 to-black/60" : "border-rose-500/20 bg-gradient-to-br from-rose-500/10 via-black/40 to-black/60"
          )}>
            <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">P&L Net Total</span>
            <div className={cn("text-xl font-black font-mono mt-1", r.netPnl >= 0 ? "text-emerald-400" : "text-rose-400")}>
              {r.netPnl >= 0 ? `+$${r.netPnl.toFixed(2)}` : `-$${Math.abs(r.netPnl).toFixed(2)}`}
            </div>
            <span className="text-[10px] text-muted-foreground mt-2">Cumul des gains et pertes</span>
          </div>

          {/* Activity & Win Rate */}
          <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-black/40 to-black/60 p-4 backdrop-blur-md flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-cyan-400/80">Activité & Win Rate</span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-xl font-black font-mono text-foreground">{r.trades} <span className="text-xs font-normal text-muted-foreground">trades</span></span>
              <span className="text-lg font-black font-mono text-cyan-300">{r.trades ? `${r.winRate}%` : "—"}</span>
            </div>
            <span className="text-[10px] text-muted-foreground mt-2">Taux de réussite clôturé</span>
          </div>

          {/* Confiance & Profit Factor */}
          <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-500/10 via-black/40 to-black/60 p-4 backdrop-blur-md flex flex-col justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-purple-400/80">Confiance & Profit Factor</span>
            <div className="flex items-baseline justify-between mt-1">
              <span className="text-xl font-black font-mono text-purple-300">{r.avgConfidence ? `${r.avgConfidence}%` : "—"}</span>
              <span className="text-xs font-mono text-muted-foreground">PF: <span className="text-foreground font-bold">{r.profitFactor !== null ? r.profitFactor.toFixed(2) : "—"}</span></span>
            </div>
            <span className="text-[10px] text-muted-foreground mt-2">Score moyen des signaux</span>
          </div>
        </div>
      )}

      {/* ── Auto-Trader Section ── */}
      {!isAdmin && (
        <div className="space-y-4 rounded-3xl border border-white/10 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-cyan-400" />
              <h2 className="text-sm font-black uppercase tracking-wider text-foreground">Gestionnaire Auto-Trader</h2>
            </div>

            <span className="text-xs font-mono text-muted-foreground">
              Preset sélectionné : <span className="text-cyan-400 font-bold">{PRESET_ICONS[profilePreset]} {presetLabels[profilePreset]}</span>
            </span>
          </div>

          {/* Bot Status Banner */}
          <div className="flex flex-col gap-3 rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border text-sm font-bold shadow-md",
                botStatus[`${profileUser.id}:${profilePreset}`]?.running
                  ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-400 shadow-[0_0_15px_rgba(52,211,153,0.3)]"
                  : "border-white/10 bg-white/5 text-muted-foreground"
              )}>
                {PRESET_ICONS[profilePreset]}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-cyan-300">
                    {presetLabels[profilePreset]}
                  </span>
                  {botStatus[`${profileUser.id}:${profilePreset}`]?.running && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/30">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> BOT EN COURS
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Démarrer ou arrêter l'exécution automatique sur ce preset pour cet utilisateur.
                </p>
              </div>
            </div>

            <BotStatusCell status={botStatus[`${profileUser.id}:${profilePreset}`]} busy={botBusyId === profileUser.id} onToggle={(action) => toggleBot(profilePreset, action)} />
          </div>

          {/* Active Presets Reel */}
          {(() => {
            const activeList = PRESET_KEYS.filter((p) => botStatus[`${profileUser.id}:${p}`]?.running);
            return (
              <div className="rounded-2xl border border-white/5 bg-black/30 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
                <span className="text-muted-foreground font-semibold text-xs shrink-0">Presets actifs en arrière-plan :</span>
                {activeList.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {activeList.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[10px] font-black text-emerald-300">
                        <span>{PRESET_ICONS[p]} {presetLabels[p]}</span>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/50 italic">Aucun bot actif sur ce compte</span>
                )}
              </div>
            );
          })()}

          {/* Preset Tabs Bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <span>Sélectionner le preset à administrer (15 presets disponibles)</span>
              <button
                disabled={presetBusy === profileUser.id}
                onClick={async () => {
                  const ok = await confirm({ title: `Réinitialiser ${presetLabels[profilePreset]} ?`, description: "Remet les valeurs par défaut du preset.", confirmLabel: "Réinitialiser", danger: true });
                  if (!ok) return;
                  setPresetBusy(profileUser.id);
                  try {
                    const res = await api.patch<{ config: UserBotConfig }>("/api/admin/user-config", { userId: profileUser.id, preset: profilePreset, resetToCanonical: true });
                    setJournalConfig(res.config);
                    toast.success(`${presetLabels[profilePreset]} réinitialisé ✓`);
                  } catch (err) { toast.error(err instanceof Error ? err.message : "Erreur"); }
                  finally { setPresetBusy(null); }
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-40 cursor-pointer"
              >
                Réinitialiser Preset
              </button>
            </div>

            <div className="flex w-full flex-wrap items-center rounded-2xl border border-white/5 bg-black/40 p-1.5 gap-1">
              {PRESET_KEYS.map((p) => {
                const isRunning = botStatus[`${profileUser.id}:${p}`]?.running;
                const isSelected = profilePreset === p;
                return (
                  <button
                    key={p}
                    onClick={() => setProfilePreset(p)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition-all relative cursor-pointer",
                      isSelected
                        ? p.startsWith("boom")
                          ? "bg-orange-500/20 text-orange-300 border border-orange-500/40 shadow-sm"
                          : p.startsWith("crash")
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm"
                            : p.startsWith("liquidity") || p.startsWith("gold")
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                              : p.startsWith("scalping")
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm"
                                : "bg-violet-500/20 text-violet-300 border border-violet-500/40 shadow-sm"
                        : "text-muted-foreground hover:text-foreground border border-transparent hover:bg-white/[0.04]",
                    )}
                  >
                    <span>{PRESET_ICONS[p]} {presetLabels[p]}</span>
                    {isRunning && (
                      <span className="relative flex h-2 w-2" title="Bot actif">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Strategy Selector */}
          {matchingStrategies.length > 0 && (
            <div className="rounded-2xl border border-white/5 bg-black/20 p-4 space-y-2.5">
              <span className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Dices className="h-3.5 w-3.5 text-amber-400" /> Appliquer une stratégie préconfigurée sur {presetLabels[profilePreset]}
              </span>
              <div className="flex flex-wrap gap-2">
                {matchingStrategies.map((strat) => (
                  <button
                    key={strat.id}
                    disabled={strategyBusy === profileUser.id}
                    onClick={async () => {
                      const ok = await confirm({ title: `Appliquer "${strat.name}" ?`, description: `Remplace la config ${presetLabels[profilePreset]} de ${profileUser.username}.${strat.verified ? " ✓ Vérifiée." : " ⚠ Non vérifiée."}`, confirmLabel: "Appliquer", danger: true });
                      if (!ok) return;
                      setStrategyBusy(profileUser.id);
                      try {
                        const res = await api.patch<{ config: UserBotConfig }>("/api/admin/user-config", { userId: profileUser.id, preset: profilePreset, configOverride: strat.configOverride });
                        setJournalConfig(res.config);
                        toast.success(`Stratégie "${strat.name}" appliquée ✓`);
                      } catch (err) { toast.error(err instanceof Error ? err.message : "Erreur"); }
                      finally { setStrategyBusy(null); }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[11px] font-bold transition-all disabled:opacity-40 cursor-pointer",
                      strat.verified ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground hover:bg-white/10",
                    )}
                  >
                    {strategyBusy === profileUser.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    {strat.verified && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                    {strat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Broker Integration Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            {[
              { label: "Deriv", active: profileUser.has_deriv, color: "text-rose-400", border: "border-rose-500/30", bg: "bg-rose-500/10" },
              { label: "Kraken", active: profileUser.has_kraken, color: "text-violet-400", border: "border-violet-500/30", bg: "bg-violet-500/10" },
              { label: "Binance", active: profileUser.has_binance, color: "text-amber-400", border: "border-amber-500/30", bg: "bg-amber-500/10" },
              { label: "OANDA", active: profileUser.has_oanda, color: "text-emerald-400", border: "border-emerald-500/30", bg: "bg-emerald-500/10" },
            ].map((b) => (
              <div key={b.label} className={cn("flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-center backdrop-blur-md", b.border, b.bg)}>
                <span className={cn("text-[11px] font-black uppercase tracking-wider", b.color)}>{b.label}</span>
                <div className="flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", b.active ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-white/20")} />
                  <span className="text-[10px] font-bold text-muted-foreground">{b.active ? "Connecté" : "Non lié"}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Internal Admin Note ── */}
      <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <label htmlFor="admin-note" className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
            <StickyNote className="h-4 w-4 text-amber-400" /> Note interne Admin (Confidentiel)
          </label>
          {noteSaving ? (
            <span className="text-xs text-muted-foreground/70 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin text-amber-400" /> Sauvegarde...</span>
          ) : noteSavedAt ? (
            <span className="text-xs text-emerald-400 font-bold">Enregistré ✓</span>
          ) : null}
        </div>
        <Textarea
          id="admin-note"
          value={noteDraft}
          onChange={(e) => { setNoteDraft(e.target.value); setNoteSavedAt(null); }}
          onBlur={saveNote}
          placeholder="Renseigne des notes internes sur l'utilisateur (Ex : profil VIP, historique de contact, préférences...)"
          rows={2}
          className="text-xs bg-black/40 border-white/10 text-foreground resize-none rounded-xl"
        />
      </div>

      {/* ── Insights & Analytics Panel ── */}
      {!journalLoading && journalInsights && (
        <UserInsightsPanel insights={journalInsights} config={journalConfig} mode={insightsMode} onModeChange={setInsightsMode} onApply={applyRecommendation} applyingRec={applyingRec} />
      )}

      {/* ── Auto Rollback Protection ── */}
      {journalConfig && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-neutral-900/60 p-4 backdrop-blur-xl">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-foreground">
              <RefreshCw className="h-4 w-4 text-amber-400" /> Protections & Rollback Automatique
            </div>
            <p className="text-xs text-muted-foreground">
              Restaure automatiquement les paramètres précédents si le taux de gain chute après un changement de config.
            </p>
          </div>
          <Switch checked={Boolean(journalConfig.autoRollbackEnabled)} disabled={autoRollbackBusy} onCheckedChange={toggleAutoRollback} />
        </div>
      )}

      {/* ── Config Changes History ── */}
      <ConfigChangesPanel changes={configChanges} loading={configChangesLoading} />

      {/* ── Mini Journal Bot ── */}
      <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl space-y-3">
        <div className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-cyan-400" /> Mini journal Bot — {PRESET_ICONS[profilePreset]} {presetLabels[profilePreset]}
        </div>
        {journalLoading ? (
          <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-400" /></div>
        ) : (() => {
          const outcomeTrades = journalTrades.filter((t) => t.status === "won" || t.status === "lost" || t.status === "open");
          const shown = outcomeTrades.slice(0, 24);
          const hiddenCount = outcomeTrades.length - shown.length;
          if (shown.length === 0) return <p className="text-xs text-muted-foreground italic">Aucun trade bot enregistré sur ce preset.</p>;
          return (
            <div className="flex flex-wrap gap-1.5">
              {shown.map((t) => (
                <span
                  key={t.id}
                  title={`${t.symbol} · ${t.direction} · ${new Date(t.time).toLocaleString("fr-FR")} · Confiance ${t.confidence}%`}
                  className={cn(
                    "rounded-xl px-2.5 py-1.5 text-xs font-bold font-mono border shadow-sm",
                    t.status === "won" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : t.status === "lost" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  )}
                >
                  {t.status === "open" ? "…" : t.profit > 0 ? "+" : ""}{t.status === "open" ? "" : t.profit.toFixed(2)} $
                </span>
              ))}
              {hiddenCount > 0 && <span className="rounded-xl px-2.5 py-1.5 text-xs font-bold text-muted-foreground/50 bg-white/5 border border-white/10">+{hiddenCount} autres</span>}
            </div>
          );
        })()}
      </div>

      {/* ── Trades Manuels (Prise Directe) ── */}
      <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-cyan-400" />
            <span className="text-xs font-black uppercase tracking-wider text-foreground">Historique Prise Directe Manuelle</span>
          </div>
          {manualTrades.length > 0 && (
            <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
              {manualTrades.length} trades
            </span>
          )}
        </div>
        {journalLoading ? (
          <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-cyan-400" /></div>
        ) : (() => {
          const outcomeManual = manualTrades.filter((t) => t.status === "won" || t.status === "lost" || t.status === "open" || t.status === "error" || t.status === "pending");
          const shown = outcomeManual.slice(0, 30);
          const hiddenCount = outcomeManual.length - shown.length;
          const manualPnl = manualTrades.filter((t) => t.status === "won" || t.status === "lost").reduce((s, t) => s + t.profit, 0);
          const manualWins = manualTrades.filter((t) => t.status === "won").length;
          const manualLosses = manualTrades.filter((t) => t.status === "lost").length;
          if (shown.length === 0) return <p className="text-xs text-muted-foreground italic">Aucun trade manuel enregistré.</p>;
          return (
            <div className="space-y-2.5">
              <div className="flex items-center gap-3 text-xs font-mono">
                <span className="font-bold text-muted-foreground">P&L Manuel: <span className={manualPnl >= 0 ? "text-emerald-400 font-black" : "text-rose-400 font-black"}>{manualPnl >= 0 ? "+" : ""}{manualPnl.toFixed(2)} $</span></span>
                <span className="text-emerald-400 font-bold">{manualWins} Gagnés</span>
                <span className="text-rose-400 font-bold">{manualLosses} Perdus</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {shown.map((t) => (
                  <span key={t.id} title={`${t.symbol} · ${t.direction} · ${new Date(t.time).toLocaleString("fr-FR")} · ${t.stake}$`} className={cn("rounded-xl px-2.5 py-1.5 text-xs font-bold font-mono border shadow-sm", t.status === "won" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : t.status === "lost" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : t.status === "error" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20")}>
                    {t.symbol.replace("frx","").replace("cry","")} {t.direction === "MULTUP" ? "↑" : t.direction === "MULTDOWN" ? "↓" : t.direction === "CALL" ? "↑" : "↓"} {t.status === "open" || t.status === "pending" ? "…" : (t.profit > 0 ? "+" : "") + t.profit.toFixed(2)} $
                  </span>
                ))}
                {hiddenCount > 0 && <span className="rounded-xl px-2.5 py-1.5 text-xs font-bold text-muted-foreground/50 bg-white/5 border border-white/10">+{hiddenCount} autres</span>}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Console d'exécution Prise Directe (Manual Trading) ── */}
      {!isAdmin && (
        <ManualTradeSection userId={profileUser.id} preset={profilePreset} botRunning={botStatus[`${profileUser.id}:${profilePreset}`]?.running ?? false} />
      )}

      <ConfirmDialog state={confirmState} />
    </div>
  );
}

// ── Sub-components ──
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    approved: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
    pending: "border-amber-500/30 bg-amber-500/5 text-amber-500",
    rejected: "border-rose-500/30 bg-rose-500/5 text-rose-400",
    suspended: "border-orange-500/30 bg-orange-500/5 text-orange-400",
  };
  const labels: Record<string, string> = { approved: "approuvé", pending: "en attente", rejected: "rejeté", suspended: "révoqué" };
  return <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider", styles[status] ?? "")}>{labels[status] ?? status}</span>;
}

function BotStatusCell({ status, busy, onToggle }: { status?: BotStatus; busy: boolean; onToggle: (action: "start" | "stop") => void }) {
  const running = status?.running ?? false;
  const enabled = status?.enabled ?? false;
  const hasToken = status?.hasToken ?? false;
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider", running ? "bg-gradient-to-r from-emerald-500/20 to-emerald-600/10 text-emerald-400 border border-emerald-500/30" : enabled ? "bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30" : "bg-gradient-to-r from-slate-500/20 to-slate-600/10 text-slate-400 border border-slate-500/30")}>
        <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-emerald-400 animate-pulse" : enabled ? "bg-amber-400" : "bg-slate-400")} />
        {running ? "live" : enabled ? "en attente" : "arrêté"}
      </span>
      <Switch checked={enabled} disabled={busy} onCheckedChange={(v) => onToggle(v ? "start" : "stop")} title={!hasToken ? "Mode démo (Token système)" : undefined} />
    </div>
  );
}

function BreakdownTable({ rows, title }: { rows: BreakdownRow[] | undefined; title: string }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">{title}</div>
      <div className="space-y-1.5">
        {rows.map((d) => (
          <div key={d.key} className="flex items-center justify-between gap-2 text-sm rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
            <span className="font-semibold text-foreground/80">{d.key}</span>
            <span className="text-muted-foreground/50 text-xs">{d.trades} trade{d.trades > 1 ? "s" : ""}</span>
            <span className={cn("font-bold", d.winRate === null ? "text-muted-foreground/40" : d.winRate >= 50 ? "text-emerald-400" : "text-rose-400")}>{d.winRate === null ? "—" : `${d.winRate}%`}</span>
            <span className={cn("font-mono font-bold", d.netPnl > 0 ? "text-emerald-400" : d.netPnl < 0 ? "text-rose-400" : "text-muted-foreground")}>{d.netPnl > 0 ? "+" : ""}{d.netPnl.toFixed(2)} $</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserInsightsPanel({ insights, config, mode, onModeChange, onApply, applyingRec }: {
  insights: { demo: UserInsights; live: UserInsights };
  config: UserBotConfig | null;
  mode: "demo" | "live";
  onModeChange: (m: "demo" | "live") => void;
  onApply: (rec: Recommendation) => void;
  applyingRec: string | null;
}) {
  const current = insights[mode];
  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl">
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-violet-400">
          <BrainCircuit className="h-4 w-4" /> Analyse & Conseils IA
        </div>
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
          {(["demo", "live"] as const).map((m) => (
            <button key={m} type="button" onClick={() => onModeChange(m)} className={cn("px-3 py-1 text-[10px] font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer", mode === m ? "bg-violet-500/20 text-violet-300 border border-violet-500/30" : "text-muted-foreground hover:text-foreground")}>
              {m === "demo" ? "Mode Démo" : "Mode Live"}
            </button>
          ))}
        </div>
      </div>
      {config && (
        <div className="flex flex-wrap gap-2 text-xs font-mono">
          <span className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-muted-foreground">Mise: <span className="text-emerald-400 font-bold">{config.stakeUsd}$</span></span>
          <span className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-muted-foreground">Confiance Min: <span className="text-cyan-300 font-bold">{config.minConfidence}%</span></span>
          <span className="rounded-xl border border-white/10 bg-black/30 px-3 py-1.5 text-muted-foreground">{config.symbols?.length ?? 0} symbole{(config.symbols?.length ?? 0) > 1 ? "s" : ""}</span>
        </div>
      )}
      <div className="space-y-2">
        {(current.recommendations ?? []).map((rec) => (
          <div key={rec.message} className={cn("flex items-start justify-between gap-3 rounded-2xl border p-3 text-xs backdrop-blur-md", rec.type === "small-sample" ? "border-white/5 bg-black/20 text-muted-foreground" : "border-amber-500/20 bg-amber-500/10 text-amber-200")}>
            <span className="flex-1 font-medium">{rec.message}</span>
            {rec.type !== "small-sample" && (
              <button type="button" onClick={() => onApply(rec)} disabled={applyingRec === rec.message} className="shrink-0 rounded-xl border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-300 hover:bg-amber-500/30 transition-all disabled:opacity-50 cursor-pointer shadow-sm">
                {applyingRec === rec.message ? "Application..." : "Appliquer"}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
        <BreakdownTable rows={current.bySymbol} title="Répartition par Symbole" />
        <BreakdownTable rows={current.byConfidence} title="Répartition par Confiance" />
      </div>
    </div>
  );
}

function ConfigChangesPanel({ changes, loading }: { changes: ConfigChangeEntry[]; loading: boolean }) {
  if (loading) return <div className="rounded-3xl border border-white/10 bg-neutral-900/60 p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-400" /></div>;
  if (!changes || changes.length === 0) return null;
  function fmt(v: unknown): string {
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    if (typeof v === "number") return String(v);
    if (v == null) return "—";
    return String(v);
  }
  return (
    <div className="space-y-3 rounded-3xl border border-white/10 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl">
      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-muted-foreground pb-2 border-b border-white/5">
        <RefreshCw className="h-4 w-4 text-cyan-400" /> Historique des Modifications de Config
      </div>
      <div className="space-y-3">
        {[...changes].reverse().map((x) => (
          <div key={x.id} className="rounded-2xl border border-white/5 bg-black/30 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{new Date(x.changedAt).toLocaleString("fr-FR")} · Modifié par <span className="font-bold text-foreground">{x.changedBy}</span></span>
              {x.source === "auto-rollback" && <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/15 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-300">⏪ Rollback Automatique</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(x.fields).map(([k, { from, to }]) => (
                <span key={k} className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] text-cyan-200">
                  <span className="font-semibold">{CONFIG_FIELD_LABELS[k] ?? k}</span> <span className="text-muted-foreground line-through">{fmt(from)}</span> → <span className="font-black text-cyan-300">{fmt(to)}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Manual Trade Section (Prise Directe for admin) ──
const TRADE_SYMBOLS = [
  { value: "BOOM500", label: "BOOM 500", type: "binary" },
  { value: "BOOM1000", label: "BOOM 1000", type: "binary" },
  { value: "CRASH900", label: "CRASH 900", type: "binary" },
  { value: "frxEURUSD", label: "EUR/USD", type: "binary" },
  { value: "frxEURGBP", label: "EUR/GBP", type: "binary" },
  { value: "frxUSDCAD", label: "USD/CAD", type: "binary" },
  { value: "frxGBPUSD", label: "GBP/USD", type: "multiplier" },
  { value: "frxXAUUSD", label: "XAU/USD", type: "multiplier" },
  { value: "OTC_NDX", label: "OTC Nasdaq", type: "binary" },
  { value: "cryBTCUSD", label: "BTC/USD", type: "multiplier" },
];

function ManualTradeSection({ userId, preset, botRunning }: { userId: number; preset: string; botRunning: boolean }) {
  const { confirm } = useConfirm();
  const [symbol, setSymbol] = useState("CRASH900");
  const [direction, setDirection] = useState<"CALL" | "PUT" | "MULTUP" | "MULTDOWN">("PUT");
  const [stake, setStake] = useState(5);
  const [duration, setDuration] = useState(5);
  const [executing, setExecuting] = useState(false);

  const selectedSymbol = TRADE_SYMBOLS.find((s) => s.value === symbol);
  const isMultiplier = selectedSymbol?.type === "multiplier";

  useEffect(() => {
    if (isMultiplier && (direction === "CALL" || direction === "PUT")) setDirection("MULTUP");
    else if (!isMultiplier && (direction === "MULTUP" || direction === "MULTDOWN")) setDirection("CALL");
  }, [isMultiplier]); // eslint-disable-line react-hooks/exhaustive-deps

  async function executeTrade() {
    const confirmed = await confirm({
      title: `Exécuter ce trade pour l'utilisateur #${userId} ?`,
      description: `${symbol} · ${direction} · $${stake} · ${duration}min · preset ${preset}`,
      confirmLabel: "Exécuter",
      danger: true,
    });
    if (!confirmed) return;
    setExecuting(true);
    try {
      const res = await api.post<{ success: boolean; trade?: unknown; error?: string }>("/api/admin/force-trade", {
        userId, preset, symbol, direction, stake, durationMinutes: duration,
      });
      if (res.success) toast.success(`Trade exécuté — ${symbol} ${direction}`);
      else toast.error(res.error ?? "Échec du trade");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally { setExecuting(false); }
  }

  function sniperCrash900() {
    setSymbol("CRASH900");
    setDirection("PUT");
    setStake(5);
    setDuration(1);
  }

  return (
    <div className="rounded-3xl border border-amber-500/20 bg-neutral-900/60 p-5 backdrop-blur-xl shadow-xl space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-white/5">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-400">
          <Crosshair className="h-4 w-4" /> Prise Directe — Ordre Manuel Admin
        </div>
        <button onClick={sniperCrash900} className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition-all cursor-pointer">
          <Crosshair className="h-3.5 w-3.5" /> CRASH900 Sniper
        </button>
      </div>

      {!botRunning && (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 font-medium">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
          Le bot {presetLabels[preset as PresetKey]} n'est pas actif pour cet utilisateur. Démarrez le bot avant d'exécuter un ordre.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 rounded-2xl border border-white/5 bg-black/30 p-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Symbole</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/50 px-3 py-2 text-xs text-foreground font-mono">
            {TRADE_SYMBOLS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Direction</label>
          <div className="flex gap-1.5">
            {isMultiplier ? (
              <>
                <button onClick={() => setDirection("MULTUP")} className={cn("flex-1 rounded-xl border px-3 py-2 text-xs font-black transition-all cursor-pointer", direction === "MULTUP" ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300 shadow-sm" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground")}>
                  <TrendingUp className="h-3.5 w-3.5 inline mr-1" /> HAUT
                </button>
                <button onClick={() => setDirection("MULTDOWN")} className={cn("flex-1 rounded-xl border px-3 py-2 text-xs font-black transition-all cursor-pointer", direction === "MULTDOWN" ? "border-rose-500/40 bg-rose-500/20 text-rose-300 shadow-sm" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground")}>
                  <TrendingDown className="h-3.5 w-3.5 inline mr-1" /> BAS
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setDirection("CALL")} className={cn("flex-1 rounded-xl border px-3 py-2 text-xs font-black transition-all cursor-pointer", direction === "CALL" ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300 shadow-sm" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground")}>
                  <TrendingUp className="h-3.5 w-3.5 inline mr-1" /> CALL
                </button>
                <button onClick={() => setDirection("PUT")} className={cn("flex-1 rounded-xl border px-3 py-2 text-xs font-black transition-all cursor-pointer", direction === "PUT" ? "border-rose-500/40 bg-rose-500/20 text-rose-300 shadow-sm" : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground")}>
                  <TrendingDown className="h-3.5 w-3.5 inline mr-1" /> PUT
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Mise ($)</label>
          <Input type="number" min={0.5} step={0.5} value={stake} onChange={(e) => setStake(Math.max(0.5, parseFloat(e.target.value) || 0))} className="text-xs bg-black/50 border-white/10 font-mono" />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Durée (min){isMultiplier && " — N/A"}</label>
          <Input type="number" min={1} step={1} value={duration} onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 1))} disabled={isMultiplier} className="text-xs bg-black/50 border-white/10 font-mono" />
        </div>
      </div>

      <button
        onClick={executeTrade}
        disabled={!botRunning || executing}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-2xl border px-4 py-3.5 text-xs font-black uppercase tracking-wider transition-all disabled:opacity-40 cursor-pointer shadow-lg",
          direction.includes("UP") || direction === "CALL" ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30" : "border-rose-500/40 bg-rose-500/20 text-rose-300 hover:bg-rose-500/30",
        )}
      >
        {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {executing ? "Exécution en cours..." : `Exécuter ${symbol} ${direction} $${stake}`}
      </button>
    </div>
  );
}
