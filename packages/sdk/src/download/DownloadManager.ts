/**
 * DownloadManager - Comprehensive Production-Ready Download Engine
 *
 * Features:
 * - Rate limiting with cooldown tracking
 * - Download queue with priority management
 * - Progress tracking with speed calculation
 * - Concurrent download management
 * - Automatic retry logic
 * - Checksum verification
 * - Download history with localStorage
 * - Batch downloads
 * - Event system
 */

import type {
  Track,
  Album,
  TrackerModule,
  DownloadConfig,
  DownloadLimits,
  DownloadItem,
  DownloadProgress,
  DownloadCheckResult,
  DownloadStats,
  DownloadEvents,
  DownloadHistoryEntry,
  DownloadPriority,
  BatchDownloadOptions,
  DownloadVerification,
} from '../types';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('DownloadManager');

type EventMap = {
  [K in keyof DownloadEvents]: DownloadEvents[K][];
};

export class DownloadManager {
  private config: Required<DownloadConfig>;
  private limits: Required<DownloadLimits>;
  private queue: DownloadItem[] = [];
  private activeDownloads = new Map<string, DownloadItem>();
  private downloadHistory = new Map<string, number>(); // file -> last download timestamp
  private history: DownloadHistoryEntry[] = [];
  private events: Partial<EventMap> = {};
  private stats: DownloadStats;
  private dailyResetTime: number;

  constructor(config?: DownloadConfig) {
    // Configure limits
    this.limits = {
      sameFileCooldown: config?.limits?.sameFileCooldown ?? 300, // 5 minutes
      maxDownloadsPerSession: config?.limits?.maxDownloadsPerSession ?? 50,
      maxDownloadsPerDay: config?.limits?.maxDownloadsPerDay ?? 100,
      warnAtDownloads: config?.limits?.warnAtDownloads ?? 10,
      maxConcurrent: config?.limits?.maxConcurrent ?? 3,
      maxQueueSize: config?.limits?.maxQueueSize ?? 100,
      maxRetries: config?.limits?.maxRetries ?? 3,
    };

    // Configure manager
    this.config = {
      limits: this.limits,
      enableRetries: config?.enableRetries ?? true,
      maxRetries: config?.maxRetries ?? 3,
      retryDelay: config?.retryDelay ?? 5,
      enableQueue: config?.enableQueue ?? true,
      autoStartQueue: config?.autoStartQueue ?? true,
      saveHistory: config?.saveHistory ?? true,
      historyStorageKey: config?.historyStorageKey ?? 'music-service-download-history',
      maxHistoryEntries: config?.maxHistoryEntries ?? 500,
      verifyChecksum: config?.verifyChecksum ?? true,
      debug: config?.debug ?? false,
    };

    // Initialize stats
    this.stats = {
      totalDownloads: 0,
      sessionDownloads: 0,
      dailyDownloads: 0,
      failedDownloads: 0,
      totalBytesDownloaded: 0,
      activeDownloads: 0,
      queuedDownloads: 0,
      averageSpeed: 0,
    };

    // Set daily reset time (midnight)
    const now = new Date();
    this.dailyResetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();

    // Load history
    if (this.config.saveHistory) {
      this.history = this.loadHistory();
    }

    // Start daily reset check
    this.startDailyResetCheck();

    logger.debug('Initialized', { config: this.config });
  }

  // ============================================================================
  // Download Controls
  // ============================================================================

  /**
   * Download a track
   */
  async downloadTrack(track: Track, priority: DownloadPriority = 'normal'): Promise<DownloadItem> {
    const item: DownloadItem = {
      id: this.generateDownloadId(),
      type: 'track',
      item: track,
      status: 'pending',
      priority,
      progress: this.createInitialProgress(track.track_name),
      url: track.cdn_url,
      filename: `${track.artist} - ${track.track_name}.${track.format}`,
      fileSize: track.file_size_bytes,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };

    return this.addDownload(item);
  }

  /**
   * Download an album (all tracks)
   */
  async downloadAlbum(
    album: Album,
    tracks: Track[],
    options?: BatchDownloadOptions
  ): Promise<DownloadItem[]> {
    const priority = options?.priority ?? 'normal';
    const items: DownloadItem[] = [];

    for (const track of tracks) {
      const item: DownloadItem = {
        id: this.generateDownloadId(),
        type: 'track',
        item: track,
        status: 'pending',
        priority,
        progress: this.createInitialProgress(track.track_name),
        url: track.cdn_url,
        filename: `${album.artist} - ${album.album}/${track.artist} - ${track.track_name}.${track.format}`,
        fileSize: track.file_size_bytes,
        createdAt: new Date(),
        retryCount: 0,
        maxRetries: this.config.maxRetries,
      };
      items.push(item);
    }

    return this.addBatchDownloads(items, options?.startImmediately ?? false);
  }

  /**
   * Download a tracker module
   */
  async downloadTracker(
    tracker: TrackerModule,
    priority: DownloadPriority = 'normal'
  ): Promise<DownloadItem> {
    const item: DownloadItem = {
      id: this.generateDownloadId(),
      type: 'tracker',
      item: tracker,
      status: 'pending',
      priority,
      progress: this.createInitialProgress(tracker.title),
      url: tracker.tracker_cdn_url,
      filename: tracker.file_name,
      fileSize: tracker.file_size_bytes,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: this.config.maxRetries,
    };

    return this.addDownload(item);
  }

  /**
   * Cancel a download
   */
  cancelDownload(downloadId: string): void {
    const activeItem = this.activeDownloads.get(downloadId);
    if (activeItem) {
      activeItem.status = 'cancelled';
      this.activeDownloads.delete(downloadId);
      this.stats.activeDownloads = this.activeDownloads.size;

      this.emit('cancelled', activeItem);

      logger.debug('Download cancelled', { downloadId });

      // Start next in queue
      this.processQueue();
      return;
    }

    // Check queue
    const queueIndex = this.queue.findIndex((item) => item.id === downloadId);
    if (queueIndex !== -1) {
      const item = this.queue[queueIndex];
      item.status = 'cancelled';
      this.queue.splice(queueIndex, 1);
      this.stats.queuedDownloads = this.queue.length;

      this.emit('cancelled', item);
      this.emit('queuechange', [...this.queue]);
    }
  }

  /**
   * Pause a download
   */
  pauseDownload(downloadId: string): void {
    const item = this.activeDownloads.get(downloadId);
    if (item?.status === 'downloading') {
      item.status = 'paused';
      this.emit('paused', item);

      logger.debug('Download paused', { downloadId });
    }
  }

  /**
   * Resume a paused download
   */
  async resumeDownload(downloadId: string): Promise<void> {
    const item = this.activeDownloads.get(downloadId);
    if (item?.status === 'paused') {
      item.status = 'downloading';
      this.emit('resumed', item);
      await this.executeDownload(item);

      logger.debug('Download resumed', { downloadId });
    }
  }

  /**
   * Retry a failed download
   */
  retryDownload(downloadId: string): void {
    const item =
      this.queue.find((i) => i.id === downloadId) ?? this.activeDownloads.get(downloadId);

    if (item?.status === 'failed') {
      item.status = 'pending';
      item.retryCount = 0;
      item.error = undefined;
      item.progress.error = undefined;

      if (!this.queue.includes(item)) {
        this.queue.push(item);
        this.stats.queuedDownloads = this.queue.length;
        this.emit('queuechange', [...this.queue]);
      }

      this.processQueue();

      logger.debug('Download retry queued', { downloadId });
    }
  }

  /**
   * Clear completed downloads
   */
  clearCompleted(): void {
    const completed = Array.from(this.activeDownloads.values()).filter(
      (item) => item.status === 'completed'
    );

    completed.forEach((item) => {
      this.activeDownloads.delete(item.id);
    });

    this.stats.activeDownloads = this.activeDownloads.size;

    logger.debug('Cleared completed downloads', { count: completed.length });
  }

  /**
   * Clear all downloads (active and queued)
   */
  clearAll(): void {
    // Cancel active downloads
    Array.from(this.activeDownloads.keys()).forEach((id) => {
      this.cancelDownload(id);
    });

    // Clear queue
    this.queue = [];
    this.stats.queuedDownloads = 0;
    this.emit('queuechange', []);

    logger.debug('All downloads cleared');
  }

  // ============================================================================
  // Rate Limiting
  // ============================================================================

  /**
   * Check if download is allowed (rate limiting)
   */
  checkDownloadAllowed(fileUrl: string): DownloadCheckResult {
    // Check cooldown for same file
    const lastDownload = this.downloadHistory.get(fileUrl);
    if (lastDownload) {
      const elapsed = (Date.now() - lastDownload) / 1000;
      if (elapsed < this.limits.sameFileCooldown) {
        return {
          allowed: false,
          reason: 'COOLDOWN',
          retryAfter: Math.ceil(this.limits.sameFileCooldown - elapsed),
          message: `Please wait ${Math.ceil(this.limits.sameFileCooldown - elapsed)}s before downloading this file again`,
        };
      }
    }

    // Check session limit
    if (this.stats.sessionDownloads >= this.limits.maxDownloadsPerSession) {
      return {
        allowed: false,
        reason: 'SESSION_LIMIT',
        message: `Session download limit reached (${this.limits.maxDownloadsPerSession})`,
      };
    }

    // Check daily limit
    if (this.stats.dailyDownloads >= this.limits.maxDownloadsPerDay) {
      const resetIn = Math.ceil((this.dailyResetTime - Date.now()) / 1000 / 60 / 60);
      return {
        allowed: false,
        reason: 'DAILY_LIMIT',
        retryAfter: resetIn * 3600,
        message: `Daily download limit reached (${this.limits.maxDownloadsPerDay}). Resets in ${resetIn}h`,
      };
    }

    // Check queue size
    if (this.queue.length >= this.limits.maxQueueSize) {
      return {
        allowed: false,
        reason: 'QUEUE_FULL',
        message: `Download queue is full (${this.limits.maxQueueSize})`,
      };
    }

    // Warning if approaching limits
    const remaining = Math.min(
      this.limits.maxDownloadsPerSession - this.stats.sessionDownloads,
      this.limits.maxDownloadsPerDay - this.stats.dailyDownloads
    );

    if (remaining <= this.limits.warnAtDownloads) {
      return {
        allowed: true,
        warning: true,
        message: `Warning: Only ${remaining} downloads remaining`,
      };
    }

    return { allowed: true };
  }

  // ============================================================================
  // Queue Management
  // ============================================================================

  /**
   * Get current download queue
   */
  getQueue(): DownloadItem[] {
    return [...this.queue];
  }

  /**
   * Get active downloads
   */
  getActiveDownloads(): DownloadItem[] {
    return Array.from(this.activeDownloads.values());
  }

  /**
   * Get download by ID
   */
  getDownload(downloadId: string): DownloadItem | null {
    return (
      this.activeDownloads.get(downloadId) ?? this.queue.find((i) => i.id === downloadId) ?? null
    );
  }

  /**
   * Move download in queue
   */
  moveInQueue(downloadId: string, newPosition: number): void {
    const index = this.queue.findIndex((item) => item.id === downloadId);
    if (index === -1) return;

    const [item] = this.queue.splice(index, 1);
    this.queue.splice(newPosition, 0, item);

    this.emit('queuechange', [...this.queue]);
  }

  /**
   * Set download priority
   */
  setPriority(downloadId: string, priority: DownloadPriority): void {
    const item = this.getDownload(downloadId);
    if (item) {
      item.priority = priority;

      // Re-sort queue by priority
      this.sortQueueByPriority();
      this.emit('queuechange', [...this.queue]);
    }
  }

  // ============================================================================
  // History & Stats
  // ============================================================================

  /**
   * Get download statistics
   */
  getStats(): Readonly<DownloadStats> {
    return { ...this.stats };
  }

  /**
   * Get download history
   */
  getHistory(): DownloadHistoryEntry[] {
    return [...this.history];
  }

  /**
   * Clear download history
   */
  clearHistory(): void {
    this.history = [];
    this.saveHistory();

    logger.debug('History cleared');
  }

  // ============================================================================
  // Event System
  // ============================================================================
  private callListener<K extends keyof DownloadEvents>(
    listener: DownloadEvents[K],
    args: Parameters<DownloadEvents[K]>
  ): void {
    (listener as (...args: Parameters<DownloadEvents[K]>) => void)(...args);
  }

  on<K extends keyof DownloadEvents>(event: K, listener: DownloadEvents[K]): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event]!.push(listener);
  }

  off<K extends keyof DownloadEvents>(event: K, listener: DownloadEvents[K]): void {
    const listeners = this.events[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  once<K extends keyof DownloadEvents>(event: K, listener: DownloadEvents[K]): void {
    const onceListener: DownloadEvents[K] = ((...args: Parameters<DownloadEvents[K]>) => {
      this.callListener(listener, args);
      this.off(event, onceListener);
    }) as DownloadEvents[K];

    this.on(event, onceListener);
  }

  private emit<K extends keyof DownloadEvents>(
    event: K,
    ...args: Parameters<DownloadEvents[K]>
  ): void {
    const listeners = this.events[event];
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          this.callListener(listener, args);
        } catch (error) {
          logger.error(`Error in ${String(event)} listener`, error);
        }
      });
    }
  }

  // ============================================================================
  // Private Methods - Download Management
  // ============================================================================

  private async addDownload(item: DownloadItem): Promise<DownloadItem> {
    // Check rate limits
    const check = this.checkDownloadAllowed(item.url);

    if (!check.allowed) {
      this.emit('ratelimitexceeded', check);
      throw new Error(check.message ?? 'Download not allowed');
    }

    if (check.warning) {
      this.emit('ratelimitwarning', check);
    }

    // Add to queue
    if (this.config.enableQueue) {
      this.queue.push(item);
      this.sortQueueByPriority();
      this.stats.queuedDownloads = this.queue.length;

      item.status = 'pending';
      this.emit('queued', item);
      this.emit('queuechange', [...this.queue]);

      logger.debug('Download queued', { filename: item.filename });

      // Auto-start if configured and slots available
      if (this.config.autoStartQueue) {
        this.processQueue();
      }
    } else {
      // Start immediately if queue is disabled
      await this.startDownload(item);
    }

    return item;
  }

  private async addBatchDownloads(
    items: DownloadItem[],
    startImmediately: boolean
  ): Promise<DownloadItem[]> {
    const added: DownloadItem[] = [];

    for (const item of items) {
      try {
        const result = await this.addDownload(item);
        added.push(result);
      } catch (error) {
        logger.warn('Failed to add download', error);
      }
    }

    if (startImmediately && this.config.autoStartQueue) {
      this.processQueue();
    }

    return added;
  }

  private processQueue(): void {
    // Process queue while we have available slots
    while (this.queue.length > 0 && this.activeDownloads.size < this.limits.maxConcurrent) {
      const item = this.queue.shift();
      if (item) {
        this.stats.queuedDownloads = this.queue.length;
        this.emit('queuechange', [...this.queue]);
        void this.startDownload(item);
      }
    }

    // Check if all downloads are complete
    if (this.activeDownloads.size === 0 && this.queue.length === 0) {
      this.emit('allcomplete');
    }
  }

  private async startDownload(item: DownloadItem): Promise<void> {
    item.status = 'downloading';
    item.startedAt = new Date();
    this.activeDownloads.set(item.id, item);
    this.stats.activeDownloads = this.activeDownloads.size;

    this.emit('start', item);

    logger.debug('Starting download', { filename: item.filename });

    await this.executeDownload(item);
  }

  private async executeDownload(item: DownloadItem): Promise<void> {
    try {
      // Download with CloudFront signed cookies
      const response = await fetch(item.url, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Unable to read response body');
      }

      const contentLength = parseInt(response.headers.get('content-length') ?? '0');
      let receivedBytes = 0;
      const chunks: Uint8Array[] = [];
      const startTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();

        if (done || item.status === 'cancelled' || item.status === 'paused') {
          break;
        }

        if (value) {
          chunks.push(value);
          receivedBytes += value.length;

          // Update progress
          const elapsed = (Date.now() - startTime) / 1000;
          const speed = receivedBytes / elapsed;
          const timeRemaining = (contentLength - receivedBytes) / speed;

          item.progress = {
            status: 'downloading',
            currentFile: item.filename,
            percent: (receivedBytes / contentLength) * 100,
            bytesDownloaded: receivedBytes,
            bytesTotal: contentLength,
            speed,
            timeRemaining,
            startedAt: item.startedAt,
          };

          this.emit('progress', item, item.progress);
        }
      }

      // Check if cancelled or paused
      if (item.status === 'cancelled') {
        return;
      }

      if (item.status === 'paused') {
        return;
      }

      // Verify checksum if enabled
      if (this.config.verifyChecksum) {
        item.status = 'verifying';
        const verification = await this.verifyDownload(item, chunks);

        if (!verification.verified) {
          throw new Error(`Checksum verification failed: ${verification.error?.message}`);
        }
      }

      // Download complete
      item.status = 'completed';
      item.completedAt = new Date();
      item.progress.status = 'completed';
      item.progress.percent = 100;
      item.progress.completedAt = item.completedAt;

      this.stats.totalDownloads++;
      this.stats.sessionDownloads++;
      this.stats.dailyDownloads++;
      this.stats.totalBytesDownloaded += receivedBytes;

      // Update download history (cooldown tracking)
      this.downloadHistory.set(item.url, Date.now());

      // Add to history
      this.addToHistory(item, true);

      this.emit('complete', item);
      this.emit('progress', item, item.progress);

      // Remove from active downloads after a delay
      setTimeout(() => {
        this.activeDownloads.delete(item.id);
        this.stats.activeDownloads = this.activeDownloads.size;
      }, 5000);

      // Process next in queue
      this.processQueue();

      logger.debug('Download completed', { filename: item.filename });
    } catch (error) {
      await this.handleDownloadError(item, error as Error);
    }
  }

  private async handleDownloadError(item: DownloadItem, error: Error): Promise<void> {
    item.error = error;
    item.progress.error = error;

    // Retry if enabled
    if (this.config.enableRetries && item.retryCount < item.maxRetries) {
      item.retryCount++;

      logger.debug('Retrying download', {
        retryCount: item.retryCount,
        maxRetries: item.maxRetries,
        filename: item.filename,
      });

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, this.config.retryDelay * 1000));

      // Retry
      await this.executeDownload(item);
    } else {
      // Failed
      item.status = 'failed';
      item.completedAt = new Date();
      item.progress.status = 'failed';

      this.stats.failedDownloads++;

      this.addToHistory(item, false);
      this.emit('failed', item, error);

      this.activeDownloads.delete(item.id);
      this.stats.activeDownloads = this.activeDownloads.size;

      // Process next in queue
      this.processQueue();

      logger.error('Download failed', { filename: item.filename, error });
    }
  }

  private async verifyDownload(
    item: DownloadItem,
    chunks: Uint8Array[]
  ): Promise<DownloadVerification> {
    try {
      // Get expected checksum
      const expectedChecksum = this.getItemChecksum(item.item);
      if (!expectedChecksum) {
        return { verified: true }; // No checksum to verify
      }

      // Concatenate chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const data = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }

      // Calculate checksum (SHA-256)
      const hashBuffer: ArrayBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const actualChecksum = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      const verified = actualChecksum === expectedChecksum;

      if (!verified) {
        return {
          verified: false,
          expectedChecksum,
          actualChecksum,
          algorithm: 'SHA-256',
          error: new Error('Checksum mismatch'),
        };
      }

      return {
        verified: true,
        expectedChecksum,
        actualChecksum,
        algorithm: 'SHA-256',
      };
    } catch (error) {
      return {
        verified: false,
        error: error as Error,
      };
    }
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private createInitialProgress(filename: string): DownloadProgress {
    return {
      status: 'pending',
      currentFile: filename,
      percent: 0,
      bytesDownloaded: 0,
      bytesTotal: 0,
      speed: 0,
      timeRemaining: 0,
    };
  }

  private generateDownloadId(): string {
    return `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private sortQueueByPriority(): void {
    const priorityOrder: Record<DownloadPriority, number> = {
      high: 0,
      normal: 1,
      low: 2,
    };

    this.queue.sort((a, b) => {
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      // Same priority, sort by creation time
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  private getItemChecksum(item: Track | Album | TrackerModule): string | null {
    if ('checksum' in item && item.checksum) {
      return item.checksum.value;
    }
    return null;
  }

  private getItemInfo(item: Track | Album | TrackerModule): {
    id: string;
    title: string;
    artist: string;
  } {
    if ('track_id' in item) {
      return { id: item.track_id, title: item.track_name, artist: item.artist };
    }
    if ('album_id' in item) {
      return { id: item.album_id, title: item.album, artist: item.artist };
    }
    if ('tracker_id' in item) {
      return { id: item.tracker_id, title: item.title, artist: item.composer };
    }
    return { id: '', title: '', artist: '' };
  }

  private addToHistory(item: DownloadItem, success: boolean): void {
    if (!this.config.saveHistory) return;

    const info = this.getItemInfo(item.item);
    const duration =
      item.completedAt && item.startedAt
        ? (item.completedAt.getTime() - item.startedAt.getTime()) / 1000
        : 0;

    const entry: DownloadHistoryEntry = {
      id: item.id,
      type: item.type,
      itemId: info.id,
      title: info.title,
      artist: info.artist,
      fileSize: item.fileSize,
      status: item.status,
      downloadedAt: new Date(),
      duration,
      success,
      errorMessage: item.error?.message,
    };

    this.history.unshift(entry);

    // Limit history size
    if (this.history.length > this.config.maxHistoryEntries) {
      this.history = this.history.slice(0, this.config.maxHistoryEntries);
    }

    this.saveHistory();
  }

  private startDailyResetCheck(): void {
    setInterval(() => {
      if (Date.now() >= this.dailyResetTime) {
        this.stats.dailyDownloads = 0;
        const now = new Date();
        this.dailyResetTime = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate() + 1
        ).getTime();

        logger.debug('Daily download count reset');
      }
    }, 60000); // Check every minute
  }

  // ============================================================================
  // Storage
  // ============================================================================

  private loadHistory(): DownloadHistoryEntry[] {
    try {
      const saved = localStorage.getItem(this.config.historyStorageKey);
      if (saved) {
        const data = JSON.parse(saved) as DownloadHistoryEntry[];
        return data.map((entry) => ({
          ...entry,
          downloadedAt: new Date(entry.downloadedAt),
        }));
      }
    } catch (error) {
      logger.warn('Failed to load history', error);
    }

    return [];
  }

  private saveHistory(): void {
    try {
      localStorage.setItem(this.config.historyStorageKey, JSON.stringify(this.history));
    } catch (error) {
      logger.warn('Failed to save history', error);
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    // Cancel all active downloads
    this.clearAll();

    // Clear events
    this.events = {};

    logger.debug('Destroyed');
  }
}
