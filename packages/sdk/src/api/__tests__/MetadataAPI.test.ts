/**
 * Tests for MetadataAPI
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MetadataAPI } from '../MetadataAPI';
import { BaseClient } from '../BaseClient';
import { SessionManager } from '../../auth/SessionManager';
import type {
  MusicServiceConfig,
  SessionInfo,
  Manifest,
  Album,
  Track,
  TrackerModule,
} from '../../types';
import { AuthenticationError, NotFoundError } from '../../types/errors';

describe('MetadataAPI', () => {
  let api: MetadataAPI;
  let httpClient: BaseClient;
  let sessionManager: SessionManager;
  let config: Required<MusicServiceConfig>;

  const mockSessionInfo: SessionInfo = {
    status: 'success',
    session: {
      expires_at: new Date(Date.now() + 7200000).toISOString(),
      duration_seconds: 7200,
      created_at: new Date().toISOString(),
    },
    cdn: {
      base_url: 'https://cdn.example.com',
      albums_path: 'albums',
      covers_path: 'covers',
      metadata_path: 'metadata',
      trackers_path: 'trackers',
    },
  };

  const mockManifest: Manifest = {
    schema_version: '1.0',
    content_type: 'metadata',
    generated_at: new Date().toISOString(),
    catalog: {
      released_albums: 10,
      unreleased_collections: 2,
      total_tracks: 100,
      total_tracker_sources: 50,
      total_unlinked_tracker_files: 5,
      total_size_bytes: 1000000000,
      total_duration_seconds: 36000,
    },
    albums: [
      {
        id: 'album1',
        title: 'Test Album',
        released: true,
        year: 2024,
        cover: 'https://cdn.example.com/covers/album1.jpg',
        thumbnail: 'https://cdn.example.com/covers/album1_thumb.jpg',
        url: 'https://cdn.example.com/albums/album1',
        metadata: 'album1.json',
      },
    ],
    cdn: mockSessionInfo.cdn,
    integrity: {
      checksums: {},
    },
  };

  const mockAlbum: Album = {
    album_id: 'album1',
    album: 'Test Album',
    artist: 'Test Artist',
    year: 2024,
    total_tracks: 10,
    released: true,
    duration: '45:30',
    duration_seconds: 2730,
    file_size_bytes: 100000000,
    file_size_human: '100 MB',
    bpm_range: { min: 120, max: 140, avg: 130 },
    genre: 'Electronic',
    tags: ['test', 'electronic'],
    cdn_cover_url: 'https://cdn.example.com/covers/album1.jpg',
    s3_cover_url: 's3://bucket/covers/album1.jpg',
    cdn_thumbnail_url: 'https://cdn.example.com/covers/album1_thumb.jpg',
    s3_thumbnail_url: 's3://bucket/covers/album1_thumb.jpg',
    explicit: false,
    checksum: { algorithm: 'sha256', value: 'abc123' },
    last_modified: new Date().toISOString(),
    tracks: ['album1_01', 'album1_02'],
    cover: 'album1.jpg',
    thumbnail: 'album1_thumb.jpg',
  };

  const mockAlbum2: Album = {
    ...mockAlbum,
    album_id: 'album2',
    album: 'Test Album 2',
  };

  const mockTrack: Track = {
    track_id: 'album1_01',
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    album_id: 'album1',
    track_number: 1,
    duration_seconds: 273,
    duration_human: '4:33',
    bit_rate_kbps: 320,
    file_size_bytes: 10000000,
    file_size: '10 MB',
    format: 'MP3',
    sample_rate: '44.1 kHz',
    channels: 'Stereo',
    genre: 'Electronic',
    year: '2024',
    bpm: 130,
    explicit: false,
    checksum: { algorithm: 'sha256', value: 'def456' },
    content_length: 10000000,
    last_modified: new Date().toISOString(),
    accept_ranges: 'bytes',
    etag: '"abc123"',
    cdn_url: 'https://cdn.example.com/albums/album1/track01.mp3',
    s3_url: 's3://bucket/albums/album1/track01.mp3',
  };

  const mockTrack2: Track = {
    ...mockTrack,
    track_id: 'album1_02',
    title: 'Test Track 2',
    track_number: 2,
  };

  const mockTracker: TrackerModule = {
    tracker_id: 'tracker1',
    title: 'Test Tracker',
    file_name: 'test.mod',
    file_size_bytes: 50000,
    file_size: '50 KB',
    format: 'MOD',
    format_long: 'ProTracker Module',
    created: '2024-01-01',
    composer: 'Test Composer',
    channels: 4,
    patterns: 64,
    instruments: 31,
    checksum: { algorithm: 'sha256', value: 'ghi789' },
    content_length: 50000,
    last_modified: new Date().toISOString(),
    accept_ranges: 'bytes',
    etag: '"def456"',
    explicit: false,
    linked: false,
    tracker_cdn_url: 'https://cdn.example.com/trackers/tracker1.mod',
  };

  const mockTracker2: TrackerModule = {
    ...mockTracker,
    tracker_id: 'tracker2',
    title: 'Test Tracker 2',
  };

  beforeEach(() => {
    config = {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      apiEndpoint: 'https://api.example.com',
      cacheStrategy: 'stale-while-revalidate',
      debug: false,
    };

    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }

    global.fetch = vi.fn();

    sessionManager = new SessionManager(config);
    // Set up authenticated session
    vi.spyOn(sessionManager, 'getSessionInfo').mockReturnValue(mockSessionInfo);

    httpClient = new BaseClient(config, sessionManager);
    api = new MetadataAPI(httpClient, sessionManager, false);
  });

  afterEach(() => {
    if (sessionManager) {
      sessionManager.destroy();
    }
    vi.restoreAllMocks();
  });

  describe('getManifest', () => {
    it('should fetch manifest successfully', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockManifest,
      });

      const result = await api.getManifest();

      expect(result).toEqual(mockManifest);
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/manifest.json',
        expect.anything()
      );
    });

    it('should cache manifest results', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockManifest,
      });

      const result1 = await api.getManifest();
      const result2 = await api.getManifest();

      expect(result1).toEqual(mockManifest);
      expect(result2).toEqual(mockManifest);
      expect(fetch).toHaveBeenCalledTimes(1); // Only called once due to cache
    });

    it('should throw AuthenticationError when not authenticated', async () => {
      vi.spyOn(sessionManager, 'getSessionInfo').mockReturnValue(null);

      await expect(api.getManifest()).rejects.toThrow(AuthenticationError);
    });

    it('should validate manifest data', async () => {
      const invalidData = { invalid: 'data' };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => invalidData,
      });

      await expect(api.getManifest()).rejects.toThrow();
    });
  });

  describe('getAllAlbums', () => {
    it('should fetch all albums from bulk endpoint', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockAlbum, mockAlbum2],
      });

      const result = await api.getAllAlbums();

      expect(result).toHaveLength(2);
      expect(result[0].album_id).toBe('album1');
      expect(result[1].album_id).toBe('album2');
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/albums.json',
        expect.anything()
      );
    });

    it('should cache albums results', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockAlbum, mockAlbum2],
      });

      await api.getAllAlbums();
      await api.getAllAlbums();

      expect(fetch).toHaveBeenCalledTimes(1); // Only called once due to cache
    });
  });

  describe('getAlbum', () => {
    it('should fetch album by ID using client-side filtering', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockAlbum, mockAlbum2],
      });

      const result = await api.getAlbum('album1');

      expect(result).toEqual(mockAlbum);
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/albums.json',
        expect.anything()
      );
    });

    it('should throw NotFoundError for non-existent album', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockAlbum],
      });

      await expect(api.getAlbum('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getAlbums', () => {
    it('should fetch multiple albums by IDs', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockAlbum, mockAlbum2],
      });

      const result = await api.getAlbums(['album1', 'album2']);

      expect(result).toHaveLength(2);
      expect(result[0].album_id).toBe('album1');
      expect(result[1].album_id).toBe('album2');
    });

    it('should skip albums that do not exist', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockAlbum],
      });

      const result = await api.getAlbums(['album1', 'nonexistent']);

      expect(result).toHaveLength(1);
      expect(result[0].album_id).toBe('album1');
    });
  });

  describe('getAllTracks', () => {
    it('should fetch all tracks from bulk endpoint', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTrack, mockTrack2],
      });

      const result = await api.getAllTracks();

      expect(result).toHaveLength(2);
      expect(result[0].track_id).toBe('album1_01');
      expect(result[1].track_id).toBe('album1_02');
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/tracks.json',
        expect.anything()
      );
    });

    it('should cache tracks results', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTrack, mockTrack2],
      });

      await api.getAllTracks();
      await api.getAllTracks();

      expect(fetch).toHaveBeenCalledTimes(1); // Only called once due to cache
    });
  });

  describe('getTrack', () => {
    it('should fetch track by ID using client-side filtering', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTrack, mockTrack2],
      });

      const result = await api.getTrack('album1_01');

      expect(result).toEqual(mockTrack);
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/tracks.json',
        expect.anything()
      );
    });

    it('should throw NotFoundError for non-existent track', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTrack],
      });

      await expect(api.getTrack('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getTracks', () => {
    it('should fetch multiple tracks by IDs', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTrack, mockTrack2],
      });

      const result = await api.getTracks(['album1_01', 'album1_02']);

      expect(result).toHaveLength(2);
      expect(result[0].track_id).toBe('album1_01');
      expect(result[1].track_id).toBe('album1_02');
    });
  });

  describe('getAlbumTracks', () => {
    it('should fetch all tracks from album using client-side filtering', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTrack, mockTrack2],
      });

      const result = await api.getAlbumTracks('album1');

      expect(result).toHaveLength(2);
      expect(result[0].album_id).toBe('album1');
      expect(result[1].album_id).toBe('album1');
    });
  });

  describe('getAllTrackers', () => {
    it('should fetch all trackers from bulk endpoint', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTracker, mockTracker2],
      });

      const result = await api.getAllTrackers();

      expect(result).toHaveLength(2);
      expect(result[0].tracker_id).toBe('tracker1');
      expect(result[1].tracker_id).toBe('tracker2');
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/tracker.json',
        expect.anything()
      );
    });

    it('should cache trackers results', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTracker, mockTracker2],
      });

      await api.getAllTrackers();
      await api.getAllTrackers();

      expect(fetch).toHaveBeenCalledTimes(1); // Only called once due to cache
    });
  });

  describe('getUnreleasedTrackers', () => {
    it('should fetch unreleased trackers from bulk endpoint', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTracker],
      });

      const result = await api.getUnreleasedTrackers();

      expect(result).toHaveLength(1);
      expect(result[0].tracker_id).toBe('tracker1');
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/unreleased.json',
        expect.anything()
      );
    });
  });

  describe('getTracker', () => {
    it('should fetch tracker by ID using client-side filtering', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTracker, mockTracker2],
      });

      const result = await api.getTracker('tracker1');

      expect(result).toEqual(mockTracker);
      expect(fetch).toHaveBeenCalledWith(
        'https://cdn.example.com/metadata/tracker.json',
        expect.anything()
      );
    });

    it('should throw NotFoundError for non-existent tracker', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTracker],
      });

      await expect(api.getTracker('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getTrackers', () => {
    it('should fetch multiple trackers by IDs', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTracker, mockTracker2],
      });

      const result = await api.getTrackers(['tracker1', 'tracker2']);

      expect(result).toHaveLength(2);
      expect(result[0].tracker_id).toBe('tracker1');
      expect(result[1].tracker_id).toBe('tracker2');
    });
  });

  describe('getTrackTrackers', () => {
    it('should fetch trackers linked to track', async () => {
      const trackWithTrackers = {
        ...mockTrack,
        linked_tracker: [
          {
            tracker_id: 'tracker1',
            tracker_title: 'Test Tracker',
            format: 'MOD',
            file_size_bytes: 50000,
            checksum: 'abc123',
            albums_cdn_url: 'https://cdn.example.com/albums/tracker1.mod',
            albums_s3_url: 's3://bucket/albums/tracker1.mod',
            tracker_cdn_url: 'https://cdn.example.com/trackers/tracker1.mod',
            tracker_s3_url: 's3://bucket/trackers/tracker1.mod',
          },
        ],
      };

      (global.fetch as any)
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [trackWithTrackers],
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [mockTracker],
        });

      const result = await api.getTrackTrackers('album1_01');

      expect(result).toHaveLength(1);
      expect(result[0].tracker_id).toBe('tracker1');
    });

    it('should return empty array for track without trackers', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockTrack],
      });

      const result = await api.getTrackTrackers('album1_01');

      expect(result).toHaveLength(0);
    });
  });

  describe('clearCache', () => {
    it('should clear metadata cache', async () => {
      (global.fetch as any).mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [mockAlbum],
      });

      // Fetch to populate cache
      await api.getAllAlbums();
      expect(fetch).toHaveBeenCalledTimes(1);

      // Fetch again (should use cache)
      await api.getAllAlbums();
      expect(fetch).toHaveBeenCalledTimes(1);

      // Clear cache
      api.clearCache();

      // Fetch again (should hit network)
      await api.getAllAlbums();
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
