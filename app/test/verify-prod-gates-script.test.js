const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { hashPasswordForStorage } = require('../src/application/usecases/AuthUseCases');

const scriptPath = path.resolve(__dirname, '../scripts/verify-prod-gates.js');

function runGate(args = [], envPatch = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    env: { ...process.env, ...envPatch },
    encoding: 'utf8'
  });
}

test('verify-prod-gates baseline profile passes in default dev mode', () => {
  const result = runGate(['--profile=baseline']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(String(result.stdout || '{}'));
  assert.equal(body.ok, true);
  assert.equal(body.profile, 'baseline');
});

test('verify-prod-gates production profile fails when auth hardening is missing', () => {
  const result = runGate(['--profile=production'], {
    AUTH_USERS_FILE: '',
    AUTH_USERS_JSON: '',
    AUTH_PASSWORD_PEPPER: '',
    AUTH_REQUIRE_EXTERNAL_USERS: '',
    AUTH_FORBID_DEMO_USERS: '',
    CORS_ALLOW_ORIGIN: 'https://admin.example.com'
  });
  assert.equal(result.status, 1);
  const body = JSON.parse(String(result.stderr || '{}'));
  assert.equal(body.ok, false);
  assert.equal(body.profile, 'production');
  assert.equal(body.failedGate, 'auth-health');
});

test('verify-prod-gates production profile passes with strict auth env and persistent db', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dcf-gates-'));
  const usersFile = path.join(dir, 'users.json');
  const pepper = 'pepper-prod-gate';
  const hash = hashPasswordForStorage('secret-pass-001', pepper);
  fs.writeFileSync(usersFile, JSON.stringify([{
    id: 'u-root-1',
    username: 'root_admin',
    displayName: 'Root Admin',
    role: 'super_admin',
    passwordHash: hash
  }]), 'utf8');

  const result = runGate(['--profile=production'], {
    NODE_ENV: 'production',
    AUTH_USERS_FILE: usersFile,
    AUTH_PASSWORD_PEPPER: pepper,
    AUTH_REQUIRE_EXTERNAL_USERS: '1',
    AUTH_FORBID_DEMO_USERS: '1',
    CORS_ALLOW_ORIGIN: 'https://admin.example.com',
    DB_DRIVER: 'sqlite'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const body = JSON.parse(String(result.stdout || '{}'));
  assert.equal(body.ok, true);
  assert.equal(body.profile, 'production');
  assert.equal(Array.isArray(body.gates), true);
  assert.equal(body.gates.some((x) => x.gate === 'layer-boundary' && x.ok === true), true);
  assert.equal(body.gates.some((x) => x.gate === 'production-env-hardening' && x.ok === true), true);
});
