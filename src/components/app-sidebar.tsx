import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Radar,
  FlaskConical,
  CandlestickChart,
  Workflow,
  Zap,
  Settings,
  BriefcaseBusiness,
  BarChart3,
  NotebookPen,
  ShieldCheck,
  LogOut,
  ChevronRight,
  Cpu,
  MessageSquare,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Link as RouterLink } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const tradingItems = [
  { title: "Dashboard",        url: "/",                icon: LayoutDashboard, color: "text-violet-400",  glow: "shadow-violet-500/30" },
  { title: "Portfolio",        url: "/portfolio",       icon: BriefcaseBusiness, color: "text-cyan-400",  glow: "shadow-cyan-500/30" },
  { title: "Signaux",          url: "/signals",         icon: Radar,            color: "text-emerald-400", glow: "shadow-emerald-500/30" },
  { title: "Auto-Trader",      url: "/autotrader",      icon: Zap,              color: "text-amber-400",  glow: "shadow-amber-500/30" },
  { title: "Marchés",          url: "/markets",         icon: CandlestickChart, color: "text-blue-400",   glow: "shadow-blue-500/30" },
];

const analysisItems = [
  { title: "Backtest",         url: "/backtest",        icon: FlaskConical,     color: "text-fuchsia-400", glow: "shadow-fuchsia-500/30" },
  { title: "Journal",          url: "/journal",         icon: BarChart3,        color: "text-orange-400",  glow: "shadow-orange-500/30" },
  { title: "Stratégies",       url: "/strategies",      icon: Workflow,         color: "text-mint",        glow: "shadow-mint/30" },
  { title: "Notes",             url: "/carnet-de-notes", icon: NotebookPen,     color: "text-rose-400",    glow: "shadow-rose-500/30" },
];

const toolItems = [
  { title: "Messagerie",       url: "/messenger",       icon: MessageSquare,    color: "text-amber-400",   glow: "shadow-amber-500/30" },
  { title: "Paramètres",       url: "/settings",        icon: Settings,         color: "text-slate-400",   glow: "shadow-slate-500/30" },
];

function getHoverClasses(color: string) {
  switch (color) {
    case "text-violet-400":
      return {
        bg: "hover:bg-violet-500/[0.04]",
        border: "hover:border-violet-500/15",
        text: "hover:text-violet-300",
        iconBg: "group-hover/nav:bg-violet-500/15 group-hover/nav:border-violet-500/25",
        iconText: "group-hover/nav:text-violet-400"
      };
    case "text-cyan-400":
      return {
        bg: "hover:bg-cyan-500/[0.04]",
        border: "hover:border-cyan-500/15",
        text: "hover:text-cyan-300",
        iconBg: "group-hover/nav:bg-cyan-500/15 group-hover/nav:border-cyan-500/25",
        iconText: "group-hover/nav:text-cyan-400"
      };
    case "text-emerald-400":
      return {
        bg: "hover:bg-emerald-500/[0.04]",
        border: "hover:border-emerald-500/15",
        text: "hover:text-emerald-300",
        iconBg: "group-hover/nav:bg-emerald-500/15 group-hover/nav:border-emerald-500/25",
        iconText: "group-hover/nav:text-emerald-400"
      };
    case "text-mint":
      return {
        bg: "hover:bg-mint/[0.04]",
        border: "hover:border-mint/15",
        text: "hover:text-mint/80",
        iconBg: "group-hover/nav:bg-mint/15 group-hover/nav:border-mint/25",
        iconText: "group-hover/nav:text-mint"
      };
    case "text-amber-400":
      return {
        bg: "hover:bg-amber-500/[0.04]",
        border: "hover:border-amber-500/15",
        text: "hover:text-amber-300",
        iconBg: "group-hover/nav:bg-amber-500/15 group-hover/nav:border-amber-500/25",
        iconText: "group-hover/nav:text-amber-400"
      };
    case "text-blue-400":
      return {
        bg: "hover:bg-blue-500/[0.04]",
        border: "hover:border-blue-500/15",
        text: "hover:text-blue-300",
        iconBg: "group-hover/nav:bg-blue-500/15 group-hover/nav:border-blue-500/25",
        iconText: "group-hover/nav:text-blue-400"
      };
    case "text-fuchsia-400":
      return {
        bg: "hover:bg-fuchsia-500/[0.04]",
        border: "hover:border-fuchsia-500/15",
        text: "hover:text-fuchsia-300",
        iconBg: "group-hover/nav:bg-fuchsia-500/15 group-hover/nav:border-fuchsia-500/25",
        iconText: "group-hover/nav:text-fuchsia-400"
      };
    case "text-orange-400":
      return {
        bg: "hover:bg-orange-500/[0.04]",
        border: "hover:border-orange-500/15",
        text: "hover:text-orange-300",
        iconBg: "group-hover/nav:bg-orange-500/15 group-hover/nav:border-orange-500/25",
        iconText: "group-hover/nav:text-orange-400"
      };
    case "text-teal-400":
      return {
        bg: "hover:bg-teal-500/[0.04]",
        border: "hover:border-teal-500/15",
        text: "hover:text-teal-300",
        iconBg: "group-hover/nav:bg-teal-500/15 group-hover/nav:border-teal-500/25",
        iconText: "group-hover/nav:text-teal-400"
      };
    case "text-rose-400":
      return {
        bg: "hover:bg-rose-500/[0.04]",
        border: "hover:border-rose-500/15",
        text: "hover:text-rose-300",
        iconBg: "group-hover/nav:bg-rose-500/15 group-hover/nav:border-rose-500/25",
        iconText: "group-hover/nav:text-rose-400"
      };
    case "text-yellow-400":
      return {
        bg: "hover:bg-yellow-500/[0.04]",
        border: "hover:border-yellow-500/15",
        text: "hover:text-yellow-300",
        iconBg: "group-hover/nav:bg-yellow-500/15 group-hover/nav:border-yellow-500/25",
        iconText: "group-hover/nav:text-yellow-400"
      };
    case "text-slate-400":
    default:
      return {
        bg: "hover:bg-white/[0.03]",
        border: "hover:border-white/5",
        text: "hover:text-white",
        iconBg: "group-hover/nav:bg-white/10 group-hover/nav:border-white/15",
        iconText: "group-hover/nav:text-white"
      };
  }
}

function NavItem({
  item,
  isActive,
  onClick,
}: {
  item: { title: string; url: string; icon: React.ElementType; color: string; glow: string };
  isActive: boolean;
  onClick?: () => void;
}) {
  const hover = getHoverClasses(item.color);
  return (
    <SidebarMenuItem className="relative">
      {isActive && (
        <span className={cn(
          "pointer-events-none absolute left-0 inset-y-1.5 w-[3px] rounded-r-full",
          "bg-gradient-to-b from-amber-400 via-yellow-400 to-amber-600",
          "shadow-lg shadow-amber-500/60"
        )} />
      )}
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
        <Link
          to={item.url}
          onClick={onClick}
          className={cn(
            "group/nav flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-base transition-all duration-200",
            isActive
              ? "bg-amber-500/[0.08] border border-amber-500/20 shadow-[0_0_15px_rgba(245,158,11,0.05)]"
              : cn("bg-transparent border border-transparent", hover.bg, hover.border)
          )}
        >
          <span className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 border",
            isActive
              ? "bg-amber-500/10 border-amber-500/25 text-amber-400"
              : cn("bg-white/[0.04] border-white/[0.05] text-muted-foreground", hover.iconBg)
          )}>
            <item.icon className={cn("h-4.5 w-4.5 transition-colors duration-200", isActive ? "text-amber-400" : hover.iconText)} />
          </span>
          <span className={cn(
            "font-semibold transition-colors duration-200 text-[15px] tracking-wide",
            isActive 
              ? "text-amber-300 font-bold" 
              : cn("text-muted-foreground/80", hover.text)
          )}>
            {item.title}
          </span>
          {isActive && (
            <ChevronRight className="ml-auto h-4 w-4 shrink-0 opacity-60 text-amber-400" />
          )}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const { user, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  const showChat = !!user?.is_admin || user?.chat_enabled === 1;
  const showBacktest = !!user?.is_admin || user?.chat_enabled !== 1;

  const filteredAnalysisItems = analysisItems.filter(
    (item) => item.url !== "/backtest" || showBacktest
  );

  const filteredToolItems = toolItems.filter(
    (item) => item.url !== "/messenger" || showChat
  );

  if (isMobile) return null;

  function handleNavClick() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar
      collapsible="offcanvas"
      className={cn(
        "border-r border-white/[0.04] bg-sidebar",
        "shadow-[4px_0_30px_rgba(0,0,0,0.4)]"
      )}
    >
      {/* ── SIDEBAR HEADER ── */}
      {/* Same height, glass treatment, glow and shimmer accent as the main <header> in __root.tsx,
          so the two form one continuous header band across the full width. */}
      <SidebarHeader className="relative h-24 shrink-0 justify-center gap-0 overflow-hidden px-5 border-b border-white/[0.06] bg-background/75 backdrop-blur-2xl shadow-[0_18px_40px_-24px_rgba(0,0,0,0.7)]">
        <div className="pointer-events-none absolute -top-28 -right-16 h-56 w-56 rounded-full bg-orange-500/10 blur-[90px]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
          <div className="h-full w-[250%] -translate-x-1/3 bg-[linear-gradient(90deg,transparent,oklch(0.70_0.20_45/0.7),oklch(0.85_0.20_70/0.7),transparent)] bg-[length:40%_100%] animate-[shimmer_6s_linear_infinite]" />
        </div>
        <RouterLink to="/" className="group/logo flex items-center gap-3.5 relative p-2 rounded-xl transition-all duration-300 hover:bg-white/[0.05] hover:shadow-lg hover:shadow-orange-500/10 active:scale-95 before:absolute before:inset-0 before:rounded-xl before:bg-gradient-to-r before:from-orange-500/0 before:via-orange-500/5 before:to-orange-500/0 before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300">
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

          <div className="flex flex-col leading-none overflow-hidden group-data-[collapsible=icon]:hidden">
            <span className="text-[26px] font-black tracking-tight bg-gradient-to-r from-white via-white/95 to-white/60 bg-clip-text text-transparent leading-none">
              Au Pluriel
            </span>
            <span className="mt-1.5 text-[10px] font-bold uppercase tracking-[0.24em] bg-gradient-to-r from-orange-400 to-amber-500 bg-clip-text text-transparent">
              Quant Trading
            </span>
          </div>
        </RouterLink>
      </SidebarHeader>

      {/* ── SIDEBAR CONTENT ── */}
      <SidebarContent className="px-3 pt-6 pb-2 gap-4">

        {/* Trading group */}
        <SidebarGroup className="pt-0">
          <SidebarGroupLabel className="px-3 mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">
            Trading
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {tradingItems.map((item) => (
                <NavItem key={item.url} item={item} isActive={isActive(item.url)} onClick={handleNavClick} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

        {/* Analysis group */}
        <SidebarGroup className="pt-1">
          <SidebarGroupLabel className="px-3 mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">
            Analyse
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {filteredAnalysisItems.map((item) => (
                <NavItem key={item.url} item={item} isActive={isActive(item.url)} onClick={handleNavClick} />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

        {/* Tools group */}
        <SidebarGroup className="pt-1">
          <SidebarGroupLabel className="px-3 mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground/40">
            Outils
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-2">
              {filteredToolItems.map((item) => (
                <NavItem key={item.url} item={item} isActive={isActive(item.url)} onClick={handleNavClick} />
              ))}
              {user?.is_admin && (() => {
                const active = isActive("/admin");
                return (
                  <NavItem
                    key="/admin"
                    item={{ title: "Administration", url: "/admin", icon: ShieldCheck, color: "text-amber-400", glow: "shadow-amber-500/30" }}
                    isActive={active}
                    onClick={handleNavClick}
                  />
                );
              })()}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* ── SIDEBAR FOOTER ── */}
      <SidebarFooter className="p-4 pt-2 border-t border-white/[0.05] group-data-[collapsible=icon]:hidden">
        {/* User card */}
        {user && (
          <div className="mb-3 flex items-center gap-3.5 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3.5 transition-all duration-200 hover:bg-white/[0.05] hover:border-white/[0.1]">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-semibold text-foreground leading-tight">{user.username}</div>
              <div className="truncate text-[12px] text-muted-foreground/50 mt-1.5 leading-tight">{user.email}</div>
            </div>
            <button
              onClick={logout}
              title="Se déconnecter"
              className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20 transition-all duration-200"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* AI engine badge */}
        <div className="flex items-center gap-3 rounded-xl border border-orange-500/15 bg-gradient-to-r from-orange-500/[0.07] to-transparent px-3.5 py-3">
          <div className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 border border-orange-500/20">
            <Cpu className="h-4 w-4 text-orange-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-foreground/80 leading-none">Au Pluriel Engine</div>
            <div className="text-[10px] text-muted-foreground/50 mt-1 leading-none">Max 2% par trade · DÉMO</div>
          </div>
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-orange-500" />
          </span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}