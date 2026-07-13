import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { AuthShell } from "./verify-email";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Mot de passe oublié — PLURIEL" }] }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.post<{ message?: string }>("/api/auth/forgot-password", { email });
      setSent(true);
      toast.success(data.message ?? "Email envoyé si le compte existe.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      {sent ? (
        <div className="text-center">
          <p className="text-sm text-foreground">
            Si un compte existe pour <span className="font-medium">{email}</span>, un lien de
            réinitialisation vient d'être envoyé. Vérifie ta boîte mail (et les spams).
          </p>
          <Link to="/login" className="mt-4 inline-block text-xs text-muted-foreground hover:text-foreground">
            Retour à la connexion
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div>
            <h2 className="text-base font-semibold text-foreground mb-1">Mot de passe oublié</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Entre ton email, on t'enverra un lien pour choisir un nouveau mot de passe.
            </p>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                required
                className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Envoi…" : "Envoyer le lien"}
          </Button>
          <Link to="/login" className="block text-center text-xs text-muted-foreground hover:text-foreground">
            Retour à la connexion
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
