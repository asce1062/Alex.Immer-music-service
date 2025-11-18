/**
 * TrackerPlayer - Tracker Module Playback Engine
 *
 * Supports playback of tracker modules (MOD, XM, S3M, IT, etc.)
 * using Web Audio API with libopenmpt.js or chiptune2.js
 *
 * Features:
 * - Multi-engine support (libopenmpt, chiptune2, auto-detect)
 * - Web Audio API integration
 * - Pattern/row tracking
 * - Metadata extraction
 * - Loop control
 * - Volume/mute control
 */

import type {
  TrackerModule,
  TrackerEngine,
  TrackerPlaybackConfig,
  TrackerMetadata,
  TrackerPlaybackState,
  TrackerPlaybackEvents,
  TrackerPlaybackStats,
  TrackerPlayerInfo,
  LibOpenMPTModule,
  Chiptune2Player,
} from '../types';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('TrackerPlayer');

type EventMap = {
  [K in keyof TrackerPlaybackEvents]: TrackerPlaybackEvents[K][];
};

export class TrackerPlayer {
  private config: Required<TrackerPlaybackConfig>;
  private events: Partial<EventMap> = {};
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private currentModule: LibOpenMPTModule | null = null;
  private state: TrackerPlaybackState;
  private stats: TrackerPlaybackStats;
  private animationFrame: number | null = null;
  private engine: TrackerEngine | null = null;
  private libopenmpt: unknown = null;
  private chiptune2: Chiptune2Player | null = null;

  constructor(config?: TrackerPlaybackConfig) {
    this.config = {
      engine: config?.engine ?? 'auto',
      sampleRate: config?.sampleRate ?? 48000,
      stereoSeparation: config?.stereoSeparation ?? 100,
      interpolationFilter: config?.interpolationFilter ?? 8,
      volumeRamping: config?.volumeRamping ?? -1,
      loopCount: config?.loopCount ?? 0,
      debug: config?.debug ?? false,
    };

    this.state = this.createInitialState();
    this.stats = {
      trackersPlayed: 0,
      totalPlayTime: 0,
      sessionPlayTime: 0,
      topFormat: null,
      averageDuration: 0,
    };

    logger.debug('Initialized', { config: this.config });
  }

  // ============================================================================
  // Playback Controls
  // ============================================================================

  /**
   * Load and play a tracker module
   */
  async play(tracker: TrackerModule): Promise<void> {
    try {
      this.state.loading = true;
      this.state.status = 'loading';
      this.emit('loading', tracker);

      // Initialize audio context
      if (!this.audioContext) {
        this.initializeAudioContext();
      }

      // Load tracker module
      await this.loadTracker(tracker);

      // Start playback
      this.state.isPlaying = true;
      this.state.status = 'playing';
      this.state.currentTracker = tracker;
      this.stats.trackersPlayed++;

      this.emit('play', tracker);
      this.emit('statechange', { ...this.state });

      // Start position tracking
      this.startPositionTracking();

      logger.debug('Playing', { title: tracker.title });
    } catch (error) {
      this.handleError(error as Error);
    }
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.state.isPlaying) return;

    this.state.isPlaying = false;
    this.state.status = 'paused';

    if (this.audioContext) {
      void this.audioContext.suspend();
    }

    this.stopPositionTracking();

    this.emit('pause');
    this.emit('statechange', { ...this.state });

    logger.debug('Paused');
  }

  /**
   * Resume playback
   */
  resume(): void {
    if (this.state.isPlaying) return;

    this.state.isPlaying = true;
    this.state.status = 'playing';

    if (this.audioContext) {
      void this.audioContext.resume();
    }

    this.startPositionTracking();

    this.emit('play', this.state.currentTracker!);
    this.emit('statechange', { ...this.state });

    logger.debug('Resumed');
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (!this.currentModule && !this.state.isPlaying) return;

    this.state.isPlaying = false;
    this.state.status = 'idle';
    this.state.position = 0;

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.currentModule) {
      this.currentModule.cleanup();
      this.currentModule = null;
    }

    this.stopPositionTracking();

    this.emit('stop');
    this.emit('statechange', { ...this.state });

    logger.debug('Stopped');
  }

  /**
   * Seek to position
   */
  seek(seconds: number): void {
    if (!this.currentModule) return;

    this.currentModule.set_position_seconds(seconds);
    this.state.position = seconds;

    this.emit('timeupdate', seconds, this.state.duration);

    logger.debug('Seeked to', { seconds });
  }

  /**
   * Set volume
   */
  setVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.state.volume = clampedVolume;

    if (this.gainNode) {
      this.gainNode.gain.value = clampedVolume;
    }

    this.emit('volumechange', clampedVolume);
    this.emit('statechange', { ...this.state });

    logger.debug('Volume', { volume: clampedVolume });
  }

  /**
   * Set mute
   */
  setMuted(muted: boolean): void {
    this.state.muted = muted;

    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : this.state.volume;
    }

    this.emit('mutechange', muted);
    this.emit('statechange', { ...this.state });
  }

  /**
   * Set repeat mode
   */
  setRepeat(enabled: boolean): void {
    this.state.repeat = enabled;
    this.config.loopCount = enabled ? -1 : 0;

    this.emit('repeatchange', enabled);
    this.emit('statechange', { ...this.state });
  }

  // ============================================================================
  // State & Info
  // ============================================================================

  /**
   * Get current playback state
   */
  getState(): Readonly<TrackerPlaybackState> {
    return { ...this.state };
  }

  /**
   * Get playback statistics
   */
  getStats(): Readonly<TrackerPlaybackStats> {
    return { ...this.stats };
  }

  /**
   * Get player info
   */
  getPlayerInfo(): TrackerPlayerInfo {
    return {
      engine: this.engine ?? 'auto',
      version: this.libopenmpt ? 'libopenmpt' : this.chiptune2 ? 'chiptune2' : 'unknown',
      supportedFormats: this.getSupportedFormats(),
      available: !!this.libopenmpt || !!this.chiptune2,
    };
  }

  /**
   * Check if tracker format is supported
   */
  isFormatSupported(format: string): boolean {
    const formats = this.getSupportedFormats();
    return formats.includes(format.toLowerCase());
  }

  // ============================================================================
  // Event System
  // ============================================================================

  on<K extends keyof TrackerPlaybackEvents>(event: K, listener: TrackerPlaybackEvents[K]): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event]!.push(listener);
  }

  off<K extends keyof TrackerPlaybackEvents>(event: K, listener: TrackerPlaybackEvents[K]): void {
    const listeners = this.events[event];
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
  }

  once<K extends keyof TrackerPlaybackEvents>(event: K, listener: TrackerPlaybackEvents[K]): void {
    const onceListener = ((...args: unknown[]) => {
      (listener as (...args: unknown[]) => void)(...args);
      this.off(event, onceListener);
    }) as TrackerPlaybackEvents[K];

    this.on(event, onceListener);
  }

  private emit<K extends keyof TrackerPlaybackEvents>(event: K, ...args: unknown[]): void {
    const listeners = this.events[event];
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          (listener as (...args: unknown[]) => void)(...args);
        } catch (error) {
          logger.error(`Error in ${String(event)} listener`, error);
        }
      });
    }
  }

  // ============================================================================
  // Private Methods - Audio Context
  // ============================================================================

  private initializeAudioContext(): void {
    if (typeof window === 'undefined' || !window.AudioContext) {
      throw new Error('Web Audio API not supported');
    }

    this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate });
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
    this.gainNode.gain.value = this.state.volume;

    logger.debug('Audio context initialized');
  }

  private async loadTracker(tracker: TrackerModule): Promise<void> {
    // Fetch tracker module
    const response = await fetch(tracker.tracker_cdn_url);
    if (!response.ok) {
      throw new Error(`Failed to fetch tracker: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    // Try to load with libopenmpt (preferred)
    if (this.config.engine === 'libopenmpt' || this.config.engine === 'auto') {
      try {
        await this.loadWithLibOpenMPT(arrayBuffer, tracker);
        this.engine = 'libopenmpt';
        return;
      } catch (error) {
        if (this.config.engine === 'libopenmpt') {
          throw error;
        }
        logger.warn('libopenmpt failed, trying chiptune2', error);
      }
    }

    // Fallback to chiptune2 or throw error
    throw new Error('No tracker engine available. Please load libopenmpt.js or chiptune2.js');
  }

  private async loadWithLibOpenMPT(
    arrayBuffer: ArrayBuffer,
    tracker: TrackerModule
  ): Promise<void> {
    // Check if libopenmpt is available
    if (typeof (window as unknown as Record<string, unknown>).libopenmpt === 'undefined') {
      throw new Error('libopenmpt.js not loaded');
    }

    const LibOpenMPT = (window as unknown as Record<string, unknown>).libopenmpt as (options: {
      locateFile: (file: string) => string;
    }) => Promise<{ load: (buffer: ArrayBuffer) => LibOpenMPTModule }>;

    // Initialize module
    const module = await LibOpenMPT({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/libopenmpt-js@latest/${file}`;
      },
    });

    // Load module data
    this.currentModule = module.load(arrayBuffer);

    if (!this.currentModule) {
      throw new Error('Failed to load tracker module');
    }

    // Extract metadata
    const metadata: TrackerMetadata = {
      title: this.currentModule.get_metadata('title') || tracker.title,
      type: this.currentModule.get_metadata('type') || tracker.format.toUpperCase(),
      channels: this.currentModule.get_num_channels(),
      patterns: this.currentModule.get_num_patterns(),
      instruments: this.currentModule.get_num_instruments(),
      message: this.currentModule.get_metadata('message'),
      tracker: this.currentModule.get_metadata('tracker'),
      duration: this.currentModule.duration,
    };

    this.state.metadata = metadata;
    this.state.duration = metadata.duration;
    this.state.loading = false;

    // Setup audio processing
    this.setupAudioProcessing();

    this.emit('loaded', tracker, metadata);
    this.emit('metadatachange', metadata);

    logger.debug('Loaded with libopenmpt', metadata);
  }

  private setupAudioProcessing(): void {
    if (!this.audioContext || !this.currentModule || !this.gainNode) return;

    const bufferSize = 4096;
    this.scriptProcessor = this.audioContext.createScriptProcessor(bufferSize, 0, 2);

    this.scriptProcessor.onaudioprocess = (event) => {
      if (!this.currentModule || !this.state.isPlaying) return;

      const [left, right] = this.currentModule.read(bufferSize);
      const outputLeft = event.outputBuffer.getChannelData(0);
      const outputRight = event.outputBuffer.getChannelData(1);

      outputLeft.set(left);
      outputRight.set(right);

      // Update position
      this.state.position = this.currentModule.position_seconds;

      // Check if ended
      if (this.state.position >= this.state.duration && !this.state.repeat) {
        this.handleEnded();
      }
    };

    this.scriptProcessor.connect(this.gainNode);
  }

  // ============================================================================
  // Private Methods - Position Tracking
  // ============================================================================

  private startPositionTracking(): void {
    this.stopPositionTracking();

    const updatePosition = () => {
      if (!this.state.isPlaying || !this.currentModule) return;

      const position = this.currentModule.position_seconds;
      const duration = this.state.duration;

      // Update pattern/row info
      const currentPattern = this.currentModule.get_current_pattern();
      const currentRow = this.currentModule.get_current_row();

      if (
        this.state.metadata &&
        (this.state.metadata.currentPattern !== currentPattern ||
          this.state.metadata.currentRow !== currentRow)
      ) {
        this.state.metadata.currentPattern = currentPattern;
        this.state.metadata.currentRow = currentRow;
        this.state.metadata.currentSpeed = this.currentModule.get_current_speed();
        this.state.metadata.currentBpm = this.currentModule.get_current_tempo();

        this.emit('patternchange', currentPattern, currentRow);
      }

      this.emit('timeupdate', position, duration);

      this.animationFrame = requestAnimationFrame(updatePosition);
    };

    this.animationFrame = requestAnimationFrame(updatePosition);
  }

  private stopPositionTracking(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private createInitialState(): TrackerPlaybackState {
    return {
      currentTracker: null,
      status: 'idle',
      isPlaying: false,
      position: 0,
      duration: 0,
      volume: 1,
      muted: false,
      repeat: false,
      metadata: null,
      engine: null,
      loading: false,
      error: null,
    };
  }

  private getSupportedFormats(): string[] {
    // Formats supported by libopenmpt
    return [
      'mod',
      'xm',
      's3m',
      'it',
      'mptm',
      'stm',
      'nst',
      'm15',
      'stk',
      'wow',
      'ult',
      '669',
      'mtm',
      'med',
      'far',
      'mdl',
      'ams',
      'dsm',
      'amf',
      'okt',
      'dmf',
      'ptm',
      'psm',
      'mt2',
      'dbm',
      'digi',
      'imf',
      'j2b',
      'gdm',
      'umx',
      'plm',
      'mo3',
      'xpk',
      'ppm',
      'mmcmp',
    ];
  }

  private handleEnded(): void {
    this.state.status = 'ended';
    this.state.isPlaying = false;
    this.stopPositionTracking();

    this.emit('ended');
    this.emit('statechange', { ...this.state });

    logger.debug('Playback ended');
  }

  private handleError(error: Error): void {
    this.state.status = 'error';
    this.state.error = error;
    this.state.isPlaying = false;
    this.state.loading = false;

    this.emit('error', error);
    this.emit('statechange', { ...this.state });

    logger.error('Error', error);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stop();

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }

    this.events = {};

    logger.debug('Destroyed');
  }
}
