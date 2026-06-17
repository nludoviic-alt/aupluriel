import { useCallback, useRef, useState } from "react";

interface UseWhisperOptions {
  apiKey?: string;
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

interface UseWhisperReturn {
  listening: boolean;
  supported: boolean;
  toggle: () => void;
}

export function useWhisper({ apiKey, onTranscript, onError }: UseWhisperOptions = {}): UseWhisperReturn {
  const [listening, setListening] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const supported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const stop = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (listening) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setListening(false);
        stream.getTracks().forEach((t) => t.stop());

        const blob = new Blob(chunksRef.current, { type: mimeType });
        if (blob.size < 1000) return;

        try {
          const form = new FormData();
          form.append("audio", blob, "audio.webm");
          if (apiKey) form.append("apiKey", apiKey);

          const token = localStorage.getItem("lio23.token") ?? "";
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });

          const data = await res.json() as { text?: string; error?: string };
          if (!res.ok || data.error) {
            onError?.(data.error ?? `Erreur transcription ${res.status}`);
            return;
          }
          if (data.text?.trim()) onTranscript?.(data.text.trim());
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "Erreur réseau");
        }
      };

      recorder.start();
      setListening(true);
    } catch (err) {
      setListening(false);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        onError?.("Permission micro refusée — autorise le micro dans les paramètres Chrome.");
      } else {
        onError?.(msg);
      }
    }
  }, [listening, apiKey, onTranscript, onError]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { listening, supported, toggle };
}
