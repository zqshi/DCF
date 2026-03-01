const fs = require('fs');
const path = require('path');
const { createApp } = require('./interfaces/http/createApp');
const { logger } = require('./shared/logger');
const {
  ensureLlmStartupReadiness,
  ensureOpenClawSecurityReadiness,
  ensureProductionStartupReadiness,
  ensureOpenClawRuntimeReadiness
} = require('./shared/startupGuards');

const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000;

function loadDotEnvNoOverride() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const key = trimmed.slice(0, trimmed.indexOf('=')).trim();
    const value = trimmed.slice(trimmed.indexOf('=') + 1);
    if (!key) continue;
    if (typeof process.env[key] === 'undefined') process.env[key] = value;
  }
}

async function main() {
  loadDotEnvNoOverride();
  const PORT = process.env.PORT || 8080;
  const HOST = process.env.HOST || '127.0.0.1';
  ensureLlmStartupReadiness(process.env);
  ensureOpenClawSecurityReadiness(process.env);
  ensureProductionStartupReadiness(process.env);
  await ensureOpenClawRuntimeReadiness(process.env);
  const server = await createApp();

  let shuttingDown = false;
  async function gracefulExit(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    const forceTimer = setTimeout(() => {
      logger.error('shutdown timeout, forcing exit', { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS });
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceTimer.unref();
    try {
      await server.shutdown();
    } catch (err) {
      logger.error('shutdown error', { error: err.message });
    } finally {
      process.exit(0);
    }
  }

  process.on('SIGINT', () => gracefulExit('SIGINT'));
  process.on('SIGTERM', () => gracefulExit('SIGTERM'));

  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', { stack: err.stack || err.message });
    gracefulExit('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', { stack: reason && reason.stack ? reason.stack : String(reason) });
    gracefulExit('unhandledRejection');
  });

  server.listen(PORT, HOST, () => {
    logger.info('server started', { host: HOST, port: PORT });
    if (typeof process.send === 'function') process.send('ready');
  });
}

main().catch((error) => {
  logger.error('startup failed', { error: error.message });
  process.exit(1);
});
