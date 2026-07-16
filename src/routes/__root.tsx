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
import { useMarketOpenNotify } from "@/hooks/use-market-open-notify";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { useDerivSession } from "@/hooks/use-deriv-session";
import {
  Bell,
  Loader2,
  Menu,
  X,
  LayoutDashboard,
  BriefcaseBusiness,
  Radar,
  Zap,
  CandlestickChart,
  FlaskConical,
  BarChart3,
  Workflow,
  NotebookPen,
  Settings,
  ShieldCheck,
  Compass,
  MessageSquare,
} from "lucide-react";
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
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" },
      { title: "The future" },
      { name: "theme-color", content: "#050505" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Au Pluriel" },
      {
        name: "description",
        content:
          "Au Pluriel — trading quantitative pour Crypto & Forex, connectée à l'API Deriv. Signaux, backtest, marchés en temps réel.",
      },
      { name: "author", content: "Au Pluriel" },
      { property: "og:title", content: "The future" },
      {
        property: "og:description",
        content: "Signaux, backtest et marchés en temps réel via Deriv.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "The future" },
      { name: "description", content: "The future" },
      { property: "og:description", content: "The future" },
      { name: "twitter:description", content: "The future" },
      { property: "og:image", content: "https://aupluriel.com/logo-lio23-banner.jpg" },
      { property: "og:image:width", content: "600" },
      { property: "og:image:height", content: "400" },
      { name: "twitter:image", content: "https://aupluriel.com/logo-lio23-banner.jpg" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.json" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", type: "image/png", href: "/favicon.png", sizes: "32x32" },
      { rel: "icon", type: "image/png", href: "/favicon.png", sizes: "64x64" },
      { rel: "icon", type: "image/png", href: "/favicon.png", sizes: "128x128" },
      { rel: "icon", type: "image/png", href: "/logo-192.png", sizes: "192x192" },
      { rel: "icon", type: "image/png", href: "/logo-maskable-512.png", sizes: "512x512" },
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
        "relative flex md:hidden h-10 w-10 flex-col items-center justify-center gap-[5px] rounded-xl border transition-all duration-300 shadow-sm",
        openMobile
          ? "border-violet-500/40 bg-violet-500/10 text-violet-400 shadow-[0_0_12px_rgba(139,92,246,0.15)]"
          : "border-white/5 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground hover:border-white/10",
      )}
    >
      <span className={cn("block h-px w-4 bg-current transition-all duration-300 origin-center", openMobile && "translate-y-[5px] rotate-45")} />
      <span className={cn("block h-px w-4 bg-current transition-all duration-200", openMobile && "scale-x-0 opacity-0")} />
      <span className={cn("block h-px w-4 bg-current transition-all duration-300 origin-center", openMobile && "-translate-y-[5px] -rotate-45")} />
    </button>
  );
}

const PAGE_META: Record<string, { label: string; icon: typeof LayoutDashboard }> = {
  "/": { label: "Dashboard", icon: LayoutDashboard },
  "/portfolio": { label: "Portfolio", icon: BriefcaseBusiness },
  "/signals": { label: "IA Signals", icon: Radar },
  "/autotrader": { label: "Auto-Trader", icon: Zap },
  "/markets": { label: "Marchés", icon: CandlestickChart },
  "/backtest": { label: "Backtest", icon: FlaskConical },
  "/journal": { label: "Journal", icon: BarChart3 },
  "/strategies": { label: "Stratégies", icon: Workflow },
  "/notes": { label: "Notes", icon: NotebookPen },
  "/alerts": { label: "Alertes", icon: Bell },
  "/settings": { label: "Paramètres", icon: Settings },
  "/admin": { label: "Administration", icon: ShieldCheck },
  "/messenger": { label: "Messagerie", icon: MessageSquare },
};

function getPageMeta(pathname: string) {
  return (
    PAGE_META[pathname] ?? {
      label: pathname === "/" ? "Dashboard" : pathname.slice(1).charAt(0).toUpperCase() + pathname.slice(2),
      icon: Compass,
    }
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Auth gate: send signed-out visitors to the login page, except on public auth routes.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading: authLoading } = useAuth();

  // Register Service Worker for PWA. Registering inside a "load" listener
  // never fired when hydration finished after window.load (common) — register
  // directly, deferring only when the page is genuinely still loading.
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () =>
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.error("SW reg error:", err));
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  const publicRoutes = ["/login", "/verify-email", "/forgot-password", "/reset-password"];
  const isPublicRoute = publicRoutes.includes(pathname);
  useEffect(() => {
    if (authLoading || isPublicRoute || user) return;
    window.location.href = "/login";
  }, [authLoading, isPublicRoute, user]);

  // Only run heavy hooks on authenticated routes to avoid blocking mobile UI
  const { activeAlerts, notifPermission, requestPermission } = useMarketAlert(!isPublicRoute && !!user);
  const hasAlerts = useMemo(() => activeAlerts.length > 0, [activeAlerts]);
  const pageMeta = useMemo(() => getPageMeta(pathname), [pathname]);
  const PageIcon = pageMeta.icon;
  useMarketOpenNotify(!isPublicRoute && !!user);
  usePriceAlerts(!isPublicRoute && !!user);
  const deriv = useDerivSession(!isPublicRoute && !!user);

  // Public auth pages (and the pre-redirect state for signed-out users) render
  // full-screen without the app sidebar/header chrome.
  if (authLoading) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-black" suppressHydrationWarning={true}>
        <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (isPublicRoute) {
    return (
      <QueryClientProvider client={queryClient}>
        <main className="min-h-screen w-full">
          <Outlet />
        </main>
        <Toaster />
      </QueryClientProvider>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <MobileMenu />
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            {/* Header for main content */}
            <header className="relative sticky top-0 z-30 flex h-[calc(5rem+env(safe-area-inset-top))] md:h-24 items-center gap-3 md:gap-4 overflow-hidden px-4 pt-[env(safe-area-inset-top)] md:px-6 md:pt-0 border-b border-white/[0.06] bg-background/95 backdrop-blur-2xl shadow-[0_18px_40px_-24px_rgba(0,0,0,0.7)] transition-all duration-300">
              {/* Ambient glow blobs matching the orange theme */}
              <div className="pointer-events-none absolute -top-28 -left-16 h-56 w-56 rounded-full bg-orange-500/10 blur-[90px]" />
              <div className="pointer-events-none absolute -top-28 -right-16 h-56 w-56 rounded-full bg-amber-500/10 blur-[90px]" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent" />
              {/* Animated shimmering accent line bridging orange and amber */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden">
                <div className="h-full w-[250%] -translate-x-1/3 bg-[linear-gradient(90deg,transparent,oklch(0.70_0.20_45/0.7),oklch(0.85_0.20_70/0.7),transparent)] bg-[length:40%_100%] animate-[shimmer_6s_linear_infinite]" />
              </div>

              {/* Desktop sidebar trigger */}
              <SidebarTrigger className="hidden md:flex rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/10 transition-all p-2 h-10 w-10 cursor-pointer" />
              {/* Mobile hamburger */}
              <HamburgerButton />

              {/* Divider between nav controls and page title (desktop only) */}
              <div className="hidden md:block h-9 w-px shrink-0 bg-gradient-to-b from-transparent via-white/10 to-transparent" />

              {/* Page title */}
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="hidden md:flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/15 via-white/[0.02] to-cyan-500/10 text-violet-300 shadow-inner shadow-black/30">
                  <PageIcon className="h-5 w-5" />
                </div>
                <div className="flex min-w-0 flex-col">
                  <h1 className="truncate text-xl md:text-[26px] font-black leading-tight tracking-tight bg-gradient-to-r from-white via-white to-white/75 bg-clip-text text-transparent">
                    {pageMeta.label}
                  </h1>
                  <div className="mt-1 hidden items-center gap-1.5 sm:flex">
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    </span>
                    <p className="truncate text-[10.5px] font-bold uppercase tracking-[0.22em] text-muted-foreground/50">
                      Au Pluriel Quant Trading
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 md:gap-2.5">
                {/* Market alert indicator — redundant with the full-detail banner
                    shown below the header on every page when hasAlerts, so it's
                    desktop-only to keep the mobile title from being crowded out. */}
                {hasAlerts && (
                  <Link
                    to="/signals"
                    className="hidden md:flex h-10 items-center gap-2 rounded-xl border border-up/30 bg-up/5 px-3.5 text-up font-semibold text-xs hover:bg-up/10 hover:border-up/50 transition-all duration-300 shadow-[0_0_12px_rgba(16,185,129,0.1)] hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="h-2 w-2 rounded-full bg-up animate-ping absolute" />
                      <span className="h-2 w-2 rounded-full bg-up" />
                    </span>
                    <span>
                      {activeAlerts.length} signal{activeAlerts.length > 1 ? "s" : ""} fort{activeAlerts.length > 1 ? "s" : ""}
                    </span>
                  </Link>
                )}
                {notifPermission === "default" && (
                  <button
                    onClick={requestPermission}
                    className="hidden sm:flex h-10 items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.08] hover:border-white/10 transition-all duration-300"
                    title="Activer les notifications"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    <span>Notifications</span>
                  </button>
                )}
                {deriv.connecting && (
                  <span className="flex h-10 items-center gap-2 text-muted-foreground px-3.5 text-xs bg-white/[0.02] border border-white/5 rounded-xl">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                    <span className="hidden sm:inline">Connexion Deriv…</span>
                  </span>
                )}
                {deriv.connected && deriv.balance !== null && (
                  <Link
                    to="/portfolio"
                    className="flex h-10 items-center gap-2 sm:gap-2.5 rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/5 to-transparent px-3 sm:px-4 text-violet-300 hover:text-violet-200 font-semibold hover:border-violet-500/40 transition-all duration-300 shadow-[0_0_12px_rgba(139,92,246,0.1)] hover:shadow-[0_0_18px_rgba(139,92,246,0.2)]"
                  >
                    <span className="relative hidden h-2 w-2 sm:flex">
                      <span className="h-2 w-2 rounded-full bg-violet-400 animate-ping absolute opacity-75" />
                      <span className="h-2 w-2 rounded-full bg-violet-500" />
                    </span>
                    <span className="font-mono text-sm leading-none tracking-tight">
                      {deriv.balance.toFixed(2)} <span className="hidden sm:inline text-xs text-violet-400/80 font-sans font-normal ml-0.5">{deriv.currency}</span>
                    </span>
                  </Link>
                )}
                <span className={cn(
                  "flex h-10 items-center gap-1.5 rounded-xl border px-2.5 sm:px-3.5 font-bold text-[10px] tracking-widest uppercase transition-all duration-300",
                  deriv.accountType === "live"
                    ? "border-down/30 bg-down/5 text-down shadow-[0_0_10px_rgba(239,68,68,0.1)] hover:bg-down/10 hover:border-down/40"
                    : "border-up/30 bg-up/5 text-up shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:bg-up/10 hover:border-up/40"
                )}>
                  <span className={cn("h-1.5 w-1.5 rounded-full", deriv.accountType === "live" ? "bg-down animate-pulse" : "bg-up animate-pulse")} />
                  {deriv.accountType === "live" ? "LIVE" : "DEMO"}
                </span>
              </div>
            </header>

            {/* Breathing room below the sticky header */}
            <div className="h-6 shrink-0" />

            {/* Strong signal banner — hidden on the messenger page: it eats into the
                chat panel's carefully-budgeted viewport height and is irrelevant there */}
            {hasAlerts && pathname !== "/messenger" && (
              <div className="border-b border-up/20 bg-gradient-to-r from-up/5 to-up/10 px-6 py-3 backdrop-blur-sm">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-semibold text-up flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-up animate-pulse" />
                    Marché favorable :
                  </span>
                  {activeAlerts.map((a) => (
                    <Link
                      key={a.symbol}
                      to="/signals"
                      className="flex items-center gap-2 rounded-lg bg-up/10 border border-up/30 px-3 py-1.5 text-up hover:bg-up/20 hover:border-up/40 transition-all duration-200 font-medium shadow-lg shadow-up/10"
                    >
                      <span className="font-bold">{a.direction === "BUY" ? "▲" : "▼"}</span>
                      <span>{a.label}</span>
                      <span className="opacity-70">{a.confidence}% · {a.agreement}/4 TF</span>
                    </Link>
                  ))}
                  <Link to="/autotrader" className="ml-auto flex items-center gap-2 text-up hover:underline font-semibold transition-all duration-200 hover:gap-3">
                    Lancer l'auto-trader →
                  </Link>
                </div>
              </div>
            )}

            {/* Live price ticker is a nice-to-have, not core to using the app —
                desktop-only, keeps the mobile header/main area focused. */}
            <div className="hidden md:block">
              <TickerBar />
            </div>
            <main className={cn(
              "flex-1 min-w-0 pb-16 md:pb-0",
              pathname === "/messenger" && "overflow-hidden"
            )}>
              <Outlet />
            </main>
          </div>
        </div>
        <BottomNav />
        <Toaster />
      </SidebarProvider>
    </QueryClientProvider>
  );
}
