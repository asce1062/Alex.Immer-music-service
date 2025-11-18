/**
 * Main MusicServiceClient class
 *
 * Central entry point for the SDK providing access to all features:
 * - Authentication & session management
 * - Metadata API (manifest, albums, tracks, trackers)
 * - Playback controller
 * - Downloads with rate limiting
 * - Client-side search
 * - Lyrics extraction
 * - Cache management
 */

import type {
  MusicServiceConfig,
  Manifest,
  SessionInfo,
  SessionState,
  Album,
  Track,
  TrackerModule,
  SearchOptions,
  SearchResults,
  SearchFilters,
  SearchResult,
  PlaybackConfig,
  DownloadConfig,
  LyricsConfig,
  ParsedLyrics,
  TrackerPlaybackConfig,
  CacheConfig,
} from './types';
import { MusicServiceConfigSchema } from './utils/validators';
import { validate } from './utils/validation';
import { SessionManager } from './auth/SessionManager';
import { BaseClient } from './api/BaseClient';
import { MetadataAPI } from './api/MetadataAPI';
import { SearchManager } from './search/SearchManager';
import { PlaybackManager } from './playback/PlaybackManager';
import { DownloadManager } from './download/DownloadManager';
import { LyricsManager } from './lyrics/LyricsManager';
import { TrackerPlayer } from './playback/TrackerPlayer';
import { CacheManager } from './cache/CacheManager';
import { SDKLogger } from './utils/logger';
import type { SessionEvents } from './auth';

export class MusicServiceClient {
  private config: Required<MusicServiceConfig>;
  private sessionManager: SessionManager;
  private httpClient: BaseClient;
  private metadataAPI: MetadataAPI;
  private searchManager: SearchManager;
  private searchIndexBuilt = false;

  /**
   * Playback manager for audio playback control
   * Access directly for full playback API
   *
   * @example
   * ```typescript
   * // Play a track
   * await client.playback.play(track)
   *
   * // Set up queue
   * client.playback.setQueue([track1, track2, track3])
   *
   * // Control playback
   * client.playback.pause()
   * client.playback.next()
   * client.playback.setVolume(0.8)
   *
   * // Subscribe to events
   * client.playback.on('play', (track) => {
   *   console.log('Playing:', track.title)
   * })
   * ```
   */
  public readonly playback: PlaybackManager;

  /**
   * Download manager for downloading tracks, albums, and trackers
   * Access directly for full download API
   *
   * @example
   * ```typescript
   * // Download a track
   * const downloadItem = await client.downloads.downloadTrack(track, 'high')
   *
   * // Download an entire album
   * const album = await client.getAlbum('album-id')
   * const tracks = await client.getAlbumTracks('album-id')
   * await client.downloads.downloadAlbum(album, tracks)
   *
   * // Monitor download progress
   * client.downloads.on('progress', (item, progress) => {
   *   console.log(`${progress.percent}% - ${progress.currentFile}`)
   * })
   *
   * // Check download queue
   * const queue = client.downloads.getQueue()
   * const stats = client.downloads.getStats()
   * ```
   */
  public readonly downloads: DownloadManager;

  /**
   * Lyrics manager for lyrics extraction and synchronization
   * Access directly for full lyrics API
   *
   * @example
   * ```typescript
   * // Get lyrics from track comment
   * const lyrics = client.lyrics.getLyrics(track)
   *
   * // Set custom lyrics
   * const lrcContent = '[00:12.00]First line\n[00:15.50]Second line'
   * client.lyrics.setLyrics(track.track_id, lrcContent)
   *
   * // Synchronized lyrics with playback
   * client.lyrics.setCurrentTrack(track)
   * client.lyrics.updatePosition(12000) // 12 seconds
   * const state = client.lyrics.getCurrentState()
   *
   * // Listen to line changes
   * client.lyrics.on('lineactive', (line, index) => {
   *   console.log(`Now: ${line.text}`)
   * })
   *
   * // Search lyrics
   * const results = client.lyrics.searchLyrics('love', tracks)
   * ```
   */
  public readonly lyrics: LyricsManager;

  /**
   * Tracker player for playing tracker modules (MOD, XM, S3M, IT, etc.)
   * Access directly for full tracker playback API
   *
   * @example
   * ```typescript
   * // Play a tracker module
   * const tracker = await client.getTracker('tracker-id')
   * await client.tracker.play(tracker)
   *
   * // Control playback
   * client.tracker.pause()
   * client.tracker.resume()
   * client.tracker.stop()
   * client.tracker.seek(30) // Seek to 30 seconds
   *
   * // Set volume and repeat
   * client.tracker.setVolume(0.8)
   * client.tracker.setRepeat(true)
   *
   * // Listen to events
   * client.tracker.on('patternchange', (pattern, row) => {
   *   console.log(`Pattern ${pattern}, Row ${row}`)
   * })
   *
   * // Get metadata
   * const state = client.tracker.getState()
   * console.log(`Format: ${state.metadata?.type}`)
   * console.log(`Channels: ${state.metadata?.channels}`)
   * ```
   */
  public readonly tracker: TrackerPlayer;

  /**
   * Cache manager for managing application cache
   * Access directly for full cache API
   *
   * @example
   * ```typescript
   * // Get cache stats
   * const stats = client.cache.getStats()
   * console.log(`Cache size: ${stats.totalSize} bytes`)
   * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`)
   *
   * // Get/set cache entries
   * await client.cache.set('my-key', { data: 'value' }, { ttl: 3600000 })
   * const entry = await client.cache.get('my-key')
   *
   * // Clear cache
   * await client.cache.clear()
   *
   * // Monitor storage quota
   * const quota = await client.cache.getStorageQuota()
   * console.log(`Used: ${quota.usage} / ${quota.quota}`)
   * ```
   */
  public readonly cache: CacheManager;
  public readonly sdkVersion = '1.0.0-beta.1';

  constructor(
    config: MusicServiceConfig,
    playbackConfig?: PlaybackConfig,
    downloadConfig?: DownloadConfig,
    lyricsConfig?: LyricsConfig,
    trackerConfig?: TrackerPlaybackConfig,
    cacheConfig?: CacheConfig
  ) {
    // Validate configuration
    const validatedConfig = validate(MusicServiceConfigSchema, config, 'MusicServiceConfig');

    // Set defaults
    this.config = {
      clientId: validatedConfig.clientId,
      clientSecret: validatedConfig.clientSecret,
      apiEndpoint: validatedConfig.apiEndpoint ?? '',
      cacheStrategy: validatedConfig.cacheStrategy ?? 'stale-while-revalidate',
      debug: validatedConfig.debug ?? false,
    };

    // Configure global SDK logger
    SDKLogger.configure({
      enabled: this.config.debug,
      level: this.config.debug ? 'debug' : 'info',
    });

    // Initialize core components
    this.sessionManager = new SessionManager(this.config);
    this.httpClient = new BaseClient(this.config, this.sessionManager);
    this.metadataAPI = new MetadataAPI(this.httpClient, this.sessionManager, this.config.debug);
    this.searchManager = new SearchManager({ debug: this.config.debug });
    this.playback = new PlaybackManager({
      debug: this.config.debug,
      ...playbackConfig,
    });
    this.downloads = new DownloadManager({
      debug: this.config.debug,
      ...downloadConfig,
    });
    this.lyrics = new LyricsManager({
      debug: this.config.debug,
      ...lyricsConfig,
    });
    this.tracker = new TrackerPlayer({
      debug: this.config.debug,
      ...trackerConfig,
    });
    this.cache = new CacheManager({
      name: 'music-service-cache',
      storageType: 'indexeddb',
      defaultTTL: 3600000, // 1 hour
      maxSize: 100 * 1024 * 1024, // 100MB
      debug: this.config.debug,
      version: 1,
      ...cacheConfig,
    });

    SDKLogger.info('Initialized', {
      clientId: this.config.clientId,
      cacheStrategy: this.config.cacheStrategy,
    });
  }

  // ============================================================================
  // Authentication & Session Management
  // ============================================================================

  /**
   * Authenticate with the music service API
   * Issues CloudFront signed cookies valid for 2 hours
   *
   * @returns Session information with expiration and CDN details
   */
  async authenticate(): Promise<SessionInfo> {
    return this.sessionManager.authenticate();
  }

  /**
   * Refresh the current session
   *
   * @returns Updated session information
   */
  async refreshSession(): Promise<SessionInfo> {
    return this.sessionManager.refresh();
  }

  /**
   * Invalidate the current session and clear cookies
   */
  async logout(): Promise<void> {
    return Promise.resolve(this.sessionManager.invalidate());
  }

  /**
   * Get current session state
   *
   * @returns Session state information
   */
  getSessionState(): SessionState {
    return this.sessionManager.getSessionState();
  }

  /**
   * Get current session info
   */
  getSessionInfo(): SessionInfo | null {
    return this.sessionManager.getSessionInfo();
  }

  /**
   * Check if session is valid
   */
  isAuthenticated(): boolean {
    return this.sessionManager.isSessionValid();
  }

  /**
   * Subscribe to session events
   *
   * @param event - Event name
   * @param listener - Event listener callback
   */
  onSessionEvent<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): void {
    this.sessionManager.on(event, listener);
  }

  /**
   * Unsubscribe from session events
   *
   * @param event - Event name
   * @param listener - Event listener callback
   */
  offSessionEvent<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): void {
    this.sessionManager.off(event, listener);
  }

  // ============================================================================
  // Metadata API
  // ============================================================================

  /**
   * Get the manifest with catalog information
   *
   * @returns Manifest containing catalog stats and album summaries
   */
  async getManifest(): Promise<Manifest> {
    return this.metadataAPI.getManifest();
  }

  /**
   * Get detailed album information by ID
   *
   * @param albumId - Album ID
   * @returns Album details with tracks
   */
  async getAlbum(albumId: string): Promise<Album> {
    return this.metadataAPI.getAlbum(albumId);
  }

  /**
   * Get multiple albums by IDs
   *
   * @param albumIds - Array of album IDs
   * @returns Array of albums (skips albums that don't exist)
   */
  async getAlbums(albumIds: string[]): Promise<Album[]> {
    return this.metadataAPI.getAlbums(albumIds);
  }

  /**
   * Get all albums from the catalog
   * Fetches bulk albums.json (~18 KB) from CDN
   * Cached for 1 hour
   *
   * @returns Array of all albums
   */
  async getAllAlbums(): Promise<Album[]> {
    return this.metadataAPI.getAllAlbums();
  }

  /**
   * Get detailed track information
   *
   * @param trackId - Track ID
   * @returns Track details
   */
  async getTrack(trackId: string): Promise<Track> {
    return this.metadataAPI.getTrack(trackId);
  }

  /**
   * Get multiple tracks by IDs
   *
   * @param trackIds - Array of track IDs
   * @returns Array of tracks (skips tracks that don't exist)
   */
  async getTracks(trackIds: string[]): Promise<Track[]> {
    return this.metadataAPI.getTracks(trackIds);
  }

  /**
   * Get all tracks from the catalog
   * Fetches bulk tracks.json (~325 KB) from CDN
   * Cached for 1 hour
   * Recommendation: Fetch once per session and cache client-side
   *
   * @returns Array of all tracks (120 tracks)
   */
  async getAllTracks(): Promise<Track[]> {
    return this.metadataAPI.getAllTracks();
  }

  /**
   * Get all tracks from an album
   *
   * @param albumId - Album ID
   * @returns Array of tracks in the album
   */
  async getAlbumTracks(albumId: string): Promise<Track[]> {
    return this.metadataAPI.getAlbumTracks(albumId);
  }

  /**
   * Get tracker module information
   *
   * @param trackerId - Tracker ID
   * @returns Tracker module details
   */
  async getTracker(trackerId: string): Promise<TrackerModule> {
    return this.metadataAPI.getTracker(trackerId);
  }

  /**
   * Get multiple tracker modules by IDs
   *
   * @param trackerIds - Array of tracker IDs
   * @returns Array of tracker modules (skips trackers that don't exist)
   */
  async getTrackers(trackerIds: string[]): Promise<TrackerModule[]> {
    return this.metadataAPI.getTrackers(trackerIds);
  }

  /**
   * Get all tracker modules from the catalog
   * Fetches bulk tracker.json (~334 KB) from CDN
   * Cached for 1 hour
   *
   * @returns Array of all tracker modules (215 tracker modules)
   */
  async getAllTrackers(): Promise<TrackerModule[]> {
    return this.metadataAPI.getAllTrackers();
  }

  /**
   * Get unreleased tracker modules
   * Fetches bulk unreleased.json (~76 KB) from CDN
   * Cached for 1 hour
   *
   * @returns Array of unreleased tracker modules (95 tracker modules)
   */
  async getUnreleasedTrackers(): Promise<TrackerModule[]> {
    return this.metadataAPI.getUnreleasedTrackers();
  }

  /**
   * Get all tracker modules linked to a track
   *
   * @param trackId - Track ID
   * @returns Array of linked tracker modules
   */
  async getTrackTrackers(trackId: string): Promise<TrackerModule[]> {
    return this.metadataAPI.getTrackTrackers(trackId);
  }

  /**
   * Clear metadata cache
   * Clears in-memory cache for manifest, albums, tracks, and trackers
   */
  clearMetadataCache(): void {
    return this.metadataAPI.clearCache();
  }

  // ============================================================================
  // Search
  // ============================================================================

  /**
   * Build search index from metadata
   * Automatically called on first search, but can be called manually to pre-build
   * Fetches all albums, tracks, and trackers to build searchable index
   *
   * @param includeUnreleased - Include unreleased trackers in search index
   */
  async buildSearchIndex(includeUnreleased = false): Promise<void> {
    SDKLogger.debug('Building search index...');

    const [albums, tracks, trackers, unreleased] = await Promise.all([
      this.getAllAlbums(),
      this.getAllTracks(),
      this.getAllTrackers(),
      includeUnreleased ? this.getUnreleasedTrackers() : Promise.resolve([]),
    ]);

    const allTrackers = includeUnreleased ? [...trackers, ...unreleased] : trackers;

    this.searchManager.buildIndex(albums, tracks, allTrackers);
    this.searchIndexBuilt = true;

    const stats = this.searchManager.getStats();
    SDKLogger.debug('Search index built', stats);
  }

  /**
   * Search across all entities (albums, tracks, trackers)
   * Automatically builds search index on first search
   *
   * @param options - Search options including query and filters
   * @returns Search results by category
   *
   * @example
   * ```typescript
   * const results = await client.search({
   *   query: 'jazz night',
   *   filters: {
   *     yearRange: { min: 2000, max: 2020 }
   *   },
   *   limit: 10
   * })
   * ```
   */
  async search(options: SearchOptions): Promise<SearchResults> {
    // Auto-build index on first search
    if (!this.searchIndexBuilt) {
      await this.buildSearchIndex();
    }

    return this.searchManager.search(options);
  }

  /**
   * Search only albums
   *
   * @param query - Search query
   * @param filters - Optional filters
   * @param limit - Maximum number of results
   * @returns Array of album search results
   */
  async searchAlbums(
    query: string,
    filters?: SearchFilters,
    limit = 10
  ): Promise<SearchResult<Album>[]> {
    if (!this.searchIndexBuilt) {
      await this.buildSearchIndex();
    }

    return this.searchManager.searchAlbums(query, filters, limit);
  }

  /**
   * Search only tracks
   *
   * @param query - Search query
   * @param filters - Optional filters
   * @param limit - Maximum number of results
   * @returns Array of track search results
   */
  async searchTracks(
    query: string,
    filters?: SearchFilters,
    limit = 10
  ): Promise<SearchResult<Track>[]> {
    if (!this.searchIndexBuilt) {
      await this.buildSearchIndex();
    }

    return this.searchManager.searchTracks(query, filters, limit);
  }

  /**
   * Search only tracker modules
   *
   * @param query - Search query
   * @param filters - Optional filters
   * @param limit - Maximum number of results
   * @returns Array of tracker search results
   */
  async searchTrackers(
    query: string,
    filters?: SearchFilters,
    limit = 10
  ): Promise<SearchResult<TrackerModule>[]> {
    if (!this.searchIndexBuilt) {
      await this.buildSearchIndex();
    }

    return this.searchManager.searchTrackers(query, filters, limit);
  }

  /**
   * Get search index statistics
   *
   * @returns Search index stats
   */
  getSearchStats(): {
    albums: number;
    tracks: number;
    trackers: number;
    total: number;
    indexBuilt: boolean;
  } {
    return this.searchManager.getStats();
  }

  /**
   * Clear search index
   * Frees memory used by search index
   */
  clearSearchIndex(): void {
    this.searchManager.clear();
    this.searchIndexBuilt = false;
  }

  // ============================================================================
  // SDK Info
  // ============================================================================

  /**
   * Get SDK version
   */
  get version(): string {
    return this.sdkVersion;
  }

  // ============================================================================
  // Lyrics
  // ============================================================================

  /**
   * Get lyrics for a track
   * Auto-extracts from comment field if enabled
   *
   * @param track - Track to get lyrics for
   * @returns Parsed lyrics or null if not available
   */
  getLyrics(track: Track): ParsedLyrics | null {
    return this.lyrics.getLyrics(track);
  }

  /**
   * Set custom lyrics for a track
   *
   * @param trackId - Track ID
   * @param content - Lyrics content (LRC or plain text)
   * @param source - Lyrics source
   * @returns Parsed lyrics or null if parsing failed
   */
  setLyrics(trackId: string, content: string, source?: 'external' | 'manual'): ParsedLyrics | null {
    return this.lyrics.setLyrics(trackId, content, source);
  }

  /**
   * Parse lyrics content
   *
   * @param content - Raw lyrics content
   * @param source - Lyrics source
   * @returns Parsed lyrics or null if parsing failed
   */
  parseLyrics(content: string, source?: 'comment' | 'external'): ParsedLyrics | null {
    return this.lyrics.parseLyrics(content, source);
  }

  // ============================================================================
  // SDK Info
  // ============================================================================

  /**
   * Clean up resources
   */
  // ============================================================================
  // Cache Management
  // ============================================================================

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
    this.metadataAPI.clearCache();
  }

  /**
   * Get storage quota information
   */
  async getStorageQuota() {
    return this.cache.getQuota();
  }

  // ============================================================================
  // SDK Info
  // ============================================================================

  /**
   * Clean up resources
   */
  destroy(): void {
    this.sessionManager.destroy();
    this.playback.destroy();
    this.downloads.destroy();
    this.lyrics.destroy();
    this.tracker.destroy();
  }
}
