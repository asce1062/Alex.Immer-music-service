/**
 * Debug logging utility
 *
 * Provides structured logging with different levels and namespaces
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  namespace: string;
  message: string;
  data?: unknown;
}

export interface LoggerConfig {
  enabled?: boolean;
  level?: LogLevel;
  namespace?: string;
  prefix?: string;
  useColors?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '#6c757d', // gray
  info: '#0d6efd', // blue
  warn: '#ffc107', // yellow
  error: '#dc3545', // red
};

export class Logger {
  private config: Required<LoggerConfig>;
  private history: LogEntry[] = [];
  private maxHistorySize = 100;
  private children: Logger[] = [];

  constructor(config?: LoggerConfig) {
    this.config = {
      enabled: config?.enabled ?? false,
      level: config?.level ?? 'info',
      namespace: config?.namespace ?? 'SDK',
      prefix: config?.prefix ?? '[MusicService]',
      useColors: config?.useColors ?? true,
    };
  }

  /**
   * Log debug message
   */
  debug(message: string, data?: unknown): void {
    this.log('debug', message, data);
  }

  /**
   * Log info message
   */
  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  /**
   * Log warning message
   */
  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  /**
   * Log error message
   */
  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }

  /**
   * Create a child logger with a sub-namespace
   */
  child(namespace: string): Logger {
    const childLogger = new Logger({
      ...this.config,
      namespace: `${this.config.namespace}:${namespace}`,
    });
    this.children.push(childLogger);
    return childLogger;
  }

  /**
   * Enable logging (propagates to children)
   */
  enable(): void {
    this.config.enabled = true;
    this.children.forEach((child) => child.enable());
  }

  /**
   * Disable logging (propagates to children)
   */
  disable(): void {
    this.config.enabled = false;
    this.children.forEach((child) => child.disable());
  }

  /**
   * Set log level (propagates to children)
   */
  setLevel(level: LogLevel): void {
    this.config.level = level;
    this.children.forEach((child) => child.setLevel(level));
  }

  /**
   * Configure logger (propagates to children)
   */
  configure(config: Partial<LoggerConfig>): void {
    Object.assign(this.config, config);
    this.children.forEach((child) => {
      child.configure({
        ...config,
        namespace: child.config.namespace, // Preserve child namespace
      });
    });
  }

  /**
   * Get log history
   */
  getHistory(): LogEntry[] {
    return [...this.history];
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.history, null, 2);
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private log(level: LogLevel, message: string, data?: unknown): void {
    if (!this.config.enabled) return;
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      namespace: this.config.namespace,
      message,
      data,
    };

    // Add to history
    this.history.push(entry);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }

    // Output to console
    this.outputToConsole(entry);
  }

  private outputToConsole(entry: LogEntry): void {
    const { timestamp, level, namespace, message, data } = entry;
    const timeStr = timestamp.toISOString();
    const prefix = `${this.config.prefix} [${timeStr}] [${namespace}]`;

    const consoleMethod = level === 'debug' ? 'log' : level;
    const color = this.config.useColors ? LOG_COLORS[level] : undefined;

    if (color && typeof window !== 'undefined') {
      // Browser with colors
      console[consoleMethod](
        `%c${prefix} ${message}`,
        `color: ${color}; font-weight: bold`,
        data !== undefined ? data : ''
      );
    } else {
      // Node.js or no colors
      console[consoleMethod](prefix, message, data !== undefined ? data : '');
    }
  }
}

/**
 * Create a logger instance
 */
export function createLogger(config?: LoggerConfig): Logger {
  return new Logger(config);
}

/**
 * Global SDK logger singleton
 * Configure once in MusicServiceClient, use everywhere
 */
export const SDKLogger = new Logger({
  enabled: false,
  level: 'info',
  namespace: 'SDK',
  prefix: '[MusicService]',
  useColors: true,
});

/**
 * Deprecated: Use SDKLogger instead
 * @deprecated Use SDKLogger for consistency
 */
export const logger = SDKLogger;
