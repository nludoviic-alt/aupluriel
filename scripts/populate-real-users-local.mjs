import Database from "better-sqlite3";

const localDbPath = "./lio23.db";
console.log("[Local Sync] Target DB:", localDbPath);

const db = new Database(localDbPath);

const REAL_USERS = [
  { id: 2, email: "nludoviic@gmail.com", username: "Ludovic", is_admin: 1, status: "approved" },
  { id: 3, email: "nsimplo@icloud.com", username: "Simplo", is_admin: 0, status: "approved" },
  { id: 4, email: "baptisteleloup08@gmail.com", username: "Juluo", is_admin: 0, status: "approved" },
  { id: 10, email: "sandrine.ebede@yahoo.com", username: "Sandrine", is_admin: 0, status: "approved" },
  { id: 11, email: "stellaingride12@gmail.com", username: "Stella", is_admin: 0, status: "approved" },
  { id: 12, email: "sandrinen.thm@gmail.com", username: "Aud", is_admin: 0, status: "approved" },
];

db.transaction(() => {
  // Clear users table and re-insert the 6 exact official users
  db.prepare("DELETE FROM users").run();

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, username, password_hash, email_verified, status, is_admin, created_at)
    VALUES (?, ?, ?, 'hash_placeholder', 1, ?, ?, unixepoch())
  `);

  for (const u of REAL_USERS) {
    insertUser.run(u.id, u.email, u.username, u.status, u.is_admin);
  }
})();

const remaining = db.prepare("SELECT id, email, username, status, is_admin FROM users").all();
console.log("[Local Sync] Remaining users in local DB:", remaining);
