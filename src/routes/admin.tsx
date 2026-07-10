import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Check, X, Trash2, Loader2, RefreshCw, KeyRound, ShieldOff, UserPlus, Dices, TrendingUp, TrendingDown, BookOpen, BrainCircuit } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Administration — LIO23" }] }),
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
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", isAdmin: false });
  const [recap, setRecap] = useState<UserRecap[]>([]);
  const [backtestVsReal, setBacktestVsReal] = useState<BacktestVsReal | null>(null);
  const [componentBreakdown, setComponentBreakdown] = useState<ComponentStat[]>([]);
  const [recapLoading, setRecapLoading] = useState(true);
  const [journalUser, setJournalUser] = useState<UserRecap | null>(null);
  const [journalTrades, setJournalTrades] = useState<JournalTrade[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);

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
      const data = await api.get<{ recap: UserRecap[]; componentBreakdown: ComponentStat[]; backtestVsReal?: BacktestVsReal }>("/api/admin/stats");
      setRecap(data.recap);
      setComponentBreakdown(data.componentBreakdown);
      setBacktestVsReal(data.backtestVsReal ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de chargement du récap");
    } finally {
      setRecapLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.is_admin) { load(); loadRecap(); }
  }, [user?.is_admin, load, loadRecap]);

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
    if (action === "delete" && !confirm("Supprimer définitivement ce compte ?")) return;
    if (action === "revoke" && !confirm("Révoquer l'accès de cet utilisateur ?")) return;
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setBusyId(null);
    }
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
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const pending = users.filter((u) => u.status === "pending");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-[color:var(--brand-cyan)]" />
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Administration</h1>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="flex-1 sm:flex-none h-10 text-sm sm:h-9"
          >
            <UserPlus className="h-4 w-4 mr-1.5" />
            Créer un compte
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            className="flex-1 sm:flex-none h-10 text-sm sm:h-9"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-panel border-border/60 sm:rounded-2xl">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="text-left">
                <DialogTitle className="text-sm font-bold uppercase tracking-wide">Créer un compte</DialogTitle>
                <DialogDescription className="mt-1 text-xs leading-relaxed">
                  Le compte est créé directement approuvé et vérifié. Les identifiants sont envoyés par email.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-username" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Nom d'utilisateur
              </Label>
              <Input
                id="new-username"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="jdupont"
                autoComplete="off"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-email" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Email
              </Label>
              <Input
                id="new-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="jean.dupont@exemple.com"
                autoComplete="off"
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password" className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Mot de passe
              </Label>
              <div className="flex gap-2">
                <Input
                  id="new-password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Au moins 6 caractères"
                  autoComplete="new-password"
                  className="bg-background font-mono"
                />
                <Button type="button" variant="outline" size="icon" onClick={generatePassword} title="Générer un mot de passe">
                  <Dices className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2.5">
              <Label htmlFor="new-is-admin" className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                Compte administrateur
              </Label>
              <Switch
                id="new-is-admin"
                checked={form.isAdmin}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, isAdmin: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)} disabled={createBusy}>
              Annuler
            </Button>
            <Button
              size="sm"
              onClick={createAccount}
              disabled={createBusy}
              className="bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-bold"
            >
              {createBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 mr-1.5" />}
              Créer le compte
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <p className="text-sm text-muted-foreground">
        {users.length} compte{users.length > 1 ? "s" : ""} · {pending.length} en attente d'approbation
      </p>

      {/* ── DESKTOP VIEW: Table ── */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Utilisateur</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Vérifié</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Inscrit</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Aucun compte.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-muted/5 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {u.username}
                    {u.is_admin ? (
                      <span className="ml-1.5 rounded bg-[color:var(--brand-cyan)]/15 px-1.5 py-0.5 text-[10px] text-[color:var(--brand-cyan)]">
                        admin
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.email_verified ? (
                      <span className="text-[color:var(--bull)] font-semibold">oui</span>
                    ) : (
                      <span className="text-muted-foreground">non</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(u.created_at * 1000).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_admin ? (
                      <span className="block text-right text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Approuver : visible si pas encore approuvé */}
                        {u.status !== "approved" && (
                          <button
                            onClick={() => act(u.id, "approve")}
                            disabled={busyId === u.id}
                            title="Approuver l'accès"
                            className="rounded-md border border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 p-1.5 text-[color:var(--bull)] hover:bg-[color:var(--bull)]/20 disabled:opacity-50"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        )}
                        {/* Rejeter : seulement pour les comptes en attente */}
                        {u.status === "pending" && (
                          <button
                            onClick={() => act(u.id, "reject")}
                            disabled={busyId === u.id}
                            title="Refuser la demande"
                            className="rounded-md border border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 p-1.5 text-[color:var(--bear)] hover:bg-[color:var(--bear)]/20 disabled:opacity-50"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                        {/* Révoquer : seulement pour les comptes approuvés */}
                        {u.status === "approved" && (
                          <button
                            onClick={() => act(u.id, "revoke")}
                            disabled={busyId === u.id}
                            title="Révoquer l'accès"
                            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-1.5 text-amber-500 hover:bg-amber-500/20 disabled:opacity-50"
                          >
                            <ShieldOff className="h-4 w-4" />
                          </button>
                        )}
                        {/* Reset MDP : toujours disponible */}
                        <button
                          onClick={() => act(u.id, "reset-password")}
                          disabled={busyId === u.id}
                          title="Envoyer un lien de réinitialisation du mot de passe"
                          className="rounded-md border border-[color:var(--brand-violet)]/40 bg-[color:var(--brand-violet)]/10 p-1.5 text-[color:var(--brand-violet)] hover:bg-[color:var(--brand-violet)]/20 disabled:opacity-50"
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                        {/* Supprimer */}
                        <button
                          onClick={() => act(u.id, "delete")}
                          disabled={busyId === u.id}
                          title="Supprimer définitivement"
                          className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── MOBILE VIEW: Card layout ── */}
      <div className="md:hidden space-y-4">
        {loading ? (
          <div className="glass-panel rounded-2xl p-10 text-center text-muted-foreground">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-[color:var(--brand-cyan)]" />
            <p className="mt-2 text-sm">Chargement des utilisateurs…</p>
          </div>
        ) : users.length === 0 ? (
          <div className="glass-panel rounded-2xl p-10 text-center text-muted-foreground">
            Aucun compte trouvé.
          </div>
        ) : (
          users.map((u) => (
            <div key={u.id} className="glass-panel rounded-xl p-5 space-y-4">
              {/* Card Header: Username + Admin Status + Status Badge */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-base font-bold text-foreground">{u.username}</span>
                  {u.is_admin ? (
                    <span className="rounded bg-[color:var(--brand-cyan)]/15 px-2 py-0.5 text-xs text-[color:var(--brand-cyan)] font-semibold">
                      admin
                    </span>
                  ) : null}
                </div>
                <StatusBadge status={u.status} />
              </div>

              {/* Card Body: Email, Verified, Registered date */}
              <div className="space-y-2 text-sm border-t border-border/40 pt-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Email</span>
                  <span className="text-foreground font-mono select-all truncate max-w-[200px]">{u.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Email vérifié</span>
                  <span>
                    {u.email_verified ? (
                      <span className="text-[color:var(--bull)] font-bold bg-[color:var(--bull)]/10 px-2 py-0.5 rounded text-xs">oui</span>
                    ) : (
                      <span className="text-muted-foreground bg-muted/15 px-2 py-0.5 rounded text-xs">non</span>
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground font-medium">Inscrit le</span>
                  <span className="text-muted-foreground font-semibold">
                    {new Date(u.created_at * 1000).toLocaleDateString("fr-FR")}
                  </span>
                </div>
              </div>

              {/* Card Actions (Only for non-admins) */}
              {!u.is_admin && (
                <div className="flex flex-wrap gap-2 pt-3 border-t border-border/40">
                  {/* Approuver */}
                  {u.status !== "approved" && (
                    <button
                      onClick={() => act(u.id, "approve")}
                      disabled={busyId === u.id}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 py-2 text-sm text-[color:var(--bull)] hover:bg-[color:var(--bull)]/20 font-bold disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" /> Approuver
                    </button>
                  )}
                  {/* Rejeter */}
                  {u.status === "pending" && (
                    <button
                      onClick={() => act(u.id, "reject")}
                      disabled={busyId === u.id}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 py-2 text-sm text-[color:var(--bear)] hover:bg-[color:var(--bear)]/20 font-bold disabled:opacity-50"
                    >
                      <X className="h-4 w-4" /> Rejeter
                    </button>
                  )}
                  {/* Révoquer */}
                  {u.status === "approved" && (
                    <button
                      onClick={() => act(u.id, "revoke")}
                      disabled={busyId === u.id}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 py-2 text-sm text-amber-500 hover:bg-amber-500/20 font-bold disabled:opacity-50"
                    >
                      <ShieldOff className="h-4 w-4" /> Révoquer
                    </button>
                  )}
                  {/* Reset MDP */}
                  <button
                    onClick={() => act(u.id, "reset-password")}
                    disabled={busyId === u.id}
                    title="Envoyer un lien de réinitialisation"
                    className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border border-[color:var(--brand-violet)]/40 bg-[color:var(--brand-violet)]/10 py-2 text-sm text-[color:var(--brand-violet)] hover:bg-[color:var(--brand-violet)]/20 font-bold disabled:opacity-50"
                  >
                    <KeyRound className="h-4 w-4" /> Code
                  </button>
                  {/* Supprimer */}
                  <button
                    onClick={() => act(u.id, "delete")}
                    disabled={busyId === u.id}
                    className="flex items-center justify-center rounded-lg border border-border px-3 py-2 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── TRADING RECAP: gains/pertes et journal par utilisateur ── */}
      <div className="flex items-center justify-between gap-3 pt-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-[color:var(--brand-cyan)]" />
          <h2 className="text-lg font-bold text-foreground">Récap trading par utilisateur</h2>
        </div>
        <Button variant="outline" size="sm" onClick={loadRecap} disabled={recapLoading} className="h-9 text-sm">
          <RefreshCw className={`h-4 w-4 mr-1.5 ${recapLoading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Utilisateur</th>
              <th className="px-4 py-3 font-medium text-right">Trades</th>
              <th className="px-4 py-3 font-medium text-right">Win rate</th>
              <th className="px-4 py-3 font-medium text-right">P&amp;L net</th>
              <th className="px-4 py-3 font-medium text-right">Profit factor</th>
              <th className="px-4 py-3 font-medium text-right">Conf. moy.</th>
              <th className="px-4 py-3 font-medium">Dernier trade</th>
              <th className="px-4 py-3 font-medium text-right">Journal</th>
            </tr>
          </thead>
          <tbody>
            {recapLoading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : recap.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">Aucune donnée de trading pour l'instant.</td></tr>
            ) : (
              recap.map((r) => (
                <tr key={r.userId} className="border-t border-border hover:bg-muted/5 transition-colors">
                  <td className="px-4 py-3 font-medium text-foreground">{r.username}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {r.trades}{r.open ? <span className="text-xs text-amber-500"> (+{r.open} ouvert{r.open > 1 ? "s" : ""})</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{r.trades ? `${r.winRate}%` : "—"}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${r.netPnl > 0 ? "text-[color:var(--bull)]" : r.netPnl < 0 ? "text-[color:var(--bear)]" : "text-muted-foreground"}`}>
                    {r.netPnl > 0 ? "+" : ""}{r.netPnl.toFixed(2)} $
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{r.profitFactor === null ? "—" : r.profitFactor === Infinity ? "∞" : r.profitFactor}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{r.trades ? `${r.avgConfidence}%` : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.lastTradeAt ? new Date(r.lastTradeAt).toLocaleString("fr-FR") : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openJournal(r)}
                      disabled={!r.trades && !r.open}
                      title="Voir le journal de trades"
                      className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30"
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

      {/* ── BACKTEST vs RÉEL: le juge de paix de la période démo ── */}
      {backtestVsReal && (
        <div className="glass-panel rounded-xl p-5 space-y-3">
          <h2 className="text-lg font-bold text-foreground">Backtest vs réel</h2>
          <p className="text-xs text-muted-foreground">
            Prédiction du harnais ({backtestVsReal.reference.windowDays} jours, {backtestVsReal.reference.simulatedTrades} trades simulés) face aux trades réels clos depuis le déploiement de la config actuelle ({new Date(backtestVsReal.reference.measuredFromMs).toLocaleDateString("fr-FR")}). EV = gain moyen par dollar misé.
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-xs text-muted-foreground">EV prédit</div>
              <div className="text-xl font-bold text-foreground">+{(backtestVsReal.reference.evPerDollar * 100).toFixed(1)}%</div>
              <div className="text-[10px] text-muted-foreground">{backtestVsReal.reference.binaryNote}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">EV réel</div>
              <div className={`text-xl font-bold ${backtestVsReal.live.evPerDollar === null ? "text-muted-foreground" : backtestVsReal.live.evPerDollar >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"}`}>
                {backtestVsReal.live.evPerDollar === null ? "—" : `${backtestVsReal.live.evPerDollar >= 0 ? "+" : ""}${(backtestVsReal.live.evPerDollar * 100).toFixed(1)}%`}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Trades réels clos</div>
              <div className="text-xl font-bold text-foreground">{backtestVsReal.live.trades}</div>
              <div className="text-[10px] text-muted-foreground">{backtestVsReal.live.trades < 30 ? "échantillon encore trop petit pour conclure" : "échantillon exploitable"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">P&L net réel</div>
              <div className={`text-xl font-bold ${backtestVsReal.live.netPnl >= 0 ? "text-[color:var(--bull)]" : "text-[color:var(--bear)]"}`}>
                {backtestVsReal.live.netPnl >= 0 ? "+" : ""}{backtestVsReal.live.netPnl.toFixed(2)} $
              </div>
              {backtestVsReal.live.winRate !== null && <div className="text-[10px] text-muted-foreground">win rate {backtestVsReal.live.winRate}%</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── APPRENTISSAGE PARTAGÉ: ce que les trades des utilisateurs ont appris à l'app ── */}
      {componentBreakdown.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-[color:var(--brand-violet)]" />
            <h2 className="text-lg font-bold text-foreground">Apprentissage partagé (poids appris par indicateur)</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Statistiques win/loss par (symbole, composant de signal), agrégées sur les trades réels de tous les comptes — c'est ce qui recalibre le moteur serveur au fil des trades.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Symbole</th>
                  <th className="px-4 py-2.5 font-medium">Composant</th>
                  <th className="px-4 py-2.5 font-medium text-right">Wins</th>
                  <th className="px-4 py-2.5 font-medium text-right">Losses</th>
                  <th className="px-4 py-2.5 font-medium text-right">Poids appris</th>
                </tr>
              </thead>
              <tbody>
                {componentBreakdown.map((c, i) => (
                  <tr key={`${c.symbol}-${c.component}-${i}`} className="border-t border-border/60">
                    <td className="px-4 py-2 text-muted-foreground">{c.symbol === "_global" ? "toutes (global)" : c.symbol}</td>
                    <td className="px-4 py-2 font-mono text-xs text-foreground">{c.component}</td>
                    <td className="px-4 py-2 text-right text-[color:var(--bull)]">{c.wins.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right text-[color:var(--bear)]">{c.losses.toFixed(1)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${c.weight > 1 ? "text-[color:var(--bull)]" : c.weight < 1 ? "text-[color:var(--bear)]" : "text-muted-foreground"}`}>
                      {c.weight.toFixed(2)}×
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── JOURNAL DRAWER: trades récents d'un utilisateur ── */}
      <Dialog open={!!journalUser} onOpenChange={(open) => !open && setJournalUser(null)}>
        <DialogContent className="glass-panel border-border/60 sm:rounded-2xl max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold uppercase tracking-wide">
              Journal de {journalUser?.username}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {journalUser?.trades} trade{(journalUser?.trades ?? 0) > 1 ? "s" : ""} clos · P&amp;L net {journalUser && (journalUser.netPnl > 0 ? "+" : "")}{journalUser?.netPnl.toFixed(2)} $
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {journalLoading ? (
              <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : journalTrades.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucun trade.</p>
            ) : (
              journalTrades.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {t.status === "won" ? (
                      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[color:var(--bull)]" />
                    ) : t.status === "lost" ? (
                      <TrendingDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--bear)]" />
                    ) : (
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full bg-amber-500/60" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground truncate">{t.symbol} · {t.direction}</div>
                      <div className="text-muted-foreground truncate">{new Date(t.time).toLocaleString("fr-FR")} · conf {t.confidence}% · TAS {t.tf_agreement}/4</div>
                      {t.note && <div className="text-muted-foreground/70 truncate">{t.note}</div>}
                    </div>
                  </div>
                  <div className={`shrink-0 text-right font-bold ${t.profit > 0 ? "text-[color:var(--bull)]" : t.profit < 0 ? "text-[color:var(--bear)]" : "text-muted-foreground"}`}>
                    {t.profit > 0 ? "+" : ""}{t.profit.toFixed(2)} $
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved:  "border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 text-[color:var(--bull)]",
    pending:   "border-amber-500/40 bg-amber-500/10 text-amber-500",
    rejected:  "border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
    suspended: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  };
  const label: Record<string, string> = {
    approved:  "approuvé",
    pending:   "en attente",
    rejected:  "rejeté",
    suspended: "révoqué",
  };
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${map[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}
