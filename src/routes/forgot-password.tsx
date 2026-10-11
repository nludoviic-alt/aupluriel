import { createFileRoute, redirect } from "@tanstack/react-router";

// Self-service password reset is disabled — access is login-only, and resets
// are issued by an admin from the admin panel (which emails a /reset-password
// link). The route is kept so old links land on the login page.
export const Route = createFileRoute("/forgot-password")({
  beforeLoad: () => {
    throw redirect({ to: "/login" });
  },
});
