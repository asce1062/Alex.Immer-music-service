/**
 * Tests for validation utilities
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validate,
  validateSafe,
  validateRequired,
  validateUrl,
  validateRange,
  validateNotEmpty,
  isValidationError,
  isZodError,
} from '../validation';
import { ValidationError } from '../../types';

describe('validate', () => {
  const testSchema = z.object({
    name: z.string(),
    age: z.number().positive(),
  });

  it('should validate valid data', () => {
    const data = { name: 'John', age: 30 };
    const result = validate(testSchema, data);
    expect(result).toEqual(data);
  });

  it('should throw ValidationError for invalid data', () => {
    const data = { name: 'John', age: -5 };
    expect(() => validate(testSchema, data)).toThrow(ValidationError);
  });

  it('should include context in error message', () => {
    const data = { name: 'John', age: -5 };
    try {
      validate(testSchema, data, 'User');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain('User');
    }
  });

  it('should include validation errors in context', () => {
    const data = { name: 'John', age: -5 };
    try {
      validate(testSchema, data);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.context?.validationErrors).toBeDefined();
    }
  });
});

describe('validateSafe', () => {
  const testSchema = z.object({
    name: z.string(),
    age: z.number().positive(),
  });

  it('should return validated data for valid input', () => {
    const data = { name: 'John', age: 30 };
    const result = validateSafe(testSchema, data);
    expect(result).toEqual(data);
  });

  it('should return null for invalid input', () => {
    const data = { name: 'John', age: -5 };
    const result = validateSafe(testSchema, data);
    expect(result).toBeNull();
  });

  it('should not throw errors', () => {
    const data = { invalid: 'data' };
    expect(() => validateSafe(testSchema, data)).not.toThrow();
  });
});

describe('validateRequired', () => {
  it('should return value if not null or undefined', () => {
    expect(validateRequired('test', 'field')).toBe('test');
    expect(validateRequired(0, 'field')).toBe(0);
    expect(validateRequired(false, 'field')).toBe(false);
  });

  it('should throw ValidationError for null', () => {
    expect(() => validateRequired(null, 'field')).toThrow(ValidationError);
  });

  it('should throw ValidationError for undefined', () => {
    expect(() => validateRequired(undefined, 'field')).toThrow(ValidationError);
  });

  it('should include field name in error message', () => {
    try {
      validateRequired(null, 'username');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain('username');
    }
  });
});

describe('validateUrl', () => {
  it('should validate valid URLs', () => {
    expect(validateUrl('https://example.com')).toBe('https://example.com');
    expect(validateUrl('http://localhost:3000')).toBe('http://localhost:3000');
    expect(validateUrl('https://example.com/path?query=1')).toBe(
      'https://example.com/path?query=1'
    );
  });

  it('should throw ValidationError for invalid URLs', () => {
    expect(() => validateUrl('not-a-url')).toThrow(ValidationError);
    expect(() => validateUrl('just some text')).toThrow(ValidationError);
    expect(() => validateUrl('')).toThrow(ValidationError);
  });

  it('should include URL in error message', () => {
    try {
      validateUrl('invalid-url', 'API endpoint');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.message).toContain('API endpoint');
      expect(validationError.message).toContain('invalid-url');
    }
  });
});

describe('validateRange', () => {
  it('should validate values within range', () => {
    expect(validateRange(5, 0, 10)).toBe(5);
    expect(validateRange(0, 0, 10)).toBe(0);
    expect(validateRange(10, 0, 10)).toBe(10);
  });

  it('should throw ValidationError for values below min', () => {
    expect(() => validateRange(-1, 0, 10)).toThrow(ValidationError);
  });

  it('should throw ValidationError for values above max', () => {
    expect(() => validateRange(11, 0, 10)).toThrow(ValidationError);
  });

  it('should include range details in error message', () => {
    try {
      validateRange(15, 0, 10, 'volume');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.message).toContain('volume');
      expect(validationError.message).toContain('0');
      expect(validationError.message).toContain('10');
      expect(validationError.message).toContain('15');
    }
  });
});

describe('validateNotEmpty', () => {
  it('should validate non-empty arrays', () => {
    const arr = [1, 2, 3];
    expect(validateNotEmpty(arr)).toBe(arr);
  });

  it('should throw ValidationError for empty arrays', () => {
    expect(() => validateNotEmpty([])).toThrow(ValidationError);
  });

  it('should include field name in error message', () => {
    try {
      validateNotEmpty([], 'tracks');
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain('tracks');
    }
  });
});

describe('isValidationError', () => {
  it('should return true for ValidationError instances', () => {
    const error = new ValidationError('test error');
    expect(isValidationError(error)).toBe(true);
  });

  it('should return false for other errors', () => {
    expect(isValidationError(new Error('test'))).toBe(false);
    expect(isValidationError(new TypeError('test'))).toBe(false);
    expect(isValidationError('string')).toBe(false);
    expect(isValidationError(null)).toBe(false);
  });
});

describe('isZodError', () => {
  it('should return true for ZodError instances', () => {
    const schema = z.string();
    try {
      schema.parse(123);
    } catch (error) {
      expect(isZodError(error)).toBe(true);
    }
  });

  it('should return false for other errors', () => {
    expect(isZodError(new Error('test'))).toBe(false);
    expect(isZodError(new ValidationError('test'))).toBe(false);
    expect(isZodError('string')).toBe(false);
    expect(isZodError(null)).toBe(false);
  });
});
