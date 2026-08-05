import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Zap, ShieldCheck, Target, NotebookPen } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { useVisualViewportFrame } from "@/hooks/use-keyboard-open";

const ADMIN_ITEM = { title: "Admin", url: "/admin", icon: ShieldCheck } as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (p: string) => (p === "/" ? pathname === "/" : pathname.startsWith(p));
  const { user } = useAuth();
  const { keyboardOpen } = useVisualViewportFrame();

  const primaryItems = [
    { title: "Dashboard",   url: "/",           icon: LayoutDashboard },
    { title: "Opportunités", url: "/opportunities", icon: Target },
    { title: "Auto-Trader", url: "/autotrader", icon: Zap },
    { title: "Notes",       url: "/carnet-de-notes", icon: NotebookPen },
  ];

  const items = user?.is_admin ? [...primaryItems, ADMIN_ITEM] : primaryItems;

  return (
    <nav id="bottom-nav-bar" className={cn(
      "fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border/60 bg-background/95 backdrop-blur-xl safe-area-bottom",
      keyboardOpen && "hidden"
    )}>
      <div className="flex items-stretch h-[50px]">
        {items.map((item) => {
          const active = isActive(item.url);
          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={() => { if (!active) haptic("light"); }}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-all duration-200 relative",
                active ? "text-primary font-bold" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary shadow-[0_0_8px_rgba(56,189,248,0.6)]" />
              )}
              <item.icon className={cn("h-5 w-5 transition-transform duration-200", active && "scale-110 text-primary")} />
              <span className={cn("text-[10px] font-semibold leading-none", active && "text-primary font-bold")}>
                {item.title}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
