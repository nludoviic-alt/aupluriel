import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bot, CheckCircle2, AlertTriangle, Clock, Info, X, MessageCircle, Zap, Lock } from "lucide-react";
import { useCoach } from "@/hooks/use-coach";
import type { CoachMessage, CoachTone } from "@/lib/coach";
import { cn } from "@/lib/utils";

/** Short two-tone chime via WebAudio — no asset needed. */
function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {}
}

const TONE: Record<
  CoachTone,
  { icon: typeof Info; ring: string; dot: string; chip: string; chipText: string; label: string }
> = {
  go: {
    icon: CheckCircle2,
    ring: "border-[color:var(--bull)]/40",
    dot: "bg-[color:var(--bull)]",
    chip: "bg-[color:var(--bull)]/15",
    chipText: "text-[color:var(--bull)]",
    label: "Tu peux trader",
  },
  caution: {
    icon: AlertTriangle,
    ring: "border-amber-500/40",
    dot: "bg-amber-500",
    chip: "bg-amber-500/15",
    chipText: "text-amber-500",
    label: "Prudence",
  },
  wait: {
    icon: Clock,
    ring: "border-[color:var(--brand-violet)]/40",
    dot: "bg-[color:var(--brand-violet)]",
    chip: "bg-[color:var(--brand-violet)]/15",
    chipText: "text-[color:var(--brand-violet)]",
    label: "Attends",
  },
  info: {
    icon: Info,
    ring: "border-[color:var(--brand-cyan)]/40",
    dot: "bg-[color:var(--brand-cyan)]",
    chip: "bg-[color:var(--brand-cyan)]/15",
    chipText: "text-[color:var(--brand-cyan)]",
    label: "Info",
  },
};

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h`;
}

function Bubble({ msg, onTrade }: { msg: CoachMessage; onTrade: (m: CoachMessage) => void }) {
  const tone = TONE[msg.tone];
  const Icon = msg.locked ? Lock : tone.icon;
  // Locked = trade already running; don't offer to open another / contradict it.
  const canTrade = !msg.locked && (msg.tone === "go" || msg.tone === "caution");
  return (
    <div className="flex items-start gap-2.5">
      <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full", tone.chip)}>
        <Icon className={cn("h-4 w-4", tone.chipText)} />
      </div>
      <div className={cn("min-w-0 flex-1 rounded-2xl rounded-tl-sm border bg-muted/20 px-3 py-2", tone.ring)}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{msg.title}</span>
          <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", tone.chip, tone.chipText)}>
            {msg.locked ? "Trade en cours" : tone.label}
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{msg.text}</p>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground/70">{timeAgo(msg.time)}</span>
          {canTrade && (
            <button
              onClick={() => onTrade(msg)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-opacity hover:opacity-90",
                msg.tone === "go"
                  ? "bg-[color:var(--bull)]/15 text-[color:var(--bull)]"
                  : "bg-amber-500/15 text-amber-500",
              )}
            >
              <Zap className="h-3 w-3" />
              Trader maintenant
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Floating "market coach" that pops chat-style bubbles explaining current
 * market conditions and whether it's a good moment to trade.
 */
export function MarketCoach() {
  const [open, setOpen] = useState(false);
  const { messages, loading } = useCoach(true);
  const seenRef = useRef(0);
  const [unseen, setUnseen] = useState(0);
  const navigate = useNavigate();
  const announcedRef = useRef<Set<string>>(new Set());
  // A "go" must persist across 2 consecutive scans before it pings the user,
  // so a one-off flicker that reverses next scan never triggers an alert.
  const pendingRef = useRef<Map<string, number>>(new Map());

  // Track new messages as an unread badge while the panel is closed.
  useEffect(() => {
    if (open) {
      seenRef.current = messages.length;
      setUnseen(0);
    } else if (messages.length > seenRef.current) {
      setUnseen(messages.length - seenRef.current);
    }
  }, [messages, open]);

  // Alert (toast + chime) when a CONFIRMED "trade now" opportunity appears.
  useEffect(() => {
    // Live "go" candidates (skip locked holds — those were already announced).
    const candidates = messages.filter((m) => m.tone === "go" && !m.locked);
    const activeKeys = new Set(candidates.map((m) => `${m.symbol}:${m.verdict}`));

    const confirmed: typeof candidates = [];
    for (const m of candidates) {
      const key = `${m.symbol}:${m.verdict}`;
      if (announcedRef.current.has(key)) continue; // already pinged
      const count = (pendingRef.current.get(key) ?? 0) + 1;
      pendingRef.current.set(key, count);
      if (count >= 2) {
        confirmed.push(m);
        announcedRef.current.add(key);
        pendingRef.current.delete(key);
      }
    }
    // Reset confirmation streak for any "go" that disappeared this scan.
    pendingRef.current.forEach((_, k) => {
      if (!activeKeys.has(k)) pendingRef.current.delete(k);
    });

    if (confirmed.length) {
      const first = confirmed[0];
      playChime();
      toast.success(`📈 ${first.label} — feu vert confirmé pour trader`, {
        description: first.text,
        action: {
          label: "Trader",
          onClick: () => navigate({ to: "/autotrader", search: { pair: first.symbol } as never }),
        },
      });
    }

    // Drop verdicts that are no longer active so they can re-alert later.
    const allActive = new Set(messages.map((m) => `${m.symbol}:${m.verdict}`));
    announcedRef.current.forEach((k) => {
      if (!allActive.has(k)) announcedRef.current.delete(k);
    });
  }, [messages, navigate]);

  function handleTrade(m: CoachMessage) {
    navigate({ to: "/autotrader", search: { pair: m.symbol } as never });
    setOpen(false);
  }

  const actionable = messages.filter((m) => m.tone === "go" || m.tone === "caution").length;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="glass-panel flex max-h-[70vh] w-[min(92vw,22rem)] flex-col overflow-hidden rounded-2xl border border-border shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)]">
                <Bot className="h-4 w-4" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-semibold text-foreground">Coach marché</div>
                <div className="text-[10px] text-muted-foreground">
                  {loading ? "Analyse en cours…" : "Mis à jour en direct"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
              aria-label="Fermer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-xs text-muted-foreground">
                <Bot className="h-6 w-6 animate-pulse text-[color:var(--brand-cyan)]" />
                {loading ? "J'analyse les marchés…" : "Aucune condition notable pour le moment."}
              </div>
            ) : (
              messages.map((m) => <Bubble key={m.id} msg={m} onTrade={handleTrade} />)
            )}
          </div>

          <div className="border-t border-border/60 px-4 py-2 text-[10px] leading-relaxed text-muted-foreground">
            ⚠️ Analyses, pas des conseils financiers. Décision finale humaine.
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-[color:var(--background)] shadow-xl transition-transform hover:scale-105 active:scale-95"
        aria-label="Coach marché"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {!open && (unseen > 0 || actionable > 0) && (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[color:var(--bear)] px-1 text-[10px] font-bold text-white">
            {unseen > 0 ? unseen : actionable}
          </span>
        )}
      </button>
    </div>
  );
}
