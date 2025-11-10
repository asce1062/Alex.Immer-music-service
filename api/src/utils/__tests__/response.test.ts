import { describe, it, expect } from 'vitest';
import {
  successResponse,
  errorResponse,
  badRequestResponse,
  unauthorizedResponse,
  forbiddenResponse,
  internalErrorResponse,
  corsPreflightResponse,
} from '../response';

describe('Response Utilities', () => {
  const testOrigin = 'https://example.com';

  describe('successResponse', () => {
    it('should create a successful response with cookies', () => {
      const data = {
        success: true,
        expires_at: '2024-01-01T00:00:00Z',
        client_id: 'test-client',
      };
      const cookies = ['CloudFront-Policy=abc123', 'CloudFront-Signature=def456'];

      const response = successResponse(data, cookies, testOrigin);

      expect(response.statusCode).toBe(200);
      expect(response.cookies).toEqual(cookies);
      expect(response.headers?.['Content-Type']).toBe('application/json');
      expect(response.body).toBeDefined();
      expect(JSON.parse(response.body!) as typeof data).toEqual(data);
    });
  });

  describe('errorResponse', () => {
    it('should create an error response with correct structure', () => {
      const response = errorResponse(400, 'test_error', 'Test error message', testOrigin);

      expect(response.statusCode).toBe(400);
      expect(response.headers?.['Content-Type']).toBe('application/json');
      expect(response.body).toBeDefined();
      const body = JSON.parse(response.body!) as { error: string; message: string };
      expect(body.error).toBe('test_error');
      expect(body.message).toBe('Test error message');
    });
  });

  describe('badRequestResponse', () => {
    it('should create a 400 bad request response', () => {
      const response = badRequestResponse('Invalid input', testOrigin);

      expect(response.statusCode).toBe(400);
      expect(response.body).toBeDefined();
      const body = JSON.parse(response.body!) as { error: string; message: string };
      expect(body.error).toBe('bad_request');
      expect(body.message).toBe('Invalid input');
    });
  });

  describe('unauthorizedResponse', () => {
    it('should create a 401 unauthorized response', () => {
      const response = unauthorizedResponse('Invalid credentials', testOrigin);

      expect(response.statusCode).toBe(401);
      expect(response.body).toBeDefined();
      const body = JSON.parse(response.body!) as { error: string; message: string };
      expect(body.error).toBe('unauthorized');
      expect(body.message).toBe('Invalid credentials');
    });
  });

  describe('forbiddenResponse', () => {
    it('should create a 403 forbidden response', () => {
      const response = forbiddenResponse('Access denied', testOrigin);

      expect(response.statusCode).toBe(403);
      expect(response.body).toBeDefined();
      const body = JSON.parse(response.body!) as { error: string; message: string };
      expect(body.error).toBe('forbidden');
      expect(body.message).toBe('Access denied');
    });
  });

  describe('internalErrorResponse', () => {
    it('should create a 500 internal error response', () => {
      const response = internalErrorResponse('Server error occurred', testOrigin);

      expect(response.statusCode).toBe(500);
      expect(response.body).toBeDefined();
      const body = JSON.parse(response.body!) as { error: string; message: string };
      expect(body.error).toBe('internal_error');
      expect(body.message).toBe('Server error occurred');
    });
  });

  describe('corsPreflightResponse', () => {
    it('should create a 204 CORS preflight response', () => {
      const response = corsPreflightResponse(testOrigin);

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      expect(response.headers).toBeDefined();
    });
  });
});
