/**
 * Metadata API
 *
 * Provides methods to fetch music catalog metadata from CDN bulk JSON files:
 * - Manifest (catalog overview)
 * - Albums (complete album catalog)
 * - Tracks (complete track catalog)
 * - Tracker modules (complete tracker catalog)
 *
 * Implementation details:
 * - Fetches bulk JSON files from CDN (not individual files per item)
 * - Implements in-memory caching with ETag support
 * - Respects Cache-Control headers (1 hour TTL)
 * - Recommendation: Fetch once per session and cache client-side
 */

import type { Manifest, Album, Track, TrackerModule, CdnInfo } from '../types';
import { AuthenticationError, NotFoundError, NetworkError } from '../types/errors';
import { ManifestSchema, AlbumSchema, TrackSchema, TrackerModuleSchema } from '../utils/validators';
import { validate } from '../utils/validation';
import type { BaseClient } from './BaseClient';
import type { SessionManager } from '../auth/SessionManager';
import { SDKLogger } from '../utils/logger';
import { z } from 'zod';

const logger = SDKLogger.child('MetadataAPI');

/**
 * Cache entry with ETag and expiration
 */
interface CacheEntry<T> {
  data: T;
  etag?: string;
  cachedAt: number;
  ttl: number; // milliseconds
}

/**
 * Metadata cache for bulk JSON responses
 */
class MetadataCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, data: T, etag?: string, ttl = 3600000): void {
    this.cache.set(key, {
      data,
      etag,
      cachedAt: Date.now(),
      ttl,
    });
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  getETag(key: string): string | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.etag;
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if expired
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }
}

export class MetadataAPI {
  private httpClient: BaseClient;
  private sessionManager: SessionManager;
  private cache: MetadataCache;

  constructor(httpClient: BaseClient, sessionManager: SessionManager, _debug = false) {
    this.httpClient = httpClient;
    this.sessionManager = sessionManager;
    this.cache = new MetadataCache();
  }

  /**
   * Get the manifest with catalog information
   * URL: /metadata/manifest.json
   * Cache: 1 hour TTL, revalidate with ETag
   * Size: ~5.9 KB
   *
   * @returns Manifest containing catalog stats and album summaries
   */
  async getManifest(): Promise<Manifest> {
    const cdn = this.getCDNInfo();
    const url = this.joinUrl(cdn.base_url, cdn.metadata_path, 'manifest.json');
    const cacheKey = 'manifest';

    logger.debug('Fetching manifest', { url });

    // Check cache first
    const cached = this.cache.get<Manifest>(cacheKey);
    if (cached) {
      logger.debug('Returning cached manifest');
      return cached;
    }

    try {
      const etag = this.cache.getETag(cacheKey);
      const headers: Record<string, string> = {};
      if (etag) {
        headers['If-None-Match'] = etag;
      }

      const data = await this.httpClient.get(url, { headers });
      const manifest = validate(ManifestSchema, data, 'Manifest');

      // Cache with ETag if available
      // Note: ETag would come from response headers, but our BaseClient doesn't expose them yet
      this.cache.set(cacheKey, manifest, undefined, 3600000); // 1 hour

      return manifest;
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof NetworkError) {
        throw error;
      }
      // Log the Zod error for debugging
      logger.error('Manifest validation failed', error);
      throw new NetworkError('Failed to fetch manifest', error);
    }
  }

  /**
   * Get complete albums catalog
   * URL: /metadata/albums.json
   * Cache: 1 hour TTL
   * Size: ~18 KB
   *
   * @returns Array of all albums
   */
  async getAllAlbums(): Promise<Album[]> {
    const cdn = this.getCDNInfo();
    const url = this.joinUrl(cdn.base_url, cdn.metadata_path, 'albums.json');
    const cacheKey = 'albums';

    logger.debug('Fetching all albums', { url });

    // Check cache first
    const cached = this.cache.get<Album[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached albums', { count: cached.length });
      return cached;
    }

    try {
      const data = await this.httpClient.get(url);
      const albums = z.array(AlbumSchema).parse(data);

      // Cache for 1 hour
      this.cache.set(cacheKey, albums, undefined, 3600000);

      logger.debug('Fetched albums', { count: albums.length });

      return albums;
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof NetworkError) {
        throw error;
      }
      // Log the Zod error for debugging
      logger.error('Album validation failed', error);
      throw new NetworkError('Failed to fetch albums catalog', error);
    }
  }

  /**
   * Get complete tracks catalog
   * URL: /metadata/tracks.json
   * Cache: 1 hour TTL
   * Size: ~325 KB
   * Recommendation: Fetch once per session and cache client-side (IndexedDB)
   *
   * @returns Array of all tracks (120 tracks)
   */
  async getAllTracks(): Promise<Track[]> {
    const cdn = this.getCDNInfo();
    const url = this.joinUrl(cdn.base_url, cdn.metadata_path, 'tracks.json');
    const cacheKey = 'tracks';

    logger.debug('Fetching all tracks', { url });

    // Check cache first
    const cached = this.cache.get<Track[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached tracks', { count: cached.length });
      return cached;
    }

    try {
      const data = await this.httpClient.get(url);
      const tracks = z.array(TrackSchema).parse(data);

      // Cache for 1 hour
      this.cache.set(cacheKey, tracks, undefined, 3600000);

      logger.debug('Fetched tracks', { count: tracks.length });

      return tracks;
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof NetworkError) {
        throw error;
      }
      // Log the Zod error for debugging
      logger.error('Tracks validation failed', error);
      throw new NetworkError('Failed to fetch tracks catalog', error);
    }
  }

  /**
   * Get complete tracker modules catalog
   * URL: /metadata/tracker.json
   * Cache: 1 hour TTL
   * Size: ~334 KB
   *
   * @returns Array of all tracker modules (215 tracker modules)
   */
  async getAllTrackers(): Promise<TrackerModule[]> {
    const cdn = this.getCDNInfo();
    const url = this.joinUrl(cdn.base_url, cdn.metadata_path, 'tracker.json');
    const cacheKey = 'trackers';

    logger.debug('Fetching all trackers', { url });

    // Check cache first
    const cached = this.cache.get<TrackerModule[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached trackers', { count: cached.length });
      return cached;
    }

    try {
      const data = await this.httpClient.get(url);
      const trackers = z.array(TrackerModuleSchema).parse(data);

      // Cache for 1 hour
      this.cache.set(cacheKey, trackers, undefined, 3600000);

      logger.debug('Fetched trackers', { count: trackers.length });

      return trackers;
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof NetworkError) {
        throw error;
      }
      // Log the Zod error for debugging
      logger.error('Tracker validation failed', error);
      throw new NetworkError('Failed to fetch trackers catalog', error);
    }
  }

  /**
   * Get unreleased tracker modules catalog
   * URL: /metadata/unreleased.json
   * Cache: 1 hour TTL
   * Size: ~76 KB
   *
   * @returns Array of unreleased tracker modules (95 tracker modules)
   */
  async getUnreleasedTrackers(): Promise<TrackerModule[]> {
    const cdn = this.getCDNInfo();
    const url = this.joinUrl(cdn.base_url, cdn.metadata_path, 'unreleased.json');
    const cacheKey = 'unreleased';

    logger.debug('Fetching unreleased trackers', { url });

    // Check cache first
    const cached = this.cache.get<TrackerModule[]>(cacheKey);
    if (cached) {
      logger.debug('Returning cached unreleased trackers', { count: cached.length });
      return cached;
    }

    try {
      const data = await this.httpClient.get(url);
      const trackers = z.array(TrackerModuleSchema).parse(data);

      // Cache for 1 hour
      this.cache.set(cacheKey, trackers, undefined, 3600000);

      logger.debug('Fetched unreleased trackers', { count: trackers.length });

      return trackers;
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof NetworkError) {
        throw error;
      }
      // Log the Zod error for debugging
      logger.error('Unreleased tracker validation failed', error);
      throw new NetworkError('Failed to fetch unreleased trackers catalog', error);
    }
  }

  /**
   * Get detailed album information by ID (client-side filtering)
   *
   * @param albumId - Album ID
   * @returns Album details with tracks
   * @throws NotFoundError if album not found
   */
  async getAlbum(albumId: string): Promise<Album> {
    logger.debug('Getting album', { albumId });

    const albums = await this.getAllAlbums();
    const album = albums.find((a) => a.album_id === albumId);

    if (!album) {
      throw new NotFoundError(`Album not found: ${albumId}`, { albumId });
    }

    return album;
  }

  /**
   * Get multiple albums by IDs (client-side filtering)
   *
   * @param albumIds - Array of album IDs
   * @returns Array of albums (skips albums that don't exist)
   */
  async getAlbums(albumIds: string[]): Promise<Album[]> {
    logger.debug('Getting multiple albums', { count: albumIds.length });

    const allAlbums = await this.getAllAlbums();
    const albumIdSet = new Set(albumIds);

    return allAlbums.filter((album) => albumIdSet.has(album.album_id));
  }

  /**
   * Get detailed track information (client-side filtering)
   *
   * @param trackId - Track ID
   * @returns Track details
   * @throws NotFoundError if track not found
   */
  async getTrack(trackId: string): Promise<Track> {
    logger.debug('Getting track', { trackId });

    const tracks = await this.getAllTracks();
    const track = tracks.find((t) => t.track_id === trackId);

    if (!track) {
      throw new NotFoundError(`Track not found: ${trackId}`, { trackId });
    }

    return track;
  }

  /**
   * Get multiple tracks by IDs (client-side filtering)
   *
   * @param trackIds - Array of track IDs
   * @returns Array of tracks (skips tracks that don't exist)
   */
  async getTracks(trackIds: string[]): Promise<Track[]> {
    logger.debug('Getting multiple tracks', { count: trackIds.length });

    const allTracks = await this.getAllTracks();
    const trackIdSet = new Set(trackIds);

    return allTracks.filter((track) => trackIdSet.has(track.track_id));
  }

  /**
   * Get all tracks from an album (client-side filtering)
   *
   * @param albumId - Album ID
   * @returns Array of tracks in the album
   */
  async getAlbumTracks(albumId: string): Promise<Track[]> {
    logger.debug('Getting tracks for album', { albumId });

    const allTracks = await this.getAllTracks();
    return allTracks.filter((track) => track.album_id === albumId);
  }

  /**
   * Get tracker module information (client-side filtering)
   *
   * @param trackerId - Tracker ID
   * @returns Tracker module details
   * @throws NotFoundError if tracker not found
   */
  async getTracker(trackerId: string): Promise<TrackerModule> {
    logger.debug('Getting tracker', { trackerId });

    const trackers = await this.getAllTrackers();
    const tracker = trackers.find((t) => t.tracker_id === trackerId);

    if (!tracker) {
      throw new NotFoundError(`Tracker not found: ${trackerId}`, { trackerId });
    }

    return tracker;
  }

  /**
   * Get multiple tracker modules by IDs (client-side filtering)
   *
   * @param trackerIds - Array of tracker IDs
   * @returns Array of tracker modules (skips trackers that don't exist)
   */
  async getTrackers(trackerIds: string[]): Promise<TrackerModule[]> {
    logger.debug('Getting multiple trackers', { count: trackerIds.length });

    const allTrackers = await this.getAllTrackers();
    const trackerIdSet = new Set(trackerIds);

    return allTrackers.filter((tracker) => trackerIdSet.has(tracker.tracker_id));
  }

  /**
   * Get all tracker modules linked to a track (client-side filtering)
   *
   * @param trackId - Track ID
   * @returns Array of linked tracker modules
   */
  async getTrackTrackers(trackId: string): Promise<TrackerModule[]> {
    const track = await this.getTrack(trackId);

    if (!track.linked_tracker || track.linked_tracker.length === 0) {
      return [];
    }

    logger.debug('Getting trackers for track', {
      trackId,
      count: track.linked_tracker.length,
    });

    const trackerIds = track.linked_tracker.map((t) => t.tracker_id);
    return this.getTrackers(trackerIds);
  }

  /**
   * Clear the metadata cache
   */
  clearCache(): void {
    logger.debug('Clearing metadata cache');
    this.cache.clear();
  }

  /**
   * Get CDN information from session
   *
   * @throws AuthenticationError if not authenticated
   */
  private getCDNInfo(): CdnInfo {
    const sessionInfo = this.sessionManager.getSessionInfo();
    if (!sessionInfo) {
      throw new AuthenticationError('Not authenticated. Call authenticate() first.');
    }
    return sessionInfo.cdn;
  }

  /**
   * Join URL parts while handling leading/trailing slashes correctly
   * Prevents double slashes in URLs
   *
   * @param base - Base URL (e.g., "https://cdn.example.com")
   * @param parts - URL parts to join (e.g., "/metadata", "albums.json")
   * @returns Properly joined URL without double slashes
   *
   * @example
   * joinUrl("https://cdn.example.com", "/metadata", "albums.json")
   * // Returns: "https://cdn.example.com/metadata/albums.json"
   */
  private joinUrl(base: string, ...parts: string[]): string {
    // Remove trailing slash from base
    let url = base.replace(/\/+$/, '');

    // Add each part, ensuring single slashes between them
    for (const part of parts) {
      if (part) {
        // Remove leading and trailing slashes from part
        const cleanPart = part.replace(/^\/+/, '').replace(/\/+$/, '');
        if (cleanPart) {
          url += `/${cleanPart}`;
        }
      }
    }

    return url;
  }
}
