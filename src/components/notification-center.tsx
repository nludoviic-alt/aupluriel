import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  CheckCheck,
  Trash2,
  X,
  Zap,
  TrendingUp,
  ShieldAlert,
  Activity,
  ChevronRight,
  Sparkles,
  Inbox,
  ArrowLeft,
  ChevronLeft,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Link, useNavigate } from "@tanstack/react-router";

export interface NotificationItem {
  id: number;
  userId: number;
  title: string;
  body: string;
  url: string | null;
  category: "trade" | "risk" | "system" | "signal";
  isRead: boolean;
  createdAt: number;
}

/**
 * Custom event dispatched whenever notifications change (marked read, cleared,
 * deleted) so that every badge across the app (sidebar, mobile menu…) can
 * refresh its unread count immediately instead of waiting for the 15s poll.
 */
export const NOTIFICATIONS_CHANGED_EVENT = "pluriel:notifications-changed";

function notifyNotificationsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT));
  }
}

interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

export function NotificationCenterSidebarItem({
  className,
  iconClassName,
  labelClassName,
  badgeClassName,
  onClick,
}: {
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  badgeClassName?: string;
  onClick?: () => void;
}) {
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await api.get<NotificationsResponse>("/api/notifications");
      setUnreadCount(data.unreadCount || 0);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 15_000);
    // Refresh immediately when any notification mutation happens elsewhere
    // (e.g. user reads/clears notifications on the notifications page).
    const onChanged = () => fetchUnread();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => {
      clearInterval(interval);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    };
  }, [fetchUnread]);

  return (
    <Link
      to="/notifications"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-base transition-all duration-200 bg-transparent border border-transparent hover:bg-amber-500/[0.04] hover:border-amber-500/15",
        className,
      )}
      title="Notifications"
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200 border bg-white/[0.04] border-white/[0.05] text-muted-foreground group-hover/nav:bg-amber-500/15 group-hover/nav:border-amber-500/25 group-hover/nav:text-amber-400",
          iconClassName,
        )}
      >
        <Bell
          className={cn(
            "h-4.5 w-4.5 transition-colors duration-200",
            unreadCount > 0 && "text-amber-400 animate-pulse",
          )}
        />
      </span>
      <span
        className={cn(
          "font-semibold transition-colors duration-200 text-[15px] tracking-wide text-muted-foreground/80 hover:text-amber-300",
          labelClassName,
        )}
      >
        Notifications
      </span>
      {unreadCount > 0 && (
        <span
          className={cn(
            "ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 font-mono text-[10px] font-black text-white shadow-[0_0_10px_rgba(244,63,94,0.5)] animate-bounce",
            badgeClassName,
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

export function NotificationCenterPage() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "trade" | "signal" | "risk" | "system">("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deepLinkHandledId, setDeepLinkHandledId] = useState<number | null>(null);
  const navigate = useNavigate();

  const loadNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<NotificationsResponse>("/api/notifications");
      setNotifications(data.notifications || []);
    } catch {
      toast.error("Impossible de charger les notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // A mobile push with no task destination opens /notifications?notification=id.
  // Select that exact record when its async list arrives, so the full text is
  // immediately readable rather than dropping the user at the app shell.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("notification"));
    if (
      Number.isInteger(id) &&
      id !== deepLinkHandledId &&
      notifications.some((notification) => notification.id === id)
    ) {
      setSelectedId(id);
      setDeepLinkHandledId(id);
      void markAsRead(id);
    }
  }, [notifications, deepLinkHandledId]);

  async function markAllAsRead() {
    try {
      await api.post("/api/notifications", { action: "mark_all_read" });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      notifyNotificationsChanged();
      toast.success("Toutes les notifications ont été marquées comme lues");
    } catch {
      toast.error("Erreur lors de la mise à jour");
    }
  }

  async function clearAll() {
    try {
      await api.post("/api/notifications", { action: "clear_all" });
      setNotifications([]);
      setSelectedId(null);
      notifyNotificationsChanged();
      toast.success("Historique des notifications effacé");
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  }

  async function markAsRead(id: number) {
    try {
      await api.post("/api/notifications", { action: "mark_read", id });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      notifyNotificationsChanged();
    } catch {}
  }

  const filtered = notifications.filter((n) => (filter === "all" ? true : n.category === filter));
  const selected = filtered.find((n) => n.id === selectedId) || null;
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  async function deleteOne(id: number, e?: React.MouseEvent) {
    e?.stopPropagation();
    try {
      await api.post("/api/notifications", { action: "delete", id });
      const idx = filtered.findIndex((n) => n.id !== id);
      const next = filtered[idx + 1] ?? filtered[idx - 1];
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (selectedId === id) {
        setSelectedId(next?.id ?? null);
      }
      notifyNotificationsChanged();
    } catch {}
  }

  // Auto-select first notification on desktop
  useEffect(() => {
    if (
      selectedId === null &&
      filtered.length > 0 &&
      typeof window !== "undefined" &&
      window.innerWidth >= 768
    ) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered.length, selectedId]);

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* ── LEFT SIDEBAR ── */}
      <div
        className={cn(
          "flex w-full flex-col border-r border-white/[0.06] bg-background/40 md:w-[340px] lg:w-[400px] shrink-0",
          selected ? "hidden md:flex" : "flex",
        )}
      >
        {/* Header */}
        <div className="shrink-0 space-y-5 border-b border-white/[0.06] px-5 py-5">
          {/* Top row: back + mark all */}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => navigate({ to: "/" })}
              className="group flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/70 hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
              Retour
            </button>
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              disabled={unreadCount === 0}
              className="h-7 gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 text-[11px] font-semibold text-foreground hover:bg-white/[0.06] disabled:opacity-40"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tout lu</span>
            </Button>
          </div>

          {/* Title + count */}
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/15 text-amber-400 shrink-0">
              <Bell className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-black tracking-tight text-foreground leading-none">
                Notifications
              </h1>
              <p className="mt-1.5 text-[11px] text-muted-foreground/70 leading-none">
                {unreadCount > 0 ? (
                  <span className="text-amber-400 font-semibold">
                    {unreadCount} non lue{unreadCount > 1 ? "s" : ""}
                  </span>
                ) : (
                  <span>Toutes lues</span>
                )}
                <span className="text-muted-foreground/40"> · {filtered.length} au total</span>
              </p>
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { id: "all", label: "Toutes" },
                { id: "trade", label: "Trades" },
                { id: "signal", label: "Signaux" },
                { id: "risk", label: "Sécurité" },
                { id: "system", label: "Système" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setFilter(tab.id);
                  setSelectedId(null);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 font-semibold whitespace-nowrap transition-all border text-[11px]",
                  filter === tab.id
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-300"
                    : "border-transparent bg-white/[0.03] text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.06]",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-xs text-muted-foreground/60">
              Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center p-6 space-y-3">
              <Inbox className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-semibold text-foreground/80">Aucune notification</p>
            </div>
          ) : (
            filtered.map((item) => {
              const meta = getCategoryMeta(item.category);
              const Icon = meta.icon;
              const formattedDate = formatNotificationTime(item.createdAt);
              const isActive = selectedId === item.id;

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    markAsRead(item.id);
                    setSelectedId(item.id);
                  }}
                  className={cn(
                    "group relative flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all duration-150",
                    isActive
                      ? "border-amber-500/25 bg-amber-500/[0.06] shadow-[0_0_12px_rgba(245,158,11,0.04)]"
                      : "border-transparent bg-transparent hover:bg-white/[0.03] hover:border-white/[0.04]",
                  )}
                >
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-xs",
                      meta.style,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3
                        className={cn(
                          "text-[13px] font-bold leading-snug",
                          item.isRead ? "text-neutral-400" : "text-foreground",
                        )}
                      >
                        {item.title}
                      </h3>
                      {!item.isRead && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400 animate-pulse" />
                      )}
                    </div>

                    <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground/60 break-words">
                      {item.body}
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 font-mono">
                        <Clock className="h-3 w-3" />
                        {formattedDate}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── RIGHT DETAIL PANE ── */}
      <div
        className={cn(
          "flex flex-1 flex-col overflow-hidden bg-background/20 min-w-0",
          !selected ? "hidden md:flex" : "flex",
        )}
      >
        {/* Mobile header */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3 md:hidden shrink-0">
          <button
            onClick={() => setSelectedId(null)}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-bold text-foreground">Détail</span>
        </div>

        {selected ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="mx-auto max-w-2xl px-6 py-8 lg:px-10 lg:py-12 space-y-8">
              {/* Date + category badge */}
              <div className="flex items-center gap-3 flex-wrap">
                {(() => {
                  const meta = getCategoryMeta(selected.category);
                  const Icon = meta.icon;
                  return (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                        meta.style,
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  );
                })()}
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/60 font-mono">
                  <Clock className="h-3 w-3" />
                  {formatFullDate(selected.createdAt)}
                </div>
              </div>

              {/* Title */}
              <h2 className="text-2xl lg:text-3xl font-black tracking-tight text-foreground leading-tight">
                {selected.title}
              </h2>

              {/* Divider */}
              <div className="h-px w-full bg-gradient-to-r from-amber-500/20 via-white/10 to-transparent" />

              {/* Body */}
              <div className="text-sm lg:text-[15px] leading-relaxed text-foreground/80 whitespace-pre-wrap break-words">
                {selected.body}
              </div>

              {/* Action link */}
              {selected.url && (
                <Button
                  type="button"
                  onClick={() => {
                    // URLs are produced server-side. Still reject an external
                    // value defensively: a notification must never become an
                    // open redirect from a mobile push.
                    if (selected.url) {
                      const destination = new URL(selected.url, window.location.origin);
                      if (destination.origin === window.location.origin)
                        window.location.assign(destination.href);
                    }
                  }}
                  className="w-full sm:w-auto"
                >
                  {selected.category === "signal" ? "Préparer l’ordre" : "Ouvrir le contexte"}
                  <ChevronRight className="ml-1.5 h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center p-8 text-muted-foreground/40 space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03] border border-white/[0.08]">
              <Bell className="h-8 w-8 text-muted-foreground/30" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-foreground/80">
                Sélectionne une notification
              </p>
              <p className="text-xs text-muted-foreground/50 max-w-xs">
                Clique sur un élément de la liste pour afficher les détails complets.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getCategoryMeta(category: NotificationItem["category"]) {
  switch (category) {
    case "trade":
      return {
        label: "Trade",
        icon: TrendingUp,
        style: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
        borderClass: "border-l-emerald-500/60",
        textClass: "text-emerald-400",
      };
    case "signal":
      return {
        label: "Signal IA",
        icon: Sparkles,
        style: "border-purple-500/40 bg-purple-500/15 text-purple-400",
        borderClass: "border-l-purple-500/60",
        textClass: "text-purple-400",
      };
    case "risk":
      return {
        label: "Sécurité",
        icon: ShieldAlert,
        style: "border-rose-500/40 bg-rose-500/15 text-rose-400",
        borderClass: "border-l-rose-500/60",
        textClass: "text-rose-400",
      };
    default:
      return {
        label: "Système",
        icon: Activity,
        style: "border-cyan-500/40 bg-cyan-500/15 text-cyan-400",
        borderClass: "border-l-cyan-500/60",
        textClass: "text-cyan-400",
      };
  }
}

function formatFullDate(timestampSeconds: number) {
  if (!timestampSeconds) return "";
  const date = new Date(timestampSeconds * 1000);
  return date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatNotificationTime(timestampSeconds: number) {
  if (!timestampSeconds) return "";
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "À l'instant";
  if (diffSec < 3600) return `Il y a ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `Il y a ${Math.floor(diffSec / 3600)}h`;
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
