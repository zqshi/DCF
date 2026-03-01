/**
 * Zero-dependency structured JSON logger.
 * Outputs to stdout (info) / stderr (warn, error) — Docker/K8s friendly.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[String(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function formatEntry(level, message, extra, context) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    pid: process.pid,
    ...context,
    message,
    ...(extra && typeof extra === 'object' ? extra : {})
  });
}

function createLogger(context = {}) {
  const logger = {};

  for (const [level, value] of Object.entries(LEVELS)) {
    logger[level] = (message, extra) => {
      if (value < MIN_LEVEL) return;
      const line = formatEntry(level, message, extra, context);
      if (value >= LEVELS.warn) {
        process.stderr.write(line + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    };
  }

  logger.child = (childContext) => {
    return createLogger({ ...context, ...childContext });
  };

  return logger;
}

const defaultLogger = createLogger({ service: 'dcf' });

module.exports = { createLogger, logger: defaultLogger };
