/**
 * Validation helper utilities
 *
 * Provides consistent validation and error handling for API responses
 */

import { z } from 'zod';
import { ValidationError } from '../types';

/**
 * Validates data against a Zod schema
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param context - Additional context for error messages
 * @returns Validated and typed data
 * @throws ValidationError if validation fails
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  context?: string
): z.infer<T> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return schema.parse(data) as z.infer<T>;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = context
        ? `Validation failed for ${context}: ${formatZodError(error)}`
        : `Validation failed: ${formatZodError(error)}`;

      throw new ValidationError(message, error.errors, {
        validationErrors: error.errors,
        receivedData: data,
      });
    }
    throw error;
  }
}

/**
 * Validates data against a Zod schema, returning null on failure instead of throwing
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validated data or null if validation fails
 */
export function validateSafe<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return schema.parse(data) as z.infer<T>;
  } catch {
    return null;
  }
}

/**
 * Formats Zod validation errors into a readable message
 *
 * @param error - Zod error to format
 * @returns Formatted error message
 */
function formatZodError(error: z.ZodError): string {
  return error.errors
    .map((err) => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    })
    .join('; ');
}

/**
 * Validates that a value is not null or undefined
 *
 * @param value - Value to check
 * @param name - Name of the value for error message
 * @throws ValidationError if value is null or undefined
 */
export function validateRequired<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new ValidationError(`${name} is required`, undefined, { fieldName: name });
  }
  return value;
}

/**
 * Validates that a string is a valid URL
 *
 * @param url - URL string to validate
 * @param name - Name of the URL for error message
 * @throws ValidationError if URL is invalid
 */
export function validateUrl(url: string, name = 'URL'): string {
  try {
    new URL(url);
    return url;
  } catch {
    throw new ValidationError(`${name} is not a valid URL: ${url}`, undefined, {
      url,
      fieldName: name,
    });
  }
}

/**
 * Validates that a number is within a range
 *
 * @param value - Number to validate
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @param name - Name of the value for error message
 * @throws ValidationError if value is out of range
 */
export function validateRange(value: number, min: number, max: number, name = 'Value'): number {
  if (value < min || value > max) {
    throw new ValidationError(
      `${name} must be between ${min} and ${max}, got ${value}`,
      undefined,
      {
        value,
        min,
        max,
        fieldName: name,
      }
    );
  }
  return value;
}

/**
 * Validates that an array is not empty
 *
 * @param array - Array to validate
 * @param name - Name of the array for error message
 * @throws ValidationError if array is empty
 */
export function validateNotEmpty<T>(array: T[], name = 'Array'): T[] {
  if (array.length === 0) {
    throw new ValidationError(`${name} cannot be empty`, undefined, { fieldName: name });
  }
  return array;
}

/**
 * Type guard to check if an error is a ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Type guard to check if an error is a Zod error
 */
export function isZodError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}
