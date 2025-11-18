/**
 * Event emitter utility
 *
 * Generic type-safe event emitter for use across modules
 */

import { SDKLogger } from './logger';

const logger = SDKLogger.child('EventEmitter');

export type EventListener<T = unknown> = (data: T) => void;

export type EventMap = Record<string, unknown>;

/**
 * Type-safe event emitter
 */
export class EventEmitter<Events extends EventMap = EventMap> {
  private eventListeners = new Map<keyof Events, Set<EventListener<unknown>>>();
  private maxListeners = 10;

  constructor(options?: { maxListeners?: number }) {
    this.maxListeners = options?.maxListeners ?? 10;
  }

  /**
   * Add event listener
   */
  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }

    const listeners = this.eventListeners.get(event)!;
    listeners.add(listener as EventListener<unknown>);

    // Warn if too many listeners
    if (listeners.size > this.maxListeners) {
      logger.warn('Possible memory leak detected', {
        event: String(event),
        listenerCount: listeners.size,
        maxListeners: this.maxListeners,
      });
    }

    logger.debug('Added listener', { event: String(event) });

    return this;
  }

  /**
   * Add one-time event listener
   */
  once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
    const onceListener: EventListener<Events[K]> = (data) => {
      listener(data);
      this.off(event, onceListener);
    };

    return this.on(event, onceListener);
  }

  /**
   * Remove event listener
   */
  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): this {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener as EventListener<unknown>);

      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }

      logger.debug('Removed listener', { event: String(event) });
    }

    return this;
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners<K extends keyof Events>(event?: K): this {
    if (event) {
      this.eventListeners.delete(event);
      logger.debug('Removed all listeners', { event: String(event) });
    } else {
      this.eventListeners.clear();
      logger.debug('Removed all listeners for all events');
    }

    return this;
  }

  /**
   * Emit event
   */
  emit<K extends keyof Events>(event: K, data: Events[K]): boolean {
    const listeners = this.eventListeners.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }

    logger.debug('Emitting event', {
      event: String(event),
      listenerCount: listeners.size,
    });

    listeners.forEach((listener) => {
      try {
        listener(data);
      } catch (error) {
        logger.error('Error in listener', { event: String(event), error });
      }
    });

    return true;
  }

  /**
   * Get listener count for event
   */
  listenerCount<K extends keyof Events>(event: K): number {
    const listeners = this.eventListeners.get(event);
    return listeners ? listeners.size : 0;
  }

  /**
   * Get all event names
   */
  eventNames(): (keyof Events)[] {
    return Array.from(this.eventListeners.keys());
  }

  /**
   * Get listeners for event
   */
  listeners<K extends keyof Events>(event: K): EventListener<Events[K]>[] {
    const listeners = this.eventListeners.get(event);
    return listeners ? Array.from(listeners) : [];
  }

  /**
   * Set max listeners
   */
  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  /**
   * Get max listeners
   */
  getMaxListeners(): number {
    return this.maxListeners;
  }
}

/**
 * Create a new event emitter
 */
export function createEventEmitter<Events extends EventMap = EventMap>(options?: {
  maxListeners?: number;
}): EventEmitter<Events> {
  return new EventEmitter<Events>(options);
}
