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
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { useMarketAlert } from "@/hooks/use-market-alert";
import { usePriceAlerts } from "@/hooks/use-price-alerts";
import { useDerivSession } from "@/hooks/use-deriv-session";
import { Bell, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { VoiceControl } from "@/components/voice-control";
import { MarketCoach } from "@/components/market-coach";
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
      { title: "LIO23 — Quant Trading AI" },
      {
        name: "description",
        content:
          "LIO23 — IA de trading quantitative pour Crypto & Forex, connectée à l'API Deriv. Signaux, backtest, marchés en temps réel.",
      },
      { name: "author", content: "LIO23" },
      { property: "og:title", content: "LIO23 — Quant Trading AI" },
      {
        property: "og:description",
        content: "Signaux IA, backtest et marchés en temps réel via Deriv.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "LIO23 — Quant Trading AI" },
      { name: "description", content: "LIO23 is a quantitative trading AI web application for Crypto and Forex markets." },
      { property: "og:description", content: "LIO23 is a quantitative trading AI web application for Crypto and Forex markets." },
      { name: "twitter:description", content: "LIO23 is a quantitative trading AI web application for Crypto and Forex markets." },
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

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const { activeAlerts, notifPermission, requestPermission } = useMarketAlert(true);
  const hasAlerts = useMemo(() => activeAlerts.length > 0, [activeAlerts]);
  usePriceAlerts();
  const deriv = useDerivSession();

  // Auth gate: send signed-out visitors to the login page, except on public auth routes.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading: authLoading } = useAuth();
  const publicRoutes = ["/login", "/verify-email", "/forgot-password", "/reset-password"];
  const isPublicRoute = publicRoutes.includes(pathname);
  useEffect(() => {
    if (authLoading || isPublicRoute || user) return;
    window.location.href = "/login";
  }, [authLoading, isPublicRoute, user]);

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
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/60 px-4 backdrop-blur-xl">
              <SidebarTrigger />
              <div className="flex items-center gap-2">
                <LogoMark className="h-9 w-9 sm:hidden shrink-0" />
                <div className="flex flex-col leading-none sm:hidden">
                  <span className="text-base font-extrabold tracking-tight brand-gradient-text">LIO23</span>
                  <span className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground">Quant Trading AI</span>
                </div>
                <span className="hidden sm:inline text-sm font-semibold tracking-tight text-foreground">LIO23</span>
                <span className="hidden sm:inline text-sm text-muted-foreground">— Quant AI for Crypto & Forex</span>
              </div>
              <div className="ml-auto flex items-center gap-2 text-xs">
                <VoiceControl />
                {/* Market alert indicator */}
                {hasAlerts && (
                  <Link
                    to="/signals"
                    className="flex items-center gap-1.5 rounded-md border border-[color:var(--bull)]/40 bg-[color:var(--bull)]/10 px-2.5 py-1 text-[color:var(--bull)] font-semibold hover:bg-[color:var(--bull)]/20 transition-colors"
                  >
                    <span className="h-2 w-2 rounded-full bg-[color:var(--bull)] animate-ping absolute" />
                    <span className="h-2 w-2 rounded-full bg-[color:var(--bull)]" />
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
                    className="flex items-center gap-1.5 rounded-md border border-[color:var(--brand-cyan)]/30 bg-[color:var(--brand-cyan)]/5 px-2.5 py-1 text-[color:var(--brand-cyan)] font-semibold hover:bg-[color:var(--brand-cyan)]/10 transition-colors"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--bull)] animate-pulse" />
                    {deriv.balance.toFixed(2)} {deriv.currency}
                  </Link>
                )}
                <span className={cn(
                  "rounded-md border px-2 py-0.5 font-medium",
                  deriv.accountType === "live"
                    ? "border-[color:var(--bear)]/30 bg-[color:var(--bear)]/10 text-[color:var(--bear)]"
                    : "border-[color:var(--bull)]/30 bg-[color:var(--bull)]/10 text-[color:var(--bull)]"
                )}>
                  {deriv.accountType === "live" ? "LIVE" : "DEMO"}
                </span>
              </div>
            </header>

            {/* Strong signal banner */}
            {hasAlerts && (
              <div className="border-b border-[color:var(--bull)]/20 bg-[color:var(--bull)]/5 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[color:var(--bull)]">Marché favorable :</span>
                  {activeAlerts.map((a) => (
                    <Link
                      key={a.symbol}
                      to="/signals"
                      className="flex items-center gap-1.5 rounded-md bg-[color:var(--bull)]/10 border border-[color:var(--bull)]/20 px-2 py-0.5 text-[color:var(--bull)] hover:bg-[color:var(--bull)]/20 transition-colors font-medium"
                    >
                      <span>{a.direction === "BUY" ? "▲" : "▼"}</span>
                      <span>{a.label}</span>
                      <span className="opacity-70">{a.confidence}% · {a.agreement}/4 TF</span>
                    </Link>
                  ))}
                  <Link to="/autotrader" className="ml-auto text-[color:var(--bull)] hover:underline font-semibold">
                    Lancer l'auto-trader →
                  </Link>
                </div>
              </div>
            )}

            <main className="flex-1 min-w-0">
              <Outlet />
            </main>
          </div>
        </div>
        <MarketCoach />
        <Toaster />
      </SidebarProvider>
    </QueryClientProvider>
  );
}
