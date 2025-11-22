/**
 * CloudFront Signed Cookie Service
 * Generates CloudFront signed cookies for CDN access
 */

import { createSign } from 'crypto';
import type { SignedCookiePolicy, SignedCookies } from '../types/index.js';
import { getCloudFrontSigningKey } from './secrets-manager.js';

/**
 * Generate CloudFront signed cookies
 */
export async function generateSignedCookies(
  resourceUrl: string,
  expiresInSeconds: number
): Promise<SignedCookies> {
  const signingKey = await getCloudFrontSigningKey();

  // Calculate expiration time
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  // Create policy
  const policy: SignedCookiePolicy = {
    Statement: [
      {
        Resource: resourceUrl,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': expiresAt,
          },
        },
      },
    ],
  };

  // Convert policy to string
  const policyString = JSON.stringify(policy);

  // Sign the policy string (BEFORE encoding!)
  const signature = signPolicy(policyString, signingKey.private_key);

  // Now encode both policy and signature
  const encodedPolicy = base64UrlEncode(Buffer.from(policyString));
  const encodedSignature = base64UrlEncode(signature);

  return {
    'CloudFront-Policy': encodedPolicy,
    'CloudFront-Signature': encodedSignature,
    'CloudFront-Key-Pair-Id': signingKey.key_pair_id,
  };
}

/**
 * Sign the policy using RSA-SHA1 (CloudFront requirement for both legacy and Key Groups)
 */
function signPolicy(policy: string, privateKey: string): Buffer {
  const sign = createSign('RSA-SHA1');
  sign.update(policy);
  return sign.sign(privateKey);
}

/**
 * Base64 URL-safe encoding (CloudFront requires specific encoding)
 * AWS CloudFront encoding: + → -, / → ~, = → _
 */
function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '~').replace(/=/g, '_');
}

/**
 * Format cookies for Set-Cookie header
 *
 * @param cookies - CloudFront signed cookies to format
 * @param domain - Cookie domain attribute (null for origin-bound cookies)
 * @param maxAge - Cookie max age in seconds
 * @returns Array of Set-Cookie header values
 */
export function formatCookiesForHeaders(
  cookies: SignedCookies,
  domain: string | null,
  maxAge: number
): string[] {
  // Build cookie attributes array, filtering out null values
  const cookieAttributes = [
    domain ? `Domain=${domain}` : null, // Only set Domain if provided
    'Path=/',
    'Secure',
    'HttpOnly',
    'SameSite=None', // Required for cross-origin requests with credentials
    'Partitioned', // Required for cross-site cookies (Chrome 115+, Privacy Sandbox)
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean) // Remove null values
    .join('; ');

  return [
    `CloudFront-Policy=${cookies['CloudFront-Policy']}; ${cookieAttributes}`,
    `CloudFront-Signature=${cookies['CloudFront-Signature']}; ${cookieAttributes}`,
    `CloudFront-Key-Pair-Id=${cookies['CloudFront-Key-Pair-Id']}; ${cookieAttributes}`,
  ];
}
