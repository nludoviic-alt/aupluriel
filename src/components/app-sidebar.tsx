import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Radar,
  FlaskConical,
  CandlestickChart,
  Workflow,
  Bot,
  Bell,
  Settings,
  Zap,
  BriefcaseBusiness,
  BarChart3,
  Calculator,
  ShieldCheck,
  LogOut,
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
import { LogoMark } from "@/components/logo";
import { cn } from "@/lib/utils";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Portfolio", url: "/portfolio", icon: BriefcaseBusiness },
  { title: "IA Signals", url: "/signals", icon: Radar },
  { title: "Auto-Trader", url: "/autotrader", icon: Zap },
  { title: "Backtest", url: "/backtest", icon: FlaskConical },
  { title: "Journal", url: "/journal", icon: BarChart3 },
  { title: "Marchés", url: "/markets", icon: CandlestickChart },
  { title: "Stratégies", url: "/strategies", icon: Workflow },
  { title: "Risk Calculator", url: "/risk-calculator", icon: Calculator },
  { title: "Alertes", url: "/alerts", icon: Bell },
  { title: "Paramètres", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const { user, logout } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();

  // Mobile nav is handled by MobileMenu — sidebar is desktop-only
  if (isMobile) return null;

  function handleNavClick() {
    if (isMobile) setOpenMobile(false);
  }

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="p-4 border-b border-white/[0.04]">
        <Link to="/" className="flex items-center gap-3.5 py-1">
          <div className="relative">
            <LogoMark className="h-11 w-11 shrink-0" />
            <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary animate-pulse" />
          </div>
          <div className="leading-none group-data-[collapsible=icon]:hidden">
            <div className="text-xl font-black tracking-tight leading-none brand-gradient-text">Vertex</div>
            <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground mt-1.5 font-bold">
              Quant Trading
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = isActive(item.url);
                return (
                  <SidebarMenuItem key={item.url} className="relative">
                    {active && (
                      <span className="pointer-events-none absolute left-0 inset-y-1.5 w-[3px] rounded-r-full bg-[color:var(--brand-violet)]" />
                    )}
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <Link
                        to={item.url}
                        onClick={handleNavClick}
                        className="flex items-center gap-3 text-sm pl-3"
                      >
                        <item.icon className={cn("h-4 w-4 shrink-0", active && "text-[color:var(--brand-violet)]")} />
                        <span className={active ? "text-foreground font-semibold" : ""}>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
              {user?.is_admin && (() => {
                const active = isActive("/admin");
                return (
                  <SidebarMenuItem className="relative">
                    {active && (
                      <span className="pointer-events-none absolute left-0 inset-y-1.5 w-[3px] rounded-r-full bg-[color:var(--brand-amber)]" />
                    )}
                    <SidebarMenuButton asChild isActive={active} tooltip="Administration">
                      <Link to="/admin" className="flex items-center gap-3 pl-3" onClick={handleNavClick}>
                        <ShieldCheck className={cn("h-4 w-4 shrink-0", active && "text-[color:var(--brand-amber)]")} />
                        <span className={active ? "text-foreground font-semibold" : ""}>Administration</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })()}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        {user ? (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-card/40 p-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-foreground">{user.username}</div>
              <div className="truncate text-[11px]">{user.email}</div>
            </div>
            <button
              onClick={logout}
              title="Se déconnecter"
              className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}
        <div className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-up animate-pulse" />
            <span className="font-medium text-foreground">Compte DÉMO</span>
          </div>
          <p className="mt-1 leading-snug">
            Trading à risque. Max 2% par trade.
          </p>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}