import { createFileRoute } from "@tanstack/react-router";

// Public self-registration is disabled — accounts are provisioned exclusively
// by an admin from the admin panel (see /api/admin/users, action "create").
export const Route = createFileRoute("/api/auth/register")({
  server: {
    handlers: {
      POST: async () => {
        return json({ error: "Les inscriptions publiques sont désactivées. Contacte un administrateur." }, 403);
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
