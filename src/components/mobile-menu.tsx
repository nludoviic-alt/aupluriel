import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  LayoutDashboard, Radar, Zap, BriefcaseBusiness, FlaskConical,
  BarChart3, PieChart, CandlestickChart, Workflow, NotebookPen, Settings,
  ShieldCheck, LogOut, X, MessageSquare,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

// Même palette de survol par page que la sidebar desktop (app-sidebar.tsx) —
// seule la couleur du hover est reprise ici, rien d'autre ne doit changer.
const NAV_PRIMARY = [
  { title: "Dashboard",   url: "/",           icon: LayoutDashboard,   hover: "hover:bg-violet-500/[0.04] hover:text-violet-300" },
  { title: "Portfolio",   url: "/portfolio",  icon: BriefcaseBusiness, hover: "hover:bg-cyan-500/[0.04] hover:text-cyan-300" },
  { title: "Signaux",     url: "/signals",    icon: Radar,             hover: "hover:bg-emerald-500/[0.04] hover:text-emerald-300" },
  { title: "Auto-Trader", url: "/autotrader", icon: Zap,               hover: "hover:bg-amber-500/[0.04] hover:text-amber-300" },
];

const NAV_MORE = [
  { title: "Backtest",        url: "/backtest",        icon: FlaskConical,     hover: "hover:bg-fuchsia-500/[0.04] hover:text-fuchsia-300" },
  { title: "Statistiques",     url: "/stats",           icon: PieChart,         hover: "hover:bg-cyan-500/[0.04] hover:text-cyan-300" },
  { title: "Journal",         url: "/journal",         icon: BarChart3,        hover: "hover:bg-orange-500/[0.04] hover:text-orange-300" },
  { title: "Marchés",         url: "/markets",         icon: CandlestickChart, hover: "hover:bg-blue-500/[0.04] hover:text-blue-300" },
  { title: "Stratégies",      url: "/strategies",      icon: Workflow,         hover: "hover:bg-mint/[0.04] hover:text-mint/80" },
  { title: "Notes",           url: "/carnet-de-notes", icon: NotebookPen,     hover: "hover:bg-rose-500/[0.04] hover:text-rose-300" },
  { title: "Messagerie",      url: "/messenger",       icon: MessageSquare,    hover: "hover:bg-amber-500/[0.04] hover:text-amber-300" },
  { title: "Paramètres",      url: "/settings",        icon: Settings,         hover: "hover:bg-slate-500/[0.04] hover:text-slate-300" },
];

export function MobileMenu() {
  const { openMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, logout } = useAuth();

  const showChat = !!user?.is_admin || user?.chat_enabled === 1;
  const showBacktest = !!user?.is_admin || user?.chat_enabled !== 1;

  const filteredNavMore = NAV_MORE.filter(
    (item) => (item.url !== "/backtest" || showBacktest) && item.url !== "/messenger"
  );

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

      {/* Drawer — bottom stops above BottomNav (same z-50, later in the DOM,
          so it paints over anything the drawer extends behind) instead of
          inset-y-0's full viewport height. h-16 (4rem) matches BottomNav's
          own height; its trailing safe-area-bottom padding is added the
          same way here so both edges line up on notched phones. */}
      <aside
        className={cn(
          "fixed top-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] left-0 z-50 flex w-72 flex-col",
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
          style={{ background: "radial-gradient(circle, oklch(0.70 0.20 45) 0%, transparent 70%)" }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/[0.06] safe-area-top">
          <Link to="/" onClick={close} className="flex items-center gap-3.5 relative p-2 rounded-xl transition-all duration-300 hover:bg-white/[0.05] hover:shadow-lg hover:shadow-orange-500/10 active:scale-95 before:absolute before:inset-0 before:rounded-xl before:bg-gradient-to-r before:from-orange-500/0 before:via-orange-500/5 before:to-orange-500/0 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300">
            <div className="relative shrink-0">
              {/* Glow behind logo */}
              <div className="absolute inset-0 rounded-full bg-orange-500/20 blur-md opacity-60 group-hover/logo:opacity-90 transition-opacity duration-500" />
              
              {/* Glassmorphic container */}
              <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] shadow-[0_8px_32px_0_rgba(0,0,0,0.37),inset_0_1px_1px_0_rgba(255,255,255,0.15)] backdrop-blur-md group-hover/logo:border-orange-500/30 group-hover/logo:bg-white/[0.08] transition-all duration-300">
                <img src="/favicon.png" alt="Au Pluriel" className="h-10 w-10 object-contain absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              
              {/* Live dot */}
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-gradient-to-r from-orange-400 to-amber-500 shadow-md shadow-orange-500/50" />
              </span>
            </div>
            <div className="flex flex-col leading-none overflow-hidden">
              <span className="text-[26px] font-black tracking-tight bg-gradient-to-r from-white via-white/95 to-white/60 bg-clip-text text-transparent leading-none">Au Pluriel</span>
              <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.24em] bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">Quant Trading</span>
            </div>
          </Link>
          <button
            onClick={close}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable nav — min-h-0 is required here: a flex item's default
            min-height is its content size, which on a long nav list (12
            links) is taller than the drawer itself, so without this the
            list refuses to shrink/scroll and pushes the footer (username,
            email) below the visible viewport instead. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-6">

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
                    onClick={() => { if (!active) haptic("light"); close(); }}
                    className={cn(
                      "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
                      active ? "text-white" : cn("text-muted-foreground", item.hover),
                    )}
                  >
                    {active && (
                      <>
                        <span
                          className="absolute inset-0 rounded-xl"
                          style={{
                            background: "linear-gradient(120deg, oklch(0.70 0.20 45 / 0.55) 0%, oklch(0.80 0.19 70 / 0.25) 100%)",
                            border: "1px solid oklch(0.70 0.20 45 / 0.35)",
                          }}
                        />
                        <span className="absolute left-0 inset-y-0 w-[3px] rounded-r-full bg-gradient-to-b from-[oklch(0.80_0.19_70)] to-[oklch(0.70_0.20_45)]" />
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
              {filteredNavMore.map((item) => {
                const active = isActive(item.url);
                return (
                  <Link
                    key={item.url}
                    to={item.url}
                    onClick={() => { if (!active) haptic("light"); close(); }}
                    className={cn(
                      "group relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm transition-all duration-150",
                      active
                        ? "text-white font-medium bg-white/[0.06] border border-white/[0.08]"
                        : cn("text-muted-foreground", item.hover),
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
                  onClick={() => { if (!isActive("/admin")) haptic("light"); close(); }}
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

        {/* Footer — no safe-area padding needed here: the drawer now stops
            above BottomNav (which already reserves that space itself). */}
        <div className="border-t border-white/[0.06] p-3 space-y-2">
          {user && (
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
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
