import Database from "better-sqlite3";
import fs from "node:fs";

const dbPath = process.env.DB_PATH || "/home/ubuntu/data/lio23.db";
console.log("[Cleanup] Target DB:", dbPath);

// 1. Backup DB
const backupPath = `./db-backups/lio23.db.before-user-cleanup-${Date.now()}`;
if (!fs.existsSync("./db-backups")) {
  fs.mkdirSync("./db-backups", { recursive: true });
}
fs.copyFileSync(dbPath, backupPath);
console.log(`[Backup] Saved to ${backupPath}`);

const db = new Database(dbPath);

// 2. Identify users to KEEP
// Users to keep: Ludovic (admin), Simplo, Juluo, Sandrine, Stella, Aud (Audrey)
const keepUsernames = ["ludovic", "simplo", "juluo", "sandrine", "stella", "aud"];
const keepEmails = [
  "nludoviic@gmail.com",
  "nsimplo@icloud.com",
  "baptisteleloup08@gmail.com",
  "sandrine.ebede@yahoo.com",
  "stellaingride12@gmail.com",
  "sandrinen.thm@gmail.com",
];

const allUsers = db.prepare("SELECT id, email, username FROM users").all();
const keepUserIds = [];
const deleteUserIds = [];

for (const u of allUsers) {
  const usernameLower = (u.username || "").toLowerCase();
  const emailLower = (u.email || "").toLowerCase();

  const isKeep =
    keepUsernames.some((k) => usernameLower.includes(k)) ||
    keepEmails.some((e) => emailLower === e.toLowerCase());

  if (isKeep) {
    keepUserIds.push(u.id);
  } else {
    deleteUserIds.push(u.id);
  }
}

console.log(`[Cleanup] Keeping ${keepUserIds.length} users:`, keepUserIds);
console.log(`[Cleanup] Deleting ${deleteUserIds.length} users:`, deleteUserIds);

if (deleteUserIds.length === 0) {
  console.log("[Cleanup] No users to delete. Exiting.");
  process.exit(0);
}

// 3. Delete records for users to be purged
const placeholders = deleteUserIds.map(() => "?").join(",");

const tablesWithUserId = [
  "bot_state",
  "bot_trades",
  "user_config",
  "push_subscriptions",
  "user_notifications",
  "config_changes",
  "price_alerts",
  "user_audit_logs",
  "manual_orders",
  "safety_alerts",
  "stake_scaling_approvals",
];

db.transaction(() => {
  for (const table of tablesWithUserId) {
    try {
      const stmt = db.prepare(`DELETE FROM ${table} WHERE user_id IN (${placeholders})`);
      const res = stmt.run(...deleteUserIds);
      console.log(`[Cleanup] Table ${table}: deleted ${res.changes} rows`);
    } catch (e) {
      // Table might not exist or not have user_id column
    }
  }

  // Finally delete users
  const deleteUsersStmt = db.prepare(`DELETE FROM users WHERE id IN (${placeholders})`);
  const resUsers = deleteUsersStmt.run(...deleteUserIds);
  console.log(`[Cleanup] Table users: deleted ${resUsers.changes} rows`);
})();

const remainingUsers = db.prepare("SELECT id, email, username, status, is_admin FROM users").all();
console.log("[Cleanup] Remaining users in DB:", remainingUsers);
