import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'server-core' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function redactConnectionCredentials(value) {
  return value.replace(/(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi, '$1[redacted]@');
}

export function serializeError(error) {
  const message =
    error instanceof Error || typeof error?.message === 'string'
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  const name = typeof error?.name === 'string' ? error.name : 'Error';
  const stack = typeof error?.stack === 'string' ? error.stack : undefined;
  return {
    name,
    message: redactConnectionCredentials(message),
    ...(stack ? { stack: redactConnectionCredentials(stack) } : {}),
  };
}

export default logger;
