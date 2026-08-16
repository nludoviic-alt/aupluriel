import Database from "better-sqlite3";
import path from "path";
import bcrypt from "bcryptjs";

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), "lio23.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("cache_size = -65536");
  _db.pragma("temp_store = MEMORY");
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

    CREATE TABLE IF NOT EXISTS user_configs (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset     TEXT NOT NULL,
      config     TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, preset)
    );

    -- Explicit human-approved promotions only. Existing configurations are
    -- intentionally not backfilled: their present stake remains untouched.
    CREATE TABLE IF NOT EXISTS stake_scaling_approvals (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset TEXT NOT NULL,
      approved_tier REAL NOT NULL,
      config_hash TEXT NOT NULL,
      strategy_version TEXT,
      risk_version TEXT,
      execution_version TEXT,
      evidence_json TEXT NOT NULL,
      approved_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, preset)
    );

    -- Persistent per-(user,strategy) circuit breaker lifecycle for
    -- consecutive loss streaks (R5). bot_trades stays the factual outcome
    -- ledger; this table is the breaker's OWN state machine, reconciled
    -- against bot_trades on first read per process lifetime (see
    -- loss-streak-circuit-breaker.server.ts). Deliberately NOT reusing
    -- bot_state.paused_until: that column is the unrelated engine-level
    -- scan pause.
    CREATE TABLE IF NOT EXISTS loss_streak_state (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      strategy TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'NORMAL',
      loss_streak_count INTEGER NOT NULL DEFAULT 0,
      paused_at INTEGER,
      resume_at INTEGER,
      recovery_trades_used INTEGER NOT NULL DEFAULT 0,
      last_loss_at INTEGER,
      last_win_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      risk_version TEXT,
      PRIMARY KEY (user_id, strategy)
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

    CREATE TABLE IF NOT EXISTS user_notifications (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      body        TEXT NOT NULL,
      url         TEXT,
      category    TEXT DEFAULT 'system', -- 'trade' | 'risk' | 'system' | 'signal'
      is_read     INTEGER DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
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

    -- Admin-generated, per-recipient invite codes emailed to a prospective
    -- user. Independent of the legacy static INVITE_CODE env var (still
    -- honored in register.ts as a fallback master code).
    CREATE TABLE IF NOT EXISTS invite_codes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      code       TEXT    UNIQUE NOT NULL,
      email      TEXT    NOT NULL,          -- bound to one recipient; only that email may redeem it
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_at    INTEGER,
      revoked    INTEGER NOT NULL DEFAULT 0,
      expires_at INTEGER NOT NULL,          -- epoch ms
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Server-side auto-trader: one row per user; the engine restores enabled
    -- bots at server boot so trading continues with the app/phone closed.
    -- One row per (user, preset): a user can run Default/Boom/Crash as three
    -- independent engines simultaneously (added 2026-08-01 — see the
    -- table-recreation migration below for existing databases, which had a
    -- single row per user_id).
    CREATE TABLE IF NOT EXISTS bot_state (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset       TEXT    NOT NULL DEFAULT 'default', -- 'default' | 'boom' | 'crash'
      enabled      INTEGER NOT NULL DEFAULT 0,
      config       TEXT    NOT NULL DEFAULT '{}',
      paused_until INTEGER,          -- epoch ms; risk pauses survive restarts
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, preset)
    );

    -- One row per meaningful edit to a user's strategy (see
    -- CONFIG_CHANGE_FIELDS in bot-engine.server.ts) — lets an admin compare
    -- performance in the trades right before vs. right after a given change,
    -- instead of eyeballing whether a tweak "seemed to help".
    CREATE TABLE IF NOT EXISTS config_changes (
      id          TEXT    PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset      TEXT    NOT NULL,
      changed_at  INTEGER NOT NULL,   -- epoch ms
      changed_by  INTEGER,            -- admin user_id, NULL if the user (or the auto-rollback guardian) changed it
      fields      TEXT    NOT NULL,   -- JSON: { fieldName: { from, to } }
      trades_before INTEGER,
      win_rate_before REAL,
      pnl_before    REAL,
      source        TEXT    NOT NULL DEFAULT 'user',
      resolved_at   INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_config_changes_user_preset_time ON config_changes(user_id, preset, changed_at);

    -- Centralized & Versioned Strategy Registry (Phase 1 Quant Pillar)
    -- Every preset edit generates an immutable version row with semantic versioning
    -- (v1.0.0, v1.0.1) and a SHA-256 canonical hash of the full config JSON state.
    CREATE TABLE IF NOT EXISTS config_versions (
      id             TEXT    PRIMARY KEY,
      user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset         TEXT    NOT NULL,               -- 'default' | 'boom' | 'crash' | 'scalping'
      version_tag    TEXT    NOT NULL,               -- e.g. 'v1.0.0'
      version_hash   TEXT    NOT NULL,               -- SHA-256 hex string
      config_json    TEXT    NOT NULL,               -- Full JSON snapshot
      created_at     INTEGER NOT NULL,               -- epoch ms
      created_by     INTEGER,                        -- admin/user ID
      source         TEXT    NOT NULL DEFAULT 'user', -- 'user' | 'admin' | 'auto-tuner' | 'rollback'
      change_summary TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_config_versions_lookup ON config_versions(user_id, preset, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_config_versions_tag ON config_versions(user_id, preset, version_tag);

    -- Audit log for fine-grained parameter changes (Zero Silent Parameter Changes Rule)
    CREATE TABLE IF NOT EXISTS config_audit_events (
      id          TEXT    PRIMARY KEY,
      version_id  TEXT    NOT NULL REFERENCES config_versions(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset      TEXT    NOT NULL,
      field_name  TEXT    NOT NULL,                  -- e.g. 'stake', 'min_confidence', 'take_profit'
      old_value   TEXT,
      new_value   TEXT,
      timestamp   INTEGER NOT NULL,                  -- epoch ms
      source      TEXT    NOT NULL DEFAULT 'user',
      metadata    TEXT                               -- Optional JSON extra context
    );
    CREATE INDEX IF NOT EXISTS idx_config_audit_events_lookup ON config_audit_events(user_id, preset, timestamp DESC);

    -- Automated Daily / Weekly Performance Review Reports (Phase 4 Quant Pillar)
    CREATE TABLE IF NOT EXISTS performance_reviews (
      id            TEXT    PRIMARY KEY,
      period_type   TEXT    NOT NULL,               -- 'daily' | 'weekly'
      period_start  INTEGER NOT NULL,               -- epoch ms
      period_end    INTEGER NOT NULL,               -- epoch ms
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset        TEXT    NOT NULL,
      summary_json  TEXT    NOT NULL,               -- Full metrics JSON snapshot
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_perf_reviews_lookup ON performance_reviews(user_id, preset, period_type, period_start DESC);

    -- Big Data historical candles store for backtesting & machine learning sweeps
    CREATE TABLE IF NOT EXISTS historical_candles (
      symbol      TEXT    NOT NULL,
      granularity INTEGER NOT NULL,
      epoch       INTEGER NOT NULL,
      open        REAL    NOT NULL,
      high        REAL    NOT NULL,
      low         REAL    NOT NULL,
      close       REAL    NOT NULL,
      PRIMARY KEY (symbol, granularity, epoch)
    );
    CREATE INDEX IF NOT EXISTS idx_hist_candles_lookup ON historical_candles(symbol, granularity, epoch DESC);

    -- General per-user JSON config (Telegram settings, custom preferences)
    CREATE TABLE IF NOT EXISTS user_config (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      config      TEXT    NOT NULL DEFAULT '{}',
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Trades placed by the SERVER engine (the browser engine logs to localStorage).
    CREATE TABLE IF NOT EXISTS bot_trades (
      id               TEXT    PRIMARY KEY,
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      time             INTEGER NOT NULL,  -- epoch ms
      symbol           TEXT    NOT NULL,
      direction        TEXT    NOT NULL,  -- CALL | PUT | MULTUP | MULTDOWN
      stake            REAL    NOT NULL,
      payout           REAL    NOT NULL DEFAULT 0,
      status           TEXT    NOT NULL,  -- pending | open | won | lost | error | cooldown | risk-stop
      profit           REAL    NOT NULL DEFAULT 0,
      confidence       INTEGER NOT NULL DEFAULT 0,
      tf_agreement     INTEGER NOT NULL DEFAULT 0,
      contract_id      INTEGER,
      closed_at        INTEGER,
      note             TEXT,
      strategy         TEXT,
      entry_price      REAL,
      duration_minutes INTEGER,
      expiry           INTEGER,
      preset           TEXT,   -- 'default' | 'boom' | 'crash' | 'scalping' — set explicitly at insert (see upsertTrade in bot-engine.server.ts), never inferred from symbol (two presets can share a symbol, e.g. Scalping trading BOOM500 alongside Boom itself — 2026-08-02)
      risk_version     TEXT    DEFAULT 'R4',
      execution_version TEXT   DEFAULT 'E2'
    );
    CREATE INDEX IF NOT EXISTS idx_bot_trades_user_time ON bot_trades(user_id, time DESC);

    -- Composite index covering the per-preset stats queries that filter on
    -- (user_id, preset, time) — getTodayStats and the admin recap. Without it,
    -- SQLite scans all of a user's trades to find today's preset subset.
    CREATE INDEX IF NOT EXISTS idx_bot_trades_user_preset_time ON bot_trades(user_id, preset, time DESC);

    -- For getRecentPerformance which orders by closed_at DESC.
    CREATE INDEX IF NOT EXISTS idx_bot_trades_user_preset_closed ON bot_trades(user_id, preset, closed_at DESC);

    -- Rejected specialist signals are first-class research data: a zero-trade
    -- day must explain which Vol75 filter blocked the setup.
    CREATE TABLE IF NOT EXISTS signal_rejections (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset TEXT NOT NULL, symbol TEXT NOT NULL, time INTEGER NOT NULL,
      score INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL, diagnostics TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_signal_rejections_preset_time ON signal_rejections(user_id, preset, time DESC);

    CREATE TABLE IF NOT EXISTS rb100_diagnostic_snapshots (
      id TEXT PRIMARY KEY,
      time INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      market_state TEXT NOT NULL,
      raw_score INTEGER NOT NULL,
      final_score INTEGER NOT NULL,
      required_score INTEGER NOT NULL,
      hard_filters_passed INTEGER NOT NULL,
      primary_reason TEXT NOT NULL,
      no_trade_final_reason TEXT NOT NULL,
      snapshot TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rb100_snapshots_strategy_time ON rb100_diagnostic_snapshots(strategy, time DESC);

    -- SQLite persistence for RB100 Breakout Memory (Stateful Retest Window)
    CREATE TABLE IF NOT EXISTS rb100_active_breakouts (
      symbol TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      breakout_level REAL NOT NULL,
      breakout_time INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      strategy_version TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      retest_status TEXT NOT NULL,
      snapshot TEXT
    );

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

    -- Single-row cache of the periodic auto-backtest verdict (see
    -- auto-backtest.server.ts). The strategy config the server bot trades
    -- with is identical for every user (DEFAULT_CONFIG, locked), so the
    -- backtest itself only needs to run once globally every 6h; each
    -- opted-in user's bot is then started/stopped against this shared
    -- verdict on a faster sweep.
    CREATE TABLE IF NOT EXISTS auto_backtest_state (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      favorable           INTEGER NOT NULL DEFAULT 0,
      win_rate            REAL,
      break_even_win_rate REAL,
      checked_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Independent verdict for the demo-only liquidity reversal experiment.
    -- Keeping this separate prevents a favorable Multi replay from ever
    -- starting the experimental XAU/USD/Nasdaq engine (or the reverse).
    CREATE TABLE IF NOT EXISTS auto_liquidity_backtest_state (
      id                  INTEGER PRIMARY KEY CHECK (id = 1),
      favorable           INTEGER NOT NULL DEFAULT 0,
      win_rate            REAL,
      break_even_win_rate REAL,
      checked_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Web Push subscriptions — one row per browser/device a user opted in
    -- from (a phone and a laptop are two rows). endpoint is the push
    -- service's unique URL for that subscription, so it doubles as the
    -- natural primary key; p256dh/auth are the encryption keys Web Push
    -- requires to encrypt the payload for that specific subscription.
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint   TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      p256dh     TEXT    NOT NULL,
      auth       TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

    -- Admin-facing bug/changelog tracker: one durable record of what was
    -- found, fixed, and improved, so a recurring issue (or "didn't we
    -- already look at this?") has a place to check instead of re-litigating
    -- it from memory every time. Seeded once from real project history.
    CREATE TABLE IF NOT EXISTS changelog_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT    NOT NULL,               -- 'fix' | 'improvement' | 'watch'
      title       TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'resolved', -- 'open' | 'monitoring' | 'resolved'
      created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_changelog_created ON changelog_entries(created_at DESC);

    -- Feature health monitor (see health-monitor.server.ts): one row per
    -- check, overwritten every cycle. checked_at lets the admin panel show
    -- staleness; the scheduler diffs against the previous status row to
    -- decide whether a check just transitioned (and is worth a push alert).
    CREATE TABLE IF NOT EXISTS health_status (
      check_key  TEXT    PRIMARY KEY,
      label      TEXT    NOT NULL,
      status     TEXT    NOT NULL,             -- 'ok' | 'warn' | 'error'
      detail     TEXT    NOT NULL DEFAULT '',
      checked_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    -- Personal free-text notes — one per user, replaces the Risk Calculator
    -- page. Server-side (not localStorage) so notes survive a device switch.
    CREATE TABLE IF NOT EXISTS user_notes (
      user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      content    TEXT    NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title      TEXT    NOT NULL,
      content    TEXT    NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS chat_groups (
      id           TEXT    PRIMARY KEY,
      name         TEXT    NOT NULL,
      created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      is_direct    INTEGER NOT NULL DEFAULT 0,
      recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id         TEXT    PRIMARY KEY,
      group_id   TEXT    NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content    TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS chat_group_members (
      group_id   TEXT    REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (group_id, user_id)
    );

    -- One reaction per (message, user) — picking a new emoji replaces the
    -- previous one, same as WhatsApp/iMessage rather than stacking many.
    CREATE TABLE IF NOT EXISTS chat_message_reactions (
      message_id TEXT    NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji      TEXT    NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (message_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_group_created ON chat_messages(group_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_reactions_message ON chat_message_reactions(message_id);
    CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON chat_group_members(user_id);
  `);

  // --- Migrate bot_state from single-row-per-user to composite (user_id,
  // preset) key (2026-08-01) — lets Default/Boom/Crash run as three
  // independent engines per user instead of one preset at a time. Table
  // recreation (not an additive ALTER) because the primary key itself
  // changes; SQLite can't alter a PK in place. Idempotent: only runs once,
  // detected by the absence of a `preset` column.
  const botStateCols = new Set(
    (db.prepare("PRAGMA table_info(bot_state)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!botStateCols.has("preset")) {
    // Same symbol lists as BOOM_SYMBOLS/CRASH_SYMBOLS in autotrader.ts,
    // inlined to keep this one-time migration self-contained (not dependent
    // on those constants ever changing shape).
    const BOOM_SYMS = ["BOOM1000", "BOOM500", "BOOM600", "BOOM900"];
    const CRASH_SYMS = ["CRASH1000", "CRASH500", "CRASH600", "CRASH900"];
    const detectPreset = (configJson: string): "boom" | "crash" | "default" => {
      try {
        const cfg = JSON.parse(configJson) as { symbolMode?: string; symbols?: string[] };
        const matches = (syms: string[]) =>
          cfg.symbolMode === "watchlist" &&
          Array.isArray(cfg.symbols) &&
          cfg.symbols.length === syms.length &&
          syms.every((s) => cfg.symbols!.includes(s));
        if (matches(BOOM_SYMS)) return "boom";
        if (matches(CRASH_SYMS)) return "crash";
      } catch {
        /* malformed config — falls through to default */
      }
      return "default";
    };
    const oldRows = db
      .prepare("SELECT user_id, enabled, config, paused_until, updated_at FROM bot_state")
      .all() as {
      user_id: number;
      enabled: number;
      config: string;
      paused_until: number | null;
      updated_at: number;
    }[];
    db.exec("ALTER TABLE bot_state RENAME TO bot_state_old_20260801");
    db.exec(`
      CREATE TABLE bot_state (
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        preset       TEXT    NOT NULL DEFAULT 'default',
        enabled      INTEGER NOT NULL DEFAULT 0,
        config       TEXT    NOT NULL DEFAULT '{}',
        paused_until INTEGER,
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (user_id, preset)
      )
    `);
    const insertMigrated = db.prepare(
      "INSERT INTO bot_state (user_id, preset, enabled, config, paused_until, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const migrateAll = db.transaction((rows: typeof oldRows) => {
      for (const row of rows) {
        insertMigrated.run(
          row.user_id,
          detectPreset(row.config),
          row.enabled,
          row.config,
          row.paused_until,
          row.updated_at,
        );
      }
    });
    migrateAll(oldRows);
    db.exec("DROP TABLE bot_state_old_20260801");
  }

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
  if (!userCols.has("chat_enabled")) {
    db.exec("ALTER TABLE users ADD COLUMN chat_enabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!userCols.has("avatar")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
  }
  if (!userCols.has("online_status")) {
    // 'online' | 'offline' — admin manual override.
    db.exec("ALTER TABLE users ADD COLUMN online_status TEXT NOT NULL DEFAULT 'online'");
  }
  if (!userCols.has("admin_note")) {
    // Free-text note an admin can leave on a user's profile (typo history, VIP status, etc.) — never shown to the user themselves.
    db.exec("ALTER TABLE users ADD COLUMN admin_note TEXT");
  }
  if (!userCols.has("visible_presets")) {
    // JSON array of preset keys shown in the Auto-Trader's MOBILE tab strip
    // (2026-08-02). Purely a display filter: hiding a preset never stops its
    // engine, and desktop always shows all four regardless. NULL = no choice
    // made yet, which VISIBLE_PRESETS_DEFAULT below resolves.
    db.exec("ALTER TABLE users ADD COLUMN visible_presets TEXT");
  }

  // --- Additive column migrations on `notes` (idempotent) ---
  const notesCols = new Set(
    (db.prepare("PRAGMA table_info(notes)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!notesCols.has("tag")) {
    db.exec("ALTER TABLE notes ADD COLUMN tag TEXT");
  }

  // --- Additive column migrations on `bot_trades` (Architecture V3 - 2026-08-12) ---
  const botTradeCols = new Set(
    (db.prepare("PRAGMA table_info(bot_trades)").all() as { name: string }[]).map((c) => c.name),
  );
  const scalingApprovalCols = new Set(
    (db.prepare("PRAGMA table_info(stake_scaling_approvals)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!scalingApprovalCols.has("strategy_version"))
    db.exec("ALTER TABLE stake_scaling_approvals ADD COLUMN strategy_version TEXT");
  if (!scalingApprovalCols.has("risk_version"))
    db.exec("ALTER TABLE stake_scaling_approvals ADD COLUMN risk_version TEXT");
  if (!scalingApprovalCols.has("execution_version"))
    db.exec("ALTER TABLE stake_scaling_approvals ADD COLUMN execution_version TEXT");
  if (!botTradeCols.has("strategy_version"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN strategy_version TEXT NOT NULL DEFAULT 'V1'");
  if (!botTradeCols.has("market_type"))
    db.exec(
      "ALTER TABLE bot_trades ADD COLUMN market_type TEXT NOT NULL DEFAULT 'DERIV_SYNTHETIC'",
    );
  if (!botTradeCols.has("execution_mode"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'LIVE'");
  if (!botTradeCols.has("r_multiple")) db.exec("ALTER TABLE bot_trades ADD COLUMN r_multiple REAL");
  if (!botTradeCols.has("mae")) db.exec("ALTER TABLE bot_trades ADD COLUMN mae REAL");
  if (!botTradeCols.has("mfe")) db.exec("ALTER TABLE bot_trades ADD COLUMN mfe REAL");
  if (!botTradeCols.has("time_filter_status"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN time_filter_status TEXT");
  if (!botTradeCols.has("risk_manager_status"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN risk_manager_status TEXT");
  if (!botTradeCols.has("execution_status"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN execution_status TEXT");
  if (!botTradeCols.has("setup_id")) db.exec("ALTER TABLE bot_trades ADD COLUMN setup_id TEXT");
  if (!botTradeCols.has("config_snapshot"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN config_snapshot TEXT");
  if (!botTradeCols.has("indicator_values"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN indicator_values TEXT");
  if (!botTradeCols.has("time_filter_decision"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN time_filter_decision TEXT");
  if (!botTradeCols.has("risk_manager_decision"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN risk_manager_decision TEXT");
  if (!botTradeCols.has("risk_version"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN risk_version TEXT NOT NULL DEFAULT 'R4'");
  if (!botTradeCols.has("execution_version"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN execution_version TEXT NOT NULL DEFAULT 'E2'");
  if (!botTradeCols.has("requested_stake"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN requested_stake REAL");
  if (!botTradeCols.has("max_risk_allowed"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN max_risk_allowed REAL");
  if (!botTradeCols.has("deriv_max_allowed"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN deriv_max_allowed REAL");
  if (!botTradeCols.has("final_stake"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN final_stake REAL");
  if (!botTradeCols.has("stake_percent"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN stake_percent REAL");
  if (!botTradeCols.has("stake_mode")) db.exec("ALTER TABLE bot_trades ADD COLUMN stake_mode TEXT");
  if (!botTradeCols.has("effective_risk_pct"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN effective_risk_pct REAL");
  if (!botTradeCols.has("consecutive_losses"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN consecutive_losses INTEGER");
  if (!botTradeCols.has("risk_decision"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN risk_decision TEXT");
  if (!botTradeCols.has("config_hash"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN config_hash TEXT");
  if (!botTradeCols.has("risk_stop_reason"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN risk_stop_reason TEXT");
  if (!botTradeCols.has("daily_drawdown"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN daily_drawdown REAL");
  if (!botTradeCols.has("current_exposure"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN current_exposure REAL");
  // 2026-08-13 stake sizing audit trail — reconstructs the full
  // requestedStake -> strategyRiskSuggestedStake -> maxRiskAllowed ->
  // derivMaxAllowed -> finalStake chain per trade (max_risk_allowed already
  // exists above and serves as risk_manager_cap).
  if (!botTradeCols.has("strategy_suggested_stake"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN strategy_suggested_stake REAL");
  if (!botTradeCols.has("stake_source"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN stake_source TEXT");

  // 2026-08-13 exit-mechanism observability (Zero Tweak — additive only, no
  // trading decision reads any of these columns). Real exit_reason set by
  // the engine at the moment of closing (never reconstructed later from
  // P&L) — see finalize() in trackMultiplierPosition/trackContract/
  // trackOandaPosition. Values: TAKE_PROFIT, STOP_LOSS, MAX_HOLD_TIMEOUT,
  // MANUAL_EXIT, BROKER_EXIT, ERROR_EXIT, OTHER — PARTIAL_TAKE_PROFIT and
  // BREAKEVEN are deliberately never written for Deriv multiplier trades:
  // partialTakeProfitPct/moveSlToBreakeven are configured but not executed
  // by the engine there (see partial_tp_mechanism_active/
  // breakeven_mechanism_active below).
  // NOTE: `exit_reason` already existed as an unwired column (always NULL,
  // added before this session) — reused here rather than duplicated.
  if (!botTradeCols.has("entry_time"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN entry_time INTEGER");
  if (!botTradeCols.has("exit_time"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN exit_time INTEGER");
  if (!botTradeCols.has("hold_duration_seconds"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN hold_duration_seconds REAL");
  if (!botTradeCols.has("configured_max_hold_seconds"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN configured_max_hold_seconds REAL");

  // Continuous MFE/MAE (Position Monitor updates these while the trade is
  // open; final values frozen at close).
  if (!botTradeCols.has("mfe_usd")) db.exec("ALTER TABLE bot_trades ADD COLUMN mfe_usd REAL");
  if (!botTradeCols.has("mfe_r")) db.exec("ALTER TABLE bot_trades ADD COLUMN mfe_r REAL");
  if (!botTradeCols.has("mae_usd")) db.exec("ALTER TABLE bot_trades ADD COLUMN mae_usd REAL");
  if (!botTradeCols.has("mae_r")) db.exec("ALTER TABLE bot_trades ADD COLUMN mae_r REAL");
  if (!botTradeCols.has("peak_unrealized_profit"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN peak_unrealized_profit REAL");
  if (!botTradeCols.has("worst_unrealized_loss"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN worst_unrealized_loss REAL");
  if (!botTradeCols.has("profit_given_back"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN profit_given_back REAL");

  // MAX_HOLD_TIMEOUT-specific
  if (!botTradeCols.has("profit_at_timeout"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN profit_at_timeout REAL");
  if (!botTradeCols.has("r_at_timeout"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN r_at_timeout REAL");
  if (!botTradeCols.has("mfe_before_timeout"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN mfe_before_timeout REAL");
  if (!botTradeCols.has("mae_before_timeout"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN mae_before_timeout REAL");
  if (!botTradeCols.has("distance_to_tp_at_exit"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN distance_to_tp_at_exit REAL");
  if (!botTradeCols.has("distance_to_sl_at_exit"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN distance_to_sl_at_exit REAL");

  // TAKE_PROFIT-specific
  if (!botTradeCols.has("time_to_tp_seconds"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN time_to_tp_seconds REAL");
  if (!botTradeCols.has("mfe_before_tp"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN mfe_before_tp REAL");
  if (!botTradeCols.has("mae_before_tp"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN mae_before_tp REAL");
  if (!botTradeCols.has("max_progress_toward_tp_pct"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN max_progress_toward_tp_pct REAL");

  // STOP_LOSS-specific
  if (!botTradeCols.has("time_to_sl_seconds"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN time_to_sl_seconds REAL");
  if (!botTradeCols.has("mfe_before_sl"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN mfe_before_sl REAL");
  if (!botTradeCols.has("mae_before_sl"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN mae_before_sl REAL");
  if (!botTradeCols.has("was_profitable_before_sl"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN was_profitable_before_sl INTEGER");
  if (!botTradeCols.has("max_profit_before_sl"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN max_profit_before_sl REAL");

  // Dead-mechanism documentation (2026-08-13 discovery: partialTakeProfitPct
  // and moveSlToBreakeven are configured on every Deriv multiplier preset
  // but never executed by trackMultiplierPosition — Deriv's multiplier API
  // has no partial-sell endpoint, and moveSlToBreakeven has zero readers
  // anywhere in bot-engine.server.ts). *_configured reflects what the saved
  // config says; *_mechanism_active reflects what the engine actually did —
  // FALSE here means "does not exist in execution", not "never triggered".
  if (!botTradeCols.has("partial_tp_configured"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN partial_tp_configured INTEGER");
  if (!botTradeCols.has("partial_tp_mechanism_active"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN partial_tp_mechanism_active INTEGER");
  if (!botTradeCols.has("breakeven_configured"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN breakeven_configured INTEGER");
  if (!botTradeCols.has("breakeven_mechanism_active"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN breakeven_mechanism_active INTEGER");
  if (!botTradeCols.has("execution_capabilities"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN execution_capabilities TEXT");

  // Legacy-data marker (point 13/14 of the 2026-08-13 audit): trades placed
  // before this instrumentation existed must never be used to prove an
  // exit-mechanism effect — they lack config_snapshot/exit_reason ground
  // truth entirely. LEGACY_INCOMPLETE = 1 lets every future query exclude
  // them explicitly instead of silently mixing eras.
  if (!botTradeCols.has("data_quality"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN data_quality TEXT");

  // Shadow post-exit market observation (analytical only — never feeds back
  // into live trading). Populated for MAX_HOLD_TIMEOUT exits by 4 deferred
  // setTimeout checks; shadow_capture_status tracks partial progress across
  // a server restart (see restoreShadowObservations in bot-engine.server.ts).
  if (!botTradeCols.has("post_exit_price_5m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN post_exit_price_5m REAL");
  if (!botTradeCols.has("post_exit_price_10m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN post_exit_price_10m REAL");
  if (!botTradeCols.has("post_exit_price_20m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN post_exit_price_20m REAL");
  if (!botTradeCols.has("post_exit_price_30m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN post_exit_price_30m REAL");
  if (!botTradeCols.has("hypothetical_pnl_5m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN hypothetical_pnl_5m REAL");
  if (!botTradeCols.has("hypothetical_pnl_10m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN hypothetical_pnl_10m REAL");
  if (!botTradeCols.has("hypothetical_pnl_20m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN hypothetical_pnl_20m REAL");
  if (!botTradeCols.has("hypothetical_pnl_30m"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN hypothetical_pnl_30m REAL");
  if (!botTradeCols.has("shadow_capture_status"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN shadow_capture_status TEXT");
  if (!botTradeCols.has("risk_observation"))
    db.exec("ALTER TABLE bot_trades ADD COLUMN risk_observation TEXT");

  db.exec(`
    -- Deliberately no FK on user_id: this table must never silently drop an
    -- alert. Some callers log system-wide alerts with a synthetic id (e.g.
    -- checkVersioningIntegrity uses userId 0 for "system"/"GLOBAL"), and a
    -- strict FK + logSafetyAlert's own try/catch combined to silently
    -- swallow every such insert (found 2026-08-13: caught by
    -- r4-e2-audit.test.ts's "Safety alert logger" test failing with no
    -- inserted row, root-caused to a FOREIGN KEY constraint failure).
    CREATE TABLE IF NOT EXISTS safety_alerts (
      id TEXT PRIMARY KEY,
      time INTEGER NOT NULL,
      alert_type TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      preset TEXT NOT NULL,
      symbol TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_safety_alerts_lookup ON safety_alerts(time DESC, alert_type);
  `);

  // One-time rebuild for DBs where safety_alerts was already created with the
  // old strict FK (2026-08-13 same-day fix — see comment above).
  const safetyAlertsFk = db.prepare("PRAGMA foreign_key_list(safety_alerts)").all() as unknown[];
  if (safetyAlertsFk.length > 0) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE safety_alerts_new (
          id TEXT PRIMARY KEY,
          time INTEGER NOT NULL,
          alert_type TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          preset TEXT NOT NULL,
          symbol TEXT NOT NULL,
          details TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        INSERT INTO safety_alerts_new SELECT id, time, alert_type, user_id, preset, symbol, details, created_at FROM safety_alerts;
        DROP TABLE safety_alerts;
        ALTER TABLE safety_alerts_new RENAME TO safety_alerts;
        CREATE INDEX IF NOT EXISTS idx_safety_alerts_lookup ON safety_alerts(time DESC, alert_type);
      `);
    })();
  }

  // Migration de rattrapage : s'assurer que les trades existants sans version sont rattachés à 'V1' pour le time filter
  db.exec(
    "UPDATE bot_trades SET strategy_version = 'V1' WHERE strategy_version = 'LEGACY' OR strategy_version IS NULL",
  );

  // 2026-08-13 exit-mechanism observability: mark every already-CLOSED trade
  // predating this instrumentation as LEGACY_INCOMPLETE — it has no
  // ground-truth exit_reason/config_snapshot/MFE-MAE and must never be used
  // to prove a maxHoldMinutes/partial-TP/breakeven effect (still fine for
  // P&L/WR/PF). Scoped to won/lost only so a still-OPEN position isn't
  // pre-emptively tainted before it gets a real chance to close instrumented.
  db.exec(
    "UPDATE bot_trades SET data_quality = 'LEGACY_INCOMPLETE' WHERE data_quality IS NULL AND status IN ('won', 'lost')",
  );

  // Nettoyer les valeurs historiques NULL/vides sur strategy et strategy_version pour éviter les erreurs de stats et de health.
  db.exec(`
    UPDATE bot_trades
    SET strategy = COALESCE(NULLIF(trim(strategy), ''), NULLIF(trim(preset), ''), 'UNKNOWN'),
        strategy_version = COALESCE(NULLIF(trim(strategy_version), ''), 'V1')
    WHERE strategy IS NULL
       OR trim(COALESCE(strategy, '')) = ''
       OR strategy_version IS NULL
       OR trim(COALESCE(strategy_version, '')) = '';
  `);

  // --- New Tables for Architecture V3 (Shadow Mode, Hourly Stats, Signal Funnel) ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS shadow_trades (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      preset TEXT NOT NULL,
      strategy TEXT NOT NULL,
      strategy_version TEXT NOT NULL DEFAULT 'V1',
      symbol TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price REAL NOT NULL,
      stop_loss REAL,
      take_profit REAL,
      virtual_exit_price REAL,
      virtual_pnl REAL NOT NULL DEFAULT 0,
      r_multiple REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      score INTEGER NOT NULL DEFAULT 0,
      time INTEGER NOT NULL,
      closed_at INTEGER,
      exit_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_shadow_trades_query ON shadow_trades(symbol, strategy, strategy_version, time DESC);

    -- Performance Drift & Auto-Shadow Tracking (P1 Quant Pillar)
    CREATE TABLE IF NOT EXISTS strategy_performance_drift (
      strategy TEXT NOT NULL,
      strategy_version TEXT NOT NULL DEFAULT 'V1',
      symbol TEXT NOT NULL,
      drift_status TEXT NOT NULL DEFAULT 'NONE',
      risk_state TEXT NOT NULL DEFAULT 'NORMAL',
      risk_multiplier REAL NOT NULL DEFAULT 1.0,
      last_30_json TEXT,
      last_50_json TEXT,
      last_100_json TEXT,
      historical_json TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (strategy, strategy_version, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_perf_drift_lookup ON strategy_performance_drift(strategy, strategy_version, symbol);

    CREATE TABLE IF NOT EXISTS hourly_performance_stats (
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      hour_utc INTEGER NOT NULL,
      trades INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      win_rate REAL NOT NULL DEFAULT 0,
      gross_profit REAL NOT NULL DEFAULT 0,
      gross_loss REAL NOT NULL DEFAULT 0,
      net_pnl REAL NOT NULL DEFAULT 0,
      profit_factor REAL NOT NULL DEFAULT 0,
      expectancy_r REAL NOT NULL DEFAULT 0,
      average_r REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (symbol, strategy, strategy_version, hour_utc)
    );

    CREATE TABLE IF NOT EXISTS signal_funnel_stats (
      date_utc TEXT NOT NULL,
      preset TEXT NOT NULL,
      strategy TEXT NOT NULL,
      scans INTEGER NOT NULL DEFAULT 0,
      setups INTEGER NOT NULL DEFAULT 0,
      valid_signals INTEGER NOT NULL DEFAULT 0,
      time_approved INTEGER NOT NULL DEFAULT 0,
      risk_approved INTEGER NOT NULL DEFAULT 0,
      proposal_valid INTEGER NOT NULL DEFAULT 0,
      executed_trades INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (date_utc, preset, strategy)
    );
  `);
  // Shadow observations created when a valid signal is blocked by a safety
  // control. These fields are analytics-only: no execution or risk decision
  // reads them.
  const shadowTradeCols = new Set(
    (db.prepare("PRAGMA table_info(shadow_trades)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!shadowTradeCols.has("block_reason"))
    db.exec("ALTER TABLE shadow_trades ADD COLUMN block_reason TEXT");
  if (!shadowTradeCols.has("evaluation_at"))
    db.exec("ALTER TABLE shadow_trades ADD COLUMN evaluation_at INTEGER");
  if (!shadowTradeCols.has("notional_stake"))
    db.exec("ALTER TABLE shadow_trades ADD COLUMN notional_stake REAL");
  if (!shadowTradeCols.has("risk_observation"))
    db.exec("ALTER TABLE shadow_trades ADD COLUMN risk_observation TEXT");
  if (!shadowTradeCols.has("shadow_mae"))
    db.exec("ALTER TABLE shadow_trades ADD COLUMN shadow_mae REAL NOT NULL DEFAULT 0");
  if (!shadowTradeCols.has("shadow_mfe"))
    db.exec("ALTER TABLE shadow_trades ADD COLUMN shadow_mfe REAL NOT NULL DEFAULT 0");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_shadow_trades_pending ON shadow_trades(status, evaluation_at)",
  );

  // --- Additive column migrations on `alerts` (idempotent) ---
  // The API/table existed but was never wired to the UI (alerts.tsx and
  // use-price-alerts.ts both ran on localStorage instead) — now that alerts
  // are checked server-side (price-alerts.server.ts) so they push even with
  // the app closed, these two columns are what that scheduler needs.
  const alertCols = new Set(
    (db.prepare("PRAGMA table_info(alerts)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!alertCols.has("symbol")) {
    db.exec("ALTER TABLE alerts ADD COLUMN symbol TEXT"); // deriv symbol code, 'price' alerts only
  }
  if (!alertCols.has("last_fired_at")) {
    db.exec("ALTER TABLE alerts ADD COLUMN last_fired_at INTEGER");
  }

  // --- Additive column migrations on `config_changes` (idempotent) ---
  // Added for config-rollback-guardian.server.ts: `source` distinguishes a
  // human edit from an automatic revert (so the revert doesn't itself look
  // like a fresh user change worth re-judging), `resolved_at` marks a change
  // the guardian has already judged (reverted OR confirmed fine) so it's
  // never re-evaluated forever.
  const configChangeCols = new Set(
    (db.prepare("PRAGMA table_info(config_changes)").all() as { name: string }[]).map(
      (c) => c.name,
    ),
  );
  if (!configChangeCols.has("source")) {
    db.exec("ALTER TABLE config_changes ADD COLUMN source TEXT NOT NULL DEFAULT 'user'"); // 'user' | 'admin' | 'auto-rollback'
  }
  if (!configChangeCols.has("resolved_at")) {
    db.exec("ALTER TABLE config_changes ADD COLUMN resolved_at INTEGER");
  }

  // --- Additive column migrations on `bot_trades` (idempotent) ---
  if (!botTradeCols.has("components")) {
    // JSON [{name, bias}] — the signal components that drove this trade,
    // credited/blamed against indicator_stats when the contract resolves.
    db.exec("ALTER TABLE bot_trades ADD COLUMN components TEXT");
  }
  if (!botTradeCols.has("estimated_max_loss")) {
    db.exec("ALTER TABLE bot_trades ADD COLUMN estimated_max_loss REAL");
  }
  if (!botTradeCols.has("risk_pct_of_equity")) {
    db.exec("ALTER TABLE bot_trades ADD COLUMN risk_pct_of_equity REAL");
  }
  if (!botTradeCols.has("stake_scaling_tier")) {
    db.exec("ALTER TABLE bot_trades ADD COLUMN stake_scaling_tier REAL");
  }
  if (!botTradeCols.has("stake_scaling_reason")) {
    db.exec("ALTER TABLE bot_trades ADD COLUMN stake_scaling_reason TEXT");
  }
  if (!botTradeCols.has("multiplier")) {
    // Multiplier (MULTUP/MULTDOWN) trades only — leverage level and the
    // stop-loss/take-profit levels that auto-close the position.
    db.exec("ALTER TABLE bot_trades ADD COLUMN multiplier INTEGER");
    db.exec("ALTER TABLE bot_trades ADD COLUMN stop_loss REAL");
    db.exec("ALTER TABLE bot_trades ADD COLUMN take_profit REAL");
  }
  if (!botTradeCols.has("mode")) {
    // 'demo' | 'live' — which Deriv account the trade ran on. Without this,
    // today/all-time stats summed demo test trades and real money together;
    // NULL on rows written before this migration (filtered as a wildcard, see
    // getTodayStats/getAllTimeStats) so old history doesn't just vanish.
    db.exec("ALTER TABLE bot_trades ADD COLUMN mode TEXT");
  }
  if (!botTradeCols.has("preset")) {
    // Explicit preset attribution (see bot_trades CREATE TABLE comment above)
    // — added 2026-08-02 when Scalping was introduced trading BOOM500
    // alongside Boom itself, which broke the old symbol→preset inference
    // (two presets, one symbol). One-time backfill below classifies every
    // pre-existing row the same way the old inference did, so historical
    // reports don't shift under anyone; every row written from now on gets
    // its preset explicitly at insert time (upsertTrade) and is never
    // reclassified.
    db.exec("ALTER TABLE bot_trades ADD COLUMN preset TEXT");
    const BOOM_SYMS_BACKFILL = ["BOOM1000", "BOOM500", "BOOM600", "BOOM900"];
    const CRASH_SYMS_BACKFILL = ["CRASH1000", "CRASH500", "CRASH600", "CRASH900"];
    db.prepare(
      `
      UPDATE bot_trades SET preset = CASE
        WHEN symbol IN (${BOOM_SYMS_BACKFILL.map(() => "?").join(",")}) THEN 'boom'
        WHEN symbol IN (${CRASH_SYMS_BACKFILL.map(() => "?").join(",")}) THEN 'crash'
        ELSE 'default'
      END
      WHERE preset IS NULL
    `,
    ).run(...BOOM_SYMS_BACKFILL, ...CRASH_SYMS_BACKFILL);
  }
  if (!botTradeCols.has("strategy")) {
    db.exec("ALTER TABLE bot_trades ADD COLUMN strategy TEXT");
  }
  if (!botTradeCols.has("exit_reason")) {
    db.exec("ALTER TABLE bot_trades ADD COLUMN exit_reason TEXT");
  }

  // --- Repair legacy bot-state symbol lists (idempotent) ---
  // A few early preset saves serialized `symbols` as strings such as
  // "[frxXAUUSD]" instead of string[]. That shape bypasses UI validation and
  // makes a saved watchlist fall back to DEFAULT_CONFIG at engine startup.
  // Normalize only those malformed rows; every other saved field is preserved.
  const savedBotConfigs = db.prepare("SELECT user_id, preset, config FROM bot_state").all() as {
    user_id: number;
    preset: string;
    config: string;
  }[];
  const writeRepairedBotConfig = db.prepare(
    "UPDATE bot_state SET config = ?, updated_at = unixepoch() WHERE user_id = ? AND preset = ?",
  );
  for (const row of savedBotConfigs) {
    try {
      const config = JSON.parse(row.config) as { symbols?: unknown } & Record<string, unknown>;
      if (Array.isArray(config.symbols) || typeof config.symbols !== "string") continue;
      const raw = config.symbols.trim();
      let symbols: string[] | null = null;
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.every((symbol) => typeof symbol === "string"))
          symbols = parsed;
      } catch {
        /* Legacy format without JSON quotes: [frxXAUUSD]. */
      }
      if (!symbols && raw.startsWith("[") && raw.endsWith("]")) {
        symbols = raw
          .slice(1, -1)
          .split(",")
          .map((symbol) => symbol.trim())
          .filter(Boolean);
      }
      if (symbols) {
        config.symbols = symbols;
        writeRepairedBotConfig.run(JSON.stringify(config), row.user_id, row.preset);
      }
    } catch {
      /* Invalid JSON is handled safely by loadBotConfig. */
    }
  }

  // --- Additive column migrations on `user_settings` (idempotent) ---
  const settingsCols = new Set(
    (db.prepare("PRAGMA table_info(user_settings)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!settingsCols.has("default_stake_usd")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN default_stake_usd REAL DEFAULT 5");
  }
  if (!settingsCols.has("auto_backtest_enabled")) {
    // When set, the demo-mode server bot is auto-started/stopped by the
    // periodic auto-backtest verdict instead of purely manual control —
    // never applies to a "live" mode bot (see auto-backtest.server.ts).
    db.exec(
      "ALTER TABLE user_settings ADD COLUMN auto_backtest_enabled INTEGER NOT NULL DEFAULT 0",
    );
  }
  if (!settingsCols.has("kraken_api_key")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN kraken_api_key TEXT");
  }
  if (!settingsCols.has("kraken_api_secret")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN kraken_api_secret TEXT");
  }
  if (!settingsCols.has("binance_api_key")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN binance_api_key TEXT");
  }
  if (!settingsCols.has("binance_api_secret")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN binance_api_secret TEXT");
  }
  if (!settingsCols.has("oanda_api_key")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN oanda_api_key TEXT");
  }
  if (!settingsCols.has("oanda_account_id")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN oanda_account_id TEXT");
  }
  if (!settingsCols.has("oanda_is_practice")) {
    db.exec("ALTER TABLE user_settings ADD COLUMN oanda_is_practice INTEGER NOT NULL DEFAULT 1");
  }
  // --- Additive column migrations on `chat_groups` (idempotent) ---
  const chatGroupCols = new Set(
    (db.prepare("PRAGMA table_info(chat_groups)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!chatGroupCols.has("is_direct")) {
    db.exec("ALTER TABLE chat_groups ADD COLUMN is_direct INTEGER NOT NULL DEFAULT 0");
  }
  if (!chatGroupCols.has("recipient_id")) {
    db.exec(
      "ALTER TABLE chat_groups ADD COLUMN recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
    );
  }
  if (!chatGroupCols.has("archived_at")) {
    // Soft archive — conversation hidden from the main sidebar, shown in "Archivés".
    db.exec("ALTER TABLE chat_groups ADD COLUMN archived_at INTEGER");
  }

  // --- Additive column migrations on `chat_messages` (idempotent) ---
  const chatMessageCols = new Set(
    (db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!chatMessageCols.has("read_at")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN read_at INTEGER");
  }
  if (!chatMessageCols.has("delivered_at")) {
    // Set once the recipient's client is confirmed running (heartbeat) or has
    // fetched the group's messages — distinct from read_at, which only fires
    // once they've actually opened this specific conversation.
    db.exec("ALTER TABLE chat_messages ADD COLUMN delivered_at INTEGER");
  }
  if (!chatMessageCols.has("reply_to_id")) {
    db.exec(
      "ALTER TABLE chat_messages ADD COLUMN reply_to_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL",
    );
  }
  if (!chatMessageCols.has("edited_at")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN edited_at INTEGER");
  }
  if (!chatMessageCols.has("deleted_at")) {
    // Soft delete ("supprimer pour tout le monde") — content is replaced with
    // a tombstone marker client-side rather than erased, so ordering/read
    // receipts stay intact.
    db.exec("ALTER TABLE chat_messages ADD COLUMN deleted_at INTEGER");
  }
  if (!chatMessageCols.has("pinned_at")) {
    // Admin-pinned message — shown in a banner at the top of the conversation.
    db.exec("ALTER TABLE chat_messages ADD COLUMN pinned_at INTEGER");
  }

  seedChangelogIfEmpty(db);

  // Promote the configured admin email if that account already exists.
  const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase();
  if (adminEmail) {
    db.prepare(
      "UPDATE users SET is_admin = 1, status = 'approved', email_verified = 1 WHERE email = ?",
    ).run(adminEmail);
  }

  // Migrate old user_notes to new notes table if new notes is empty
  try {
    const { noteCount } = db.prepare("SELECT COUNT(*) AS noteCount FROM notes").get() as {
      noteCount: number;
    };
    if (noteCount === 0) {
      const oldNotes = db
        .prepare("SELECT user_id, content, updated_at FROM user_notes WHERE content != ''")
        .all() as { user_id: number; content: string; updated_at: number }[];
      if (oldNotes.length > 0) {
        const insertNote = db.prepare(
          "INSERT INTO notes (id, user_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)",
        );
        const migrateAll = db.transaction((rows) => {
          for (const row of rows) {
            const id = `migrated_${row.user_id}_${row.updated_at}`;
            insertNote.run(id, row.user_id, "Note Importée", row.content, row.updated_at);
          }
        });
        migrateAll(oldNotes);
      }
    }
  } catch (err) {
    console.error("Migration error user_notes -> notes:", err);
  }

  // Seed a test user if only the admin user exists in the database
  try {
    const { userCount } = db.prepare("SELECT COUNT(*) AS userCount FROM users").get() as {
      userCount: number;
    };
    if (userCount === 1) {
      const passwordHash = bcrypt.hashSync("password123", 10);
      db.prepare(
        "INSERT INTO users (email, username, password_hash, email_verified, status, is_admin) VALUES (?, ?, ?, 1, 'approved', 0)",
      ).run("testuser@aupluriel.com", "TraderTest", passwordHash);

      const lastId = db.prepare("SELECT last_insert_rowid() AS id").get() as { id: number };
      db.prepare("INSERT INTO user_settings (user_id) VALUES (?)").run(lastId.id);

      console.log("Seeded a test user: TraderTest (password: password123)");
    }
  } catch (err) {
    console.error("Error seeding test user:", err);
  }
}

// One-time seed from real project history (commit dates as created_at) so
// the admin changelog isn't empty on first use — never re-seeds once rows
// exist, so entries added/edited from the admin UI afterward are untouched.
function seedChangelogIfEmpty(db: Database.Database) {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM changelog_entries").get() as { n: number };
  if (n > 0) return;

  const seed: [string, string, string, string, number][] = [
    [
      "fix",
      "Migration API Deriv vers Options Trading (OTP WS)",
      "Passage de l'ancienne API Deriv v3 vers l'API Options Trading v1, marchés disponibles élargis.",
      "resolved",
      1783281978,
    ],
    [
      "improvement",
      "Refonte du header, retrait du market-coach, notification d'ouverture de marché",
      "",
      "resolved",
      1783310643,
    ],
    [
      "improvement",
      "Moteur de trading multi-marché adaptatif, mise Kelly, optimisations perf",
      "",
      "resolved",
      1783364414,
    ],
    [
      "fix",
      "Refonte de la page de connexion et correction du portail d'authentification",
      "",
      "resolved",
      1783371727,
    ],
    [
      "improvement",
      "Compression des logos, création de compte admin, réactif mobile",
      "",
      "resolved",
      1783379048,
    ],
    [
      "fix",
      "L'auto-trader s'arrêtait en changeant de page",
      "Le moteur tournait uniquement tant que le composant restait monté — corrigé pour rester actif à la navigation.",
      "resolved",
      1783422682,
    ],
    [
      "improvement",
      "Auto-trader côté serveur (tourne 24/7) + corrections d'audit sur la fréquence de trade",
      "",
      "resolved",
      1783456015,
    ],
    [
      "fix",
      "Icônes PWA corrigées, cache du service worker obsolète, ré-enregistrement",
      "",
      "resolved",
      1783470767,
    ],
    [
      "improvement",
      "Harmonisation sidebar mobile/desktop, logo glassmorphic",
      "",
      "resolved",
      1783484191,
    ],
    [
      "fix",
      "Arrondi du prix d'achat Deriv corrigé + durcissement des contrôles de risque",
      "Rebranding de l'app en Lio23 à la même occasion.",
      "resolved",
      1783602533,
    ],
    [
      "improvement",
      "Déploiement automatique sur lio23.com",
      "GitHub Actions déclenche un déploiement SSH sur le VPS à chaque push sur main.",
      "resolved",
      1783603892,
    ],
    [
      "fix",
      "Blocage par corrélation appliqué dans les deux sens",
      "Le filtre bloquait aussi la direction non corrélée au lieu de ne bloquer que la direction réellement corrélée.",
      "resolved",
      1783631280,
    ],
    [
      "fix",
      'KPI "P&L Aujourd\'hui" ignorait les trades du bot serveur',
      "Ne sommait que les trades du moteur local — invisible dès qu'on tradait via le bot serveur.",
      "resolved",
      1783631822,
    ],
    [
      "improvement",
      "Deux corrections de logique de trading trouvées lors d'un audit complet",
      "",
      "resolved",
      1783632585,
    ],
    [
      "improvement",
      "Veto de tendance journalière optionnel + coupe-circuit de win-rate par symbole",
      "",
      "resolved",
      1783634549,
    ],
    [
      "improvement",
      "Passage aux contrats Multiplicateur (MULTUP/MULTDOWN) par défaut",
      "Remplace CALL/PUT — effet de levier, sans échéance fixe, stop/take-profit en montant absolu.",
      "resolved",
      1783636556,
    ],
    [
      "improvement",
      "Ajout du mode Live (argent réel) pour le bot serveur",
      "Avec avertissement de risque explicite avant activation.",
      "resolved",
      1783637321,
    ],
    [
      "improvement",
      "Stops dynamiques basés sur l'ATR + décroissance de récence sur les poids appris",
      "",
      "resolved",
      1783650987,
    ],
    [
      "improvement",
      "Récap de trading par utilisateur + détail de l'apprentissage partagé dans l'admin",
      "",
      "resolved",
      1783650987,
    ],
    [
      "improvement",
      "Limitation de débit sur inscription/connexion/mot de passe oublié/renvoi de vérification",
      "",
      "resolved",
      1783650987,
    ],
    [
      "improvement",
      "Couverture crypto 24/7 + assouplissement du palier premium pour un vrai flux de trades",
      "",
      "resolved",
      1783688161,
    ],
    [
      "fix",
      "Seuil d'accord multi-timeframe relevé à 3",
      "Validé par un replay honnête de 52 jours de backtest.",
      "resolved",
      1783690509,
    ],
    [
      "fix",
      "volatilityRatio comparait un ATR absolu à une base en pourcentage",
      "Faussait le calcul de volatilité relative.",
      "resolved",
      1783691144,
    ],
    [
      "improvement",
      "Arrêt propre du serveur, emails de trade, comparatif backtest-vs-réel dans l'admin",
      "",
      "resolved",
      1783693046,
    ],
    [
      "improvement",
      "Copie de chaque email de trade/risque vers l'admin",
      "",
      "resolved",
      1783694635,
    ],
    [
      "fix",
      "Erreurs API Deriv, auto-réparation des multiplicateurs, signaux optimisés",
      "Inscription sécurisée par code d'invitation à la même occasion.",
      "resolved",
      1783822481,
    ],
    [
      "improvement",
      "Refonte de la page admin en interface glassmorphique premium",
      "",
      "resolved",
      1783822910,
    ],
    [
      "improvement",
      "Les admins peuvent activer l'auto-trader par utilisateur avec statut live",
      "",
      "resolved",
      1783824716,
    ],
    [
      "improvement",
      "Génération de codes d'invitation par destinataire, envoyés par email",
      "",
      "resolved",
      1783826933,
    ],
    [
      "improvement",
      "Suivi de la calibration de confiance dans les analytics du bot",
      "",
      "resolved",
      1783887920,
    ],
    [
      "improvement",
      "Scheduler de backtest automatique + refonte Auto-Trader/Paramètres",
      "",
      "resolved",
      1783964552,
    ],
    [
      "fix",
      "Indicateur de statut du backtest auto + vérifications de token localStorage périmées",
      "",
      "resolved",
      1783966414,
    ],
    [
      "improvement",
      "Refonte du dashboard bot, layout auto-trader, sessions de marché colorées, pipeline de test restauré",
      "",
      "resolved",
      1783971873,
    ],
    [
      "fix",
      "Contournement du blocage autoplay navigateur + sons d'ouverture/perte de trade",
      "",
      "resolved",
      1783973594,
    ],
    [
      "improvement",
      "Refonte des emails en thème sombre premium avec logo favicon",
      "Couleurs alignées sur le orange de la marque (au lieu de cyan/violet).",
      "resolved",
      1783974347,
    ],
    [
      "fix",
      "Stats démo/live mélangées, mode simulation affichait un P&L inventé",
      "Séparées par mode ; Kelly implémenté côté serveur ; indices synthétiques retirés des presets.",
      "resolved",
      1783978593,
    ],
    [
      "improvement",
      "Navigation mobile façon app",
      "5 onglets essentiels en bas, pages denses réduites à l'essentiel via accordéons.",
      "resolved",
      1783988979,
    ],
    [
      "fix",
      "Confirmation ajoutée avant CHAQUE lancement du bot",
      "Auparavant seule l'activation du mode live était confirmée — désormais démo aussi.",
      "resolved",
      1783990915,
    ],
    [
      "improvement",
      "Notifications Web Push réelles",
      "Fonctionnent même téléphone verrouillé, contrairement aux anciennes notifications navigateur au premier plan.",
      "resolved",
      1783992398,
    ],
    [
      "fix",
      "Tiroir de menu mobile caché derrière la barre de navigation du bas",
      "Email/nom coupés en bas du menu — corrigé par z-index et min-h-0 sur la liste scrollable.",
      "resolved",
      1783999077,
    ],
    [
      "fix",
      "Le bot tentait des ordres Multiplicateur sur des indices actions (OTC_*)",
      "Ces symboles ne supportent pas ce type de contrat sur Deriv.",
      "resolved",
      1784023573,
    ],
    [
      "fix",
      "Inversion base/quote USD dans le filtre de corrélation",
      "Bloquait/laissait passer l'inverse de ce qu'il fallait selon le sens de la paire ; ajout du groupe or/argent.",
      "resolved",
      1784042964,
    ],
    [
      "fix",
      "Corrections d'un audit de trading complet",
      "Sessions crypto, plancher de confiance, perte flottante plafonnée dans le risque journalier, plafond global de positions ouvertes.",
      "resolved",
      1784044054,
    ],
    [
      "fix",
      "Détection Chrome/Firefox sur iOS pour les notifications push",
      "Ces navigateurs ne peuvent jamais activer le push sur iOS (restriction Apple) — orientation explicite vers Safari.",
      "resolved",
      1784045822,
    ],
    [
      "fix",
      "Arrondi des décimales de l'API Deriv corrigé",
      "Configs par défaut optimisées (levier x20, ATR stop 2.5).",
      "resolved",
      1784048403,
    ],
    [
      "improvement",
      "Notification admin à l'arrêt d'un bot + affichage des soldes Deriv utilisateurs dans l'admin",
      "",
      "resolved",
      1784049793,
    ],
    [
      "improvement",
      "Contrôles admin pour activer/désactiver le backtest auto par utilisateur",
      "",
      "resolved",
      1784050079,
    ],
    [
      "improvement",
      "Notifications push aux admins quand le bot d'un utilisateur s'arrête",
      "",
      "resolved",
      1784050337,
    ],
    [
      "fix",
      "Trois ajustements de stratégie externes revus",
      "Cap du levier crypto, retrait du Stochastique, filtres RSI, ATR stop élargi à 3.0 — dont un (atrStopMode) contredisait un résultat de backtest de 52 jours déjà documenté dans le code.",
      "resolved",
      1784065602,
    ],
    [
      "fix",
      "Stop-loss recalculé avec le levier crypto réellement appliqué",
      "Utilisait le levier brut demandé au lieu du levier effectif (capé x10 en crypto) ; annulation du atrStopMode non validé.",
      "resolved",
      1784066569,
    ],
    [
      "fix",
      "Minuteur maxHoldMinutes repartait de zéro à chaque redémarrage serveur",
      "Pouvait ne jamais se déclencher si les redémarrages étaient assez fréquents — recalculé depuis l'heure d'ouverture réelle de la position.",
      "resolved",
      1784076937,
    ],
    [
      "fix",
      "Notifications push en double corrigées, crash du portefeuille corrigé, dialogues de confirmation ajoutés",
      "",
      "resolved",
      1784083725,
    ],
    [
      "fix",
      "P&L Aujourd'hui figé à la valeur du chargement de page",
      "Ne se rafraîchissait jamais — polling 30s ajouté.",
      "resolved",
      1784111997,
    ],
    [
      "improvement",
      "Retrait du moteur de trading local (navigateur)",
      "Ne tournait que fenêtre ouverte, invisible partout ailleurs (autres appareils, journal, admin), sans notification. Le bot serveur devient l'unique moteur supporté.",
      "resolved",
      1784112862,
    ],
    [
      "fix",
      "Panneau admin (statut bot, P&L cumulés) ne se rafraîchissait jamais automatiquement",
      "Polling 20s ajouté.",
      "resolved",
      1784119370,
    ],
    [
      "fix",
      "Positions orphelines après arrêt du bot par le backtest auto",
      "Un verdict défavorable pouvait arrêter un bot avec des positions encore ouvertes, les laissant sans suivi P&L ni clôture automatique. L'arrêt est désormais différé jusqu'à ce qu'elles se closent. Dérive de la mise (stake) entre navigateur et serveur corrigée par resynchronisation au chargement de la page.",
      "resolved",
      1784120108,
    ],
    [
      "improvement",
      "Coupe-circuit du backtest auto étendu au mode live",
      "Arrêt automatique si le verdict devient défavorable, avec le même garde-fou positions ouvertes. Jamais de redémarrage automatique en live — ça reste toujours une action manuelle confirmée.",
      "resolved",
      1784120673,
    ],
  ];

  const insert = db.prepare(
    "INSERT INTO changelog_entries (type, title, description, status, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertAll = db.transaction((rows: typeof seed) => {
    for (const row of rows) insert.run(...row);
  });
  insertAll(seed);

  // Current open watch items, known as of this seeding — not from git
  // history, but real state worth surfacing so it doesn't get re-discovered
  // from scratch next time someone asks "is everything OK".
  const watch = db.prepare(
    "INSERT INTO changelog_entries (type, title, description, status) VALUES (?, ?, ?, ?)",
  );
  watch.run(
    "watch",
    "Verdict backtest auto actuellement défavorable",
    "39,0% de réussite mesurée vs 54,1% nécessaire pour être rentable — les bots démo opt-in restent arrêtés par design. À surveiller avant tout passage en live.",
    "monitoring",
  );
  watch.run(
    "watch",
    "Erreur récurrente : logo-192.png manquant",
    "500 sur /home/ubuntu/app/.output/public/logo-192.png (asset PWA/manifest) — repéré dans les logs journalctl, pas encore corrigé.",
    "open",
  );
  watch.run(
    "watch",
    "netPnl admin ne filtre pas par mode démo/live",
    "src/routes/api/admin/stats.ts additionne démo et live ensemble. Sans impact tant que tout est en démo, à corriger avant que du live coexiste avec du démo.",
    "open",
  );
}
