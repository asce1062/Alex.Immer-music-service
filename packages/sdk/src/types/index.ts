/**
 * Core type definitions for the Music Service SDK
 */

import type { CacheStrategy } from './cache';

// ============================================================================
// Configuration
// ============================================================================

export interface MusicServiceConfig {
  clientId: string;
  clientSecret: string;
  apiEndpoint?: string;
  cacheStrategy?: CacheStrategy;
  debug?: boolean;
}

// ============================================================================
// Session & Authentication
// ============================================================================

export interface SessionInfo {
  status: string;
  session: {
    expires_at: string;
    duration_seconds: number;
    created_at?: string;
  };
  cdn: CdnInfo;
}

export interface SessionState {
  isValid: boolean;
  expiresAt: Date;
  timeUntilExpiry: number;
  needsRefresh: boolean;
}

export interface CdnInfo {
  base_url: string;
  albums_path: string;
  covers_path: string;
  metadata_path: string;
  trackers_path: string;
}

// ============================================================================
// Metadata Types (from OpenAPI)
// ============================================================================

export interface Manifest {
  schema_version: string;
  content_type: string;
  generated_at: string;
  catalog: {
    released_albums: number;
    unreleased_collections: number;
    total_tracks: number;
    total_tracker_sources: number;
    total_unlinked_tracker_files: number;
    total_size_bytes: number;
    total_duration_seconds: number;
  };
  albums: AlbumSummary[];
  cdn: CdnInfo;
  integrity: {
    checksums: Record<
      string,
      {
        value: string;
        size_bytes: number;
        last_modified: string;
      }
    >;
  };
}

export interface Album {
  album_id: string;
  album: string;
  artist: string;
  year: number;
  total_tracks: number;
  released: boolean;
  duration: string;
  duration_seconds: number;
  file_size_bytes: number;
  file_size_human: string;
  bpm_range: {
    min: number;
    max: number;
    avg: number;
  };
  genre: string;
  description?: string;
  tags: string[];
  cdn_cover_url: string;
  s3_cover_url: string;
  cdn_thumbnail_url: string;
  s3_thumbnail_url: string;
  explicit: boolean;
  checksum: Checksum & { covers?: string[] };
  last_modified: string;
  tracks: string[];
  cover: string;
  thumbnail: string;
}

export interface Track {
  track_id: string;
  title: string;
  artist: string;
  album: string;
  album_id: string;
  track_number: number;
  duration_seconds: number;
  duration_human: string;
  bit_rate_kbps: number;
  file_size_bytes: number;
  file_size: string;
  format: string;
  sample_rate: string;
  channels: string;
  genre: string;
  year: string;
  bpm: number;
  explicit: boolean;
  checksum: Checksum;
  content_length: number;
  last_modified: string;
  accept_ranges: string;
  etag: string;
  cdn_url: string;
  s3_url: string;
  cover_art?: CoverArt;
  linked_tracker?: LinkedTracker[];
  comment?: unknown;
}

export interface TrackerModule {
  tracker_id: string;
  title: string;
  file_name: string;
  file_size_bytes: number;
  file_size: string;
  format: string;
  format_long: string;
  created: string;
  composer: string;
  source_format_version?: string;
  tracker_tools?: string[];
  channels: number;
  patterns: number;
  instruments: number;
  samples?: number;
  song_name?: string;
  checksum: Checksum;
  content_length: number;
  last_modified: string;
  accept_ranges: string;
  etag: string;
  explicit: boolean;
  linked: boolean;
  album?: string;
  albums_cdn_url?: string;
  tracker_cdn_url: string;
  linked_master?: {
    track_id: string;
    track_title: string;
    format: string;
    cdn_url: string;
  };
}

export interface AlbumSummary {
  id: string;
  title: string;
  released: boolean;
  year: number;
  cover: string;
  thumbnail: string;
  url: string;
  metadata: string;
}

export interface CoverArt {
  full: string;
  thumbnail: string;
}

export interface Checksum {
  algorithm: string;
  value: string;
  verified_at?: string;
}

export interface LinkedTracker {
  tracker_id: string;
  tracker_title: string;
  format: string;
  file_size_bytes: number;
  checksum: string;
  albums_cdn_url: string;
  albums_s3_url: string;
  tracker_cdn_url: string;
  tracker_s3_url: string;
}

// ============================================================================
// Playback Types (re-exported from playback.ts)
// ============================================================================

export type {
  PlaybackStatus,
  RepeatMode,
  PlaybackQuality,
  AudioOutputMode,
  CrossfadeMode,
  PlaybackState,
  PlaybackConfig,
  PlaybackEvents,
  TrackInfo,
  PlaybackStats,
  SeekTarget,
  VolumeTarget,
  ScrobbleEntry,
  HistoryEntry,
  TrackBookmark,
  GaplessConfig,
  BufferState,
  MediaSessionMetadata,
  SkipEvent,
  LikedTrack,
  LikesStorage,
} from './playback';

// ============================================================================
// Download Types (re-exported from download.ts)
// ============================================================================

export type {
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
} from './download';

// ============================================================================
// Search Types (re-exported from search.ts)
// ============================================================================

export type {
  SearchableEntity,
  SearchFilters,
  SearchOptions,
  SearchResult,
  SearchResults,
  SearchIndexConfig,
} from './search';

export { ALBUM_SEARCH_FIELDS, TRACK_SEARCH_FIELDS, TRACKER_SEARCH_FIELDS } from './search';

// ============================================================================
// Lyrics Types (re-exported from lyrics.ts)
// ============================================================================

export type {
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
} from './lyrics';

// ============================================================================
// Tracker Playback Types (re-exported from tracker.ts)
// ============================================================================

export type {
  TrackerEngine,
  TrackerPlaybackStatus,
  TrackerPlaybackConfig,
  TrackerMetadata,
  TrackerPlaybackState,
  TrackerPlaybackEvents,
  TrackerPlaybackStats,
  TrackerPlayerInfo,
  LibOpenMPTModule,
  Chiptune2Player,
} from './tracker';

// ============================================================================
// Error Types (re-exported from errors.ts)
// ============================================================================

export {
  MusicServiceError,
  AuthenticationError,
  NetworkError,
  ValidationError,
  RateLimitError,
  NotFoundError,
  CacheError,
} from './errors';

// ============================================================================
// Cache Types (re-exported from cache.ts)
// ============================================================================

export type {
  CacheStrategy,
  CacheEntry,
  StorageType,
  CacheConfig,
  StorageQuota,
  CacheStats,
  StorageEstimateWithDetails,
  ServiceWorkerConfig,
  ServiceWorkerState,
  ServiceWorkerRegistrationState,
  SWMessageResponse,
  CacheOptions,
  MetadataCacheConfig,
} from './cache';
