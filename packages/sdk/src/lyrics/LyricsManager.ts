/**
 * LyricsManager - Comprehensive Lyrics Management System
 *
 * Features:
 * - Auto-extract lyrics from track comments
 * - LRC format parsing with timestamps
 * - Plain text lyrics support
 * - Lyrics caching with localStorage
 * - Playback synchronization
 * - Event system
 * - Search functionality
 */

import type {
  Track,
  ParsedLyrics,
  LyricsConfig,
  LyricsCacheEntry,
  LyricsStats,
  LyricsEvents,
  LyricsState,
  LyricsSearchResult,
} from '../types';
import {
  parseLrc,
  parsePlainText,
  isLrcFormat,
  getActiveLineIndex,
  searchLyrics as searchLyricsText,
} from './LrcParser';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('LyricsManager');

type EventMap = {
  [K in keyof LyricsEvents]: LyricsEvents[K][];
};

export class LyricsManager {
  private config: Required<LyricsConfig>;
  private cache = new Map<string, LyricsCacheEntry>();
  private events: Partial<EventMap> = {};
  private currentState: LyricsState = {
    currentLineIndex: -1,
    currentLine: null,
    nextLine: null,
    lyrics: null,
    synchronized: false,
  };
  private stats: LyricsStats = {
    totalTracksWithLyrics: 0,
    cachedLyrics: 0,
    synchronizedLyrics: 0,
    plainTextLyrics: 0,
    cacheHitRate: 0,
  };
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config?: LyricsConfig) {
    this.config = {
      autoExtractComments: config?.autoExtractComments ?? true,
      cacheLyrics: config?.cacheLyrics ?? true,
      cacheStorageKey: config?.cacheStorageKey ?? 'music-service-lyrics-cache',
      maxCacheEntries: config?.maxCacheEntries ?? 500,
      debug: config?.debug ?? false,
    };

    // Load cache from storage
    if (this.config.cacheLyrics) {
      this.loadCache();
    }

    logger.debug('Initialized with config', { config: this.config });
  }

  // ============================================================================
  // Lyrics Extraction & Parsing
  // ============================================================================

  /**
   * Get lyrics for a track
   * Extracts from comment field or returns cached lyrics
   */
  getLyrics(track: Track): ParsedLyrics | null {
    // Check cache first
    const cached = this.cache.get(track.track_id);
    if (cached) {
      this.cacheHits++;
      cached.lastAccessedAt = new Date();
      cached.accessCount++;
      this.emit('cachehit', track.track_id);

      logger.debug('Cache hit for', { trackId: track.track_id });

      this.updateStats();
      return cached.lyrics;
    }

    this.cacheMisses++;
    this.emit('cachemiss', track.track_id);

    // Extract from comment if enabled
    if (this.config.autoExtractComments && 'comment' in track) {
      const comment = track.comment;
      if (comment && typeof comment === 'string' && comment.trim().length > 0) {
        const lyrics = this.parseLyrics(comment, 'comment');

        if (lyrics) {
          // Cache the lyrics
          this.cacheLyrics(track.track_id, lyrics);
          this.emit('loaded', track.track_id, lyrics);

          logger.debug('Extracted lyrics from comment', { trackId: track.track_id });

          this.updateStats();
          return lyrics;
        }
      }
    }

    this.updateStats();
    return null;
  }

  /**
   * Parse lyrics from raw content
   */
  parseLyrics(content: string, source: 'comment' | 'external' = 'external'): ParsedLyrics | null {
    const trimmed = content.trim();
    if (!trimmed) return null;

    // Check if LRC format
    if (isLrcFormat(trimmed)) {
      return parseLrc(trimmed);
    }

    // Parse as plain text
    return parsePlainText(trimmed, source);
  }

  /**
   * Set custom lyrics for a track
   */
  setLyrics(
    trackId: string,
    content: string,
    source: 'external' | 'manual' = 'manual'
  ): ParsedLyrics | null {
    const lyrics = this.parseLyrics(content, source === 'manual' ? 'external' : source);
    if (!lyrics) return null;

    // Override source if manual
    if (source === 'manual') {
      lyrics.source = 'manual';
    }

    this.cacheLyrics(trackId, lyrics);
    this.emit('updated', trackId, lyrics);

    logger.debug('Custom lyrics set for', trackId);

    this.updateStats();
    return lyrics;
  }

  /**
   * Remove lyrics for a track
   */
  removeLyrics(trackId: string): void {
    if (this.cache.has(trackId)) {
      this.cache.delete(trackId);
      this.saveCache();

      logger.debug('Lyrics removed for', trackId);

      this.updateStats();
    }
  }

  /**
   * Check if track has lyrics
   */
  hasLyrics(trackId: string): boolean {
    return this.cache.has(trackId);
  }

  // ============================================================================
  // Playback Synchronization
  // ============================================================================

  /**
   * Update current playback position for synchronized lyrics
   */
  updatePosition(positionMs: number): LyricsState {
    if (!this.currentState.lyrics || !this.currentState.synchronized) {
      return this.currentState;
    }

    const newIndex = getActiveLineIndex(this.currentState.lyrics, positionMs);

    // Check if line changed
    if (newIndex !== this.currentState.currentLineIndex && newIndex >= 0) {
      this.currentState.currentLineIndex = newIndex;
      this.currentState.currentLine = this.currentState.lyrics.lines[newIndex];
      this.currentState.nextLine =
        newIndex + 1 < this.currentState.lyrics.lines.length
          ? this.currentState.lyrics.lines[newIndex + 1]
          : null;

      this.emit('lineactive', this.currentState.currentLine, newIndex);
    }

    return this.currentState;
  }

  /**
   * Set current track for playback synchronization
   */
  setCurrentTrack(track: Track | null): void {
    if (!track) {
      this.currentState = {
        currentLineIndex: -1,
        currentLine: null,
        nextLine: null,
        lyrics: null,
        synchronized: false,
      };
      return;
    }

    const lyrics = this.getLyrics(track);
    if (lyrics) {
      this.currentState = {
        currentLineIndex: -1,
        currentLine: null,
        nextLine: lyrics.lines[0] || null,
        lyrics,
        synchronized: lyrics.synchronized,
      };
    } else {
      this.currentState = {
        currentLineIndex: -1,
        currentLine: null,
        nextLine: null,
        lyrics: null,
        synchronized: false,
      };
    }
  }

  /**
   * Get current lyrics state
   */
  getCurrentState(): Readonly<LyricsState> {
    return { ...this.currentState };
  }

  // ============================================================================
  // Search & Query
  // ============================================================================

  /**
   * Search lyrics across all cached tracks
   */
  searchLyrics(query: string, tracks?: Track[]): LyricsSearchResult[] {
    const results: LyricsSearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [trackId, entry] of this.cache.entries()) {
      const matchingLines = searchLyricsText(entry.lyrics, query);

      if (matchingLines.length > 0) {
        // Find the track
        const track = tracks?.find((t) => t.track_id === trackId);
        if (!track) continue;

        // Calculate match score
        const score = matchingLines.length / entry.lyrics.lines.length;

        // Generate preview (first matching line + context)
        const firstMatchIndex = entry.lyrics.lines.findIndex((line) =>
          line.text.toLowerCase().includes(lowerQuery)
        );
        const preview = entry.lyrics.lines
          .slice(Math.max(0, firstMatchIndex - 1), firstMatchIndex + 2)
          .map((line) => line.text)
          .join('\n');

        results.push({
          track,
          preview,
          lyrics: entry.lyrics,
          score,
        });
      }
    }

    // Sort by score (descending)
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  /**
   * Get all tracks with lyrics
   */
  getTracksWithLyrics(): string[] {
    return Array.from(this.cache.keys());
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Cache lyrics for a track
   */
  private cacheLyrics(trackId: string, lyrics: ParsedLyrics): void {
    const entry: LyricsCacheEntry = {
      trackId,
      lyrics,
      cachedAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 1,
    };

    this.cache.set(trackId, entry);

    // Enforce cache size limit
    if (this.cache.size > this.config.maxCacheEntries) {
      this.evictOldestEntry();
    }

    if (this.config.cacheLyrics) {
      this.saveCache();
    }
  }

  /**
   * Evict oldest cache entry
   */
  private evictOldestEntry(): void {
    let oldestEntry: [string, LyricsCacheEntry] | null = null;
    let oldestTime = Date.now();

    for (const entry of this.cache.entries()) {
      const lastAccessed = entry[1].lastAccessedAt.getTime();
      if (lastAccessed < oldestTime) {
        oldestTime = lastAccessed;
        oldestEntry = entry;
      }
    }

    if (oldestEntry) {
      this.cache.delete(oldestEntry[0]);

      logger.debug('Evicted oldest cache entry', { oldestEntry: oldestEntry[0] });
    }
  }

  /**
   * Clear all cached lyrics
   */
  clearCache(): void {
    this.cache.clear();
    this.saveCache();

    logger.debug('Cache cleared');

    this.updateStats();
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get lyrics statistics
   */
  getStats(): Readonly<LyricsStats> {
    return { ...this.stats };
  }

  private updateStats(): void {
    this.stats.totalTracksWithLyrics = this.cache.size;
    this.stats.cachedLyrics = this.cache.size;
    this.stats.synchronizedLyrics = Array.from(this.cache.values()).filter(
      (entry) => entry.lyrics.synchronized
    ).length;
    this.stats.plainTextLyrics = Array.from(this.cache.values()).filter(
      (entry) => !entry.lyrics.synchronized
    ).length;

    const totalRequests = this.cacheHits + this.cacheMisses;
    this.stats.cacheHitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;
  }

  // ============================================================================
  // Event System
  // ============================================================================
  private callListener<K extends keyof LyricsEvents>(
    listener: LyricsEvents[K],
    args: Parameters<LyricsEvents[K]>
  ): void {
    (listener as (...args: Parameters<LyricsEvents[K]>) => void)(...args);
  }

  on<K extends keyof LyricsEvents>(event: K, listener: LyricsEvents[K]): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event]!.push(listener);
  }

  off<K extends keyof LyricsEvents>(event: K, listener: LyricsEvents[K]): void {
    const listeners = this.events[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  once<K extends keyof LyricsEvents>(event: K, listener: LyricsEvents[K]): void {
    const onceListener: LyricsEvents[K] = ((...args: Parameters<LyricsEvents[K]>) => {
      this.callListener(listener, args);
      this.off(event, onceListener);
    }) as LyricsEvents[K];

    this.on(event, onceListener);
  }

  private emit<K extends keyof LyricsEvents>(event: K, ...args: Parameters<LyricsEvents[K]>): void {
    const listeners = this.events[event];
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          this.callListener(listener, args);
        } catch (error) {
          logger.error(`Error in ${event} listener`, error);
        }
      });
    }
  }

  // ============================================================================
  // Storage
  // ============================================================================

  private loadCache(): void {
    try {
      const saved = localStorage.getItem(this.config.cacheStorageKey);
      if (!saved) return;

      const data: unknown = JSON.parse(saved);

      if (Array.isArray(data)) {
        for (const item of data) {
          if (
            item &&
            typeof item === 'object' &&
            'trackId' in item &&
            'lyrics' in item &&
            'cachedAt' in item &&
            'lastAccessedAt' in item &&
            'accessCount' in item
          ) {
            const validated = item as {
              trackId: string;
              lyrics: ParsedLyrics;
              cachedAt: string;
              lastAccessedAt: string;
              accessCount: number;
            };

            const entry: LyricsCacheEntry = {
              trackId: validated.trackId,
              lyrics: validated.lyrics,
              cachedAt: new Date(validated.cachedAt),
              lastAccessedAt: new Date(validated.lastAccessedAt),
              accessCount: validated.accessCount,
            };

            this.cache.set(entry.trackId, entry);
          }
        }

        logger.debug(`Loaded cache ${this.cache.size} entries`);
      }
    } catch (error) {
      logger.warn('Failed to load cache', error);
    }

    this.updateStats();
  }

  private saveCache(): void {
    if (!this.config.cacheLyrics) return;

    try {
      const data = Array.from(this.cache.values());
      localStorage.setItem(this.config.cacheStorageKey, JSON.stringify(data));
    } catch (error) {
      logger.warn('Failed to save cache', error);
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Save cache one last time
    if (this.config.cacheLyrics) {
      this.saveCache();
    }

    // Clear events
    this.events = {};

    logger.debug('Destroyed');
  }
}
