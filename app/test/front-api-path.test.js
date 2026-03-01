const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildFrontApiCandidates,
  inferFrontMountPrefix,
  buildLocalPortFallbackOrigins
} = require('../public/front-api-path.js');

test('infer front mount prefix from front page path', () => {
  assert.equal(inferFrontMountPrefix('/front.html'), '');
  assert.equal(inferFrontMountPrefix('/dcf/front.html'), '/dcf');
  assert.equal(inferFrontMountPrefix('/dcf/front-login.html'), '/dcf');
  assert.equal(inferFrontMountPrefix('/openclaw/OS.html'), '/openclaw');
  assert.equal(inferFrontMountPrefix('/dcf/'), '/dcf');
});

test('build api candidates for root front path', () => {
  const candidates = buildFrontApiCandidates('/api/front/tasks', '/front.html');
  assert.deepEqual(candidates, [
    '/api/front/tasks',
    '/api/v1/front/tasks'
  ]);
});

test('build api candidates for nested front path', () => {
  const candidates = buildFrontApiCandidates('/api/front/tasks', '/dcf/front.html');
  assert.deepEqual(candidates, [
    '/api/front/tasks',
    '/api/v1/front/tasks',
    '/dcf/api/front/tasks',
    '/dcf/api/v1/front/tasks'
  ]);
});

test('build api candidates for nested generic html path', () => {
  const candidates = buildFrontApiCandidates('/api/front/tasks', '/openclaw/OS.html');
  assert.deepEqual(candidates, [
    '/api/front/tasks',
    '/api/v1/front/tasks',
    '/openclaw/api/front/tasks',
    '/openclaw/api/v1/front/tasks'
  ]);
});

test('build localhost port fallback candidates', () => {
  const candidates = buildFrontApiCandidates('/api/front/tasks', '/front.html', {
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: '8091'
  });
  assert.deepEqual(candidates, [
    '/api/front/tasks',
    '/api/v1/front/tasks',
    'http://127.0.0.1:8092/api/front/tasks',
    'http://127.0.0.1:8092/api/v1/front/tasks'
  ]);
});

test('build local fallback origins only on loopback and non-8092', () => {
  assert.deepEqual(buildLocalPortFallbackOrigins({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: '8091'
  }), ['http://127.0.0.1:8092']);
  assert.deepEqual(buildLocalPortFallbackOrigins({
    protocol: 'http:',
    hostname: '127.0.0.1',
    port: '8080'
  }), ['http://127.0.0.1:8092', 'http://127.0.0.1:8091']);
  assert.deepEqual(buildLocalPortFallbackOrigins({
    protocol: 'http:',
    hostname: 'localhost',
    port: '8092'
  }), ['http://localhost:8091']);
  assert.deepEqual(buildLocalPortFallbackOrigins({
    protocol: 'https:',
    hostname: 'example.com',
    port: '443'
  }), []);
});

test('keep non-api path untouched', () => {
  const candidates = buildFrontApiCandidates('/front.html', '/dcf/front.html');
  assert.deepEqual(candidates, ['/front.html']);
});
