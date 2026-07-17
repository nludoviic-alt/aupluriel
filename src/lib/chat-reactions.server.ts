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
