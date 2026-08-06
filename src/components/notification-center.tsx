import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

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

interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
}

export function NotificationCenterTrigger() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const data = await api.get<NotificationsResponse>("/api/notifications");
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Ignore if signed out
    }
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 15_000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground hover:bg-white/[0.08] hover:text-foreground transition-all duration-300 shadow-sm"
        title="Centre de Notifications"
        aria-label="Centre de Notifications"
      >
        <Bell className={cn("h-4 w-4 transition-transform", unreadCount > 0 && "text-amber-400 animate-pulse")} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 font-mono text-[10px] font-black text-white shadow-[0_0_10px_rgba(244,63,94,0.5)] animate-bounce">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && <NotificationCenterModal onClose={() => setOpen(false)} onUpdate={fetchUnread} />}
    </>
  );
}

export function NotificationCenterModal({
  onClose,
  onUpdate,
}: {
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "trade" | "signal" | "risk" | "system">("all");

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

  async function markAllAsRead() {
    try {
      await api.post("/api/notifications", { action: "mark_all_read" });
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      onUpdate();
      toast.success("Toutes les notifications ont été marquées comme lues");
    } catch {
      toast.error("Erreur lors de la mise à jour");
    }
  }

  async function clearAll() {
    try {
      await api.post("/api/notifications", { action: "clear_all" });
      setNotifications([]);
      onUpdate();
      toast.success("Historique des notifications effacé");
    } catch {
      toast.error("Erreur lors de la suppression");
    }
  }

  async function markAsRead(id: number) {
    try {
      await api.post("/api/notifications", { action: "mark_read", id });
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      onUpdate();
    } catch {}
  }

  async function deleteOne(id: number, e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.post("/api/notifications", { action: "delete", id });
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      onUpdate();
    } catch {}
  }

  const filtered = notifications.filter((n) => (filter === "all" ? true : n.category === filter));
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (typeof document === "undefined") return null;

  // Rendered inline (not portaled) this was a child of <header>, which has
  // overflow-hidden for its decorative glow blobs — a `fixed` descendant
  // still gets clipped to an overflow:hidden ancestor's box in this DOM
  // subtree, so the modal only ever showed a sliver inside the header's own
  // ~80px height instead of covering the screen. Portal to <body>, same
  // pattern as StrategyEditor in strategies.tsx.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="relative flex h-[90vh] max-h-[750px] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#0B0F19] shadow-2xl">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 bg-black/40">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/15 text-amber-400">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-foreground tracking-tight">Centre de Notifications</h2>
                {unreadCount > 0 && (
                  <span className="rounded-full bg-rose-500/20 border border-rose-500/30 px-2 py-0.5 font-mono text-xs font-bold text-rose-400">
                    {unreadCount} non lue{unreadCount > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Historique complet de vos alertes & signaux</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action Controls & Filter Bar */}
        <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-3 bg-white/[0.02]">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-mono text-muted-foreground font-semibold">
              {filtered.length} notification{filtered.length > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllAsRead}
                  className="h-8 gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tout marquer comme lu</span>
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="h-8 gap-1.5 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Tout effacer</span>
                </Button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
            {(
              [
                { id: "all", label: "Toutes" },
                { id: "trade", label: "Trades 📈" },
                { id: "signal", label: "Signaux ⚡" },
                { id: "risk", label: "Sécurité 🛡️" },
                { id: "system", label: "Système ⚙️" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  "rounded-xl px-3 py-1.5 font-bold whitespace-nowrap transition-all border text-xs",
                  filter === tab.id
                    ? "border-primary/50 bg-primary/20 text-primary shadow-sm"
                    : "border-white/5 bg-black/30 text-muted-foreground hover:text-foreground hover:bg-white/5"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Notifications Scroll List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
              Chargement des notifications…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center p-6 space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-muted-foreground">
                <Inbox className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Aucune notification enregistrée</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Les futurs signaux de trading, alertes de risque et mises à jour apparaîtront ici.
                </p>
              </div>
            </div>
          ) : (
            filtered.map((item) => {
              const meta = getCategoryMeta(item.category);
              const Icon = meta.icon;
              const formattedDate = formatNotificationTime(item.createdAt);

              return (
                <div
                  key={item.id}
                  onClick={() => markAsRead(item.id)}
                  className={cn(
                    "relative group flex flex-col gap-2.5 rounded-2xl border p-4 transition-all duration-200 cursor-pointer shadow-md",
                    item.isRead
                      ? "border-white/5 bg-black/40 text-muted-foreground hover:border-white/15"
                      : "border-amber-500/30 bg-amber-500/[0.04] text-foreground shadow-[0_0_15px_rgba(245,158,11,0.05)]"
                  )}
                >
                  {/* Top line: Icon + Category + Date + Delete */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-xs font-bold", meta.style)}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className={cn("text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border", meta.style)}>
                        {meta.label}
                      </span>
                      {!item.isRead && (
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping shrink-0" title="Non lu" />
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] text-muted-foreground font-medium">
                        {formattedDate}
                      </span>
                      <button
                        onClick={(e) => deleteOne(item.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-rose-400 transition-opacity p-1"
                        title="Supprimer la notification"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title */}
                  <h3 className={cn("text-xs sm:text-sm font-black tracking-tight", item.isRead ? "text-neutral-300" : "text-foreground")}>
                    {item.title}
                  </h3>

                  {/* Full Body Text — NO TRUNCATION! FULL READABILITY */}
                  <div className="text-xs text-neutral-300 leading-relaxed font-sans bg-black/30 p-3 rounded-xl border border-white/5 whitespace-pre-wrap break-words">
                    {item.body}
                  </div>

                  {/* Optional Action Button Link */}
                  {item.url && (
                    <div className="pt-1 flex justify-end">
                      <Link
                        to={item.url as any}
                        onClick={onClose}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition-all"
                      >
                        <span>Ouvrir l'action</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function getCategoryMeta(category: NotificationItem["category"]) {
  switch (category) {
    case "trade":
      return { label: "Trade", icon: TrendingUp, style: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" };
    case "signal":
      return { label: "Signal IA", icon: Sparkles, style: "border-purple-500/40 bg-purple-500/15 text-purple-400" };
    case "risk":
      return { label: "Sécurité", icon: ShieldAlert, style: "border-rose-500/40 bg-rose-500/15 text-rose-400" };
    default:
      return { label: "Système", icon: Activity, style: "border-cyan-500/40 bg-cyan-500/15 text-cyan-400" };
  }
}

function formatNotificationTime(timestampSeconds: number) {
  if (!timestampSeconds) return "";
  const date = new Date(timestampSeconds * 1000);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "À l'instant";
  if (diffSec < 3600) return `Il y a ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86400) return `Il y a ${Math.floor(diffSec / 3600)}h`;
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
