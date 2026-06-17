import { useEffect, useRef, useState } from "react";
import {
  buildCoachMessages,
  loadCoachSymbols,
  isEmergencyVerdict,
  COACH_CONFIG_EVENT,
  type CoachMessage,
  type CoachTone,
} from "@/lib/coach";

const REFRESH_MS = 10 * 60_000; // re-analyse the market every 10 minutes
const WARMUP_MS = 4000; // let the page render before the first heavy scan
const MAX_MESSAGES = 4;
const HOLD_FALLBACK_MS = 15 * 60_000; // default lock if no contract duration set

/** Lock a "go" verdict for the length of a typical trade so the coach
 *  doesn't contradict itself mid-trade. Tied to the auto-trader contract. */
function tradeLockMs(): number {
  try {
    const cfg = JSON.parse(localStorage.getItem("lio23.autotrader_config") ?? "{}");
    if (typeof cfg.durationMinutes === "number" && cfg.durationMinutes > 0) {
      return cfg.durationMinutes * 60_000;
    }
  } catch {}
  return HOLD_FALLBACK_MS;
}

const TONE_ORDER: Record<CoachTone, number> = { go: 0, caution: 1, wait: 2, info: 3 };

/**
 * Live "market coach": periodically analyses the watched symbols and returns
 * plain-language advice (trade / wait / caution) as chat-style messages.
 * Runs entirely client-side on top of the Deriv websocket data.
 */
export function useCoach(enabled = true) {
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const runningRef = useRef(false);
  // Per-symbol lock: a "go" verdict held until `until` so advice can't flip.
  const lockRef = useRef<Record<string, { msg: CoachMessage; until: number }>>({});

  useEffect(() => {
    if (!enabled) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    async function run() {
      if (runningRef.current) return; // avoid overlapping scans
      runningRef.current = true;
      setLoading(true);
      try {
        const symbols = loadCoachSymbols();
        // Analyse every watched symbol (one message each) so the lock layer
        // can see each pair's current verdict before we trim for display.
        const fresh = await buildCoachMessages(
          ["asia", "london", "newyork"],
          symbols.length || MAX_MESSAGES,
          symbols,
        );
        if (cancelled) return;

        const now = Date.now();
        const hold = tradeLockMs();
        const stable = fresh.map((m) => {
          const lock = lockRef.current[m.symbol];
          const locked = lock && now < lock.until;
          const emergency = isEmergencyVerdict(m.verdict);

          // Inside an active lock: keep the original "go" advice unless a real
          // danger appears — then we release the lock and surface the warning.
          if (locked && !emergency && m.verdict !== lock.msg.verdict) {
            return {
              ...lock.msg,
              time: now,
              title: `${lock.msg.label} — trade en cours`,
              text: "Position favorable détectée — laisse courir jusqu'à la clôture du contrat. Le coach attend la fin du trade avant de réévaluer.",
              locked: true,
            } as CoachMessage;
          }
          if (locked && emergency) delete lockRef.current[m.symbol]; // danger overrides

          // Fresh advice: open a lock when a new "go" fires.
          if (m.verdict !== lock?.msg.verdict && m.tone === "go") {
            lockRef.current[m.symbol] = { msg: m, until: now + hold };
          } else if (!locked) {
            delete lockRef.current[m.symbol];
          }
          return m;
        });

        // Sort go-first, then trim for the panel.
        stable.sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone]);
        if (!cancelled) setMessages(stable.slice(0, MAX_MESSAGES));
      } catch {
        // keep last messages on failure
      } finally {
        if (!cancelled) setLoading(false);
        runningRef.current = false;
      }
    }

    const warmup = setTimeout(run, WARMUP_MS);
    const id = setInterval(run, REFRESH_MS);
    // Re-scan immediately when the user changes the watched pairs.
    window.addEventListener(COACH_CONFIG_EVENT, run);
    return () => {
      cancelled = true;
      clearTimeout(warmup);
      clearInterval(id);
      window.removeEventListener(COACH_CONFIG_EVENT, run);
    };
  }, [enabled]);

  return { messages, loading };
}
