import { SqliteStore } from './index.js';
const store = new SqliteStore(process.env.DATABASE_PATH ?? './data/darts.sqlite');
console.log('Database migrations applied successfully.');
store.close();
