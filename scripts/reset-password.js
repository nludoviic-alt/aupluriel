import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

// Usage: node scripts/reset-password.js <email> <newPassword> [dbPath]
const [, , email, newPassword, dbPath = "./lio23.db"] = process.argv;

if (!email || !newPassword) {
  console.error("Usage: node scripts/reset-password.js <email> <newPassword> [dbPath]");
  process.exit(1);
}

const db = new Database(dbPath);

async function reset() {
  const hash = await bcrypt.hash(newPassword, 10);
  const result = db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(hash, email);
  if (result.changes === 0) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  console.log(`Password reset for ${email}`);
}

reset();
