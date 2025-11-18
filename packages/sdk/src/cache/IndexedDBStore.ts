/**
 * IndexedDB wrapper for persistent cache storage
 *
 * Provides a simple key-value store interface over IndexedDB with:
 * - Promise-based API
 * - Automatic expiration handling
 * - Size tracking
 * - Error handling
 */

import type { CacheEntry } from '../types';
import { CacheError } from '../types/errors';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('IndexedDBStore');

const DB_NAME = 'music-service-sdk';
const STORE_NAME = 'cache';
const DB_VERSION = 1;

export class IndexedDBStore {
  private dbName: string;
  private storeName: string;
  private version: number;
  private db: IDBDatabase | null = null;

  constructor(dbName: string = DB_NAME, storeName: string = STORE_NAME) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.version = DB_VERSION;
  }

  /**
   * Check if IndexedDB is supported
   */
  static isSupported(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  /**
   * Initialize the IndexedDB database
   */
  async init(): Promise<void> {
    if (!IndexedDBStore.isSupported()) {
      throw new CacheError('IndexedDB is not supported in this environment');
    }

    if (this.db) {
      return; // Already initialized
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        reject(new CacheError('Failed to open IndexedDB', request.error));
      };

      request.onsuccess = () => {
        this.db = request.result;

        // Handle unexpected database close
        this.db.onversionchange = () => {
          this.db?.close();
          this.db = null;

          logger.debug('Database closed due to version change');
        };

        logger.debug('Database initialized');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const objectStore = db.createObjectStore(this.storeName, { keyPath: 'key' });

          // Create indexes for efficient queries
          objectStore.createIndex('expiresAt', 'expiresAt', { unique: false });
          objectStore.createIndex('cachedAt', 'cachedAt', { unique: false });

          logger.debug('Object store created');
        }
      };
    });
  }

  /**
   * Get a value from the cache
   */
  async get<T = unknown>(key: string): Promise<CacheEntry<T> | null> {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.get(key);

      request.onerror = () => {
        reject(new CacheError(`Failed to get key: ${key}`, request.error));
      };

      request.onsuccess = () => {
        const entry = request.result as CacheEntry<T> | undefined;

        if (!entry) {
          resolve(null);
          return;
        }

        // Check if expired
        if (Date.now() > entry.expiresAt) {
          logger.debug(`Entry expired: ${String(key)}`);
          // Delete expired entry asynchronously
          this.delete(key).catch(() => undefined);
          resolve(null);
          return;
        }

        resolve(entry);
      };
    });
  }

  /**
   * Set a value in the cache
   */
  async set<T = unknown>(entry: CacheEntry<T>): Promise<void> {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.put(entry);

      request.onerror = () => {
        reject(new CacheError(`Failed to set key: ${entry.key}`, request.error));
      };

      request.onsuccess = () => {
        logger.debug(`Stored: ${entry.key} (${entry.sizeBytes ?? 0} bytes)`);
        resolve();
      };
    });
  }

  /**
   * Delete a value from the cache
   */
  async delete(key: string): Promise<void> {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.delete(key);

      request.onerror = () => {
        reject(new CacheError(`Failed to delete key: ${key}`, request.error));
      };

      request.onsuccess = () => {
        logger.debug(`Deleted: ${String(key)}`);
        resolve();
      };
    });
  }

  /**
   * Check if a key exists in the cache
   */
  async has(key: string): Promise<boolean> {
    const entry = await this.get(key);
    return entry !== null;
  }

  /**
   * Get all keys in the cache
   */
  async keys(): Promise<string[]> {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAllKeys();

      request.onerror = () => {
        reject(new CacheError('Failed to get all keys', request.error));
      };

      request.onsuccess = () => {
        resolve(request.result as string[]);
      };
    });
  }

  /**
   * Get all entries in the cache
   */
  async entries<T = unknown>(): Promise<CacheEntry<T>[]> {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.getAll();

      request.onerror = () => {
        reject(new CacheError('Failed to get all entries', request.error));
      };

      request.onsuccess = () => {
        const entries = request.result as CacheEntry<T>[];
        // Filter out expired entries
        const now = Date.now();
        const validEntries = entries.filter((entry) => entry.expiresAt > now);
        resolve(validEntries);
      };
    });
  }

  /**
   * Clear all entries from the cache
   */
  async clear(): Promise<void> {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      const request = objectStore.clear();

      request.onerror = () => {
        reject(new CacheError('Failed to clear cache', request.error));
      };

      request.onsuccess = () => {
        logger.debug('Cache cleared');
        resolve();
      };
    });
  }

  /**
   * Delete expired entries
   */
  async deleteExpired(): Promise<number> {
    await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const objectStore = transaction.objectStore(this.storeName);
      const index = objectStore.index('expiresAt');
      const now = Date.now();

      // Get all entries that have expired
      const range = IDBKeyRange.upperBound(now);
      const request = index.openCursor(range);
      let deletedCount = 0;

      request.onerror = () => {
        reject(new CacheError('Failed to delete expired entries', request.error));
      };

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          if (deletedCount > 0) {
            logger.debug(`Deleted ${deletedCount} expired entries`);
          }
          resolve(deletedCount);
        }
      };
    });
  }

  /**
   * Get total size of all entries in bytes
   */
  async getTotalSize(): Promise<number> {
    const entries = await this.entries();
    return entries.reduce((total, entry) => total + (entry.sizeBytes ?? 0), 0);
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    totalEntries: number;
    totalSize: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  }> {
    const entries = await this.entries();

    if (entries.length === 0) {
      return {
        totalEntries: 0,
        totalSize: 0,
        oldestEntry: null,
        newestEntry: null,
      };
    }

    const totalSize = entries.reduce((total, entry) => total + (entry.sizeBytes ?? 0), 0);
    const timestamps = entries.map((e) => e.cachedAt);
    const oldestEntry = Math.min(...timestamps);
    const newestEntry = Math.max(...timestamps);

    return {
      totalEntries: entries.length,
      totalSize,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.debug('Database closed');
    }
  }

  /**
   * Ensure database is initialized
   */
  private async ensureDB(): Promise<void> {
    if (!this.db) {
      await this.init();
    }
  }
}
