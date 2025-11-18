/**
 * Custom error classes
 */

export class MusicServiceError extends Error {
  public readonly timestamp: Date;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly originalError?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MusicServiceError';
    this.timestamp = new Date();
    this.context = context;
    Object.setPrototypeOf(this, MusicServiceError.prototype);

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Convert error to JSON for logging/debugging
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack,
    };
  }
}

export class AuthenticationError extends MusicServiceError {
  constructor(message: string, statusCode?: number, context?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', statusCode, undefined, context);
    this.name = 'AuthenticationError';
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
}

export class NetworkError extends MusicServiceError {
  constructor(message: string, originalError?: unknown, context?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', undefined, originalError, context);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export class ValidationError extends MusicServiceError {
  constructor(
    message: string,
    public readonly validationErrors?: unknown,
    context?: Record<string, unknown>
  ) {
    super(message, 'VALIDATION_ERROR', undefined, validationErrors, context);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class RateLimitError extends MusicServiceError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    context?: Record<string, unknown>
  ) {
    super(message, 'RATE_LIMIT_ERROR', 429, undefined, context);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class NotFoundError extends MusicServiceError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'NOT_FOUND_ERROR', 404, undefined, context);
    this.name = 'NotFoundError';
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class CacheError extends MusicServiceError {
  constructor(message: string, originalError?: unknown, context?: Record<string, unknown>) {
    super(message, 'CACHE_ERROR', undefined, originalError, context);
    this.name = 'CacheError';
    Object.setPrototypeOf(this, CacheError.prototype);
  }
}
