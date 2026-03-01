#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    skipTests: argv.includes('--skip-tests')
  };
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const raw = String(line || '').trim();
    if (!raw || raw.startsWith('#')) continue;
    const idx = raw.indexOf('=');
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function resolveProductionEnvDefaults(cwd = process.cwd()) {
  const localPath = path.join(cwd, '.env.production.local');
  const fallbackPath = path.join(cwd, '.env.production');
  const examplePath = path.join(cwd, '.env.production.example');
  if (fs.existsSync(localPath)) return parseEnvFile(localPath);
  if (fs.existsSync(fallbackPath)) return parseEnvFile(fallbackPath);
  if (fs.existsSync(examplePath)) return parseEnvFile(examplePath);
  return {};
}

function runStep(step) {
  const env = { ...process.env };
  if (step.env && typeof step.env === 'object') {
    for (const [key, value] of Object.entries(step.env)) env[key] = String(value);
  }
  if (Array.isArray(step.unsetEnv)) {
    for (const key of step.unsetEnv) delete env[key];
  }
  const result = spawnSync(step.cmd, step.args, {
    stdio: 'inherit',
    env
  });
  return {
    name: step.name,
    ok: result.status === 0,
    status: result.status
  };
}

function buildSteps(options = {}) {
  const npm = npmCommand();
  const steps = [];
  const productionDefaults = resolveProductionEnvDefaults();
  if (!options.skipTests) {
    steps.push({
      name: 'unit-and-integration-tests',
      cmd: npm,
      args: ['test'],
      env: {
        NODE_ENV: 'test',
        DB_DRIVER: 'memory'
      },
      unsetEnv: [
        'AUTH_USERS_FILE',
        'AUTH_USERS_JSON',
        'AUTH_REQUIRE_EXTERNAL_USERS',
        'AUTH_FORBID_DEMO_USERS',
        'AUTH_PASSWORD_PEPPER',
        'SQLITE_PATH',
        'POSTGRES_URL'
      ]
    });
  }
  steps.push(
    {
      name: 'p1-rollback-drill',
      cmd: npm,
      args: ['run', 'drill:p1-rollback']
    },
    { name: 'composite-consistency', cmd: npm, args: ['run', 'verify:composite-consistency'] },
    { name: 'openclaw-alignment', cmd: npm, args: ['run', 'verify:openclaw-alignment'] },
    { name: 'performance-smoke', cmd: npm, args: ['run', 'verify:perf-smoke'] },
    {
      name: 'production-gates',
      cmd: npm,
      args: ['run', 'verify:prod-gates', '--', '--profile=production'],
      env: productionDefaults
    }
  );

  if (hasValue(process.env.OPENCLAW_BASE_URL) || hasValue(process.env.OPENCLAW_GATEWAY_URL)) {
    steps.push({ name: 'openclaw-contract', cmd: npm, args: ['run', 'verify:openclaw-contract'] });
    if (String(process.env.DCF_VERIFY_BROWSER_CAPABILITY || '0').trim() === '1') {
      steps.push({ name: 'browser-capability', cmd: npm, args: ['run', 'verify:browser-capability'] });
    }
  }

  if (hasValue(process.env.AUDIT_ANCHOR_LEDGER_PATH)) {
    const ledgerPath = String(process.env.AUDIT_ANCHOR_LEDGER_PATH).trim();
    const secret = hasValue(process.env.AUDIT_ANCHOR_SECRET)
      ? String(process.env.AUDIT_ANCHOR_SECRET).trim()
      : '';
    const args = ['run', 'audit:verify-ledger', '--', ledgerPath];
    if (secret) args.push(secret);
    steps.push({ name: 'audit-ledger-chain', cmd: npm, args });
  }
  return steps;
}

function main() {
  const args = parseArgs();
  const steps = buildSteps(args);
  const results = [];
  for (const step of steps) {
    const result = runStep(step);
    results.push(result);
    if (!result.ok) {
      console.error(JSON.stringify({
        ok: false,
        failedStep: result.name,
        steps: results
      }, null, 2));
      process.exit(1);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    testsIncluded: !args.skipTests,
    steps: results
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  buildSteps
};
