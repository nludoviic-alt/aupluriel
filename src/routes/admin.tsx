import { createFileRoute, useNavigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useState, useMemo } from "react";
import {
  ShieldCheck, Check, X, Trash2, Loader2, RefreshCw, KeyRound,
  ShieldOff, UserPlus, Dices, TrendingUp, TrendingDown, BookOpen,
  BrainCircuit, Users, ShieldAlert, Award, Search, Key, RefreshCcw,
  Mail, Ban, Copy, Send, Lightbulb, AlertTriangle, Pencil, StickyNote,
  Lock, ChevronRight, Activity,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { KpiCard } from "@/components/kpi-card";
import { CollapsibleBlock } from "@/components/collapsible-section";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog, useConfirm } from "@/components/confirm-dialog";
import { OFFICIAL_PRESET_STRATEGIES, type PresetStrategyDef } from "@/lib/preset-strategies";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Administration — Au Pluriel" }] }),
  component: AdminPage,
});

interface AdminUser {
  id: number;
  email: string;
  username: string;
  email_verified: number;
  status: string;
  is_admin: number;
  chat_enabled: number;
  admin_note: string | null;
  created_at: number;
  has_deriv: number;
  has_kraken: number;
  has_binance: number;
  has_oanda: number;
}

interface BotStatus {
  userId: number;
  enabled: boolean;
  running: boolean;
  hasToken: boolean;
  mode: "demo" | "live" | null;
  preset: "boom" | "crash" | "default" | "scalping" | "liquidity" | "gold" | "crash900";
  lastError: string | null;
  autoBacktestEnabled: boolean;
}

interface BoomSymbolStat {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  lastTradeAt: number | null;
}

interface InviteCode {
  id: number;
  code: string;
  email: string;
  usedByUsername: string | null;
  usedAt: number | null;
  revoked: boolean;
  expiresAt: number;
  createdAt: number;
  status: "pending" | "used" | "revoked" | "expired";
}

interface UserRecap {
  userId: number;
  username: string;
  email: string;
  trades: number;
  wins: number;
  losses: number;
  open: number;
  winRate: number;
  netPnl: number;
  profitFactor: number | null;
  avgConfidence: number;
  lastTradeAt: number | null;
  balance: number | null;
  currency: string | null;
  tradesLive: number;
  netPnlLive: number;
}

interface DuplicateSignals {
  count: number;
  windowMs: number;
  samples: { symbol: string; direction: string; time: number; users: string[] }[];
}

interface ComponentStat {
  symbol: string;
  component: string;
  wins: number;
  losses: number;
  weight: number;
}

interface BacktestVsReal {
  reference: { evPerDollar: number; binaryNote: string; windowDays: number; simulatedTrades: number; measuredFromMs: number };
  live: { trades: number; evPerDollar: number | null; winRate: number | null; netPnl: number };
}

interface CalibrationBucket {
  bucket: string;
  trades: number;
  winRate: number | null;
  avgConfidence: number | null;
}

interface JournalTrade {
  id: string;
  time: number;
  symbol: string;
  direction: string;
  stake: number;
  payout: number;
  status: string;
  profit: number;
  confidence: number;
  tf_agreement: number;
  closed_at: number | null;
  note: string | null;
}

interface BreakdownRow {
  key: string;
  trades: number;
  wins: number;
  winRate: number | null;
  netPnl: number;
}

interface Recommendation {
  type: "disable-symbol" | "raise-confidence" | "small-sample";
  message: string;
  symbol?: string;
  suggestedMinConfidence?: number;
}

interface UserInsights {
  mode: "demo" | "live";
  totalTrades: number;
  bySymbol: BreakdownRow[];
  byConfidence: BreakdownRow[];
  bySession: BreakdownRow[];
  recommendations: Recommendation[];
}

interface UserBotConfig {
  mode: "demo" | "live";
  stakeUsd: number;
  minConfidence: number;
  symbols: string[];
  [key: string]: unknown;
}

interface PerfSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  expectancy: number;
}

interface ConfigChangeEntry {
  id: string;
  changedAt: number;
  changedBy: string;
  source: "user" | "admin" | "auto-rollback";
  fields: Record<string, { from: unknown; to: unknown }>;
  before: PerfSummary | null;
  beforeSampleSize: number;
  after: PerfSummary | null;
  afterSampleSize: number;
}

const CONFIG_FIELD_LABELS: Record<string, string> = {
  stakeUsd: "Mise",
  maxDailyLossUsd: "Limite perte/jour",
  maxDailyProfitUsd: "Objectif gain/jour",
  minConfidence: "Confiance min.",
  maxConfidence: "Confiance max.",
  minTfAgreement: "Accord TF min.",
  takeProfitPctOfStake: "TP % mise",
  stopLossPctOfStake: "SL % mise",
  multiplierLevel: "Levier",
  symbols: "Symboles",
  excludedSymbols: "Symboles exclus",
};

const presetLabels = { default: "Multi", boom: "Boom500", crash: "Crash900", scalping: "Scalping", liquidity: "GOLD LIQUIDITY SWEEP", gold: "GOLD TREND PULLBACK", crash900: "Crash900 V2" } as const;

type PresetKey = "default" | "boom" | "crash" | "scalping" | "liquidity" | "gold" | "crash900";
const PRESET_KEYS: readonly PresetKey[] = ["default", "boom", "crash", "scalping", "liquidity", "gold", "crash900"];
// Mirrors MAX_VISIBLE_PRESETS in bot-engine.server.ts (can't import a
// *.server.ts module from a client route) — the API rejects more than this,
// so the UI must not let you select more either. No artificial cap anymore:
// all presets can be shown on mobile.
const MAX_VISIBLE_PRESETS = PRESET_KEYS.length;

/** Static class strings only: Tailwind's JIT scanner can't see names built at
 * runtime like `border-${accent}-500/40`, which would silently emit no CSS in
 * the production build. */
const presetCardStyles: Record<PresetKey, { on: string; dot: string; icon: string; desc: string }> = {
  default: {
    on: "border-violet-500/40 bg-violet-500/[0.10]",
    dot: "bg-violet-500",
    icon: "🌐",
    desc: "Forex, or, crypto, indices",
  },
  boom: {
    on: "border-orange-500/40 bg-orange-500/[0.10]",
    dot: "bg-orange-500",
    icon: "🚀",
    desc: "Boom 1000 / 500 / 900",
  },
  crash: {
    on: "border-yellow-500/40 bg-yellow-500/[0.10]",
    dot: "bg-yellow-500",
    icon: "📉",
    desc: "Crash 1000 / 500 / 600 / 900",
  },
  scalping: {
    on: "border-cyan-500/40 bg-cyan-500/[0.10]",
    dot: "bg-cyan-500",
    icon: "⏱️",
    desc: "Boom 500 · M1/M5 · démo",
  },
  liquidity: {
    on: "border-fuchsia-500/40 bg-fuchsia-500/[0.10]",
    dot: "bg-fuchsia-500",
    icon: "↩",
    desc: "Or · Nasdaq · M15 · démo",
  },
  gold: {
    on: "border-yellow-500/40 bg-yellow-500/[0.10]",
    dot: "bg-yellow-500",
    icon: "🥇",
    desc: "Or (XAU/USD) · M15 · trend-following · démo",
  },
  crash900: {
    on: "border-orange-500/40 bg-orange-500/[0.10]",
    dot: "bg-orange-500",
    icon: "📉",
    desc: "Crash 900 · V2",
  },
};

const MOBILE_CARD_TINTS = [
  "from-cyan-500/[0.06]",
  "from-indigo-500/[0.06]",
  "from-violet-500/[0.06]",
  "from-emerald-500/[0.06]",
  "from-amber-500/[0.06]",
  "from-rose-500/[0.06]",
  "from-sky-500/[0.06]",
  "from-teal-500/[0.06]",
];

function mobileCardTint(userId: number) {
  return MOBILE_CARD_TINTS[userId % MOBILE_CARD_TINTS.length];
}

function AdminPage() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const { confirmState, confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", isAdmin: false });
  const [botStatus, setBotStatus] = useState<Record<string, BotStatus>>({});
  const [botBusyId, setBotBusyId] = useState<number | null>(null);
  const [presetBusy, setPresetBusy] = useState<number | null>(null);
  const [strategyBusy, setStrategyBusy] = useState<number | null>(null);
  const [backtestBusyId, setBacktestBusyId] = useState<number | null>(null);
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteActionId, setInviteActionId] = useState<number | null>(null);
  const [recap, setRecap] = useState<UserRecap[]>([]);
  const [backtestVsReal, setBacktestVsReal] = useState<BacktestVsReal | null>(null);
  const [componentBreakdown, setComponentBreakdown] = useState<ComponentStat[]>([]);
  const [calibration, setCalibration] = useState<CalibrationBucket[]>([]);
  const [recapLoading, setRecapLoading] = useState(true);
  // Scopes the trading recap table to one engine — lets an admin compare
  // accounts head-to-head on just Boom or just Crash instead of only the
  // all-presets-combined total, which hides which preset is actually
  // driving a difference between two users.
  const [recapPreset, setRecapPreset] = useState<"all" | PresetKey>("all");
  const [duplicateSignals, setDuplicateSignals] = useState<DuplicateSignals | null>(null);
  const [profileUser, setProfileUser] = useState<AdminUser | null>(null);
  // Which independent strategy row the panel below is showing/editing.
  const [profilePreset, setProfilePreset] = useState<PresetKey>("default");
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalConfig, setJournalConfig] = useState<UserBotConfig | null>(null);
  const [journalInsights, setJournalInsights] = useState<{ demo: UserInsights; live: UserInsights } | null>(null);
  const [configChanges, setConfigChanges] = useState<ConfigChangeEntry[]>([]);
  const [configChangesLoading, setConfigChangesLoading] = useState(false);
  const [insightsMode, setInsightsMode] = useState<"demo" | "live">("demo");
  const [applyingRec, setApplyingRec] = useState<string | null>(null);
  const [autoRollbackBusy, setAutoRollbackBusy] = useState(false);
  const [editingUsername, setEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [boomFilter, setBoomFilter] = useState(false);
  const [boomBreakdown, setBoomBreakdown] = useState<BoomSymbolStat[]>([]);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdBusy, setPwdBusy] = useState(false);
  const [pwdForm, setPwdForm] = useState({ current: "", next: "", confirm: "" });
  // Which preset tabs a user's Auto-Trader shows on mobile. Admin can manage
  // any user, not just themselves. Display filter only — a hidden preset keeps
  // trading, keeps appearing in this admin panel and in the journal, and
  // desktop still shows all four.
  const [visiblePresets, setVisiblePresets] = useState<PresetKey[] | null>(null);
  const [visiblePresetsBusy, setVisiblePresetsBusy] = useState(false);
  const [vpUserId, setVpUserId] = useState<number | null>(null);

  // Guard: only admins. Non-admins (or signed-out) get bounced home.
  useEffect(() => {
    if (authLoading) return;
    if (!user || !user.is_admin) navigate({ to: "/" });
  }, [authLoading, user, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ users: AdminUser[] }>("/api/admin/users");
      setUsers(data.users);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecap = useCallback(async () => {
    setRecapLoading(true);
    try {
      const qs = recapPreset === "all" ? "" : `?preset=${recapPreset}`;
      const data = await api.get<{ recap: UserRecap[]; componentBreakdown: ComponentStat[]; backtestVsReal?: BacktestVsReal; calibration?: CalibrationBucket[]; boomBreakdown?: BoomSymbolStat[]; duplicateSignals?: DuplicateSignals }>(`/api/admin/stats${qs}`);
      setRecap(data.recap);
      setComponentBreakdown(data.componentBreakdown);
      setBacktestVsReal(data.backtestVsReal ?? null);
      setCalibration(data.calibration ?? []);
      setBoomBreakdown(data.boomBreakdown ?? []);
      setDuplicateSignals(data.duplicateSignals ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement du récap");
    } finally {
      setRecapLoading(false);
    }
  }, [recapPreset]);

  const loadBotStatus = useCallback(async () => {
    try {
      const data = await api.get<{ statuses: BotStatus[] }>("/api/admin/bot");
      // Keyed by "userId:preset" — a user can have up to three independent
      // bot_state rows now (default/boom/crash, 2026-08-01), not just one.
      const map: Record<string, BotStatus> = {};
      for (const s of data.statuses) map[`${s.userId}:${s.preset}`] = s;
      setBotStatus(map);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement du statut auto-trader");
    }
  }, []);

  const loadInvites = useCallback(async () => {
    setInvitesLoading(true);
    try {
      const data = await api.get<{ invites: InviteCode[] }>("/api/admin/invites");
      setInvites(data.invites);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement des invitations");
    } finally {
      setInvitesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.is_admin) return;
    load();
    loadRecap();
    loadBotStatus();
    loadInvites();
    // Ran once on mount and never again — an admin watching another user's
    // bot (status, today's P&L, open positions) saw a frozen snapshot from
    // whenever the page loaded, not what's actually happening now. Bot
    // status and the trading recap are the two that actually change minute
    // to minute; users/invites barely move, so they stay on the manual
    // "Actualiser" button instead of adding load for no benefit.
    // Poll bot status + recap in parallel (was sequential — two round trips
    // stacked into one 20s tick). Promise.all halves the latency per tick.
    const id = setInterval(() => { void Promise.all([loadBotStatus(), loadRecap()]); }, 20_000);
    return () => clearInterval(id);
  }, [user?.is_admin, load, loadRecap, loadBotStatus, loadInvites]);

  // Load visible presets whenever the selected user changes. Defaults to the
  // admin's own account on first load.
  useEffect(() => {
    if (!user?.is_admin) return;
    const target = vpUserId ?? user.id;
    setVisiblePresets(null);
    api.get<{ visiblePresets: PresetKey[] }>(`/api/admin/visible-presets?userId=${target}`)
      .then((d) => setVisiblePresets(d.visiblePresets))
      .catch(() => setVisiblePresets(["default", "boom", "crash"]));
  }, [user?.is_admin, vpUserId]);

  async function toggleVisiblePreset(p: PresetKey) {
    if (visiblePresetsBusy || !visiblePresets || !user) return;
    const target = vpUserId ?? user.id;
    const isOn = visiblePresets.includes(p);
    if (isOn && visiblePresets.length === 1) {
      toast.error("Garde au moins un preset affiché — sinon l'Auto-Trader n'aurait plus aucun onglet.");
      return;
    }
    if (!isOn && visiblePresets.length >= MAX_VISIBLE_PRESETS) {
      toast.error(`Maximum ${MAX_VISIBLE_PRESETS} onglets sur mobile — désactive-en un d'abord.`);
      return;
    }
    // Rebuilt from PRESET_KEYS so the stored order always matches the tab
    // order on screen, whatever order they were clicked in.
    const nextSet = new Set(visiblePresets);
    if (isOn) nextSet.delete(p); else nextSet.add(p);
    const next = PRESET_KEYS.filter((k) => nextSet.has(k));

    const prev = visiblePresets;
    setVisiblePresets(next); // optimistic — reverted below if the API refuses
    setVisiblePresetsBusy(true);
    try {
      const res = await api.patch<{ visiblePresets: PresetKey[] }>("/api/admin/visible-presets", { userId: target, visiblePresets: next });
      setVisiblePresets(res.visiblePresets);
    } catch (err) {
      setVisiblePresets(prev);
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setVisiblePresetsBusy(false);
    }
  }

  async function changeOwnPassword() {
    if (pwdForm.next.length < 6) {
      toast.error("Le nouveau mot de passe doit faire au moins 6 caractères.");
      return;
    }
    if (pwdForm.next !== pwdForm.confirm) {
      toast.error("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setPwdBusy(true);
    try {
      await api.post("/api/auth/change-password", {
        currentPassword: pwdForm.current,
        newPassword: pwdForm.next,
      });
      toast.success("Mot de passe mis à jour ✓");
      setPwdOpen(false);
      setPwdForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setPwdBusy(false);
    }
  }

  async function loadProfileConfig(userId: number, preset: PresetKey) {
    setJournalLoading(true);
    try {
      const data = await api.get<{
        trades: JournalTrade[];
        config: UserBotConfig | null;
        insights: { demo: UserInsights; live: UserInsights };
      }>(`/api/admin/stats?userId=${userId}&preset=${preset}`);
      setJournalTrades(data.trades);
      setJournalConfig(data.config);
      setJournalInsights(data.insights);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement du profil");
    } finally {
      setJournalLoading(false);
    }
    setConfigChangesLoading(true);
    try {
      const data = await api.get<{ changes: ConfigChangeEntry[] }>(`/api/admin/config-changes?userId=${userId}&preset=${preset}`);
      setConfigChanges(data.changes);
    } catch {
      setConfigChanges([]);
    } finally {
      setConfigChangesLoading(false);
    }
  }

  function openProfile(u: AdminUser) {
    navigate({ to: "/admin/users/$userId", params: { userId: String(u.id) } });
  }

  async function applyRecommendation(rec: Recommendation) {
    if (!profileUser || !journalConfig) return;
    setApplyingRec(rec.message);
    try {
      const patch: { userId: number; preset: PresetKey; symbols?: string[]; minConfidence?: number } = { userId: profileUser.id, preset: profilePreset };
      if (rec.type === "disable-symbol" && rec.symbol) {
        patch.symbols = (journalConfig?.symbols ?? []).filter((s) => s !== rec.symbol);
      } else if (rec.type === "raise-confidence" && rec.suggestedMinConfidence !== undefined) {
        patch.minConfidence = rec.suggestedMinConfidence;
      } else {
        return;
      }
      const res = await api.patch<{ config: UserBotConfig }>("/api/admin/user-config", patch);
      setJournalConfig(res.config);
      toast.success("Configuration mise à jour ✓");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible d'appliquer la recommandation");
    } finally {
      setApplyingRec(null);
    }
  }

  async function toggleAutoRollback(enabled: boolean) {
    if (!profileUser) return;
    setAutoRollbackBusy(true);
    try {
      const res = await api.patch<{ config: UserBotConfig }>("/api/admin/user-config", {
        userId: profileUser.id, preset: profilePreset, autoRollbackEnabled: enabled,
      });
      setJournalConfig(res.config);
      toast.success(enabled ? "Rollback automatique activé ✓" : "Rollback automatique désactivé");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de changer ce réglage");
    } finally {
      setAutoRollbackBusy(false);
    }
  }

  function startEditUsername() {
    if (!profileUser) return;
    setUsernameDraft(profileUser.username);
    setEditingUsername(true);
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    if (!profileUser) return;
    const trimmed = usernameDraft.trim();
    if (!trimmed || trimmed === profileUser.username) {
      setEditingUsername(false);
      return;
    }
    setRenameBusy(true);
    try {
      await api.post("/api/admin/users", { userId: profileUser.id, action: "edit-username", username: trimmed });
      toast.success("Nom d'utilisateur mis à jour ✓");
      setProfileUser((p) => (p ? { ...p, username: trimmed } : p));
      setEditingUsername(false);
      await load();
      await loadRecap();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible de renommer cet utilisateur");
    } finally {
      setRenameBusy(false);
    }
  }

  async function saveNote() {
    if (!profileUser) return;
    const trimmed = noteDraft.trim();
    if (trimmed === (profileUser.admin_note ?? "")) return;
    setNoteSaving(true);
    try {
      await api.post("/api/admin/users", { userId: profileUser.id, action: "edit-note", note: trimmed });
      setProfileUser((p) => (p ? { ...p, admin_note: trimmed || null } : p));
      setUsers((prev) => prev.map((u) => (u.id === profileUser.id ? { ...u, admin_note: trimmed || null } : u)));
      setNoteSavedAt(Date.now());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Impossible d'enregistrer la note");
    } finally {
      setNoteSaving(false);
    }
  }

  async function act(
    userId: number,
    action: "approve" | "reject" | "revoke" | "delete" | "reset-password" | "toggle-chat",
    chatEnabled?: boolean
  ) {
    let ok = true;
    if (action === "delete") {
      ok = await confirm({
        title: "Supprimer le compte ?",
        description: "Cette action supprimera définitivement ce compte utilisateur et toutes ses données associées.",
        confirmLabel: "Supprimer",
        danger: true,
      });
    } else if (action === "revoke") {
      ok = await confirm({
        title: "Révoquer l'accès ?",
        description: "L'accès de cet utilisateur sera révoqué et ses sessions actives seront déconnectées.",
        confirmLabel: "Révoquer",
        danger: true,
      });
    } else if (action === "approve") {
      ok = await confirm({
        title: "Approuver le compte ?",
        description: "Voulez-vous approuver ce compte utilisateur pour l'autoriser à se connecter ?",
        confirmLabel: "Approuver",
        danger: false,
      });
    } else if (action === "reject") {
      ok = await confirm({
        title: "Rejeter le compte ?",
        description: "Voulez-vous rejeter ce compte utilisateur ?",
        confirmLabel: "Rejeter",
        danger: true,
      });
    } else if (action === "reset-password") {
      ok = await confirm({
        title: "Réinitialiser le mot de passe ?",
        description: "Un email de réinitialisation de mot de passe sera envoyé à cet utilisateur.",
        confirmLabel: "Envoyer l'email",
        danger: false,
      });
    }

    if (!ok) return;
    setBusyId(userId);
    try {
      await api.post("/api/admin/users", { userId, action, chatEnabled });
      const msg: Record<string, string> = {
        approve: "Compte approuvé ✓",
        reject: "Compte rejeté",
        revoke: "Accès révoqué",
        delete: "Compte supprimé",
        "reset-password": "Lien de réinitialisation envoyé par email",
        "toggle-chat": chatEnabled ? "Messagerie activée ✓" : "Messagerie désactivée",
      };
      toast.success(msg[action] ?? "Action effectuée");
      await load();
      await loadRecap();
      setProfileUser((p) => {
        if (!p || p.id !== userId) return p;
        if (action === "delete") return null;
        if (action === "approve") return { ...p, status: "approved", email_verified: 1 };
        if (action === "reject") return { ...p, status: "rejected" };
        if (action === "revoke") return { ...p, status: "suspended" };
        if (action === "toggle-chat") return { ...p, chat_enabled: chatEnabled ? 1 : 0 };
        return p;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleBot(userId: number, preset: PresetKey, action: "start" | "stop") {
    setBotBusyId(userId);
    try {
      await api.post("/api/admin/bot", { userId, preset, action });
      toast.success(action === "start" ? "Auto-trader activé ✓" : "Auto-trader désactivé");
      await loadBotStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBotBusyId(null);
    }
  }

  async function toggleBacktest(userId: number, autoBacktestEnabled: boolean) {
    setBacktestBusyId(userId);
    try {
      await api.post("/api/admin/bot", { userId, action: "toggle-backtest", autoBacktestEnabled });
      toast.success(autoBacktestEnabled ? "Backtest automatique activé ✓" : "Backtest automatique désactivé");
      await loadBotStatus();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBacktestBusyId(null);
    }
  }

  async function createInvite() {
    if (!inviteEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
      toast.error("Email invalide.");
      return;
    }
    setInviteBusy(true);
    try {
      await api.post("/api/admin/invites", { action: "create", email: inviteEmail.trim() });
      toast.success("Invitation envoyée par email ✓");
      setInviteEmail("");
      await loadInvites();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setInviteBusy(false);
    }
  }

  async function inviteAction(id: number, action: "revoke" | "resend" | "delete") {
    let ok = true;
    if (action === "delete") {
      ok = await confirm({
        title: "Supprimer l'invitation ?",
        description: "Cette invitation sera supprimée définitivement.",
        confirmLabel: "Supprimer",
        danger: true,
      });
    } else if (action === "revoke") {
      ok = await confirm({
        title: "Révoquer l'invitation ?",
        description: "Cette invitation sera révoquée et ne pourra plus être utilisée pour s'inscrire.",
        confirmLabel: "Révoquer",
        danger: true,
      });
    } else if (action === "resend") {
      ok = await confirm({
        title: "Renvoyer l'invitation ?",
        description: "Renvoyer l'email d'invitation à cette adresse ?",
        confirmLabel: "Renvoyer",
        danger: false,
      });
    }

    if (!ok) return;
    setInviteActionId(id);
    try {
      await api.post("/api/admin/invites", { id, action });
      const msg: Record<string, string> = {
        revoke: "Invitation révoquée",
        resend: "Email renvoyé ✓",
        delete: "Invitation supprimée",
      };
      toast.success(msg[action]);
      await loadInvites();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setInviteActionId(null);
    }
  }

  function copyInviteCode(code: string) {
    navigator.clipboard.writeText(code).then(() => toast.success("Code copié"));
  }

  function generatePassword() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    const password = Array.from(bytes, (n) => chars[n % chars.length]).join("");
    setForm((f) => ({ ...f, password }));
  }

  async function createAccount() {
    if (!form.username || !form.email || !form.password) {
      toast.error("Nom d'utilisateur, email et mot de passe requis.");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Le mot de passe doit faire au moins 6 caractères.");
      return;
    }
    setCreateBusy(true);
    try {
      await api.post("/api/admin/users", {
        action: "create",
        username: form.username,
        email: form.email,
        password: form.password,
        isAdmin: form.isAdmin,
      });
      toast.success("Compte créé ✓");
      setCreateOpen(false);
      setForm({ username: "", email: "", password: "", isAdmin: false });
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la création");
    } finally {
      setCreateBusy(false);
    }
  }

  if (authLoading || !user?.is_admin) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
      </div>
    );
  }

  const pending = users.filter((u) => u.status === "pending");
  const totalNetPnl = recap.reduce((sum, r) => sum + r.netPnl, 0);
  const activeUsers = recap.filter((r) => r.trades > 0);
  const avgWinRate = activeUsers.length
    ? activeUsers.reduce((sum, r) => sum + r.winRate, 0) / activeUsers.length
    : 0;

  const boomUserIds = new Set(Object.values(botStatus).filter((s) => s.preset === "boom").map((s) => s.userId));
  const filteredUsers = users.filter(
    (u) =>
      (!boomFilter || boomUserIds.has(u.id)) &&
      (u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  const boomUsersCount = boomUserIds.size;
  const boomRecaps = recap.filter((r) => boomUserIds.has(r.userId));
  const boomTotalPnl = boomRecaps.reduce((sum, r) => sum + r.netPnl, 0);
  const boomTotalTrades = boomRecaps.reduce((sum, r) => sum + r.trades, 0);
  const boomBreakdownTotal = boomBreakdown.reduce((acc, b) => ({ trades: acc.trades + b.trades, wins: acc.wins + b.wins, losses: acc.losses + b.losses, netPnl: acc.netPnl + b.netPnl }), { trades: 0, wins: 0, losses: 0, netPnl: 0 });

  // If we're on a child route (/admin/users/:id), render only the Outlet
  // so the user profile page replaces the admin content entirely.
  if (routerState.location.pathname.startsWith("/admin/users/")) return <Outlet />;

  return (
    <div className="mx-auto max-w-screen-2xl px-2 sm:px-4 md:px-16 lg:px-24 py-6 space-y-6">
      
      {/* ── HEADER ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 flex items-center justify-center rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.15)]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight text-foreground leading-none">Administration</h1>
            <p className="text-xs text-muted-foreground mt-1">Gérez les terminaux, approuvez les comptes et suivez la télémétrie.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPwdOpen(true)}
            className="flex-1 sm:flex-none h-8.5 text-xs sm:h-8 px-3 border-white/5 hover:bg-white/[0.04]"
          >
            <Lock className="h-3.5 w-3.5 mr-1.5" />
            Mon mot de passe
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="flex-1 sm:flex-none h-8.5 text-xs sm:h-8 px-3 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white font-bold"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Créer un compte
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { load(); loadRecap(); loadBotStatus(); loadInvites(); }}
            className="flex-1 sm:flex-none h-8.5 text-xs sm:h-8 px-3 border-white/5 hover:bg-white/[0.04]"
            disabled={loading || recapLoading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", (loading || recapLoading) && "animate-spin")} />
            Actualiser
          </Button>
        </div>
      </div>

      {/* ── KPI STATS GRID ── */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total Utilisateurs"
          value={users.length}
          delta={`${users.filter(u => u.email_verified).length} vérifiés`}
          icon={<Users className="h-5 w-5 text-cyan-400" />}
          tone="cyan"
        />
        <KpiCard
          label="En attente"
          value={pending.length}
          delta={pending.length > 0 ? "Action requise !" : "Aucune attente"}
          icon={<ShieldAlert className={cn("h-5 w-5", pending.length > 0 ? "text-amber-500 animate-pulse" : "text-muted-foreground")} />}
          tone={pending.length > 0 ? "amber" : "default"}
        />
        <KpiCard
          label="P&L Cumulé (Tous)"
          value={`${totalNetPnl >= 0 ? "+" : ""}${totalNetPnl.toFixed(2)} $`}
          delta={`${recap.reduce((sum, r) => sum + r.trades, 0)} trades totaux`}
          icon={totalNetPnl >= 0 ? <TrendingUp className="h-5 w-5 text-[color:var(--bull)]" /> : <TrendingDown className="h-5 w-5 text-[color:var(--bear)]" />}
          tone={totalNetPnl >= 0 ? "bull" : "bear"}
        />
        <KpiCard
          label="Taux de Réussite Moyen"
          value={`${avgWinRate.toFixed(1)}%`}
          delta={`${activeUsers.length} compte(s) actif(s)`}
          icon={<Award className="h-5 w-5 text-indigo-400" />}
          tone={avgWinRate >= 54.1 ? "bull" : "default"}
        />
      </div>

      {/* ── BOOM KPI ROW ── */}
      {boomUsersCount > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiCard
            label="🚀 Users Boom"
            value={boomUsersCount}
            delta={`${boomRecaps.filter((r) => r.trades > 0).length} actif(s)`}
            icon={<Dices className="h-5 w-5 text-orange-400" />}
            tone="amber"
          />
          <KpiCard
            label="🚀 Trades Boom"
            value={boomTotalTrades}
            delta={`${boomBreakdownTotal.trades} sur index Boom`}
            icon={<TrendingUp className="h-5 w-5 text-orange-400" />}
            tone="amber"
          />
          <KpiCard
            label="🚀 P&L Boom"
            value={`${boomTotalPnl >= 0 ? "+" : ""}${boomTotalPnl.toFixed(2)} $`}
            delta={boomTotalPnl >= 0 ? "Profit" : "Perte"}
            icon={boomTotalPnl >= 0 ? <TrendingUp className="h-5 w-5 text-[color:var(--bull)]" /> : <TrendingDown className="h-5 w-5 text-[color:var(--bear)]" />}
            tone={boomTotalPnl >= 0 ? "bull" : "bear"}
          />
          <KpiCard
            label="🚀 Win Rate Boom"
            value={boomBreakdownTotal.trades > 0 ? `${((boomBreakdownTotal.wins / boomBreakdownTotal.trades) * 100).toFixed(1)}%` : "—"}
            delta={`${boomBreakdownTotal.wins}W / ${boomBreakdownTotal.losses}L`}
            icon={<Award className="h-5 w-5 text-orange-400" />}
            tone="amber"
          />
        </div>
      )}

      {/* ── MOBILE PRESET TABS ──────────────────────────────────────────────
          Used to cap this at three of the four tabs to fit a phone-width
          strip; the cap is gone (2026-08-03) so the admin can show every
          preset. Display filter ONLY: a preset hidden here keeps trading,
          keeps its P&L in the recap above, and desktop always shows all of
          them — which is why a running-but-hidden preset gets an explicit
          warning below rather than being silently forgotten. ── */}
      <CollapsibleBlock
        className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
        defaultOpen
        header={
          <div>
            <h2 className="text-base font-bold text-foreground">Onglets Auto-Trader (mobile)</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choisis les presets affichés sur mobile — tous peuvent l'être. N'arrête aucun bot — sur ordinateur, ils restent tous visibles.
            </p>
          </div>
        }
      >
        {visiblePresets === null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : (
          <>
            {/* User selector — admin can manage any user's mobile tabs, not just their own. */}
            <div className="flex items-center gap-2 mb-1">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Utilisateur</label>
              <select
                value={vpUserId ?? user!.id}
                onChange={(e) => setVpUserId(Number(e.target.value))}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm text-foreground focus:border-orange-500/40 focus:outline-none"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id} className="bg-[#0A0A0A]">
                    {u.username}{u.id === user!.id ? " (toi)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {PRESET_KEYS.map((p) => {
                const st = presetCardStyles[p];
                const on = visiblePresets.includes(p);
                // botStatus is keyed by `${userId}:${preset}` — use the
                // selected user's id, not just the admin's own.
                const targetId = vpUserId ?? user!.id;
                const running = !!botStatus[`${targetId}:${p}`]?.running;
                const atCap = !on && visiblePresets.length >= MAX_VISIBLE_PRESETS;
                const lastOne = on && visiblePresets.length === 1;
                return (
                  <button
                    key={p}
                    onClick={() => toggleVisiblePreset(p)}
                    disabled={visiblePresetsBusy || atCap || lastOne}
                    className={cn(
                      "text-left rounded-xl border p-3.5 transition-all",
                      on ? st.on : "border-white/[0.06] bg-white/[0.02]",
                      (atCap || lastOne) && "opacity-45 cursor-not-allowed",
                      !visiblePresetsBusy && !atCap && !lastOne && "hover:border-white/20",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-lg leading-none">{st.icon}</span>
                      <span
                        className={cn(
                          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                          on ? st.dot : "bg-white/10",
                        )}
                      >
                        <span
                          className={cn(
                            "absolute h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                            on ? "translate-x-[19px]" : "translate-x-[3px]",
                          )}
                        />
                      </span>
                    </div>
                    <div className="mt-2 text-sm font-bold text-foreground">{presetLabels[p]}</div>
                    <div className="text-[11px] text-muted-foreground leading-snug">{st.desc}</div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className={cn("h-1.5 w-1.5 rounded-full", running ? "bg-[color:var(--bull)] animate-pulse" : "bg-white/20")} />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {running ? "Bot actif" : "Bot arrêté"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="text-[11px] text-muted-foreground">
              {visiblePresets.length}/{MAX_VISIBLE_PRESETS} affichés · masqués :{" "}
              {PRESET_KEYS.filter((p) => !visiblePresets.includes(p)).map((p) => presetLabels[p]).join(", ") || "aucun"}
            </p>

            {/* A hidden preset that's still trading is the one genuinely
                confusing case: it keeps taking positions with no tab on mobile
                to see or stop it. Called out explicitly instead of relying on
                the admin remembering. */}
            {(() => {
              const targetId = vpUserId ?? user!.id;
              const hiddenRunning = PRESET_KEYS.filter(
                (p) => !visiblePresets.includes(p) && botStatus[`${targetId}:${p}`]?.running,
              );
              if (!hiddenRunning.length) return null;
              return (
                <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] p-3">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    <strong>{hiddenRunning.map((p) => presetLabels[p]).join(", ")}</strong> tourne encore mais n'a plus
                    d'onglet sur mobile — il continue de trader et tu ne pourras l'arrêter que depuis un ordinateur ou en
                    le réaffichant ici.
                  </p>
                </div>
              );
            })()}
          </>
        )}
      </CollapsibleBlock>

      {/* ── USER MANAGEMENT SECTION ── */}
      <CollapsibleBlock
        className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
        defaultOpen
        header={
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Gestion des Utilisateurs</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Approuvez, révoquez ou supprimez des comptes.</p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setBoomFilter((v) => !v)}
                className={cn(
                  "shrink-0 rounded-xl border px-3 h-9 text-xs font-bold uppercase tracking-wider transition-all",
                  boomFilter
                    ? "border-orange-500/40 bg-orange-500/15 text-orange-400"
                    : "border-white/5 bg-white/[0.03] text-muted-foreground hover:text-foreground"
                )}
              >
                🚀 Boom
              </button>
              <div className="relative flex-1 sm:w-64 group">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 group-focus-within:text-orange-400 transition-colors" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Rechercher pseudo / email..."
                  className="w-full h-9 bg-white/[0.03] border border-white/5 rounded-xl pl-10 pr-4 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500/30 focus:border-orange-500/30 transition-all"
                />
              </div>
            </div>
          </div>
        }
      >
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02] text-left text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Brokers</th>
                <th className="px-4 py-3">Inscrit</th>
                <th className="px-4 py-3 text-right">Profil</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" />
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground font-semibold">
                    Aucun utilisateur trouvé.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const initials = u.username.slice(0, 2).toUpperCase();
                  const isAdmin = u.is_admin === 1;
                  return (
                    <tr
                      key={u.id}
                      onClick={() => openProfile(u)}
                      className="border-t border-white/[0.06] hover:bg-white/[0.02] transition-all duration-300 cursor-pointer"
                    >
                      <td className="px-4 py-3 font-semibold text-foreground">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500/20 to-indigo-500/20 text-cyan-400 text-xs font-bold border border-cyan-500/20 shadow-[0_0_10px_rgba(6,182,212,0.15)]">
                            {initials}
                          </div>
                          <div>
                            <div className="font-bold text-foreground flex items-center gap-1.5">
                              {u.username}
                              {isAdmin ? (
                                <span className="rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 text-[9px] text-cyan-400 font-bold uppercase tracking-wider shadow-[0_0_8px_rgba(6,182,212,0.1)]">
                                  admin
                                </span>
                              ) : (
                                <span className="rounded-full bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[9px] text-muted-foreground font-bold uppercase tracking-wider">
                                  trader
                                </span>
                              )}
                              {boomUserIds.has(u.id) && (
                                <span className="rounded-full bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 text-[9px] text-orange-400 font-bold uppercase tracking-wider">
                                  🚀 Boom
                                </span>
                              )}
                            </div>
                            {!u.email_verified && (
                              <div className="text-[9px] text-amber-400/70 font-semibold mt-0.5">email non vérifié</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-medium">{u.email}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={u.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <BrokerDot label="D" active={u.has_deriv === 1} color="red" />
                          <BrokerDot label="K" active={u.has_kraken === 1} color="violet" />
                          <BrokerDot label="B" active={u.has_binance === 1} color="yellow" />
                          <BrokerDot label="O" active={u.has_oanda === 1} color="emerald" />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-semibold">
                        {new Date(u.created_at * 1000).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); openProfile(u); }}
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-foreground hover:bg-white/[0.08] transition-colors"
                        >
                          Voir le profil
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards - High-End User-Friendly Design */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-orange-500" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground font-semibold">
              Aucun utilisateur trouvé.
            </div>
          ) : (
            filteredUsers.map((u) => {
              const initials = u.username.slice(0, 2).toUpperCase();
              const isAdmin = u.is_admin === 1;
              const registrationDate = new Date(u.created_at * 1000).toLocaleDateString("fr-FR", {
                day: "numeric",
                month: "short",
                year: "numeric",
              });

              return (
                <div
                  key={u.id}
                  onClick={() => openProfile(u)}
                  className={cn("group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b to-black/40 p-4 space-y-3.5 shadow-lg active:scale-[0.985] transition-all duration-200 cursor-pointer", mobileCardTint(u.id))}
                >
                  {/* Top Bar: Avatar + Username + Role Badges + Status */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Avatar Badge */}
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500/25 via-indigo-500/20 to-purple-500/25 text-cyan-300 font-mono text-sm font-black border border-cyan-500/30 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                        {initials}
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-black text-foreground text-base truncate">{u.username}</span>
                          {isAdmin ? (
                            <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[9px] font-black uppercase text-cyan-300 tracking-wider shadow-sm">
                              ADMIN
                            </span>
                          ) : (
                            <span className="rounded-full bg-white/[0.06] border border-white/10 px-2 py-0.5 text-[9px] font-black uppercase text-muted-foreground tracking-wider">
                              TRADER
                            </span>
                          )}
                          {boomUserIds.has(u.id) && (
                            <span className="rounded-full bg-orange-500/15 border border-orange-500/30 px-2 py-0.5 text-[9px] font-black uppercase text-orange-400 tracking-wider">
                              🚀 BOOM
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground/80 font-mono truncate">{u.email}</div>
                      </div>
                    </div>

                    {/* Status Pill Badge */}
                    <div className="shrink-0">
                      <StatusBadge status={u.status} />
                    </div>
                  </div>

                  {/* Middle Info Bar: Registration date & Verification Status */}
                  <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2.5 text-xs text-muted-foreground font-semibold">
                    <div className="flex items-center gap-1">
                      <span>Inscrit le</span>
                      <span className="font-mono text-foreground/90 font-bold">{registrationDate}</span>
                    </div>
                    <div>
                      {u.email_verified ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-bold">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Email vérifié
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/80 font-bold">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          Email non vérifié
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Inset Box: Connected Brokers */}
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-black/40 px-3 py-2 text-xs">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      Brokers connectés
                    </span>
                    <div className="flex items-center gap-2">
                      <BrokerDot label="D" active={u.has_deriv === 1} color="red" />
                      <BrokerDot label="K" active={u.has_kraken === 1} color="violet" />
                      <BrokerDot label="B" active={u.has_binance === 1} color="yellow" />
                      <BrokerDot label="O" active={u.has_oanda === 1} color="emerald" />
                    </div>
                  </div>

                  {/* Full-width CTA Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openProfile(u);
                    }}
                    className="w-full h-10 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-black text-foreground hover:bg-white/[0.08] active:scale-[0.98] transition-all shadow-sm"
                  >
                    <span>Gérer le profil utilisateur</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </CollapsibleBlock>

      {/* ── INVITE CODES SECTION ── */}
      <CollapsibleBlock
        className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
        header={
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Codes d'invitation</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Génère un code lié à un email et envoie-le automatiquement.</p>
            </div>
            <div className="flex gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64 group">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500 group-focus-within:text-orange-400 transition-colors" />
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createInvite()}
                placeholder="email@destinataire.com"
                className="w-full h-9 bg-white/[0.03] border border-white/5 rounded-xl pl-10 pr-4 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-orange-500/30 focus:border-orange-500/30 transition-all"
              />
            </div>
            <Button
              size="sm"
              onClick={createInvite}
              disabled={inviteBusy}
              className="h-9 px-3 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white font-bold text-xs shrink-0"
            >
              {inviteBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Send className="h-3.5 w-3.5 mr-1.5" />Envoyer</>}
            </Button>
          </div>
        </div>
        }
      >
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02] text-left text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Expire</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitesLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" />
                  </td>
                </tr>
              ) : invites.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground font-semibold">
                    Aucune invitation envoyée.
                  </td>
                </tr>
              ) : (
                invites.map((inv) => (
                  <tr key={inv.id} className="border-t border-white/[0.06] hover:bg-white/[0.01] transition-all duration-300">
                    <td className="px-4 py-3 font-semibold text-foreground">{inv.email}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => copyInviteCode(inv.code)}
                        title="Copier le code"
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-white transition-colors"
                      >
                        {inv.code}
                        <Copy className="h-3 w-3" />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <InviteStatusBadge status={inv.status} usedByUsername={inv.usedByUsername} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-semibold text-xs">
                      {new Date(inv.expiresAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {inv.status === "pending" && (
                          <>
                            <button
                              onClick={() => inviteAction(inv.id, "resend")}
                              disabled={inviteActionId === inv.id}
                              title="Renvoyer l'email"
                              className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-2 text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                            >
                              <RefreshCcw className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => inviteAction(inv.id, "revoke")}
                              disabled={inviteActionId === inv.id}
                              title="Révoquer"
                              className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-amber-500 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => inviteAction(inv.id, "delete")}
                          disabled={inviteActionId === inv.id}
                          title="Supprimer"
                          className="rounded-xl border border-white/5 bg-white/[0.02] p-2 text-muted-foreground hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleBlock>

      {/* ── TRADING RECAP BY USER ── desktop only ── */}
      <CollapsibleBlock
        className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-4 sm:p-5 space-y-4 hidden md:block"
        header={
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.15)]">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-foreground">Récapitulatif de Trading</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Suivi des performances individuelles en temps réel.</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={loadRecap} disabled={recapLoading} className="h-9 border-white/5 hover:bg-white/[0.04] shrink-0">
              <RefreshCw className={cn("h-4 w-4 mr-1.5", recapLoading && "animate-spin")} />
              Actualiser
            </Button>
          </div>
        }
      >
        {/* Preset scope — compare accounts on one engine at a time instead of
            only the all-presets-combined total. */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/5 bg-white/[0.02] p-1 w-full sm:w-fit">
          {(["all", "default", "boom", "crash", "scalping", "liquidity", "gold", "crash900"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setRecapPreset(p)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-all",
                recapPreset === p ? "bg-orange-500/25 text-orange-300" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p === "all" ? "Tous" : presetLabels[p]}
            </button>
          ))}
        </div>

        {/* Duplicate-signal notice — both accounts scan off the same shared
            learned weights, so a P&L difference between them can partly be
            the SAME market call taken twice, not two independent edges. */}
        {duplicateSignals && duplicateSignals.count > 0 && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-4 py-3 text-xs text-amber-200/90">
            <span className="font-bold text-amber-300">{duplicateSignals.count} signal{duplicateSignals.count > 1 ? "aux" : ""} dupliqué{duplicateSignals.count > 1 ? "s" : ""}</span>
            {" "}détecté{duplicateSignals.count > 1 ? "s" : ""} — même symbole/direction pris par deux comptes différents à moins de {Math.round(duplicateSignals.windowMs / 1000)}s d'écart (signal partagé, pas deux edges indépendants).
            {duplicateSignals.samples.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-amber-200/70">
                {duplicateSignals.samples.slice(0, 4).map((s, i) => (
                  <li key={i}>
                    {s.symbol} {s.direction} · {s.users.join(" & ")} · {new Date(s.time).toLocaleString("fr-FR")}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02] text-left text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3 text-right">Solde Deriv</th>
                <th className="px-4 py-3 text-right">Trades</th>
                <th className="px-4 py-3 text-right">Win Rate</th>
                <th className="px-4 py-3 text-right">P&amp;L Net</th>
                <th className="px-4 py-3 text-right">Profit Factor</th>
                <th className="px-4 py-3 text-right">Conf. Moy.</th>
                <th className="px-4 py-3">Dernier Trade</th>
                <th className="px-4 py-3 text-right">Journal</th>
              </tr>
            </thead>
            <tbody>
              {recapLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" />
                  </td>
                </tr>
              ) : recap.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground font-semibold">
                    Aucune statistique de trading disponible.
                  </td>
                </tr>
              ) : (
                recap.map((r) => (
                  <tr key={r.userId} className="border-t border-white/[0.06] hover:bg-white/[0.01] transition-all duration-300">
                    <td className="px-4 py-3 font-bold text-foreground">{r.username}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                      {r.balance !== null && r.balance !== undefined ? (
                        <span className="font-bold text-orange-400">
                          {r.currency} {r.balance.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-gray-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-semibold">
                      {r.trades}
                      {r.open > 0 && (
                        <span className="ml-1 text-[10px] text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded-full border border-amber-500/20">
                          +{r.open} en cours
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.trades ? (
                        <span className={cn("font-bold text-xs px-2.5 py-0.5 rounded-full", r.winRate >= 55 ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]" : "bg-white/[0.03] text-muted-foreground")}>
                          {r.winRate}%
                        </span>
                      ) : "—"}
                    </td>
                    <td className={cn(
                      "px-4 py-3 text-right font-black font-mono",
                      r.netPnl > 0 ? "text-[color:var(--bull)]" : r.netPnl < 0 ? "text-[color:var(--bear)]" : "text-muted-foreground"
                    )}>
                      {r.netPnl > 0 ? "+" : ""}{r.netPnl.toFixed(2)} $
                      {r.tradesLive > 0 && (
                        <div className="text-[9px] font-bold text-amber-400 mt-0.5">
                          Live : {r.netPnlLive > 0 ? "+" : ""}{r.netPnlLive.toFixed(2)} $ ({r.tradesLive})
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-bold">
                      {r.profitFactor === null ? "—" : r.profitFactor === Infinity ? "∞" : r.profitFactor.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-semibold">
                      {r.trades ? `${r.avgConfidence.toFixed(0)}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-semibold text-xs">
                      {r.lastTradeAt ? new Date(r.lastTradeAt).toLocaleString("fr-FR") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          const target = users.find((x) => x.id === r.userId);
                          if (target) openProfile(target);
                        }}
                        disabled={!r.trades && !r.open}
                        title="Consulter le journal"
                        className="rounded-xl border border-white/5 bg-white/[0.02] p-2 text-muted-foreground hover:text-white hover:bg-white/[0.06] transition-all disabled:opacity-30"
                      >
                        <BookOpen className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CollapsibleBlock>

      {/* ── BOOM SYMBOL BREAKDOWN ── desktop only ── */}
      {boomBreakdown.some((b) => b.trades > 0) && (
        <CollapsibleBlock
          className="glass-panel border-orange-500/10 bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-4 sm:p-5 space-y-4 hidden md:block"
          header={
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 shadow-[0_0_12px_rgba(249,115,22,0.15)]">
                <Dices className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-foreground">Performance par Index Boom</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Win rate, trades et P&L pour chaque symbole Boom — démo uniquement, jamais mélangé au réel.</p>
              </div>
            </div>
          }
        >
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] text-left text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Symbole</th>
                  <th className="px-4 py-3 text-right">Trades</th>
                  <th className="px-4 py-3 text-right">Wins</th>
                  <th className="px-4 py-3 text-right">Losses</th>
                  <th className="px-4 py-3 text-right">Win Rate</th>
                  <th className="px-4 py-3 text-right">P&amp;L Net</th>
                  <th className="px-4 py-3">Dernier Trade</th>
                </tr>
              </thead>
              <tbody>
                {boomBreakdown.map((b) => (
                  <tr key={b.symbol} className="border-t border-white/[0.06] hover:bg-white/[0.01] transition-all duration-300">
                    <td className="px-4 py-3 font-mono text-xs text-orange-400 font-bold">{b.symbol}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground font-semibold">{b.trades}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[color:var(--bull)]">{b.wins}</td>
                    <td className="px-4 py-3 text-right font-semibold text-[color:var(--bear)]">{b.losses}</td>
                    <td className={cn(
                      "px-4 py-3 text-right font-bold",
                      b.trades === 0 ? "text-muted-foreground" : b.winRate >= 50 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"
                    )}>
                      {b.trades > 0 ? `${b.winRate}%` : "—"}
                    </td>
                    <td className={cn(
                      "px-4 py-3 text-right font-black font-mono",
                      b.netPnl > 0 ? "text-[color:var(--bull)]" : b.netPnl < 0 ? "text-[color:var(--bear)]" : "text-muted-foreground"
                    )}>
                      {b.netPnl > 0 ? "+" : ""}{b.netPnl.toFixed(2)} $
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-semibold text-xs">
                      {b.lastTradeAt ? new Date(b.lastTradeAt).toLocaleString("fr-FR") : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-orange-500/20 bg-orange-500/[0.03]">
                  <td className="px-4 py-3 font-bold text-foreground text-xs uppercase tracking-wider">Total</td>
                  <td className="px-4 py-3 text-right font-bold text-foreground">{boomBreakdownTotal.trades}</td>
                  <td className="px-4 py-3 text-right font-bold text-[color:var(--bull)]">{boomBreakdownTotal.wins}</td>
                  <td className="px-4 py-3 text-right font-bold text-[color:var(--bear)]">{boomBreakdownTotal.losses}</td>
                  <td className={cn(
                    "px-4 py-3 text-right font-bold",
                    boomBreakdownTotal.trades > 0 && boomBreakdownTotal.wins / boomBreakdownTotal.trades >= 0.5 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"
                  )}>
                    {boomBreakdownTotal.trades > 0 ? `${((boomBreakdownTotal.wins / boomBreakdownTotal.trades) * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className={cn(
                    "px-4 py-3 text-right font-black font-mono",
                    boomBreakdownTotal.netPnl > 0 ? "text-[color:var(--bull)]" : boomBreakdownTotal.netPnl < 0 ? "text-[color:var(--bear)]" : "text-muted-foreground"
                  )}>
                    {boomBreakdownTotal.netPnl > 0 ? "+" : ""}{boomBreakdownTotal.netPnl.toFixed(2)} $
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tbody>
            </table>
          </div>
        </CollapsibleBlock>
      )}

      {/* ── BACKTEST vs REAL GAUGE ── desktop only ── */}
      {backtestVsReal && (
        <CollapsibleBlock
          className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-4 sm:p-5 space-y-4 hidden md:block"
          header={
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.15)]">
                <Activity className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-foreground">Évaluation Backtest vs Réel</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Mesure de la précision prédictive du robot face aux marchés en direct.</p>
              </div>
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 border border-white/[0.06] rounded-xl p-4 bg-white/[0.01]">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">EV Théorique</span>
              <div className="text-xl font-black text-cyan-400">
                +{(backtestVsReal.reference.evPerDollar * 100).toFixed(1)}%
              </div>
              <span className="text-[9px] text-muted-foreground/60 block">{backtestVsReal.reference.binaryNote}</span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">EV Réel</span>
              <div className={cn(
                "text-xl font-black",
                backtestVsReal.live.evPerDollar === null ? "text-muted-foreground" : backtestVsReal.live.evPerDollar >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"
              )}>
                {backtestVsReal.live.evPerDollar === null ? "—" : `${backtestVsReal.live.evPerDollar >= 0 ? "+" : ""}${(backtestVsReal.live.evPerDollar * 100).toFixed(1)}%`}
              </div>
              <span className="text-[9px] text-muted-foreground/60 block">Calculé sur live trades</span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Échantillon</span>
              <div className="text-xl font-black text-foreground">
                {backtestVsReal.live.trades} trades
              </div>
              <span className="text-[9px] text-muted-foreground/60 block">
                {backtestVsReal.live.trades < 30 ? "Trop peu de données" : "Données significatives"}
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Rentabilité Réelle</span>
              <div className={cn(
                "text-xl font-black",
                backtestVsReal.live.netPnl >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"
              )}>
                {backtestVsReal.live.netPnl >= 0 ? "+" : ""}{backtestVsReal.live.netPnl.toFixed(2)} $
              </div>
              {backtestVsReal.live.winRate !== null && (
                <span className="text-[9px] text-muted-foreground/60 block">Taux live {backtestVsReal.live.winRate}%</span>
              )}
            </div>
          </div>
        </CollapsibleBlock>
      )}

      {/* ── CONFIDENCE CALIBRATION ── desktop only ── */}
      {calibration.length > 0 && (
        <CollapsibleBlock
          className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-4 sm:p-5 space-y-4 hidden md:block"
          header={
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
                <Award className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-foreground">Calibration de la Confiance</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Le taux de victoire doit augmenter avec la confiance affichée — sinon le score n'est pas fiable.
                </p>
              </div>
            </div>
          }
        >
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] text-left text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Confiance</th>
                  <th className="px-4 py-3 text-right">Trades</th>
                  <th className="px-4 py-3 text-right">Taux de Victoire</th>
                </tr>
              </thead>
              <tbody>
                {calibration.map((b, i) => {
                  const prev = calibration[i - 1];
                  const regressed = i > 0 && prev.winRate !== null && b.winRate !== null && b.winRate < prev.winRate;
                  return (
                    <tr key={b.bucket} className="border-t border-white/[0.06] hover:bg-white/[0.01] transition-all duration-300">
                      <td className="px-4 py-3 font-mono text-xs text-foreground font-bold">{b.bucket}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {b.trades}
                        {b.trades < 20 && <span className="ml-1.5 text-[9px] text-muted-foreground/50">(peu de données)</span>}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-semibold",
                          b.winRate === null ? "text-muted-foreground" : b.winRate >= 50 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]",
                        )}
                      >
                        {b.winRate === null ? "—" : `${b.winRate}%`}
                        {regressed && <span className="ml-1.5 text-[9px] text-amber-400" title="Taux inférieur au palier de confiance précédent">⚠</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleBlock>
      )}

      {/* ── SHARED BRAIN METER ── desktop only ── */}
      {componentBreakdown.length > 0 && (
        <CollapsibleBlock
          alwaysCollapsible
          className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-4 sm:p-5 space-y-4 hidden md:block"
          header={
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.15)]">
                <BrainCircuit className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base font-bold text-foreground">Intelligence Partagée (Indicateurs Recalibrés)</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Formule adaptative du cerveau de trading partagé entre tous les utilisateurs.</p>
              </div>
            </div>
          }
        >
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.02] text-left text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Marché</th>
                  <th className="px-4 py-3">Indicateur</th>
                  <th className="px-4 py-3 text-right">Victoires (Wins)</th>
                  <th className="px-4 py-3 text-right">Défaites (Losses)</th>
                  <th className="px-4 py-3 text-right">Ajustement du Poids</th>
                </tr>
              </thead>
              <tbody>
                {componentBreakdown.map((c, i) => {
                  const weightPct = ((c.weight - 0.6) / (1.5 - 0.6)) * 100;
                  const isPositive = c.weight > 1.0;
                  const isNegative = c.weight < 1.0;
                  return (
                    <tr key={`${c.symbol}-${c.component}-${i}`} className="border-t border-white/[0.06] hover:bg-white/[0.01] transition-all duration-300">
                      <td className="px-4 py-3 font-bold text-muted-foreground">{c.symbol === "_global" ? "Global" : c.symbol}</td>
                      <td className="px-4 py-3 font-mono text-xs text-foreground font-bold">{c.component}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[color:var(--bull)]">{c.wins.toFixed(1)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-[color:var(--bear)]">{c.losses.toFixed(1)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <span className={cn(
                            "font-mono text-xs font-black",
                            isPositive ? "text-cyan-400" : isNegative ? "text-rose-400" : "text-muted-foreground"
                          )}>
                            {c.weight.toFixed(2)}×
                          </span>
                          <div className="relative h-2 w-20 rounded-full bg-white/[0.04] overflow-hidden border border-white/[0.05]">
                            <div className="absolute left-1/2 top-0 h-full w-[1px] bg-white/20 z-10" />
                            <div
                              className={cn(
                                "absolute h-full rounded-full transition-all duration-500",
                                isPositive ? "bg-gradient-to-r from-cyan-500 to-indigo-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]" : "bg-gradient-to-r from-rose-500 to-orange-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]"
                              )}
                              style={{
                                left: isPositive ? "50%" : `${weightPct}%`,
                                right: isPositive ? `${100 - weightPct}%` : "50%",
                              }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CollapsibleBlock>
      )}

      {/* ── CREATE USER DIALOG ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-panel border-white/10 bg-[#0A0A0A]/95 backdrop-blur-2xl sm:rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
              <UserPlus className="h-4.5 w-4.5 text-orange-500" />
              Créer un Compte
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground/80 leading-relaxed mt-1">
              Les identifiants seront créés et immédiatement valides. Le mot de passe peut être généré aléatoirement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-username" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">
                Pseudo
              </Label>
              <Input
                id="new-username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="jdupont"
                autoComplete="off"
                className="bg-white/[0.03] border-white/5 rounded-xl h-10 px-3 text-sm text-white placeholder:text-gray-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">
                Email
              </Label>
              <Input
                id="new-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jean.dupont@exemple.com"
                autoComplete="off"
                className="bg-white/[0.03] border-white/5 rounded-xl h-10 px-3 text-sm text-white placeholder:text-gray-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">
                Mot de passe
              </Label>
              <div className="flex gap-2">
                <Input
                  id="new-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min. 6 caractères"
                  autoComplete="new-password"
                  className="flex-1 bg-white/[0.03] border-white/5 rounded-xl h-10 px-3 text-sm font-mono text-white placeholder:text-gray-700"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={generatePassword}
                  title="Générer mot de passe"
                  className="h-10 w-10 shrink-0 border-white/5 hover:bg-white/[0.04]"
                >
                  <Dices className="h-4 w-4 text-orange-400" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.01] px-3.5 py-3 mt-2">
              <Label htmlFor="new-is-admin" className="cursor-pointer text-[10px] font-bold text-gray-500 uppercase tracking-widest">
                Accès administrateur
              </Label>
              <Switch
                id="new-is-admin"
                checked={form.isAdmin}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isAdmin: checked }))}
              />
            </div>
          </div>
          <DialogFooter className="mt-4 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(false)}
              disabled={createBusy}
              className="flex-1 border-white/5 hover:bg-white/[0.04] text-xs h-9"
            >
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={createAccount}
              disabled={createBusy}
              className="flex-1 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white font-bold text-xs h-9"
            >
              {createBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CHANGE OWN PASSWORD DIALOG ── */}
      <Dialog open={pwdOpen} onOpenChange={(open) => { setPwdOpen(open); if (!open) setPwdForm({ current: "", next: "", confirm: "" }); }}>
        <DialogContent className="glass-panel border-white/10 bg-[#0A0A0A]/95 backdrop-blur-2xl sm:rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
              <Lock className="h-4.5 w-4.5 text-orange-500" />
              Changer mon mot de passe
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground/80 leading-relaxed mt-1">
              Confirme ton mot de passe actuel pour en définir un nouveau.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 py-2"
            onSubmit={(e) => { e.preventDefault(); changeOwnPassword(); }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="pwd-current" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">
                Mot de passe actuel
              </Label>
              <Input
                id="pwd-current"
                type="password"
                value={pwdForm.current}
                onChange={(e) => setPwdForm((f) => ({ ...f, current: e.target.value }))}
                autoComplete="current-password"
                className="bg-white/[0.03] border-white/5 rounded-xl h-10 px-3 text-sm font-mono text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pwd-next" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">
                Nouveau mot de passe
              </Label>
              <Input
                id="pwd-next"
                type="password"
                value={pwdForm.next}
                onChange={(e) => setPwdForm((f) => ({ ...f, next: e.target.value }))}
                placeholder="Min. 6 caractères"
                autoComplete="new-password"
                className="bg-white/[0.03] border-white/5 rounded-xl h-10 px-3 text-sm font-mono text-white placeholder:text-gray-700"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pwd-confirm" className="text-[10px] font-bold text-gray-500 uppercase tracking-widest ml-1">
                Confirmer le nouveau mot de passe
              </Label>
              <Input
                id="pwd-confirm"
                type="password"
                value={pwdForm.confirm}
                onChange={(e) => setPwdForm((f) => ({ ...f, confirm: e.target.value }))}
                autoComplete="new-password"
                className="bg-white/[0.03] border-white/5 rounded-xl h-10 px-3 text-sm font-mono text-white"
              />
            </div>
            <DialogFooter className="mt-4 flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPwdOpen(false)}
                disabled={pwdBusy}
                className="flex-1 border-white/5 hover:bg-white/[0.04] text-xs h-9"
              >
                Annuler
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={pwdBusy || !pwdForm.current || !pwdForm.next || !pwdForm.confirm}
                className="flex-1 bg-gradient-to-r from-orange-500 to-amber-600 hover:from-orange-400 hover:to-amber-500 text-white font-bold text-xs h-9"
              >
                {pwdBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Mettre à jour"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>


      <ConfirmDialog state={confirmState} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved:  "border-[color:var(--bull)]/30 bg-[color:var(--bull)]/5 text-[color:var(--bull)] shadow-[0_0_10px_rgba(34,197,94,0.05)]",
    pending:   "border-amber-500/30 bg-amber-500/5 text-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.05)]",
    rejected:  "border-[color:var(--bear)]/30 bg-[color:var(--bear)]/5 text-[color:var(--bear)] shadow-[0_0_10px_rgba(239,68,68,0.05)]",
    suspended: "border-orange-500/30 bg-orange-500/5 text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.05)]",
  };
  const label: Record<string, string> = {
    approved:  "approuvé",
    pending:   "en attente",
    rejected:  "rejeté",
    suspended: "révoqué",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${map[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}

function InviteStatusBadge({
  status,
  usedByUsername,
}: {
  status: InviteCode["status"];
  usedByUsername: string | null;
}) {
  const map: Record<InviteCode["status"], string> = {
    pending:  "border-amber-500/30 bg-amber-500/5 text-amber-500",
    used:     "border-[color:var(--bull)]/30 bg-[color:var(--bull)]/5 text-[color:var(--bull)]",
    revoked:  "border-[color:var(--bear)]/30 bg-[color:var(--bear)]/5 text-[color:var(--bear)]",
    expired:  "border-white/10 bg-white/[0.03] text-muted-foreground",
  };
  const label: Record<InviteCode["status"], string> = {
    pending: "en attente",
    used: usedByUsername ? `utilisé par ${usedByUsername}` : "utilisé",
    revoked: "révoqué",
    expired: "expiré",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${map[status]}`}>
      {label[status]}
    </span>
  );
}

function BotStatusCell({
  status,
  busy,
  onToggle,
}: {
  status?: BotStatus;
  busy: boolean;
  onToggle: (action: "start" | "stop") => void;
}) {
  const running = status?.running ?? false;
  const enabled = status?.enabled ?? false;
  const hasToken = status?.hasToken ?? false;
  const blocked = !enabled && !hasToken;

  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          running
            ? "bg-gradient-to-r from-emerald-500/20 to-emerald-600/10 text-emerald-400 border border-emerald-500/30"
            : enabled
              ? "bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30"
              : "bg-gradient-to-r from-slate-500/20 to-slate-600/10 text-slate-400 border border-slate-500/30",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            running ? "bg-emerald-400 animate-pulse" : enabled ? "bg-amber-400" : "bg-slate-400",
          )}
        />
        {running ? "live" : enabled ? "en attente" : "arrêté"}
      </span>
      <Switch
        checked={enabled}
        disabled={busy || blocked}
        onCheckedChange={(checked) => onToggle(checked ? "start" : "stop")}
        title={blocked ? "Aucun token Deriv enregistré pour cet utilisateur" : undefined}
      />
    </div>
  );
}

function BacktestStatusCell({
  status,
  busy,
  onToggle,
}: {
  status?: BotStatus;
  busy: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const autoBacktestEnabled = status?.autoBacktestEnabled ?? false;
  const hasToken = status?.hasToken ?? false;

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          autoBacktestEnabled
            ? "bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30"
            : "bg-gradient-to-r from-slate-500/20 to-slate-600/10 text-slate-400 border border-slate-500/30",
        )}
      >
        {autoBacktestEnabled ? "actif" : "inactif"}
      </span>
      <Switch
        checked={autoBacktestEnabled}
        disabled={busy || !hasToken}
        onCheckedChange={onToggle}
        title={!hasToken ? "Aucun token Deriv enregistré pour cet utilisateur" : undefined}
      />
    </div>
  );
}

function ChatStatusCell({
  user,
  busy,
  onToggle,
}: {
  user: AdminUser;
  busy: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const chatEnabled = user.chat_enabled === 1;

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          chatEnabled
            ? "bg-gradient-to-r from-amber-500/20 to-amber-600/10 text-amber-400 border border-amber-500/30"
            : "bg-gradient-to-r from-slate-500/20 to-slate-600/10 text-slate-400 border border-slate-500/30",
        )}
      >
        {chatEnabled ? "actif" : "inactif"}
      </span>
      <Switch
        checked={chatEnabled}
        disabled={busy}
        onCheckedChange={onToggle}
      />
    </div>
  );
}

function BreakdownTable({ rows, title }: { rows: BreakdownRow[]; title: string }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">{title}</div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2 text-sm rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
            <span className="font-semibold text-foreground/80">{r.key}</span>
            <span className="text-muted-foreground/50 text-xs">{r.trades} trade{r.trades > 1 ? "s" : ""}</span>
            <span className={cn(
              "font-bold",
              r.winRate === null ? "text-muted-foreground/40" : r.winRate >= 50 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"
            )}>
              {r.winRate === null ? "—" : `${r.winRate}%`}
            </span>
            <span className={cn(
              "font-mono font-bold",
              r.netPnl > 0 ? "text-[color:var(--bull)]" : r.netPnl < 0 ? "text-[color:var(--bear)]" : "text-muted-foreground"
            )}>
              {r.netPnl > 0 ? "+" : ""}{r.netPnl.toFixed(2)} $
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrokerDot({ label, active, color }: { label: string; active: boolean; color: "red" | "violet" | "yellow" | "emerald" }) {
  const colorMap = {
    red: "bg-red-500",
    violet: "bg-violet-500",
    yellow: "bg-yellow-500",
    emerald: "bg-emerald-500",
  };
  return (
    <div className="flex items-center gap-1" title={`${label}: ${active ? "connecte" : "non configure"}`}>
      <span className={cn("h-2 w-2 rounded-full", active ? colorMap[color] : "bg-white/10")} />
      <span className={cn("text-[10px] font-bold", active ? "text-foreground" : "text-muted-foreground/50")}>{label}</span>
    </div>
  );
}

function ConfigChangesPanel({ changes, loading }: { changes: ConfigChangeEntry[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] p-4 py-6 text-center">
        <Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" />
      </div>
    );
  }
  if (changes.length === 0) return null;

  function fmtVal(v: unknown): string {
    if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
    if (typeof v === "number") return String(v);
    return v == null ? "—" : String(v);
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
        <RefreshCcw className="h-4 w-4 text-cyan-400" />
        Historique des changements — avant / après
      </div>
      <div className="space-y-3">
        {[...changes].reverse().map((c) => (
          <div key={c.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {new Date(c.changedAt).toLocaleString("fr-FR")} · par <span className="font-semibold text-foreground">{c.changedBy}</span>
              </span>
              {c.source === "auto-rollback" && (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  ⏪ Rollback automatique
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(c.fields).map(([key, { from, to }]) => (
                <span key={key} className="rounded-md border border-cyan-500/20 bg-cyan-500/[0.06] px-2 py-1 text-[11px] text-cyan-200">
                  <span className="font-semibold">{CONFIG_FIELD_LABELS[key] ?? key}</span>{" "}
                  <span className="text-muted-foreground line-through">{fmtVal(from)}</span>{" "}
                  → <span className="font-bold text-cyan-100">{fmtVal(to)}</span>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["before", "after"] as const).map((side) => {
                const s = c[side];
                const sampleSize = side === "before" ? c.beforeSampleSize : c.afterSampleSize;
                return (
                  <div key={side} className="rounded-lg border border-white/[0.06] bg-black/20 p-2.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                      {side === "before" ? "Avant" : "Après"} ({sampleSize} trade{sampleSize > 1 ? "s" : ""})
                    </div>
                    {s ? (
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Win rate</span>
                          <span className="font-semibold">{s.winRate.toFixed(1)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">P&amp;L</span>
                          <span className={cn("font-bold", s.netPnl >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                            {s.netPnl >= 0 ? "+" : ""}{s.netPnl.toFixed(2)}$
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Espérance</span>
                          <span className={cn("font-mono", s.expectancy >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]")}>
                            {s.expectancy >= 0 ? "+" : ""}{s.expectancy.toFixed(3)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">PF</span>
                          <span className="font-mono font-semibold">{s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground italic">Pas encore de trades clôturés</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserInsightsPanel({
  insights,
  config,
  mode,
  onModeChange,
  onApply,
  applyingRec,
}: {
  insights: { demo: UserInsights; live: UserInsights };
  config: UserBotConfig | null;
  mode: "demo" | "live";
  onModeChange: (mode: "demo" | "live") => void;
  onApply: (rec: Recommendation) => void;
  applyingRec: string | null;
}) {
  const current = insights[mode];

  return (
    <div className="space-y-4 rounded-xl border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground/60">
          <BrainCircuit className="h-4 w-4 text-violet-400" />
          Analyse & réglages
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
          {(["demo", "live"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={cn(
                "px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-md transition-colors cursor-pointer",
                mode === m ? "bg-amber-500/15 text-amber-400" : "text-muted-foreground/50 hover:text-foreground"
              )}
            >
              {m === "demo" ? "Démo" : "Live"}
            </button>
          ))}
        </div>
      </div>

      {config && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-muted-foreground/70">
            Mise <span className="text-foreground font-semibold">{config.stakeUsd}$</span>
          </span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-muted-foreground/70">
            Confiance min <span className="text-foreground font-semibold">{config.minConfidence}%</span>
          </span>
          <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-muted-foreground/70">
            {config.symbols?.length ?? 0} symbole{(config.symbols?.length ?? 0) > 1 ? "s" : ""}
          </span>
        </div>
      )}

      <div className="space-y-2">
        {(current.recommendations ?? []).map((rec) => (
          <div
            key={rec.message}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm",
              rec.type === "small-sample"
                ? "border-white/[0.05] bg-white/[0.01] text-muted-foreground/60"
                : "border-amber-500/15 bg-amber-500/[0.04] text-foreground/85"
            )}
          >
            {rec.type === "small-sample" ? (
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/40" />
            ) : (
              <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
            )}
            <span className="flex-1">{rec.message}</span>
            {rec.type !== "small-sample" && (
              <button
                type="button"
                onClick={() => onApply(rec)}
                disabled={applyingRec === rec.message}
                className="shrink-0 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-amber-400 hover:bg-amber-500/20 transition-colors cursor-pointer disabled:opacity-50"
              >
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
