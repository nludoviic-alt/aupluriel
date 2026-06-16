import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Eye, EyeOff, KeyRound, Loader2, LogOut, MessageCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authorize, getBalance, SYMBOLS } from "@/lib/deriv";
import { toast } from "sonner";
import { api, clearToken } from "@/lib/api";
import { loadCoachSymbols, saveCoachSymbols } from "@/lib/coach";
import { cn } from "@/lib/utils";

const AI_KEY_STORAGE = "lio23.ai_api_key";
const AI_PROVIDER_STORAGE = "lio23.ai_provider";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — LIO23" }] }),
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
  const [aiProvider, setAiProvider] = useState<"anthropic" | "openai" | "google">("anthropic");
  const [coachSymbols, setCoachSymbols] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Load from localStorage as immediate fallback
    setToken(localStorage.getItem(KEYS.token) ?? "");
    setAccount((localStorage.getItem(KEYS.account) as "demo" | "live") ?? "demo");
    setRisk(Number(localStorage.getItem(KEYS.riskPerTrade) ?? 2));
    setMaxDd(Number(localStorage.getItem(KEYS.maxDrawdown) ?? 5));
    setAiKey(localStorage.getItem(AI_KEY_STORAGE) ?? "");
    setAiProvider((localStorage.getItem(AI_PROVIDER_STORAGE) as "anthropic" | "openai" | "google") ?? "anthropic");
    setCoachSymbols(loadCoachSymbols());
    // Then hydrate from server
    api.get<Record<string, unknown>>("/api/settings").then((s) => {
      if (s.deriv_token) setToken(s.deriv_token as string);
      if (s.account_type) setAccount(s.account_type as "demo" | "live");
      if (s.risk_per_trade) setRisk(s.risk_per_trade as number);
      if (s.max_drawdown) setMaxDd(s.max_drawdown as number);
      if (s.ai_provider) setAiProvider(s.ai_provider as "anthropic" | "openai" | "google");
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
      const res = await authorize(token);
      const bal = await getBalance();
      setInfo({
        id: res.authorize?.loginid,
        balance: bal?.balance,
        currency: bal?.currency,
      });
      saveLocal();
      await api.put("/api/settings", { deriv_token: token, account_type: account }).catch(() => {});
      toast.success(`Connecté: ${res.authorize?.loginid}`);
    } catch (e) {
      toast.error(`Échec: ${(e as Error).message}`);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Paramètres</h1>
          <p className="text-sm text-muted-foreground">Connexion Deriv et gestion du risque.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { clearToken(); window.location.href = "/login"; }}
          className="text-[color:var(--bear)] border-[color:var(--bear)]/30 hover:bg-[color:var(--bear)]/10"
        >
          <LogOut className="mr-1.5 h-4 w-4" /> Déconnexion
        </Button>
      </div>

      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 text-[color:var(--brand-cyan)]" />
          <div className="flex-1">
            <h2 className="text-base font-semibold">Token API Deriv</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Créé sur{" "}
              <a
                href="https://app.deriv.com/account/api-token"
                target="_blank"
                rel="noreferrer"
                className="text-[color:var(--brand-cyan)] hover:underline"
              >
                app.deriv.com → API token
              </a>
              . Stocké localement dans ce navigateur uniquement.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ex: a1b2c3d4..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm font-mono"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Compte:</span>
            {(["demo", "live"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setAccount(t)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  account === t
                    ? t === "demo"
                      ? "bg-[color:var(--bull)]/15 text-[color:var(--bull)] border border-[color:var(--bull)]/30"
                      : "bg-[color:var(--bear)]/15 text-[color:var(--bear)] border border-[color:var(--bear)]/30"
                    : "border border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
            {account === "live" && (
              <span className="text-xs text-[color:var(--bear)] flex items-center gap-1">
                <ShieldAlert className="h-3.5 w-3.5" /> Argent réel — sois prudent.
              </span>
            )}
          </div>

          <div className="flex gap-2">
            <Button onClick={testConnection} disabled={loading} className="bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-semibold">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Tester & enregistrer
            </Button>
            <Button variant="outline" onClick={saveLocal}>
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
        <h2 className="text-base font-semibold">Gestion du risque</h2>
        <p className="text-xs text-muted-foreground">Appliqué automatiquement à tous les signaux et ordres.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
              Risque par trade (%) — max recommandé: 2
            </span>
            <input
              type="number"
              min={0.1}
              max={10}
              step={0.1}
              value={risk}
              onChange={(e) => setRisk(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
              Max drawdown journalier (%)
            </span>
            <input
              type="number"
              min={1}
              max={50}
              value={maxDd}
              onChange={(e) => setMaxDd(Number(e.target.value))}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </label>
        </div>
        <Button onClick={saveLocal} variant="outline" className="mt-4">
          Enregistrer
        </Button>
        {risk > 2 && (
          <div className="mt-3 rounded-md border border-[color:var(--bear)]/30 bg-[color:var(--bear)]/5 p-2 text-xs text-[color:var(--bear)]">
            ⚠️ Risque par trade supérieur à 2% — non recommandé.
          </div>
        )}
      </div>

      {/* AI Provider */}
      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 h-5 w-5 text-[color:var(--brand-cyan)]" />
          <div className="flex-1">
            <h2 className="text-base font-semibold">Assistant IA</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choisis ton fournisseur IA et entre ta clé API. Elle est stockée localement.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {/* Provider selector */}
          <div>
            <span className="mb-2 block text-xs uppercase tracking-wider text-muted-foreground">Fournisseur</span>
            <div className="flex flex-wrap gap-2">
              {([
                { id: "google",    label: "Gemini (Google) — gratuit", desc: "aistudio.google.com · sans CB" },
                { id: "anthropic", label: "Claude (Anthropic)", desc: "Recommandé · console.anthropic.com" },
                { id: "openai",    label: "GPT-4o-mini (OpenAI)", desc: "platform.openai.com" },
              ] as const).map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setAiProvider(p.id);
                    localStorage.setItem(AI_PROVIDER_STORAGE, p.id);
                  }}
                  className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    aiProvider === p.id
                      ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]"
                      : "border-border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className="font-semibold">{p.label}</div>
                  <div className="text-xs opacity-70">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* API Key input */}
          <div>
            <span className="mb-1.5 block text-xs uppercase tracking-wider text-muted-foreground">
              Clé API{" "}
              {aiProvider === "google" && (
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-[color:var(--brand-cyan)] hover:underline normal-case">
                  → Obtenir une clé Google (gratuite)
                </a>
              )}
              {aiProvider === "anthropic" && (
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="text-[color:var(--brand-cyan)] hover:underline normal-case">
                  → Obtenir une clé Anthropic
                </a>
              )}
              {aiProvider === "openai" && (
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="text-[color:var(--brand-cyan)] hover:underline normal-case">
                  → Obtenir une clé OpenAI
                </a>
              )}
            </span>
            <div className="relative">
              <input
                type={showAiKey ? "text" : "password"}
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder={
                  aiProvider === "anthropic" ? "sk-ant-api03-..."
                  : aiProvider === "openai" ? "sk-proj-..."
                  : "AIza... (clé Google AI Studio)"
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 pr-10 text-sm font-mono"
              />
              <button
                type="button"
                onClick={() => setShowAiKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
            className="bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] font-semibold"
          >
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Enregistrer la clé IA
          </Button>

          {aiKey && (
            <p className="text-xs text-[color:var(--bull)] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5" /> Clé configurée — l'assistant IA est actif.
            </p>
          )}
        </div>
      </div>

      {/* Market coach — watched pairs */}
      <div className="glass-panel rounded-xl p-5">
        <div className="flex items-start gap-3">
          <MessageCircle className="mt-0.5 h-5 w-5 text-[color:var(--brand-cyan)]" />
          <div className="flex-1">
            <h2 className="text-base font-semibold">Coach marché</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Choisis les paires que le coach surveille pour ses bulles de conseils en temps réel.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {SYMBOLS.map((s) => {
            const active = coachSymbols.includes(s.deriv);
            return (
              <button
                key={s.deriv}
                onClick={() => {
                  const next = active
                    ? coachSymbols.filter((d) => d !== s.deriv)
                    : [...coachSymbols, s.deriv];
                  if (next.length === 0) {
                    toast.error("Garde au moins une paire surveillée.");
                    return;
                  }
                  setCoachSymbols(next);
                  saveCoachSymbols(next);
                }}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-[color:var(--brand-cyan)]/40 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Les changements sont appliqués immédiatement au coach.
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Avertissement: LIO23 est un outil d'analyse. Le trading de Crypto et Forex comporte un risque
        de perte en capital. Les performances passées ne préjugent pas des performances futures.
      </p>
    </div>
  );
}