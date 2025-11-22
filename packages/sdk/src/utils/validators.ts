/**
 * Zod schemas for runtime validation of API responses
 *
 * These schemas validate data from the Music Service API to ensure
 * type safety at runtime and provide clear error messages for invalid data.
 */

import { z } from 'zod';

// ============================================================================
// Configuration Schemas
// ============================================================================

export const CacheStrategySchema = z.enum([
  'stale-while-revalidate',
  'cache-first',
  'network-first',
]);

export const MusicServiceConfigSchema = z.object({
  clientId: z.string().min(1, 'Client ID is required'),
  clientSecret: z.string().min(1, 'Client secret is required'),
  apiEndpoint: z.string().url().optional(),
  cacheStrategy: CacheStrategySchema.optional(),
  debug: z.boolean().optional(),
});

// ============================================================================
// CDN & Session Schemas
// ============================================================================

export const CdnInfoSchema = z.object({
  base_url: z.string().url(),
  albums_path: z.string(),
  covers_path: z.string(),
  metadata_path: z.string(),
  trackers_path: z.string(),
});

export const SessionInfoSchema = z.object({
  status: z.string(),
  session: z.object({
    expires_at: z.string().datetime(),
    duration_seconds: z.number().int().positive(),
    created_at: z.string().datetime().optional(),
  }),
  cdn: CdnInfoSchema,
});

// ============================================================================
// Metadata Schemas
// ============================================================================

export const ChecksumSchema = z.object({
  algorithm: z.string(),
  value: z.string(),
  verified_at: z.string().datetime().optional(),
});

export const CoverArtSchema = z.object({
  full: z.string().url(),
  thumbnail: z.string().url(),
});

export const LinkedTrackerSchema = z.object({
  tracker_id: z.string(),
  tracker_title: z.string(),
  format: z.string(),
  file_size_bytes: z.number().int().nonnegative(),
  checksum: z.string(),
  albums_cdn_url: z.string().url(),
  albums_s3_url: z.string().url(),
  tracker_cdn_url: z.string().url(),
  tracker_s3_url: z.string().url(),
});

export const TrackSchema = z.object({
  track_id: z.string(),
  track_name: z.string(),
  artist: z.string(),
  album: z.string(),
  album_id: z.string(),
  track_position: z.string(),
  duration_seconds: z.number().int().nonnegative(),
  duration: z.string(),
  bit_rate_kbps: z.number().int().positive(),
  file_size_bytes: z.number().int().nonnegative(),
  file_size: z.string(),
  format: z.string(),
  sample_rate: z.string().optional(),
  channels: z.string().optional(),
  genre: z.string(),
  recorded_date: z.string(),
  bpm: z.string().optional(),
  bpm_numeric: z.number().nonnegative(),
  explicit: z.boolean(),
  checksum: ChecksumSchema,
  content_length: z.number().int().nonnegative(),
  last_modified: z.string(),
  accept_ranges: z.string(),
  etag: z.string(),
  cdn_url: z.string().url(),
  s3_url: z.string().url(),
  cover_art: CoverArtSchema.optional(),
  linked_tracker: z.array(LinkedTrackerSchema).optional(),
});

export const AlbumSchema = z.object({
  album_id: z.string(),
  album: z.string(),
  artist: z.string(),
  year: z.number().int().positive(),
  total_tracks: z.number().int().positive(),
  released: z.boolean(),
  duration: z.string(),
  duration_seconds: z.number().nonnegative(),
  file_size_bytes: z.number().int().nonnegative(),
  file_size_human: z.string(),
  bpm_range: z.object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
    avg: z.number().nonnegative(),
  }),
  genre: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()),
  cdn_cover_url: z.string().url(),
  s3_cover_url: z.string().url(),
  cdn_thumbnail_url: z.string().url(),
  s3_thumbnail_url: z.string().url(),
  explicit: z.boolean(),
  checksum: ChecksumSchema.extend({
    covers: z.array(z.string()).optional(),
  }),
  last_modified: z.string(),
  tracks: z.array(z.string()),
  cover: z.string(),
  thumbnail: z.string(),
});

export const TrackerModuleSchema = z.object({
  tracker_id: z.string(),
  title: z.string(),
  file_name: z.string(),
  file_size_bytes: z.number().int().nonnegative(),
  file_size: z.string(),
  format: z.string(),
  format_long: z.string(),
  created: z.string(),
  composer: z.string(),
  source_format_version: z.string().optional(),
  tracker_tools: z.array(z.string()).optional(),
  channels: z.number().int().positive(),
  patterns: z.number().int().nonnegative(),
  instruments: z.number().int().nonnegative(),
  samples: z.number().int().nonnegative().optional(),
  song_name: z.string().optional(),
  checksum: ChecksumSchema,
  content_length: z.number().int().nonnegative(),
  last_modified: z.string(),
  accept_ranges: z.string(),
  etag: z.string(),
  explicit: z.boolean(),
  linked: z.boolean(),
  album: z.string().optional(),
  albums_cdn_url: z.string().url().optional(),
  albums_s3_url: z.string().url().optional(),
  tracker_cdn_url: z.string().url(),
  tracker_s3_url: z.string().url().optional(),
  complete_name: z.string().optional(),
  linked_master: z
    .object({
      track_id: z.string(),
      track_title: z.string(),
      format: z.string(),
      cdn_url: z.string().url(),
    })
    .optional(),
});

export const AlbumSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  released: z.boolean(),
  year: z.number().int().positive(),
  cover: z.string().url(),
  thumbnail: z.string().url(),
  url: z.string().url(),
  metadata: z.string(),
});

export const ManifestSchema = z.object({
  schema_version: z.string(),
  content_type: z.literal('metadata'),
  generated_at: z.string().datetime(),
  cache_info: z
    .object({
      strategy: z.string(),
      ttl_seconds: z.number().int().positive(),
      local_cache_path: z.string(),
    })
    .passthrough()
    .optional(),
  artist: z
    .object({
      name: z.string(),
      url: z.string().url(),
      contact: z.string().email(),
    })
    .passthrough()
    .optional(),
  catalog: z.object({
    released_albums: z.number().int().nonnegative(),
    unreleased_collections: z.number().int().nonnegative(),
    total_tracks: z.number().int().nonnegative(),
    total_tracker_sources: z.number().int().nonnegative(),
    total_unlinked_tracker_files: z.number().int().nonnegative(),
    total_size_bytes: z.number().int().nonnegative(),
    total_duration_seconds: z.number().nonnegative(),
  }),
  resources: z
    .object({
      albums_index: z.string().url(),
      tracks_index: z.string().url(),
      tracker_index: z.string().url(),
      unreleased_index: z.string().url(),
    })
    .passthrough()
    .optional(),
  covers: z
    .object({
      base_url: z.string().url(),
      thumbs_url: z.string().url(),
      default_cover: z.string().url(),
    })
    .optional(),
  cdn: z.object({
    base_url: z.string().url(),
    albums_root: z.string().url().optional(),
    trackers_root: z.string().url().optional(),
  }),
  albums: z.array(AlbumSummarySchema),
  tracker_files: z
    .object({
      released: z.string().url(),
      unreleased: z.string().url(),
    })
    .optional(),
  service_worker: z
    .object({
      cache_strategy: z.string(),
      cached_endpoints: z.array(z.string()),
    })
    .passthrough()
    .optional(),
  api: z
    .object({
      rest_entrypoint: z.string().url(),
      graphql_entrypoint: z.string().url(),
      examples: z.record(z.string()),
    })
    .passthrough()
    .optional(),
  integrity: z.object({
    hash_type: z.string().optional(),
    checksums: z.record(
      z.object({
        value: z.string(),
        size_bytes: z.number().int().nonnegative(),
        last_modified: z.string(),
      })
    ),
  }),
});

// ============================================================================
// Playback Schemas
// ============================================================================

export const PlaybackStateSchema = z.object({
  currentTrack: TrackSchema.nullable(),
  isPlaying: z.boolean(),
  position: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  volume: z.number().min(0).max(1),
  shuffle: z.boolean(),
  repeat: z.enum(['off', 'one', 'all']),
  queue: z.array(TrackSchema),
  originalQueue: z.array(TrackSchema),
  queuePosition: z.number().int().nonnegative(),
  sleepTimer: z.object({
    enabled: z.boolean(),
    endsAt: z.date().nullable(),
    remainingMs: z.number().nonnegative(),
  }),
});

// ============================================================================
// Download Schemas
// ============================================================================

export const DownloadProgressSchema = z.object({
  status: z.enum(['preparing', 'downloading', 'complete', 'error']),
  currentFile: z.string(),
  percent: z.number().min(0).max(100),
  bytesDownloaded: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
  error: z.instanceof(Error).optional(),
});

export const DownloadCheckResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.enum(['COOLDOWN', 'SESSION_LIMIT', 'DAILY_LIMIT']).optional(),
  retryAfter: z.number().int().positive().optional(),
  warning: z.boolean().optional(),
  message: z.string().optional(),
});

export const DownloadLimitsSchema = z.object({
  sameFileCooldown: z.number().int().positive(),
  maxDownloadsPerSession: z.number().int().positive(),
  maxDownloadsPerDay: z.number().int().positive(),
  warnAtDownloads: z.number().int().positive(),
});

// ============================================================================
// Search Schemas
// ============================================================================

export const SearchOptionsSchema = z.object({
  limit: z.number().int().positive().optional(),
  threshold: z.number().min(0).max(1).optional(),
  fields: z.array(z.enum(['title', 'artist', 'album', 'genre', 'tags'])).optional(),
});

export const SearchResultsSchema = z.object({
  tracks: z.array(TrackSchema),
  albums: z.array(AlbumSchema),
  trackers: z.array(TrackerModuleSchema),
  executionTimeMs: z.number().nonnegative(),
});

// ============================================================================
// Lyrics Schemas
// ============================================================================

export const LyricsLineSchema = z.object({
  timestamp: z.number().nonnegative(),
  text: z.string(),
});

export const ParsedLyricsSchema = z.object({
  format: z.enum(['lrc', 'plain']),
  lines: z.array(LyricsLineSchema),
  plainText: z.string().optional(),
});

// ============================================================================
// Cache Schemas
// ============================================================================

export const QuotaInfoSchema = z.object({
  usage: z.number().nonnegative(),
  quota: z.number().positive(),
  available: z.number().nonnegative(),
  percentUsed: z.number().min(0).max(100),
});

// ============================================================================
// Inferred TypeScript Types
// ============================================================================

export type MusicServiceConfigValidated = z.infer<typeof MusicServiceConfigSchema>;
export type SessionInfoValidated = z.infer<typeof SessionInfoSchema>;
export type ManifestValidated = z.infer<typeof ManifestSchema>;
export type AlbumValidated = z.infer<typeof AlbumSchema>;
export type TrackValidated = z.infer<typeof TrackSchema>;
export type TrackerModuleValidated = z.infer<typeof TrackerModuleSchema>;
