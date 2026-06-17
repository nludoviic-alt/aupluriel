import { createFileRoute } from "@tanstack/react-router";
import { getUserFromRequest } from "@/lib/auth.server";

export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return new Response(JSON.stringify({ error: "Non authentifié" }), { status: 401 });

        const formData = await request.formData();
        const audio = formData.get("audio") as File | null;
        const clientKey = (formData.get("apiKey") as string | null)?.trim() || undefined;

        if (!audio) {
          return new Response(JSON.stringify({ error: "Fichier audio manquant" }), { status: 400 });
        }

        const apiKey = clientKey ?? process.env.GROQ_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Clé API Groq manquante. Configure-la dans Paramètres." }),
            { status: 401 },
          );
        }

        const body = new FormData();
        body.append("file", audio, "audio.webm");
        body.append("model", "whisper-large-v3-turbo");
        body.append("response_format", "json");
        body.append("language", "fr");

        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return new Response(
            JSON.stringify({ error: (err as { error?: { message?: string } }).error?.message ?? `Groq error ${res.status}` }),
            { status: res.status },
          );
        }

        const data = (await res.json()) as { text: string };
        return new Response(JSON.stringify({ text: data.text }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
