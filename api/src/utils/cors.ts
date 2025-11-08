/**
 * CORS Utility Functions
 */

/**
 * Get CORS headers for response
 */
export function getCorsHeaders(origin?: string): Record<string, string> {
  const allowedOrigins = [
    'https://alexmbugua.me',
    'https://www.alexmbugua.me',
    'https://asce1062.github.io',
    'https://music.alexmbugua.me',
    'http://localhost:4321',
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:4321',
    'http://127.0.0.1:3000',
  ];

  // Check if origin is allowed and use it, otherwise fallback to first allowed origin
  const isAllowed = origin && allowedOrigins.includes(origin);
  const allowedOrigin = (isAllowed ? origin : allowedOrigins[0])!;

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
    'Access-Control-Allow-Headers': 'content-type, x-client-id, x-client-secret',
    'Access-Control-Max-Age': '300',
  };
}
