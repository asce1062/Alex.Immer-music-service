/**
 * Structured Logger Utility
 * Uses Pino for high-performance structured logging in Lambda
 */

import pino from 'pino';

/**
 * Create logger instance with Lambda-optimized configuration
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Disable pretty printing in production/test for CloudWatch JSON parsing
  ...(process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test'
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        },
      }),
});

/**
 * Create child logger with additional context
 */
export function createLogger(context: Record<string, unknown>) {
  return logger.child(context);
}

/**
 * Log request details
 */
export function logRequest(method: string, path: string, sourceIp: string, clientId?: string) {
  logger.info(
    {
      type: 'request',
      method,
      path,
      sourceIp,
      clientId,
    },
    'Incoming request'
  );
}

/**
 * Log authentication success
 */
export function logAuthSuccess(clientId: string, origin?: string) {
  logger.info(
    {
      type: 'auth_success',
      clientId,
      origin,
    },
    `Client authenticated: ${clientId}`
  );
}

/**
 * Log authentication failure
 */
export function logAuthFailure(clientId: string | undefined, reason: string, origin?: string) {
  logger.warn(
    {
      type: 'auth_failure',
      clientId,
      reason,
      origin,
    },
    `Authentication failed: ${reason}`
  );
}

/**
 * Log session creation
 */
export function logSessionCreated(
  clientId: string,
  expiresAt: string,
  durationHours: number,
  origin?: string
) {
  logger.info(
    {
      type: 'session_created',
      clientId,
      expiresAt,
      durationHours,
      origin,
    },
    `Session created for ${clientId}`
  );
}

/**
 * Log errors with context
 */
export function logError(error: unknown, context?: Record<string, unknown>) {
  logger.error(
    {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...context,
    },
    'Error occurred'
  );
}
