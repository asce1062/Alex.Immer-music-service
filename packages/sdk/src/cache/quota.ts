/**
 * Storage quota management utilities
 *
 * Provides utilities to check and manage storage quota:
 * - Check available storage
 * - Estimate usage
 * - Request quota increase (if needed)
 * - Monitor quota limits
 */

import type { StorageQuota, StorageEstimateWithDetails } from '../types';
import { CacheError } from '../types/errors';

/**
 * Get current storage quota information
 */
export async function getStorageQuota(): Promise<StorageQuota> {
  // Check if Storage API is supported
  if (!navigator.storage?.estimate) {
    throw new CacheError('Storage API is not supported in this environment');
  }

  try {
    const estimate = await navigator.storage.estimate();

    const quota = estimate.quota ?? 0;
    const usage = estimate.usage ?? 0;
    const available = quota - usage;
    const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;
    const isNearLimit = usagePercent > 80;

    return {
      quota,
      usage,
      available,
      usagePercent,
      isNearLimit,
    };
  } catch (error) {
    throw new CacheError('Failed to get storage quota', error);
  }
}

/**
 * Request persistent storage (prevents eviction)
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) {
    console.warn('[Quota] Persistent storage is not supported');
    return false;
  }

  try {
    const isPersisted = await navigator.storage.persist();
    return isPersisted;
  } catch (error) {
    console.error('[Quota] Failed to request persistent storage:', error);
    return false;
  }
}

/**
 * Check if storage is persisted
 */
export async function isStoragePersisted(): Promise<boolean> {
  if (!navigator.storage?.persisted) {
    return false;
  }

  try {
    return await navigator.storage.persisted();
  } catch (error) {
    console.error('[Quota] Failed to check if storage is persisted:', error);
    return false;
  }
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

/**
 * Check if there's enough storage space
 */
export async function hasEnoughSpace(requiredBytes: number): Promise<boolean> {
  try {
    const quota = await getStorageQuota();
    return quota.available >= requiredBytes;
  } catch {
    // If we can't determine quota, assume we have space
    return true;
  }
}

/**
 * Get detailed storage breakdown by usage (IndexedDB, Cache API, etc.)
 */
export async function getStorageBreakdown(): Promise<{
  total: number;
  indexedDB?: number;
  caches?: number;
  serviceWorker?: number;
}> {
  if (!navigator.storage?.estimate) {
    throw new CacheError('Storage API is not supported');
  }

  try {
    const estimate = await navigator.storage.estimate();
    const estimateWithDetails = estimate as StorageEstimateWithDetails;

    const result: {
      total: number;
      indexedDB?: number;
      caches?: number;
      serviceWorker?: number;
    } = {
      total: estimate.usage ?? 0,
    };

    if (estimateWithDetails.usageDetails) {
      result.indexedDB = estimateWithDetails.usageDetails.indexedDB ?? 0;
      result.caches = estimateWithDetails.usageDetails.caches ?? 0;
      result.serviceWorker = estimateWithDetails.usageDetails.serviceWorkerRegistrations ?? 0;
    }

    return result;
  } catch (error) {
    throw new CacheError('Failed to get storage breakdown', error);
  }
}

/**
 * Monitor storage quota and trigger warning if approaching limit
 */
export async function monitorQuota(
  warningThreshold = 80,
  onWarning?: (quota: StorageQuota) => void
): Promise<StorageQuota> {
  const quota = await getStorageQuota();

  if (quota.usagePercent >= warningThreshold && onWarning) {
    onWarning(quota);
  }

  return quota;
}

/**
 * Estimate cache entry size
 */
export function estimateEntrySize(data: unknown): number {
  try {
    // Serialize to JSON and estimate size
    const json = JSON.stringify(data);
    // UTF-16 uses 2 bytes per character
    return json.length * 2;
  } catch {
    return 0;
  }
}

/**
 * Calculate cache overhead (metadata, indexes, etc.)
 * IndexedDB typically has 1.2-1.5x overhead
 */
export function calculateCacheOverhead(dataSize: number, factor = 1.3): number {
  return Math.ceil(dataSize * factor);
}
