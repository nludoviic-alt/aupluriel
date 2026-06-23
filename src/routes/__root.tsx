import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useMemo, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useMarketAlert } from "@/hooks/use-market-alert";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { useDerivSession } from "@/hooks/use-deriv-session";
import { Bell, Loader2, Menu, X } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { VoiceControl } from "@/components/voice-control";
import { MarketCoach } from "@/components/market-coach";
import { BottomNav } from "@/components/bottom-nav";
import { MobileMenu } from "@/components/mobile-menu";
import { TickerBar } from "@/components/ticker-bar";
import { cn } from "@/lib/utils";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Vertex — Quant Trading AI" },
      {
        name: "description",
        content:
          "Vertex — IA de trading quantitative pour Crypto & Forex, connectée à l'API Deriv. Signaux, backtest, marchés en temps réel.",
      },
      { name: "author", content: "Vertex" },
      { property: "og:title", content: "Vertex — Quant Trading AI" },
      {
        property: "og:description",
        content: "Signaux IA, backtest et marchés en temps réel via Deriv.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Vertex — Quant Trading AI" },
      { name: "description", content: "Vertex is a quantitative trading AI web application for Crypto and Forex markets." },
      { property: "og:description", content: "Vertex is a quantitative trading AI web application for Crypto and Forex markets." },
      { name: "twitter:description", content: "Vertex is a quantitative trading AI web application for Crypto and Forex markets." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/33b8af68-47f4-4ab3-8bed-26dc0b6f9834/id-preview-571df8d4--c8db877e-99f8-451d-b8a6-7db33c51d41f.lovable.app-1781494469804.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/33b8af68-47f4-4ab3-8bed-26dc0b6f9834/id-preview-571df8d4--c8db877e-99f8-451d-b8a6-7db33c51d41f.lovable.app-1781494469804.png" },
    ],
    links: [
      { rel: "preconnect", href: "https://rsms.me/" },
      { rel: "stylesheet", href: "https://rsms.me/inter/inter.css" },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <head>
        <HeadContent />
      </head>
      <body className="dark" suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function HamburgerButton() {
  const { openMobile, toggleSidebar } = useSidebar();
  return (
    <button
      onClick={toggleSidebar}
      aria-label={openMobile ? "Fermer le menu" : "Ouvrir le menu"}
      className={cn(
        "relative flex md:hidden h-9 w-9 flex-col items-center justify-center gap-[5px] rounded-xl border transition-all duration-200",
        openMobile
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground",
      )}
    >
      <span className={cn("block h-px w-4 bg-current transition-all duration-300 origin-center", openMobile && "translate-y-[5px] rotate-45")} />
      <span className={cn("block h-px w-4 bg-current transition-all duration-200", openMobile && "scale-x-0 opacity-0")} />
      <span className={cn("block h-px w-4 bg-current transition-all duration-300 origin-center", openMobile && "-translate-y-[5px] -rotate-45")} />
    </button>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Auth gate: send signed-out visitors to the login page, except on public auth routes.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading: authLoading } = useAuth();
  const publicRoutes = ["/login", "/verify-email", "/forgot-password", "/reset-password"];
  const isPublicRoute = publicRoutes.includes(pathname);
  useEffect(() => {
    if (authLoading || isPublicRoute || user) return;
    window.location.href = "/login";
  }, [authLoading, isPublicRoute, user]);

  // Only run heavy hooks on authenticated routes to avoid blocking mobile UI
  const { activeAlerts, notifPermission, requestPermission } = useMarketAlert(!isPublicRoute && !!user);
  const hasAlerts = useMemo(() => activeAlerts.length > 0, [activeAlerts]);
  usePriceAlerts(!isPublicRoute && !!user);
  const deriv = useDerivSession(!isPublicRoute && !!user);

  // Public auth pages (and the pre-redirect state for signed-out users) render
  // full-screen without the app sidebar/header chrome.
  if (isPublicRoute || !user) {
    return (
      <QueryClientProvider client={queryClient}>
        <main className="min-h-screen w-full">
          <Outlet />
        </main>
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <MobileMenu />
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/60 px-4 backdrop-blur-xl">
              {/* Desktop sidebar trigger */}
              <SidebarTrigger className="hidden md:flex" />
              {/* Mobile hamburger */}
              <HamburgerButton />
              <div className="flex items-center gap-3">
                <LogoMark className="h-11 w-11 shrink-0 sm:h-9 sm:w-9" />
                <div className="flex flex-col justify-center leading-none">
                  <span className="text-lg font-black tracking-tight leading-none brand-gradient-text sm:text-sm sm:font-extrabold">Vertex</span>
                  <span className="text-[8px] uppercase tracking-[0.12em] text-muted-foreground mt-0.5 sm:text-[10px] sm:tracking-[0.15em] sm:mt-1">
                    <span className="sm:hidden">Trading AI</span>
                    <span className="hidden sm:inline">Quant Trading AI</span>
                  </span>
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2 text-xs">
                <VoiceControl />
                {/* Market alert indicator */}
                {hasAlerts && (
                  <Link
                    to="/signals"
                    className="flex items-center gap-1.5 rounded-sm border border-up/40 bg-up/10 px-2.5 py-1 text-up font-semibold hover:bg-up/20 transition-colors"
                  >
                    <span className="h-2 w-2 rounded-full bg-up animate-ping absolute" />
                    <span className="h-2 w-2 rounded-full bg-up" />
                    <span className="hidden sm:inline">
                      {activeAlerts.length} signal{activeAlerts.length > 1 ? "s" : ""} fort{activeAlerts.length > 1 ? "s" : ""}
                    </span>
                    <Bell className="h-3.5 w-3.5 sm:hidden" />
                  </Link>
                )}
                {notifPermission === "default" && (
                  <button
                    onClick={requestPermission}
                    className="hidden sm:flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:text-foreground transition-colors"
                    title="Activer les notifications"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    <span>Notifs</span>
                  </button>
                )}
                {deriv.connecting && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span className="hidden sm:inline">Connexion Deriv…</span>
                  </span>
                )}
                {deriv.connected && deriv.balance !== null && (
                  <Link
                    to="/portfolio"
                    className="flex items-center gap-1.5 rounded-sm border border-primary/30 bg-primary/5 px-2.5 py-1 text-primary font-semibold hover:bg-primary/10 transition-colors"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-up animate-pulse" />
                    {deriv.balance.toFixed(2)} {deriv.currency}
                  </Link>
                )}
                <span className={cn(
                  "rounded-md border px-2 py-0.5 font-medium",
                  deriv.accountType === "live"
                    ? "border-down/30 bg-down/10 text-down"
                    : "border-up/30 bg-up/10 text-up"
                )}>
                  {deriv.accountType === "live" ? "LIVE" : "DEMO"}
                </span>
              </div>
            </header>

            {/* Strong signal banner */}
            {hasAlerts && (
              <div className="border-b border-up/20 bg-up/5 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-up">Marché favorable :</span>
                  {activeAlerts.map((a) => (
                    <Link
                      key={a.symbol}
                      to="/signals"
                      className="flex items-center gap-1.5 rounded-sm bg-up/10 border border-up/20 px-2 py-0.5 text-up hover:bg-up/20 transition-colors font-medium"
                    >
                      <span>{a.direction === "BUY" ? "▲" : "▼"}</span>
                      <span>{a.label}</span>
                      <span className="opacity-70">{a.confidence}% · {a.agreement}/4 TF</span>
                    </Link>
                  ))}
                  <Link to="/autotrader" className="ml-auto text-up hover:underline font-semibold">
                    Lancer l'auto-trader →
                  </Link>
                </div>
              </div>
            )}

            <TickerBar />
            <main className="flex-1 min-w-0 pb-16 md:pb-0">
              <Outlet />
            </main>
          </div>
        </div>
        <BottomNav />
        <MarketCoach />
        <Toaster />
      </SidebarProvider>
    </QueryClientProvider>
  );
}
