// Admin-only: apply a targeted adjustment to one user's AutoTraderConfig for
// ONE preset — the "ajuster leurs stratégies au besoin" surface for the
// per-user insights panel. Deliberately a narrow whitelist of fields
// (symbols, minConfidence, maxConfidence, excludedSymbols), not a free-form
// config overwrite: this is meant for admin-reviewed suggestions, not a
// backdoor to silently rewrite someone's whole strategy.
//
// `preset` selects WHICH of the user's up to three bot_state rows
// (default/boom/crash, 2026-08-01) this patch applies to — required, not an
// action by itself. `resetToCanonical: true` resets that row's strategy
// fields back to BOOM_PRESET/CRASH_PRESET/DEFAULT_CONFIG (admin-side
// equivalent of POST /api/bot { action: "reset" }, which only works for the
// logged-in user's own account — an admin acts on someone else's).
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import { updateConfigForUser, type Preset } from "@/lib/bot-engine.server";
import { DEFAULT_CONFIG, type AutoTraderConfig } from "@/lib/signal-core";
import { BOOM_PRESET, BOOM900_PRESET, BOOM_V2_PRESET, CRASH_PRESET, CRASH900_V2_PRESET, GOLD_PRESET, GOLD_V2_PRESET, LIQUIDITY_PRESET, LIQUIDITY_V2_PRESET, SCALPING_PRESET, SCALPING_V2_PRESET } from "@/lib/autotrader";

interface PatchBody {
  userId?: number;
  preset?: Preset;
  symbols?: string[];
  minConfidence?: number;
  maxConfidence?: number;
  excludedSymbols?: string[];
  autoRollbackEnabled?: boolean;
  resetToCanonical?: boolean;
  /** Apply a full strategy configOverride (from the Strategies page) to this
   * user's preset — merges all fields the strategy defines (symbols, confidence,
   * TF agreement, stake, daily loss, TP/SL, etc.) into the existing config.
   * Used by the admin user modal's strategy selector. */
  configOverride?: Partial<AutoTraderConfig>;
}

function presetFieldsFor(preset: Preset): Partial<AutoTraderConfig> {
  if (preset === "boom") return BOOM_PRESET;
  if (preset === "boom900") return BOOM900_PRESET;
  if (preset === "crash") return CRASH_PRESET;
  if (preset === "scalping") return SCALPING_PRESET;
  if (preset === "liquidity") return LIQUIDITY_PRESET;
  if (preset === "gold") return GOLD_PRESET;
  if (preset === "crash900") return CRASH900_V2_PRESET;
  if (preset === "boomv2") return BOOM_V2_PRESET;
  if (preset === "scalpingv2") return SCALPING_V2_PRESET;
  if (preset === "liquidityv2") return LIQUIDITY_V2_PRESET;
  if (preset === "goldv2") return GOLD_V2_PRESET;
  return DEFAULT_CONFIG;
}

function isGoldPreset(preset: Preset): boolean {
  return preset === "gold" || preset === "goldv2" || preset === "liquidity" || preset === "liquidityv2";
}

export const Route = createFileRoute("/api/admin/user-config")({
  server: {
    handlers: {
      PATCH: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as PatchBody;
        if (!body.userId || !Number.isFinite(body.userId)) {
          return json({ error: "userId requis." }, 400);
        }
        if (!body.preset || !["default", "boom", "boom900", "crash", "scalping", "liquidity", "gold", "crash900", "boomv2", "scalpingv2", "liquidityv2", "goldv2"].includes(body.preset)) {
          return json({ error: "Preset inconnu." }, 400);
        }
        if (body.symbols === undefined && body.minConfidence === undefined && body.maxConfidence === undefined && body.excludedSymbols === undefined && body.autoRollbackEnabled === undefined && !body.resetToCanonical && !body.configOverride) {
          return json({ error: "Aucun champ à appliquer (symbols, minConfidence, maxConfidence, excludedSymbols, autoRollbackEnabled, configOverride ou resetToCanonical requis)." }, 400);
        }

        const db = getDb();
        // A preset never started for this user has no row yet — create one
        // (disabled) from its canonical defaults so the patch below has
        // something to apply to, same as the user's own POST /api/bot reset.
        db.prepare(`
          INSERT INTO bot_state (user_id, preset, enabled, config, updated_at)
          VALUES (?, ?, 0, ?, unixepoch())
          ON CONFLICT(user_id, preset) DO NOTHING
        `).run(body.userId, body.preset, JSON.stringify({ ...DEFAULT_CONFIG, ...presetFieldsFor(body.preset) }));

        const row = db.prepare("SELECT config FROM bot_state WHERE user_id = ? AND preset = ?").get(body.userId, body.preset) as
          | { config: string }
          | undefined;
        if (!row) return json({ error: "Aucune configuration trouvée pour cet utilisateur/preset." }, 404);

        const config = JSON.parse(row.config) as AutoTraderConfig;
        if (body.resetToCanonical) {
          const { stakeUsd, maxDailyLossUsd, mode, excludedSymbols, minConfidence, maxConfidence, autoRollbackEnabled } = config;
          Object.assign(config, presetFieldsFor(body.preset), {
            stakeUsd, maxDailyLossUsd, excludedSymbols, minConfidence, maxConfidence, autoRollbackEnabled,
            mode: body.preset === "boom900" || body.preset === "scalping" || body.preset === "liquidity" || body.preset === "gold" || body.preset === "crash900" || body.preset.endsWith("v2") ? "demo" : mode,
          });
        }
        if (body.symbols !== undefined) {
          if (!Array.isArray(body.symbols) || body.symbols.some((s) => typeof s !== "string")) {
            return json({ error: "symbols doit être un tableau de chaînes." }, 400);
          }
          config.symbols = body.symbols;
        }
        if (body.minConfidence !== undefined) {
          if (typeof body.minConfidence !== "number" || body.minConfidence < 0 || body.minConfidence > 100) {
            return json({ error: "minConfidence doit être un nombre entre 0 et 100." }, 400);
          }
          config.minConfidence = body.minConfidence;
        }
        if (body.maxConfidence !== undefined) {
          if (typeof body.maxConfidence !== "number" || body.maxConfidence < 0 || body.maxConfidence > 100) {
            return json({ error: "maxConfidence doit être un nombre entre 0 et 100." }, 400);
          }
          config.maxConfidence = body.maxConfidence;
        }
        if (body.excludedSymbols !== undefined) {
          if (!Array.isArray(body.excludedSymbols) || body.excludedSymbols.some((s) => typeof s !== "string")) {
            return json({ error: "excludedSymbols doit être un tableau de chaînes." }, 400);
          }
          config.excludedSymbols = body.excludedSymbols;
        }
        if (body.autoRollbackEnabled !== undefined) {
          if (typeof body.autoRollbackEnabled !== "boolean") {
            return json({ error: "autoRollbackEnabled doit être un booléen." }, 400);
          }
          config.autoRollbackEnabled = body.autoRollbackEnabled;
        }
        if (body.configOverride !== undefined) {
          if (typeof body.configOverride !== "object" || body.configOverride === null) {
            return json({ error: "configOverride doit être un objet." }, 400);
          }
          Object.assign(config, body.configOverride);
        }

        // The three Gold strategies are never allowed to trade through the
        // shared macro-news block, even if a stale admin configuration tries
        // to disable it.
        if (isGoldPreset(body.preset)) {
          config.newsFilter = true;
          config.broker = "oanda";
          config.enableOanda = true;
          config.enableDeriv = false;
          config.instrumentType = "multiplier";
        }

        updateConfigForUser(body.userId, body.preset, config, admin.id);

        return json({ success: true, preset: body.preset, config });
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
