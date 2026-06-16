import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { api } from "@/lib/api";

export const Route = createFileRoute("/verify-email")({
  head: () => ({ meta: [{ title: "Vérification — LIO23" }] }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      setMessage("Lien invalide : token manquant.");
      return;
    }
    api
      .post<{ message?: string }>("/api/auth/verify-email", { token })
      .then((data) => {
        setState("ok");
        setMessage(data.message ?? "Email vérifié !");
      })
      .catch((err: unknown) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "La vérification a échoué.");
      });
  }, []);

  return (
    <AuthShell>
      {state === "loading" && (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Vérification en cours…</p>
        </div>
      )}
      {state === "ok" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 className="h-12 w-12 text-[color:var(--bull)]" />
          <p className="text-sm text-foreground">{message}</p>
          <Link
            to="/login"
            className="mt-2 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Aller à la connexion
          </Link>
        </div>
      )}
      {state === "error" && (
        <div className="flex flex-col items-center gap-3 text-center">
          <XCircle className="h-12 w-12 text-[color:var(--bear)]" />
          <p className="text-sm text-foreground">{message}</p>
          <Link to="/login" className="mt-2 text-xs text-muted-foreground hover:text-foreground">
            Retour à la connexion
          </Link>
        </div>
      )}
    </AuthShell>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <LogoMark className="h-16 w-16" />
          <div className="text-center">
            <h1 className="text-2xl font-extrabold tracking-tight brand-gradient-text">LIO23</h1>
            <p className="text-sm text-muted-foreground">Quant Trading AI — Crypto & Forex</p>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl shadow-black/20 flex items-center justify-center min-h-[160px]">
          {children}
        </div>
      </div>
    </div>
  );
}
