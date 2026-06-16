import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Check, X, Trash2, Loader2, RefreshCw } from "lucide-react";
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

  async function act(userId: number, action: "approve" | "reject" | "delete") {
    if (action === "delete" && !confirm("Supprimer définitivement ce compte ?")) return;
    setBusyId(userId);
    try {
      await api.post("/api/admin/users", { userId, action });
      toast.success(
        action === "approve" ? "Compte approuvé" : action === "reject" ? "Compte rejeté" : "Compte supprimé",
      );
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
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="h-6 w-6 text-[color:var(--brand-cyan)]" />
        <h1 className="text-xl font-bold text-foreground">Administration</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          className="ml-auto"
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Actualiser
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        {users.length} compte{users.length > 1 ? "s" : ""} · {pending.length} en attente
        d'approbation
      </p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Utilisateur</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Vérifié</th>
              <th className="px-3 py-2 font-medium">Statut</th>
              <th className="px-3 py-2 font-medium">Inscrit</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  Aucun compte.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium text-foreground">
                    {u.username}
                    {u.is_admin ? (
                      <span className="ml-1.5 rounded bg-[color:var(--brand-cyan)]/15 px-1.5 py-0.5 text-[10px] text-[color:var(--brand-cyan)]">
                        admin
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-3 py-2">
                    {u.email_verified ? (
                      <span className="text-[color:var(--bull)]">oui</span>
                    ) : (
                      <span className="text-muted-foreground">non</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {new Date(u.created_at * 1000).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-3 py-2">
                    {u.is_admin ? (
                      <span className="block text-right text-xs text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        {u.status !== "approved" && (
                          <button
                            onClick={() => act(u.id, "approve")}
                            disabled={busyId === u.id}
                            title="Approuver"
                            className="rounded-md border border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 p-1.5 text-[color:var(--bull)] hover:bg-[color:var(--bull)]/20 disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {u.status !== "rejected" && (
                          <button
                            onClick={() => act(u.id, "reject")}
                            disabled={busyId === u.id}
                            title="Rejeter"
                            className="rounded-md border border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 p-1.5 text-[color:var(--bear)] hover:bg-[color:var(--bear)]/20 disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => act(u.id, "delete")}
                          disabled={busyId === u.id}
                          title="Supprimer"
                          className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: "border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 text-[color:var(--bull)]",
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    rejected: "border-[color:var(--bear)]/40 bg-[color:var(--bear)]/10 text-[color:var(--bear)]",
  };
  const label: Record<string, string> = {
    approved: "approuvé",
    pending: "en attente",
    rejected: "rejeté",
  };
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${map[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}
