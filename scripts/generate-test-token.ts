import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { hashToken } from '../src/server/crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DB_NAME = 'locker-db';
const CONFIG_PATH = 'dist/server/wrangler.json';

async function run() {
  const id = crypto.randomUUID();
  const idHex = id.replace(/-/g, "");
  const secretBytes = crypto.randomBytes(16);
  const secretHex = secretBytes.toString('hex');
  const rawToken = `lkr_${idHex}_${secretHex}`;
  
  const tokenHash = await hashToken(rawToken);
  const userId = 'VccpgcmaIPl0Ddu0zxZc7jmLGFKHhODJ';
  const name = 'Local Test Token';
  const permissions = 3; // recall_context & commit_memory
  const createdAt = Date.now();

  console.log('Generating local API Token...');
  console.log('Token ID (UUID):', id);
  console.log('Plaintext token:', rawToken);
  console.log('Token hash:', tokenHash);

  // We want to insert the token in both:
  // 1. Root .wrangler state (for wrangler CLI calls without config)
  // 2. dist/server/.wrangler state (for the running dev server)
  const deleteSql = `DELETE FROM api_tokens WHERE userId = '${userId}' AND name = '${name}';`;
  const insertSql = `INSERT INTO api_tokens (id, userId, name, tokenHash, permissions, createdAt) VALUES ('${id}', '${userId}', '${name}', '${tokenHash}', ${permissions}, ${createdAt});`;

  const tempSqlFile = path.resolve('scratch/temp.sql');
  const sqlContent = `${deleteSql}\n${insertSql}\n`;

  try {
    fs.writeFileSync(tempSqlFile, sqlContent, 'utf8');

    // Insert into root wrangler D1 (with wrangler.json config)
    console.log('Inserting into root D1 database (using wrangler.json)...');
    execSync(
      `npx wrangler d1 execute ${DB_NAME} --local --config wrangler.json --file "${tempSqlFile}"`,
      { encoding: "utf8" }
    );

    // Insert into dist/server wrangler D1 (using dist/server/wrangler.json config)
    console.log('Inserting into dist/server D1 database (using dist/server/wrangler.json)...');
    try {
      execSync(
        `npx wrangler d1 execute ${DB_NAME} --local --config ${CONFIG_PATH} --file "${tempSqlFile}"`,
        { encoding: "utf8" }
      );
    } catch (dbErr: any) {
      console.warn('Warning: Could not insert token into dist/server DB (likely not migrated):', dbErr.message);
    }

    console.log('Successfully inserted token into both local D1 DBs.');
    console.log('\nUse this token to test:');
    console.log(`Authorization: Bearer ${rawToken}`);
    
    // Automatically update scripts/test-mcp-calls.mjs with this token
    const testScriptPath = path.resolve('scripts/test-mcp-calls.mjs');
    let content = fs.readFileSync(testScriptPath, 'utf8');
    content = content.replace(/const TOKEN = 'lkr_[a-f0-9_]+';/, `const TOKEN = '${rawToken}';`);
    fs.writeFileSync(testScriptPath, content, 'utf8');
    console.log(`Updated scripts/test-mcp-calls.mjs with new token.`);

  } catch (err: any) {
    console.error('Error inserting token:', err.message);
    process.exit(1);
  } finally {
    try {
      if (fs.existsSync(tempSqlFile)) {
        fs.unlinkSync(tempSqlFile);
      }
    } catch (e) {}
  }
}

run();
