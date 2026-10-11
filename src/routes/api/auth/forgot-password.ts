import { createFileRoute } from "@tanstack/react-router";

// Self-service password reset is disabled — resets are issued exclusively by
// an admin from the admin panel (see /api/admin/users, action "reset-password").
export const Route = createFileRoute("/api/auth/forgot-password")({
  server: {
    handlers: {
      POST: async () => {
        return json(
          { error: "La réinitialisation en libre-service est désactivée. Contacte un administrateur." },
          403,
        );
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
