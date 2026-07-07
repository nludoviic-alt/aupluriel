import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { User, Mail, Lock, Eye, EyeOff, KeyRound } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api, setToken, TOKEN_KEY } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({ 
    meta: [
      { title: "Access — Vertex Quant Terminal" },
      { name: "description", content: "Connect to your Vertex quantitative trading AI terminal." }
    ] 
  }),
  component: LoginPage,
});

interface AuthResponse {
  token?: string;
  user?: { id: number; email: string; username: string; is_admin?: number };
  requiresVerification?: boolean;
  message?: string;
}

function LoginPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);

  // Only check auth once on mount, not continuously
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      // Verify token is valid with a single check
      api.get("/api/auth/me").then(() => {
        navigate({ to: "/" });
      }).catch(() => {
        // Invalid token, stay on login
        localStorage.removeItem(TOKEN_KEY);
      });
    }
  }, [navigate]);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);

  // Register form state
  const [regEmail, setRegEmail] = useState("");
  const [regUsername, setRegUsername] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [showRegPw, setShowRegPw] = useState(false);
  const [regInvite, setRegInvite] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.post<AuthResponse>("/api/auth/login", {
        email: loginEmail,
        password: loginPassword,
      });
      if (data.token && data.user) {
        setToken(data.token);
        toast.success(`Bienvenue, ${data.user.username} !`);
        navigate({ to: "/" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur de connexion");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await api.post<AuthResponse>("/api/auth/register", {
        email: regEmail,
        username: regUsername,
        password: regPassword,
        inviteCode: regInvite || undefined,
      });
      // Admin accounts log in immediately; everyone else must verify + await approval.
      if (data.token && data.user) {
        setToken(data.token);
        toast.success(`Compte créé ! Bienvenue, ${data.user.username} !`);
        navigate({ to: "/" });
      } else {
        toast.success(data.message ?? "Compte créé. Vérifie ta boîte mail pour l'activer.");
        setTab("login");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendVerification() {
    if (!loginEmail) {
      toast.error("Saisis ton email ci-dessus d'abord.");
      return;
    }
    try {
      const data = await api.post<{ message?: string }>("/api/auth/resend-verification", {
        email: loginEmail,
      });
      toast.success(data.message ?? "Si un compte non vérifié existe, un email a été envoyé.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white selection:bg-orange-500/30 overflow-hidden font-sans relative">
      {/* Simple static orange sun glow background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden bg-black">
        {/* Soft static sun glow */}
        <div className="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-orange-500/10 rounded-full blur-[120px]" />
        
        {/* Subtle ambient light */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(234,88,12,0.05),transparent_70%)]" />
      </div>

      {/* Auth Form Container */}
      <div className="w-full max-w-[480px] p-6 relative z-10 animate-in fade-in zoom-in-95 duration-1000">
        <div className="flex flex-col items-center space-y-8">
          {/* Harmonized Header - Centered with Logo & Text on same line */}
          <div className="flex items-center justify-center gap-6 w-full">
            {/* Logo Mark */}
            <div className="relative group cursor-default">
              <div className="absolute -inset-3 rounded-full bg-orange-500/15 blur-2xl group-hover:bg-orange-500/25 transition-all duration-500" />
              <LogoMark className="h-20 w-20 relative z-10 shadow-orange-500/10 shadow-2xl transition-transform duration-500 group-hover:scale-105" />
            </div>

            {/* Vertex & Future Text stacked */}
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-3">
                <h2 className="text-5xl md:text-6xl font-black tracking-tighter text-white leading-tight">
                  Vertex
                </h2>
                <div className="relative flex h-3 w-3 mt-1">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-orange-500 shadow-[0_0_15px_rgba(234,88,12,0.8)]"></span>
                </div>
              </div>
              
              <div className="flex items-center space-x-3 opacity-80">
                <span className="h-px w-8 bg-gradient-to-r from-transparent to-orange-500/40" />
                <p className="text-orange-500/90 font-black text-[11px] uppercase tracking-[0.3em]">
                  the future
                </p>
                <span className="h-px w-8 bg-gradient-to-l from-transparent to-orange-500/40" />
              </div>
            </div>
          </div>

          <div className="w-full relative">
            {/* Enhanced glow effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-br from-orange-500/20 via-amber-500/10 to-orange-600/20 rounded-[2.5rem] blur-2xl opacity-75 animate-pulse-slow" />
            <div className="absolute -inset-1 bg-gradient-to-r from-orange-500/5 via-amber-500/5 to-orange-700/5 rounded-[2.5rem] blur-xl opacity-50" />
            
            <div className="relative bg-gradient-to-b from-black/80 to-black/90 border border-white/10 backdrop-blur-3xl rounded-[2.5rem] p-8 md:p-10 shadow-2xl overflow-hidden">
              {/* Subtle inner glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent rounded-[2.5rem] pointer-events-none" />
              
              {/* Tabs Toggle */}
              <div className="relative flex p-1.5 bg-white/5 rounded-2xl mb-8 border border-white/5 shadow-inner">
                <button
                  onClick={() => setTab("login")}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                    tab === "login" 
                      ? "bg-gradient-to-r from-orange-500 to-amber-600 text-white shadow-lg shadow-orange-500/25" 
                      : "text-gray-500 hover:text-white hover:bg-white/5"
                  }`}
                >
                  Connexion
                </button>
                <button
                  onClick={() => setTab("register")}
                  className={`flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 ${
                    tab === "register" 
                      ? "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25" 
                      : "text-gray-500 hover:text-white hover:bg-white/5"
                  }`}
                >
                  S'inscrire
                </button>
              </div>

              {tab === "login" ? (
                <form onSubmit={handleLogin} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Adresse Email</label>
                    <div className="relative group">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-600 group-focus-within:text-orange-400 transition-colors duration-300" />
                      <input
                        type="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="nom@exemple.com"
                        required
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/30 transition-all duration-300"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Mot de Passe</label>
                      <Link to="/forgot-password" className="text-[10px] text-orange-500/80 hover:text-orange-400 transition-colors font-bold uppercase tracking-wider">
                        Oublié ?
                      </Link>
                    </div>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-600 group-focus-within:text-orange-400 transition-colors duration-300" />
                      <input
                        type={showLoginPw ? "text" : "password"}
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl pl-12 pr-12 py-4 text-white placeholder:text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/30 transition-all duration-300"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLoginPw(!showLoginPw)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white transition-colors duration-300"
                      >
                        {showLoginPw ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    disabled={loading} 
                    className="w-full py-7 rounded-2xl bg-gradient-to-r from-orange-600 to-amber-700 hover:from-orange-500 hover:to-amber-600 text-white font-black uppercase tracking-[0.2em] shadow-[0_10px_30px_-10px_rgba(234,88,12,0.4)] border-none transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? "Connexion..." : "Ouvrir le Terminal"}
                  </Button>

                  <div className="pt-4 text-center">
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      className="text-[10px] font-bold uppercase tracking-widest text-gray-500 hover:text-orange-400 transition-colors duration-300"
                    >
                      Pas reçu d'email ? <span className="underline underline-offset-4 decoration-white/10">Renvoyer</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleRegister} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Email</label>
                    <div className="relative group">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-600 group-focus-within:text-amber-400 transition-colors" />
                      <input
                        type="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="nom@exemple.com"
                        required
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Pseudo</label>
                    <div className="relative group">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-600 group-focus-within:text-amber-400 transition-colors" />
                      <input
                        type="text"
                        value={regUsername}
                        onChange={(e) => setRegUsername(e.target.value)}
                        placeholder="Votre pseudo"
                        required
                        minLength={2}
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Mot de Passe</label>
                    <div className="relative group">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-600 group-focus-within:text-amber-400 transition-colors" />
                      <input
                        type={showRegPw ? "text" : "password"}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        placeholder="6+ caractères"
                        required
                        minLength={6}
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl pl-12 pr-12 py-4 text-white placeholder:text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRegPw(!showRegPw)}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-600 hover:text-white transition-colors"
                      >
                        {showRegPw ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] ml-1">Code d'invitation</label>
                    <div className="relative group">
                      <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-600 group-focus-within:text-amber-400 transition-colors" />
                      <input
                        type="text"
                        value={regInvite}
                        onChange={(e) => setRegInvite(e.target.value)}
                        placeholder="Optionnel"
                        className="w-full bg-white/[0.03] border border-white/5 rounded-2xl pl-12 pr-4 py-4 text-white placeholder:text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 transition-all"
                      />
                    </div>
                  </div>

                  <Button 
                    type="submit" 
                    disabled={loading} 
                    className="w-full py-7 rounded-2xl bg-gradient-to-r from-amber-600 to-orange-700 hover:from-amber-500 hover:to-orange-600 text-white font-black uppercase tracking-[0.2em] shadow-[0_10px_30px_-10px_rgba(245,158,11,0.4)] border-none transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? "Création..." : "Créer mon compte"}
                  </Button>
                </form>
              )}
            </div>
          </div>
          
        </div>
      </div>

      {/* Subtle Watermark */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none select-none z-0">
        <h1 className="text-[10rem] font-black uppercase tracking-[0.3em] text-white/[0.04] leading-none">
          Vertex
        </h1>
      </div>
    </div>



  );
}
