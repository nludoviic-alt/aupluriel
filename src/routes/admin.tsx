import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Check, X, Trash2, Loader2, RefreshCw, KeyRound, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

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

function AdminPage() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

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

  useEffect(() => {
    if (user?.is_admin) load();
  }, [user?.is_admin, load]);

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
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          className="w-full sm:w-auto h-10 text-sm sm:h-9"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>
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
