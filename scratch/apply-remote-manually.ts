import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

async function run() {
  const file13Path = path.resolve("drizzle/migrations/0013_refactor_scope_and_reviews.sql");
  const file14Path = path.resolve("drizzle/migrations/0014_lush_magdalene.sql");

  let sql13 = fs.readFileSync(file13Path, "utf8");
  let sql14 = fs.readFileSync(file14Path, "utf8");

  // 1. Wrap CASE statements in parentheses
  sql13 = sql13.replace(/SELECT CASE/g, "SELECT (CASE");
  sql13 = sql13.replace(/\bEND;\r?\n(\s*)END;/g, "END);\r?\n$1END;");

  // 2. Split statements by statement-breakpoint
  const statements13 = sql13
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  const statements14 = sql14
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`Parsed ${statements13.length} statements from 0013.`);
  console.log(`Parsed ${statements14.length} statements from 0014.`);

  // Write the modified file13 back so it's in sync locally as well
  fs.writeFileSync(file13Path, sql13, "utf8");
  console.log("Saved updated migration 0013 locally.");

  // Execute statements one-by-one on remote D1 using temp files
  console.log("\n=== Executing statements from 0013 on remote D1 ===");
  for (let i = 0; i < statements13.length; i++) {
    const stmt = statements13[i];
    console.log(`[0013] [${i+1}/${statements13.length}] Executing...`);
    const tempFile = path.resolve(`scratch/temp_stmt_13_${i}.sql`);
    fs.writeFileSync(tempFile, stmt, "utf8");
    try {
      execSync(`npx wrangler d1 execute locker-db --remote --yes --file ${tempFile}`, { stdio: "inherit" });
    } catch (err) {
      console.error(`Failed on statement: ${stmt}`);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      throw err;
    }
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }

  console.log("\n=== Executing statements from 0014 on remote D1 ===");
  for (let i = 0; i < statements14.length; i++) {
    const stmt = statements14[i];
    console.log(`[0014] [${i+1}/${statements14.length}] Executing...`);
    const tempFile = path.resolve(`scratch/temp_stmt_14_${i}.sql`);
    fs.writeFileSync(tempFile, stmt, "utf8");
    try {
      execSync(`npx wrangler d1 execute locker-db --remote --yes --file ${tempFile}`, { stdio: "inherit" });
    } catch (err) {
      console.error(`Failed on statement: ${stmt}`);
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      throw err;
    }
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }

  // Insert tracking records
  console.log("\n=== Recording applied migrations in remote d1_migrations table ===");
  const trackingQueries = [
    "INSERT INTO d1_migrations (name, applied_at) VALUES ('0013_refactor_scope_and_reviews.sql', strftime('%Y-%m-%d %H:%M:%S', 'now'));",
    "INSERT INTO d1_migrations (name, applied_at) VALUES ('0014_lush_magdalene.sql', strftime('%Y-%m-%d %H:%M:%S', 'now'));"
  ];

  for (let i = 0; i < trackingQueries.length; i++) {
    const query = trackingQueries[i];
    const tempFile = path.resolve(`scratch/temp_stmt_tracking_${i}.sql`);
    fs.writeFileSync(tempFile, query, "utf8");
    execSync(`npx wrangler d1 execute locker-db --remote --yes --file ${tempFile}`, { stdio: "inherit" });
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }

  console.log("\nRemote migration completed successfully!");
}

run().catch((err) => {
  console.error("Error applying migrations manually:", err);
  process.exit(1);
});
