const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createCompatServer } = require('./fixtures/openclaw-compat-server');

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, `../contracts/${fileName}`), 'utf8'));
}

test('runtime contract schemas still exist for direct OpenClaw runtime integration', () => {
  const submit = readJson('runtime-task-submit.schema.json');
  const status = readJson('runtime-task-status.schema.json');
  const event = readJson('runtime-task-event.schema.json');
  const runtimeError = readJson('runtime-error.schema.json');

  assert.equal(submit.$id, 'dcf.runtime.task.submit.v1');
  assert.equal(status.$id, 'dcf.runtime.task.status.v1');
  assert.equal(event.$id, 'dcf.runtime.task.event.v1');
  assert.equal(runtimeError.$id, 'dcf.runtime.error.v1');
});

test('compat runtime endpoint is explicitly disabled', async () => {
  const server = createCompatServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const submit = await fetch(`${baseUrl}/runtime/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Contract-Version': 'v1' },
      body: JSON.stringify({ goal: 'deprecated path probe' })
    });
    assert.equal(submit.status, 410);
    const submitBody = await submit.json();
    assert.match(String(submitBody.error || ''), /deprecated and disabled/i);

    const status = await fetch(`${baseUrl}/runtime/tasks/rt-1`, {
      headers: { 'X-Contract-Version': 'v1' }
    });
    assert.equal(status.status, 410);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
