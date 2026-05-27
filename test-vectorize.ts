// Quick test to verify Vectorize binding works
import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { memories } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export async function testVectorize(request: Request, env: CloudflareEnv): Promise<Response> {
  try {
    // Test 1: Check if VECTOR_INDEX binding exists
    console.log("[test] VECTOR_INDEX binding type:", typeof env.VECTOR_INDEX);
    console.log("[test] VECTOR_INDEX binding:", env.VECTOR_INDEX);

    // Test 2: Try a simple insert
    const testVec = new Array(1024).fill(0.1);
    console.log("[test] inserting test vector...");
    const insertResult = await env.VECTOR_INDEX.insert([
      {
        id: "test-id-" + Date.now(),
        values: testVec,
        metadata: { test: "true" } as Record<string, VectorizeVectorMetadata>,
      },
    ]);
    console.log("[test] insert result:", insertResult);

    // Test 3: Try a query
    console.log("[test] querying vectors...");
    const queryResult = await env.VECTOR_INDEX.query(testVec, { topK: 5, returnMetadata: false });
    console.log("[test] query result:", queryResult);

    return Response.json({
      success: true,
      bindingExists: !!env.VECTOR_INDEX,
      insertResult,
      queryResult,
    });
  } catch (err) {
    console.error("[test] error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
