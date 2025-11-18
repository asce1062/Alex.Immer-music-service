/**
 * CacheManager - Main cache management class
 *
 * Provides a unified interface for caching with:
 * - Multiple storage backends (memory, IndexedDB, localStorage)
 * - Cache strategies (cache-first, network-first, stale-while-revalidate)
 * - Automatic expiration and cleanup
 * - Storage quota management
 * - Statistics and monitoring
 */

import type {
  CacheEntry,
  CacheConfig,
  CacheStats,
  StorageType,
  CacheOptions,
  StorageQuota,
} from '../types';
import { CacheError } from '../types/errors';
import { IndexedDBStore } from './IndexedDBStore';
import { executeStrategy, type CacheStorage } from './strategies';
import { getStorageQuota, monitorQuota, formatBytes } from './quota';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('CacheManager');

/**
 * In-memory cache storage
 */
class MemoryStore implements CacheStorage {
  private cache = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<CacheEntry<T> | null> {
    await Promise.resolve();
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry as CacheEntry<T>;
  }

  async set<T>(entry: CacheEntry<T>): Promise<void> {
    await Promise.resolve();
    this.cache.set(entry.key, entry);
  }

  async has(key: string): Promise<boolean> {
    await Promise.resolve();
    const entry = await this.get(key);
    return entry !== null;
  }

  async delete(key: string): Promise<void> {
    await Promise.resolve();
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    await Promise.resolve();
    this.cache.clear();
  }

  async keys(): Promise<string[]> {
    await Promise.resolve();
    return Array.from(this.cache.keys());
  }

  async entries<T>(): Promise<CacheEntry<T>[]> {
    await Promise.resolve();
    const now = Date.now();
    return Array.from(this.cache.values())
      .filter((entry) => entry.expiresAt > now)
      .map((entry) => entry as CacheEntry<T>);
  }

  size(): number {
    return this.cache.size;
  }
}

export class CacheManager {
  private config: Required<CacheConfig>;
  private storage: CacheStorage;
  private stats: CacheStats;
  private indexedDBStore?: IndexedDBStore;

  constructor(config: CacheConfig) {
    this.config = {
      name: config.name,
      storageType: config.storageType,
      defaultTTL: config.defaultTTL ?? 3600000, // 1 hour
      maxSize: config.maxSize ?? 50 * 1024 * 1024, // 50MB
      debug: config.debug ?? false,
      version: config.version ?? 1,
    };

    this.stats = {
      totalEntries: 0,
      totalSize: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      expiredEntries: 0,
    };

    // Initialize storage based on type
    this.storage = this.createStorage(this.config.storageType);

    logger.info('Initialized with config', {
      name: this.config.name,
      storageType: this.config.storageType,
      defaultTTL: this.config.defaultTTL,
      maxSize: formatBytes(this.config.maxSize),
    });
  }

  /**
   * Initialize async resources (IndexedDB, etc.)
   */
  async init(): Promise<void> {
    if (this.config.storageType === 'indexeddb' && this.indexedDBStore) {
      await this.indexedDBStore.init();
    }
  }

  /**
   * Get a value with a specific strategy
   */
  async get<T>(key: string, fetcher?: () => Promise<T>, options?: CacheOptions): Promise<T | null> {
    const strategy = options?.strategy ?? 'cache-first';
    const ttl = options?.ttl ?? this.config.defaultTTL;

    // If force refresh, skip cache
    if (options?.forceRefresh && fetcher) {
      const data = await fetcher();
      await this.set(key, data, ttl);
      return data;
    }

    // If skip cache, only use fetcher
    if (options?.skipCache && fetcher) {
      return await fetcher();
    }

    // If no fetcher provided, just check cache
    if (!fetcher) {
      const entry = await this.storage.get<T>(key);
      if (entry) {
        this.stats.hits++;
        this.updateHitRate();
        return entry.data;
      }
      this.stats.misses++;
      this.updateHitRate();
      return null;
    }

    // Execute cache strategy
    try {
      const result = await executeStrategy<T>(strategy, {
        key,
        fetcher,
        storage: this.storage,
        ttl,
        debug: this.config.debug,
      });

      if (result.fromCache) {
        this.stats.hits++;
      } else {
        this.stats.misses++;
      }
      this.updateHitRate();

      return result.data;
    } catch (error) {
      this.stats.misses++;
      this.updateHitRate();
      throw error;
    }
  }

  /**
   * Set a value in the cache
   */
  async set<T>(key: string, data: T, ttl?: number): Promise<void> {
    const effectiveTTL = ttl ?? this.config.defaultTTL;

    const entry: CacheEntry<T> = {
      key,
      data,
      cachedAt: Date.now(),
      expiresAt: Date.now() + effectiveTTL,
      ttl: effectiveTTL,
      sizeBytes: this.estimateSize(data),
    };

    // Check size limits
    if (entry.sizeBytes && entry.sizeBytes > this.config.maxSize) {
      logger.warn(
        `Entry exceeds max size: ${formatBytes(entry.sizeBytes)} > ${formatBytes(this.config.maxSize)}`
      );
      throw new CacheError(
        `Entry size ${formatBytes(entry.sizeBytes)} exceeds maximum ${formatBytes(this.config.maxSize)}`
      );
    }

    await this.storage.set(entry);

    this.stats.totalEntries++;
    this.stats.totalSize += entry.sizeBytes ?? 0;

    logger.debug(
      `Stored: ${String(key)} (${formatBytes(entry.sizeBytes ?? 0)}, expires in ${Math.round(effectiveTTL / 1000)}s)`
    );
  }

  /**
   * Delete a value from the cache
   */
  async delete(key: string): Promise<void> {
    const entry = await this.storage.get(key);

    if (this.storage instanceof MemoryStore) {
      await this.storage.delete(key);
    } else if (this.indexedDBStore) {
      await this.indexedDBStore.delete(key);
    }

    if (entry) {
      this.stats.totalEntries = Math.max(0, this.stats.totalEntries - 1);
      this.stats.totalSize = Math.max(0, this.stats.totalSize - (entry.sizeBytes ?? 0));
    }

    logger.debug(`Deleted: ${String(key)}`);
  }

  /**
   * Check if a key exists in the cache
   */
  async has(key: string): Promise<boolean> {
    return await this.storage.has(key);
  }

  /**
   * Get all keys in the cache
   */
  async keys(): Promise<string[]> {
    if (this.storage instanceof MemoryStore) {
      return await this.storage.keys();
    } else if (this.indexedDBStore) {
      return await this.indexedDBStore.keys();
    }
    return [];
  }

  /**
   * Clear all entries from the cache
   */
  async clear(): Promise<void> {
    if (this.storage instanceof MemoryStore) {
      await this.storage.clear();
    } else if (this.indexedDBStore) {
      await this.indexedDBStore.clear();
    }

    this.stats = {
      totalEntries: 0,
      totalSize: 0,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: this.stats.hitRate,
      expiredEntries: 0,
    };

    logger.debug('Cache cleared');
  }

  /**
   * Delete expired entries
   */
  async deleteExpired(): Promise<number> {
    if (this.indexedDBStore) {
      const count = await this.indexedDBStore.deleteExpired();
      this.stats.expiredEntries += count;
      return count;
    }

    // For memory store, filter and delete expired
    const keys = await this.keys();
    let count = 0;

    for (const key of keys) {
      const entry = await this.storage.get(key);
      if (entry && Date.now() > entry.expiresAt) {
        await this.delete(key);
        count++;
      }
    }

    this.stats.expiredEntries += count;
    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get storage quota information (IndexedDB only)
   */
  async getQuota(): Promise<StorageQuota | null> {
    if (this.config.storageType !== 'indexeddb') {
      return null;
    }

    try {
      return await getStorageQuota();
    } catch {
      return null;
    }
  }

  /**
   * Monitor storage quota
   */
  async monitorQuota(
    warningThreshold?: number,
    onWarning?: (quota: StorageQuota) => void
  ): Promise<StorageQuota | null> {
    if (this.config.storageType !== 'indexeddb') {
      return null;
    }

    try {
      return await monitorQuota(warningThreshold, onWarning);
    } catch {
      return null;
    }
  }

  /**
   * Close cache (cleanup resources)
   */
  close(): void {
    if (this.indexedDBStore) {
      this.indexedDBStore.close();
    }

    logger.debug('Closed');
  }

  /**
   * Create storage based on type
   */
  private createStorage(type: StorageType): CacheStorage {
    switch (type) {
      case 'memory':
        return new MemoryStore();

      case 'indexeddb':
        if (!IndexedDBStore.isSupported()) {
          logger.warn('IndexedDB not supported, falling back to memory');
          return new MemoryStore();
        }
        this.indexedDBStore = new IndexedDBStore(`${this.config.name}-db`, 'cache');
        return this.indexedDBStore;

      case 'localstorage':
        // Not implemented yet, fallback to memory
        logger.warn('localStorage not implemented, using memory');
        return new MemoryStore();

      default:
        throw new CacheError(`Unsupported storage type: ${String(type)}`);
    }
  }

  /**
   * Estimate data size in bytes
   */
  private estimateSize<T>(data: T): number {
    try {
      const json = JSON.stringify(data);
      return json.length * 2; // UTF-16
    } catch {
      return 0;
    }
  }

  /**
   * Update hit rate
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }
}
