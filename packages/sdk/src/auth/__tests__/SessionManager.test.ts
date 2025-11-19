/**
 * Tests for SessionManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../SessionManager';
import type { SessionInfo, MusicServiceConfig } from '../../types';
import { AuthenticationError, NetworkError } from '../../types';

describe('SessionManager', () => {
  let manager: SessionManager;
  let config: Required<MusicServiceConfig>;

  const mockSessionInfo: SessionInfo = {
    status: 'success',
    session: {
      expires_at: new Date(Date.now() + 7200000).toISOString(), // 2 hours from now
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

  beforeEach(() => {
    config = {
      clientId: 'test-client',
      clientSecret: 'test-secret',
      apiEndpoint: 'https://api.example.com',
      cacheStrategy: 'stale-while-revalidate',
      debug: false,
    };

    // Clear localStorage
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }

    // Reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(() => {
    if (manager) {
      manager.destroy();
    }
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create SessionManager instance', () => {
      manager = new SessionManager(config);
      expect(manager).toBeInstanceOf(SessionManager);
    });

    it('should initialize with no session', () => {
      manager = new SessionManager(config);
      expect(manager.getSessionInfo()).toBeNull();
      expect(manager.isSessionValid()).toBe(false);
    });

    it('should restore session from localStorage', () => {
      // Store a valid session
      const storedSession = {
        sessionInfo: mockSessionInfo,
        timestamp: Date.now(),
      };
      localStorage.setItem('music_service_session', JSON.stringify(storedSession));

      manager = new SessionManager(config);

      const sessionInfo = manager.getSessionInfo();
      expect(sessionInfo).not.toBeNull();
      expect(sessionInfo!.cdn.base_url).toBe('https://cdn.example.com');
    });

    it('should not restore expired session', () => {
      // Store an expired session
      const expiredSession = {
        sessionInfo: {
          status: 'success',
          session: {
            expires_at: new Date(Date.now() - 1000).toISOString(), // Already expired
            duration_seconds: 7200,
            created_at: new Date().toISOString(),
          },
          cdn: mockSessionInfo.cdn,
        },
        timestamp: Date.now(),
      };
      localStorage.setItem('music_service_session', JSON.stringify(expiredSession));

      manager = new SessionManager(config);

      expect(manager.getSessionInfo()).toBeNull();
      expect(localStorage.getItem('music_service_session')).toBeNull();
    });
  });

  describe('authenticate', () => {
    it('should authenticate successfully', async () => {
      manager = new SessionManager(config);

      // Mock successful response
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });

      const sessionInfo = await manager.authenticate();

      expect(sessionInfo).toEqual(mockSessionInfo);
      expect(manager.isSessionValid()).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/session',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'x-client-id': 'test-client',
            'x-client-secret': 'test-secret',
          }),
          credentials: 'include',
        })
      );
    });

    it('should throw AuthenticationError on failed authentication', async () => {
      manager = new SessionManager(config);

      // Mock failed response
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: async () => 'Invalid credentials',
      });

      await expect(manager.authenticate()).rejects.toThrow(AuthenticationError);
    });

    it('should save session to localStorage', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });

      await manager.authenticate();

      const stored = localStorage.getItem('music_service_session');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed.sessionInfo).toEqual(mockSessionInfo);
    });

    it('should emit authenticated event', async () => {
      manager = new SessionManager(config);

      const listener = vi.fn();
      manager.on('authenticated', listener);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });

      await manager.authenticate();

      expect(listener).toHaveBeenCalledWith(mockSessionInfo);
    });

    it('should use custom credentials if provided', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });

      await manager.authenticate('custom-id', 'custom-secret');

      expect(fetch).toHaveBeenCalledWith(
        'https://api.example.com/session',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-client-id': 'custom-id',
            'x-client-secret': 'custom-secret',
          }),
          credentials: 'include',
        })
      );
    });

    it('should retry on network errors', async () => {
      manager = new SessionManager(config);

      // First two calls fail, third succeeds
      (global.fetch as any)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSessionInfo,
        });

      const sessionInfo = await manager.authenticate();

      expect(sessionInfo).toEqual(mockSessionInfo);
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('should throw NetworkError after max retries', async () => {
      manager = new SessionManager(config);

      // All calls fail
      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(manager.authenticate()).rejects.toThrow(NetworkError);
      expect(fetch).toHaveBeenCalledTimes(3); // MAX_RETRY_ATTEMPTS
    });
  });

  describe('refresh', () => {
    it('should refresh session successfully', async () => {
      manager = new SessionManager(config);

      // Initial authenticate
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });
      await manager.authenticate();

      // Refresh
      const newSession: SessionInfo = {
        status: 'success',
        session: {
          expires_at: new Date(Date.now() + 10800000).toISOString(), // 3 hours
          duration_seconds: 10800,
          created_at: new Date().toISOString(),
        },
        cdn: mockSessionInfo.cdn,
      };
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => newSession,
      });

      const refreshedSession = await manager.refresh();

      expect(refreshedSession.session.expires_at).toBe(newSession.session.expires_at);
    });

    it('should emit refreshed event', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockSessionInfo,
      });

      await manager.authenticate();

      const listener = vi.fn();
      manager.on('refreshed', listener);

      await manager.refresh();

      expect(listener).toHaveBeenCalledWith(mockSessionInfo);
    });

    it('should prevent concurrent refreshes', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockSessionInfo,
      });

      await manager.authenticate();

      // Start two refreshes concurrently
      const refresh1 = manager.refresh();
      const refresh2 = manager.refresh();

      await Promise.all([refresh1, refresh2]);

      // Should only call fetch once for refresh (plus once for initial auth)
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidate', () => {
    it('should clear session', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });
      await manager.authenticate();

      expect(manager.isSessionValid()).toBe(true);

      manager.invalidate();

      expect(manager.isSessionValid()).toBe(false);
      expect(manager.getSessionInfo()).toBeNull();
      expect(localStorage.getItem('music_service_session')).toBeNull();
    });

    it('should emit expired event', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });
      await manager.authenticate();

      const listener = vi.fn();
      manager.on('expired', listener);

      manager.invalidate();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('getSessionState', () => {
    it('should return invalid state when no session', () => {
      manager = new SessionManager(config);

      const state = manager.getSessionState();

      expect(state.isValid).toBe(false);
      expect(state.timeUntilExpiry).toBe(0);
      expect(state.needsRefresh).toBe(false);
    });

    it('should return valid state for active session', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });
      await manager.authenticate();

      const state = manager.getSessionState();

      expect(state.isValid).toBe(true);
      expect(state.timeUntilExpiry).toBeGreaterThan(0);
      expect(state.expiresAt).toBeInstanceOf(Date);
    });

    it('should indicate refresh needed when close to expiry', async () => {
      manager = new SessionManager(config);

      const soonToExpire: SessionInfo = {
        status: 'success',
        session: {
          expires_at: new Date(Date.now() + 60000).toISOString(), // 1 minute
          duration_seconds: 60,
          created_at: new Date().toISOString(),
        },
        cdn: mockSessionInfo.cdn,
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => soonToExpire,
      });
      await manager.authenticate();

      const state = manager.getSessionState();

      expect(state.isValid).toBe(true);
      expect(state.needsRefresh).toBe(true);
    });
  });

  describe('event listeners', () => {
    it('should add and remove event listeners', () => {
      manager = new SessionManager(config);

      const listener = vi.fn();

      manager.on('authenticated', listener);
      manager.off('authenticated', listener);

      // Listener should not be called after removal
      // (we can't easily test this without triggering the event)
    });

    it('should handle errors in event listeners', async () => {
      manager = new SessionManager(config);

      const badListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const goodListener = vi.fn();

      manager.on('authenticated', badListener);
      manager.on('authenticated', goodListener);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });

      // Should not throw even though listener throws
      await manager.authenticate();

      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('should clean up resources', async () => {
      manager = new SessionManager(config);
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSessionInfo,
      });
      await manager.authenticate();

      manager.destroy();

      // Should not throw
      expect(() => manager.destroy()).not.toThrow();
    });
  });
});
