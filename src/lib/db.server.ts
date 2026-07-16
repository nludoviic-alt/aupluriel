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
  if (!userCols.has("chat_enabled")) {
    db.exec("ALTER TABLE users ADD COLUMN chat_enabled INTEGER NOT NULL DEFAULT 0");
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
    db.exec("ALTER TABLE user_settings ADD COLUMN auto_backtest_enabled INTEGER NOT NULL DEFAULT 0");
  }
  // --- Additive column migrations on `chat_groups` (idempotent) ---
  const chatGroupCols = new Set(
    (db.prepare("PRAGMA table_info(chat_groups)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!chatGroupCols.has("is_direct")) {
    db.exec("ALTER TABLE chat_groups ADD COLUMN is_direct INTEGER NOT NULL DEFAULT 0");
  }
  if (!chatGroupCols.has("recipient_id")) {
    db.exec("ALTER TABLE chat_groups ADD COLUMN recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE");
  }

  // --- Additive column migrations on `chat_messages` (idempotent) ---
  const chatMessageCols = new Set(
    (db.prepare("PRAGMA table_info(chat_messages)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!chatMessageCols.has("read_at")) {
    db.exec("ALTER TABLE chat_messages ADD COLUMN read_at INTEGER");
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
    const { noteCount } = db.prepare("SELECT COUNT(*) AS noteCount FROM notes").get() as { noteCount: number };
    if (noteCount === 0) {
      const oldNotes = db.prepare("SELECT user_id, content, updated_at FROM user_notes WHERE content != ''").all() as { user_id: number; content: string; updated_at: number }[];
      if (oldNotes.length > 0) {
        const insertNote = db.prepare("INSERT INTO notes (id, user_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)");
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
    const { userCount } = db.prepare("SELECT COUNT(*) AS userCount FROM users").get() as { userCount: number };
    if (userCount === 1) {
      const passwordHash = bcrypt.hashSync("password123", 10);
      db.prepare(
        "INSERT INTO users (email, username, password_hash, email_verified, status, is_admin) VALUES (?, ?, ?, 1, 'approved', 0)"
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
    ["fix", "Migration API Deriv vers Options Trading (OTP WS)", "Passage de l'ancienne API Deriv v3 vers l'API Options Trading v1, marchés disponibles élargis.", "resolved", 1783281978],
    ["improvement", "Refonte du header, retrait du market-coach, notification d'ouverture de marché", "", "resolved", 1783310643],
    ["improvement", "Moteur de trading multi-marché adaptatif, mise Kelly, optimisations perf", "", "resolved", 1783364414],
    ["fix", "Refonte de la page de connexion et correction du portail d'authentification", "", "resolved", 1783371727],
    ["improvement", "Compression des logos, création de compte admin, réactif mobile", "", "resolved", 1783379048],
    ["fix", "L'auto-trader s'arrêtait en changeant de page", "Le moteur tournait uniquement tant que le composant restait monté — corrigé pour rester actif à la navigation.", "resolved", 1783422682],
    ["improvement", "Auto-trader côté serveur (tourne 24/7) + corrections d'audit sur la fréquence de trade", "", "resolved", 1783456015],
    ["fix", "Icônes PWA corrigées, cache du service worker obsolète, ré-enregistrement", "", "resolved", 1783470767],
    ["improvement", "Harmonisation sidebar mobile/desktop, logo glassmorphic", "", "resolved", 1783484191],
    ["fix", "Arrondi du prix d'achat Deriv corrigé + durcissement des contrôles de risque", "Rebranding de l'app en Lio23 à la même occasion.", "resolved", 1783602533],
    ["improvement", "Déploiement automatique sur lio23.com", "GitHub Actions déclenche un déploiement SSH sur le VPS à chaque push sur main.", "resolved", 1783603892],
    ["fix", "Blocage par corrélation appliqué dans les deux sens", "Le filtre bloquait aussi la direction non corrélée au lieu de ne bloquer que la direction réellement corrélée.", "resolved", 1783631280],
    ["fix", "KPI \"P&L Aujourd'hui\" ignorait les trades du bot serveur", "Ne sommait que les trades du moteur local — invisible dès qu'on tradait via le bot serveur.", "resolved", 1783631822],
    ["improvement", "Deux corrections de logique de trading trouvées lors d'un audit complet", "", "resolved", 1783632585],
    ["improvement", "Veto de tendance journalière optionnel + coupe-circuit de win-rate par symbole", "", "resolved", 1783634549],
    ["improvement", "Passage aux contrats Multiplicateur (MULTUP/MULTDOWN) par défaut", "Remplace CALL/PUT — effet de levier, sans échéance fixe, stop/take-profit en montant absolu.", "resolved", 1783636556],
    ["improvement", "Ajout du mode Live (argent réel) pour le bot serveur", "Avec avertissement de risque explicite avant activation.", "resolved", 1783637321],
    ["improvement", "Stops dynamiques basés sur l'ATR + décroissance de récence sur les poids appris", "", "resolved", 1783650987],
    ["improvement", "Récap de trading par utilisateur + détail de l'apprentissage partagé dans l'admin", "", "resolved", 1783650987],
    ["improvement", "Limitation de débit sur inscription/connexion/mot de passe oublié/renvoi de vérification", "", "resolved", 1783650987],
    ["improvement", "Couverture crypto 24/7 + assouplissement du palier premium pour un vrai flux de trades", "", "resolved", 1783688161],
    ["fix", "Seuil d'accord multi-timeframe relevé à 3", "Validé par un replay honnête de 52 jours de backtest.", "resolved", 1783690509],
    ["fix", "volatilityRatio comparait un ATR absolu à une base en pourcentage", "Faussait le calcul de volatilité relative.", "resolved", 1783691144],
    ["improvement", "Arrêt propre du serveur, emails de trade, comparatif backtest-vs-réel dans l'admin", "", "resolved", 1783693046],
    ["improvement", "Copie de chaque email de trade/risque vers l'admin", "", "resolved", 1783694635],
    ["fix", "Erreurs API Deriv, auto-réparation des multiplicateurs, signaux optimisés", "Inscription sécurisée par code d'invitation à la même occasion.", "resolved", 1783822481],
    ["improvement", "Refonte de la page admin en interface glassmorphique premium", "", "resolved", 1783822910],
    ["improvement", "Les admins peuvent activer l'auto-trader par utilisateur avec statut live", "", "resolved", 1783824716],
    ["improvement", "Génération de codes d'invitation par destinataire, envoyés par email", "", "resolved", 1783826933],
    ["improvement", "Suivi de la calibration de confiance dans les analytics du bot", "", "resolved", 1783887920],
    ["improvement", "Scheduler de backtest automatique + refonte Auto-Trader/Paramètres", "", "resolved", 1783964552],
    ["fix", "Indicateur de statut du backtest auto + vérifications de token localStorage périmées", "", "resolved", 1783966414],
    ["improvement", "Refonte du dashboard bot, layout auto-trader, sessions de marché colorées, pipeline de test restauré", "", "resolved", 1783971873],
    ["fix", "Contournement du blocage autoplay navigateur + sons d'ouverture/perte de trade", "", "resolved", 1783973594],
    ["improvement", "Refonte des emails en thème sombre premium avec logo favicon", "Couleurs alignées sur le orange de la marque (au lieu de cyan/violet).", "resolved", 1783974347],
    ["fix", "Stats démo/live mélangées, mode simulation affichait un P&L inventé", "Séparées par mode ; Kelly implémenté côté serveur ; indices synthétiques retirés des presets.", "resolved", 1783978593],
    ["improvement", "Navigation mobile façon app", "5 onglets essentiels en bas, pages denses réduites à l'essentiel via accordéons.", "resolved", 1783988979],
    ["fix", "Confirmation ajoutée avant CHAQUE lancement du bot", "Auparavant seule l'activation du mode live était confirmée — désormais démo aussi.", "resolved", 1783990915],
    ["improvement", "Notifications Web Push réelles", "Fonctionnent même téléphone verrouillé, contrairement aux anciennes notifications navigateur au premier plan.", "resolved", 1783992398],
    ["fix", "Tiroir de menu mobile caché derrière la barre de navigation du bas", "Email/nom coupés en bas du menu — corrigé par z-index et min-h-0 sur la liste scrollable.", "resolved", 1783999077],
    ["fix", "Le bot tentait des ordres Multiplicateur sur des indices actions (OTC_*)", "Ces symboles ne supportent pas ce type de contrat sur Deriv.", "resolved", 1784023573],
    ["fix", "Inversion base/quote USD dans le filtre de corrélation", "Bloquait/laissait passer l'inverse de ce qu'il fallait selon le sens de la paire ; ajout du groupe or/argent.", "resolved", 1784042964],
    ["fix", "Corrections d'un audit de trading complet", "Sessions crypto, plancher de confiance, perte flottante plafonnée dans le risque journalier, plafond global de positions ouvertes.", "resolved", 1784044054],
    ["fix", "Détection Chrome/Firefox sur iOS pour les notifications push", "Ces navigateurs ne peuvent jamais activer le push sur iOS (restriction Apple) — orientation explicite vers Safari.", "resolved", 1784045822],
    ["fix", "Arrondi des décimales de l'API Deriv corrigé", "Configs par défaut optimisées (levier x20, ATR stop 2.5).", "resolved", 1784048403],
    ["improvement", "Notification admin à l'arrêt d'un bot + affichage des soldes Deriv utilisateurs dans l'admin", "", "resolved", 1784049793],
    ["improvement", "Contrôles admin pour activer/désactiver le backtest auto par utilisateur", "", "resolved", 1784050079],
    ["improvement", "Notifications push aux admins quand le bot d'un utilisateur s'arrête", "", "resolved", 1784050337],
    ["fix", "Trois ajustements de stratégie externes revus", "Cap du levier crypto, retrait du Stochastique, filtres RSI, ATR stop élargi à 3.0 — dont un (atrStopMode) contredisait un résultat de backtest de 52 jours déjà documenté dans le code.", "resolved", 1784065602],
    ["fix", "Stop-loss recalculé avec le levier crypto réellement appliqué", "Utilisait le levier brut demandé au lieu du levier effectif (capé x10 en crypto) ; annulation du atrStopMode non validé.", "resolved", 1784066569],
    ["fix", "Minuteur maxHoldMinutes repartait de zéro à chaque redémarrage serveur", "Pouvait ne jamais se déclencher si les redémarrages étaient assez fréquents — recalculé depuis l'heure d'ouverture réelle de la position.", "resolved", 1784076937],
    ["fix", "Notifications push en double corrigées, crash du portefeuille corrigé, dialogues de confirmation ajoutés", "", "resolved", 1784083725],
    ["fix", "P&L Aujourd'hui figé à la valeur du chargement de page", "Ne se rafraîchissait jamais — polling 30s ajouté.", "resolved", 1784111997],
    ["improvement", "Retrait du moteur de trading local (navigateur)", "Ne tournait que fenêtre ouverte, invisible partout ailleurs (autres appareils, journal, admin), sans notification. Le bot serveur devient l'unique moteur supporté.", "resolved", 1784112862],
    ["fix", "Panneau admin (statut bot, P&L cumulés) ne se rafraîchissait jamais automatiquement", "Polling 20s ajouté.", "resolved", 1784119370],
    ["fix", "Positions orphelines après arrêt du bot par le backtest auto", "Un verdict défavorable pouvait arrêter un bot avec des positions encore ouvertes, les laissant sans suivi P&L ni clôture automatique. L'arrêt est désormais différé jusqu'à ce qu'elles se closent. Dérive de la mise (stake) entre navigateur et serveur corrigée par resynchronisation au chargement de la page.", "resolved", 1784120108],
    ["improvement", "Coupe-circuit du backtest auto étendu au mode live", "Arrêt automatique si le verdict devient défavorable, avec le même garde-fou positions ouvertes. Jamais de redémarrage automatique en live — ça reste toujours une action manuelle confirmée.", "resolved", 1784120673],
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
