import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { handleMcpRequest, verifyAdminApproveUrl } from "./routes/-_api.mcp";
import { createAuth } from "./server/auth";
import { runSetup } from "./server/setup";
import { handleMemoryVersionCleanup } from "./scheduled/cleanup-versions";
import type { CloudflareEnv, ArchiveMessage } from "./types/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { memories, auditLogs, organizationMembers, systemSettings, jitAccessRequests } from "./db/schema";
import { hashToken } from "./server/crypto";
import { archiveContradictingMemories } from "./server/memoryFunctions";
import { isEncrypted, decrypt, deriveUserKey, getOrCreateVaultKey, decryptEphemeral, EphemeralPlaintext } from "./server/crypto";
import { logAudit } from "./server/enterprise";
import { handleStripeWebhook } from "./server/billing";
import { handleWebhookRequest } from "./server/webhooks";
import {
  isStaticPath,
  checkIpRateLimit,
  checkTokenRateLimit,
  tooManyRequests,
} from "./server/rateLimit";
import { validateAuthorizeRequest, validateTokenRequest } from "./server/pkce";

const handler = createStartHandler(defaultStreamHandler);

function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://api.stripe.com https://*.stripe.com",
      "font-src 'self' data:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") ?? "";

    // ── Rate limiting ──────────────────────────────────────────────────────
    if (!isStaticPath(url.pathname)) {
      const authHeader = request.headers.get("Authorization") ?? "";
      const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
      const isMcpEndpoint = url.pathname === "/api/mcp";

      if (isMcpEndpoint && bearerToken) {
        // Token-based cap for authenticated MCP callers: 300 req/min
        const rl = await checkTokenRateLimit(bearerToken, env, ctx);
        if (rl.limited) return tooManyRequests(rl.retryAfter);
      } else if (!bearerToken) {
        // IP-based cap for unauthenticated traffic: 60 req/min
        const rl = await checkIpRateLimit(request, env, ctx);
        if (rl.limited) return tooManyRequests(rl.retryAfter);
      }
    }
    // ── End rate limiting ──────────────────────────────────────────────────

    // Log all requests from Anthropic's IP range (160.79.104.0/21)
    if (ip.startsWith("160.79.")) {
      const auth = request.headers.get("Authorization");
      console.log(`[anthropic] ${request.method} ${url.pathname} auth:${auth ? auth.slice(0,20) : "NONE"}`);
    }

    if (url.pathname === "/api/mcp") {
      return handleMcpRequest(request, env, ctx);
    }

    // One-time deployment setup: seed the Claude OAuth client and demo user.
    // Gated by BETTER_AUTH_SECRET so it is never callable without credentials.
    // Safe to call repeatedly — all operations are idempotent.
    if (url.pathname === "/api/admin/setup" && request.method === "POST") {
      const authHeader = request.headers.get("Authorization");
      const expectedToken = `Bearer ${env.BETTER_AUTH_SECRET}`;
      if (!authHeader || authHeader !== expectedToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      try {
        const result = await runSetup(env);
        return Response.json({ ok: true, result });
      } catch (err) {
        console.error("[setup] /api/admin/setup failed:", err);
        return new Response(JSON.stringify({ error: "Setup failed", detail: String(err) }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ── JIT admin confirmation route ──────────────────────────────────────────
    // GET /api/admin/jit/:requestId/approve?expires=<ms>&sig=<hex>
    //
    // Called when an admin clicks the "Approve" button in the Slack notification.
    // Verifies the HMAC-signed URL, mints a 15-minute JIT token, writes it to D1,
    // and returns a plain HTML page the admin can close.
    const jitApproveMatch = url.pathname.match(/^\/api\/admin\/jit\/([^/]+)\/approve$/);
    if (jitApproveMatch && request.method === "GET") {
      const jitRequestId = jitApproveMatch[1];
      const expires = url.searchParams.get("expires") ?? "";
      const sig = url.searchParams.get("sig") ?? "";

      const sigValid = await verifyAdminApproveUrl(jitRequestId, expires, sig, env.BETTER_AUTH_SECRET);
      if (!sigValid) {
        return new Response(
          `<!doctype html><html><body><h2>Link expired or invalid.</h2><p>Request a new approval from the agent.</p></body></html>`,
          { status: 403, headers: { "Content-Type": "text/html" } },
        );
      }

      const db = drizzle(env.DB);
      const jitRow = await db
        .select()
        .from(jitAccessRequests)
        .where(eq(jitAccessRequests.id, jitRequestId))
        .get();

      if (!jitRow) {
        return new Response(
          `<!doctype html><html><body><h2>JIT request not found.</h2></body></html>`,
          { status: 404, headers: { "Content-Type": "text/html" } },
        );
      }

      if (jitRow.status !== "pending") {
        const msg = jitRow.status === "approved" ? "already approved" : "denied";
        return new Response(
          `<!doctype html><html><body><h2>Request ${msg}.</h2><p>This request has already been reviewed.</p></body></html>`,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }

      // Mint 15-minute JIT token
      const jitSecret = `lkr_jit_${crypto.randomUUID().replace(/-/g, "")}`;
      const jitTokenHash = await hashToken(jitSecret);
      const jitExpiresAt = Date.now() + 15 * 60 * 1000;

      await db
        .update(jitAccessRequests)
        .set({
          status: "approved",
          jitTokenHash,
          jitExpiresAt,
          reviewedAt: Date.now(),
          reviewedBy: jitRow.userId,
          reviewNotes: "approved via Slack link",
        })
        .where(eq(jitAccessRequests.id, jitRequestId));

      await db.insert(auditLogs).values({
        id: crypto.randomUUID(),
        orgId: null,
        userId: jitRow.userId,
        tokenId: jitRow.tokenId,
        action: "jit_access_approved",
        ipAddress: request.headers.get("cf-connecting-ip") ?? "",
        userAgent: request.headers.get("user-agent") ?? "",
        timestamp: Date.now(),
        metadata: JSON.stringify({ jitRequestId, source: "slack_link", expiresAt: jitExpiresAt }),
      });

      const agentContext = (() => {
        try {
          const meta = jitRow.agentTokenMetadata ? JSON.parse(jitRow.agentTokenMetadata) : null;
          return meta?.agentContext ?? "unknown agent";
        } catch {
          return "unknown agent";
        }
      })();

      return new Response(
        `<!doctype html>
<html>
<head><meta charset="utf-8"><title>JIT Access Approved</title>
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:60px auto;padding:0 24px}
h2{color:#16a34a}code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:.9em}</style>
</head>
<body>
<h2>Access approved</h2>
<p>Agent <strong>${agentContext}</strong> has been granted a 15-minute token to access the requested <code>#confidential</code> memories.</p>
<p>The token has been written to Locker — the agent can retry its original query now.</p>
<p><small>Token expires in 15 minutes. You can close this tab.</small></p>
</body>
</html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    // ── End JIT admin confirmation route ──────────────────────────────────────

    if (url.pathname === "/api/export" && request.method === "POST") {
      return handleExportRequest(request, env);
    }

    if (url.pathname === "/api/webhooks/stripe" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    if (url.pathname === "/api/webhooks/github" && request.method === "POST") {
      return handleWebhookRequest(request, env, "github");
    }

    if (url.pathname === "/api/webhooks/linear" && request.method === "POST") {
      return handleWebhookRequest(request, env, "linear");
    }



    if (url.pathname.startsWith("/api/auth/")) {
      if (url.pathname === "/api/auth/signup/email" && request.method === "POST") {
        const db = drizzle(env.DB, { schema: { systemSettings } });
        try {
          const row = await db.select().from(systemSettings).where(eq(systemSettings.key, "enable_signups")).get();
          if (row?.value !== "true") {
            return Response.json(
              { message: "Signups are disabled during development." },
              { status: 403 }
            );
          }
        } catch {
          return Response.json(
            { message: "Signups are disabled during development." },
            { status: 403 }
          );
        }
      }
      const auth = await createAuth(env);
      const response = await auth.handler(request);
      return response;
    }

    // OAuth 2.0 protected resource metadata (RFC 9728).
    // Claude fetches /.well-known/oauth-protected-resource[/<path>] to discover the auth server.
    if (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname.startsWith("/.well-known/oauth-protected-resource/")) {
      return Response.json({
        resource: `${url.origin}/api/mcp`,
        authorization_servers: [url.origin],
        bearer_methods_supported: ["header"],
        resource_documentation: `${url.origin}/connect`,
      });
    }

    // OAuth 2.0 authorization server metadata (RFC 8414).
    // Serve this ourselves rather than proxying to avoid routing issues.
    // Claude uses this to discover the authorization, token, and registration endpoints.
    if (url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/oauth-authorization-server/api/auth" ||
        url.pathname === "/.well-known/openid-configuration" ||
        url.pathname === "/api/auth/.well-known/openid-configuration") {
      const base = url.origin;
      return Response.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        jwks_uri: `${base}/api/auth/jwks`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["openid", "profile", "email", "offline_access", "openid:mcp:recall", "openid:mcp:commit", "openid:mcp:update", "openid:mcp:delete"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        resource_indicators_supported: true,
      });
    }

    // Claude constructs OAuth paths from the issuer URL instead of using discovery.
    // Rewrite the URL in-process to the better-auth OAuth2 endpoints.
    if (url.pathname === "/authorize" || url.pathname === "/token" || url.pathname === "/register") {
      const segment = url.pathname === "/authorize" ? "authorize" : url.pathname === "/register" ? "register" : "token";

      // ── OAuth 2.1 PKCE enforcement (CVE-2025-4144) ───────────────────────────
      // Reject before reading the body or touching the upstream provider so that
      // a stripped code_challenge can never reach a potentially lenient handler.
      if (segment === "authorize") {
        const pkce = validateAuthorizeRequest(url);
        if (!pkce.ok) return pkce.response;
      }

      const body = request.body ? await request.arrayBuffer() : null;
      const bodyText = body ? new TextDecoder().decode(body) : "(empty)";

      // Token endpoint: validate code_verifier for authorization_code grants.
      if (segment === "token") {
        const contentType = request.headers.get("content-type") ?? "";
        const params = contentType.includes("application/x-www-form-urlencoded")
          ? new URLSearchParams(bodyText)
          : url.searchParams;
        const pkce = validateTokenRequest(params);
        if (!pkce.ok) return pkce.response;
      }

      // Intercept dynamic client registration (RFC 7591) for known clients.
      // Claude always tries to register dynamically, but we keep allowDynamicClientRegistration=false
      // for security. Instead, we detect Claude's known redirect URI and return the pre-registered
      // client credentials so Claude can proceed without actually creating a new DB entry.
      if (segment === "register" && env.CLAUDE_CLIENT_ID && request.method === "POST") {
        try {
          const parsed = JSON.parse(bodyText || "{}") as { redirect_uris?: string[] };
          const redirectUris: string[] = parsed.redirect_uris ?? [];
          if (redirectUris.includes("https://claude.ai/api/mcp/auth_callback")) {
            console.log(`[oauth/register] returning pre-registered Claude client`);
            return Response.json({
              client_id: env.CLAUDE_CLIENT_ID,
              redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
              client_name: "Claude",
              scope: "openid profile email offline_access openid:mcp:recall openid:mcp:commit openid:mcp:update openid:mcp:delete",
            }, { status: 201 });
          }
        } catch {
          // malformed body — fall through to better-auth which will 403
        }
      }

      const rewritten = new Request(
        `${url.origin}/api/auth/oauth2/${segment}${url.search}`,
        {
          method: request.method,
          headers: request.headers,
          body: body,
        },
      );
      const auth = await createAuth(env);
      const response = await auth.handler(rewritten);
      const text = await response.clone().text();

      // For token responses, normalize to strict RFC 6749 shape
      if (segment === "token" && response.ok) {
        try {
          const data = JSON.parse(text) as Record<string, unknown>;
          // Strip non-standard fields; keep Bearer and id_token (now using RS256 for OIDC validation by Claude)
          const cleaned = {
            access_token: data.access_token,
            token_type: "Bearer",
            expires_in: data.expires_in,
            ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
            ...(data.id_token ? { id_token: data.id_token } : {}),
            scope: data.scope,
          };
          const headers = new Headers(response.headers);
          headers.set("Content-Type", "application/json");
          return new Response(JSON.stringify(cleaned), { status: response.status, headers });
        } catch {
          // Fall through to original response on parse error
        }
      }
      return response;
    }

    const ua = request.headers.get("user-agent") ?? "";
    if (ua.includes("python-httpx") || ua.includes("Claude")) {
      console.log(`[unhandled] ${request.method} ${url.pathname} ua:${ua.slice(0, 40)}`);
    }

    const pageResponse = await handler(request, {
      context: { cloudflare: { env, ctx } } as Record<string, unknown>,
    });
    return addSecurityHeaders(pageResponse);
  },
  async queue(batch: MessageBatch<unknown>, env: CloudflareEnv, ctx: ExecutionContext) {
    const db = drizzle(env.DB, { schema: { memories } });
    for (const message of batch.messages) {
      try {
        const { userId, newFact, embedding, projectKey } = message.body as ArchiveMessage;
        console.log(`[queue] Processing contradiction check for user ${userId}: "${newFact.slice(0, 50)}..."`);
        await archiveContradictingMemories(db, env, userId, newFact, embedding, projectKey ?? undefined);
      } catch (err) {
        console.error("[queue] Failed to process message:", err);
      }
    }
  },
  async scheduled(controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    console.log(`[scheduled] Running scheduled event at ${new Date(controller.scheduledTime).toISOString()}`);
    // Run setup idempotently on every cron tick — ensures the Claude OAuth
    // client and demo user are always present after env-var rotation or
    // new deployments without needing a separate deploy step.
    ctx.waitUntil(runSetup(env).catch((err) => console.error("[scheduled] runSetup failed:", err)));
    try {
      await handleMemoryVersionCleanup(env, ctx);
    } catch (err) {
      console.error("[scheduled] Memory version cleanup failed:", err);
    }
  }
} satisfies ExportedHandler<CloudflareEnv>;

async function decryptFact(stored: string, encKey: string | CryptoKey, fallbackKey?: string): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  try {
    return await decrypt(stored, encKey);
  } catch (err) {
    if (fallbackKey) {
      try {
        return await decrypt(stored, fallbackKey);
      } catch {
        // Fall back
      }
    }
    throw err;
  }
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(secret);
  const messageData = enc.encode(payload);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    messageData
  );

  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeCrcTable() {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c;
  }
  return crcTable;
}

const crcTable = makeCrcTable();

function crc32(data: Uint8Array): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ data[i]) & 0xFF];
  }
  return (crc ^ -1) >>> 0;
}

function createZip(files: { name: string; content: Uint8Array | string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileDataList: {
    nameBytes: Uint8Array;
    contentBytes: Uint8Array;
    crc: number;
    offset: number;
  }[] = [];

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const contentBytes = typeof f.content === "string" ? encoder.encode(f.content) : f.content;
    const crc = crc32(contentBytes);
    fileDataList.push({
      nameBytes,
      contentBytes,
      crc,
      offset: 0,
    });
  }

  let currentOffset = 0;
  for (const fd of fileDataList) {
    fd.offset = currentOffset;
    currentOffset += 30 + fd.nameBytes.length + fd.contentBytes.length;
  }

  const localHeadersSize = currentOffset;

  let cdSize = 0;
  for (const fd of fileDataList) {
    cdSize += 46 + fd.nameBytes.length;
  }

  const zipSize = localHeadersSize + cdSize + 22;
  const zipBytes = new Uint8Array(zipSize);
  const view = new DataView(zipBytes.buffer);

  let ptr = 0;

  for (const fd of fileDataList) {
    view.setUint32(ptr, 0x04034b50, true); ptr += 4;
    view.setUint16(ptr, 10, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0x21, true); ptr += 2;
    view.setUint32(ptr, fd.crc, true); ptr += 4;
    view.setUint32(ptr, fd.contentBytes.length, true); ptr += 4;
    view.setUint32(ptr, fd.contentBytes.length, true); ptr += 4;
    view.setUint16(ptr, fd.nameBytes.length, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;

    zipBytes.set(fd.nameBytes, ptr); ptr += fd.nameBytes.length;
    zipBytes.set(fd.contentBytes, ptr); ptr += fd.contentBytes.length;
  }

  const cdOffset = ptr;

  for (const fd of fileDataList) {
    view.setUint32(ptr, 0x02014b50, true); ptr += 4;
    view.setUint16(ptr, 20, true); ptr += 2;
    view.setUint16(ptr, 10, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0x21, true); ptr += 2;
    view.setUint32(ptr, fd.crc, true); ptr += 4;
    view.setUint32(ptr, fd.contentBytes.length, true); ptr += 4;
    view.setUint32(ptr, fd.contentBytes.length, true); ptr += 4;
    view.setUint16(ptr, fd.nameBytes.length, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint16(ptr, 0, true); ptr += 2;
    view.setUint32(ptr, 0, true); ptr += 4;
    view.setUint32(ptr, fd.offset, true); ptr += 4;

    zipBytes.set(fd.nameBytes, ptr); ptr += fd.nameBytes.length;
  }

  view.setUint32(ptr, 0x06054b50, true); ptr += 4;
  view.setUint16(ptr, 0, true); ptr += 2;
  view.setUint16(ptr, 0, true); ptr += 2;
  view.setUint16(ptr, fileDataList.length, true); ptr += 2;
  view.setUint16(ptr, fileDataList.length, true); ptr += 2;
  view.setUint32(ptr, cdSize, true); ptr += 4;
  view.setUint32(ptr, cdOffset, true); ptr += 4;
  view.setUint16(ptr, 0, true); ptr += 2;

  return zipBytes;
}

async function handleExportRequest(request: Request, env: CloudflareEnv): Promise<Response> {
  const ephemerals: EphemeralPlaintext[] = [];
  try {
    const auth = await createAuth(env);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const db = drizzle(env.DB);

    // Fetch and decrypt memories
    const userMemories = await db
      .select()
      .from(memories)
      .where(eq(memories.userId, session.user.id))
      .all();

    const decrypted = await Promise.all(
      userMemories.map(async (r) => {
        const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
        const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
        let plainFact = r.fact;
        if (isEncrypted(r.fact)) {
          try {
            const eph = await decryptEphemeral(r.fact, vaultKey);
            ephemerals.push(eph);
            plainFact = eph.get();
          } catch (err) {
            try {
              const legacyKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
              plainFact = await decrypt(r.fact, legacyKey);
            } catch {
              console.error(`[export] Decryption failed for memory ${r.id}:`, err);
            }
          }
        }
        return {
          id: r.id,
          fact: plainFact,
          category: r.category,
          tags: r.tags,
          timestamp: r.timestamp,
          isActive: r.isActive,
          projectKey: r.projectKey,
        };
      })
    );

    // Fetch audit logs
    const userAuditLogs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.userId, session.user.id))
      .all();

    // Log the export action
    const orgRows = await db
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, session.user.id))
      .limit(1)
      .all();
    const orgId = orgRows[0]?.orgId ?? null;

    await logAudit(db, {
      orgId,
      userId: session.user.id,
      tokenId: "session",
      action: "export_memories",
      ipAddress: request.headers.get("cf-connecting-ip"),
      userAgent: request.headers.get("user-agent"),
    });

    const memoriesJson = JSON.stringify(decrypted, null, 2);
    const auditLogsJson = JSON.stringify(userAuditLogs, null, 2);

    const payloadToSign = memoriesJson + "\n---\n" + auditLogsJson;
    const signatureHex = await signPayload(payloadToSign, env.EXPORT_SIGNING_KEY);

    const signatureInfo = JSON.stringify({
      userId: session.user.id,
      timestamp: Date.now(),
      signature: signatureHex,
      algorithm: "HMAC-SHA256",
    }, null, 2);

    const zipBytes = createZip([
      { name: "memories.json", content: memoriesJson },
      { name: "audit_logs.json", content: auditLogsJson },
      { name: "signature.json", content: signatureInfo },
    ]);

    return new Response(zipBytes.buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="locker_export_${session.user.id}.zip"`,
      },
    });
  } catch (err) {
    console.error("[export] Request failed:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } finally {
    for (const eph of ephemerals) {
      eph.drop();
    }
  }
}
