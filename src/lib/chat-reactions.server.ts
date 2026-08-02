import type Database from "better-sqlite3";

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

/** Aggregated reactions for one message, from the requesting user's point of view. */
export function getReactions(db: Database.Database, messageId: string, requestingUserId: number): ReactionSummary[] {
  const rows = db
    .prepare("SELECT user_id AS userId, emoji FROM chat_message_reactions WHERE message_id = ?")
    .all(messageId) as { userId: number; emoji: string }[];

  const byEmoji = new Map<string, number[]>();
  for (const { emoji, userId } of rows) {
    (byEmoji.get(emoji) ?? byEmoji.set(emoji, []).get(emoji)!).push(userId);
  }

  return [...byEmoji.entries()].map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    mine: userIds.includes(requestingUserId),
  }));
}

/** Batch version: fetches reactions for all message IDs in a single query,
 * eliminating the N+1 per-message calls that the chat messages endpoint
 * was making (one SELECT per message × 200 messages = 200 round-trips). */
export function getReactionsForMessages(
  db: Database.Database,
  messageIds: string[],
  requestingUserId: number,
): Map<string, ReactionSummary[]> {
  if (messageIds.length === 0) return new Map();
  const placeholders = messageIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT message_id AS messageId, user_id AS userId, emoji FROM chat_message_reactions WHERE message_id IN (${placeholders})`)
    .all(...messageIds) as { messageId: string; userId: number; emoji: string }[];

  const byMessage = new Map<string, Map<string, number[]>>();
  for (const { messageId, emoji, userId } of rows) {
    let byEmoji = byMessage.get(messageId);
    if (!byEmoji) { byEmoji = new Map(); byMessage.set(messageId, byEmoji); }
    (byEmoji.get(emoji) ?? byEmoji.set(emoji, []).get(emoji)!).push(userId);
  }

  const result = new Map<string, ReactionSummary[]>();
  for (const id of messageIds) {
    const byEmoji = byMessage.get(id);
    result.set(id, byEmoji
      ? [...byEmoji.entries()].map(([emoji, userIds]) => ({
          emoji,
          count: userIds.length,
          mine: userIds.includes(requestingUserId),
        }))
      : []);
  }
  return result;
}
