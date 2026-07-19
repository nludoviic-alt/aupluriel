// Ephemeral "is online" tracking (in-memory, same pattern as typing.server.ts)
// — a user counts as online if the app pinged us in the last ONLINE_WINDOW_MS.
// Not persisted: a server restart clears everyone back to offline, which is
// correct since "online" only ever describes the current moment.
const lastSeenByUser = new Map<number, number>();
const ONLINE_WINDOW_MS = 45_000;

export function markOnline(userId: number) {
  lastSeenByUser.set(userId, Date.now());
}

export function isOnline(userId: number): boolean {
  const ts = lastSeenByUser.get(userId);
  return !!ts && Date.now() - ts < ONLINE_WINDOW_MS;
}

export function getOnlineUserIds(userIds: number[]): number[] {
  return userIds.filter(isOnline);
}
