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

/**
 * Sends to every device this user subscribed from. Fire-and-forget by
 * design (mirrors sendEmail) — a push provider hiccup must never break
 * trade resolution. A 404/410 response means the subscription is dead
 * (uninstalled, permission revoked) and is pruned so we stop retrying it.
 */
export async function sendPushToUser(userId: number, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return; // VAPID not configured — silently skip, like Resend without a key

  const subs = getDb()
    .prepare("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?")
    .all(userId) as SubscriptionRow[];
  if (!subs.length) return;

  const body = JSON.stringify(payload);
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
