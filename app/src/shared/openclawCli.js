const path = require('path');

function hasValue(value) {
  return String(value || '').trim().length > 0;
}

function parseArgs(raw) {
  return String(raw || '')
    .split(/\s+/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function resolveOpenClawCliInvocation(env = process.env, options = {}) {
  const cliEntry = String(
    options.openclawCliEntry
    || env.OPENCLAW_CLI_ENTRY
    || ''
  ).trim();
  const extraArgs = parseArgs(options.openclawCliArgs || env.OPENCLAW_CLI_ARGS || '');
  if (hasValue(cliEntry)) {
    const resolvedEntry = path.resolve(cliEntry);
    return {
      bin: String(options.nodeBin || process.execPath),
      argsPrefix: [resolvedEntry, ...extraArgs]
    };
  }
  return {
    bin: String(options.openclawCliBin || env.OPENCLAW_CLI_BIN || 'openclaw').trim() || 'openclaw',
    argsPrefix: extraArgs
  };
}

module.exports = {
  resolveOpenClawCliInvocation
};
