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
} from "lucide-react";
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
} from "@/components/ui/sidebar";
import { LogoMark } from "@/components/logo";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Portfolio", url: "/portfolio", icon: BriefcaseBusiness },
  { title: "IA Signals", url: "/signals", icon: Radar },
  { title: "Auto-Trader", url: "/autotrader", icon: Zap },
  { title: "Backtest", url: "/backtest", icon: FlaskConical },
  { title: "Journal", url: "/journal", icon: BarChart3 },
  { title: "Marchés", url: "/markets", icon: CandlestickChart },
  { title: "Stratégies", url: "/strategies", icon: Workflow },
  { title: "Assistant Lio23", url: "/assistant", icon: Bot },
  { title: "Risk Calculator", url: "/risk-calculator", icon: Calculator },
  { title: "Alertes", url: "/alerts", icon: Bell },
  { title: "Paramètres", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4">
        <Link to="/" className="flex items-center gap-2.5">
          <LogoMark className="h-9 w-9 shrink-0" />
          <div className="leading-tight group-data-[collapsible=icon]:hidden">
            <div className="text-base font-extrabold tracking-tight brand-gradient-text">LIO23</div>
            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
              Quant Trading AI
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-3">
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        <div className="rounded-md border border-border/60 bg-card/40 p-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[color:var(--bull)] animate-pulse" />
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