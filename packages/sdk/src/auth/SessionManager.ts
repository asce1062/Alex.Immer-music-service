/**
 * Session Manager
 *
 * Manages authentication sessions with CloudFront signed cookies.
 * Handles all edge cases for cookie lifecycle:
 * - Proactive refresh before expiration
 * - Reactive refresh on 401 errors
 * - Stale cookie detection on page load
 * - Multi-tab synchronization
 * - Network error handling
 */

import type { SessionInfo, SessionState, MusicServiceConfig } from '../types';
import { AuthenticationError, NetworkError, ValidationError } from '../types/errors';
import { CookieHandler } from './CookieHandler';
import { SessionInfoSchema } from '../utils/validators';
import { validate } from '../utils/validation';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('SessionManager');

export interface SessionEvents {
  authenticated: (session: SessionInfo) => void;
  refreshed: (session: SessionInfo) => void;
  expired: () => void;
  error: (error: Error) => void;
}

interface StoredSession {
  sessionInfo: SessionInfo;
  timestamp: number;
}

type BroadcastMessage =
  | { type: 'authenticated'; session: SessionInfo }
  | { type: 'refreshed'; session: SessionInfo }
  | { type: 'expired' };

export class SessionManager {
  private cookieHandler: CookieHandler;
  private config: Required<MusicServiceConfig>;
  private sessionInfo: SessionInfo | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private isRefreshing = false;
  private eventListeners = new Map<keyof SessionEvents, Set<(...args: unknown[]) => void>>();
  private broadcastChannel: BroadcastChannel | null = null;

  // Constants
  private readonly REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
  private readonly STORAGE_KEY = 'music_service_session';
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly RETRY_DELAY_MS = 1000;

  constructor(config: Required<MusicServiceConfig>) {
    this.config = config;
    this.cookieHandler = new CookieHandler();

    // Set up BroadcastChannel for multi-tab sync (if available)
    if (typeof BroadcastChannel !== 'undefined') {
      this.broadcastChannel = new BroadcastChannel('music_service_session');
      this.broadcastChannel.addEventListener('message', this.handleBroadcastMessage.bind(this));
    }

    // Check for existing session on initialization
    this.initializeSession();
  }

  /**
   * Initialize session from storage or cookies
   */
  private initializeSession(): void {
    // Try to load session from localStorage
    const storedSession = this.loadSessionFromStorage();

    if (storedSession) {
      const expiresAt = new Date(storedSession.sessionInfo.expires_at);
      const now = new Date();

      // Check if session is still valid
      if (expiresAt > now) {
        this.sessionInfo = storedSession.sessionInfo;
        this.scheduleRefresh();

        logger.debug('Restored session from storage');
      } else {
        // Session expired, clear it
        this.clearSession();

        logger.debug('Stored session expired');
      }
    }

    // Check if CloudFront cookies are present but session is not
    if (!this.sessionInfo && this.cookieHandler.hasValidCloudFrontCookies()) {
      logger.debug('CloudFront cookies present but no session info, may need refresh');
    }
  }

  /**
   * Authenticate and create a new session
   *
   * @param clientId - Client ID (optional, uses config by default)
   * @param clientSecret - Client secret (optional, uses config by default)
   * @returns Session information
   */
  async authenticate(clientId?: string, clientSecret?: string): Promise<SessionInfo> {
    const id = clientId ?? this.config.clientId;
    const secret = clientSecret ?? this.config.clientSecret;

    if (!id || !secret) {
      throw new ValidationError('Client ID and secret are required for authentication');
    }

    if (!this.config.apiEndpoint) {
      throw new ValidationError('API endpoint is required for authentication');
    }

    try {
      const response = await this.fetchWithRetry(`${this.config.apiEndpoint}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-id': id,
          'x-client-secret': secret,
        },
        credentials: 'include',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AuthenticationError(
          `Authentication failed: ${response.statusText}`,
          response.status,
          { errorText, clientId: id }
        );
      }

      const data: unknown = await response.json();

      // Transform API response to SessionInfo structure
      // API returns: { status, session: { expires_at, duration_seconds }, cdn: { ... } }
      // SDK expects: { expires_at, duration_seconds, cdn: { ... } }
      const apiResponse = data as {
        status?: string;
        session?: {
          expires_at?: string;
          duration_seconds?: number;
          created_at?: string;
        };
        cdn?: unknown;
      };

      const transformedData = {
        expires_at: apiResponse.session?.expires_at,
        duration_seconds: apiResponse.session?.duration_seconds,
        created_at: apiResponse.session?.created_at,
        cdn: apiResponse.cdn,
      };

      const sessionInfo = validate(SessionInfoSchema, transformedData, 'SessionInfo');

      // Store session
      this.sessionInfo = sessionInfo;
      this.saveSessionToStorage(sessionInfo);

      // Schedule automatic refresh
      this.scheduleRefresh();

      // Broadcast to other tabs
      this.broadcast({ type: 'authenticated', session: sessionInfo });

      // Emit event
      this.emit('authenticated', sessionInfo);

      logger.info('Authentication successful', {
        expiresAt: sessionInfo.expires_at,
      });

      return sessionInfo;
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Refresh the current session
   *
   * @returns Updated session information
   */
  async refresh(): Promise<SessionInfo> {
    if (this.isRefreshing) {
      // Wait for existing refresh to complete
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (!this.isRefreshing) {
            clearInterval(checkInterval);
            if (this.sessionInfo) {
              resolve(this.sessionInfo);
            } else {
              reject(new AuthenticationError('Session refresh failed'));
            }
          }
        }, 100);
      });
    }

    this.isRefreshing = true;

    try {
      // Use the same authenticate method to get a new session
      const sessionInfo = await this.authenticate();

      // Broadcast to other tabs
      this.broadcast({ type: 'refreshed', session: sessionInfo });

      // Emit event
      this.emit('refreshed', sessionInfo);

      logger.info('Session refreshed successfully');

      return sessionInfo;
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Invalidate the current session and clear cookies
   */
  invalidate(): void {
    // Clear refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Clear cookies
    this.cookieHandler.deleteCloudFrontCookies();

    // Clear storage
    this.clearSession();

    // Broadcast to other tabs
    this.broadcast({ type: 'expired' });

    // Emit event
    this.emit('expired');

    logger.info('Session invalidated');
  }

  /**
   * Get current session state
   *
   * @returns Session state information
   */
  getSessionState(): SessionState {
    if (!this.sessionInfo) {
      return {
        isValid: false,
        expiresAt: new Date(0),
        timeUntilExpiry: 0,
        needsRefresh: false,
      };
    }

    const expiresAt = new Date(this.sessionInfo.expires_at);
    const now = new Date();
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    const needsRefresh = timeUntilExpiry < this.REFRESH_BEFORE_EXPIRY_MS;

    return {
      isValid: timeUntilExpiry > 0,
      expiresAt,
      timeUntilExpiry,
      needsRefresh,
    };
  }

  /**
   * Get current session info
   */
  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  /**
   * Check if session is valid
   */
  isSessionValid(): boolean {
    return this.getSessionState().isValid;
  }

  /**
   * Schedule automatic refresh before expiration
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    if (!this.sessionInfo) {
      return;
    }

    const state = this.getSessionState();
    const refreshIn = state.timeUntilExpiry - this.REFRESH_BEFORE_EXPIRY_MS;

    if (refreshIn > 0) {
      this.refreshTimer = setTimeout(() => {
        logger.debug('Auto-refreshing session before expiration');
        this.refresh().catch((error: unknown) => {
          logger.error('Auto-refresh failed', error);
          this.emit('error', error instanceof Error ? error : new Error(String(error)));
        });
      }, refreshIn);

      logger.debug(`Refresh scheduled in ${Math.round(refreshIn / 1000)} seconds`);
    } else if (state.isValid) {
      // Session is valid but needs immediate refresh
      logger.debug('Session needs immediate refresh');
      this.refresh().catch((error: unknown) => {
        logger.error('Immediate refresh failed', error);
        this.emit('error', error instanceof Error ? error : new Error(String(error)));
      });
    }
  }

  /**
   * Fetch with retry logic and exponential backoff
   */
  private async fetchWithRetry(url: string, options: RequestInit, attempt = 1): Promise<Response> {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      if (attempt >= this.MAX_RETRY_ATTEMPTS) {
        throw new NetworkError('Network request failed after retries', error);
      }

      // Exponential backoff
      const delay = this.RETRY_DELAY_MS * Math.pow(2, attempt - 1);

      logger.debug(`Retry ${attempt}/${this.MAX_RETRY_ATTEMPTS} after ${delay}ms`);

      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.fetchWithRetry(url, options, attempt + 1);
    }
  }

  /**
   * Save session to localStorage
   */
  private saveSessionToStorage(sessionInfo: SessionInfo): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const stored: StoredSession = {
        sessionInfo,
        timestamp: Date.now(),
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stored));
    } catch (error) {
      logger.error('Failed to save session to storage', error);
    }
  }

  /**
   * Load session from localStorage
   */
  private loadSessionFromStorage(): StoredSession | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) {
        return null;
      }

      return JSON.parse(stored) as StoredSession;
    } catch (error) {
      logger.error('Failed to load session from storage', error);
      return null;
    }
  }

  /**
   * Clear session from storage
   */
  private clearSession(): void {
    this.sessionInfo = null;

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(this.STORAGE_KEY);
      } catch (error) {
        logger.error('Failed to clear session from storage', error);
      }
    }
  }

  /**
   * Broadcast message to other tabs
   */
  private broadcast(message: BroadcastMessage): void {
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(message);
      } catch (error) {
        logger.error('Failed to broadcast message', error);
      }
    }
  }

  /**
   * Handle messages from other tabs
   */
  private handleBroadcastMessage(event: MessageEvent<BroadcastMessage>): void {
    const message = event.data;

    logger.debug('Received broadcast', { type: message.type });

    switch (message.type) {
      case 'authenticated':
      case 'refreshed':
        this.sessionInfo = message.session;
        this.saveSessionToStorage(message.session);
        this.scheduleRefresh();
        break;
      case 'expired':
        this.clearSession();
        if (this.refreshTimer) {
          clearTimeout(this.refreshTimer);
          this.refreshTimer = null;
        }
        break;
    }
  }

  /**
   * Add event listener
   */
  on<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener as (...args: unknown[]) => void);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof SessionEvents>(event: K, listener: SessionEvents[K]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener as (...args: unknown[]) => void);
    }
  }

  /**
   * Emit event
   */
  private emit<K extends keyof SessionEvents>(
    event: K,
    ...args: Parameters<SessionEvents[K]>
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (error) {
          logger.error(`Error in ${String(event)} listener`, error);
        }
      });
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    this.eventListeners.clear();
  }
}
