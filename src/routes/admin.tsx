import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck, Check, X, Trash2, Loader2, RefreshCw, KeyRound,
  ShieldOff, UserPlus, Dices, TrendingUp, TrendingDown, BookOpen,
  BrainCircuit, Users, ShieldAlert, Award, Search, Key, RefreshCcw,
  Mail, Ban, Copy, Send,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { KpiCard } from "@/components/kpi-card";
import { CollapsibleBlock } from "@/components/collapsible-section";
import { ChangelogPanel } from "@/components/changelog-panel";
import { HealthPanel } from "@/components/health-panel";
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

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Administration — Pluriel" }] }),
  component: AdminPage,
});

interface AdminUser {
  id: number;
  email: string;
  username: string;
  email_verified: number;
  status: string;
  is_admin: number;
  created_at: number;
}

interface BotStatus {
  userId: number;
  enabled: boolean;
  running: boolean;
  hasToken: boolean;
  mode: "demo" | "live" | null;
  lastError: string | null;
  autoBacktestEnabled: boolean;
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

function AdminPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const { confirmState, confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", isAdmin: false });
  const [botStatus, setBotStatus] = useState<Record<number, BotStatus>>({});
  const [botBusyId, setBotBusyId] = useState<number | null>(null);
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
  const [journalUser, setJournalUser] = useState<UserRecap | null>(null);
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
      const data = await api.get<{ recap: UserRecap[]; componentBreakdown: ComponentStat[]; backtestVsReal?: BacktestVsReal; calibration?: CalibrationBucket[] }>("/api/admin/stats");
      setRecap(data.recap);
      setComponentBreakdown(data.componentBreakdown);
      setBacktestVsReal(data.backtestVsReal ?? null);
      setCalibration(data.calibration ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement du récap");
    } finally {
      setRecapLoading(false);
    }
  }, []);

  const loadBotStatus = useCallback(async () => {
    try {
      const data = await api.get<{ statuses: BotStatus[] }>("/api/admin/bot");
      const map: Record<number, BotStatus> = {};
      for (const s of data.statuses) map[s.userId] = s;
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
    const id = setInterval(() => { loadBotStatus(); loadRecap(); }, 20_000);
    return () => clearInterval(id);
  }, [user?.is_admin, load, loadRecap, loadBotStatus, loadInvites]);

  async function openJournal(u: UserRecap) {
    setJournalUser(u);
    setJournalLoading(true);
    try {
      const data = await api.get<{ trades: JournalTrade[] }>(`/api/admin/stats?userId=${u.userId}`);
      setJournalTrades(data.trades);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement du journal");
    } finally {
      setJournalLoading(false);
    }
  }

  async function act(userId: number, action: "approve" | "reject" | "revoke" | "delete" | "reset-password") {
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
      await api.post("/api/admin/users", { userId, action });
      const msg: Record<string, string> = {
        approve: "Compte approuvé ✓",
        reject: "Compte rejeté",
        revoke: "Accès révoqué",
        delete: "Compte supprimé",
        "reset-password": "Lien de réinitialisation envoyé par email",
      };
      toast.success(msg[action] ?? "Action effectuée");
      await load();
      await loadRecap();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
  }

  async function toggleBot(userId: number, action: "start" | "stop") {
    setBotBusyId(userId);
    try {
      await api.post("/api/admin/bot", { userId, action });
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

  const filteredUsers = users.filter(
    (u) =>
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      
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
        <div className="flex gap-2">
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

      {/* ── FEATURE HEALTH MONITOR ── */}
      <HealthPanel />

      {/* ── BUG/CHANGELOG TRACKER ── */}
      <ChangelogPanel />

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
            <div className="relative w-full sm:w-64 group">
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
        }
      >
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto rounded-xl border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.02] text-left text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3">Utilisateur</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Vérifié</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Auto-Trader</th>
                <th className="px-4 py-3">Backtest Auto</th>
                <th className="px-4 py-3">Inscrit</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" />
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground font-semibold">
                    Aucun utilisateur trouvé.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const initials = u.username.slice(0, 2).toUpperCase();
                  const isAdmin = u.is_admin === 1;
                  return (
                    <tr key={u.id} className="border-t border-white/[0.06] hover:bg-white/[0.01] transition-all duration-300">
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
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-medium">{u.email}</td>
                      <td className="px-4 py-3">
                        {u.email_verified ? (
                          <span className="text-[color:var(--bull)] font-bold bg-[color:var(--bull)]/10 px-2.5 py-0.5 rounded-full text-xs">oui</span>
                        ) : (
                          <span className="text-muted-foreground bg-white/[0.03] px-2.5 py-0.5 rounded-full text-xs">non</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={u.status} />
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <span className="text-xs text-muted-foreground/40 font-mono">—</span>
                        ) : (
                          <BotStatusCell
                            status={botStatus[u.id]}
                            busy={botBusyId === u.id}
                            onToggle={(action) => toggleBot(u.id, action)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <span className="text-xs text-muted-foreground/40 font-mono">—</span>
                        ) : (
                          <BacktestStatusCell
                            status={botStatus[u.id]}
                            busy={backtestBusyId === u.id}
                            onToggle={(checked) => toggleBacktest(u.id, checked)}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-semibold">
                        {new Date(u.created_at * 1000).toLocaleDateString("fr-FR")}
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <span className="block text-right text-xs text-muted-foreground/40 font-mono">—</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            {u.status !== "approved" && (
                              <button
                                onClick={() => act(u.id, "approve")}
                                disabled={busyId === u.id}
                                title="Approuver l'accès"
                                className="rounded-xl border border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 p-2 text-[color:var(--bull)] hover:bg-[color:var(--bull)]/20 transition-colors disabled:opacity-50"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            )}
                            {u.status === "pending" && (
                              <button
                                onClick={() => act(u.id, "reject")}
                                disabled={busyId === u.id}
                                title="Refuser la demande"
                                className="rounded-xl border border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 p-2 text-[color:var(--bear)] hover:bg-[color:var(--bear)]/20 transition-colors disabled:opacity-50"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                            {u.status === "approved" && (
                              <button
                                onClick={() => act(u.id, "revoke")}
                                disabled={busyId === u.id}
                                title="Révoquer l'accès"
                                className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-2 text-amber-500 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                              >
                                <ShieldOff className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => act(u.id, "reset-password")}
                              disabled={busyId === u.id}
                              title="Envoyer un lien de réinitialisation du mot de passe"
                              className="rounded-xl border border-indigo-500/40 bg-indigo-500/10 p-2 text-indigo-400 hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => act(u.id, "delete")}
                              disabled={busyId === u.id}
                              title="Supprimer définitivement"
                              className="rounded-xl border border-white/5 bg-white/[0.02] p-2 text-muted-foreground hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View Cards */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="text-center py-8">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground font-semibold">
              Aucun utilisateur trouvé.
            </div>
          ) : (
            filteredUsers.map((u) => {
              const initials = u.username.slice(0, 2).toUpperCase();
              const isAdmin = u.is_admin === 1;
              return (
                <div key={u.id} className="border border-white/[0.06] rounded-xl p-4 bg-white/[0.01] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-cyan-500/20 to-indigo-500/20 text-cyan-400 text-[10px] font-bold border border-cyan-500/20">
                        {initials}
                      </div>
                      <span className="font-bold text-foreground text-sm">{u.username}</span>
                      {isAdmin && (
                        <span className="rounded-full bg-cyan-500/10 border border-cyan-500/20 px-1.5 py-0.5 text-[8px] text-cyan-400 font-bold uppercase tracking-wider">
                          admin
                        </span>
                      )}
                    </div>
                    <StatusBadge status={u.status} />
                  </div>
                  <div className="space-y-1 text-xs border-t border-white/[0.04] pt-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Email</span>
                      <span className="text-foreground font-mono truncate max-w-[170px]">{u.email}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inscrit</span>
                      <span className="text-foreground font-semibold">{new Date(u.created_at * 1000).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </div>
                  {!isAdmin && (
                    <div className="flex items-center justify-between border-t border-white/[0.04] pt-2">
                      <span className="text-xs text-muted-foreground font-semibold">Auto-Trader</span>
                      <BotStatusCell
                        status={botStatus[u.id]}
                        busy={botBusyId === u.id}
                        onToggle={(action) => toggleBot(u.id, action)}
                      />
                    </div>
                  )}
                  {!isAdmin && (
                    <div className="flex items-center justify-between border-t border-white/[0.04] pt-2">
                      <span className="text-xs text-muted-foreground font-semibold">Backtest Auto</span>
                      <BacktestStatusCell
                        status={botStatus[u.id]}
                        busy={backtestBusyId === u.id}
                        onToggle={(checked) => toggleBacktest(u.id, checked)}
                      />
                    </div>
                  )}
                  {!isAdmin && (
                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-white/[0.04]">
                      {u.status !== "approved" && (
                        <button
                          onClick={() => act(u.id, "approve")}
                          disabled={busyId === u.id}
                          className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 py-1.5 text-xs text-[color:var(--bull)] font-bold"
                        >
                          <Check className="h-3.5 w-3.5" /> Activer
                        </button>
                      )}
                      {u.status === "pending" && (
                        <button
                          onClick={() => act(u.id, "reject")}
                          disabled={busyId === u.id}
                          className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 py-1.5 text-xs text-[color:var(--bear)] font-bold"
                        >
                          <X className="h-3.5 w-3.5" /> Rejeter
                        </button>
                      )}
                      {u.status === "approved" && (
                        <button
                          onClick={() => act(u.id, "revoke")}
                          disabled={busyId === u.id}
                          className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 py-1.5 text-xs text-amber-500 font-bold"
                        >
                          <ShieldOff className="h-3.5 w-3.5" /> Révoquer
                        </button>
                      )}
                      <button
                        onClick={() => act(u.id, "reset-password")}
                        disabled={busyId === u.id}
                        className="flex-1 flex items-center justify-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/10 py-1.5 text-xs text-indigo-400 font-bold"
                      >
                        <KeyRound className="h-3.5 w-3.5" /> MDP
                      </button>
                      <button
                        onClick={() => act(u.id, "delete")}
                        disabled={busyId === u.id}
                        className="flex items-center justify-center rounded-lg border border-white/5 bg-white/[0.02] p-1.5 text-muted-foreground hover:text-white"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
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

      {/* ── TRADING RECAP BY USER ── */}
      <CollapsibleBlock
        className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
        header={
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Récapitulatif de Trading</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Suivi des performances individuelles en temps réel.</p>
            </div>
            <Button variant="outline" size="sm" onClick={loadRecap} disabled={recapLoading} className="h-9 border-white/5 hover:bg-white/[0.04]">
              <RefreshCw className={cn("h-4 w-4 mr-1.5", recapLoading && "animate-spin")} />
              Actualiser
            </Button>
          </div>
        }
      >
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
                        onClick={() => openJournal(r)}
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

      {/* ── BACKTEST vs REAL GAUGE ── */}
      {backtestVsReal && (
        <CollapsibleBlock
          className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
          header={
            <div>
              <h2 className="text-base font-bold text-foreground">Évaluation Backtest vs Réel</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Mesure de la précision prédictive du robot face aux marchés en direct.</p>
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

      {/* ── CONFIDENCE CALIBRATION ── */}
      {calibration.length > 0 && (
        <CollapsibleBlock
          className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
          header={
            <div>
              <h2 className="text-base font-bold text-foreground">Calibration de la Confiance</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Le taux de victoire doit augmenter avec la confiance affichée — sinon le score n'est pas fiable.
              </p>
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

      {/* ── SHARED BRAIN METER ── */}
      {componentBreakdown.length > 0 && (
        <CollapsibleBlock
          alwaysCollapsible
          className="glass-panel border-white/[0.06] bg-[#0A0A0A]/50 backdrop-blur-xl rounded-2xl p-5 space-y-4"
          header={
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 flex items-center justify-center rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 shadow-[0_0_12px_rgba(99,102,241,0.15)]">
                <BrainCircuit className="h-4.5 w-4.5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-foreground">Intelligence Partagée (Indicateurs Recalibrés)</h2>
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

      {/* ── USER JOURNAL DIALOG ── */}
      <Dialog open={!!journalUser} onOpenChange={(open) => !open && setJournalUser(null)}>
        <DialogContent className="glass-panel border-white/10 bg-[#0A0A0A]/95 backdrop-blur-2xl sm:rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] max-w-xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-widest text-foreground flex items-center gap-2">
              <BookOpen className="h-4.5 w-4.5 text-indigo-400" />
              Journal de {journalUser?.username}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              {journalUser?.trades} trade{(journalUser?.trades ?? 0) > 1 ? "s" : ""} clos · P&amp;L Net cumulé : {journalUser && (journalUser.netPnl >= 0 ? "+" : "")}{journalUser?.netPnl.toFixed(2)} $
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {journalLoading ? (
              <div className="py-12 text-center">
                <Loader2 className="mx-auto h-5 w-5 animate-spin text-orange-500" />
              </div>
            ) : journalTrades.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground font-semibold">
                Aucun trade enregistré pour cet utilisateur.
              </p>
            ) : (
              <div className="space-y-1.5">
                {journalTrades.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.05] bg-white/[0.01] px-3.5 py-2.5 hover:bg-white/[0.02] transition-colors text-xs">
                    <div className="flex items-center gap-3 min-w-0">
                      {t.status === "won" ? (
                        <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-[color:var(--bull)]/10 text-[color:var(--bull)]">
                          <TrendingUp className="h-4 w-4" />
                        </div>
                      ) : t.status === "lost" ? (
                        <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-[color:var(--bear)]/10 text-[color:var(--bear)]">
                          <TrendingDown className="h-4 w-4" />
                        </div>
                      ) : (
                        <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-amber-500/10 text-amber-500 animate-pulse">
                          <Clock className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-foreground">{t.symbol} · {t.direction}</div>
                        <div className="text-muted-foreground/60 text-[10px] mt-0.5">
                          {new Date(t.time).toLocaleString("fr-FR")} · Confiance {t.confidence}% · TFs {t.tf_agreement}/4
                        </div>
                        {t.note && (
                          <div className="text-muted-foreground/50 text-[9px] mt-0.5 border-l border-white/10 pl-1.5 italic truncate max-w-[280px]">
                            {t.note}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={cn(
                      "shrink-0 text-right font-black font-mono text-sm",
                      t.profit > 0 ? "text-[color:var(--bull)]" : t.profit < 0 ? "text-[color:var(--bear)]" : "text-muted-foreground"
                    )}>
                      {t.profit > 0 ? "+" : ""}{t.profit.toFixed(2)} $
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
            ? "bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
            : "bg-white/[0.03] text-muted-foreground",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            running ? "bg-[color:var(--bull)] animate-pulse" : "bg-muted-foreground/40",
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
            ? "bg-amber-500/10 text-amber-500"
            : "bg-white/[0.03] text-muted-foreground",
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

import { Clock } from "lucide-react";
