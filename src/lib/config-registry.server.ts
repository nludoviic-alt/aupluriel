import crypto from "node:crypto";
import { getDb } from "./db.server";

export interface VersionedConfigRow {
  id: string;
  user_id: number;
  preset: string;
  version_tag: string;
  version_hash: string;
  config_json: string;
  created_at: number;
  created_by: number | null;
  source: string;
  change_summary: string | null;
}

export interface AuditEventRow {
  id: string;
  version_id: string;
  user_id: number;
  preset: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  timestamp: number;
  source: string;
  metadata: string | null;
}

/**
 * Computes a deterministic canonical SHA-256 hash of a JSON config object.
 */
export function hashConfig(configObj: Record<string, any>): string {
  const sortedKeys = Object.keys(configObj).sort();
  const canonicalObj: Record<string, any> = {};
  for (const key of sortedKeys) {
    canonicalObj[key] = configObj[key];
  }
  const str = JSON.stringify(canonicalObj);
  return crypto.createHash("sha256").update(str).digest("hex");
}

/**
 * Increments semantic version string (e.g. 'v1.0.0' -> 'v1.0.1' or 'v1.1.0')
 */
function nextVersionTag(currentTag: string | null, isMajorChange: boolean): string {
  if (!currentTag) return "v1.0.0";
  const clean = currentTag.replace(/^v/, "").split("-")[0];
  const parts = clean.split(".").map((n) => parseInt(n, 10) || 0);
  let major = parts[0] ?? 1;
  let minor = parts[1] ?? 0;
  let patch = parts[2] ?? 0;

  if (isMajorChange) {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `v${major}.${minor}.${patch}`;
}

const CRITICAL_RISK_FIELDS = new Set([
  "stake",
  "min_confidence",
  "min_tf_agreement",
  "take_profit",
  "stop_loss",
  "multiplier",
  "cooldown",
  "max_daily_loss",
  "max_drawdown_percent",
  "max_open_positions",
  "rsi_period",
  "rsi_overbought",
  "rsi_oversold",
  "volatility_threshold",
]);

export class ConfigRegistry {
  /**
   * Retrieves the current active config version for a given user & preset.
   */
  static getLatestVersion(userId: number, preset: string): VersionedConfigRow | null {
    const row = getDb()
      .prepare(
        "SELECT * FROM config_versions WHERE user_id = ? AND preset = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(userId, preset) as VersionedConfigRow | undefined;
    return row ?? null;
  }

  /**
   * Commits a new configuration version with full audit logging for every modified field.
   * Enforces the Zero Silent Changes Rule.
   */
  static saveConfigVersion(opts: {
    userId: number;
    preset: string;
    newConfig: Record<string, any>;
    createdBy?: number | null;
    source?: "user" | "admin" | "auto-tuner" | "rollback";
    changeReason?: string;
    /** Activation reconciliation must never bulk-overwrite other accounts. */
    syncSecondaryUsers?: boolean;
  }): { version: VersionedConfigRow; auditEvents: AuditEventRow[] } {
    const {
      userId,
      preset,
      newConfig,
      createdBy = null,
      source = "user",
      changeReason,
      syncSecondaryUsers = true,
    } = opts;
    const now = Date.now();
    const newHash = hashConfig(newConfig);

    const latest = this.getLatestVersion(userId, preset);
    const oldConfig: Record<string, any> = latest ? JSON.parse(latest.config_json) : {};

    // If hash is identical to latest, return latest without creating duplicate version
    if (latest && latest.version_hash === newHash) {
      return { version: latest, auditEvents: [] };
    }

    // Detect changed fields
    const changedFields: { field: string; oldVal: any; newVal: any }[] = [];
    const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);

    let isMajorChange = false;
    for (const key of allKeys) {
      const oldVal = oldConfig[key];
      const newVal = newConfig[key];
      if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
        changedFields.push({ field: key, oldVal, newVal });
        if (CRITICAL_RISK_FIELDS.has(key)) {
          isMajorChange = true;
        }
      }
    }

    const versionTag = nextVersionTag(latest?.version_tag ?? null, isMajorChange);
    const versionId = `ver_${preset}_${userId}_${now}_${crypto.randomBytes(4).toString("hex")}`;

    const summaryItems = changedFields
      .slice(0, 4)
      .map((c) => `${c.field}: ${JSON.stringify(c.oldVal)} ➔ ${JSON.stringify(c.newVal)}`);
    if (changedFields.length > 4) {
      summaryItems.push(`+${changedFields.length - 4} other fields`);
    }
    const changeSummary = changeReason
      ? `${changeReason} (${summaryItems.join(", ")})`
      : summaryItems.join(", ") || "Initial version commit";

    const versionRow: VersionedConfigRow = {
      id: versionId,
      user_id: userId,
      preset,
      version_tag: versionTag,
      version_hash: newHash,
      config_json: JSON.stringify(newConfig),
      created_at: now,
      created_by: createdBy,
      source,
      change_summary: changeSummary,
    };

    const auditEvents: AuditEventRow[] = [];

    // Transaction for atomic insertion of version + audit events + user_configs sync
    getDb().transaction(() => {
      // 1. Insert config_versions row
      getDb()
        .prepare(
          `
        INSERT INTO config_versions (id, user_id, preset, version_tag, version_hash, config_json, created_at, created_by, source, change_summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          versionRow.id,
          versionRow.user_id,
          versionRow.preset,
          versionRow.version_tag,
          versionRow.version_hash,
          versionRow.config_json,
          versionRow.created_at,
          versionRow.created_by,
          versionRow.source,
          versionRow.change_summary,
        );

      // 2. Insert audit events for every single changed field
      const auditStmt = getDb().prepare(`
        INSERT INTO config_audit_events (id, version_id, user_id, preset, field_name, old_value, new_value, timestamp, source, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const change of changedFields) {
        const eventId = `aud_${now}_${crypto.randomBytes(4).toString("hex")}`;
        const eventRow: AuditEventRow = {
          id: eventId,
          version_id: versionId,
          user_id: userId,
          preset,
          field_name: change.field,
          old_value: JSON.stringify(change.oldVal ?? null),
          new_value: JSON.stringify(change.newVal ?? null),
          timestamp: now,
          source,
          metadata: changeReason ? JSON.stringify({ reason: changeReason }) : null,
        };
        auditEvents.push(eventRow);

        auditStmt.run(
          eventRow.id,
          eventRow.version_id,
          eventRow.user_id,
          eventRow.preset,
          eventRow.field_name,
          eventRow.old_value,
          eventRow.new_value,
          eventRow.timestamp,
          eventRow.source,
          eventRow.metadata,
        );
      }

      // 3. Keep legacy user_configs table synchronized
      getDb()
        .prepare(
          `
        INSERT INTO user_configs (user_id, preset, config, updated_at)
        VALUES (?, ?, ?, unixepoch())
        ON CONFLICT(user_id, preset) DO UPDATE SET
          config = excluded.config,
          updated_at = unixepoch()
      `,
        )
        .run(userId, preset, JSON.stringify(newConfig));
    })();

    // Auto-sync secondary users (juluo, stella) to match admin active presets
    if (syncSecondaryUsers) {
      try {
        ConfigRegistry.syncAllUsersToAdminPresets(userId);
      } catch {
        /* ignore non-blocking sync error */
      }
    }

    return { version: versionRow, auditEvents };
  }

  /**
   * Synchronizes all secondary user accounts (e.g. juluo, stella) to match
   * the exact active preset configurations and bot states of the admin user.
   */
  static syncAllUsersToAdminPresets(adminUserId: number): void {
    const db = getDb();
    const adminConfigs = db
      .prepare("SELECT preset, config FROM user_configs WHERE user_id = ?")
      .all(adminUserId) as { preset: string; config: string }[];
    const adminBotStates = db
      .prepare("SELECT preset, enabled FROM bot_state WHERE user_id = ?")
      .all(adminUserId) as { preset: string; enabled: number }[];

    if (!adminConfigs.length) return;

    const targetUsers = db.prepare("SELECT id FROM users WHERE id != ?").all(adminUserId) as {
      id: number;
    }[];

    for (const user of targetUsers) {
      for (const cfg of adminConfigs) {
        db.prepare(
          `
          INSERT INTO user_configs (user_id, preset, config, updated_at)
          VALUES (?, ?, ?, unixepoch())
          ON CONFLICT(user_id, preset) DO UPDATE SET
            config = excluded.config,
            updated_at = unixepoch()
        `,
        ).run(user.id, cfg.preset, cfg.config);
      }

      for (const st of adminBotStates) {
        db.prepare(
          `
          INSERT INTO bot_state (user_id, preset, enabled, current_balance, session_peak_pnl, updated_at)
          VALUES (?, ?, ?, 1000, 0, unixepoch())
          ON CONFLICT(user_id, preset) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = unixepoch()
        `,
        ).run(user.id, st.preset, st.enabled);
      }
    }
  }

  /**
   * Retrieves full version history for a given user & preset.
   */
  static getVersionHistory(userId: number, preset: string, limit = 50): VersionedConfigRow[] {
    return getDb()
      .prepare(
        "SELECT * FROM config_versions WHERE user_id = ? AND preset = ? ORDER BY created_at DESC LIMIT ?",
      )
      .all(userId, preset, limit) as VersionedConfigRow[];
  }

  /**
   * Retrieves audit events for a specific version or preset.
   */
  static getAuditEvents(userId: number, preset: string, limit = 100): AuditEventRow[] {
    return getDb()
      .prepare(
        "SELECT * FROM config_audit_events WHERE user_id = ? AND preset = ? ORDER BY timestamp DESC LIMIT ?",
      )
      .all(userId, preset, limit) as AuditEventRow[];
  }

  /**
   * Performs an instant 1-click rollback to a target version ID.
   */
  static rollbackToVersion(
    userId: number,
    preset: string,
    targetVersionId: string,
    revertedBy?: number | null,
  ): { version: VersionedConfigRow; auditEvents: AuditEventRow[] } {
    const target = getDb()
      .prepare("SELECT * FROM config_versions WHERE id = ? AND user_id = ? AND preset = ?")
      .get(targetVersionId, userId, preset) as VersionedConfigRow | undefined;

    if (!target) {
      throw new Error(`Target version ${targetVersionId} not found for preset ${preset}`);
    }

    const targetConfig = JSON.parse(target.config_json);

    return this.saveConfigVersion({
      userId,
      preset,
      newConfig: targetConfig,
      createdBy: revertedBy,
      source: "rollback",
      changeReason: `Reverted to version ${target.version_tag} (${target.id})`,
    });
  }
}
