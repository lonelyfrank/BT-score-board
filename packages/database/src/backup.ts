import { SqliteStore } from './index.js';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const source = process.env.DATABASE_PATH ?? './data/darts.sqlite';
if (!existsSync(source)) throw new Error('Source database does not exist; backup was not created.');
const destination = process.argv[2];
if (!destination || resolve(source) === resolve(destination) || existsSync(destination))
  throw new Error('Provide a new destination path: pnpm db:backup ./backups/darts.sqlite');
mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
const store = new SqliteStore(source);
try {
  await store.sqlite.backup(destination);
  console.log(`Backup saved to ${destination}`);
} finally {
  store.close();
}
