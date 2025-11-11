/**
 * AWS Systems Manager Parameter Store Service
 * Handles fetching parameters from AWS SSM Parameter Store
 *
 * Migration: Client credentials moved from Secrets Manager to Parameter Store
 * for cost optimization. Static credentials don't require rotation features.
 */

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import type { ClientCredentials } from '../types/index.js';
import { logger } from '../utils/logger.js';

const client = new SSMClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

// In-memory cache for parameters (Lambda containers are reused)
const parameterCache = new Map<string, { value: unknown; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes (same as Secrets Manager)

/**
 * Get parameter value from AWS SSM Parameter Store with caching
 */
async function getParameter(parameterName: string): Promise<string> {
  // Check cache
  const cached = parameterCache.get(parameterName);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value as string;
  }

  // Fetch from Parameter Store
  try {
    const command = new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true, // Decrypt SecureString parameters
    });
    const response = await client.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${parameterName} has no value`);
    }

    // Cache the parameter
    parameterCache.set(parameterName, {
      value: response.Parameter.Value,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return response.Parameter.Value;
  } catch (error) {
    logger.error(
      {
        parameterName,
        error: error instanceof Error ? error.message : String(error),
      },
      `Failed to fetch parameter: ${parameterName}`
    );
    throw new Error(`Failed to fetch parameter: ${parameterName}`);
  }
}

/**
 * Get client credentials from Parameter Store
 *
 * Parameter naming convention: /music-service/clients/{client-id}
 *
 * @param clientId - Client identifier (e.g., "alexmbugua-personal")
 * @returns Client credentials or null if not found/invalid
 */
export async function getClientCredentials(clientId: string): Promise<ClientCredentials | null> {
  const parameterName = `${process.env.CLIENTS_SECRET_PREFIX}${clientId}`;

  try {
    const parameterValue = await getParameter(parameterName);
    const parsed = JSON.parse(parameterValue) as ClientCredentials;

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

/**
 * Clear parameter cache (useful for testing)
 */
export function clearCache(): void {
  parameterCache.clear();
}
