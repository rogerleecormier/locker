import { DatabaseSync } from 'node:sqlite';

const dbPath = '/home/roger_lee_cormier/Documents/dev/locker/locker/dist/server/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/0b1821eab3c7d2e969b5392d8019d5446ef64193bfd1760a447f76afca6846f7.sqlite';

console.log('Opening database:', dbPath);
const db = new DatabaseSync(dbPath);

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables:', tables);

  const tokens = db.prepare("SELECT * FROM api_tokens").all();
  console.log('Tokens in dist/server DB:', tokens);
} catch (err) {
  console.error('Error querying DB:', err);
}
