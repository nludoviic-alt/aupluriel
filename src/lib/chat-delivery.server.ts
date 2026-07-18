import type Database from "better-sqlite3";

// Marks every message addressed to `userId` that hasn't been delivered yet.
// Called both from the presence heartbeat (fires the moment the recipient's
// app is confirmed running, regardless of which conversation is open) and
// from the messages GET handler (so opening a chat delivers it immediately
// even between two heartbeat ticks).
export function markMessagesDelivered(db: Database.Database, userId: number, isAdmin: boolean) {
  const now = Math.floor(Date.now() / 1000);

  if (isAdmin) {
    // Admins can see every direct conversation, so any message sent to an
    // admin (in any direct group) counts as delivered once any admin's
    // client is confirmed running.
    db.prepare(
      `UPDATE chat_messages
       SET delivered_at = ?
       WHERE delivered_at IS NULL
         AND sender_id != ?
         AND group_id IN (SELECT id FROM chat_groups WHERE is_direct = 1)`
    ).run(now, userId);
    return;
  }

  db.prepare(
    `UPDATE chat_messages
     SET delivered_at = ?
     WHERE delivered_at IS NULL
       AND sender_id != ?
       AND group_id IN (
         SELECT id FROM chat_groups WHERE is_direct = 1 AND recipient_id = ?
         UNION
         SELECT group_id FROM chat_group_members WHERE user_id = ?
       )`
  ).run(now, userId, userId, userId);
}
