import { createFileRoute } from "@tanstack/react-router";
import { NotificationCenterPage } from "@/components/notification-center";

export const Route = createFileRoute("/notifications")({
  head: () => ({ meta: [{ title: "Notifications — Au Pluriel" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  return (
    <div className="h-[calc(100vh-13.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] md:h-[calc(100vh-9.5rem)] overflow-hidden rounded-2xl border border-white/[0.06] bg-background/50 shadow-2xl">
      <NotificationCenterPage />
    </div>
  );
}
