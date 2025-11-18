/**
 * Download types and interfaces
 */

import type { Track, Album, TrackerModule } from './index';

/**
 * Download status
 */
export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'verifying';

/**
 * Download priority
 */
export type DownloadPriority = 'low' | 'normal' | 'high';

/**
 * Downloadable item type
 */
export type DownloadableType = 'track' | 'album' | 'tracker';

/**
 * Download progress information
 */
export interface DownloadProgress {
  /** Download status */
  status: DownloadStatus;
  /** Current file being downloaded */
  currentFile: string;
  /** Download percentage (0-100) */
  percent: number;
  /** Bytes downloaded */
  bytesDownloaded: number;
  /** Total bytes to download */
  bytesTotal: number;
  /** Download speed in bytes per second */
  speed: number;
  /** Estimated time remaining in seconds */
  timeRemaining: number;
  /** Error if status is 'failed' */
  error?: Error;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
}

/**
 * Download item
 */
export interface DownloadItem {
  /** Unique download ID */
  id: string;
  /** Item type */
  type: DownloadableType;
  /** Track, Album, or Tracker data */
  item: Track | Album | TrackerModule;
  /** Download status */
  status: DownloadStatus;
  /** Download priority */
  priority: DownloadPriority;
  /** Progress information */
  progress: DownloadProgress;
  /** URL to download from */
  url: string;
  /** Target filename */
  filename: string;
  /** File size in bytes */
  fileSize: number;
  /** Created timestamp */
  createdAt: Date;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
  /** Error if failed */
  error?: Error;
  /** Retry count */
  retryCount: number;
  /** Maximum retries */
  maxRetries: number;
}

/**
 * Rate limit check result
 */
export interface DownloadCheckResult {
  /** Is download allowed */
  allowed: boolean;
  /** Reason if not allowed */
  reason?: 'COOLDOWN' | 'SESSION_LIMIT' | 'DAILY_LIMIT' | 'QUEUE_FULL';
  /** Retry after seconds */
  retryAfter?: number;
  /** Is this a warning (can proceed but approaching limit) */
  warning?: boolean;
  /** Warning/error message */
  message?: string;
}

/**
 * Download limits configuration
 */
export interface DownloadLimits {
  /** Cooldown between same file downloads (seconds) */
  sameFileCooldown: number;
  /** Maximum downloads per session */
  maxDownloadsPerSession: number;
  /** Maximum downloads per day */
  maxDownloadsPerDay: number;
  /** Warn when approaching limit (downloads remaining) */
  warnAtDownloads: number;
  /** Maximum concurrent downloads */
  maxConcurrent: number;
  /** Maximum queue size */
  maxQueueSize: number;
  /** Maximum retry attempts */
  maxRetries: number;
}

/**
 * Download statistics
 */
export interface DownloadStats {
  /** Total downloads (all time) */
  totalDownloads: number;
  /** Downloads this session */
  sessionDownloads: number;
  /** Downloads today */
  dailyDownloads: number;
  /** Failed downloads */
  failedDownloads: number;
  /** Total bytes downloaded */
  totalBytesDownloaded: number;
  /** Current active downloads */
  activeDownloads: number;
  /** Queued downloads */
  queuedDownloads: number;
  /** Average download speed (bytes/sec) */
  averageSpeed: number;
}

/**
 * Download configuration
 */
export interface DownloadConfig {
  /** Download limits */
  limits?: Partial<DownloadLimits>;
  /** Enable automatic retries */
  enableRetries?: boolean;
  /** Maximum retry attempts */
  maxRetries?: number;
  /** Retry delay in seconds */
  retryDelay?: number;
  /** Enable download queue */
  enableQueue?: boolean;
  /** Auto-start queued downloads */
  autoStartQueue?: boolean;
  /** Save download history */
  saveHistory?: boolean;
  /** History storage key */
  historyStorageKey?: string;
  /** Maximum history entries */
  maxHistoryEntries?: number;
  /** Verify downloads with checksum */
  verifyChecksum?: boolean;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Download events
 */
export interface DownloadEvents {
  /** Download started */
  start: (item: DownloadItem) => void;
  /** Download progress updated */
  progress: (item: DownloadItem, progress: DownloadProgress) => void;
  /** Download completed */
  complete: (item: DownloadItem) => void;
  /** Download failed */
  failed: (item: DownloadItem, error: Error) => void;
  /** Download cancelled */
  cancelled: (item: DownloadItem) => void;
  /** Download paused */
  paused: (item: DownloadItem) => void;
  /** Download resumed */
  resumed: (item: DownloadItem) => void;
  /** Download queued */
  queued: (item: DownloadItem) => void;
  /** Queue changed */
  queuechange: (queue: DownloadItem[]) => void;
  /** Rate limit warning */
  ratelimitwarning: (result: DownloadCheckResult) => void;
  /** Rate limit exceeded */
  ratelimitexceeded: (result: DownloadCheckResult) => void;
  /** All downloads completed */
  allcomplete: () => void;
}

/**
 * Download history entry
 */
export interface DownloadHistoryEntry {
  /** Download ID */
  id: string;
  /** Item type */
  type: DownloadableType;
  /** Item ID (track_id, album_id, tracker_id) */
  itemId: string;
  /** Item title */
  title: string;
  /** Artist name */
  artist: string;
  /** File size in bytes */
  fileSize: number;
  /** Download status */
  status: DownloadStatus;
  /** Downloaded timestamp */
  downloadedAt: Date;
  /** Duration in seconds */
  duration: number;
  /** Success flag */
  success: boolean;
  /** Error message if failed */
  errorMessage?: string;
}

/**
 * Batch download options
 */
export interface BatchDownloadOptions {
  /** Download priority */
  priority?: DownloadPriority;
  /** Start immediately or queue */
  startImmediately?: boolean;
  /** Verify checksums */
  verifyChecksums?: boolean;
}

/**
 * Download verification result
 */
export interface DownloadVerification {
  /** Verification passed */
  verified: boolean;
  /** Expected checksum */
  expectedChecksum?: string;
  /** Actual checksum */
  actualChecksum?: string;
  /** Algorithm used */
  algorithm?: string;
  /** Error if verification failed */
  error?: Error;
}
