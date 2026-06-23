import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  LayoutDashboard, Radar, Zap, BriefcaseBusiness, FlaskConical,
  BarChart3, CandlestickChart, Workflow, Calculator, Bell, Settings,
  ShieldCheck, LogOut, X,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

const NAV_PRIMARY = [
  { title: "Dashboard",   url: "/",           icon: LayoutDashboard },
  { title: "Portfolio",   url: "/portfolio",  icon: BriefcaseBusiness },
  { title: "IA Signals",  url: "/signals",    icon: Radar },
  { title: "Auto-Trader", url: "/autotrader", icon: Zap },
];

const NAV_MORE = [
  { title: "Backtest",        url: "/backtest",        icon: FlaskConical },
  { title: "Journal",         url: "/journal",         icon: BarChart3 },
  { title: "Marchés",         url: "/markets",         icon: CandlestickChart },
  { title: "Stratégies",      url: "/strategies",      icon: Workflow },
  { title: "Risk Calculator", url: "/risk-calculator", icon: Calculator },
  { title: "Alertes",         url: "/alerts",          icon: Bell },
  { title: "Paramètres",      url: "/settings",        icon: Settings },
];

export function MobileMenu() {
  const { openMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();

  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const close = () => setOpenMobile(false);

  // Close on route change
  useEffect(() => { close(); }, [pathname]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = openMobile ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [openMobile]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={close}
        className={cn(
          "fixed inset-0 z-40 bg-black/70 backdrop-blur-sm transition-opacity duration-300 md:hidden",
          openMobile ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
      />

      {/* Drawer */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col",
          "border-r border-white/[0.06]",
          "bg-[oklch(0.13_0.035_255)]",
          "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:hidden",
          openMobile ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Ambient glow top-left */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -left-16 h-56 w-56 rounded-full opacity-30"
          style={{ background: "radial-gradient(circle, oklch(0.70 0.24 290) 0%, transparent 70%)" }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <Link to="/" onClick={close} className="flex items-center gap-3">
            <div className="relative">
              <LogoMark className="h-11 w-11 shrink-0" />
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
            </div>
            <div className="leading-none">
              <div className="text-lg font-black tracking-tight brand-gradient-text">Vertex</div>
              <div className="mt-1 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Quant Trading AI</div>
            </div>
          </Link>
          <button
            onClick={close}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">

          {/* Primary */}
          <section>
            <p className="mb-2 px-2 text-[9px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/40">
              Principal
            </p>
            <div className="space-y-0.5">
              {NAV_PRIMARY.map((item) => {
                const active = isActive(item.url);
                return (
                  <Link
                    key={item.url}
                    to={item.url}
                    onClick={close}
                    className={cn(
                      "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      active
                        ? "text-white"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                    )}
                  >
                    {active && (
                      <>
                        <span
                          className="absolute inset-0 rounded-xl"
                          style={{
                            background: "linear-gradient(120deg, oklch(0.70 0.24 290 / 0.55) 0%, oklch(0.88 0.20 195 / 0.25) 100%)",
                            border: "1px solid oklch(0.70 0.24 290 / 0.35)",
                          }}
                        />
                        <span className="absolute left-0 inset-y-0 w-[3px] rounded-r-full bg-gradient-to-b from-[oklch(0.88_0.20_195)] to-[oklch(0.70_0.24_290)]" />
                      </>
                    )}
                    <item.icon className="relative h-4 w-4 shrink-0" />
                    <span className="relative flex-1">{item.title}</span>
                    {active && (
                      <span className="relative h-1.5 w-1.5 rounded-full bg-white/70" />
                    )}
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Divider */}
          <div className="mx-2 h-px bg-white/[0.06]" />

          {/* More */}
          <section>
            <p className="mb-2 px-2 text-[9px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/40">
              Plus
            </p>
            <div className="space-y-0.5">
              {NAV_MORE.map((item) => {
                const active = isActive(item.url);
                return (
                  <Link
                    key={item.url}
                    to={item.url}
                    onClick={close}
                    className={cn(
                      "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm transition-all duration-150",
                      active
                        ? "text-white font-medium bg-white/[0.06] border border-white/[0.08]"
                        : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.title}</span>
                  </Link>
                );
              })}
              {user?.is_admin && (
                <Link
                  to="/admin"
                  onClick={close}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all duration-150",
                    isActive("/admin")
                      ? "text-amber-400 bg-amber-400/10 border border-amber-400/20 font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                  )}
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>Administration</span>
                </Link>
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.06] p-3 space-y-2">
          {user && (
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              {/* Avatar initials */}
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                style={{ background: "linear-gradient(135deg, oklch(0.70 0.24 290), oklch(0.88 0.20 195))" }}
              >
                {(user.username?.[0] ?? user.email?.[0] ?? "U").toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{user.username}</div>
                <div className="truncate text-[11px] text-muted-foreground">{user.email}</div>
              </div>
              <button
                onClick={() => { logout(); close(); }}
                title="Se déconnecter"
                className="shrink-0 rounded-lg border border-white/10 p-1.5 text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <div className="flex items-center gap-2.5 rounded-xl border border-up/20 bg-up/[0.08] px-3 py-2.5">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-up opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
            </span>
            <div>
              <p className="text-xs font-semibold text-up">Compte DÉMO</p>
              <p className="text-[10px] leading-snug text-muted-foreground">Max 2% par trade</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
