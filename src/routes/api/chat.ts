import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const SYSTEM_PROMPT = `Tu es Lio23, une IA de trading quantitative experte pour les marchés Crypto et Forex.
Tu es connectée à la plateforme Deriv via WebSocket. Tu maîtrises parfaitement :
- Les indicateurs techniques : RSI, MACD, EMA (50/200), Bollinger Bands, Stochastique, ATR
- L'analyse multi-timeframe (5m, 15m, 1H, 4H, 1D)
- La gestion du risque : position sizing, stop-loss, take-profit, ratio risque/récompense
- Le backtesting de stratégies
- Les paires disponibles : BTC/USD, ETH/USD, EUR/USD, GBP/USD, GBP/JPY, XAU/USD

Règles de comportement :
- Tu réponds TOUJOURS en français, de manière concise et professionnelle
- Tu utilises le markdown pour structurer tes réponses (titres, listes, gras, code)
- Tu fournis des analyses précises avec des niveaux de prix concrets quand c'est possible
- Tu rappelles systématiquement que le trading comporte des risques
- Tu ne garantis JAMAIS de gains et n'exécutes JAMAIS d'ordre sans confirmation
- Risque maximum recommandé : 2% du capital par trade

Quand on te demande d'analyser un actif, structure ta réponse ainsi :
1. Tendance générale (haussière/baissière/neutre)
2. Indicateurs clés et ce qu'ils indiquent
3. Niveaux importants (support/résistance)
4. Signal du moment (BUY/SELL/HOLD) avec confiance en %
5. Gestion du risque conseillée (SL/TP suggérés)`;

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          messages?: unknown;
          apiKey?: string;
          provider?: "anthropic" | "openai" | "google" | "lovable";
        };

        if (!Array.isArray(body.messages)) {
          return new Response("Messages are required", { status: 400 });
        }

        const messages = body.messages as UIMessage[];
        const provider = body.provider ?? "anthropic";
        // Empty string must fall back to the server key (?? doesn't catch ""),
        // so a single server-side key can power the chat for everyone.
        const clientKey = body.apiKey?.trim() || undefined;

        let model;

        if (provider === "openai") {
          const key = clientKey ?? process.env.OPENAI_API_KEY;
          if (!key) {
            return new Response(
              JSON.stringify({ error: "Clé API OpenAI manquante. Configure-la dans Paramètres → Assistant IA." }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }
          const openai = createOpenAI({ apiKey: key });
          model = openai("gpt-4o-mini");

        } else if (provider === "google") {
          // Google Gemini — generous free tier via Google AI Studio.
          const key = clientKey ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
          if (!key) {
            return new Response(
              JSON.stringify({ error: "Clé API Google manquante. Configure-la dans Paramètres → Assistant IA." }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }
          const google = createGoogleGenerativeAI({ apiKey: key });
          model = google("gemini-2.0-flash");

        } else if (provider === "lovable") {
          const key = clientKey ?? process.env.LOVABLE_API_KEY;
          if (!key) {
            return new Response(
              JSON.stringify({ error: "Clé API Lovable manquante." }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }
          const gateway = createLovableAiGatewayProvider(key);
          model = gateway("google/gemini-2.0-flash");

        } else {
          // Default: Anthropic Claude
          const key = clientKey ?? process.env.ANTHROPIC_API_KEY;
          if (!key) {
            return new Response(
              JSON.stringify({ error: "Clé API Anthropic manquante. Configure-la dans Paramètres → Assistant IA." }),
              { status: 401, headers: { "Content-Type": "application/json" } },
            );
          }
          const anthropic = createAnthropic({ apiKey: key });
          model = anthropic("claude-haiku-4-5-20251001");
        }

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: await convertToModelMessages(messages),
          onError: ({ error }) => {
            console.error("[chat] stream error:", error);
          },
        });

        return result.toUIMessageStreamResponse({
          originalMessages: messages,
          // Surface the real provider error (model/key/quota) instead of a generic message.
          onError: (error) => {
            console.error("[chat] response error:", error);
            return error instanceof Error ? error.message : String(error);
          },
        });
      },

      // Tells the UI which providers have a server-side key configured, so the
      // chat is usable without each user supplying their own key.
      GET: async () => {
        return new Response(
          JSON.stringify({
            anthropic: !!process.env.ANTHROPIC_API_KEY,
            openai: !!process.env.OPENAI_API_KEY,
            google: !!process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            lovable: !!process.env.LOVABLE_API_KEY,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
