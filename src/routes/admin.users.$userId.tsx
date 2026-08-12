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
    <div className="p-4 md:p-6 space-y-5 max-w-[1200px] mx-auto">
      {/* ── Back button ── */}
      <button
        onClick={() => navigate({ to: "/admin" })}
        className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Retour à l'admin
      </button>

      {/* ── Header ── */}
      <div className="flex items-center gap-4 rounded-2xl border border-white/[0.08] bg-neutral-900/80 p-5 backdrop-blur-md shadow-xl">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500/20 to-indigo-500/20 text-cyan-400 text-lg font-bold border border-cyan-500/20">
          {profileUser.username.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-black tracking-tight text-foreground">{profileUser.username}</h1>
            {isAdmin && (
              <span className="rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-0.5 text-[10px] text-cyan-400 font-bold uppercase tracking-wider">admin</span>
            )}
            {!isAdmin && (
              <button onClick={() => { setEditingUsername(true); setUsernameDraft(profileUser.username); }} className="text-muted-foreground/50 hover:text-cyan-400 transition-colors">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="text-sm text-neutral-300 mt-1 flex items-center gap-2.5 flex-wrap">
            {profileUser.email} · Inscrit le {new Date(profileUser.created_at * 1000).toLocaleDateString("fr-FR")}
            <StatusBadge status={profileUser.status} />
          </div>
        </div>
      </div>

      {editingUsername && (
        <form onSubmit={submitRename} className="flex items-center gap-2">
          <Input value={usernameDraft} onChange={(e) => setUsernameDraft(e.target.value)} autoFocus maxLength={32} className="h-9 text-sm max-w-xs" />
          <Button type="submit" size="sm" disabled={renameBusy || !usernameDraft.trim()} className="h-9 px-3">
            {renameBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setEditingUsername(false)} disabled={renameBusy} className="h-9 px-3">
            <X className="h-4 w-4" />
          </Button>
        </form>
      )}

      {/* ── Action buttons ── */}
      {!isAdmin && (
        <div className="flex flex-wrap gap-2">
          {profileUser.status !== "approved" && (
            <button onClick={() => act("approve")} disabled={busyId === profileUser.id} className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] px-3.5 py-2 text-sm text-emerald-400 font-bold hover:bg-emerald-500/15 transition-colors disabled:opacity-50">
              <Check className="h-4 w-4" /> Approuver
            </button>
          )}
          {profileUser.status === "approved" && (
            <button onClick={() => act("revoke")} disabled={busyId === profileUser.id} className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3.5 py-2 text-sm text-amber-400 font-bold hover:bg-amber-500/15 transition-colors disabled:opacity-50">
              <ShieldOff className="h-4 w-4" /> Révoquer
            </button>
          )}
          <button onClick={() => act("reset-password")} disabled={busyId === profileUser.id} className="flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.08] px-3.5 py-2 text-sm text-indigo-300 font-bold hover:bg-indigo-500/15 transition-colors disabled:opacity-50">
            <KeyRound className="h-4 w-4" /> Réinitialiser le mot de passe
          </button>
          <button onClick={() => act("delete")} disabled={busyId === profileUser.id} className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-sm text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> Supprimer le compte
          </button>
        </div>
      )}

      {/* ── Recap stats ── */}
      {r && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-neutral-300">
            Solde <span className="text-orange-400 font-bold">{r.balance !== null && r.balance !== undefined ? `${r.currency} ${r.balance.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</span>
          </span>
          <span className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-neutral-300">
            {r.trades} trade{r.trades > 1 ? "s" : ""} <span className="text-foreground font-semibold">{r.trades ? `${r.winRate}%` : "—"}</span>
          </span>
          <span className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-neutral-300">
            P&L <span className={cn("font-bold", r.netPnl > 0 ? "text-emerald-400" : r.netPnl < 0 ? "text-rose-400" : "text-neutral-400")}>{r.netPnl > 0 ? "+" : ""}{r.netPnl.toFixed(2)} $</span>
          </span>
        </div>
      )}

      {/* ── Auto-Trader section ── */}
      {!isAdmin && (
        <div className="border-t border-white/[0.08] pt-5 space-y-3">
          {/* Bot status + toggle */}
          <div className="flex flex-col gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.08] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                Auto-Trader — {PRESET_ICONS[profilePreset]} {presetLabels[profilePreset]}
              </span>
              {botStatus[`${profileUser.id}:${profilePreset}`]?.running && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Actif
                </span>
              )}
            </div>
            <BotStatusCell status={botStatus[`${profileUser.id}:${profilePreset}`]} busy={botBusyId === profileUser.id} onToggle={(action) => toggleBot(profilePreset, action)} />
          </div>

          {/* Active presets overview summary */}
          {(() => {
            const activeList = PRESET_KEYS.filter((p) => botStatus[`${profileUser.id}:${p}`]?.running);
            return (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-2.5 flex items-center justify-between text-xs">
                <span className="text-muted-foreground font-medium">Presets actifs chez l'utilisateur :</span>
                {activeList.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {activeList.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        <span>{PRESET_ICONS[p]} {presetLabels[p]}</span>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/60 italic">Aucun bot actif</span>
                )}
              </div>
            );
          })()}

          {/* Preset tabs */}
          <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 shrink-0">Preset consulté</span>
            <div className="flex w-full shrink-0 flex-wrap items-center rounded-lg border border-white/5 bg-white/[0.02] p-1 gap-1 sm:w-auto">
              {PRESET_KEYS.map((p) => {
                const isRunning = botStatus[`${profileUser.id}:${p}`]?.running;
                const isSelected = profilePreset === p;
                return (
                  <button
                    key={p}
                    onClick={() => setProfilePreset(p)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all sm:flex-none relative",
                      isSelected
                        ? p.startsWith("boom")
                          ? "bg-orange-500/20 text-orange-300 border border-orange-500/40"
                          : p.startsWith("crash")
                            ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                            : p.startsWith("liquidity") || p.startsWith("gold")
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                              : p.startsWith("scalping")
                                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                                : "bg-violet-500/20 text-violet-300 border border-violet-500/40"
                        : "text-muted-foreground hover:text-foreground border border-transparent hover:bg-white/[0.04]",
                    )}
                  >
                    <span>{PRESET_ICONS[p]} {presetLabels[p]}</span>
                    {isRunning && (
                      <span className="relative flex h-2 w-2" title="Bot actif pour ce preset">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
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
              className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-40"
            >
              Réinitialiser
            </button>
          </div>

          {/* Strategy selector */}
          {matchingStrategies.length > 0 && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
                  <Dices className="h-3.5 w-3.5" /> Appliquer une stratégie
                </span>
              </div>
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
                      "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-bold transition-colors disabled:opacity-40",
                      strat.verified ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400 hover:bg-emerald-500/15" : "border-white/[0.08] bg-white/[0.03] text-white/60 hover:text-white hover:bg-white/[0.06]",
                    )}
                  >
                    {strategyBusy === profileUser.id && <Loader2 className="h-3 w-3 animate-spin" />}
                    {strat.verified && <Check className="h-3 w-3" />}
                    {strat.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Broker badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { label: "Deriv", active: profileUser.has_deriv, color: "red" },
              { label: "Kraken", active: profileUser.has_kraken, color: "violet" },
              { label: "Binance", active: profileUser.has_binance, color: "yellow" },
              { label: "OANDA", active: profileUser.has_oanda, color: "emerald" },
            ].map((b) => (
              <div key={b.label} className={cn("flex flex-col items-center gap-1.5 rounded-xl border px-3 py-2.5", `border-${b.color}-500/30 bg-${b.color}-500/[0.08]`)}>
                <span className={cn("text-[10px] font-bold uppercase tracking-wider", `text-${b.color}-400`)}>{b.label}</span>
                <span className={cn("h-2.5 w-2.5 rounded-full", b.active ? `bg-${b.color}-500` : "bg-white/10")} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Admin note ── */}
      <div className="border-t border-white/[0.08] pt-5 space-y-2.5">
        <div className="flex items-center justify-between">
          <label htmlFor="admin-note" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-neutral-300">
            <StickyNote className="h-3.5 w-3.5" /> Note interne (admin uniquement)
          </label>
          {noteSaving ? (
            <span className="text-xs text-muted-foreground/50 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Enregistrement...</span>
          ) : noteSavedAt ? (
            <span className="text-xs text-emerald-400 font-semibold">Enregistré ✓</span>
          ) : null}
        </div>
        <Textarea id="admin-note" value={noteDraft} onChange={(e) => { setNoteDraft(e.target.value); setNoteSavedAt(null); }} onBlur={saveNote} placeholder="Ex : client VIP, à recontacter..." rows={2} className="text-sm resize-none" />
      </div>

      {/* ── Insights panel ── */}
      {!journalLoading && journalInsights && (
        <UserInsightsPanel insights={journalInsights} config={journalConfig} mode={insightsMode} onModeChange={setInsightsMode} onApply={applyRecommendation} applyingRec={applyingRec} />
      )}

      {/* ── Auto rollback ── */}
      {journalConfig && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
              <RefreshCw className="h-3.5 w-3.5 text-amber-400" /> Rollback automatique
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Revient automatiquement aux anciennes valeurs si une dégradation est confirmée après un changement de config.</p>
          </div>
          <Switch checked={Boolean(journalConfig.autoRollbackEnabled)} disabled={autoRollbackBusy} onCheckedChange={toggleAutoRollback} />
        </div>
      )}

      {/* ── Config changes ── */}
      <ConfigChangesPanel changes={configChanges} loading={configChangesLoading} />

      {/* ── Mini journal ── */}
      <div className="border-t border-white/[0.08] pt-5 space-y-2.5">
        <div className="text-xs font-bold uppercase tracking-wider text-neutral-300">Mini journal — Bot ({presetLabels[profilePreset]})</div>
        {journalLoading ? (
          <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" /></div>
        ) : (() => {
          const outcomeTrades = journalTrades.filter((t) => t.status === "won" || t.status === "lost" || t.status === "open");
          const shown = outcomeTrades.slice(0, 24);
          const hiddenCount = outcomeTrades.length - shown.length;
          if (shown.length === 0) return <p className="text-sm text-muted-foreground font-semibold">Aucun trade bot enregistré.</p>;
          return (
            <div className="flex flex-wrap gap-1.5">
              {shown.map((t) => (
                <span key={t.id} title={`${t.symbol} · ${t.direction} · ${new Date(t.time).toLocaleString("fr-FR")} · Confiance ${t.confidence}%`} className={cn("rounded-lg px-2.5 py-1.5 text-xs font-bold font-mono", t.status === "won" ? "bg-emerald-500/10 text-emerald-400" : t.status === "lost" ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-500")}>
                  {t.status === "open" ? "…" : t.profit > 0 ? "+" : ""}{t.status === "open" ? "" : t.profit.toFixed(2)}
                </span>
              ))}
              {hiddenCount > 0 && <span className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground/50 bg-white/[0.02]">+{hiddenCount} autres</span>}
            </div>
          );
        })()}
      </div>

      {/* ── Trades manuels (Prise Directe) ── */}
      <div className="border-t border-white/[0.08] pt-5 space-y-2.5">
        <div className="flex items-center gap-2">
          <Crosshair className="h-3.5 w-3.5 text-cyan-400" />
          <div className="text-xs font-bold uppercase tracking-wider text-neutral-300">Trades manuels — Prise Directe</div>
          {manualTrades.length > 0 && (
            <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-400">{manualTrades.length}</span>
          )}
        </div>
        {journalLoading ? (
          <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-cyan-500" /></div>
        ) : (() => {
          const outcomeManual = manualTrades.filter((t) => t.status === "won" || t.status === "lost" || t.status === "open" || t.status === "error" || t.status === "pending");
          const shown = outcomeManual.slice(0, 30);
          const hiddenCount = outcomeManual.length - shown.length;
          const manualPnl = manualTrades.filter((t) => t.status === "won" || t.status === "lost").reduce((s, t) => s + t.profit, 0);
          const manualWins = manualTrades.filter((t) => t.status === "won").length;
          const manualLosses = manualTrades.filter((t) => t.status === "lost").length;
          if (shown.length === 0) return <p className="text-sm text-muted-foreground font-semibold">Aucun trade manuel.</p>;
          return (
            <div className="space-y-2">
              <div className="flex items-center gap-3 text-xs">
                <span className="font-bold text-muted-foreground">P&L: <span className={manualPnl >= 0 ? "text-emerald-400" : "text-rose-400"}>{manualPnl >= 0 ? "+" : ""}{manualPnl.toFixed(2)} $</span></span>
                <span className="text-emerald-400 font-bold">{manualWins}G</span>
                <span className="text-rose-400 font-bold">{manualLosses}P</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {shown.map((t) => (
                  <span key={t.id} title={`${t.symbol} · ${t.direction} · ${new Date(t.time).toLocaleString("fr-FR")} · ${t.stake}$`} className={cn("rounded-lg px-2.5 py-1.5 text-xs font-bold font-mono border", t.status === "won" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : t.status === "lost" ? "bg-rose-500/10 text-rose-400 border-rose-500/20" : t.status === "error" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" : "bg-cyan-500/10 text-cyan-400 border-cyan-500/20")}>
                    {t.symbol.replace("frx","").replace("cry","")} {t.direction === "MULTUP" ? "↑" : t.direction === "MULTDOWN" ? "↓" : t.direction === "CALL" ? "↑" : "↓"} {t.status === "open" || t.status === "pending" ? "…" : (t.profit > 0 ? "+" : "") + t.profit.toFixed(2)}
                  </span>
                ))}
                {hiddenCount > 0 && <span className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-muted-foreground/50 bg-white/[0.02] border border-white/[0.04]">+{hiddenCount} autres</span>}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Prise Directe (manual trading) ── */}
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
  const noToken = !enabled && !hasToken;
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider", running ? "bg-gradient-to-r from-emerald-500/20 to-emerald-600/10 text-emerald-400 border border-emerald-500/30" : enabled ? "bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30" : "bg-gradient-to-r from-slate-500/20 to-slate-600/10 text-slate-400 border border-slate-500/30")}>
        <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-emerald-400 animate-pulse" : enabled ? "bg-amber-400" : "bg-slate-400")} />
        {running ? "live" : enabled ? "en attente" : "arrêté"}
      </span>
      <Switch checked={enabled} disabled={busy || noToken} onCheckedChange={(v) => onToggle(v ? "start" : "stop")} title={noToken ? "Aucun token Deriv" : undefined} />
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
    <div className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
          <BrainCircuit className="h-4 w-4 text-violet-400" /> Analyse & réglages
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
          {(["demo", "live"] as const).map((m) => (
            <button key={m} type="button" onClick={() => onModeChange(m)} className={cn("px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-md transition-colors cursor-pointer", mode === m ? "bg-amber-500/15 text-amber-400" : "text-muted-foreground/50 hover:text-foreground")}>
              {m === "demo" ? "Démo" : "Live"}
            </button>
          ))}
        </div>
      </div>
      {config && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-muted-foreground/70">Mise <span className="text-foreground font-semibold">{config.stakeUsd}$</span></span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-muted-foreground/70">Confiance min <span className="text-foreground font-semibold">{config.minConfidence}%</span></span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-muted-foreground/70">{config.symbols?.length ?? 0} symbole{(config.symbols?.length ?? 0) > 1 ? "s" : ""}</span>
        </div>
      )}
      <div className="space-y-2">
        {(current.recommendations ?? []).map((rec) => (
          <div key={rec.message} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm", rec.type === "small-sample" ? "border-white/[0.05] bg-white/[0.01] text-muted-foreground/60" : "border-amber-500/15 bg-amber-500/[0.04] text-foreground/85")}>
            <span className="flex-1">{rec.message}</span>
            {rec.type !== "small-sample" && (
              <button type="button" onClick={() => onApply(rec)} disabled={applyingRec === rec.message} className="shrink-0 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50">
                {applyingRec === rec.message ? "..." : "Appliquer"}
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BreakdownTable rows={current.bySymbol} title="Par symbole" />
        <BreakdownTable rows={current.byConfidence} title="Par confiance" />
      </div>
    </div>
  );
}

function ConfigChangesPanel({ changes, loading }: { changes: ConfigChangeEntry[]; loading: boolean }) {
  if (loading) return <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" /></div>;
  if (!changes || changes.length === 0) return null;
  function fmt(v: unknown): string {
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    if (typeof v === "number") return String(v);
    if (v == null) return "—";
    return String(v);
  }
  return (
    <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
        <RefreshCw className="h-4 w-4 text-cyan-400" /> Historique des changements — avant / après
      </div>
      <div className="space-y-3">
        {[...changes].reverse().map((x) => (
          <div key={x.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{new Date(x.changedAt).toLocaleString("fr-FR")} · par <span className="font-semibold text-foreground">{x.changedBy}</span></span>
              {x.source === "auto-rollback" && <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">⏪ Rollback automatique</span>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(x.fields).map(([k, { from, to }]) => (
                <span key={k} className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.06] px-2 py-1 text-[11px] text-cyan-200">
                  <span className="font-semibold">{CONFIG_FIELD_LABELS[k] ?? k}</span> <span className="text-muted-foreground line-through">{fmt(from)}</span> → <span className="font-bold text-cyan-100">{fmt(to)}</span>
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
    <div className="border-t border-white/[0.08] pt-5 space-y-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-neutral-300">
        <Crosshair className="h-4 w-4 text-amber-400" /> Prise Directe — Trade manuel admin
      </div>

      {!botRunning && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Le bot {presetLabels[preset as PresetKey]} n'est pas actif — le trade ne peut pas être exécuté. Démarrez le bot d'abord.
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button onClick={sniperCrash900} className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-xs font-bold text-amber-400 hover:bg-amber-500/15 transition-colors">
          <Crosshair className="h-3.5 w-3.5" /> CRASH900 Sniper
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Symbole</label>
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-foreground">
            {TRADE_SYMBOLS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Direction</label>
          <div className="flex gap-1.5">
            {isMultiplier ? (
              <>
                <button onClick={() => setDirection("MULTUP")} className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors", direction === "MULTUP" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                  <TrendingUp className="h-4 w-4 inline mr-1" /> HAUT
                </button>
                <button onClick={() => setDirection("MULTDOWN")} className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors", direction === "MULTDOWN" ? "border-rose-500/40 bg-rose-500/15 text-rose-400" : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                  <TrendingDown className="h-4 w-4 inline mr-1" /> BAS
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setDirection("CALL")} className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors", direction === "CALL" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                  <TrendingUp className="h-4 w-4 inline mr-1" /> CALL
                </button>
                <button onClick={() => setDirection("PUT")} className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition-colors", direction === "PUT" ? "border-rose-500/40 bg-rose-500/15 text-rose-400" : "border-white/[0.08] bg-white/[0.03] text-muted-foreground hover:text-foreground")}>
                  <TrendingDown className="h-4 w-4 inline mr-1" /> PUT
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Mise ($)</label>
          <Input type="number" min={0.5} step={0.5} value={stake} onChange={(e) => setStake(Math.max(0.5, parseFloat(e.target.value) || 0))} className="text-sm" />
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">Durée (min){isMultiplier && " — N/A"}</label>
          <Input type="number" min={1} step={1} value={duration} onChange={(e) => setDuration(Math.max(1, parseInt(e.target.value) || 1))} disabled={isMultiplier} className="text-sm" />
        </div>
      </div>

      <button
        onClick={executeTrade}
        disabled={!botRunning || executing}
        className={cn(
          "w-full flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold uppercase tracking-wider transition-colors disabled:opacity-40",
          direction.includes("UP") || direction === "CALL" ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400 hover:bg-emerald-500/15" : "border-rose-500/30 bg-rose-500/[0.08] text-rose-400 hover:bg-rose-500/15",
        )}
      >
        {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
        {executing ? "Exécution..." : `Exécuter ${symbol} ${direction} $${stake}`}
      </button>
    </div>
  );
}
