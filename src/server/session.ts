import { getRequest } from "@tanstack/react-start/server";
import { createAuth } from "./auth";
import type { CloudflareEnv } from "~/types/cloudflare";

// Returns the authenticated user from the current request's session cookie.
// Throws a 401 Response if no valid session exists.
export async function requireSession(env: CloudflareEnv) {
  const request = getRequest();
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session.user;
}

// Requires the session user to be the configured admin. Throws 403 otherwise.
export async function requireAdmin(env: CloudflareEnv) {
  const user = await requireSession(env);
  if (user.id !== env.ADMIN_USER_ID) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

// Returns user or null — non-throwing variant for optional auth checks.
export async function getSession(env: CloudflareEnv) {
  try {
    const request = getRequest();
    const auth = createAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user ?? null;
  } catch {
    return null;
  }
}
