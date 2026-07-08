import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "lio23.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    UNIQUE NOT NULL,
      username    TEXT    UNIQUE NOT NULL,
      password_hash TEXT  NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      deriv_token   TEXT,
      account_type  TEXT    DEFAULT 'demo',
      ai_provider   TEXT    DEFAULT 'groq',
      ai_api_key    TEXT,
      risk_per_trade REAL   DEFAULT 2,
      max_drawdown  REAL    DEFAULT 5,
      default_stake_usd REAL DEFAULT 5
    );

    CREATE TABLE IF NOT EXISTS strategies (
      id             TEXT    PRIMARY KEY,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name           TEXT    NOT NULL,
      pair           TEXT    NOT NULL,
      indicator      TEXT    NOT NULL,
      buy_threshold  REAL    DEFAULT 30,
      sell_threshold REAL    DEFAULT 70,
      stop_loss      REAL    DEFAULT 2,
      take_profit    REAL    DEFAULT 4,
      enabled        INTEGER DEFAULT 1,
      created_at     INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id         TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT    NOT NULL,
      pair       TEXT    NOT NULL,
      condition  TEXT    NOT NULL,
      value      REAL    DEFAULT 0,
      enabled    INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS trades (
      id           TEXT    PRIMARY KEY,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time         INTEGER NOT NULL,
      symbol       TEXT    NOT NULL,
      direction    TEXT    NOT NULL,
      stake        REAL    NOT NULL,
      payout       REAL    DEFAULT 0,
      status       TEXT    NOT NULL,
      profit       REAL    DEFAULT 0,
      confidence   INTEGER DEFAULT 0,
      tf_agreement INTEGER DEFAULT 0,
      contract_id  INTEGER,
      closed_at    INTEGER,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS signal_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time       INTEGER NOT NULL,
      pair       TEXT    NOT NULL,
      direction  TEXT    NOT NULL,
      confidence INTEGER NOT NULL,
      tf         TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type       TEXT    NOT NULL,          -- 'verify' | 'reset'
      token      TEXT    UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL,
      used       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Server-side auto-trader: one row per user; the engine restores enabled
    -- bots at server boot so trading continues with the app/phone closed.
    CREATE TABLE IF NOT EXISTS bot_state (
      user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      enabled      INTEGER NOT NULL DEFAULT 0,
      config       TEXT    NOT NULL DEFAULT '{}',
      paused_until INTEGER,          -- epoch ms; risk pauses survive restarts
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Trades placed by the SERVER engine (the browser engine logs to localStorage).
    CREATE TABLE IF NOT EXISTS bot_trades (
      id               TEXT    PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time             INTEGER NOT NULL,  -- epoch ms
      symbol           TEXT    NOT NULL,
      direction        TEXT    NOT NULL,  -- CALL | PUT
      stake            REAL    NOT NULL,
      payout           REAL    NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL,  -- pending | open | won | lost | error | cooldown | risk-stop
      profit           REAL    NOT NULL DEFAULT 0,
      confidence       INTEGER NOT NULL DEFAULT 0,
      tf_agreement     INTEGER NOT NULL DEFAULT 0,
      contract_id      INTEGER,
      closed_at        INTEGER,
      note             TEXT,
      entry_price      REAL,
      duration_minutes INTEGER,
      expiry           INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_bot_trades_user_time ON bot_trades(user_id, time DESC);

    -- Apprentissage partagé : stats win/loss par (symbole, composant de signal),
    -- agrégées sur les trades réels de TOUS les utilisateurs. Le symbole
    -- '_global' sert de prior inter-symboles pour lisser les petits échantillons.
    CREATE TABLE IF NOT EXISTS indicator_stats (
      symbol     TEXT    NOT NULL,
      component  TEXT    NOT NULL,
      wins       INTEGER NOT NULL DEFAULT 0,
      losses     INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (symbol, component)
    );
  `);

  // --- Additive column migrations on `users` (idempotent) ---
  const userCols = new Set(
    (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!userCols.has("email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
  }
  if (!userCols.has("status")) {
    // 'pending' | 'approved' | 'rejected' — gates login until an admin approves.
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!userCols.has("is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }

  // --- Additive column migrations on `bot_trades` (idempotent) ---
  const botTradeCols = new Set(
    (db.prepare("PRAGMA table_info(bot_trades)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!botTradeCols.has("components")) {
    // JSON [{name, bias}] — the signal components that drove this trade,
    // credited/blamed against indicator_stats when the contract resolves.
    db.exec("ALTER TABLE bot_trades ADD COLUMN components TEXT");
  }

  // --- Additive column migrations on `user_settings` (idempotent) ---
  const settingsCols = new Set(
    (db.prepare("PRAGMA table_info(user_settings)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!settingsCols.has("default_stake_usd")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN default_stake_usd REAL DEFAULT 5");
  }

  // Promote the configured admin email if that account already exists.
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (adminEmail) {
    db.prepare(
      "UPDATE users SET is_admin = 1, status = 'approved', email_verified = 1 WHERE email = ?",
    ).run(adminEmail);
  }
}
