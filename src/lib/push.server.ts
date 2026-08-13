// Web Push sender — the counterpart to email.server.ts, but delivers even
// when the phone is locked (real OS-level notification via the browser's
// push service, handled in the background by public/sw.js's 'push' listener).
// On iOS this only works if the site was added to the Home Screen; a plain
// Safari tab cannot receive push at all (WebKit restriction, iOS 16.4+).

import webpush from "web-push";
import { getDb } from "./db.server";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.VITE_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function recordNotification(
  userId: number,
  title: string,
  body: string,
  url?: string,
  category: "trade" | "risk" | "system" | "signal" = "system",
): number | null {
  try {
    const result = getDb()
      .prepare(
        `
      INSERT INTO user_notifications (user_id, title, body, url, category, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 0, unixepoch())
    `,
      )
      .run(userId, title, body, url ?? null, category);
    return Number(result.lastInsertRowid);
  } catch (e) {
    console.error("[notifications] Failed to record notification:", (e as Error).message);
    return null;
  }
}

/**
 * Sends to every device this user subscribed from and records in in-app notification center.
 */
export async function sendPushToUser(
  userId: number,
  payload: PushPayload & { category?: "trade" | "risk" | "system" | "signal" },
): Promise<void> {
  // Always record in in-app Notification Center so the user never loses a message
  const notificationId = recordNotification(
    userId,
    payload.title,
    payload.body,
    payload.url,
    payload.category ?? "system",
  );

  if (!ensureConfigured()) return; // VAPID not configured — silently skip, like Resend without a key

  const subs = getDb()
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as SubscriptionRow[];
  if (!subs.length) return;

  // Always open the readable notification detail first. Its saved `url` is
  // exposed as an explicit secondary action (e.g. “Préparer l’ordre”), so a
  // mobile push cannot throw the user into a generic app screen and lose the
  // actual reason/context of the notification.
  const url = notificationId ? `/notifications?notification=${notificationId}` : "/notifications";
  const body = JSON.stringify({ ...payload, url, notificationId });
  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          getDb().prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").run(sub.endpoint);
        } else {
          console.error(`[push] Échec d'envoi pour user ${userId}: ${(e as Error).message}`);
        }
      }
    }),
  );
}
