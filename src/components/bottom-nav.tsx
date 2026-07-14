import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, LineChart, Zap, Settings, ShieldCheck, X, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

// App-like mobile nav: only the destinations someone taps every session.
// Signaux/Portfolio/Marchés/Journal/etc. moved to the header drawer (still
// one tap away) — Auto-Trader keeps its own nav slot since it's the bot
// control surface, the app's core loop.
const PRIMARY_ITEMS = [
  { title: "Dashboard",   url: "/",           icon: LayoutDashboard },
  { title: "Backtest",    url: "/backtest",   icon: LineChart },
  { title: "Auto-Trader", url: "/autotrader", icon: Zap },
  { title: "Paramètres",  url: "/settings",   icon: Settings },
] as const;

const ADMIN_ITEM = { title: "Admin", url: "/admin", icon: ShieldCheck } as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const { toggleSidebar, openMobile } = useSidebar();
  const { user } = useAuth();
  const items = user?.is_admin ? [...PRIMARY_ITEMS, ADMIN_ITEM] : PRIMARY_ITEMS;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/60 bg-background/95 backdrop-blur-xl safe-area-bottom">
      <div className="flex items-stretch h-16">
        {items.map((item) => {
          const active = isActive(item.url);
          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={() => { if (!active) haptic("light"); }}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-all duration-200 relative",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary" />
              )}
              <item.icon className={cn("h-5 w-5 transition-transform duration-200", active && "scale-110")} />
              <span className={cn("text-[10px] font-medium leading-none", active && "text-primary")}>
                {item.title}
              </span>
            </Link>
          );
        })}

        {/* Hamburger "Plus" */}
        <button
          onClick={() => { haptic("light"); toggleSidebar(); }}
          className={cn(
            "flex-1 flex flex-col items-center justify-center gap-1 relative transition-all duration-200",
            openMobile ? "text-primary" : "text-muted-foreground active:text-foreground",
          )}
        >
          {openMobile && (
            <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary" />
          )}
          <div className="relative h-5 w-5">
            <Menu className={cn("absolute inset-0 h-5 w-5 transition-all duration-200", openMobile ? "opacity-0 rotate-90 scale-50" : "opacity-100 rotate-0 scale-100")} />
            <X    className={cn("absolute inset-0 h-5 w-5 transition-all duration-200", openMobile ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-50")} />
          </div>
          <span className="text-[10px] font-medium leading-none">
            {openMobile ? "Fermer" : "Plus"}
          </span>
        </button>
      </div>
    </nav>
  );
}
