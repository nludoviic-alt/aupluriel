import { createFileRoute, Link } from "@tanstack/react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Copy, KeyRound, Loader2, Mic, User, Volume2, VolumeX } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useSpeech, speak, stopSpeaking } from "@/hooks/use-speech";
import { cn } from "@/lib/utils";
import { VOICE_ACTION_EVENT } from "@/components/voice-control";

const AI_KEY_STORAGE = "lio23.ai_api_key";
const AI_PROVIDER_STORAGE = "lio23.ai_provider";

function getAiConfig(): { apiKey: string; provider: string } {
  return {
    apiKey: localStorage.getItem(AI_KEY_STORAGE) ?? "",
    provider: localStorage.getItem(AI_PROVIDER_STORAGE) ?? "anthropic",
  };
}

export const Route = createFileRoute("/assistant")({
  head: () => ({ meta: [{ title: "Assistant Lio23 — LIO23" }] }),
  component: AssistantPage,
});

const SUGGESTIONS = [
  "Analyse BTC/USD maintenant",
  "Quel est le meilleur trade du moment ?",
  "Lance un backtest RSI sur EUR/USD 1 an",
  "Explique-moi le MACD en 3 lignes",
  "Quels indicateurs combiner pour le scalping ?",
  "C'est quoi le ratio de Sharpe ?",
];

function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  function inlineFormat(raw: string): ReactNode[] {
    const parts: React.ReactNode[] = [];
    let rest = raw;
    let key = 0;
    while (rest.length > 0) {
      const boldMatch = rest.match(/\*\*(.+?)\*\*/);
      const italicMatch = rest.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
      const codeMatch = rest.match(/`([^`]+)`/);
      const candidates = [
        boldMatch ? { idx: boldMatch.index!, type: "bold", match: boldMatch } : null,
        italicMatch ? { idx: italicMatch.index!, type: "italic", match: italicMatch } : null,
        codeMatch ? { idx: codeMatch.index!, type: "code", match: codeMatch } : null,
      ].filter(Boolean) as { idx: number; type: string; match: RegExpMatchArray }[];
      if (!candidates.length) { parts.push(rest); break; }
      candidates.sort((a, b) => a.idx - b.idx);
      const first = candidates[0];
      if (first.idx > 0) parts.push(rest.slice(0, first.idx));
      if (first.type === "bold") parts.push(<strong key={key++}>{first.match[1]}</strong>);
      else if (first.type === "italic") parts.push(<em key={key++}>{first.match[1]}</em>);
      else if (first.type === "code") parts.push(<code key={key++} className="rounded bg-muted/50 px-1 py-0.5 font-mono text-[0.82em] text-[color:var(--brand-cyan)]">{first.match[1]}</code>);
      rest = rest.slice(first.idx + first.match[0].length);
    }
    return parts;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-muted/30 border border-border/40 p-3 text-xs font-mono leading-relaxed text-foreground/90">
          {lang && <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{lang}</div>}
          {codeLines.join("\n")}
        </pre>
      );
      i++;
      continue;
    }

    // HR
    if (/^---+$/.test(line.trim())) {
      elements.push(<hr key={i} className="my-3 border-border/40" />);
      i++;
      continue;
    }

    // Headings
    const h3 = line.match(/^###\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);
    const h1 = line.match(/^#\s+(.+)/);
    if (h3) { elements.push(<h3 key={i} className="mt-3 mb-1 text-sm font-semibold text-foreground">{inlineFormat(h3[1])}</h3>); i++; continue; }
    if (h2) { elements.push(<h2 key={i} className="mt-3 mb-1 text-base font-bold text-foreground">{inlineFormat(h2[1])}</h2>); i++; continue; }
    if (h1) { elements.push(<h1 key={i} className="mt-3 mb-1 text-lg font-bold text-foreground">{inlineFormat(h1[1])}</h1>); i++; continue; }

    // Unordered list
    if (/^[\-\*]\s/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <ul key={i} className="my-1 space-y-0.5 pl-4">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--brand-cyan)]" />
              <span>{inlineFormat(item)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line.trim())) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s/, ""));
        i++;
      }
      elements.push(
        <ol key={i} className="my-1 space-y-0.5 pl-4">
          {items.map((item, j) => (
            <li key={j} className="flex gap-2">
              <span className="shrink-0 text-[color:var(--brand-cyan)] font-semibold">{j + 1}.</span>
              <span>{inlineFormat(item)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      elements.push(<div key={i} className="h-2" />);
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(<p key={i} className="leading-relaxed">{inlineFormat(line)}</p>);
    i++;
  }

  return <div className="text-sm space-y-0.5">{elements}</div>;
}

function AssistantPage() {
  const [aiConfig, setAiConfig] = useState({ apiKey: "", provider: "anthropic" });

  useEffect(() => {
    setAiConfig(getAiConfig());
  }, []);

  const transport = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ apiKey: aiConfig.apiKey, provider: aiConfig.provider }),
    }),
  );

  // Rebuild transport when config changes
  useEffect(() => {
    transport.current = new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ apiKey: aiConfig.apiKey, provider: aiConfig.provider }),
    });
  }, [aiConfig]);

  const { messages, sendMessage, status } = useChat({ transport: transport.current });
  const [input, setInput] = useState("");
  const [voiceReply, setVoiceReply] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastSpokenRef = useRef<string>("");

  // Speech-to-text: dictate into the input, auto-send on final result
  const { listening, supported: micSupported, toggle: toggleMic } = useSpeech({
    lang: "fr-FR",
    onInterim: (t) => setInput(t),
    onFinal: (t) => {
      setInput("");
      submit(t);
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Voice command "nouvelle conversation"
  useEffect(() => {
    function onVoice(e: Event) {
      const type = (e as CustomEvent<{ type: string }>).detail?.type;
      if (type === "new-chat") window.location.reload();
    }
    window.addEventListener(VOICE_ACTION_EVENT, onVoice);
    return () => window.removeEventListener(VOICE_ACTION_EVENT, onVoice);
  }, []);

  const busy = status === "submitted" || status === "streaming";
  const hasKey = aiConfig.apiKey.length > 0;

  // Read assistant replies aloud when voice mode is on
  useEffect(() => {
    if (!voiceReply || busy) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;
    const text = last.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    if (text && text !== lastSpokenRef.current) {
      lastSpokenRef.current = text;
      speak(text);
    }
  }, [messages, busy, voiceReply]);

  async function submit(text?: string) {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput("");
    await sendMessage({ text: t });
    inputRef.current?.focus();
  }

  function copyText(text: string) {
    navigator.clipboard.writeText(text).then(() => toast.success("Copié !"));
  }

  const providerLabel =
    aiConfig.provider === "anthropic" ? "Claude · Anthropic"
    : aiConfig.provider === "openai" ? "GPT-4o-mini · OpenAI"
    : "Gemini · Google";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="relative flex items-center gap-4 border-b border-border/50 bg-gradient-to-r from-[color:var(--brand-cyan)]/5 via-transparent to-[color:var(--brand-violet)]/5 px-6 py-4">
        {/* Glow orb */}
        <div className="pointer-events-none absolute left-0 top-0 h-full w-48 bg-gradient-to-r from-[color:var(--brand-cyan)]/8 to-transparent" />

        <div className="relative h-11 w-11 shrink-0">
          <LogoMark className="h-11 w-11" />
          {hasKey && (
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-[color:var(--bull)]" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold tracking-tight">Assistant Lio23</h1>
          <p className="text-xs text-muted-foreground truncate">
            {hasKey ? providerLabel : "⚠️ Clé API non configurée — configure dans Paramètres"}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => {
              const next = !voiceReply;
              setVoiceReply(next);
              if (!next) stopSpeaking();
              else toast.success("🔊 Réponses vocales activées");
            }}
            title={voiceReply ? "Désactiver la lecture vocale" : "Lire les réponses à voix haute"}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
              voiceReply
                ? "border-[color:var(--brand-cyan)]/50 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)]"
                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {voiceReply ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            Voix
          </button>
          {messages.length > 0 && (
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-border hover:text-foreground"
            >
              Nouvelle conversation
            </button>
          )}
        </div>
      </div>

      {/* ── No API key banner ──────────────────────────────────── */}
      {!hasKey && (
        <div className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <KeyRound className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="text-muted-foreground">Configure ta clé API pour activer le chat IA.</span>
          </div>
          <Button asChild size="sm" variant="outline" className="shrink-0 text-xs border-[color:var(--brand-cyan)]/40 text-[color:var(--brand-cyan)] hover:bg-[color:var(--brand-cyan)]/5">
            <Link to="/settings">Configurer →</Link>
          </Button>
        </div>
      )}

      {/* ── Messages ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 py-6 scroll-smooth">

        {/* Empty state */}
        {messages.length === 0 && (
          <div className="mx-auto flex max-w-lg flex-col items-center py-12 text-center">
            <div className="relative mb-5">
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] opacity-20 blur-xl" />
              <div className="relative flex h-16 w-16 items-center justify-center">
                <LogoMark className="h-16 w-16" />
              </div>
            </div>
            <h3 className="text-xl font-bold tracking-tight">Comment puis-je t'aider ?</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Analyse de marché, signaux IA, backtest, gestion du risque…
            </p>
            <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => submit(s)}
                  className="group relative overflow-hidden rounded-xl border border-border/60 bg-muted/10 px-4 py-3 text-left text-sm text-foreground transition-all hover:border-[color:var(--brand-cyan)]/40 hover:bg-[color:var(--brand-cyan)]/5 hover:shadow-sm"
                >
                  <span className="relative z-10">{s}</span>
                  <div className="absolute inset-0 translate-x-[-100%] bg-gradient-to-r from-[color:var(--brand-cyan)]/5 to-transparent transition-transform group-hover:translate-x-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.map((m) => {
            const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
            const isUser = m.role === "user";
            return (
              <div key={m.id} className={cn("flex gap-3", isUser && "flex-row-reverse")}>

                {/* Avatar */}
                <div className={cn(
                  "relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white shadow-md",
                  isUser
                    ? "bg-gradient-to-br from-[color:var(--brand-cyan)] to-[color:var(--brand-cyan)]/70 shadow-[color:var(--brand-cyan)]/20"
                    : "shadow-[color:var(--brand-violet)]/20"
                )}>
                  {isUser ? <User className="h-4 w-4" /> : <LogoMark className="h-9 w-9" />}
                </div>

                {/* Bubble */}
                <div className={cn("group flex max-w-[78%] flex-col gap-1", isUser ? "items-end" : "items-start")}>
                  <div className={cn(
                    "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
                    isUser
                      ? "rounded-tr-sm bg-gradient-to-br from-[color:var(--brand-cyan)] to-[color:var(--brand-cyan)]/80 text-[color:var(--background)] font-medium"
                      : "rounded-tl-sm border border-border/40 bg-card/60 text-foreground backdrop-blur-sm",
                  )}>
                    {isUser ? (
                      <span className="whitespace-pre-wrap">{text}</span>
                    ) : text ? (
                      <MarkdownText text={text} />
                    ) : null}
                  </div>

                  {/* Copy button */}
                  {!isUser && text && (
                    <button
                      onClick={() => copyText(text)}
                      className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted/30 hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" /> Copier
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {status === "submitted" && (
            <div className="flex gap-3">
              <div className="h-9 w-9 shrink-0">
                <LogoMark className="h-9 w-9" />
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-border/40 bg-card/60 px-5 py-4 backdrop-blur-sm">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[color:var(--brand-cyan)] animate-bounce [animation-delay:0ms]" />
                  <span className="h-2 w-2 rounded-full bg-[color:var(--brand-cyan)] animate-bounce [animation-delay:150ms]" />
                  <span className="h-2 w-2 rounded-full bg-[color:var(--brand-cyan)] animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input bar ──────────────────────────────────────────── */}
      <div className="border-t border-border/50 bg-background/60 px-6 py-4 backdrop-blur-xl">
        <form
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          className="mx-auto flex max-w-3xl items-end gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-sm transition-all focus-within:border-[color:var(--brand-cyan)]/40 focus-within:shadow-[color:var(--brand-cyan)]/5"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            placeholder={listening ? "🎤 Parlez maintenant…" : "Pose une question… (Entrée pour envoyer)"}
            rows={1}
            className="max-h-36 min-h-[28px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            style={{ lineHeight: "1.6" }}
          />

          <div className="flex shrink-0 items-center gap-2">
            {micSupported && (
              <button
                type="button"
                onClick={toggleMic}
                title="Dicter à la voix"
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-xl transition-all",
                  listening
                    ? "bg-[color:var(--bear)] text-white animate-pulse shadow-md shadow-[color:var(--bear)]/30"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                )}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className={cn(
                "grid h-9 w-9 place-items-center rounded-xl transition-all",
                busy || !input.trim()
                  ? "bg-muted/30 text-muted-foreground/40 cursor-not-allowed"
                  : "bg-gradient-to-br from-[color:var(--brand-cyan)] to-[color:var(--brand-violet)] text-white shadow-md shadow-[color:var(--brand-cyan)]/30 hover:shadow-lg hover:shadow-[color:var(--brand-cyan)]/40 hover:scale-105 active:scale-95",
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </form>
        <p className="mt-2 text-center text-xs text-muted-foreground/50">
          Entrée pour envoyer · Shift+Entrée pour nouvelle ligne
        </p>
      </div>
    </div>
  );
}
