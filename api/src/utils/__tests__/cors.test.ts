import { describe, it, expect } from 'vitest';
import { getCorsHeaders } from '../cors';

describe('CORS Utilities', () => {
  describe('getCorsHeaders', () => {
    it('should return CORS headers for allowed origin', () => {
      const origin = 'https://alexmbugua.me';
      const headers = getCorsHeaders(origin);

      expect(headers['Access-Control-Allow-Origin']).toBe(origin);
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
      expect(headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS, GET');
      expect(headers['Access-Control-Allow-Headers']).toBe(
        'content-type, x-client-id, x-client-secret'
      );
      expect(headers['Access-Control-Max-Age']).toBe('300');
    });

    it('should use first allowed origin for disallowed origin', () => {
      const origin = 'https://evil.com';
      const headers = getCorsHeaders(origin);

      // Should fallback to first allowed origin
      expect(headers['Access-Control-Allow-Origin']).toBe('https://alexmbugua.me');
    });

    it('should handle undefined origin', () => {
      const headers = getCorsHeaders(undefined);

      // Should use first allowed origin as fallback
      expect(headers['Access-Control-Allow-Origin']).toBe('https://alexmbugua.me');
    });

    it('should allow localhost origins for development', () => {
      const localhostOrigins = [
        'http://localhost:4321',
        'http://localhost:3000',
        'http://127.0.0.1:4321',
      ];

      localhostOrigins.forEach((origin) => {
        const headers = getCorsHeaders(origin);
        expect(headers['Access-Control-Allow-Origin']).toBe(origin);
      });
    });
  });
});
