// Client-side Web Push subscribe/unsubscribe. Delivers real OS notifications
// even with the phone locked (public/sw.js handles the 'push' event) — a
// plain `new Notification(...)` call only works while the tab is open and
// active. On iOS this needs the site added to the Home Screen; a Safari tab
// cannot receive push at all (WebKit restriction, iOS 16.4+).
import { api } from "./api";

export function isPushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

function isIos(): boolean {
  return typeof window !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
}

/**
 * Every iOS browser (Chrome, Firefox, Edge…) is Safari/WebKit underneath —
 * Apple requires it — but Apple only grants Web Push capability to sites
 * added to the Home Screen THROUGH SAFARI specifically. Chrome-on-iOS's own
 * "Add to Home Screen" just creates a bookmark that still opens inside
 * Chrome (never reaches standalone display mode), so push can never work
 * there no matter what the user does — this isn't fixable client-side.
 * CriOS/FxiOS/EdgiOS markers only appear in non-Safari iOS browsers.
 */
export function isIosNonSafari(): boolean {
  return isIos() && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
}

/** iOS Safari only allows Web Push for an installed (Home Screen) PWA, not a regular tab. */
export function isIosNonStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return isIos() && !isStandalone;
}

// BufferSource return type sidesteps a TS/DOM lib mismatch where
// Uint8Array<ArrayBufferLike> isn't structurally assignable to the
// applicationServerKey param's BufferSource type.
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** Requests Notification permission (if needed), subscribes, and registers with the server. */
export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) throw new Error("Notifications push non supportées sur ce navigateur");
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!publicKey) throw new Error("Clé VAPID non configurée côté serveur");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Permission refusée");

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = sub.toJSON();
  await api.post("/api/push", { endpoint: json.endpoint, keys: json.keys });
}

export async function unsubscribeFromPush(): Promise<void> {
  const sub = await getExistingPushSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.delete("/api/push", { endpoint });
}
