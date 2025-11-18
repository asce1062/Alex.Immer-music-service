/**
 * Lyrics types and interfaces
 */

import type { Track } from './index';

/**
 * Lyrics format type
 */
export type LyricsFormat = 'lrc' | 'plain' | 'unknown';

/**
 * Lyrics source
 */
export type LyricsSource = 'comment' | 'external' | 'embedded' | 'manual';

/**
 * Individual lyrics line with timestamp
 */
export interface LyricsLine {
  /** Timestamp in milliseconds (0 for plain text) */
  timestamp: number;
  /** Line text */
  text: string;
  /** Optional line duration in milliseconds */
  duration?: number;
}

/**
 * LRC metadata tags
 */
export interface LrcMetadata {
  /** Artist name */
  ar?: string;
  /** Album name */
  al?: string;
  /** Track title */
  ti?: string;
  /** Lyrics author */
  au?: string;
  /** Length in format mm:ss */
  length?: string;
  /** Creator/Editor */
  by?: string;
  /** Offset in milliseconds */
  offset?: number;
  /** Program/Tool used */
  re?: string;
  /** Version */
  ve?: string;
  /** Additional metadata */
  [key: string]: string | number | undefined;
}

/**
 * Parsed lyrics with metadata
 */
export interface ParsedLyrics {
  /** Lyrics format */
  format: LyricsFormat;
  /** Lyrics lines (sorted by timestamp) */
  lines: LyricsLine[];
  /** Plain text representation */
  plainText: string;
  /** LRC metadata (if available) */
  metadata?: LrcMetadata;
  /** Source of lyrics */
  source: LyricsSource;
  /** Original raw content */
  rawContent?: string;
  /** Has timestamps (synchronized lyrics) */
  synchronized: boolean;
  /** Language (if detected) */
  language?: string;
}

/**
 * Lyrics search result
 */
export interface LyricsSearchResult {
  /** Track info */
  track: Track;
  /** Lyrics preview (first few lines) */
  preview: string;
  /** Full lyrics */
  lyrics: ParsedLyrics;
  /** Match score (0-1) */
  score: number;
}

/**
 * Lyrics configuration
 */
export interface LyricsConfig {
  /** Auto-extract from track comments */
  autoExtractComments?: boolean;
  /** Cache lyrics in localStorage */
  cacheLyrics?: boolean;
  /** Cache storage key */
  cacheStorageKey?: string;
  /** Maximum cache entries */
  maxCacheEntries?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Lyrics cache entry
 */
export interface LyricsCacheEntry {
  /** Track ID */
  trackId: string;
  /** Lyrics */
  lyrics: ParsedLyrics;
  /** Cached timestamp */
  cachedAt: Date;
  /** Last accessed timestamp */
  lastAccessedAt: Date;
  /** Access count */
  accessCount: number;
}

/**
 * Lyrics statistics
 */
export interface LyricsStats {
  /** Total tracks with lyrics */
  totalTracksWithLyrics: number;
  /** Cached lyrics count */
  cachedLyrics: number;
  /** Synchronized lyrics count */
  synchronizedLyrics: number;
  /** Plain text lyrics count */
  plainTextLyrics: number;
  /** Cache hit rate */
  cacheHitRate: number;
}

/**
 * Lyrics events
 */
export interface LyricsEvents {
  /** Lyrics loaded */
  loaded: (trackId: string, lyrics: ParsedLyrics) => void;
  /** Lyrics cache hit */
  cachehit: (trackId: string) => void;
  /** Lyrics cache miss */
  cachemiss: (trackId: string) => void;
  /** Lyrics line active (during playback) */
  lineactive: (line: LyricsLine, index: number) => void;
  /** Lyrics updated */
  updated: (trackId: string, lyrics: ParsedLyrics) => void;
}

/**
 * Current lyrics state (for playback synchronization)
 */
export interface LyricsState {
  /** Currently active line index */
  currentLineIndex: number;
  /** Current line */
  currentLine: LyricsLine | null;
  /** Next line */
  nextLine: LyricsLine | null;
  /** All lyrics */
  lyrics: ParsedLyrics | null;
  /** Is synchronized */
  synchronized: boolean;
}
