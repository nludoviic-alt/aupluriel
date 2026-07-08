import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  LayoutDashboard, Radar, Zap, BriefcaseBusiness, FlaskConical,
  BarChart3, CandlestickChart, Workflow, Calculator, Bell, Settings,
  ShieldCheck, LogOut, X, ChevronRight,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

const NAV_PRIMARY = [
  { title: "Dashboard",   url: "/",           icon: LayoutDashboard, color: "text-violet-400",    glow: "shadow-violet-500/30" },
  { title: "Portfolio",   url: "/portfolio",  icon: BriefcaseBusiness, color: "text-cyan-400",    glow: "shadow-cyan-500/30" },
  { title: "Signaux",     url: "/signals",    icon: Radar,           color: "text-emerald-400",   glow: "shadow-emerald-500/30" },
  { title: "Auto-Trader", url: "/autotrader", icon: Zap,             color: "text-amber-400",     glow: "shadow-amber-500/30" },
];

const NAV_MORE = [
  { title: "Backtest",        url: "/backtest",        icon: FlaskConical,    color: "text-fuchsia-400", glow: "shadow-fuchsia-500/30" },
  { title: "Journal",         url: "/journal",         icon: BarChart3,       color: "text-orange-400",  glow: "shadow-orange-500/30" },
  { title: "Marchés",         url: "/markets",         icon: CandlestickChart, color: "text-blue-400",   glow: "shadow-blue-500/30" },
  { title: "Stratégies",      url: "/strategies",      icon: Workflow,        color: "text-mint",        glow: "shadow-mint/30" },
  { title: "Risk Calculator", url: "/risk-calculator", icon: Calculator,      color: "text-rose-400",    glow: "shadow-rose-500/30" },
  { title: "Alertes",         url: "/alerts",          icon: Bell,            color: "text-yellow-400",  glow: "shadow-yellow-500/30" },
  { title: "Paramètres",      url: "/settings",        icon: Settings,        color: "text-slate-400",   glow: "shadow-slate-500/30" },
];

function getMobileHoverClasses(color: string) {
  switch (color) {
    case "text-violet-400":
      return {
        bg: "hover:bg-violet-500/[0.04]", border: "hover:border-violet-500/15", text: "hover:text-violet-300",
        iconBg: "group-hover/nav:bg-violet-500/15 group-hover/nav:border-violet-500/25", iconText: "group-hover/nav:text-violet-400",
      };
    case "text-cyan-400":
      return {
        bg: "hover:bg-cyan-500/[0.04]", border: "hover:border-cyan-500/15", text: "hover:text-cyan-300",
        iconBg: "group-hover/nav:bg-cyan-500/15 group-hover/nav:border-cyan-500/25", iconText: "group-hover/nav:text-cyan-400",
      };
    case "text-emerald-400":
      return {
        bg: "hover:bg-emerald-500/[0.04]", border: "hover:border-emerald-500/15", text: "hover:text-emerald-300",
        iconBg: "group-hover/nav:bg-emerald-500/15 group-hover/nav:border-emerald-500/25", iconText: "group-hover/nav:text-emerald-400",
      };
    case "text-mint":
      return {
        bg: "hover:bg-mint/[0.04]", border: "hover:border-mint/15", text: "hover:text-mint/80",
        iconBg: "group-hover/nav:bg-mint/15 group-hover/nav:border-mint/25", iconText: "group-hover/nav:text-mint",
      };
    case "text-amber-400":
      return {
        bg: "hover:bg-amber-500/[0.04]", border: "hover:border-amber-500/15", text: "hover:text-amber-300",
        iconBg: "group-hover/nav:bg-amber-500/15 group-hover/nav:border-amber-500/25", iconText: "group-hover/nav:text-amber-400",
      };
    case "text-blue-400":
      return {
        bg: "hover:bg-blue-500/[0.04]", border: "hover:border-blue-500/15", text: "hover:text-blue-300",
        iconBg: "group-hover/nav:bg-blue-500/15 group-hover/nav:border-blue-500/25", iconText: "group-hover/nav:text-blue-400",
      };
    case "text-fuchsia-400":
      return {
        bg: "hover:bg-fuchsia-500/[0.04]", border: "hover:border-fuchsia-500/15", text: "hover:text-fuchsia-300",
        iconBg: "group-hover/nav:bg-fuchsia-500/15 group-hover/nav:border-fuchsia-500/25", iconText: "group-hover/nav:text-fuchsia-400",
      };
    case "text-orange-400":
      return {
        bg: "hover:bg-orange-500/[0.04]", border: "hover:border-orange-500/15", text: "hover:text-orange-300",
        iconBg: "group-hover/nav:bg-orange-500/15 group-hover/nav:border-orange-500/25", iconText: "group-hover/nav:text-orange-400",
      };
    case "text-rose-400":
      return {
        bg: "hover:bg-rose-500/[0.04]", border: "hover:border-rose-500/15", text: "hover:text-rose-300",
        iconBg: "group-hover/nav:bg-rose-500/15 group-hover/nav:border-rose-500/25", iconText: "group-hover/nav:text-rose-400",
      };
    case "text-yellow-400":
      return {
        bg: "hover:bg-yellow-500/[0.04]", border: "hover:border-yellow-500/15", text: "hover:text-yellow-300",
        iconBg: "group-hover/nav:bg-yellow-500/15 group-hover/nav:border-yellow-500/25", iconText: "group-hover/nav:text-yellow-400",
      };
    case "text-slate-400":
    default:
      return {
        bg: "hover:bg-white/[0.03]", border: "hover:border-white/5", text: "hover:text-white",
        iconBg: "group-hover/nav:bg-white/10 group-hover/nav:border-white/15", iconText: "group-hover/nav:text-white",
      };
  }
}

function MobileNavItem({
  item,
  isActive,
  onClick,
}: {
  item: { title: string; url: string; icon: React.ElementType; color: string; glow: string };
  isActive: boolean;
  onClick: () => void;
}) {
  const hover = getMobileHoverClasses(item.color);
  return (
    <Link
      to={item.url}
      onClick={onClick}
      className={cn(
        "group/nav relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200",
        isActive
          ? "bg-amber-500/[0.08] border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.05)]"
          : cn("bg-transparent border border-transparent", hover.bg, hover.border),
      )}
    >
      {/* Active accent bar */}
      {isActive && (
        <span className={cn(
          "pointer-events-none absolute left-0 inset-y-1.5 w-[3px] rounded-r-full",
          "bg-gradient-to-b from-amber-400 via-yellow-400 to-amber-600",
          "shadow-lg shadow-amber-500/60",
        )} />
      )}

      {/* Icon container */}
      <span className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-200 border",
        isActive
          ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
          : cn("bg-white/[0.04] border-white/[0.05] text-muted-foreground", hover.iconBg),
      )}>
        <item.icon className={cn("h-4 w-4 transition-colors duration-200", isActive ? "text-amber-400" : hover.iconText)} />
      </span>

      <span className={cn(
        "font-semibold transition-colors duration-200 text-sm tracking-wide",
        isActive
          ? "text-amber-300 font-bold"
          : cn("text-muted-foreground/80", hover.text),
      )}>
        {item.title}
      </span>

      {isActive && (
        <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60 text-amber-400" />
      )}
    </Link>
  );
}

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
          "bg-background",
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
        <div className="relative flex items-center justify-between px-5 py-3 border-b border-white/[0.06] safe-area-top overflow-hidden">
          {/* Shimmer accent on bottom border */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
            <div className="h-full w-[250%] -translate-x-1/3 bg-[linear-gradient(90deg,transparent,oklch(0.70_0.20_45/0.5),oklch(0.85_0.20_70/0.5),transparent)] bg-[length:40%_100%] animate-[shimmer_6s_linear_infinite]" />
          </div>

          <Link to="/" onClick={close} className="group/logo flex items-center gap-3.5">
            <div className="relative shrink-0">
              {/* Animated glow behind logo */}
              <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-orange-500/30 via-amber-400/20 to-orange-600/25 blur-md opacity-60 group-hover/logo:opacity-100 transition-opacity duration-500 animate-pulse" />

              {/* Outer ring */}
              <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-white/[0.1] bg-white/[0.03] shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_1px_rgba(255,255,255,0.1)] backdrop-blur-xl group-hover/logo:border-orange-500/25 transition-all duration-300">
                {/* Inner glass ring */}
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.06] bg-gradient-to-br from-white/[0.06] to-white/[0.02] shadow-[inset_0_2px_4px_rgba(255,255,255,0.05)]">
                  <LogoMark className="h-8 w-8" />
                </div>
              </div>

              {/* Live dot with glow */}
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-50" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-gradient-to-r from-orange-400 to-amber-500 shadow-md shadow-orange-500/50" />
              </span>
            </div>

            <div className="flex flex-col leading-none">
              <span className="text-xl font-black tracking-tight bg-gradient-to-r from-white via-white/95 to-white/60 bg-clip-text text-transparent leading-none">
                Lio23
              </span>
              <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.2em] bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">
                Quant Trading
              </span>
            </div>
          </Link>

          <button
            onClick={close}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-hidden px-3 py-2.5 space-y-3">

          {/* Primary */}
          <section>
            <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/40">
              Principal
            </p>
            <div className="space-y-0.5">
              {NAV_PRIMARY.map((item) => {
                const active = isActive(item.url);
                return (
                  <MobileNavItem
                    key={item.url}
                    item={item}
                    isActive={active}
                    onClick={() => { if (!active) haptic("light"); close(); }}
                  />
                );
              })}
            </div>
          </section>

          {/* Divider */}
          <div className="mx-2 h-px bg-white/[0.06]" />

          {/* More */}
          <section>
            <p className="mb-1 px-2 text-[9px] uppercase tracking-[0.18em] font-semibold text-muted-foreground/40">
              Plus
            </p>
            <div className="space-y-0.5">
              {NAV_MORE.map((item) => {
                const active = isActive(item.url);
                return (
                  <MobileNavItem
                    key={item.url}
                    item={item}
                    isActive={active}
                    onClick={() => { if (!active) haptic("light"); close(); }}
                  />
                );
              })}
              {user?.is_admin && (
                <MobileNavItem
                  item={{ title: "Administration", url: "/admin", icon: ShieldCheck, color: "text-amber-400", glow: "shadow-amber-500/30" }}
                  isActive={isActive("/admin")}
                  onClick={() => { if (!isActive("/admin")) haptic("light"); close(); }}
                />
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="border-t border-white/[0.06] px-3 py-2 space-y-1.5">
          {user && (
            <div className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
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

          <div className="flex items-center gap-2.5 rounded-xl border border-up/20 bg-up/[0.08] px-3 py-2">
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
