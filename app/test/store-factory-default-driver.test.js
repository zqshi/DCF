const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createStoreFromEnv } = require('../src/infrastructure/repositories/StoreFactory');

function withEnv(overrides, fn) {
  const original = {
    DB_DRIVER: process.env.DB_DRIVER,
    SQLITE_PATH: process.env.SQLITE_PATH,
    POSTGRES_URL: process.env.POSTGRES_URL
  };
  if (Object.prototype.hasOwnProperty.call(overrides, 'DB_DRIVER')) {
    if (overrides.DB_DRIVER === undefined) delete process.env.DB_DRIVER;
    else process.env.DB_DRIVER = overrides.DB_DRIVER;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'SQLITE_PATH')) {
    if (overrides.SQLITE_PATH === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = overrides.SQLITE_PATH;
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'POSTGRES_URL')) {
    if (overrides.POSTGRES_URL === undefined) delete process.env.POSTGRES_URL;
    else process.env.POSTGRES_URL = overrides.POSTGRES_URL;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (original.DB_DRIVER === undefined) delete process.env.DB_DRIVER;
      else process.env.DB_DRIVER = original.DB_DRIVER;

      if (original.SQLITE_PATH === undefined) delete process.env.SQLITE_PATH;
      else process.env.SQLITE_PATH = original.SQLITE_PATH;

      if (original.POSTGRES_URL === undefined) delete process.env.POSTGRES_URL;
      else process.env.POSTGRES_URL = original.POSTGRES_URL;
    });
}

test('store factory defaults to sqlite when DB_DRIVER is unset', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-store-factory-'));
  const sqlitePath = path.join(tempDir, 'dcf.sqlite');
  try {
    await withEnv({
      DB_DRIVER: undefined,
      SQLITE_PATH: sqlitePath
    }, async () => {
      const { store, driver, close } = await createStoreFromEnv();
      assert.equal(store.driver, 'sqlite');
      assert.equal(driver, `sqlite:${sqlitePath}`);
      assert.equal(fs.existsSync(sqlitePath), true);
      await close();
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('store factory still supports explicit memory driver', async () => {
  await withEnv({ DB_DRIVER: 'memory' }, async () => {
    const { store, driver, close } = await createStoreFromEnv();
    assert.equal(store.driver, 'memory');
    assert.equal(driver, 'memory');
    await close();
  });
});
