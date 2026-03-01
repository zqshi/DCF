#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const LAYERS = new Set(['domain', 'application', 'infrastructure', 'interfaces', 'shared']);

function parseArgs(argv = process.argv.slice(2)) {
  let root = path.resolve(__dirname, '..');
  for (const arg of argv) {
    if (arg.startsWith('--root=')) {
      root = path.resolve(arg.slice('--root='.length));
    }
  }
  return { root };
}

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (entry.isFile() && abs.endsWith('.js')) out.push(abs);
  }
  return out;
}

function extractImportSpecifiers(content = '') {
  const result = [];
  const requirePattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  const importPattern = /from\s+['"]([^'"]+)['"]/g;
  let match = null;
  while ((match = requirePattern.exec(content)) !== null) result.push(match[1]);
  while ((match = importPattern.exec(content)) !== null) result.push(match[1]);
  return result;
}

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`,
    path.join(base, 'index.js')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function layerFromFile(root, filePath) {
  const srcRoot = path.join(root, 'src');
  if (!filePath.startsWith(srcRoot)) return null;
  const rel = path.relative(srcRoot, filePath);
  const first = rel.split(path.sep)[0];
  return LAYERS.has(first) ? first : null;
}

function isViolation(fromLayer, toLayer) {
  if (!fromLayer || !toLayer) return false;
  if (fromLayer === 'domain' && (toLayer === 'interfaces' || toLayer === 'infrastructure')) return true;
  if (fromLayer === 'application' && toLayer === 'interfaces') return true;
  if (fromLayer === 'interfaces' && toLayer === 'domain') return true;
  return false;
}

function analyzeLayerBoundaries(root) {
  const srcRoot = path.join(root, 'src');
  if (!fs.existsSync(srcRoot)) {
    return {
      ok: false,
      root,
      checkedFiles: 0,
      violations: [{ reason: 'src directory not found' }]
    };
  }
  const files = walk(srcRoot);
  const violations = [];
  for (const file of files) {
    const fromLayer = layerFromFile(root, file);
    if (!fromLayer) continue;
    const content = fs.readFileSync(file, 'utf8');
    const specs = extractImportSpecifiers(content);
    for (const specifier of specs) {
      const target = resolveLocalImport(file, specifier);
      if (!target) continue;
      const toLayer = layerFromFile(root, target);
      if (!toLayer) continue;
      if (!isViolation(fromLayer, toLayer)) continue;
      violations.push({
        file: path.relative(root, file),
        import: specifier,
        target: path.relative(root, target),
        fromLayer,
        toLayer
      });
    }
  }
  return {
    ok: violations.length === 0,
    root,
    checkedFiles: files.length,
    violations
  };
}

function main() {
  const { root } = parseArgs();
  const report = analyzeLayerBoundaries(root);
  if (!report.ok) {
    process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  analyzeLayerBoundaries
};
