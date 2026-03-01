const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { analyzeLayerBoundaries } = require('./verify-layer-boundaries');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = ['src', 'scripts', 'test', 'public'];
const JS_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, files);
      continue;
    }
    if (JS_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

function main() {
  const files = [];
  for (const folder of TARGET_DIRS) {
    const absolute = path.join(ROOT, folder);
    if (!fs.existsSync(absolute)) continue;
    walk(absolute, files);
  }
  for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  }
  const layerReport = analyzeLayerBoundaries(ROOT);
  if (!layerReport.ok) {
    throw new Error(`layer boundary violations detected: ${JSON.stringify(layerReport.violations)}`);
  }
  process.stdout.write(JSON.stringify({ ok: true, checkedFiles: files.length }) + '\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(String(error && error.stderr ? error.stderr : error.message || error) + '\n');
  process.exit(1);
}
