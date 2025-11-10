/**
 * AWS Secrets Manager Service
 * Handles fetching secrets from AWS Secrets Manager
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import type { ClientCredentials, CloudFrontSigningKey } from '../types/index.js';
import { logger } from '../utils/logger.js';

const client = new SecretsManagerClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// In-memory cache for secrets (Lambda containers are reused)
const secretCache = new Map<string, { value: unknown; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get secret value from AWS Secrets Manager with caching
 */
async function getSecret(secretName: string): Promise<string> {
  // Check cache
  const cached = secretCache.get(secretName);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value as string;
  }

  // Fetch from Secrets Manager
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);

    if (!response.SecretString) {
      throw new Error(`Secret ${secretName} has no string value`);
    }

    // Cache the secret
    secretCache.set(secretName, {
      value: response.SecretString,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return response.SecretString;
  } catch (error) {
    logger.error(
      {
        secretName,
        error: error instanceof Error ? error.message : String(error),
      },
      `Failed to fetch secret: ${secretName}`
    );
    throw new Error(`Failed to fetch secret: ${secretName}`);
  }
}

/**
 * Get CloudFront signing key from Secrets Manager
 */
export async function getCloudFrontSigningKey(): Promise<CloudFrontSigningKey> {
  const secretName = process.env.SIGNING_KEY_SECRET_NAME!;
  const secretString = await getSecret(secretName);

  try {
    const parsed = JSON.parse(secretString) as CloudFrontSigningKey;

    if (!parsed.private_key || !parsed.key_pair_id) {
      throw new Error('Invalid signing key format: missing private_key or key_pair_id');
    }

    return parsed;
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to parse CloudFront signing key'
    );
    throw new Error('Invalid CloudFront signing key format');
  }
}

/**
 * Get client credentials from Secrets Manager
 */
export async function getClientCredentials(clientId: string): Promise<ClientCredentials | null> {
  const secretName = `${process.env.CLIENTS_SECRET_PREFIX}${clientId}`;

  try {
    const secretString = await getSecret(secretName);
    const parsed = JSON.parse(secretString) as ClientCredentials;

    // Validate required fields
    if (
      !parsed.client_id ||
      !parsed.client_secret ||
      !Array.isArray(parsed.allowed_origins) ||
      typeof parsed.cookie_duration_hours !== 'number'
    ) {
      logger.error({ clientId }, `Invalid client credentials format for ${clientId}`);
      return null;
    }

    return parsed;
  } catch (error) {
    logger.error(
      {
        clientId,
        error: error instanceof Error ? error.message : String(error),
      },
      `Failed to fetch client credentials for ${clientId}`
    );
    return null;
  }
}
