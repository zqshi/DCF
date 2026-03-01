#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const { randomUUID } = require('crypto');

function parseArgs(argv) {
  const args = {
    staleMinutes: Number(process.env.DCF_STALE_TASK_MINUTES || 3),
    statuses: String(process.env.DCF_STALE_TASK_STATUSES || 'running').split(',').map((s) => s.trim()).filter(Boolean)
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--stale-minutes' && argv[i + 1]) {
      args.staleMinutes = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (a === '--statuses' && argv[i + 1]) {
      args.statuses = String(argv[i + 1]).split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    }
  }
  if (!Number.isFinite(args.staleMinutes) || args.staleMinutes <= 0) args.staleMinutes = 3;
  if (!args.statuses.length) args.statuses = ['running'];
  return args;
}

function main() {
  const { staleMinutes, statuses } = parseArgs(process.argv.slice(2));
  const appRoot = path.resolve(__dirname, '..');
  const configuredSqlitePath = String(process.env.SQLITE_PATH || '').trim();
  const dbPath = configuredSqlitePath
    ? (path.isAbsolute(configuredSqlitePath)
      ? configuredSqlitePath
      : path.resolve(appRoot, configuredSqlitePath))
    : path.resolve(appRoot, 'data', 'dcf.sqlite');

  let Database;
  try {
    // Optional dependency in this project.
    // eslint-disable-next-line global-require
    Database = require('better-sqlite3');
  } catch (error) {
    console.error(`error: better-sqlite3 unavailable: ${error.message}`);
    process.exit(1);
  }

  const db = new Database(dbPath);
  const now = new Date();
  const cutoff = new Date(now.getTime() - staleMinutes * 60 * 1000);
  const nowIso = now.toISOString();
  const cutoffIso = cutoff.toISOString();

  const rows = db.prepare('SELECT id, payload, updated_at FROM tasks').all();
  const updateTask = db.prepare(`
    INSERT INTO tasks (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
  `);
  const insertEvent = db.prepare(`
    INSERT INTO events (id, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at
  `);

  let recovered = 0;
  const recoveredIds = [];
  const tx = db.transaction(() => {
    for (const row of rows) {
      let task;
      try {
        task = JSON.parse(row.payload);
      } catch {
        continue;
      }
      const status = String(task.status || '').trim();
      if (!statuses.includes(status)) continue;
      const updatedAt = String(task.updatedAt || row.updated_at || '').trim();
      if (!updatedAt || updatedAt > cutoffIso) continue;

      task.status = 'failed';
      task.updatedAt = nowIso;
      task.lastError = {
        severity: 'P2',
        code: 'MAINTENANCE_STALE_TASK_RECOVERED',
        message: `Task stale for >= ${staleMinutes}m and recovered by maintenance script.`
      };

      updateTask.run(task.id || row.id, JSON.stringify(task), nowIso);
      const event = {
        id: `evt-${randomUUID()}`,
        type: 'task.failed',
        at: nowIso,
        payload: {
          taskId: task.id || row.id,
          employeeId: task.employeeId || null,
          conversationId: task.conversationId || null,
          message: 'Task recovered from stale running state by maintenance.',
          error: task.lastError
        }
      };
      insertEvent.run(event.id, JSON.stringify(event), nowIso);
      recovered += 1;
      recoveredIds.push(task.id || row.id);
    }
  });

  try {
    tx();
  } finally {
    db.close();
  }

  console.log(JSON.stringify({
    ok: true,
    dbPath,
    staleMinutes,
    statuses,
    recovered,
    recoveredIds
  }, null, 2));
}

main();
