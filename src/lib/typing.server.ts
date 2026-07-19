// Ephemeral "is typing" state, kept in memory only (no need to persist a
// signal that's stale within seconds) — one map of last-typed timestamps per group.
const typingByGroup = new Map<string, Map<number, number>>();
const TYPING_TTL_MS = 6000;

export function markTyping(groupId: string, userId: number) {
  let group = typingByGroup.get(groupId);
  if (!group) {
    group = new Map();
    typingByGroup.set(groupId, group);
  }
  group.set(userId, Date.now());
}

export function getTypingUserIds(groupId: string, excludeUserId: number): number[] {
  const group = typingByGroup.get(groupId);
  if (!group) return [];
  const now = Date.now();
  const active: number[] = [];
  for (const [userId, lastTypedAt] of group) {
    if (now - lastTypedAt > TYPING_TTL_MS) {
      group.delete(userId);
      continue;
    }
    if (userId !== excludeUserId) active.push(userId);
  }
  return active;
}
