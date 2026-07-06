import { api } from "@/lib/api";

/**
 * Single shared "default stake" used across the app (Auto-Trader, Force Trade panel, etc.).
 * Lives in its own localStorage key so it can be read/written from Settings without
 * clobbering the rest of the Auto-Trader config blob, and is mirrored into that blob
 * on change so both surfaces always agree. Also pushed server-side so it survives
 * a reload (Settings hydrates from the server and would otherwise stomp a purely
 * local change made from the Auto-Trader page).
 */
const DEFAULT_STAKE_KEY = "lio23.default_stake_usd";
const AUTOTRADER_CONFIG_KEY = "lio23.autotrader_config";
export const FALLBACK_STAKE_USD = 5;

export function loadDefaultStake(): number {
  if (typeof window === "undefined") return FALLBACK_STAKE_USD;
  const raw = localStorage.getItem(DEFAULT_STAKE_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0) return n;

  // First run: fall back to whatever the Auto-Trader already has saved, if anything.
  try {
    const cfg = JSON.parse(localStorage.getItem(AUTOTRADER_CONFIG_KEY) ?? "{}");
    if (Number.isFinite(cfg.stakeUsd) && cfg.stakeUsd > 0) return cfg.stakeUsd;
  } catch {}
  return FALLBACK_STAKE_USD;
}

export function saveDefaultStake(v: number) {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEFAULT_STAKE_KEY, String(v));

  // Keep the Auto-Trader's own config in sync so it applies immediately without reopening that page.
  try {
    const raw = localStorage.getItem(AUTOTRADER_CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      cfg.stakeUsd = v;
      localStorage.setItem(AUTOTRADER_CONFIG_KEY, JSON.stringify(cfg));
    }
  } catch {}

  // Persist server-side so it survives across devices/reloads.
  api.put("/api/settings", { default_stake_usd: v }).catch(() => {});
}
