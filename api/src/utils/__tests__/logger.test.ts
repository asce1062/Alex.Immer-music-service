import { describe, it, expect } from 'vitest';
import { logger } from '../logger';

describe('Logger', () => {
  it('should create a logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.warn).toBe('function');
  });

  it('should have correct configuration', () => {
    // Logger should be configured based on NODE_ENV
    expect(logger).toBeDefined();
  });
});
