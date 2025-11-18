/**
 * Cache-related type definitions
 */

/**
 * Cache strategy types
 */
export type CacheStrategy =
  | 'cache-first' // Check cache first, fallback to network
  | 'network-first' // Try network first, fallback to cache
  | 'stale-while-revalidate' // Return cache immediately, update in background
  | 'network-only' // Always fetch from network
  | 'cache-only'; // Only use cache, fail if not cached

/**
 * Cache entry metadata
 */
export interface CacheEntry<T = unknown> {
  /** Cached data */
  data: T;
  /** Cache key */
  key: string;
  /** Timestamp when cached (milliseconds) */
  cachedAt: number;
  /** Time-to-live in milliseconds */
  ttl: number;
  /** ETag for conditional requests */
  etag?: string;
  /** Content checksum for integrity */
  checksum?: string;
  /** Size in bytes */
  sizeBytes: number;
  /** Expiration timestamp */
  expiresAt: number;
}

/**
 * Storage type for cache
 */
export type StorageType = 'memory' | 'indexeddb' | 'localstorage';

/**
 * Cache configuration options
 */
export interface CacheConfig {
  /** Cache name/namespace */
  name: string;
  /** Storage type */
  storageType: StorageType;
  /** Default TTL in milliseconds (default: 1 hour) */
  defaultTTL?: number;
  /** Maximum cache size in bytes (default: 50MB) */
  maxSize?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Cache version for migrations */
  version?: number;
}

/**
 * Storage quota information
 */
export interface StorageQuota {
  /** Total quota in bytes */
  quota: number;
  /** Used storage in bytes */
  usage: number;
  /** Available storage in bytes */
  available: number;
  /** Usage percentage (0-100) */
  usagePercent: number;
  /** Whether approaching quota limit (>80%) */
  isNearLimit: boolean;
}

/**
 * Cache statistics
 */
export interface CacheStats {
  /** Total number of entries */
  totalEntries: number;
  /** Total size in bytes */
  totalSize: number;
  /** Number of hits */
  hits: number;
  /** Number of misses */
  misses: number;
  /** Hit rate percentage (0-100) */
  hitRate: number;
  /** Number of expired entries */
  expiredEntries: number;
}

export interface StorageEstimateWithDetails extends StorageEstimate {
  usageDetails?: {
    indexedDB?: number;
    caches?: number;
    serviceWorkerRegistrations?: number;
  };
}

/**
 * Service Worker registration options
 */
export interface ServiceWorkerConfig {
  /** Service Worker script URL */
  scriptURL: string;
  /** Registration scope */
  scope?: string;
  /** Update strategy */
  updateStrategy?: 'immediate' | 'on-reload' | 'manual';
  /** Enable periodic background sync */
  enableBackgroundSync?: boolean;
}

/**
 * Service Worker state
 */
export interface ServiceWorkerState {
  /** Whether service worker is supported */
  supported: boolean;
  /** Whether service worker is registered */
  registered: boolean;
  /** Whether service worker is active */
  active: boolean;
  /** Registration object */
  registration?: ServiceWorkerRegistration;
  /** Current state */
  state?: ServiceWorkerRegistrationState;
}

/**
 * Service Worker registration state
 */
export type ServiceWorkerRegistrationState =
  | 'installing'
  | 'installed'
  | 'activating'
  | 'activated'
  | 'redundant'
  | 'unregistered';

export interface SWMessageBase {
  type: string;
}

export interface SWErrorMessage extends SWMessageBase {
  error: string;
}

export interface SWSuccessMessage<T = unknown> extends SWMessageBase {
  data: T;
}

export type SWMessageResponse<T = unknown> = SWErrorMessage | SWSuccessMessage<T>;

/**
 * Cache operation options
 */
export interface CacheOptions {
  /** Cache strategy to use */
  strategy?: CacheStrategy;
  /** TTL override for this operation */
  ttl?: number;
  /** Force refresh from network */
  forceRefresh?: boolean;
  /** Skip cache and go directly to network */
  skipCache?: boolean;
}

/**
 * Metadata cache configuration for music service
 */
export interface MetadataCacheConfig {
  /** Enable caching of manifest */
  cacheManifest?: boolean;
  /** Enable caching of albums */
  cacheAlbums?: boolean;
  /** Enable caching of tracks */
  cacheTracks?: boolean;
  /** Enable caching of trackers */
  cacheTrackers?: boolean;
  /** Manifest TTL (default: 1 hour) */
  manifestTTL?: number;
  /** Albums TTL (default: 1 hour) */
  albumsTTL?: number;
  /** Tracks TTL (default: 1 hour) */
  tracksTTL?: number;
  /** Trackers TTL (default: 1 hour) */
  trackersTTL?: number;
}
