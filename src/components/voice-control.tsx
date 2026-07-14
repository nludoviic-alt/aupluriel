import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { useSpeech } from "@/hooks/use-speech";
import { parseVoiceCommand } from "@/lib/voice-commands";
import { cn } from "@/lib/utils";

export const VOICE_ACTION_EVENT = "lio23-voice-action";

/** Pages can listen for voice actions they handle (start-bot, stop-bot, new-chat). */
export function dispatchVoiceAction(type: string) {
  window.dispatchEvent(new CustomEvent(VOICE_ACTION_EVENT, { detail: { type } }));
}

export function VoiceControl() {
  const router = useRouter();
  const [interim, setInterim] = useState("");

  const { listening, supported, toggle } = useSpeech({
    lang: "fr-FR",
    onInterim: (t) => setInterim(t),
    onFinal: (transcript) => {
      setInterim("");
      handleCommand(transcript);
    },
  });

  function handleCommand(transcript: string) {
    const cmd = parseVoiceCommand(transcript);
    switch (cmd.type) {
      case "navigate":
        if (cmd.route) {
          router.navigate({ to: cmd.route });
          toast.success(cmd.label);
        }
        break;
      case "start-bot":
        router.navigate({ to: "/autotrader" });
        setTimeout(() => dispatchVoiceAction("start-bot"), 300);
        toast.info("Démarrage de l'auto-trader…");
        break;
      case "stop-bot":
        router.navigate({ to: "/autotrader" });
        setTimeout(() => dispatchVoiceAction("stop-bot"), 300);
        toast.info("Arrêt de l'auto-trader…");
        break;
      case "new-chat":
        router.navigate({ to: "/assistant" });
        setTimeout(() => dispatchVoiceAction("new-chat"), 300);
        break;
      case "refresh":
        router.invalidate();
        toast.success("Actualisé");
        break;
      default:
        toast.error(`Commande non reconnue : "${cmd.raw}"`);
    }
  }

  if (!supported) return null;

  return (
    <div className="relative flex items-center">
      <button
        onClick={toggle}
        title="Commande vocale — dites par exemple « ouvre le portfolio » ou « démarre le bot »"
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-xl border px-3.5 text-xs transition-all duration-300",
          listening
            ? "border-[color:var(--bear)]/50 bg-[color:var(--bear)]/10 text-[color:var(--bear)] animate-pulse"
            : "border-white/5 bg-white/[0.03] text-muted-foreground hover:text-foreground hover:bg-white/[0.08] hover:border-white/10",
        )}
      >
        {listening ? <Mic className="h-3.5 w-3.5" /> : <MicOff className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{listening ? "À l'écoute…" : "Voix"}</span>
      </button>

      {/* Live transcript bubble */}
      {listening && interim && (
        <div className="absolute top-full right-0 mt-2 w-64 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground shadow-xl z-50">
          <span className="text-muted-foreground">« </span>
          {interim}
          <span className="text-muted-foreground"> »</span>
        </div>
      )}
    </div>
  );
}
