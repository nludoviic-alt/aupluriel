import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api, clearToken } from "@/lib/api";
import { cn } from "@/lib/utils";

const AI_KEY_STORAGE = "lio23.ai_api_key";
const AI_PROVIDER_STORAGE = "lio23.ai_provider";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Vertex" }] }),
  component: SettingsPage,
});

const KEYS = {
  token: "lio23.deriv_token",
  account: "lio23.account_type",
  riskPerTrade: "lio23.risk_per_trade",
  maxDrawdown: "lio23.max_drawdown",
};

function SettingsPage() {
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [account, setAccount] = useState<"demo" | "live">("demo");
  const [risk, setRisk] = useState(2);
  const [maxDd, setMaxDd] = useState(5);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ id?: string; balance?: number; currency?: string } | null>(null);
  const [aiKey, setAiKey] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiProvider, setAiProvider] = useState<"google" | "groq" | "openrouter">("groq");

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Load from localStorage as immediate fallback
    setToken(localStorage.getItem(KEYS.token) ?? "");
    setAccount((localStorage.getItem(KEYS.account) as "demo" | "live") ?? "demo");
    setRisk(Number(localStorage.getItem(KEYS.riskPerTrade) ?? 2));
    setMaxDd(Number(localStorage.getItem(KEYS.maxDrawdown) ?? 5));
    setAiKey(localStorage.getItem(AI_KEY_STORAGE) ?? "");
    setAiProvider((localStorage.getItem(AI_PROVIDER_STORAGE) as "google" | "groq" | "openrouter") ?? "groq");
    // Then hydrate from server
    api.get<Record<string, unknown>>("/api/settings").then((s) => {
      if (s.deriv_token) setToken(s.deriv_token as string);
      if (s.account_type) setAccount(s.account_type as "demo" | "live");
      if (s.risk_per_trade) setRisk(s.risk_per_trade as number);
      if (s.max_drawdown) setMaxDd(s.max_drawdown as number);
      if (s.ai_provider) setAiProvider(s.ai_provider as "google" | "groq" | "openrouter");
      if (s.ai_api_key) setAiKey(s.ai_api_key as string);
    }).catch(() => {});
  }, []);

  async function saveLocal() {
    localStorage.setItem(KEYS.token, token);
    localStorage.setItem(KEYS.account, account);
    localStorage.setItem(KEYS.riskPerTrade, String(risk));
    localStorage.setItem(KEYS.maxDrawdown, String(maxDd));
    await api.put("/api/settings", {
      deriv_token: token || null,
      account_type: account,
      risk_per_trade: risk,
      max_drawdown: maxDd,
    }).catch(() => {});
    toast.success("Paramètres enregistrés");
  }

  async function testConnection() {
    if (!token) {
      toast.error("Entre un token API d'abord");
      return;
    }
    setLoading(true);
    try {
      await saveLocal();
      const res = await api.post<{
        wsUrl?: string;
        loginId?: string;
        balance?: number;
        currency?: string;
        accountType?: string;
        error?: string;
      }>("/api/deriv-session", { token, account_type: account });
      if (res.error || !res.wsUrl) throw new Error(res.error ?? "Connexion échouée");
      setInfo({ id: res.loginId, balance: res.balance, currency: res.currency });
      toast.success(`Connecté: ${res.loginId} (${res.accountType})`);
    } catch (e) {
      toast.error(`Échec: ${(e as Error).message}`);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-3xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">Paramètres</h1>
          <p className="text-sm text-muted-foreground">Connexion Deriv et gestion du risque.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { clearToken(); window.location.href = "/login"; }}
          className="text-[color:var(--bear)] border-[color:var(--bear)]/30 hover:bg-[color:var(--bear)]/10 h-10 text-sm sm:h-9"
        >
          <LogOut className="mr-1.5 h-4 w-4" /> Déconnexion
        </Button>
      </div>

      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-1 h-5 w-5 text-[color:var(--brand-cyan)] shrink-0" />
          <div className="flex-1">
            <h2 className="text-sm font-bold uppercase tracking-wide">Token API Deriv</h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Créé sur{" "}
              <a
                href="https://app.deriv.com/account/api-token"
                target="_blank"
                rel="noreferrer"
                className="text-[color:var(--brand-cyan)] hover:underline font-semibold"
              >
                app.deriv.com → API token
              </a>
              . Stocké localement dans ce navigateur uniquement.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ex: a1b2c3d4..."
              className="w-full rounded-md border border-border bg-background px-3 py-3 pr-10 text-sm font-mono sm:py-2"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Compte:</span>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-2">
              {(["demo", "live"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setAccount(t)}
                  className={`rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wider transition-all sm:py-1.5 ${
                    account === t
                      ? t === "demo"
                        ? "bg-[color:var(--bull)]/15 text-[color:var(--bull)] border border-[color:var(--bull)]/35 shadow-sm"
                        : "bg-[color:var(--bear)]/15 text-[color:var(--bear)] border border-[color:var(--bear)]/35 shadow-sm"
                      : "border border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {account === "live" && (
              <span className="text-xs text-[color:var(--bear)] flex items-center gap-1.5 font-medium mt-1 sm:mt-0">
                <ShieldAlert className="h-4 w-4 shrink-0" /> Argent réel — sois prudent.
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:flex sm:gap-2">
            <Button onClick={testConnection} disabled={loading} className="bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-bold h-11 text-sm sm:h-9">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Tester & enregistrer
            </Button>
            <Button variant="outline" onClick={saveLocal} className="h-11 text-sm sm:h-9">
              Enregistrer
            </Button>
          </div>

          {info && (
            <div className="rounded-md border border-[color:var(--bull)]/30 bg-[color:var(--bull)]/5 p-3 text-sm">
              <div className="font-medium text-[color:var(--bull)]">Connexion réussie</div>
              <div className="text-xs text-muted-foreground mt-1">
                LoginID: <span className="font-mono">{info.id}</span>
                {info.balance !== undefined && (
                  <> · Balance: <span className="font-mono">{info.balance.toFixed(2)} {info.currency}</span></>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="glass-panel rounded-xl p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide">Gestion du risque</h2>
        <p className="text-xs text-muted-foreground leading-relaxed mt-1">Appliqué automatiquement à tous les signaux et ordres.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Risque par trade (%) — max recommandé: 2
            </span>
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={risk}
              onChange={(e) => setRisk(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-3 text-sm sm:py-2"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Max drawdown journalier (%)
            </span>
            <input
              type="number"
              min={1}
              max={50}
              value={maxDd}
              onChange={(e) => setMaxDd(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-3 text-sm sm:py-2"
            />
          </label>
        </div>
        <Button onClick={saveLocal} variant="outline" className="mt-4 w-full h-11 text-sm sm:w-auto sm:h-9">
          Enregistrer
        </Button>
        {risk > 2 && (
          <div className="mt-3 rounded-lg border border-[color:var(--bear)]/30 bg-[color:var(--bear)]/5 p-3 text-xs text-[color:var(--bear)] font-medium leading-relaxed">
            ⚠️ Risque par trade supérieur à 2% — non recommandé.
          </div>
        )}
      </div>

      {/* AI Provider */}
      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Bot className="mt-1 h-5 w-5 text-[color:var(--brand-cyan)] shrink-0" />
          <div className="flex-1">
            <h2 className="text-sm font-bold uppercase tracking-wide">Assistant IA</h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Choisis ton fournisseur IA et entre ta clé API. Elle est stockée localement.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {/* Provider selector */}
          <div>
            <span className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground font-semibold">Fournisseur</span>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-2">
              {([
                { id: "groq",       label: "Groq — Llama 3.3 (gratuit)", desc: "console.groq.com · très rapide" },
                { id: "openrouter", label: "OpenRouter — Llama 3.3 (gratuit)", desc: "openrouter.ai · modèles :free" },
                { id: "google",     label: "Gemini (Google)", desc: "aistudio.google.com" },
              ] as const).map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setAiProvider(p.id);
                    localStorage.setItem(AI_PROVIDER_STORAGE, p.id);
                  }}
                  className={`rounded-lg border px-4 py-3.5 text-left text-xs transition-all sm:px-3 sm:py-2 ${
                    aiProvider === p.id
                      ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)] font-semibold"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="font-bold">{p.label}</div>
                  <div className="text-xs opacity-70 mt-1 leading-normal">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* API Key input */}
          <div>
            <span className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Clé API{" "}
              {aiProvider === "groq" && (
                <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-[color:var(--brand-cyan)] hover:underline normal-case font-bold">
                  → Obtenir une clé Groq (gratuite)
                </a>
              )}
              {aiProvider === "openrouter" && (
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-[color:var(--brand-cyan)] hover:underline normal-case font-bold">
                  → Obtenir une clé OpenRouter (gratuite)
                </a>
              )}
              {aiProvider === "google" && (
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-[color:var(--brand-cyan)] hover:underline normal-case font-bold">
                  → Obtenir une clé Google (gratuite)
                </a>
              )}
            </span>
            <div className="relative">
              <input
                type={showAiKey ? "text" : "password"}
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={
                  aiProvider === "groq" ? "gsk_..."
                  : aiProvider === "openrouter" ? "sk-or-v1-..."
                  : "AIza... ou AQ... (clé Google AI Studio)"
                }
                className="w-full rounded-md border border-border bg-background px-3 py-3 pr-10 text-sm font-mono sm:py-2"
              />
              <button
                type="button"
                onClick={() => setShowAiKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showAiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button
            onClick={async () => {
              localStorage.setItem(AI_KEY_STORAGE, aiKey);
              localStorage.setItem(AI_PROVIDER_STORAGE, aiProvider);
              await api.put("/api/settings", { ai_api_key: aiKey, ai_provider: aiProvider }).catch(() => {});
              toast.success("Clé API IA enregistrée ✓");
            }}
            className="w-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-bold h-11 text-sm sm:w-auto sm:h-9"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Enregistrer la clé IA
          </Button>

          {aiKey && (
            <p className="text-xs text-[color:var(--bull)] flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> Clé configurée — l'assistant IA est actif.
            </p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Avertissement: Vertex est un outil d'analyse. Le trading de Crypto et Forex comporte un risque
        de perte en capital. Les performances passées ne préjugent pas des performances futures.
      </p>
    </div>
  );
}