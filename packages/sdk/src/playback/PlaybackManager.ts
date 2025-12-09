/**
 * PlaybackManager - Comprehensive Production-Ready Audio Playback Engine
 *
 * Features:
 * - HTML5 Audio API integration
 * - Queue management with shuffle/repeat
 * - Volume control with fading
 * - Crossfade between tracks
 * - Gapless playback
 * - Sleep timer
 * - Scrobbling (listening history tracking)
 * - Likes management with localStorage
 * - Playback history with localStorage
 * - Media Session API (lock screen controls, device broadcasting)
 * - Buffer state tracking
 * - Event system
 * - State persistence
 */

import type {
  Track,
  PlaybackState,
  PlaybackConfig,
  PlaybackEvents,
  RepeatMode,
  SeekTarget,
  VolumeTarget,
  TrackInfo,
  PlaybackStats,
  ScrobbleEntry,
  HistoryEntry,
  LikedTrack,
  LikesStorage,
  MediaSessionMetadata,
  SkipEvent,
} from '../types';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('PlaybackManager');

type EventMap = {
  [K in keyof PlaybackEvents]: PlaybackEvents[K][];
};

export class PlaybackManager {
  private config: Required<PlaybackConfig>;
  private audio: HTMLAudioElement;
  private nextAudio: HTMLAudioElement | null = null;
  private state: PlaybackState;
  private events: Partial<EventMap> = {};
  private sleepTimerTimeout: ReturnType<typeof setTimeout> | null = null;
  private updateInterval: ReturnType<typeof setInterval> | null = null;
  private stats: PlaybackStats;

  // Operation lock for serializing async operations
  private operationLock: Promise<void> | null = null;

  // Preload cache tracking
  private preloadedTrack: Track | null = null;

  // Time tracking for glitch filtering
  private previousTime = 0;
  private isSeeking = false;

  // Scrobbling
  private scrobbles: ScrobbleEntry[] = [];
  private trackStartTime = 0;
  private scrobbleThresholdReached = false;

  // Likes (localStorage)
  private likes: LikesStorage;

  // History (localStorage)
  private history: HistoryEntry[] = [];

  // Media Session
  private mediaSession: MediaSession | null = null;
  private sessionId: string;

  // Instance tracking
  private instanceId: string;
  private static instanceCount = 0;

  constructor(config?: PlaybackConfig) {
    // Track instance creation
    PlaybackManager.instanceCount++;
    this.instanceId = `PlaybackManager-${PlaybackManager.instanceCount}`;
    logger.warn(`🏗️ NEW PLAYBACK MANAGER INSTANCE CREATED: ${this.instanceId}`, {
      totalInstances: PlaybackManager.instanceCount,
      stackTrace: new Error().stack?.split('\n').slice(0, 5).join('\n'),
    });
    this.config = {
      volume: config?.volume ?? 0.8,
      shuffle: config?.shuffle ?? false,
      repeat: config?.repeat ?? 'off',
      crossfadeDuration: config?.crossfadeDuration ?? 3,
      enableCrossfade: config?.enableCrossfade ?? false,
      preload: config?.preload ?? 'metadata',
      autoPlayNext: config?.autoPlayNext ?? true,
      persistState: config?.persistState ?? false,
      storageKey: config?.storageKey ?? 'music-service-playback-state',
      enableGapless: config?.enableGapless ?? true,
      gaplessPreloadTime: config?.gaplessPreloadTime ?? 5,
      enableMediaSession: config?.enableMediaSession ?? true,
      deviceName: config?.deviceName ?? 'Music Service Player',
      enableScrobbling: config?.enableScrobbling ?? true,
      scrobbleThreshold: config?.scrobbleThreshold ?? 50,
      maxScrobbleHistory: config?.maxScrobbleHistory ?? 1000,
      enableLikes: config?.enableLikes ?? true,
      likesStorageKey: config?.likesStorageKey ?? 'music-service-likes',
      enableHistory: config?.enableHistory ?? true,
      maxHistoryEntries: config?.maxHistoryEntries ?? 500,
      historyStorageKey: config?.historyStorageKey ?? 'music-service-history',
      debug: config?.debug ?? false,
    };

    // Generate session ID
    this.sessionId = this.generateSessionId();

    // Initialize audio element
    this.audio = new Audio();
    this.audio.preload = this.config.preload;
    this.audio.volume = this.config.volume;

    // Initialize state
    this.state = this.createInitialState();

    // Initialize stats
    this.stats = {
      tracksPlayed: 0,
      totalPlayTime: 0,
      sessionPlayTime: 0,
      queueLength: 0,
      averageTrackDuration: 0,
      topGenre: null,
      bufferHealth: 1,
    };

    // Initialize likes
    this.likes = this.loadLikes();

    // Initialize history
    this.history = this.loadHistory();

    // Initialize Media Session API
    if (this.config.enableMediaSession && 'mediaSession' in navigator) {
      this.mediaSession = navigator.mediaSession;
      this.setupMediaSessionHandlers();
    }

    // Restore persisted state
    if (this.config.persistState) {
      this.restoreState();
    }

    // Setup audio event listeners
    this.setupAudioEvents();

    // Start update interval
    this.startUpdateInterval();

    logger.debug('Initialized', { config: this.config });
  }

  // ============================================================================
  // Playback Controls
  // ============================================================================

  async play(track?: Track): Promise<void> {
    try {
      if (track) {
        this.loadTrack(track);
      }

      if (!this.state.currentTrack) {
        throw new Error('No track to play');
      }

      this.state.status = 'loading';
      this.emit('loading', this.state.currentTrack);

      await this.audio.play();

      this.state.isPlaying = true;
      this.state.status = 'playing';
      this.trackStartTime = Date.now();
      this.scrobbleThresholdReached = false;

      this.emit('play', this.state.currentTrack);
      this.emitStateChange();

      // Update Media Session
      this.updateMediaSession();

      // Preload next for gapless
      if (this.config.enableGapless && this.state.hasNext) {
        this.preloadNextTrack();
      }

      logger.debug('Playing', { title: this.state.currentTrack.track_name });
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  pause(): void {
    if (!this.audio.paused) {
      this.audio.pause();
      this.state.isPlaying = false;
      this.state.status = 'paused';

      this.emit('pause');
      this.emitStateChange();
      this.updateMediaSession();

      logger.debug('Paused');
    }
  }

  stop(): void {
    this.pause();
    this.audio.currentTime = 0;
    this.state.position = 0;
    this.state.status = 'idle';

    // Record scrobble/history before stopping
    if (this.state.currentTrack) {
      this.recordScrobble(true);
    }

    this.emit('stop');
    this.emitStateChange();

    logger.debug('Stopped');
  }

  async togglePlayPause(): Promise<void> {
    if (this.state.isPlaying) {
      this.pause();
    } else {
      await this.play();
    }
  }

  seek(target: number | SeekTarget): void {
    const position = typeof target === 'number' ? target : target.position;
    const clampedPosition = Math.max(0, Math.min(position, this.state.duration));

    // Set seeking flag to allow legitimate seeks to 0
    this.isSeeking = true;

    this.audio.currentTime = clampedPosition;
    this.state.position = clampedPosition;
    this.previousTime = clampedPosition; // Reset previous time on seek

    this.emit('timeupdate', this.state.position, this.state.duration);
    this.emitStateChange();
    this.updateMediaSession();

    // Reset seeking flag after a short delay to allow audio element to settle
    setTimeout(() => {
      this.isSeeking = false;
    }, 100);
  }

  skipForward(seconds = 10): void {
    this.seek(this.state.position + seconds);
  }

  skipBackward(seconds = 10): void {
    this.seek(this.state.position - seconds);
  }

  // ============================================================================
  // Queue Management
  // ============================================================================

  setQueue(tracks: Track[], startIndex = 0): void {
    logger.info(`=== setQueue START [${this.instanceId}] ===`, {
      instance: this.instanceId,
      tracksCount: tracks.length,
      startIndex,
      currentQueueLength: this.state.queue.length,
    });

    // Clear stale preload cache before updating queue
    this.clearPreloadCache();

    // Handle shuffle: if shuffle is enabled and startIndex is provided,
    // preserve the clicked track at position 0
    if (this.state.shuffle && startIndex > 0 && startIndex < tracks.length) {
      const clickedTrack = tracks[startIndex];
      const otherTracks = tracks.filter((_, i) => i !== startIndex);
      const shuffled = this.shuffleArray(otherTracks);

      this.state.queue = [clickedTrack, ...shuffled];
      this.state.originalQueue = [...tracks];
      this.state.queuePosition = 0; // Start at clicked track
    } else if (this.state.shuffle) {
      // Normal shuffle without preserving specific track
      this.state.queue = this.shuffleArray([...tracks]);
      this.state.originalQueue = [...tracks];
      this.state.queuePosition = startIndex;
    } else {
      // No shuffle
      this.state.queue = [...tracks];
      this.state.originalQueue = [...tracks];
      this.state.queuePosition = startIndex;
    }

    this.updateQueueState();

    // Emit queuechange BEFORE refreshing preload (ensures event order)
    this.emit('queuechange', this.state.queue, this.state.queuePosition);
    this.emitStateChange();
    this.updateMediaSession();

    // Refresh preload cache with new next track
    this.refreshPreload();

    this.stats.queueLength = tracks.length;

    logger.info('=== setQueue END ===', {
      finalQueueLength: this.state.queue.length,
      originalQueueLength: this.state.originalQueue.length,
      position: this.state.queuePosition,
    });
  }

  addToQueue(track: Track, position?: number): void {
    if (position !== undefined) {
      this.state.queue.splice(position, 0, track);
      this.state.originalQueue.splice(position, 0, track);
      if (position <= this.state.queuePosition) {
        this.state.queuePosition++;
      }
    } else {
      this.state.queue.push(track);
      this.state.originalQueue.push(track);
    }

    this.updateQueueState();
    this.emit('queuechange', this.state.queue, this.state.queuePosition);
    this.emitStateChange();

    // Refresh preload if adding near current position
    if (position !== undefined && position === this.state.queuePosition + 1) {
      this.refreshPreload();
    }

    this.stats.queueLength = this.state.queue.length;
  }

  addTracksToQueue(tracks: Track[], position?: number): void {
    if (position !== undefined) {
      this.state.queue.splice(position, 0, ...tracks);
      this.state.originalQueue.splice(position, 0, ...tracks);
      if (position <= this.state.queuePosition) {
        this.state.queuePosition += tracks.length;
      }
    } else {
      this.state.queue.push(...tracks);
      this.state.originalQueue.push(...tracks);
    }

    this.updateQueueState();
    this.emit('queuechange', this.state.queue, this.state.queuePosition);
    this.emitStateChange();

    this.stats.queueLength = this.state.queue.length;
  }

  removeFromQueue(index: number): void {
    if (index < 0 || index >= this.state.queue.length) {
      logger.warn('removeFromQueue: Invalid index', {
        index,
        queueLength: this.state.queue.length,
      });
      return;
    }

    logger.info('=== removeFromQueue START ===');
    const queueLengthBefore = this.state.queue.length;
    logger.info('Before removal:', {
      index,
      queueLength: queueLengthBefore,
      originalQueueLength: this.state.originalQueue.length,
      position: this.state.queuePosition,
      trackToRemove: this.state.queue[index]?.track_name,
    });

    // Get track BEFORE removing it
    const trackToRemove = this.state.queue[index];

    // Remove from queue
    this.state.queue.splice(index, 1);

    // Remove from originalQueue using the correct track
    if (trackToRemove) {
      const originalIndex = this.state.originalQueue.findIndex(
        (t) => t.track_id === trackToRemove.track_id
      );
      if (originalIndex !== -1) {
        this.state.originalQueue.splice(originalIndex, 1);
      }
    }

    // Adjust queue position
    if (index < this.state.queuePosition) {
      this.state.queuePosition--;
    } else if (index === this.state.queuePosition && this.state.queue.length > 0) {
      this.state.queuePosition = Math.min(this.state.queuePosition, this.state.queue.length - 1);
    }

    this.updateQueueState();
    this.emit('queuechange', this.state.queue, this.state.queuePosition);
    this.emitStateChange();

    // Refresh preload if removing next track
    if (index === this.state.queuePosition + 1) {
      this.refreshPreload();
    }

    this.stats.queueLength = this.state.queue.length;

    // Defensive check
    const queueLengthAfter = this.state.queue.length;
    if (queueLengthAfter !== queueLengthBefore - 1) {
      logger.error('removeFromQueue: Queue length incorrect!', {
        before: queueLengthBefore,
        after: queueLengthAfter,
        expected: queueLengthBefore - 1,
      });
    }

    logger.info('After removal:', {
      removedTrack: trackToRemove?.track_name,
      queueLength: queueLengthAfter,
      position: this.state.queuePosition,
      currentTrack: this.state.currentTrack?.track_name,
    });
    logger.info('=== removeFromQueue END ===');
  }

  clearQueue(): void {
    logger.warn('=== clearQueue() CALLED ===', {
      previousQueueLength: this.state.queue.length,
      stackTrace: new Error().stack,
    });

    // Clear preload when clearing queue
    this.clearPreloadCache();

    this.state.queue = [];
    this.state.originalQueue = [];
    this.state.queuePosition = 0;
    this.updateQueueState();

    this.emit('queuechange', this.state.queue, this.state.queuePosition);
    this.emitStateChange();

    this.stats.queueLength = 0;
  }

  async next(): Promise<void> {
    return this.lockOperation(async () => {
      // Handle circular queue rotation for repeat all mode
      if (this.state.repeat === 'all' && this.state.queue.length > 1) {
        logger.debug('Circular queue: rotating queue forward (repeat all mode)');

        // Validate queue state
        if (!this.validateQueueState()) {
          logger.error('next() aborted: invalid queue state');
          return;
        }

        const previousTrack = this.state.currentTrack;

        // Record scrobble for current track
        if (previousTrack) {
          this.recordScrobble(false);
          this.recordSkip('next');
        }

        // Get and remove current track
        const currentTrack = this.state.queue[this.state.queuePosition];
        if (!currentTrack) {
          logger.error('Circular queue: current track is undefined');
          return;
        }

        // Remove current track from queue
        this.state.queue.splice(this.state.queuePosition, 1);

        // Append to end
        this.state.queue.push(currentTrack);

        // Position stays the same - now points to what was the next track
        // No need to increment queuePosition

        // Update queue state (hasNext, hasPrevious)
        this.updateQueueState();

        // Emit queue change for UI updates (shows rotation effect)
        this.emit('queuechange', this.state.queue, this.state.queuePosition);
        this.emitStateChange();

        // Clear and refresh preload cache since queue structure changed
        this.refreshPreload();

        // Play the track now at current position
        const nextTrack = this.state.queue[this.state.queuePosition];
        if (!nextTrack) {
          logger.error('Circular queue: next track is undefined after rotation');
          return;
        }

        await this.play(nextTrack);
        this.emit('trackchange', this.state.currentTrack, previousTrack);

        logger.debug('Circular queue: rotation complete', {
          newCurrentTrack: nextTrack.track_name,
          rotatedTrack: currentTrack.track_name,
          queueLength: this.state.queue.length,
          position: this.state.queuePosition,
        });

        return;
      }

      // Original logic for non-repeat-all or single track queue
      if (!this.state.hasNext) return;

      // Validate queue state before proceeding
      if (!this.validateQueueState()) {
        logger.error('next() aborted: invalid queue state');
        return;
      }

      const previousTrack = this.state.currentTrack;

      // Record scrobble for current track
      if (previousTrack) {
        this.recordScrobble(false);
        this.recordSkip('next');
      }

      // Verify preload cache matches current queue
      if (this.config.enableGapless && this.nextAudio) {
        if (!this.verifyPreloadCache()) {
          logger.warn('Preload cache invalid, refreshing before transition');
          this.refreshPreload();
        }

        // Check again if we still have a valid preload after refresh
        if (this.nextAudio) {
          await this.gaplessTransition();
        } else {
          // Preload refresh failed, fallback to regular play
          this.state.queuePosition++;

          // Safety check: ensure we don't go past queue length
          if (this.state.queuePosition >= this.state.queue.length) {
            logger.error('next() called past end of queue', {
              position: this.state.queuePosition,
              queueLength: this.state.queue.length,
            });
            this.state.queuePosition = this.state.queue.length - 1;
            return;
          }

          const nextTrack = this.state.queue[this.state.queuePosition];
          await this.play(nextTrack);
        }
      } else {
        // No gapless or no preload - regular play
        this.state.queuePosition++;

        // Safety check: ensure we don't go past queue length
        if (this.state.queuePosition >= this.state.queue.length) {
          logger.error('next() called past end of queue', {
            position: this.state.queuePosition,
            queueLength: this.state.queue.length,
          });
          this.state.queuePosition = this.state.queue.length - 1;
          return;
        }

        const nextTrack = this.state.queue[this.state.queuePosition];
        await this.play(nextTrack);
      }

      this.emit('trackchange', this.state.currentTrack, previousTrack);
    });
  }

  async previous(): Promise<void> {
    return this.lockOperation(async () => {
      if (this.state.position > 3) {
        this.seek(0);
        return;
      }

      // Handle circular queue rotation in reverse for repeat all mode
      if (this.state.repeat === 'all' && this.state.queue.length > 1) {
        logger.debug('Circular queue: rotating queue backward (repeat all mode)');

        // Validate queue state
        if (!this.validateQueueState()) {
          logger.error('previous() aborted: invalid queue state');
          return;
        }

        const previousTrack = this.state.currentTrack;

        if (previousTrack) {
          this.recordSkip('previous');
        }

        // Remove last track from queue
        const lastTrack = this.state.queue.pop();
        if (!lastTrack) {
          logger.error('Circular queue: last track is undefined');
          return;
        }

        // Insert at beginning
        this.state.queue.unshift(lastTrack);

        // Increment position to maintain relative position
        // (since we inserted a track before current position)
        if (this.state.queuePosition >= 0) {
          this.state.queuePosition++;
        }

        // Now decrement to move to previous track
        this.state.queuePosition--;

        // Safety check
        if (this.state.queuePosition < 0) {
          logger.error('Circular queue: position negative after rotation');
          this.state.queuePosition = 0;
          return;
        }

        // Update queue state
        this.updateQueueState();

        // Emit queue change for UI updates (shows rotation effect)
        this.emit('queuechange', this.state.queue, this.state.queuePosition);
        this.emitStateChange();

        // Clear and refresh preload cache since queue structure changed
        this.refreshPreload();

        // Play the track at new position
        const prevTrack = this.state.queue[this.state.queuePosition];
        if (!prevTrack) {
          logger.error('Circular queue: previous track is undefined after rotation');
          return;
        }

        await this.play(prevTrack);
        this.emit('trackchange', this.state.currentTrack, previousTrack);

        logger.debug('Circular queue: reverse rotation complete', {
          newCurrentTrack: prevTrack.track_name,
          rotatedTrack: lastTrack.track_name,
          queueLength: this.state.queue.length,
          position: this.state.queuePosition,
        });

        return;
      }

      // Original logic for non-repeat-all or single track queue
      if (!this.state.hasPrevious) return;

      // Validate queue state before proceeding
      if (!this.validateQueueState()) {
        logger.error('previous() aborted: invalid queue state');
        return;
      }

      const previousTrack = this.state.currentTrack;

      if (previousTrack) {
        this.recordSkip('previous');
      }

      this.state.queuePosition--;

      // Safety check: ensure position is valid after decrement
      if (this.state.queuePosition < 0) {
        logger.error('previous() resulted in negative position', {
          position: this.state.queuePosition,
        });
        this.state.queuePosition = 0;
        return;
      }

      const prevTrack = this.state.queue[this.state.queuePosition];
      if (!prevTrack) {
        logger.error('previous() track is undefined at position', {
          position: this.state.queuePosition,
        });
        return;
      }

      await this.play(prevTrack);

      this.emit('trackchange', this.state.currentTrack, previousTrack);
    });
  }

  async jumpTo(index: number): Promise<void> {
    if (index < 0 || index >= this.state.queue.length) {
      throw new Error(`Invalid queue index: ${index}`);
    }

    const previousTrack = this.state.currentTrack;

    if (previousTrack) {
      this.recordScrobble(false);
      this.recordSkip('user');
    }

    this.state.queuePosition = index;
    const track = this.state.queue[index];
    await this.play(track);

    this.emit('trackchange', this.state.currentTrack, previousTrack);
  }

  // ============================================================================
  // Shuffle & Repeat
  // ============================================================================

  toggleShuffle(): void {
    this.setShuffle(!this.state.shuffle);
  }

  setShuffle(enabled: boolean): void {
    if (this.state.shuffle === enabled) return;

    this.state.shuffle = enabled;

    if (enabled) {
      const currentTrack = this.state.currentTrack;
      const otherTracks = this.state.queue.filter((t) => t.track_id !== currentTrack?.track_id);
      const shuffled = this.shuffleArray(otherTracks);

      if (currentTrack) {
        this.state.queue = [currentTrack, ...shuffled];
        this.state.queuePosition = 0;
      } else {
        this.state.queue = shuffled;
      }
    } else {
      this.state.queue = [...this.state.originalQueue];

      if (this.state.currentTrack) {
        const index = this.state.queue.findIndex(
          (t) => t.track_id === this.state.currentTrack!.track_id
        );
        if (index !== -1) {
          this.state.queuePosition = index;
        }
      }
    }

    this.updateQueueState();
    this.emit('shufflechange', enabled);
    this.emit('queuechange', this.state.queue, this.state.queuePosition);
    this.emitStateChange();
    this.updateMediaSession();
  }

  setRepeat(mode: RepeatMode): void {
    this.state.repeat = mode;
    this.updateQueueState();

    this.emit('repeatchange', mode);
    this.emitStateChange();
    this.updateMediaSession();
  }

  cycleRepeat(): void {
    const modes: RepeatMode[] = ['off', 'all', 'one'];
    const currentIndex = modes.indexOf(this.state.repeat);
    const nextMode = modes[(currentIndex + 1) % modes.length];
    this.setRepeat(nextMode);
  }

  // ============================================================================
  // Volume Controls
  // ============================================================================

  setVolume(target: number | VolumeTarget): void {
    const volumeData = typeof target === 'number' ? { volume: target } : target;
    const volume = Math.max(0, Math.min(1, volumeData.volume));

    if (volumeData.fadeDuration && volumeData.fadeDuration > 0) {
      this.fadeVolume(this.state.volume, volume, volumeData.fadeDuration);
    } else {
      this.audio.volume = volume;
      this.state.volume = volume;
      this.emit('volumechange', volume);
      this.emitStateChange();
      this.updateMediaSession();
    }
  }

  getVolume(): number {
    return this.state.volume;
  }

  mute(): void {
    this.audio.muted = true;
    this.state.muted = true;
    this.emit('mutechange', true);
    this.emitStateChange();
  }

  unmute(): void {
    this.audio.muted = false;
    this.state.muted = false;
    this.emit('mutechange', false);
    this.emitStateChange();
  }

  toggleMute(): void {
    if (this.state.muted) {
      this.unmute();
    } else {
      this.mute();
    }
  }

  private fadeVolume(from: number, to: number, duration: number): void {
    const steps = 20;
    const stepDuration = duration / steps;
    const volumeStep = (to - from) / steps;
    let currentStep = 0;

    const fadeInterval = setInterval(() => {
      currentStep++;
      const newVolume = from + volumeStep * currentStep;

      this.audio.volume = Math.max(0, Math.min(1, newVolume));
      this.state.volume = this.audio.volume;

      if (currentStep >= steps) {
        clearInterval(fadeInterval);
        this.audio.volume = to;
        this.state.volume = to;
        this.emit('volumechange', to);
        this.emitStateChange();
      }
    }, stepDuration);
  }

  // ============================================================================
  // Playback Rate
  // ============================================================================

  setPlaybackRate(rate: number): void {
    const clampedRate = Math.max(0.25, Math.min(2.0, rate));
    this.audio.playbackRate = clampedRate;
    this.state.playbackRate = clampedRate;

    this.emit('ratechange', clampedRate);
    this.emitStateChange();
    this.updateMediaSession();
  }

  resetPlaybackRate(): void {
    this.setPlaybackRate(1.0);
  }

  // ============================================================================
  // Sleep Timer
  // ============================================================================

  setSleepTimer(minutes: number): void {
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
    }

    const ms = minutes * 60 * 1000;
    const endsAt = new Date(Date.now() + ms);

    this.state.sleepTimer = {
      enabled: true,
      endsAt,
      remainingMs: ms,
    };

    this.sleepTimerTimeout = setTimeout(() => {
      this.pause();
      this.state.sleepTimer = {
        enabled: false,
        endsAt: null,
        remainingMs: 0,
      };
      this.emit('sleeptimerchange', false, 0);
      this.emitStateChange();
    }, ms);

    this.emit('sleeptimerchange', true, ms);
    this.emitStateChange();
  }

  cancelSleepTimer(): void {
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
      this.sleepTimerTimeout = null;
    }

    this.state.sleepTimer = {
      enabled: false,
      endsAt: null,
      remainingMs: 0,
    };

    this.emit('sleeptimerchange', false, 0);
    this.emitStateChange();
  }

  // ============================================================================
  // Likes Management (localStorage)
  // ============================================================================

  likeTrack(track: Track): void {
    if (!this.config.enableLikes) return;

    const existingIndex = this.likes.tracks.findIndex((l) => l.trackId === track.track_id);
    if (existingIndex !== -1) return; // Already liked

    const likedTrack: LikedTrack = {
      trackId: track.track_id,
      title: track.track_name,
      artist: track.artist,
      album: track.album,
      albumId: track.album_id,
      likedAt: new Date(),
      playCount: 0,
      lastPlayedAt: undefined,
    };

    this.likes.tracks.unshift(likedTrack);
    this.likes.totalLikes++;
    this.likes.lastUpdated = new Date();

    // Group by album
    if (!this.likes.albums[track.album_id]) {
      this.likes.albums[track.album_id] = [];
    }
    this.likes.albums[track.album_id].push(track.track_id);

    this.saveLikes();
    this.emit('like', likedTrack);
    this.emit('likeschange', this.likes.tracks);

    logger.debug('Liked track', { title: track.track_name });
  }

  unlikeTrack(trackId: string): void {
    if (!this.config.enableLikes) return;

    const index = this.likes.tracks.findIndex((l) => l.trackId === trackId);
    if (index === -1) return;

    const likedTrack = this.likes.tracks[index];
    this.likes.tracks.splice(index, 1);
    this.likes.totalLikes--;
    this.likes.lastUpdated = new Date();

    // Remove from album group
    if (this.likes.albums[likedTrack.albumId]) {
      this.likes.albums[likedTrack.albumId] = this.likes.albums[likedTrack.albumId].filter(
        (id) => id !== trackId
      );
      if (this.likes.albums[likedTrack.albumId].length === 0) {
        delete this.likes.albums[likedTrack.albumId];
      }
    }

    this.saveLikes();
    this.emit('unlike', trackId);
    this.emit('likeschange', this.likes.tracks);

    logger.debug('Unliked track', { trackId });
  }

  isLiked(trackId: string): boolean {
    return this.likes.tracks.some((l) => l.trackId === trackId);
  }

  getLikedTracks(): LikedTrack[] {
    return [...this.likes.tracks];
  }

  getLikedAlbums(): Record<string, string[]> {
    return { ...this.likes.albums };
  }

  clearLikes(): void {
    this.likes = {
      tracks: [],
      albums: {},
      totalLikes: 0,
      lastUpdated: new Date(),
    };
    this.saveLikes();
    this.emit('likeschange', []);
  }

  // ============================================================================
  // History Management (localStorage)
  // ============================================================================

  getHistory(): HistoryEntry[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
    this.saveHistory();
    this.emit('historychange', []);
  }

  private addToHistory(
    track: Track,
    playedDuration: number,
    completed: boolean,
    skipped: boolean
  ): void {
    if (!this.config.enableHistory) return;

    const entry: HistoryEntry = {
      track,
      playedAt: new Date(),
      playedDuration,
      completed,
      skipped,
    };

    this.history.unshift(entry);

    // Limit history size
    if (this.history.length > this.config.maxHistoryEntries) {
      this.history = this.history.slice(0, this.config.maxHistoryEntries);
    }

    // Update play count in likes if track is liked
    const likedIndex = this.likes.tracks.findIndex((l) => l.trackId === track.track_id);
    if (likedIndex !== -1) {
      this.likes.tracks[likedIndex].playCount = (this.likes.tracks[likedIndex].playCount ?? 0) + 1;
      this.likes.tracks[likedIndex].lastPlayedAt = new Date();
      this.saveLikes();
    }

    this.saveHistory();
    this.emit('historyadd', entry);
    this.emit('historychange', this.history);
  }

  // ============================================================================
  // Scrobbling
  // ============================================================================

  getScrobbles(): ScrobbleEntry[] {
    return [...this.scrobbles];
  }

  clearScrobbles(): void {
    this.scrobbles = [];
  }

  private recordScrobble(stopped: boolean): void {
    if (!this.config.enableScrobbling || !this.state.currentTrack) return;

    const track = this.state.currentTrack;
    const playedDuration = (Date.now() - this.trackStartTime) / 1000;
    const percentagePlayed = (playedDuration / this.state.duration) * 100;

    const entry: ScrobbleEntry = {
      trackId: track.track_id,
      title: track.track_name,
      artist: track.artist,
      album: track.album,
      timestamp: new Date(),
      duration: playedDuration,
      percentagePlayed,
      skipped: !stopped && percentagePlayed < this.config.scrobbleThreshold,
      completed: percentagePlayed >= 95,
    };

    this.scrobbles.unshift(entry);

    // Limit scrobble history
    if (this.scrobbles.length > this.config.maxScrobbleHistory) {
      this.scrobbles = this.scrobbles.slice(0, this.config.maxScrobbleHistory);
    }

    // Add to history
    this.addToHistory(track, playedDuration, entry.completed, entry.skipped);

    this.emit('scrobble', entry);

    logger.debug('Scrobble recorded', entry);
  }

  private recordSkip(reason: 'user' | 'error' | 'next' | 'previous'): void {
    if (!this.state.currentTrack) return;

    const skipEvent: SkipEvent = {
      track: this.state.currentTrack,
      position: this.state.position,
      timestamp: new Date(),
      reason,
    };

    this.emit('skip', skipEvent);
  }

  // ============================================================================
  // Media Session API (Device Broadcasting)
  // ============================================================================

  private updateMediaSession(): void {
    if (!this.mediaSession || !this.state.currentTrack) return;

    const track = this.state.currentTrack;

    // Get queue info
    const nextTrack = this.state.hasNext
      ? this.state.queue[this.state.queuePosition + 1]
      : undefined;
    const previousTrack = this.state.hasPrevious
      ? this.state.queue[this.state.queuePosition - 1]
      : undefined;

    const metadata: MediaSessionMetadata = {
      title: track.track_name,
      artist: track.artist,
      album: track.album,
      artwork: [
        {
          src: track.cover_art?.full ?? track.cdn_url,
          sizes: '512x512',
          type: 'image/jpeg',
        },
        {
          src: track.cover_art?.thumbnail ?? track.cdn_url,
          sizes: '256x256',
          type: 'image/jpeg',
        },
      ],
      duration: this.state.duration,
      trackNumber: track.track_position ? parseInt(track.track_position) : 0,
      year: parseInt(track.recorded_date),
      genre: track.genre ?? 'Unknown',
      bpm: track.bpm_numeric,
      explicit: track.explicit,
      position: this.state.position,
      playbackRate: this.state.playbackRate,
      queue: {
        currentIndex: this.state.queuePosition,
        totalTracks: this.state.queue.length,
        nextTrack: nextTrack
          ? {
              title: nextTrack.track_name,
              artist: nextTrack.artist,
              artwork: nextTrack.cover_art?.thumbnail,
            }
          : undefined,
        previousTrack: previousTrack
          ? {
              title: previousTrack.track_name,
              artist: previousTrack.artist,
              artwork: previousTrack.cover_art?.thumbnail,
            }
          : undefined,
      },
      playbackState: {
        isPlaying: this.state.isPlaying,
        shuffle: this.state.shuffle,
        repeat: this.state.repeat,
        volume: this.state.volume,
      },
      session: {
        sessionId: this.sessionId,
        deviceName: this.config.deviceName,
        lastUpdated: new Date(),
      },
    };

    // Update native media session
    this.mediaSession.metadata = new MediaMetadata({
      title: metadata.title,
      artist: metadata.artist,
      album: metadata.album,
      artwork: metadata.artwork,
    });

    // Update position state
    this.mediaSession.setPositionState({
      duration: this.state.duration,
      playbackRate: this.state.playbackRate,
      position: this.state.position,
    });

    // Emit custom event with full metadata
    this.emit('mediasessionupdate', metadata);

    logger.debug('Media session updated');
  }

  private setupMediaSessionHandlers(): void {
    if (!this.mediaSession) return;

    this.mediaSession.setActionHandler('play', () => this.play());
    this.mediaSession.setActionHandler('pause', () => this.pause());
    this.mediaSession.setActionHandler('stop', () => this.stop());
    this.mediaSession.setActionHandler('nexttrack', () => this.next());
    this.mediaSession.setActionHandler('previoustrack', () => this.previous());
    this.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.seek(details.seekTime);
      }
    });
    this.mediaSession.setActionHandler('seekforward', (details) => {
      this.skipForward(details.seekOffset ?? 10);
    });
    this.mediaSession.setActionHandler('seekbackward', (details) => {
      this.skipBackward(details.seekOffset ?? 10);
    });
  }

  // ============================================================================
  // State & Info
  // ============================================================================

  getState(): Readonly<PlaybackState> {
    logger.debug(`getState() called [${this.instanceId}]`, {
      instance: this.instanceId,
      queueLength: this.state.queue.length,
      position: this.state.queuePosition,
      currentTrack: this.state.currentTrack?.track_name,
    });
    return { ...this.state };
  }

  getCurrentTrackInfo(): TrackInfo | null {
    if (!this.state.currentTrack) return null;

    const track = this.state.currentTrack;

    return {
      track,
      playbackState: {
        position: this.state.position,
        duration: this.state.duration,
        isPlaying: this.state.isPlaying,
        volume: this.state.volume,
      },
      audioInfo: {
        bitRate: track.bit_rate_kbps,
        sampleRate: track.sample_rate ?? 'Unknown',
        channels: track.channels ?? 'Unknown',
        format: track.format,
      },
      metadata: {
        title: track.track_name,
        artist: track.artist,
        album: track.album,
        year: track.recorded_date,
        genre: track.genre ?? 'Unknown',
        bpm: track.bpm_numeric,
        explicit: track.explicit,
      },
      linkedTrackers: track.linked_tracker ?? [],
    };
  }

  getStats(): Readonly<PlaybackStats> {
    return { ...this.stats };
  }

  /**
   * Get current queue state for verification
   */
  getQueueState(): {
    queue: Track[];
    position: number;
    preloadedTrack: Track | null;
  } {
    return {
      queue: [...this.state.queue],
      position: this.state.queuePosition,
      preloadedTrack: this.preloadedTrack,
    };
  }

  /**
   * Get current track (null if nothing playing)
   */
  getCurrentTrack(): Track | null {
    return this.state.currentTrack;
  }

  /**
   * Get next track in queue (null if none)
   */
  getNextTrack(): Track | null {
    if (this.state.queuePosition + 1 < this.state.queue.length) {
      return this.state.queue[this.state.queuePosition + 1];
    }
    return null;
  }

  /**
   * Get previous track in queue (null if none)
   */
  getPreviousTrack(): Track | null {
    if (this.state.queuePosition > 0) {
      return this.state.queue[this.state.queuePosition - 1];
    }
    return null;
  }

  /**
   * Validate current queue state
   */
  validateQueueState(): boolean {
    if (this.state.queuePosition < 0) {
      logger.error('Invalid queue state: position < 0');
      return false;
    }

    if (this.state.queuePosition >= this.state.queue.length && this.state.queue.length > 0) {
      logger.error('Invalid queue state: position >= queue length', {
        position: this.state.queuePosition,
        queueLength: this.state.queue.length,
      });
      return false;
    }

    return true;
  }

  getQueue(): Track[] {
    return [...this.state.queue];
  }

  getQueuePosition(): number {
    return this.state.queuePosition;
  }

  // ============================================================================
  // Event System
  // ============================================================================
  private callListener<K extends keyof PlaybackEvents>(
    listener: PlaybackEvents[K],
    args: Parameters<PlaybackEvents[K]>
  ): void {
    (listener as (...args: Parameters<PlaybackEvents[K]>) => void)(...args);
  }

  on<K extends keyof PlaybackEvents>(event: K, listener: PlaybackEvents[K]): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event]!.push(listener);
  }

  off<K extends keyof PlaybackEvents>(event: K, listener: PlaybackEvents[K]): void {
    const listeners = this.events[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  once<K extends keyof PlaybackEvents>(event: K, listener: PlaybackEvents[K]): void {
    const onceListener: PlaybackEvents[K] = ((...args: Parameters<PlaybackEvents[K]>) => {
      this.callListener(listener, args);
      this.off(event, onceListener);
    }) as PlaybackEvents[K];

    this.on(event, onceListener);
  }

  private emit<K extends keyof PlaybackEvents>(
    event: K,
    ...args: Parameters<PlaybackEvents[K]>
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

  private emitStateChange(): void {
    this.emit('statechange', this.getState());

    if (this.config.persistState) {
      this.persistState();
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createInitialState(): PlaybackState {
    return {
      currentTrack: null,
      status: 'idle',
      isPlaying: false,
      position: 0,
      duration: 0,
      volume: this.config.volume,
      muted: false,
      playbackRate: 1.0,
      shuffle: this.config.shuffle,
      repeat: this.config.repeat,
      queue: [],
      originalQueue: [],
      queuePosition: 0,
      hasNext: false,
      hasPrevious: false,
      sleepTimer: {
        enabled: false,
        endsAt: null,
        remainingMs: 0,
      },
      crossfade: {
        enabled: this.config.enableCrossfade,
        duration: this.config.crossfadeDuration,
      },
      gapless: {
        enabled: this.config.enableGapless,
        preloadTime: this.config.gaplessPreloadTime,
        crossfadeDuration: 0,
      },
      buffer: {
        buffered: null,
        health: 1,
        isBuffering: false,
        percentage: 0,
      },
      loading: false,
      error: null,
    };
  }

  private loadTrack(track: Track): void {
    this.state.currentTrack = track;
    this.state.loading = true;
    this.state.error = null;

    this.audio.src = track.cdn_url;
    this.audio.load();

    // Reset time tracking for new track
    this.previousTime = 0;
    this.isSeeking = false;

    this.state.queuePosition = this.state.queue.findIndex((t) => t.track_id === track.track_id);
    this.updateQueueState();

    this.emit('loaded', track);
    this.state.loading = false;
  }

  private setupAudioEvents(): void {
    this.audio.addEventListener('loadedmetadata', () => {
      this.state.duration = this.audio.duration;
      this.emitStateChange();
    });

    this.audio.addEventListener('timeupdate', () => {
      const currentTime = this.audio.currentTime;

      // Filter transient currentTime=0 glitches during unpause
      // Skip emission if:
      // - currentTime jumped backwards to near 0
      // - previousTime was significantly ahead (> 0.5s)
      // - we're not actively seeking
      if (currentTime < 0.5 && this.previousTime > 0.5 && !this.isSeeking && this.state.isPlaying) {
        logger.debug('Filtered transient currentTime glitch', {
          currentTime,
          previousTime: this.previousTime,
          isPlaying: this.state.isPlaying,
          isSeeking: this.isSeeking,
        });
        // Skip this update - it's a transient glitch
        return;
      }

      // Update state with valid time
      this.state.position = currentTime;
      this.previousTime = currentTime;

      this.emit('timeupdate', this.state.position, this.state.duration);

      // Check scrobble threshold
      if (
        !this.scrobbleThresholdReached &&
        this.state.currentTrack &&
        (this.state.position / this.state.duration) * 100 >= this.config.scrobbleThreshold
      ) {
        this.scrobbleThresholdReached = true;
      }

      // Update buffer state
      this.updateBufferState();
    });

    this.audio.addEventListener('ended', () => {
      this.handleTrackEnded();
    });

    this.audio.addEventListener('error', () => {
      // Some browsers fire benign errors during loading (CORS preflight, etc.)
      // Only treat as fatal if audio genuinely can't play
      const mediaError = this.audio.error;

      // If audio is already playing or can play, ignore the error
      if (this.state.isPlaying || this.audio.readyState >= 2) {
        logger.warn('Non-fatal audio error (playback continuing)', {
          code: mediaError?.code,
          message: mediaError?.message,
          readyState: this.audio.readyState,
        });
        return;
      }

      // Only stop playback for genuine fatal errors
      this.handleError(new Error(`Audio error: ${mediaError?.message}`));
    });

    this.audio.addEventListener('waiting', () => {
      this.state.buffer.isBuffering = true;
      this.emit('bufferchange', this.state.buffer);
    });

    this.audio.addEventListener('canplay', () => {
      this.state.buffer.isBuffering = false;
      this.emit('bufferchange', this.state.buffer);
    });

    this.audio.addEventListener('volumechange', () => {
      this.state.volume = this.audio.volume;
      this.state.muted = this.audio.muted;
    });

    this.audio.addEventListener('ratechange', () => {
      this.state.playbackRate = this.audio.playbackRate;
    });
  }

  private handleTrackEnded(): void {
    this.state.status = 'ended';
    this.emit('ended');

    // Record scrobble
    if (this.state.currentTrack) {
      this.recordScrobble(true);
    }

    this.stats.tracksPlayed++;

    // Handle repeat modes in correct order
    if (this.state.repeat === 'one') {
      // Repeat current track
      this.seek(0);
      void this.play();
    } else if (this.state.hasNext) {
      // There's a next track in queue - play it
      void this.next();
    } else if (this.state.repeat === 'all' && this.state.queue.length > 0) {
      // At end of queue with repeat all - loop back to start
      logger.debug('Repeat all: looping back to track 0');
      void this.jumpTo(0);
    } else {
      // End of queue, no repeat - stop playback
      this.state.isPlaying = false;
      this.state.status = 'idle';
      this.emitStateChange();
    }
  }

  private handleError(error: Error): void {
    this.state.status = 'error';
    this.state.error = error;
    this.state.isPlaying = false;

    this.emit('error', error);
    this.emitStateChange();

    logger.error('Error', error);
  }

  private updateQueueState(): void {
    // hasNext should ONLY be true if there's literally a next track in the queue
    // Repeat mode should NOT affect this - it's checked separately in handleTrackEnded
    this.state.hasNext = this.state.queuePosition < this.state.queue.length - 1;
    this.state.hasPrevious = this.state.queuePosition > 0;
  }

  private updateBufferState(): void {
    this.state.buffer.buffered = this.audio.buffered;

    if (this.audio.buffered.length > 0) {
      const bufferedEnd = this.audio.buffered.end(this.audio.buffered.length - 1);
      this.state.buffer.percentage = (bufferedEnd / this.state.duration) * 100;
      this.state.buffer.health = Math.min(1, bufferedEnd / (this.state.position + 10));
    }

    this.stats.bufferHealth = this.state.buffer.health;
  }

  /**
   * Lock mechanism to serialize async operations and prevent race conditions
   */
  private async lockOperation<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for any existing operation to complete
    while (this.operationLock) {
      await this.operationLock;
    }

    // Create new lock
    let resolver: () => void;
    this.operationLock = new Promise((resolve) => {
      resolver = resolve;
    });

    try {
      return await fn();
    } finally {
      // Release lock
      resolver!();
      this.operationLock = null;
    }
  }

  /**
   * Clear preload cache (nextAudio and preloadedTrack)
   */
  private clearPreloadCache(): void {
    if (this.nextAudio) {
      this.nextAudio.pause();
      this.nextAudio.src = '';
      this.nextAudio = null;
    }
    this.preloadedTrack = null;
    logger.debug('Cleared preload cache');
  }

  /**
   * Refresh preload cache - clear old and preload new next track
   */
  private refreshPreload(): void {
    this.clearPreloadCache();
    const nextTrack = this.getNextTrack();
    if (nextTrack && this.config.enableGapless) {
      this.preloadNextTrack();
    }
  }

  /**
   * Verify preload cache matches current queue state
   */
  private verifyPreloadCache(): boolean {
    if (!this.preloadedTrack) {
      return true; // No cache to verify
    }

    const nextTrack = this.getNextTrack();
    if (!nextTrack) {
      logger.warn('Preload cache invalid: no next track in queue');
      return false;
    }

    if (nextTrack.track_id !== this.preloadedTrack.track_id) {
      logger.warn('Preload cache mismatch', {
        cached: this.preloadedTrack.track_name,
        expected: nextTrack.track_name,
      });
      return false;
    }

    return true;
  }

  private preloadNextTrack(): void {
    if (this.state.queuePosition + 1 < this.state.queue.length) {
      const nextTrack = this.state.queue[this.state.queuePosition + 1];

      try {
        this.nextAudio = new Audio(nextTrack.cdn_url);
        this.nextAudio.preload = 'auto';
        this.nextAudio.load();
        this.preloadedTrack = nextTrack; // Track which track is preloaded
        logger.debug('Preloaded next track', {
          title: nextTrack.track_name,
          url: nextTrack.cdn_url,
        });
      } catch (error) {
        logger.warn('Failed to create preload audio element', {
          title: nextTrack.track_name,
          url: nextTrack.cdn_url,
          error: error instanceof Error ? error.message : String(error),
        });
        // Ensure cleanup on failure - gapless will fallback to regular play
        this.nextAudio = null;
        this.preloadedTrack = null;
      }
    }
  }

  private async gaplessTransition(): Promise<void> {
    if (!this.nextAudio || !this.state.currentTrack) {
      logger.warn('Gapless transition not available, using regular play');

      // Fallback to regular play
      this.state.queuePosition++;

      // Safety check: ensure we don't go past queue length
      if (this.state.queuePosition >= this.state.queue.length) {
        logger.error('Cannot transition: past end of queue');
        this.state.queuePosition = this.state.queue.length - 1;
        return;
      }

      const nextTrack = this.state.queue[this.state.queuePosition];
      await this.play(nextTrack);
      return;
    }

    const currentTrack = this.state.currentTrack;
    const nextTrack = this.state.queue[this.state.queuePosition + 1];

    // Safety check: ensure next track exists
    if (!nextTrack) {
      logger.error('Gapless transition failed: next track is undefined', {
        position: this.state.queuePosition + 1,
        queueLength: this.state.queue.length,
      });
      return;
    }

    // Check if preload is ready (readyState: 0=nothing, 1=metadata, 2=current_data, 3=future_data, 4=enough_data)
    if (this.nextAudio.readyState < 2) {
      logger.warn('Preloaded audio not ready, using regular play', {
        title: nextTrack?.track_name,
        url: nextTrack?.cdn_url,
        readyState: this.nextAudio.readyState,
        hasError: !!this.nextAudio.error,
        errorCode: this.nextAudio.error?.code,
      });
      // Clean up incomplete preload
      this.nextAudio.src = '';
      this.nextAudio = null;
      // Fallback to regular play
      this.state.queuePosition++;
      await this.play(nextTrack);
      return;
    }

    try {
      this.emit('gapless', currentTrack, nextTrack);

      // Switch audio elements
      const oldAudio = this.audio;
      this.audio = this.nextAudio;
      this.nextAudio = null;

      // Setup event listeners on the new current audio element
      // This is critical - without these listeners (especially 'ended'), auto-advance won't work
      this.setupAudioEvents();

      this.state.queuePosition++;
      this.state.currentTrack = nextTrack;
      this.updateQueueState();

      // Reset time tracking for new track (gapless transition)
      this.previousTime = 0;
      this.isSeeking = false;

      // Start playing next track
      await this.audio.play();

      // Stop old audio
      oldAudio.pause();
      oldAudio.src = '';

      this.emit('trackchange', nextTrack, currentTrack);
      this.emitStateChange();
      this.updateMediaSession();

      // Preload next (errors are handled inside preloadNextTrack)
      if (this.state.hasNext) {
        this.preloadNextTrack();
      }
    } catch (error) {
      logger.warn('Gapless transition failed, attempting regular play', {
        title: nextTrack?.track_name,
        error: error instanceof Error ? error.message : String(error),
      });
      // If gapless transition fails, fallback to regular play
      // Queue position already incremented, just try to play
      await this.play(nextTrack);
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startUpdateInterval(): void {
    this.updateInterval = setInterval(() => {
      // Update sleep timer
      if (this.state.sleepTimer.enabled && this.state.sleepTimer.endsAt) {
        const remainingMs = Math.max(0, this.state.sleepTimer.endsAt.getTime() - Date.now());
        this.state.sleepTimer.remainingMs = remainingMs;

        if (remainingMs === 0) {
          this.state.sleepTimer.enabled = false;
          this.state.sleepTimer.endsAt = null;
        }

        this.emitStateChange();
      }

      // Update session play time
      if (this.state.isPlaying) {
        this.stats.sessionPlayTime += 1;
        this.stats.totalPlayTime += 1;
      }

      // Update buffer state
      this.updateBufferState();
    }, 1000);
  }

  // ============================================================================
  // Storage (Likes & History)
  // ============================================================================

  private loadLikes(): LikesStorage {
    if (!this.config.enableLikes) {
      return {
        tracks: [],
        albums: {},
        totalLikes: 0,
        lastUpdated: new Date(),
      };
    }

    try {
      const saved = localStorage.getItem(this.config.likesStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          tracks: {
            likedAt: string | Date;
            lastPlayedAt?: string | Date;
            [key: string]: unknown;
          }[];
          lastUpdated: string | Date;
          albums: Record<string, unknown>;
          totalLikes: number;
        };
        // Convert date strings back to Date objects and return
        return {
          ...parsed,
          tracks: parsed.tracks.map((t) => ({
            ...t,
            likedAt: new Date(t.likedAt),
            lastPlayedAt: t.lastPlayedAt ? new Date(t.lastPlayedAt) : undefined,
          })) as unknown as LikedTrack[],
          lastUpdated: new Date(parsed.lastUpdated),
        } as LikesStorage;
      }
    } catch (error) {
      logger.warn('Failed to load likes', error);
    }

    return {
      tracks: [],
      albums: {},
      totalLikes: 0,
      lastUpdated: new Date(),
    };
  }

  private saveLikes(): void {
    if (!this.config.enableLikes) return;

    try {
      localStorage.setItem(this.config.likesStorageKey, JSON.stringify(this.likes));
    } catch (error) {
      logger.warn('Failed to save likes', error);
    }
  }

  private loadHistory(): HistoryEntry[] {
    if (!this.config.enableHistory) return [];

    try {
      const saved = localStorage.getItem(this.config.historyStorageKey);
      if (saved) {
        const data = JSON.parse(saved) as HistoryEntry[];
        return data.map((entry) => ({
          ...entry,
          playedAt: new Date(entry.playedAt),
        }));
      }
    } catch (error) {
      logger.warn('Failed to load history', error);
    }

    return [];
  }

  private saveHistory(): void {
    if (!this.config.enableHistory) return;

    try {
      localStorage.setItem(this.config.historyStorageKey, JSON.stringify(this.history));
    } catch (error) {
      logger.warn('Failed to save history', error);
    }
  }

  private persistState(): void {
    try {
      const stateToSave = {
        volume: this.state.volume,
        muted: this.state.muted,
        shuffle: this.state.shuffle,
        repeat: this.state.repeat,
        playbackRate: this.state.playbackRate,
        queueIds: this.state.queue.map((t) => t.track_id),
        currentTrackId: this.state.currentTrack?.track_id,
        position: this.state.position,
      };

      localStorage.setItem(this.config.storageKey, JSON.stringify(stateToSave));
    } catch (error) {
      logger.warn('Failed to persist state', error);
    }
  }

  private restoreState(): void {
    try {
      const saved = localStorage.getItem(this.config.storageKey);
      if (!saved) return;

      const state = JSON.parse(saved) as {
        volume?: number;
        muted?: boolean;
        shuffle?: boolean;
        repeat?: 'off' | 'one' | 'all';
        playbackRate?: number;
      };

      if (state.volume !== undefined) this.state.volume = state.volume;
      if (state.muted !== undefined) this.state.muted = state.muted;
      if (state.shuffle !== undefined) this.state.shuffle = state.shuffle;
      if (state.repeat !== undefined) this.state.repeat = state.repeat;
      if (state.playbackRate !== undefined) this.state.playbackRate = state.playbackRate;

      logger.debug('State restored');
    } catch (error) {
      logger.warn('Failed to restore state', error);
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.sleepTimerTimeout) {
      clearTimeout(this.sleepTimerTimeout);
    }

    // Record final scrobble
    if (this.state.currentTrack) {
      this.recordScrobble(true);
    }

    this.audio.pause();
    this.audio.src = '';

    if (this.nextAudio) {
      this.nextAudio.pause();
      this.nextAudio.src = '';
    }

    this.events = {};

    logger.debug('Destroyed');
  }
}
