/**
 * Cache module
 *
 * Provides comprehensive caching capabilities:
 * - CacheManager: Main cache management class
 * - IndexedDB storage: Persistent storage
 * - Cache strategies: Various caching patterns
 * - Storage quota management: Monitor and manage storage
 * - Service Worker helpers: PWA support
 */

export { CacheManager } from './CacheManager';
export { IndexedDBStore } from './IndexedDBStore';

export {
  cacheFirst,
  networkFirst,
  staleWhileRevalidate,
  networkOnly,
  cacheOnly,
  executeStrategy,
  type CacheStorage,
  type FetchFunction,
  type StrategyOptions,
  type StrategyResult,
} from './strategies';

export {
  getStorageQuota,
  requestPersistentStorage,
  isStoragePersisted,
  formatBytes,
  hasEnoughSpace,
  getStorageBreakdown,
  monitorQuota,
  estimateEntrySize,
  calculateCacheOverhead,
} from './quota';

export {
  isServiceWorkerSupported,
  registerServiceWorker,
  unregisterServiceWorker,
  getServiceWorkerState,
  waitForServiceWorkerReady,
  sendMessageToServiceWorker,
  onServiceWorkerMessage,
  checkForUpdates,
  skipWaitingAndActivate,
  getCacheNames,
  deleteCache,
  clearAllCaches,
} from './service-worker';
