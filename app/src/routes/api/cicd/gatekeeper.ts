import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { memories, apiTokens } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { verifyToken, extractTokenPrefix, decrypt, isEncrypted, getOrCreateVaultKey } from "~/server/crypto";

// ─── Request schema ────────────────────────────────────────────────────────────

const PackageJsonDiffSchema = z.object({
  added: z.array(z.string()).default([]),
  removed: z.array(z.string()).default([]),
  updated: z.record(z.string(), z.object({ from: z.string(), to: z.string() })).default({}),
});

const GatekeeperPayloadSchema = z.object({
  // Locker API token scoped to the project — used to query that project's vault
  project_token: z.string().min(1),
  // Optional vault scope — "org:<uuid>" or "team:<uuid>"; omit for personal vault
  project_key: z
    .string()
    .max(128)
    .refine(
      (v) => v === "" || /^org:[0-9a-f-]{36}$/.test(v) || /^team:[0-9a-f-]{36}$/.test(v),
      { message: "project_key must be empty, 'org:<uuid>', or 'team:<uuid>'" }
    )
    .optional(),
  // One of the two diff types must be present
  package_json_diff: PackageJsonDiffSchema.optional(),
  architecture_diff: z.string().max(50_000).optional(),
}).refine(
  (d) => d.package_json_diff !== undefined || d.architecture_diff !== undefined,
  { message: "At least one of package_json_diff or architecture_diff is required" }
);

// ─── AI response schema ────────────────────────────────────────────────────────

interface GatekeeperAIResponse {
  pass: boolean;
  violation_reason: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Authenticate a raw lkr_ token and return { userId, tokenId } or null. */
async function authenticateToken(
  db: ReturnType<typeof drizzle>,
  rawToken: string
): Promise<{ userId: string; tokenId: string } | null> {
  if (!rawToken.startsWith("lkr_")) return null;

  const prefix = extractTokenPrefix(rawToken);
  const rows = await db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      tokenHash: apiTokens.tokenHash,
      expiresAt: apiTokens.expiresAt,
    })
    .from(apiTokens)
    .where(prefix ? eq(apiTokens.tokenPrefix, prefix) : sql`1=0`)
    .all();

  for (const row of rows) {
    if (row.expiresAt !== null && row.expiresAt < Date.now()) continue;
    const valid = await verifyToken(rawToken, row.tokenHash);
    if (valid) return { userId: row.userId, tokenId: row.id };
  }
  return null;
}

/** Retrieve and decrypt vault memories matching the requested tags and categories. */
async function fetchVaultRules(
  db: ReturnType<typeof drizzle>,
  env: CloudflareEnv,
  userId: string,
  projectKey: string | null | undefined
): Promise<string[]> {
  const scopeConditions = [
    eq(memories.isActive, true),
    eq(memories.isQuarantined, false),
    // Only pull rule/reference categories — projects are scope metadata, not rules
    sql`${memories.category} IN ('rules', 'references')`,
  ];

  // Scope conditions mirror the pattern in -_api.mcp.ts
  if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
    scopeConditions.push(eq(memories.projectKey, projectKey));
  } else {
    scopeConditions.push(eq(memories.userId, userId));
    if (projectKey) {
      scopeConditions.push(
        sql`(${memories.projectKey} = ${projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    } else {
      scopeConditions.push(
        sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    }
  }

  // Tag filter: only memories tagged with at least one of the CI/CD-relevant tags
  const relevantTags = ["#architecture", "#rules", "#banned_dependencies", "#dependencies"];
  scopeConditions.push(
    sql`(${sql.join(
      relevantTags.map((t) => sql`INSTR(LOWER(${memories.tags}), ${t.toLowerCase()}) > 0`),
      sql` OR `
    )})`
  );

  const rows = await db
    .select({ id: memories.id, fact: memories.fact, tags: memories.tags })
    .from(memories)
    .where(and(...scopeConditions))
    .limit(50)
    .all();

  // Determine vault key for decryption
  const vaultId =
    projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))
      ? projectKey
      : userId;
  const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

  const facts: string[] = [];
  for (const row of rows) {
    try {
      let fact = row.fact;
      if (isEncrypted(fact)) {
        fact = await decrypt(fact, vaultKey);
      }
      facts.push(fact.trim());
    } catch {
      // Skip rows that fail decryption — fail safe
    }
  }
  return facts;
}

/** Build a human-readable summary of the PR diff for the LLM prompt. */
function formatDiff(
  packageJsonDiff: z.infer<typeof PackageJsonDiffSchema> | undefined,
  architectureDiff: string | undefined
): string {
  const parts: string[] = [];

  if (packageJsonDiff) {
    if (packageJsonDiff.added.length > 0) {
      parts.push(`Added dependencies: ${packageJsonDiff.added.join(", ")}`);
    }
    if (packageJsonDiff.removed.length > 0) {
      parts.push(`Removed dependencies: ${packageJsonDiff.removed.join(", ")}`);
    }
    const updatedEntries = Object.entries(packageJsonDiff.updated);
    if (updatedEntries.length > 0) {
      parts.push(
        "Updated dependencies:\n" +
          updatedEntries.map(([k, v]) => `  ${k}: ${v.from} → ${v.to}`).join("\n")
      );
    }
  }

  if (architectureDiff) {
    parts.push(`Architecture diff:\n${architectureDiff.slice(0, 5000)}`);
  }

  return parts.join("\n\n") || "(empty diff)";
}

const GATEKEEPER_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

/** Call Workers AI with a structured prompt and parse the boolean result. */
async function evaluateWithAI(
  ai: Ai,
  rules: string[],
  diffSummary: string
): Promise<GatekeeperAIResponse> {
  const systemPrompt = `You are a strict CI/CD policy gatekeeper. You receive:
1. A set of authoritative vault rules extracted from the project's Locker memory vault.
2. A PR diff summary.

Your job: decide whether the PR PASSES or FAILS the rules.

You MUST respond with a single valid JSON object matching this schema exactly:
{"pass": boolean, "violation_reason": string | null}

Rules for your response:
- "pass" is true only if the PR introduces NO violations.
- "violation_reason" is a concise explanation when pass=false, or null when pass=true.
- Do NOT include any text outside the JSON object.
- Be strict: if a rule explicitly bans something and the PR adds it, it is a violation.`;

  const userPrompt = `=== VAULT RULES ===
${rules.length > 0 ? rules.map((r, i) => `${i + 1}. ${r}`).join("\n") : "(no rules found for this project)"}

=== PR DIFF ===
${diffSummary}

Evaluate the PR diff against the vault rules and respond with the JSON schema described.`;

  const result = await ai.run(GATEKEEPER_MODEL, {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 256,
    temperature: 0,
  });

  // Extract JSON from the response text — Llama 3 may wrap it in markdown fences
  const raw: string =
    typeof result === "object" && result !== null && "response" in result
      ? (result as { response: string }).response
      : String(result);

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // If the model produced unparseable output, fail securely
    return { pass: false, violation_reason: "AI evaluation produced an unparseable response — failing securely." };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const pass = parsed.pass === true;
    const violation_reason =
      typeof parsed.violation_reason === "string" ? parsed.violation_reason : null;
    return { pass, violation_reason: pass ? null : (violation_reason ?? "Unspecified violation.") };
  } catch {
    return { pass: false, violation_reason: "AI response JSON was malformed — failing securely." };
  }
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export default {
  POST: async (request: Request, { env }: { env: CloudflareEnv }): Promise<Response> => {
    // ── Parse body ──────────────────────────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body." }, 400);
    }

    const parsed = GatekeeperPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse(
        { error: "Invalid request payload.", details: parsed.error.flatten() },
        400
      );
    }

    const { project_token, project_key, package_json_diff, architecture_diff } = parsed.data;

    // ── Authenticate token ──────────────────────────────────────────────────────
    const db = drizzle(env.DB);
    const claims = await authenticateToken(db, project_token);
    if (!claims) {
      // Generic error — do not reveal why auth failed
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    // ── Fetch vault rules ───────────────────────────────────────────────────────
    let rules: string[];
    try {
      rules = await fetchVaultRules(db, env, claims.userId, project_key ?? null);
    } catch (err) {
      console.error("[gatekeeper] vault fetch error:", err);
      // Fail securely: if we can't read rules we cannot certify the PR is safe
      return jsonResponse(
        { error: "Failed to retrieve vault rules.", pass: false },
        500
      );
    }

    // ── Build diff summary ──────────────────────────────────────────────────────
    const diffSummary = formatDiff(package_json_diff, architecture_diff);

    // ── AI evaluation ───────────────────────────────────────────────────────────
    let evaluation: GatekeeperAIResponse;
    try {
      evaluation = await evaluateWithAI(env.AI, rules, diffSummary);
    } catch (err) {
      console.error("[gatekeeper] AI evaluation error:", err);
      // Fail securely: an AI error must not silently allow a potentially bad PR
      return jsonResponse(
        { error: "AI evaluation failed — failing securely.", pass: false },
        500
      );
    }

    // ── Respond ─────────────────────────────────────────────────────────────────
    if (evaluation.pass) {
      return jsonResponse({ pass: true, violation_reason: null }, 200);
    }

    return jsonResponse(
      {
        pass: false,
        violation_reason: evaluation.violation_reason,
      },
      400
    );
  },
};
