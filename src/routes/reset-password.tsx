import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuthShell } from "./verify-email";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Réinitialisation — PLURIEL" }] }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) {
      toast.error("Lien invalide : token manquant.");
      return;
    }
    setLoading(true);
    try {
      const data = await api.post<{ message?: string }>("/api/auth/reset-password", {
        token,
        password,
      });
      toast.success(data.message ?? "Mot de passe réinitialisé.");
      navigate({ to: "/login" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <div>
          <h2 className="text-base font-semibold text-foreground mb-1">Nouveau mot de passe</h2>
          <p className="text-xs text-muted-foreground mb-3">Choisis un mot de passe (6 caractères min.).</p>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              className="w-full rounded-lg border border-input bg-background pl-9 pr-9 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Enregistrement…" : "Réinitialiser"}
        </Button>
        <Link to="/login" className="block text-center text-xs text-muted-foreground hover:text-foreground">
          Retour à la connexion
        </Link>
      </form>
    </AuthShell>
  );
}
