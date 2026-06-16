import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in standard TS lib DOM).
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResultItem {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResultItem;
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface UseSpeechOptions {
  lang?: string;
  continuous?: boolean;
  /** Called with the final recognized transcript when the user stops speaking. */
  onFinal?: (transcript: string) => void;
  /** Called continuously with the live (interim) transcript. */
  onInterim?: (transcript: string) => void;
}

export function useSpeech({
  lang = "fr-FR",
  continuous = false,
  onFinal,
  onInterim,
}: UseSpeechOptions = {}) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);

  onFinalRef.current = onFinal;
  onInterimRef.current = onInterim;

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = continuous;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let interim = "";
      let final = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const alt = res[0];
        if (res.isFinal) final += alt.transcript;
        else interim += alt.transcript;
      }
      if (interim) onInterimRef.current?.(interim);
      if (final) onFinalRef.current?.(final.trim());
    };

    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    rec.onstart = () => setListening(true);

    recognitionRef.current = rec;
    return () => {
      try { rec.abort(); } catch {}
    };
  }, [lang, continuous]);

  const start = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec || listening) return;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, [listening]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { listening, supported, start, stop, toggle };
}

// ─── Text-to-speech (voice replies) ────────────────────────────────────────────

export function speak(text: string, lang = "fr-FR") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  // Strip markdown for cleaner speech
  const clean = text
    .replace(/[#*`_>-]/g, "")
    .replace(/\n+/g, ". ")
    .slice(0, 600);
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = lang;
  utter.rate = 1.05;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}
