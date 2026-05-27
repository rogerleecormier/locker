import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const DB_NAME = 'locker-db';
const rawToken = `lkr_${crypto.randomUUID().replace(/-/g, "")}`;
const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
const id = crypto.randomUUID();
const userId = 'test-user-id';
const name = 'Local Test Token';
const permissions = 3; // recall_context & commit_memory
const createdAt = Date.now();

console.log('Generating local API Token...');
console.log('Plaintext token:', rawToken);
console.log('Token hash:', tokenHash);

const sql = `INSERT INTO api_tokens (id, userId, name, tokenHash, permissions, createdAt) VALUES ('${id}', '${userId}', '${name}', '${tokenHash}', ${permissions}, ${createdAt});`;

try {
  const result = execSync(
    `npx wrangler d1 execute ${DB_NAME} --local --json --command ${JSON.stringify(sql)}`,
    { encoding: "utf8" }
  );
  console.log('Successfully inserted token into local D1 DB.');
  console.log('Result:', result.trim());
  console.log('\nUse this token to test:');
  console.log(`Authorization: Bearer ${rawToken}`);
} catch (err) {
  console.error('Error inserting token:', err.message);
}
