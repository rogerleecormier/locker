import * as fs from "fs";
import * as path from "path";

async function run() {
  const accountId = "101ae2c39c8dda6574c201e123edf24f";
  const databaseId = "6091fbef-95a2-4235-b97e-cc1f360f73b2";
  
  // Read default.toml to get oauth_token
  const tomlPath = "/home/roger_lee_cormier/.config/.wrangler/config/default.toml";
  const tomlContent = fs.readFileSync(tomlPath, "utf8");
  const oauthTokenMatch = tomlContent.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!oauthTokenMatch) {
    throw new Error("Could not find oauth_token in default.toml");
  }
  const token = oauthTokenMatch[1];

  // Read migrations
  const sql13 = fs.readFileSync(path.resolve("drizzle/migrations/0013_refactor_scope_and_reviews.sql"), "utf8");
  const sql14 = fs.readFileSync(path.resolve("drizzle/migrations/0014_lush_magdalene.sql"), "utf8");

  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  console.log("Applying migration 0013 via Cloudflare D1 API...");
  const res13 = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ sql: sql13 })
  });
  const data13 = await res13.json() as any;
  console.log("Migration 0013 response:", JSON.stringify(data13, null, 2));

  if (!data13.success) {
    throw new Error("Migration 0013 failed!");
  }

  console.log("Applying migration 0014 via Cloudflare D1 API...");
  const res14 = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ sql: sql14 })
  });
  const data14 = await res14.json() as any;
  console.log("Migration 0014 response:", JSON.stringify(data14, null, 2));

  if (!data14.success) {
    throw new Error("Migration 0014 failed!");
  }

  console.log("Inserting migration tracking records...");
  const trackingSql = `
    INSERT INTO d1_migrations (name, applied_at) VALUES ('0013_refactor_scope_and_reviews.sql', strftime('%Y-%m-%d %H:%M:%S', 'now'));
    INSERT INTO d1_migrations (name, applied_at) VALUES ('0014_lush_magdalene.sql', strftime('%Y-%m-%d %H:%M:%S', 'now'));
  `;
  const resTracking = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ sql: trackingSql })
  });
  const dataTracking = await resTracking.json() as any;
  console.log("Tracking insert response:", JSON.stringify(dataTracking, null, 2));

  if (!dataTracking.success) {
    throw new Error("Tracking insert failed!");
  }

  console.log("All migrations successfully applied to remote D1 instance!");
}

run().catch(err => {
  console.error("Error applying migrations manually:", err);
  process.exit(1);
});
