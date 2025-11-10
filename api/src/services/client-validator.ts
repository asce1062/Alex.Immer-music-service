/**
 * Client Validation Service
 * Validates client credentials and origin
 */

import type { ClientCredentials, RequestHeaders } from '../types/index.js';
import { getClientCredentials } from './secrets-manager.js';
import { logger } from '../utils/logger.js';

export interface ValidationResult {
  valid: boolean;
  client?: ClientCredentials;
  error?: string;
}

/**
 * Validate client credentials and origin
 */
export async function validateClient(headers: RequestHeaders): Promise<ValidationResult> {
  const clientId = headers['x-client-id'];
  const clientSecret = headers['x-client-secret'];
  const origin = headers.origin;

  // Check required headers
  if (!clientId) {
    return {
      valid: false,
      error: 'Missing x-client-id header',
    };
  }

  if (!clientSecret) {
    return {
      valid: false,
      error: 'Missing x-client-secret header',
    };
  }

  if (!origin) {
    return {
      valid: false,
      error: 'Missing origin header',
    };
  }

  // Fetch client credentials from Secrets Manager
  const client = await getClientCredentials(clientId);

  if (!client) {
    logger.warn({ clientId }, `Client not found: ${clientId}`);
    return {
      valid: false,
      error: 'Invalid client credentials',
    };
  }

  // Validate client secret (constant-time comparison to prevent timing attacks)
  if (!constantTimeCompare(clientSecret, client.client_secret)) {
    logger.warn({ clientId }, `Invalid secret for client: ${clientId}`);
    return {
      valid: false,
      error: 'Invalid client credentials',
    };
  }

  // Validate origin
  const isOriginAllowed = client.allowed_origins.some((allowedOrigin) => {
    // Exact match or subdomain match
    return origin === allowedOrigin || origin.startsWith(`${allowedOrigin}/`);
  });

  if (!isOriginAllowed) {
    logger.warn(
      { clientId, origin, allowedOrigins: client.allowed_origins },
      `Origin not allowed for client ${clientId}: ${origin}`
    );
    return {
      valid: false,
      error: 'Origin not allowed for this client',
    };
  }

  return {
    valid: true,
    client,
  };
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
