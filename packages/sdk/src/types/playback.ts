/**
 * Playback types and interfaces
 */

import type { Track } from './index';

/**
 * Playback status
 */
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';

/**
 * Repeat mode
 */
export type RepeatMode = 'off' | 'one' | 'all';

/**
 * Playback quality/bitrate
 */
export type PlaybackQuality = 'auto' | 'high' | 'medium' | 'low';

/**
 * Audio output mode
 */
export type AudioOutputMode = 'stereo' | 'mono';

/**
 * Crossfade mode
 */
export type CrossfadeMode = 'none' | 'short' | 'medium' | 'long';

/**
 * Playback state
 */
export interface PlaybackState {
  /** Current playing track */
  currentTrack: Track | null;
  /** Playback status */
  status: PlaybackStatus;
  /** Is currently playing */
  isPlaying: boolean;
  /** Current position in seconds */
  position: number;
  /** Track duration in seconds */
  duration: number;
  /** Volume (0-1) */
  volume: number;
  /** Is muted */
  muted: boolean;
  /** Playback speed (0.25 - 2.0) */
  playbackRate: number;
  /** Shuffle enabled */
  shuffle: boolean;
  /** Repeat mode */
  repeat: RepeatMode;
  /** Current queue */
  queue: Track[];
  /** Original queue (before shuffle) */
  originalQueue: Track[];
  /** Current position in queue */
  queuePosition: number;
  /** Has next track */
  hasNext: boolean;
  /** Has previous track */
  hasPrevious: boolean;
  /** Sleep timer */
  sleepTimer: {
    enabled: boolean;
    endsAt: Date | null;
    remainingMs: number;
  };
  /** Crossfade settings */
  crossfade: {
    enabled: boolean;
    duration: number;
  };
  /** Gapless playback state */
  gapless: GaplessConfig;
  /** Buffer state */
  buffer: BufferState;
  /** Loading state */
  loading: boolean;
  /** Error if any */
  error: Error | null;
}

/**
 * Playback configuration
 */
export interface PlaybackConfig {
  /** Initial volume (0-1) */
  volume?: number;
  /** Enable shuffle by default */
  shuffle?: boolean;
  /** Repeat mode */
  repeat?: RepeatMode;
  /** Crossfade duration in seconds */
  crossfadeDuration?: number;
  /** Enable crossfade */
  enableCrossfade?: boolean;
  /** Preload strategy */
  preload?: 'none' | 'metadata' | 'auto';
  /** Auto-play next track */
  autoPlayNext?: boolean;
  /** Save playback state to storage */
  persistState?: boolean;
  /** Storage key for persisted state */
  storageKey?: string;
  /** Enable gapless playback */
  enableGapless?: boolean;
  /** Gapless preload time in seconds */
  gaplessPreloadTime?: number;
  /** Enable Media Session API (lock screen controls, device broadcasting) */
  enableMediaSession?: boolean;
  /** Device name for media session */
  deviceName?: string;
  /** Enable scrobbling (listening history tracking) */
  enableScrobbling?: boolean;
  /** Scrobble threshold - percentage of track to consider "played" (0-100) */
  scrobbleThreshold?: number;
  /** Maximum scrobble history entries */
  maxScrobbleHistory?: number;
  /** Enable likes feature with localStorage */
  enableLikes?: boolean;
  /** Likes storage key */
  likesStorageKey?: string;
  /** Enable playback history */
  enableHistory?: boolean;
  /** Maximum history entries */
  maxHistoryEntries?: number;
  /** History storage key */
  historyStorageKey?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Playback events
 */
export interface PlaybackEvents {
  /** Track started playing */
  play: (track: Track) => void;
  /** Playback paused */
  pause: () => void;
  /** Playback stopped */
  stop: () => void;
  /** Track ended */
  ended: () => void;
  /** Track loading started */
  loading: (track: Track) => void;
  /** Track loaded and ready */
  loaded: (track: Track) => void;
  /** Playback position updated */
  timeupdate: (position: number, duration: number) => void;
  /** Volume changed */
  volumechange: (volume: number) => void;
  /** Mute state changed */
  mutechange: (muted: boolean) => void;
  /** Playback rate changed */
  ratechange: (rate: number) => void;
  /** Queue changed */
  queuechange: (queue: Track[], position: number) => void;
  /** Shuffle toggled */
  shufflechange: (enabled: boolean) => void;
  /** Repeat mode changed */
  repeatchange: (mode: RepeatMode) => void;
  /** Track changed */
  trackchange: (track: Track | null, previous: Track | null) => void;
  /** Error occurred */
  error: (error: Error) => void;
  /** State changed */
  statechange: (state: PlaybackState) => void;
  /** Sleep timer updated */
  sleeptimerchange: (enabled: boolean, remainingMs: number) => void;
  /** Scrobble recorded */
  scrobble: (entry: ScrobbleEntry) => void;
  /** Track liked */
  like: (track: LikedTrack) => void;
  /** Track unliked */
  unlike: (trackId: string) => void;
  /** Likes changed */
  likeschange: (likes: LikedTrack[]) => void;
  /** History entry added */
  historyadd: (entry: HistoryEntry) => void;
  /** History changed */
  historychange: (history: HistoryEntry[]) => void;
  /** Media session metadata updated (broadcasted to devices) */
  mediasessionupdate: (metadata: MediaSessionMetadata) => void;
  /** Buffer state changed */
  bufferchange: (buffer: BufferState) => void;
  /** Gapless transition started */
  gapless: (currentTrack: Track, nextTrack: Track) => void;
  /** Track skipped */
  skip: (event: SkipEvent) => void;
}

/**
 * Track info with playback metadata
 */
export interface TrackInfo {
  /** Track data */
  track: Track;
  /** Playback state */
  playbackState: {
    position: number;
    duration: number;
    isPlaying: boolean;
    volume: number;
  };
  /** Audio info */
  audioInfo: {
    bitRate: number;
    sampleRate: string;
    channels: string;
    format: string;
  };
  /** Metadata */
  metadata: {
    title: string;
    artist: string;
    album: string;
    year: string;
    genre: string;
    bpm: number;
    explicit: boolean;
  };
  /** Linked tracker modules */
  linkedTrackers: {
    tracker_id: string;
    tracker_title: string;
    format: string;
    file_size_bytes: number;
    checksum: string;
    albums_cdn_url: string;
    albums_s3_url: string;
    tracker_cdn_url: string;
    tracker_s3_url: string;
  }[];
}

/**
 * Playback statistics
 */
export interface PlaybackStats {
  /** Total tracks played */
  tracksPlayed: number;
  /** Total playback time in seconds */
  totalPlayTime: number;
  /** Current session play time */
  sessionPlayTime: number;
  /** Tracks in queue */
  queueLength: number;
  /** Average track duration */
  averageTrackDuration: number;
  /** Most played genre */
  topGenre: string | null;
  /** Buffer health (0-1) */
  bufferHealth: number;
}

/**
 * Seek target
 */
export interface SeekTarget {
  /** Target position in seconds */
  position: number;
  /** Percentage (0-100) */
  percentage?: number;
}

/**
 * Volume target
 */
export interface VolumeTarget {
  /** Target volume (0-1) */
  volume: number;
  /** Percentage (0-100) */
  percentage?: number;
  /** Fade duration in ms */
  fadeDuration?: number;
}

/**
 * Scrobble entry (listening history)
 */
export interface ScrobbleEntry {
  /** Track ID */
  trackId: string;
  /** Track title */
  title: string;
  /** Artist name */
  artist: string;
  /** Album name */
  album: string;
  /** Timestamp when played */
  timestamp: Date;
  /** Duration listened in seconds */
  duration: number;
  /** Percentage of track played (0-100) */
  percentagePlayed: number;
  /** Was the track skipped */
  skipped: boolean;
  /** Was the track completed */
  completed: boolean;
}

/**
 * Playback history entry
 */
export interface HistoryEntry {
  /** Track data */
  track: Track;
  /** When it was played */
  playedAt: Date;
  /** How much was played (seconds) */
  playedDuration: number;
  /** Was it completed */
  completed: boolean;
  /** Was it skipped */
  skipped: boolean;
}

/**
 * Track bookmark
 */
export interface TrackBookmark {
  /** Track ID */
  trackId: string;
  /** Position in seconds */
  position: number;
  /** Label/note */
  label?: string;
  /** Created timestamp */
  createdAt: Date;
}

/**
 * Gapless playback configuration
 */
export interface GaplessConfig {
  /** Enable gapless playback */
  enabled: boolean;
  /** Preload time before track ends (seconds) */
  preloadTime: number;
  /** Crossfade during gapless transition (seconds) */
  crossfadeDuration: number;
}

/**
 * Audio buffer state
 */
export interface BufferState {
  /** Buffered ranges */
  buffered: TimeRanges | null;
  /** Buffer health (0-1) */
  health: number;
  /** Is buffering */
  isBuffering: boolean;
  /** Buffered percentage */
  percentage: number;
}

/**
 * Comprehensive Media Session Metadata
 * Broadcasts to connected devices (lock screen, media controls, smart devices)
 */
export interface MediaSessionMetadata {
  /** Track title */
  title: string;
  /** Artist name */
  artist: string;
  /** Album name */
  album: string;
  /** Album artwork URLs in multiple sizes */
  artwork: {
    src: string;
    sizes: string;
    type: string;
  }[];
  /** Track duration in seconds */
  duration: number;
  /** Track number in album */
  trackNumber?: number;
  /** Total tracks in album */
  totalTracks?: number;
  /** Release year */
  year?: number;
  /** Genre */
  genre?: string;
  /** BPM */
  bpm?: number;
  /** Explicit content flag */
  explicit?: boolean;
  /** Current position in seconds */
  position?: number;
  /** Playback rate */
  playbackRate?: number;
  /** Queue information */
  queue?: {
    /** Current queue position */
    currentIndex: number;
    /** Total tracks in queue */
    totalTracks: number;
    /** Next track info */
    nextTrack?: {
      title: string;
      artist: string;
      artwork?: string;
    };
    /** Previous track info */
    previousTrack?: {
      title: string;
      artist: string;
      artwork?: string;
    };
    /** Queue name/playlist name */
    queueName?: string;
  };
  /** Playback state */
  playbackState?: {
    isPlaying: boolean;
    shuffle: boolean;
    repeat: RepeatMode;
    volume: number;
  };
  /** Session information for connected devices */
  session?: {
    /** Session ID for synchronization */
    sessionId: string;
    /** Device name */
    deviceName?: string;
    /** Last updated timestamp */
    lastUpdated: Date;
  };
}

/**
 * Skip tracking
 */
export interface SkipEvent {
  /** Track that was skipped */
  track: Track;
  /** Position when skipped */
  position: number;
  /** Timestamp */
  timestamp: Date;
  /** Reason for skip */
  reason: 'user' | 'error' | 'next' | 'previous';
}

/**
 * Liked track entry (stored in localStorage)
 */
export interface LikedTrack {
  /** Track ID */
  trackId: string;
  /** Track title */
  title: string;
  /** Artist name */
  artist: string;
  /** Album name */
  album: string;
  /** Album ID */
  albumId: string;
  /** When it was liked */
  likedAt: Date;
  /** Play count */
  playCount?: number;
  /** Last played timestamp */
  lastPlayedAt?: Date;
}

/**
 * Likes storage manager interface
 */
export interface LikesStorage {
  /** All liked tracks */
  tracks: LikedTrack[];
  /** Liked albums (track IDs grouped by album) */
  albums: Record<string, string[]>;
  /** Total likes */
  totalLikes: number;
  /** Last updated */
  lastUpdated: Date;
}
