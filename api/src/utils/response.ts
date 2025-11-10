/**
 * API Response Utility Functions
 */

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { SessionResponse, ErrorResponse } from '../types/index.js';
import { getCorsHeaders } from './cors.js';

/**
 * Create success response with signed cookies
 */
export function successResponse(
  data: SessionResponse,
  cookies: string[],
  origin?: string
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 200,
    headers: {
      ...getCorsHeaders(origin),
      'Content-Type': 'application/json',
    },
    cookies,
    body: JSON.stringify(data),
  };
}

/**
 * Create error response
 */
export function errorResponse(
  statusCode: number,
  error: string,
  message: string,
  origin?: string
): APIGatewayProxyStructuredResultV2 {
  const response: ErrorResponse = {
    error,
    message,
  };

  return {
    statusCode,
    headers: {
      ...getCorsHeaders(origin),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(response),
  };
}

/**
 * Create 400 Bad Request response
 */
export function badRequestResponse(
  message: string,
  origin?: string
): APIGatewayProxyStructuredResultV2 {
  return errorResponse(400, 'bad_request', message, origin);
}

/**
 * Create 401 Unauthorized response
 */
export function unauthorizedResponse(
  message: string,
  origin?: string
): APIGatewayProxyStructuredResultV2 {
  return errorResponse(401, 'unauthorized', message, origin);
}

/**
 * Create 403 Forbidden response
 */
export function forbiddenResponse(
  message: string,
  origin?: string
): APIGatewayProxyStructuredResultV2 {
  return errorResponse(403, 'forbidden', message, origin);
}

/**
 * Create 500 Internal Server Error response
 */
export function internalErrorResponse(
  message: string,
  origin?: string
): APIGatewayProxyStructuredResultV2 {
  return errorResponse(500, 'internal_error', message, origin);
}

/**
 * Handle CORS preflight requests
 */
export function corsPreflightResponse(origin?: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 204,
    headers: getCorsHeaders(origin),
    body: '',
  };
}
