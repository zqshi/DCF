const path = require('path');
const { InMemoryStore } = require('./InMemoryStore');
const { SqliteSnapshotStore } = require('./SqliteSnapshotStore');
const { PostgresSnapshotStore } = require('./PostgresSnapshotStore');

async function createStoreFromEnv() {
  const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();

  if (driver === 'memory') {
    return { store: new InMemoryStore(), driver: 'memory', close: async () => {} };
  }

  if (driver === 'sqlite') {
    try {
      const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'dcf.sqlite');
      const fs = require('fs');
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const store = new SqliteSnapshotStore(dbPath);
      store.init();
      store.startAutoPersist(1000);
      return { store, driver: `sqlite:${dbPath}`, close: async () => store.stop() };
    } catch (error) {
      throw new Error(`SQLite mode requires 'better-sqlite3'. Install and retry. root cause: ${error.message}`);
    }
  }

  if (driver === 'postgres') {
    const conn = process.env.POSTGRES_URL;
    if (!conn) throw new Error('POSTGRES_URL is required when DB_DRIVER=postgres');
    try {
      const store = new PostgresSnapshotStore(conn);
      await store.init();
      store.startAutoPersist(1000);
      return { store, driver: 'postgres', close: async () => store.stop() };
    } catch (error) {
      throw new Error(`Postgres mode requires 'pg' and a reachable DB. root cause: ${error.message}`);
    }
  }

  throw new Error(`Unsupported DB_DRIVER: ${driver}`);
}

module.exports = { createStoreFromEnv };
