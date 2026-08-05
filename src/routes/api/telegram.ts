import { createFileRoute, json } from "@tanstack/react-router";
import { getUserFromRequest } from "@/lib/auth.server";
import {
  getUserTelegramConfig,
  saveUserTelegramConfig,
  sendTelegramNotification,
  type TelegramConfig,
} from "@/lib/telegram.server";

export const Route = createFileRoute("/api/telegram")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const config = getUserTelegramConfig(auth.userId) || {
          botToken: "",
          chatId: "",
          enabled: false,
          notifyOnTradeOpen: true,
          notifyOnTradeClose: true,
          notifyOnRiskLimit: true,
          notifyOnSpikeSignal: true,
        };

        return json({ config });
      },

      POST: async ({ request }) => {
        const auth = await getUserFromRequest(request);
        if (!auth) return json({ error: "Non authentifié" }, 401);

        const body = (await request.json().catch(() => ({}))) as {
          action?: "test" | "save";
          config?: TelegramConfig;
        };

        if (body.action === "test" && body.config) {
          const testMsg = `<b>🔔 Au Pluriel Quant Engine</b>\n\n✅ <b>Connexion Telegram Réussie !</b>\nVotre bot est prêt à vous envoyer les alerte de trade, Spike Hunter et limites de risque.`;
          const result = await sendTelegramNotification(
            body.config.botToken,
            body.config.chatId,
            testMsg,
          );
          return json(result);
        }

        if (body.action === "save" && body.config) {
          saveUserTelegramConfig(auth.userId, body.config);
          return json({ success: true, message: "Configuration Telegram sauvegardée" });
        }

        return json({ error: "Action invalide" }, 400);
      },
    },
  },
});
