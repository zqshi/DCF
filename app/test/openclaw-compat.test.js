const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompatServer } = require('./fixtures/openclaw-compat-server');

test('openclaw compat runtime is disabled and returns 410', async () => {
  const server = createCompatServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${addr.port}`;

  try {
    const submit = await fetch(`${base}/runtime/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Contract-Version': 'v1' },
      body: JSON.stringify({ goal: 'any' })
    });
    assert.equal(submit.status, 410);
    const body = await submit.json();
    assert.match(String(body.error || ''), /deprecated and disabled/i);

    const status = await fetch(`${base}/runtime/tasks/task-1`, {
      headers: { 'X-Contract-Version': 'v1' }
    });
    assert.equal(status.status, 410);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
