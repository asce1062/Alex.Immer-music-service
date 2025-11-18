/**
 * Cache strategies implementation
 *
 * Implements various caching strategies:
 * - cache-first: Check cache first, fallback to network
 * - network-first: Try network first, fallback to cache
 * - stale-while-revalidate: Return cache immediately, update in background
 * - network-only: Always fetch from network
 * - cache-only: Only use cache, fail if not cached
 */

import type { CacheStrategy, CacheEntry } from '../types';
import { CacheError } from '../types/errors';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('CacheStrategy');

export interface CacheStorage {
  get<T>(key: string): Promise<CacheEntry<T> | null>;
  set<T>(entry: CacheEntry<T>): Promise<void>;
  has(key: string): Promise<boolean>;
}

export type FetchFunction<T> = () => Promise<T>;

export interface StrategyOptions<T = unknown> {
  /** Cache key */
  key: string;
  /** Function to fetch data from network */
  fetcher: FetchFunction<T>;
  /** Cache storage */
  storage: CacheStorage;
  /** TTL in milliseconds */
  ttl: number;
  /** Enable debug logging */
  debug?: boolean;
}

export interface StrategyResult<T> {
  /** Retrieved data */
  data: T;
  /** Whether data came from cache */
  fromCache: boolean;
  /** Cache entry metadata */
  cacheEntry?: CacheEntry<T>;
}

/**
 * Cache-first strategy
 * Check cache first, fallback to network if not found
 */
export async function cacheFirst<T>(options: StrategyOptions<T>): Promise<StrategyResult<T>> {
  const { key, fetcher, storage, ttl } = options;

  // Try cache first
  const cached = await storage.get<T>(key);

  if (cached) {
    logger.debug(`[cache-first] Cache hit: ${key}`);
    return {
      data: cached.data,
      fromCache: true,
      cacheEntry: cached,
    };
  }

  logger.debug(`[cache-first] Cache miss, fetching: ${key}`);

  // Fallback to network
  const data: T = await fetcher();

  // Store in cache
  const entry: CacheEntry<T> = {
    key,
    data,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttl,
    ttl,
    sizeBytes: estimateSize(data),
  };

  await storage.set(entry);

  return {
    data,
    fromCache: false,
    cacheEntry: entry,
  };
}

/**
 * Network-first strategy
 * Try network first, fallback to cache if network fails
 */
export async function networkFirst<T>(options: StrategyOptions<T>): Promise<StrategyResult<T>> {
  const { key, fetcher, storage, ttl } = options;

  try {
    logger.debug(`[network-first] Fetching from network: ${key}`);

    // Try network first
    const data: T = await fetcher();

    // Store in cache
    const entry: CacheEntry<T> = {
      key,
      data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttl,
      ttl,
      sizeBytes: estimateSize(data),
    };

    await storage.set(entry);

    return {
      data,
      fromCache: false,
      cacheEntry: entry,
    };
  } catch (error) {
    logger.debug(`[network-first] Network failed, checking cache: ${key}`);

    // Fallback to cache
    const cached = await storage.get<T>(key);

    if (cached) {
      logger.debug(`[network-first] Cache fallback success: ${key}`);
      return {
        data: cached.data,
        fromCache: true,
        cacheEntry: cached,
      };
    }

    // No cache available, re-throw network error
    throw error;
  }
}

/**
 * Stale-while-revalidate strategy
 * Return cache immediately, update in background
 */
export async function staleWhileRevalidate<T>(
  options: StrategyOptions<T>
): Promise<StrategyResult<T>> {
  const { key, fetcher, storage, ttl } = options;

  // Check cache first
  const cached = await storage.get<T>(key);

  // If we have cached data, return it immediately
  if (cached) {
    logger.debug(`[stale-while-revalidate] Returning cached data: ${key}`);

    // Revalidate in background (don't await)
    revalidateInBackground(key, fetcher, storage, ttl).catch(() => {
      // Silently fail background revalidation
    });

    return {
      data: cached.data,
      fromCache: true,
      cacheEntry: cached,
    };
  }

  logger.debug(`[stale-while-revalidate] No cache, fetching: ${key}`);

  // No cache, fetch from network
  const data: T = await fetcher();

  // Store in cache
  const entry: CacheEntry<T> = {
    key,
    data,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttl,
    ttl,
    sizeBytes: estimateSize(data),
  };

  await storage.set(entry);

  return {
    data,
    fromCache: false,
    cacheEntry: entry,
  };
}

/**
 * Network-only strategy
 * Always fetch from network, never use cache
 */
export async function networkOnly<T>(options: StrategyOptions<T>): Promise<StrategyResult<T>> {
  const { key, fetcher } = options;

  logger.debug(`[network-only] Fetching from network: ${key}`);

  const data: T = await fetcher();

  return {
    data,
    fromCache: false,
  };
}

/**
 * Cache-only strategy
 * Only use cache, fail if not cached
 */
export async function cacheOnly<T>(options: StrategyOptions<T>): Promise<StrategyResult<T>> {
  const { key, storage } = options;

  logger.debug(`[cache-only] Checking cache: ${key}`);

  const cached = await storage.get<T>(key);

  if (!cached) {
    throw new CacheError(`Cache miss and network is disabled: ${key}`);
  }

  return {
    data: cached.data,
    fromCache: true,
    cacheEntry: cached,
  };
}

/**
 * Execute a strategy by name
 */
export async function executeStrategy<T>(
  strategy: CacheStrategy,
  options: StrategyOptions<T>
): Promise<StrategyResult<T>> {
  switch (strategy) {
    case 'cache-first':
      return cacheFirst<T>(options);
    case 'network-first':
      return networkFirst<T>(options);
    case 'stale-while-revalidate':
      return staleWhileRevalidate<T>(options);
    case 'network-only':
      return networkOnly<T>(options);
    case 'cache-only':
      return cacheOnly<T>(options);
    default:
      throw new Error(`Unknown cache strategy: ${String(strategy)}`);
  }
}

/**
 * Helper: Revalidate cache in background
 */
async function revalidateInBackground<T>(
  key: string,
  fetcher: FetchFunction<T>,
  storage: CacheStorage,
  ttl: number
): Promise<void> {
  try {
    logger.debug(`Background revalidation started: ${key}`);

    const data = await fetcher();

    const entry: CacheEntry<T> = {
      key,
      data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + ttl,
      ttl,
      sizeBytes: estimateSize(data),
    };

    await storage.set(entry);

    logger.debug(`Background revalidation complete: ${key}`);
  } catch (error) {
    logger.error(`Background revalidation failed: ${key}`, error);
    // Silently fail - we already returned cached data
  }
}

/**
 * Helper: Estimate data size in bytes
 */
function estimateSize(data: unknown): number {
  try {
    const json = JSON.stringify(data);
    // Rough estimate: 1 char = 2 bytes (UTF-16)
    return json.length * 2;
  } catch {
    return 0;
  }
}
