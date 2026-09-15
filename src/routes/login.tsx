import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api, setToken, TOKEN_KEY } from "@/lib/api";

export const Route = createFileRoute("/login")({
  head: () => ({ 
    meta: [
      { title: "Access — Au Pluriel Quant Terminal" },
      { name: "description", content: "Connect to your Au Pluriel quantitative trading AI terminal." }
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
          {/* Logo only — the mark already carries "Au Pluriel" + "THE FUTURE",
              repeating them as a separate text block was pure duplication. */}
          <div className="flex items-center justify-center w-full">
            <div className="relative group cursor-default">
              <div className="absolute -inset-4 rounded-full bg-orange-500/15 blur-2xl group-hover:bg-orange-500/25 transition-all duration-500" />
                          </div>
          </div>

          <div className="w-full relative">
            {/* Enhanced glow effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-br from-orange-500/20 via-amber-500/10 to-orange-600/20 rounded-[2.5rem] blur-2xl opacity-75 animate-pulse-slow" />
            <div className="absolute -inset-1 bg-gradient-to-r from-orange-500/5 via-amber-500/5 to-orange-700/5 rounded-[2.5rem] blur-xl opacity-50" />
            
            <div className="relative bg-gradient-to-b from-black/80 to-black/90 border border-white/10 backdrop-blur-3xl rounded-[2.5rem] p-8 md:p-10 shadow-2xl overflow-hidden">
              {/* Subtle inner glow */}
              <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent rounded-[2.5rem] pointer-events-none" />
              
              {/* Access is admin-provisioned only — no public sign-up. */}
              <div className="mb-8 text-center">
                <h2 className="text-lg font-black uppercase tracking-[0.2em] text-white">Connexion</h2>
              </div>

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
                </form>
            </div>
          </div>
          
        </div>
      </div>

      {/* Subtle Watermark */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none select-none z-0 whitespace-nowrap">
        <h1 className="text-7xl sm:text-8xl md:text-[10rem] font-black uppercase tracking-[0.15em] md:tracking-[0.25em] text-white/[0.04] leading-none">
          AU PLURIEL
        </h1>
      </div>
    </div>



  );
}
