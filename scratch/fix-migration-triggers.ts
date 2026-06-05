import * as fs from "fs";
import * as path from "path";

const migrationPath = path.resolve("drizzle/migrations/0013_refactor_scope_and_reviews.sql");
const content = fs.readFileSync(migrationPath, "utf8");

// Regex to find CREATE TRIGGER blocks up to the next statement breakpoint or end of file
const triggerRegex = /(CREATE TRIGGER[\s\S]+?)(?=\r?\n--> statement-breakpoint|$)/g;

const fixedContent = content.replace(triggerRegex, (match) => {
  // Replace all newlines and multiple spaces within the trigger block with a single space
  return match.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
});

fs.writeFileSync(migrationPath, fixedContent, "utf8");
console.log("Successfully flattened all CREATE TRIGGER blocks in migration 0013.");
