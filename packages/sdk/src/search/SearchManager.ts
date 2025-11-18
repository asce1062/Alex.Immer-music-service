/**
 * SearchManager - Client-side search implementation
 *
 * Provides fast, fuzzy search across albums, tracks, and tracker modules
 * with filtering, ranking, and highlighting capabilities.
 */

import type {
  Album,
  Track,
  TrackerModule,
  SearchOptions,
  SearchFilters,
  SearchResult,
  SearchResults,
  SearchIndexConfig,
} from '../types';
import { ALBUM_SEARCH_FIELDS, TRACK_SEARCH_FIELDS, TRACKER_SEARCH_FIELDS } from '../types/search';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('SearchManager');

/**
 * Searchable document with indexed fields
 */
interface SearchDocument<T> {
  id: string;
  type: 'album' | 'track' | 'tracker';
  item: T;
  fields: Map<string, string>;
  tokens: Map<string, Set<string>>;
}

/**
 * Search match with score
 */
interface SearchMatch {
  documentId: string;
  score: number;
  matchedFields: string[];
}

/**
 * SearchManager configuration
 */
export interface SearchManagerConfig extends SearchIndexConfig {
  /** Metadata sources */
  albums?: Album[];
  tracks?: Track[];
  trackers?: TrackerModule[];
}

export class SearchManager {
  private config: Required<SearchIndexConfig>;
  private albums: SearchDocument<Album>[] = [];
  private tracks: SearchDocument<Track>[] = [];
  private trackers: SearchDocument<TrackerModule>[] = [];
  private indexBuilt = false;

  constructor(config?: SearchIndexConfig) {
    this.config = {
      fuzzy: config?.fuzzy ?? true,
      fuzzyDistance: config?.fuzzyDistance ?? 2,
      albumFields: config?.albumFields ?? [...ALBUM_SEARCH_FIELDS],
      trackFields: config?.trackFields ?? [...TRACK_SEARCH_FIELDS],
      trackerFields: config?.trackerFields ?? [...TRACKER_SEARCH_FIELDS],
      debug: config?.debug ?? false,
    };
  }

  /**
   * Build search index from metadata
   */
  buildIndex(albums: Album[], tracks: Track[], trackers: TrackerModule[]): void {
    const startTime = performance.now();

    this.albums = albums.map((album) => this.indexAlbum(album));
    this.tracks = tracks.map((track) => this.indexTrack(track));
    this.trackers = trackers.map((tracker) => this.indexTracker(tracker));

    this.indexBuilt = true;

    const endTime = performance.now();
    logger.debug('Index built', {
      time: `${(endTime - startTime).toFixed(2)}ms`,
      albums: this.albums.length,
      tracks: this.tracks.length,
      trackers: this.trackers.length,
    });
  }

  /**
   * Search across all entities
   */
  search(options: SearchOptions): SearchResults {
    if (!this.indexBuilt) {
      throw new Error('Search index not built. Call buildIndex() first.');
    }

    const startTime = performance.now();

    const query = this.normalizeQuery(options.query);
    const queryTokens = this.tokenize(query);
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0.1;
    const fuzzy = options.fuzzy ?? this.config.fuzzy;

    logger.debug('Searching', {
      query: options.query,
      tokens: queryTokens.join(', '),
    });

    // Search each entity type
    const albumMatches = this.searchDocuments(this.albums, queryTokens, fuzzy, minScore);
    const trackMatches = this.searchDocuments(this.tracks, queryTokens, fuzzy, minScore);
    const trackerMatches = this.searchDocuments(this.trackers, queryTokens, fuzzy, minScore);

    // Apply filters
    const filteredAlbums = this.applyFilters(albumMatches, this.albums, options.filters);
    const filteredTracks = this.applyFilters(trackMatches, this.tracks, options.filters);
    const filteredTrackers = this.applyFilters(trackerMatches, this.trackers, options.filters);

    // Convert to search results
    const albumResults = this.toSearchResults(filteredAlbums, this.albums, 'album', limit);
    const trackResults = this.toSearchResults(filteredTracks, this.tracks, 'track', limit);
    const trackerResults = this.toSearchResults(filteredTrackers, this.trackers, 'tracker', limit);

    const endTime = performance.now();
    const executionTime = Number((endTime - startTime).toFixed(2));

    logger.debug('Search complete', {
      results: albumResults.length + trackResults.length + trackerResults.length,
      time: `${executionTime}ms`,
    });

    return {
      albums: albumResults,
      tracks: trackResults,
      trackers: trackerResults,
      total: albumResults.length + trackResults.length + trackerResults.length,
      query: options.query,
      filters: options.filters,
      executionTime,
    };
  }

  /**
   * Search only albums
   */
  searchAlbums(query: string, filters?: SearchFilters, limit = 10): SearchResult<Album>[] {
    const results = this.search({ query, filters, limit });
    return results.albums;
  }

  /**
   * Search only tracks
   */
  searchTracks(query: string, filters?: SearchFilters, limit = 10): SearchResult<Track>[] {
    const results = this.search({ query, filters, limit });
    return results.tracks;
  }

  /**
   * Search only trackers
   */
  searchTrackers(
    query: string,
    filters?: SearchFilters,
    limit = 10
  ): SearchResult<TrackerModule>[] {
    const results = this.search({ query, filters, limit });
    return results.trackers;
  }

  /**
   * Get index statistics
   */
  getStats(): {
    albums: number;
    tracks: number;
    trackers: number;
    total: number;
    indexBuilt: boolean;
  } {
    return {
      albums: this.albums.length,
      tracks: this.tracks.length,
      trackers: this.trackers.length,
      total: this.albums.length + this.tracks.length + this.trackers.length,
      indexBuilt: this.indexBuilt,
    };
  }

  /**
   * Clear search index
   */
  clear(): void {
    this.albums = [];
    this.tracks = [];
    this.trackers = [];
    this.indexBuilt = false;

    logger.debug('Index cleared');
  }

  // ============================================================================
  // Private Methods - Indexing
  // ============================================================================

  private indexAlbum(album: Album): SearchDocument<Album> {
    const fields = new Map<string, string>();
    const tokens = new Map<string, Set<string>>();

    for (const field of this.config.albumFields) {
      const value = this.getFieldValue(album, field);
      if (value) {
        fields.set(field, value);
        tokens.set(field, new Set(this.tokenize(value)));
      }
    }

    return {
      id: album.album_id,
      type: 'album',
      item: album,
      fields,
      tokens,
    };
  }

  private indexTrack(track: Track): SearchDocument<Track> {
    const fields = new Map<string, string>();
    const tokens = new Map<string, Set<string>>();

    for (const field of this.config.trackFields) {
      const value = this.getFieldValue(track, field);
      if (value) {
        fields.set(field, value);
        tokens.set(field, new Set(this.tokenize(value)));
      }
    }

    return {
      id: track.track_id,
      type: 'track',
      item: track,
      fields,
      tokens,
    };
  }

  private indexTracker(tracker: TrackerModule): SearchDocument<TrackerModule> {
    const fields = new Map<string, string>();
    const tokens = new Map<string, Set<string>>();

    for (const field of this.config.trackerFields) {
      const value = this.getFieldValue(tracker, field);
      if (value) {
        fields.set(field, value);
        tokens.set(field, new Set(this.tokenize(value)));
      }
    }

    return {
      id: tracker.tracker_id,
      type: 'tracker',
      item: tracker,
      fields,
      tokens,
    };
  }

  // ============================================================================
  // Private Methods - Searching
  // ============================================================================

  private searchDocuments<T>(
    documents: SearchDocument<T>[],
    queryTokens: string[],
    fuzzy: boolean,
    minScore: number
  ): SearchMatch[] {
    const matches: SearchMatch[] = [];

    for (const doc of documents) {
      const { score, matchedFields } = this.calculateRelevanceScore(doc, queryTokens, fuzzy);

      if (score >= minScore) {
        matches.push({
          documentId: doc.id,
          score,
          matchedFields,
        });
      }
    }

    // Sort by score descending
    return matches.sort((a, b) => b.score - a.score);
  }

  private calculateRelevanceScore<T>(
    doc: SearchDocument<T>,
    queryTokens: string[],
    fuzzy: boolean
  ): { score: number; matchedFields: string[] } {
    let totalScore = 0;
    const matchedFields: string[] = [];

    // Field weights (title is most important)
    const fieldWeights: Record<string, number> = {
      title: 3.0,
      song_name: 3.0,
      artist: 2.5,
      composer: 2.5,
      album: 1.5,
      album_title: 1.5,
      genre: 1.2,
      description: 1.0,
      comment: 1.0,
    };

    for (const [field, tokens] of doc.tokens) {
      let fieldScore = 0;
      let hasMatch = false;

      for (const queryToken of queryTokens) {
        // Exact match
        if (tokens.has(queryToken)) {
          fieldScore += 1.0;
          hasMatch = true;
        } else if (fuzzy) {
          // Fuzzy match
          const fuzzyScore = this.fuzzyMatch(queryToken, Array.from(tokens));
          if (fuzzyScore > 0) {
            fieldScore += fuzzyScore;
            hasMatch = true;
          }
        }
      }

      if (hasMatch) {
        matchedFields.push(field);
        const weight = fieldWeights[field] ?? 1.0;
        totalScore += fieldScore * weight;
      }
    }

    // Normalize score (0-1)
    const maxPossibleScore = queryTokens.length * Math.max(...Object.values(fieldWeights));
    const normalizedScore = maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;

    return { score: normalizedScore, matchedFields };
  }

  private fuzzyMatch(query: string, tokens: string[]): number {
    let bestScore = 0;

    for (const token of tokens) {
      // Check if query is substring
      if (token.includes(query) ?? query.includes(token)) {
        bestScore = Math.max(bestScore, 0.7);
        continue;
      }

      // Levenshtein distance
      const distance = this.levenshteinDistance(query, token);
      const maxLength = Math.max(query.length, token.length);
      const similarity = 1 - distance / maxLength;

      if (distance <= this.config.fuzzyDistance && similarity > 0.5) {
        bestScore = Math.max(bestScore, similarity * 0.6);
      }
    }

    return bestScore;
  }

  // ============================================================================
  // Private Methods - Filtering
  // ============================================================================

  private applyFilters<T>(
    matches: SearchMatch[],
    documents: SearchDocument<T>[],
    filters?: SearchFilters
  ): SearchMatch[] {
    if (!filters) return matches;

    return matches.filter((match) => {
      const doc = documents.find((d) => d.id === match.documentId);
      if (!doc) return false;

      // Album ID filter
      if (filters.albumId) {
        const albumId = this.getFieldValue(doc.item, 'album_id');
        if (albumId !== filters.albumId) return false;
      }

      // Artist filter
      if (filters.artist) {
        const artist =
          this.getFieldValue(doc.item, 'artist') ?? this.getFieldValue(doc.item, 'composer');
        if (!artist?.toLowerCase().includes(filters.artist.toLowerCase())) {
          return false;
        }
      }

      // Genre filter
      if (filters.genre) {
        const genre = this.getFieldValue(doc.item, 'genre');
        if (!genre?.toLowerCase().includes(filters.genre.toLowerCase())) {
          return false;
        }
      }

      // Year range filter
      if (filters.yearRange) {
        const year = this.getFieldValue(doc.item, 'year');
        const yearNum = year ? parseInt(year, 10) : null;
        if (yearNum) {
          if (filters.yearRange.min && yearNum < filters.yearRange.min) return false;
          if (filters.yearRange.max && yearNum > filters.yearRange.max) return false;
        }
      }

      // Duration range filter (tracks only)
      if (filters.durationRange && 'duration_seconds' in (doc.item as object)) {
        const duration = (doc.item as Record<string, unknown>).duration_seconds;
        if (typeof duration === 'number') {
          if (filters.durationRange.min && duration < filters.durationRange.min) return false;
          if (filters.durationRange.max && duration > filters.durationRange.max) return false;
        }
      }

      // Entity type filter
      if (filters.entityType && filters.entityType !== 'all') {
        if (doc.type !== filters.entityType) return false;
      }

      return true;
    });
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private toSearchResults<T>(
    matches: SearchMatch[],
    documents: SearchDocument<T>[],
    type: 'album' | 'track' | 'tracker',
    limit: number
  ): SearchResult<T>[] {
    return matches.slice(0, limit).map((match) => {
      const doc = documents.find((d) => d.id === match.documentId)!;
      return {
        item: doc.item,
        type,
        score: match.score,
        matchedFields: match.matchedFields,
      };
    });
  }

  private getFieldValue(obj: unknown, field: string): string | null {
    const value = (obj as Record<string, unknown>)[field];

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    if (Array.isArray(value)) {
      return value.join(' ');
    }

    return null;
  }

  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim();
  }

  private tokenize(text: string): string[] {
    // Normalize and split into tokens
    const normalized = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace special chars with space
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();

    if (!normalized) return [];

    // Split into words and filter out single chars and common words
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
    ]);

    return normalized.split(' ').filter((token) => token.length > 1 && !stopWords.has(token));
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    const matrix: number[][] = [];

    // Initialize matrix
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1 // deletion
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }
}
