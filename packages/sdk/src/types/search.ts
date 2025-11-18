/**
 * Search types and interfaces
 */

import type { Album, Track, TrackerModule } from './index';

/**
 * Search entity type
 */
export type SearchableEntity = 'album' | 'track' | 'tracker' | 'all';

/**
 * Search filters
 */
export interface SearchFilters {
  /** Filter by album ID */
  albumId?: string;
  /** Filter by artist name */
  artist?: string;
  /** Filter by genre */
  genre?: string;
  /** Filter by year range */
  yearRange?: {
    min?: number;
    max?: number;
  };
  /** Filter by duration range (in seconds) */
  durationRange?: {
    min?: number;
    max?: number;
  };
  /** Filter by entity type */
  entityType?: SearchableEntity;
  /** Include unreleased content */
  includeUnreleased?: boolean;
}

/**
 * Search options
 */
export interface SearchOptions {
  /** Search query string */
  query: string;
  /** Filters to apply */
  filters?: SearchFilters;
  /** Maximum number of results per category */
  limit?: number;
  /** Minimum relevance score (0-1) */
  minScore?: number;
  /** Enable fuzzy matching */
  fuzzy?: boolean;
  /** Fields to search in */
  searchFields?: string[];
}

/**
 * Search result item
 */
export interface SearchResult<T = Album | Track | TrackerModule> {
  /** Result entity */
  item: T;
  /** Entity type */
  type: 'album' | 'track' | 'tracker';
  /** Relevance score (0-1) */
  score: number;
  /** Matched fields */
  matchedFields: string[];
  /** Highlighted snippets */
  highlights?: {
    field: string;
    snippet: string;
  }[];
}

/**
 * Search results by category
 */
export interface SearchResults {
  /** Album results */
  albums: SearchResult<Album>[];
  /** Track results */
  tracks: SearchResult<Track>[];
  /** Tracker module results */
  trackers: SearchResult<TrackerModule>[];
  /** Total number of results */
  total: number;
  /** Search query used */
  query: string;
  /** Filters applied */
  filters?: SearchFilters;
  /** Search execution time in ms */
  executionTime: number;
}

/**
 * Search index configuration
 */
export interface SearchIndexConfig {
  /** Enable fuzzy matching */
  fuzzy?: boolean;
  /** Fuzzy matching distance */
  fuzzyDistance?: number;
  /** Fields to index for albums */
  albumFields?: string[];
  /** Fields to index for tracks */
  trackFields?: string[];
  /** Fields to index for trackers */
  trackerFields?: string[];
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Searchable album fields
 */
export const ALBUM_SEARCH_FIELDS = [
  'album_id',
  'title',
  'artist',
  'year',
  'genre',
  'description',
] as const;

/**
 * Searchable track fields
 */
export const TRACK_SEARCH_FIELDS = [
  'track_id',
  'title',
  'artist',
  'album_title',
  'genre',
  'comment',
  'lyrics',
] as const;

/**
 * Searchable tracker fields
 */
export const TRACKER_SEARCH_FIELDS = [
  'tracker_id',
  'title',
  'artist',
  'album_title',
  'comment',
] as const;
