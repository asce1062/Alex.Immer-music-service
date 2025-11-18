/**
 * @asce1062/music-service-sdk
 *
 * Official TypeScript/JavaScript SDK for Alex.Immer Music Service API
 *
 * @packageDocumentation
 */

// Main client
export { MusicServiceClient } from './client';

// Types
export type {
  // Configuration
  MusicServiceConfig,

  // Session
  SessionInfo,
  SessionState,
  CdnInfo,

  // Metadata
  Manifest,
  Album,
  Track,
  TrackerModule,
  AlbumSummary,
  CoverArt,
  Checksum,

  // Playback
  PlaybackState,
  PlaybackEvents,
  TrackInfo,

  // Lyrics
  LyricsFormat,
  LyricsSource,
  LyricsLine,
  LrcMetadata,
  ParsedLyrics,
  LyricsSearchResult,
  LyricsConfig,
  LyricsCacheEntry,
  LyricsStats,
  LyricsEvents,
  LyricsState,

  // Tracker Playback
  TrackerEngine,
  TrackerPlaybackStatus,
  TrackerPlaybackConfig,
  TrackerMetadata,
  TrackerPlaybackState,
  TrackerPlaybackEvents,
  TrackerPlaybackStats,
  TrackerPlayerInfo,

  // Download
  DownloadStatus,
  DownloadPriority,
  DownloadableType,
  DownloadProgress,
  DownloadItem,
  DownloadCheckResult,
  DownloadLimits,
  DownloadStats,
  DownloadConfig,
  DownloadEvents,
  DownloadHistoryEntry,
  BatchDownloadOptions,
  DownloadVerification,

  // Search
  SearchOptions,
  SearchResults,

  // Cache
  CacheStrategy,
  CacheEntry,
  StorageType,
  CacheConfig,
  StorageQuota,
  CacheStats,
  ServiceWorkerConfig,
  ServiceWorkerState,
  CacheOptions,
  MetadataCacheConfig,

  // Errors
  MusicServiceError,
  AuthenticationError,
  NetworkError,
  ValidationError,
  RateLimitError,
  NotFoundError,
  CacheError,
} from './types';

// Cache Module
export {
  CacheManager,
  IndexedDBStore,
  cacheFirst,
  networkFirst,
  staleWhileRevalidate,
  networkOnly,
  cacheOnly,
  executeStrategy,
  getStorageQuota,
  requestPersistentStorage,
  isStoragePersisted,
  formatBytes,
  hasEnoughSpace,
  getStorageBreakdown,
  monitorQuota,
  estimateEntrySize,
  calculateCacheOverhead,
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
  type CacheStorage,
  type FetchFunction,
  type StrategyOptions,
  type StrategyResult,
} from './cache';

// Search Module
export { SearchManager, type SearchManagerConfig } from './search';

// Playback Module
export { PlaybackManager } from './playback';
export { TrackerPlayer } from './playback/TrackerPlayer';

// Download Module
export { DownloadManager } from './download';

// Lyrics Module
export {
  LyricsManager,
  parseLrc,
  parsePlainText,
  isLrcFormat,
  formatTimestamp,
  toLrcFormat,
  getActiveLineIndex,
  getActiveLine,
  searchLyrics,
} from './lyrics';

// Utilities
export { Logger, createLogger, logger, SDKLogger } from './utils/logger';
export type { LogLevel, LogEntry, LoggerConfig } from './utils/logger';
export { EventEmitter, createEventEmitter } from './utils/events';

// Version
export const VERSION = '1.0.0-beta.1';
