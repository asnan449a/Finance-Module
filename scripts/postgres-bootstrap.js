import { initStore, readDb } from '../server/store.js';
import { postgresBackedDomains, postgresPersistenceEnabled, postgresPersistenceStatus } from '../server/persistence/postgres.js';

if (!postgresPersistenceEnabled()) {
  console.error('PostgreSQL persistence is not enabled. Set TR_PERSISTENCE_MODE=postgres and TR_DATABASE_URL.');
  process.exit(1);
}

initStore();
const db = readDb();
const counts = Object.fromEntries(postgresBackedDomains().map((domain) => [domain, Array.isArray(db[domain]) ? db[domain].length : 0]));
console.log(JSON.stringify({ persistence: postgresPersistenceStatus(), counts }, null, 2));
