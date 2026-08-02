// Admin-only: choose which preset tabs the Auto-Trader shows on MOBILE.
//
// Purely a display filter — see getVisiblePresets in bot-engine.server.ts.
// Hiding a preset never stops its engine, never hides it from the journal or
// the admin panel, and never changes what the server trades. Desktop always
// renders all four regardless of this setting.
//
// `userId` is OPTIONAL and defaults to the calling admin's own account: this
// setting is normally something an admin changes for THEMSELVES, which
// /api/admin/users deliberately forbids ("Tu ne peux pas modifier ton propre
// compte admin" — a guard meant for status/role changes, not display prefs).
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "@/lib/db.server";
import { requireAdmin } from "@/lib/auth.server";
import {
  ALL_PRESETS,
  MAX_VISIBLE_PRESETS,
  getVisiblePresets,
  setVisiblePresets,
} from "@/lib/bot-engine.server";

export const Route = createFileRoute("/api/admin/visible-presets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const url = new URL(request.url);
        const raw = url.searchParams.get("userId");
        const userId = raw ? Number(raw) : admin.id;
        if (!Number.isFinite(userId)) return json({ error: "userId invalide." }, 400);

        return json({ userId, visiblePresets: getVisiblePresets(userId), maxVisible: MAX_VISIBLE_PRESETS });
      },

      PATCH: async ({ request }) => {
        const admin = await requireAdmin(request);
        if (!admin) return json({ error: "Accès réservé aux administrateurs." }, 403);

        const body = (await request.json().catch(() => ({}))) as {
          userId?: number;
          visiblePresets?: unknown;
        };
        const userId = body.userId ?? admin.id;
        if (!Number.isFinite(userId)) return json({ error: "userId invalide." }, 400);

        if (!Array.isArray(body.visiblePresets)) {
          return json({ error: "visiblePresets doit être un tableau." }, 400);
        }
        const unknownKey = body.visiblePresets.find(
          (p) => typeof p !== "string" || !ALL_PRESETS.includes(p as never),
        );
        if (unknownKey !== undefined) {
          return json({ error: `Preset inconnu : ${String(unknownKey)}.` }, 400);
        }
        // At least one tab, or the strip would render empty with no way back.
        if (body.visiblePresets.length === 0) {
          return json({ error: "Garde au moins un preset affiché." }, 400);
        }
        if (body.visiblePresets.length > MAX_VISIBLE_PRESETS) {
          return json({ error: `Maximum ${MAX_VISIBLE_PRESETS} presets affichés sur mobile.` }, 400);
        }

        const exists = getDb().prepare("SELECT id FROM users WHERE id = ?").get(userId);
        if (!exists) return json({ error: "Utilisateur introuvable." }, 404);

        const stored = setVisiblePresets(userId, body.visiblePresets as string[]);
        return json({ success: true, userId, visiblePresets: stored });
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
