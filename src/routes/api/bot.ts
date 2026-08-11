// Control endpoint for the SERVER auto-trader (bot-engine.server.ts) — the
// engine that keeps trading with the app closed / phone locked.
//
// A user can run up to three independent engines at once (2026-08-01):
// Default ("Multi"), Boom, Crash — each with its own bot_state row, own
// config, own risk caps (no shared/aggregate daily-loss cap by design; each
// preset's cap is independent, so worst-case exposure is the SUM of the
// three, not one shared number — a deliberate simplicity-over-safety choice
// made with the user, not an oversight).
import { createFileRoute } from "@tanstack/react-router";
import { getFullUserFromRequest } from "@/lib/auth.server";
import { getDb } from "@/lib/db.server";
import {
  getAllTimeStats,
  getBotRuntime,
  getBotTrades,
  getOpenBotTrades,
  getBrokerBalances,
  getRecentPerformance,
  getTodayStats,
  loadBotConfig,
  startBotForUser,
  stopBotForUser,
  updateConfigForUser,
  getVisiblePresets,
  ACTIVE_PRESETS,
  type Preset,
} from "@/lib/bot-engine.server";
import { DEFAULT_CONFIG, type AutoTraderConfig } from "@/lib/signal-core";
import { BOOM_PRESET, BOOM900_PRESET, BOOM_V2_PRESET, CRASH_PRESET, CRASH500_PRESET, CRASH900_V2_PRESET, GOLD_PRESET, GOLD_V2_PRESET, LIQUIDITY_PRESET, LIQUIDITY_V2_PRESET, SCALPING_PRESET, SCALPING_V2_PRESET } from "@/lib/autotrader";

const PRESETS: Preset[] = [...ACTIVE_PRESETS];
const REPLACED_V1: Partial<Record<Preset, Preset>> = {
  boomv2: "boom",
  scalpingv2: "scalping",
  liquidityv2: "liquidity",
  goldv2: "gold",
};

function isGoldPreset(preset: Preset): boolean {
  return preset === "gold" || preset === "goldv2" || preset === "liquidity" || preset === "liquidityv2";
}

function presetFieldsFor(preset: Preset): Partial<AutoTraderConfig> {
  if (preset === "boom") return BOOM_PRESET;
  if (preset === "boom900") return BOOM900_PRESET;
  if (preset === "crash") return CRASH_PRESET;
  if (preset === "crash500") return CRASH500_PRESET;
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

function loadStatusForPreset(userId: number, preset: Preset) {
  const state = getDb()
    .prepare("SELECT enabled, config FROM bot_state WHERE user_id = ? AND preset = ?")
    .get(userId, preset) as { enabled: number; config: string } | undefined;
  const runtime = getBotRuntime(userId, preset);
  const trades = getBotTrades(userId, preset, 20);
  const savedConfig = loadBotConfig(userId, preset);
  const mode: "demo" | "live" = savedConfig?.mode === "live" ? "live" : "demo";
  // SQL over ALL of today's rows — summing the 20-trade window instead
  // made early wins vanish from the display as new events pushed them out.
  const today = getTodayStats(userId, preset, mode);
  // All-time record — shown before a live-mode start so that decision is
  // informed by this preset's actual track record, not a guess.
  const allTime = getAllTimeStats(userId, preset, mode);

  return {
    enabled: !!state?.enabled,
    running: runtime.running,
    mode,
    savedConfig,
    pausedUntil: runtime.pausedUntil,
    lastScan: runtime.lastScan,
    lastError: runtime.lastError,
    todayPnl: today.pnl,
    todayFloatingLoss: today.floatingLoss,
    todayRiskPnl: today.riskPnl,
    todayCount: today.count,
    todayWins: today.wins,
    todayLosses: today.losses,
    todayTotalWon: today.totalWon,
    todayTotalLost: today.totalLost,
    trades,
    openTrades: getOpenBotTrades(userId, preset),
    allTimeStats: allTime,
  };
}

export const Route = createFileRoute("/api/bot")({
  server: {
    handlers: {
      // Status + recent trades for all three presets, plus shared broker balances.
      GET: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const presets = Object.fromEntries(PRESETS.map((p) => [p, loadStatusForPreset(user.id, p)]));
        const brokerBalances = await getBrokerBalances(user.id);

        // Every preset's status is still returned in full above, whatever
        // visiblePresets says — it only drives which MOBILE tabs the
        // Auto-Trader renders, never what the server computes or trades.
        return json({ presets, brokerBalances, visiblePresets: getVisiblePresets(user.id) });
      },

      // start / stop / reset, always scoped to one preset.
      POST: async ({ request }) => {
        const user = await getFullUserFromRequest(request);
        if (!user) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          action?: "start" | "stop" | "reset" | "update";
          preset?: Preset;
          config?: Partial<AutoTraderConfig>;
        };

        if (!PRESETS.includes(body.preset as Preset)) {
          return json({ error: "Preset inconnu." }, 400);
        }
        const preset = body.preset as Preset;

        if (body.action === "start") {
          // Config: on reprend la config sauvegardée en DB pour CE preset (via
          // loadBotConfig qui fusionne avec DEFAULT_CONFIG) puis on override
          // avec les champs que l'utilisateur peut ajuster au démarrage (mise,
          // mode). Un preset jamais démarré repart des valeurs canoniques du
          // preset (BOOM_PRESET/CRASH_PRESET/DEFAULT_CONFIG).
          const requested = body.config ?? {};
          const stakeUsd = clamp(Number(requested.stakeUsd) || DEFAULT_CONFIG.stakeUsd, 1, 100);
          const savedConfig = loadBotConfig(user.id, preset) ?? { ...DEFAULT_CONFIG, ...presetFieldsFor(preset) };
          // Plancher : une mise relevée sans relever maxDailyLossUsd en même
          // temps piège le bot après ~1 perte (constaté en prod : mise $18 vs
          // plafond $15, pause jusqu'à minuit après une seule perte normale —
          // même classe d'incohérence que le trailing stop du preset Boom,
          // voir le commentaire sur BOOM_PRESET.trailingStopMinPeakUsd). Le
          // plafond doit couvrir au moins maxConsecutiveLosses pertes à mise
          // pleine, sinon une série normale — pas une dérive — tue la journée.
          const lossFloor = stakeUsd * (savedConfig.maxConsecutiveLosses || DEFAULT_CONFIG.maxConsecutiveLosses);
          const maxDailyLossUsd = clamp(
            Math.max(Number(requested.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd, lossFloor),
            1,
            500,
          );
          // Scalping never trades real money — it's an isolated experiment
          // (see SCALPING_PRESET's header comment), forced back to demo
          // server-side regardless of what's requested, not just defaulted
          // client-side where a stale draft could slip through.
          const mode = preset === "boom" || preset === "boom900" || preset === "crash500" || preset === "scalping" || preset === "liquidity" || preset === "gold" || preset === "crash900" || preset.endsWith("v2") ? "demo" : requested.mode === "live" ? "live" : "demo";
          const config: AutoTraderConfig = {
            ...savedConfig,
            stakeUsd,
            maxDailyLossUsd,
            mode,
            ...(isGoldPreset(preset) ? {
              newsFilter: true,
              broker: "oanda",
              enableOanda: true,
              enableDeriv: false,
              instrumentType: "multiplier",
            } : {}),
          };
          try {
            await startBotForUser(user.id, preset, config);
            // A V2 is a separate hypothesis, not an extra source of exposure.
            // Stop its predecessor's scan only after V2 successfully starts.
            // stopBotForUser deliberately keeps a currently open position
            // subscribed until closure, so no position is orphaned.
            const predecessor = REPLACED_V1[preset];
            if (predecessor) stopBotForUser(user.id, predecessor, `Remplacé par ${preset} pour validation isolée`);
          } catch (e) {
            return json({ error: (e as Error).message }, 400);
          }
          return json({
            ok: true, running: true, preset, mode, maxDailyLossUsd,
            adjustedLossCap: maxDailyLossUsd !== clamp(Number(requested.maxDailyLossUsd) || DEFAULT_CONFIG.maxDailyLossUsd, 1, 500),
          });
        }

        if (body.action === "stop") {
          stopBotForUser(user.id, preset, "Arrêté manuellement par l'utilisateur");
          return json({ ok: true, running: false, preset });
        }

        if (body.action === "update") {
          const current = loadBotConfig(user.id, preset) ?? {
            ...DEFAULT_CONFIG,
            ...presetFieldsFor(preset),
          };
          const next: AutoTraderConfig = { ...current, ...(body.config ?? {}) };
          // Defense-in-depth: body.config is untyped request input, so a stale
          // client could still send "simulation" even though TradingMode no
          // longer allows it at compile time.
          if ((next.mode as string) === "simulation") next.mode = "demo";
          if (preset === "boom" || preset === "boom900" || preset === "crash500" || preset === "scalping" || preset === "liquidity" || preset === "gold" || preset === "crash900" || preset.endsWith("v2")) next.mode = "demo"; // experimental presets never use real money
          if (isGoldPreset(preset)) {
            next.newsFilter = true;
            next.broker = "oanda";
            next.enableOanda = true;
            next.enableDeriv = false;
            next.instrumentType = "multiplier";
          }
          const increasesFrequency =
            Number(next.maxOpenPositions ?? 0) > Number(current.maxOpenPositions ?? 0)
            || Number(next.maxSimultaneousTrades ?? 0) > Number(current.maxSimultaneousTrades ?? 0);
          if (increasesFrequency) {
            const recent = getRecentPerformance(user.id, preset, 100);
            if (recent.trades === 100 && recent.profitFactor < 1) {
              return json({
                error: `Augmentation refusée : les 100 derniers trades ${preset} ont un profit factor de ${recent.profitFactor.toFixed(2)} et une espérance de ${recent.expectancy >= 0 ? "+" : ""}$${recent.expectancy.toFixed(2)}.`,
                code: "NEGATIVE_RECENT_EDGE",
                recent,
              }, 409);
            }
          }
          getDb().prepare(`
            INSERT INTO bot_state (user_id, preset, enabled, config, updated_at)
            VALUES (?, ?, 0, ?, unixepoch())
            ON CONFLICT(user_id, preset) DO NOTHING
          `).run(user.id, preset, JSON.stringify(next));
          updateConfigForUser(user.id, preset, next);
          return json({ ok: true, preset, config: next });
        }

        // Reset this ONE preset's config back to its canonical values —
        // replaces the old cross-preset "switch" action now that all three
        // run independently. Money fields (stake/cap/mode) and per-account
        // curation (excludedSymbols/minConfidence/maxConfidence — see
        // /api/admin/user-config) are deliberately preserved, same guarantee
        // as before: a preset reset must never silently move money settings
        // or wipe out an admin-tuned override (bug found in prod 2026-08-01:
        // BOOM600 retraded, minConfidence dropped 80→55 after exactly this
        // kind of reset with no preservation).
        if (body.action === "reset") {
          const current = loadBotConfig(user.id, preset) ?? { ...DEFAULT_CONFIG };
          const {
            stakeUsd,
            maxDailyLossUsd,
            mode,
            symbolMode,
            symbols,
            excludedSymbols,
            minConfidence,
            maxConfidence,
            minTfAgreement,
            maxSimultaneousTrades,
            maxOpenPositions,
          } = current;
          const next: AutoTraderConfig = {
            ...current,
            ...presetFieldsFor(preset),
            stakeUsd,
            maxDailyLossUsd,
            // never real money — see SCALPING_PRESET/LIQUIDITY_PRESET/GOLD_PRESET; the "start" and
            // "update" actions and /api/admin/user-config's resetToCanonical all gate
            // these presets the same way, this one had only checked scalping.
            mode: preset === "boom" || preset === "boom900" || preset === "crash500" || preset === "scalping" || preset === "liquidity" || preset === "gold" || preset === "crash900" || preset.endsWith("v2") ? "demo" : mode,
            symbolMode,
            symbols,
            excludedSymbols,
            minConfidence,
            maxConfidence,
            minTfAgreement,
            maxSimultaneousTrades,
            maxOpenPositions,
            ...(isGoldPreset(preset) ? {
              newsFilter: true,
              broker: "oanda",
              enableOanda: true,
              enableDeriv: false,
              instrumentType: "multiplier",
            } : {}),
          };

          // updateConfigForUser only UPDATEs — a preset never started has no
          // bot_state row yet, so the reset would silently no-op.
          getDb().prepare(`
            INSERT INTO bot_state (user_id, preset, enabled, config, updated_at) VALUES (?, ?, 0, ?, unixepoch())
            ON CONFLICT(user_id, preset) DO NOTHING
          `).run(user.id, preset, JSON.stringify(next));
          updateConfigForUser(user.id, preset, next);

          return json({ ok: true, preset, config: next });
        }

        return json({ error: "action start|stop|reset|update requise" }, 400);
      },
    },
  },
});

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
