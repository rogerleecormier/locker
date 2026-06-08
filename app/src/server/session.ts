import { getRequest } from "@tanstack/react-start/server";
import { createAuth } from "./auth";
import type { CloudflareEnv } from "~/types/cloudflare";

// Returns the authenticated user from the current request's session cookie.
// Throws a 401 Response if no valid session exists.
// Throws a 403 Response if email is not verified.
export async function requireSession(env: CloudflareEnv) {
  const request = getRequest();
  const auth = await createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const isLocal = env.BETTER_AUTH_URL?.includes("localhost") || env.BETTER_AUTH_URL?.includes("127.0.0.1");
  if (!isLocal && !session.user.emailVerified) {
    throw new Response(JSON.stringify({ error: "Please verify your email before accessing this feature" }), {
      status: 403,
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
    const auth = await createAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user ?? null;
  } catch {
    return null;
  }
}
