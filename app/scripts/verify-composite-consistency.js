#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function readText(rootDir, relativePath) {
  const fullPath = path.resolve(rootDir, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`missing required file: ${relativePath}`);
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function assertIncludes(text, pattern, message) {
  if (!text.includes(pattern)) throw new Error(message);
}

function assertNotIncludes(text, pattern, message) {
  if (text.includes(pattern)) throw new Error(message);
}

function checkMigrationChecklist(rootDir) {
  const standardsReadme = readText(rootDir, '../docs/standards/README.md');
  const checklistPath = path.resolve(rootDir, '../docs/迁移任务清单（可勾选）.md');
  if (!fs.existsSync(checklistPath)) {
    throw new Error('docs/迁移任务清单（可勾选）.md is required by docs/standards/README.md');
  }
  assertIncludes(
    standardsReadme,
    '迁移任务清单（可勾选）.md',
    'standards README must reference migration checklist'
  );
}

function checkReadmeConsistency(rootDir) {
  const readme = readText(rootDir, 'README.md');
  assertNotIncludes(readme, 'Fallback to legacy execute', 'README must not describe legacy execute fallback');
  assertNotIncludes(readme, 'self-hosted fallback', 'README must not describe self-hosted fallback strategy');
  assertNotIncludes(readme, 'http://127.0.0.1:8091/front.html', 'README should use 8092 frontend baseline');
  assertIncludes(readme, 'http://127.0.0.1:8092/front.html', 'README should document 8092 frontend baseline');
}

function checkPortBaselines(rootDir) {
  const applyScript = readText(rootDir, 'scripts/apply-runtime-permission-baseline.js');
  const bootstrapScript = readText(rootDir, 'scripts/bootstrap-production-auth.js');
  const toolUseCases = readText(rootDir, 'src/application/usecases/ToolUseCases.js');
  const localDockerEnv = readText(rootDir, 'config/runtime-permission.local-docker.env.example');
  const prodEnv = readText(rootDir, 'config/runtime-permission.production.env.example');
  const rbacPlaybook = readText(rootDir, '../docs/rbac/2026-02-24-runtime-permission-apply-playbook.md');

  assertIncludes(applyScript, 'http://127.0.0.1:8092', 'runtime permission apply script should default to 8092');
  assertIncludes(bootstrapScript, "PORT=8092", 'production bootstrap should emit PORT=8092');
  assertIncludes(toolUseCases, "http://127.0.0.1:8092/mcp", 'default MCP runtime endpoint should use 8092');
  assertIncludes(localDockerEnv, 'PORT=8092', 'local docker runtime permission env should use PORT=8092');
  assertIncludes(prodEnv, 'PORT=8092', 'production runtime permission env should use PORT=8092');
  assertNotIncludes(rbacPlaybook, 'http://127.0.0.1:8091', 'rbac playbook should not reference 8091');
}

function checkRuntimeFallbackDefaults(rootDir) {
  const startAll = readText(rootDir, '../start-all.sh');
  const watchdog = readText(rootDir, '../scripts/openclaw-gateway-watchdog.sh');
  const expected = 'DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-0}"';
  assertIncludes(startAll, expected, 'start-all should default DCF_RUNTIME_ALLOW_FALLBACK to 0');
  assertNotIncludes(startAll, 'DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-1}"', 'start-all must not default fallback to 1');
  assertIncludes(watchdog, expected, 'openclaw watchdog should default DCF_RUNTIME_ALLOW_FALLBACK to 0');
  assertNotIncludes(watchdog, 'DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-1}"', 'openclaw watchdog must not default fallback to 1');
}

function main() {
  const rootDir = path.resolve(__dirname, '..');
  const checks = [];
  const run = (name, fn) => {
    fn();
    checks.push({ name, ok: true });
  };

  try {
    run('migration-checklist-link', () => checkMigrationChecklist(rootDir));
    run('readme-strategy-consistency', () => checkReadmeConsistency(rootDir));
    run('port-baseline-consistency', () => checkPortBaselines(rootDir));
    run('runtime-fallback-defaults', () => checkRuntimeFallbackDefaults(rootDir));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      checks,
      error: String((error && error.message) || error)
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

if (require.main === module) {
  main();
}
