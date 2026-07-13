import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Eye, EyeOff, FlaskConical, KeyRound, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { api, clearToken } from "@/lib/api";
import { cn } from "@/lib/utils";
import { loadDefaultStake, saveDefaultStake } from "@/lib/stake";

const AI_KEY_STORAGE = "lio23.ai_api_key";
const AI_PROVIDER_STORAGE = "lio23.ai_provider";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Paramètres — Pluriel" }] }),
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
  const [stake, setStake] = useState(5);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ id?: string; balance?: number; currency?: string } | null>(null);
  const [aiKey, setAiKey] = useState("");
  const [showAiKey, setShowAiKey] = useState(false);
  const [aiProvider, setAiProvider] = useState<"google" | "groq" | "openrouter">("groq");
  const [autoBacktestEnabled, setAutoBacktestEnabled] = useState(false);
  const [autoBacktestSaving, setAutoBacktestSaving] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Load from localStorage as immediate fallback
    setToken(localStorage.getItem(KEYS.token) ?? "");
    setAccount((localStorage.getItem(KEYS.account) as "demo" | "live") ?? "demo");
    setRisk(Number(localStorage.getItem(KEYS.riskPerTrade) ?? 2));
    setMaxDd(Number(localStorage.getItem(KEYS.maxDrawdown) ?? 5));
    setStake(loadDefaultStake());
    setAiKey(localStorage.getItem(AI_KEY_STORAGE) ?? "");
    setAiProvider((localStorage.getItem(AI_PROVIDER_STORAGE) as "google" | "groq" | "openrouter") ?? "groq");
    // Then hydrate from server
    api.get<Record<string, unknown>>("/api/settings").then((s) => {
      if (s.deriv_token) setToken(s.deriv_token as string);
      if (s.account_type) setAccount(s.account_type as "demo" | "live");
      if (s.risk_per_trade) setRisk(s.risk_per_trade as number);
      if (s.max_drawdown) setMaxDd(s.max_drawdown as number);
      if (s.default_stake_usd) { setStake(s.default_stake_usd as number); saveDefaultStake(s.default_stake_usd as number); }
      if (s.ai_provider) setAiProvider(s.ai_provider as "google" | "groq" | "openrouter");
      if (s.ai_api_key) setAiKey(s.ai_api_key as string);
      setAutoBacktestEnabled(!!s.auto_backtest_enabled);
    }).catch(() => {});
  }, []);

  async function toggleAutoBacktest(v: boolean) {
    setAutoBacktestSaving(true);
    setAutoBacktestEnabled(v);
    try {
      await api.put("/api/settings", { auto_backtest_enabled: v });
      toast.success(v ? "Backtest automatique activé" : "Backtest automatique désactivé");
    } catch {
      setAutoBacktestEnabled(!v);
      toast.error("Échec de l'enregistrement");
    } finally {
      setAutoBacktestSaving(false);
    }
  }

  async function saveLocal() {
    localStorage.setItem(KEYS.token, token);
    localStorage.setItem(KEYS.account, account);
    localStorage.setItem(KEYS.riskPerTrade, String(risk));
    localStorage.setItem(KEYS.maxDrawdown, String(maxDd));
    saveDefaultStake(stake);
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
    <div className="p-4 md:p-6 space-y-6 max-w-[1400px] mx-auto pb-24">
      {/* Header Panel */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3 bg-white/[0.01] border border-white/5 p-4.5 rounded-2xl shadow-sm">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight bg-gradient-to-r from-white via-white to-white/75 bg-clip-text text-transparent">
            Paramètres
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">Configurez votre accès broker et ajustez la gestion du risque.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { clearToken(); window.location.href = "/login"; }}
          className="text-red-400 border-red-500/20 hover:bg-red-500/10 hover:border-red-500/30 h-10 text-xs md:text-sm rounded-xl transition-all duration-300 px-4"
        >
          <LogOut className="mr-1.5 h-4 w-4" /> Déconnexion
        </Button>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* LEFT COLUMN: Connection & Broker */}
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-6 border border-red-500/25 bg-gradient-to-b from-red-500/[0.02] to-transparent shadow-sm space-y-5">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-1 h-5.5 w-5.5 shrink-0 text-red-400" />
              <div>
                <h2 className="text-sm md:text-base font-bold uppercase tracking-wider text-neutral-200">Connexion Broker</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  Associez votre compte réel ou de démonstration pour l'exécution des ordres.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="text-xs md:text-sm text-muted-foreground leading-relaxed">
                Créez une clé d'accès sur{" "}
                <a
                  href="https://app.deriv.com/account/api-token"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:underline font-semibold"
                >
                  app.deriv.com → API token
                </a>. Stockée localement dans ce navigateur uniquement.
              </div>

              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">Token API Deriv</span>
                <div className="relative">
                  <input
                    type={show ? "text" : "password"}
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="ex: a1b2c3d4..."
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 pr-10 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShow((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">Type de Compte</span>
                <div className="flex bg-neutral-950/80 p-1.5 rounded-xl border border-white/5 gap-1.5 max-w-[200px]">
                  {(["demo", "live"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setAccount(t)}
                      className={cn(
                        "flex-1 py-1.5 text-[10px] md:text-xs uppercase tracking-wider font-bold rounded-lg transition-all text-center",
                        account === t
                          ? t === "demo"
                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                            : "bg-red-500/15 text-red-400 border border-red-500/20 animate-pulse"
                          : "text-muted-foreground hover:text-foreground border border-transparent"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {account === "live" && (
                  <span className="text-xs text-[color:var(--bear)] flex items-center gap-1.5 font-medium">
                    <ShieldAlert className="h-4 w-4 shrink-0" /> Argent réel — sois prudent.
                  </span>
                )}
              </div>

              <div className="pt-2">
                <Button
                  onClick={testConnection}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-cyan-500/20 to-violet-500/20 hover:from-cyan-500/35 hover:to-violet-500/35 text-cyan-400 border border-cyan-500/30 font-bold h-10 text-xs md:text-sm rounded-xl shadow-sm transition-all"
                >
                  {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                  Tester & enregistrer Deriv
                </Button>
              </div>

              {info && (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3.5 text-xs">
                  <div className="font-bold text-emerald-400 flex items-center gap-1.5">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    Connexion active
                  </div>
                  <div className="text-muted-foreground mt-1.5 space-y-1 font-mono text-[11px] md:text-xs">
                    <div>Compte ID : <span className="text-neutral-200 font-bold">{info.id}</span></div>
                    {info.balance !== undefined && (
                      <div>Solde : <span className="text-neutral-200 font-bold">{info.balance.toFixed(2)} {info.currency}</span></div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Auto-Backtest Card */}
          <div className="glass-panel rounded-2xl p-6 border border-border/40 shadow-sm space-y-5">
            <div className="flex items-start gap-3">
              <FlaskConical className="mt-1 h-5.5 w-5.5 text-cyan-400 shrink-0" />
              <div>
                <h2 className="text-sm md:text-base font-bold uppercase tracking-wider text-neutral-200">Backtest automatique</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  Rejoue le pipeline live toutes les 6h. Si le win rate mesuré dépasse le seuil de rentabilité,
                  le bot serveur démarre en Démo ; sinon il s'arrête. Le mode Live n'est jamais touché.
                </p>
              </div>
            </div>

            <div
              className={cn(
                "flex items-center justify-between p-3.5 rounded-xl border transition-all",
                autoBacktestEnabled ? "bg-cyan-500/5 border-cyan-500/20" : "bg-white/[0.005] border-white/5"
              )}
            >
              <div>
                <h4 className="text-xs md:text-sm text-neutral-200 font-bold">Activer l'automatisme</h4>
                <p className="text-[11px] md:text-xs text-muted-foreground mt-0.5">
                  Démarre/arrête le bot Démo selon le verdict du backtest, sans intervention.
                </p>
              </div>
              <Switch checked={autoBacktestEnabled} disabled={autoBacktestSaving} onCheckedChange={toggleAutoBacktest} />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Risk & AI */}
        <div className="space-y-6">
          {/* Risk Management Card */}
          <div className="glass-panel rounded-2xl p-6 border border-border/40 shadow-sm space-y-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-1 h-5.5 w-5.5 text-amber-400 shrink-0" />
              <div>
                <h2 className="text-sm md:text-base font-bold uppercase tracking-wider text-neutral-200">Gestion du risque</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  Appliqué automatiquement à tous les signaux et ordres.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">
                  Mise par défaut ($)
                </span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs md:text-sm">$</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={stake}
                    onChange={(e) => setStake(Number(e.target.value))}
                    className="w-full rounded-xl border border-border bg-background pl-7 pr-3 py-2.5 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">
                    Risque par trade (%)
                  </span>
                  <div className="relative">
                    <input
                      type="number"
                      min={0.1}
                      max={10}
                      step={0.1}
                      value={risk}
                      onChange={(e) => setRisk(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs md:text-sm">%</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">
                    Drawdown Max (%)
                  </span>
                  <div className="relative">
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={maxDd}
                      onChange={(e) => setMaxDd(Number(e.target.value))}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs md:text-sm">%</span>
                  </div>
                </div>
              </div>

              {risk > 2 && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3.5 text-xs text-red-400 font-medium leading-relaxed">
                  ⚠️ Risque par trade supérieur à 2% — non recommandé pour conserver votre capital sur le long terme.
                </div>
              )}
            </div>
          </div>

          {/* AI Assistant Card */}
          <div className="glass-panel rounded-2xl p-6 border border-border/40 shadow-sm space-y-5">
            <div className="flex items-start gap-3">
              <Bot className="mt-1 h-5.5 w-5.5 text-violet-400 shrink-0" />
              <div>
                <h2 className="text-sm md:text-base font-bold uppercase tracking-wider text-neutral-200">Assistant IA</h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">
                  Choisis ton fournisseur IA et entre ta clé API. Elle est stockée localement.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Provider selector */}
              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300">Fournisseur</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {([
                    { id: "groq",       label: "Groq (gratuit)", desc: "console.groq.com" },
                    { id: "openrouter", label: "OpenRouter (gratuit)", desc: "openrouter.ai" },
                    { id: "google",     label: "Gemini", desc: "aistudio.google.com" },
                  ] as const).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setAiProvider(p.id);
                        localStorage.setItem(AI_PROVIDER_STORAGE, p.id);
                      }}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left text-xs transition-all",
                        aiProvider === p.id
                          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-400 font-semibold"
                          : "border-border text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <div className="font-bold">{p.label}</div>
                      <div className="text-[10px] opacity-70 mt-0.5 leading-normal">{p.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* API Key input */}
              <div className="space-y-2">
                <span className="text-[11px] md:text-xs font-bold uppercase tracking-wider text-neutral-300 flex flex-wrap items-center gap-1.5">
                  Clé API
                  {aiProvider === "groq" && (
                    <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline normal-case font-bold">
                      → Obtenir une clé Groq (gratuite)
                    </a>
                  )}
                  {aiProvider === "openrouter" && (
                    <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline normal-case font-bold">
                      → Obtenir une clé OpenRouter (gratuite)
                    </a>
                  )}
                  {aiProvider === "google" && (
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline normal-case font-bold">
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
                    className="w-full rounded-xl border border-border bg-background px-3 py-2.5 pr-10 text-xs md:text-sm font-mono text-foreground focus:ring-1 focus:ring-cyan-500/50 outline-none"
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
                className="w-full bg-gradient-to-r from-cyan-500/20 to-violet-500/20 hover:from-cyan-500/35 hover:to-violet-500/35 text-cyan-400 border border-cyan-500/30 font-bold h-10 text-xs md:text-sm rounded-xl shadow-sm transition-all"
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Enregistrer la clé IA
              </Button>

              {aiKey && (
                <p className="text-xs text-[color:var(--bull)] flex items-center gap-2 font-medium">
                  <CheckCircle2 className="h-4 w-4 shrink-0" /> Clé configurée — l'assistant IA est actif.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Global Unified Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/5">
        <p className="text-[11px] md:text-xs text-muted-foreground leading-normal max-w-2xl text-center sm:text-left">
          Avertissement : Pluriel est un outil d'analyse. Le trading de Crypto et Forex comporte un risque important
          de perte en capital. Les performances passées ne préjugent pas des performances futures.
        </p>
        <Button
          onClick={saveLocal}
          className="w-full sm:w-auto px-8 py-3 bg-gradient-to-r from-cyan-400 to-violet-500 hover:opacity-90 text-background font-bold text-xs md:text-sm rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.2)] transition-all duration-300 h-11"
        >
          <CheckCircle2 className="mr-2 h-4 w-4" /> Enregistrer toutes les modifications
        </Button>
      </div>
    </div>
  );
}