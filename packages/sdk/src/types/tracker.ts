/**
 * Tracker playback types and interfaces
 *
 * Supports playback of tracker modules (MOD, XM, S3M, IT, etc.)
 * using libopenmpt.js or chiptune2.js
 */

import type { TrackerModule } from './index';

/**
 * Tracker playback engine
 */
export type TrackerEngine = 'libopenmpt' | 'chiptune2' | 'auto';

/**
 * Tracker playback status
 */
export type TrackerPlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/**
 * Tracker playback configuration
 */
export interface TrackerPlaybackConfig {
  /** Preferred tracker engine */
  engine?: TrackerEngine;
  /** Sample rate (default: 48000) */
  sampleRate?: number;
  /** Stereo separation (0-100, default: 100) */
  stereoSeparation?: number;
  /** Interpolation filter (default: 8) */
  interpolationFilter?: number;
  /** Volume ramping (default: -1 = default) */
  volumeRamping?: number;
  /** Loop count (-1 = infinite, 0 = no loop, n = loop n times) */
  loopCount?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Tracker module metadata from player
 */
export interface TrackerMetadata {
  /** Module title */
  title: string;
  /** Module type/format (e.g., "MOD", "XM", "S3M", "IT") */
  type: string;
  /** Number of channels */
  channels: number;
  /** Number of patterns */
  patterns: number;
  /** Number of instruments/samples */
  instruments: number;
  /** Module message/comment */
  message?: string;
  /** Tracker used to create */
  tracker?: string;
  /** Module duration in seconds */
  duration: number;
  /** Current pattern */
  currentPattern?: number;
  /** Current row */
  currentRow?: number;
  /** Current speed */
  currentSpeed?: number;
  /** Current BPM */
  currentBpm?: number;
}

/**
 * Tracker playback state
 */
export interface TrackerPlaybackState {
  /** Current tracker module */
  currentTracker: TrackerModule | null;
  /** Playback status */
  status: TrackerPlaybackStatus;
  /** Is currently playing */
  isPlaying: boolean;
  /** Current position in seconds */
  position: number;
  /** Total duration in seconds */
  duration: number;
  /** Volume (0-1) */
  volume: number;
  /** Is muted */
  muted: boolean;
  /** Repeat/loop enabled */
  repeat: boolean;
  /** Tracker metadata */
  metadata: TrackerMetadata | null;
  /** Current engine */
  engine: TrackerEngine | null;
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
}

/**
 * Tracker playback events
 */
export interface TrackerPlaybackEvents {
  /** Tracker started playing */
  play: (tracker: TrackerModule) => void;
  /** Playback paused */
  pause: () => void;
  /** Playback stopped */
  stop: () => void;
  /** Tracker ended */
  ended: () => void;
  /** Tracker loading started */
  loading: (tracker: TrackerModule) => void;
  /** Tracker loaded and ready */
  loaded: (tracker: TrackerModule, metadata: TrackerMetadata) => void;
  /** Playback position updated */
  timeupdate: (position: number, duration: number) => void;
  /** Volume changed */
  volumechange: (volume: number) => void;
  /** Mute state changed */
  mutechange: (muted: boolean) => void;
  /** Repeat mode changed */
  repeatchange: (enabled: boolean) => void;
  /** Tracker changed */
  trackerchange: (tracker: TrackerModule | null, previous: TrackerModule | null) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** State changed */
  statechange: (state: TrackerPlaybackState) => void;
  /** Pattern changed */
  patternchange: (pattern: number, row: number) => void;
  /** Metadata updated */
  metadatachange: (metadata: TrackerMetadata) => void;
}

/**
 * Tracker playback statistics
 */
export interface TrackerPlaybackStats {
  /** Total trackers played */
  trackersPlayed: number;
  /** Total playback time in seconds */
  totalPlayTime: number;
  /** Current session play time */
  sessionPlayTime: number;
  /** Most played format */
  topFormat: string | null;
  /** Average duration */
  averageDuration: number;
}

/**
 * Tracker player info
 */
export interface TrackerPlayerInfo {
  /** Engine name */
  engine: TrackerEngine;
  /** Engine version */
  version: string;
  /** Supported formats */
  supportedFormats: string[];
  /** Is available/loaded */
  available: boolean;
}

/**
 * libopenmpt module interface (minimal subset)
 */
export interface LibOpenMPTModule {
  /** Get module duration */
  duration: number;
  /** Get position in seconds */
  position_seconds: number;
  /** Set position in seconds */
  set_position_seconds(seconds: number): void;
  /** Get metadata */
  get_metadata(key: string): string;
  /** Get pattern count */
  get_num_patterns(): number;
  /** Get channel count */
  get_num_channels(): number;
  /** Get instrument count */
  get_num_instruments(): number;
  /** Get current pattern */
  get_current_pattern(): number;
  /** Get current row */
  get_current_row(): number;
  /** Get current speed */
  get_current_speed(): number;
  /** Get current tempo */
  get_current_tempo(): number;
  /** Get PCM data */
  read(bufferSize: number): [Float32Array, Float32Array];
  /** Cleanup */
  cleanup(): void;
}

/**
 * Chiptune2 player interface (minimal subset)
 */
export interface Chiptune2Player {
  /** Load module */
  load(url: string, callback: (buffer: ArrayBuffer) => void): void;
  /** Play module */
  play(buffer: ArrayBuffer): void;
  /** Stop playback */
  stop(): void;
  /** Get duration */
  duration(): number;
  /** Get position */
  position(): number;
  /** Seek to position */
  seek(seconds: number): void;
  /** Is playing */
  playing(): boolean;
  /** Get metadata */
  metadata(buffer: ArrayBuffer): {
    title: string;
    type: string;
    channels: number;
    patterns: number;
  };
}
