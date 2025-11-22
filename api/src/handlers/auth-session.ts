/**
 * Lambda Handler: POST /v1/session
 * Authenticates clients and issues CloudFront signed cookies
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Handler } from 'aws-lambda';
import type { RequestHeaders, SessionResponse } from '../types/index.js';
import { validateClient } from '../services/client-validator.js';
import { generateSignedCookies, formatCookiesForHeaders } from '../services/cookie-signer.js';
import {
  successResponse,
  unauthorizedResponse,
  internalErrorResponse,
  corsPreflightResponse,
  badRequestResponse,
} from '../utils/response.js';
import {
  logRequest,
  logAuthSuccess,
  logAuthFailure,
  logSessionCreated,
  logError,
} from '../utils/logger.js';

/**
 * Main Lambda handler
 */
export const handler: Handler<APIGatewayProxyEventV2, APIGatewayProxyResultV2> = async (event) => {
  logRequest(
    event.requestContext.http.method,
    event.requestContext.http.path,
    event.requestContext.http.sourceIp,
    event.headers['x-client-id']
  );

  // Handle CORS preflight requests
  if (event.requestContext.http.method === 'OPTIONS') {
    return corsPreflightResponse(event.headers.origin);
  }

  // Validate HTTP method
  if (event.requestContext.http.method !== 'POST') {
    return badRequestResponse('Method not allowed', event.headers.origin);
  }

  try {
    // Extract headers
    const headers: RequestHeaders = {
      'x-client-id': event.headers['x-client-id'],
      'x-client-secret': event.headers['x-client-secret'],
      origin: event.headers.origin,
      'user-agent': event.headers['user-agent'],
    };

    // Validate client
    const validationResult = await validateClient(headers);

    if (!validationResult.valid || !validationResult.client) {
      logAuthFailure(
        headers['x-client-id'],
        validationResult.error ?? 'Unknown error',
        headers.origin
      );
      return unauthorizedResponse(
        validationResult.error ?? 'Invalid client credentials',
        headers.origin
      );
    }

    const client = validationResult.client;
    logAuthSuccess(client.client_id, headers.origin);

    // Generate signed cookies
    const cdnDomain = process.env.CDN_DOMAIN ?? 'cdn.alexmbugua.me';
    const resourceUrl = `https://${cdnDomain}/*`;
    const expiresInSeconds = client.cookie_duration_hours * 3600;

    const signedCookies = await generateSignedCookies(resourceUrl, expiresInSeconds);

    // Set cookie domain to share cookies across all subdomains
    // This is necessary because:
    // 1. Cookies are set by the API (music-api.alexmbugua.me)
    // 2. Cookies must work on the CDN (cdn.alexmbugua.me)
    // 3. Browsers can receive .alexmbugua.me cookies from localhost requests
    //    and will send them to any alexmbugua.me subdomain (SameSite=None enables this)
    const cookieDomain = '.alexmbugua.me';

    // Format cookies for Set-Cookie header
    const cookieHeaders = formatCookiesForHeaders(signedCookies, cookieDomain, expiresInSeconds);

    // Create response
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
    const responseData: SessionResponse = {
      status: 'success',
      session: {
        expires_at: expiresAt,
        duration_seconds: expiresInSeconds,
      },
      cdn: {
        base_url: `https://${cdnDomain}`,
        albums_path: '/albums',
        covers_path: '/covers',
        metadata_path: '/metadata',
        trackers_path: '/tracker',
      },
    };

    logSessionCreated(client.client_id, expiresAt, client.cookie_duration_hours, headers.origin);

    return successResponse(responseData, cookieHeaders, headers.origin);
  } catch (error) {
    logError(error, {
      path: event.requestContext.http.path,
      method: event.requestContext.http.method,
      clientId: event.headers['x-client-id'],
    });
    return internalErrorResponse('Internal server error', event.headers.origin);
  }
};
