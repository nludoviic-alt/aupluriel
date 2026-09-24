// Server-side counterpart to the client's useMarketOpenNotify hook — the
// client version only fired while a tab happened to be open at the exact
// moment a session transitioned, so most users never saw it. This runs
// centrally and pushes every approved user the moment a session opens.
import { getDb } from "./db.server";
import { currentActiveSessions, SESSION_HOURS, type TradingSession } from "./signal-core";

const CHECK_INTERVAL_MS = 30_000;

let prevActive = new Set<TradingSession>();
const notifiedToday = new Set<string>();

function todayKey(session: TradingSession): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}_${session}`;
}

async function notifyAll(session: TradingSession): Promise<void> {
  const label = SESSION_HOURS[session].label;
  const db = getDb();
  const users = db.prepare("SELECT id FROM users WHERE status = 'approved'").all() as { id: number }[];
  if (!users.length) return;
  const { sendPushToUser } = await import("./push.server");
  await Promise.allSettled(
    users.map((u) =>
      sendPushToUser(u.id, {
        title: `Au Pluriel — Session ${label} ouverte`,
        body: "Une nouvelle session de marché vient de démarrer.",
        url: "/",
      }),
    ),
  );
}

function tick(): void {
  const nowActive = new Set(currentActiveSessions());
  for (const session of nowActive) {
    if (prevActive.has(session)) continue;
    const key = todayKey(session);
    if (notifiedToday.has(key)) continue;
    notifiedToday.add(key);
    if (notifiedToday.size > 40) {
      // Keep the set small — 4 sessions/day means this covers ~10 days of history.
      const [oldest] = notifiedToday;
      notifiedToday.delete(oldest);
    }
    notifyAll(session).catch((e) => console.error("[market-session] Push échoué:", (e as Error).message));
  }
  prevActive = nowActive;
}

export function startMarketSessionScheduler(): void {
  // Seed with whatever's already open at boot so a restart never re-fires
  // for sessions that were open before the process started.
  prevActive = new Set(currentActiveSessions());
  setInterval(tick, CHECK_INTERVAL_MS);
  console.log("[market-session] Scheduler démarré.");
}
