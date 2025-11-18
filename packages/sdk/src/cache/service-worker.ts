/**
 * Service Worker registration and management utilities
 *
 * Provides utilities to:
 * - Register service workers
 * - Handle updates
 * - Manage service worker lifecycle
 * - Communicate with service workers
 */

import type {
  ServiceWorkerConfig,
  ServiceWorkerState,
  ServiceWorkerRegistrationState,
  SWMessageResponse,
} from '../types';

/**
 * Check if service workers are supported
 */
export function isServiceWorkerSupported(): boolean {
  return 'serviceWorker' in navigator;
}

/**
 * Register a service worker
 */
export async function registerServiceWorker(
  config: ServiceWorkerConfig
): Promise<ServiceWorkerRegistration> {
  if (!isServiceWorkerSupported()) {
    throw new Error('Service Workers are not supported in this browser');
  }

  try {
    const registration = await navigator.serviceWorker.register(config.scriptURL, {
      scope: config.scope ?? '/',
    });

    // Handle updates based on strategy
    if (config.updateStrategy === 'immediate') {
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
              // Reload to use new service worker
              window.location.reload();
            }
          });
        }
      });
    }

    return registration;
  } catch (error) {
    throw new Error(`Failed to register service worker: ${(error as Error).message}`);
  }
}

/**
 * Unregister a service worker
 */
export async function unregisterServiceWorker(
  registration?: ServiceWorkerRegistration
): Promise<boolean> {
  if (!isServiceWorkerSupported()) {
    return false;
  }

  try {
    const reg = registration ?? (await navigator.serviceWorker.getRegistration());

    if (reg) {
      return await reg.unregister();
    }

    return false;
  } catch (error) {
    console.error('Failed to unregister service worker:', error);
    return false;
  }
}

/**
 * Get service worker state
 */
export async function getServiceWorkerState(): Promise<ServiceWorkerState> {
  if (!isServiceWorkerSupported()) {
    return {
      supported: false,
      registered: false,
      active: false,
    };
  }

  const registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    return {
      supported: true,
      registered: false,
      active: false,
      state: 'unregistered',
    };
  }

  const worker = registration.active ?? registration.waiting ?? registration.installing;
  const state = worker?.state as ServiceWorkerRegistrationState | undefined;

  return {
    supported: true,
    registered: true,
    active: !!registration.active,
    registration,
    state: state ?? 'installing',
  };
}

/**
 * Wait for service worker to be ready
 */
export async function waitForServiceWorkerReady(
  timeout = 30000
): Promise<ServiceWorkerRegistration> {
  if (!isServiceWorkerSupported()) {
    throw new Error('Service Workers are not supported');
  }

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Service Worker ready timeout')), timeout);
    }),
  ]);
}

/**
 * Send a message to the service worker
 */
export async function sendMessageToServiceWorker<TRequest, TResponse = unknown>(
  message: TRequest
): Promise<TResponse> {
  if (!isServiceWorkerSupported()) {
    throw new Error('Service Workers are not supported');
  }

  const registration = await navigator.serviceWorker.getRegistration();

  if (!registration?.active) {
    throw new Error('No active service worker found');
  }

  const activeWorker = registration.active;

  return new Promise<TResponse>((resolve, reject) => {
    const channel = new MessageChannel();

    channel.port1.onmessage = (event: MessageEvent<SWMessageResponse<TResponse>>) => {
      const msg = event.data;

      if ('error' in msg) {
        reject(new Error(msg.error));
      } else if ('data' in msg) {
        resolve(msg.data);
      } else {
        reject(new Error('Invalid service worker response'));
      }
    };

    activeWorker.postMessage(message, [channel.port2]);
  });
}

/**
 * Listen for service worker messages
 */
export function onServiceWorkerMessage<T = unknown>(callback: (data: T) => void): () => void {
  if (!isServiceWorkerSupported()) return () => undefined;

  const handler = (event: MessageEvent<T>) => {
    callback(event.data);
  };

  navigator.serviceWorker.addEventListener('message', handler);

  return () => {
    navigator.serviceWorker.removeEventListener('message', handler);
  };
}

/**
 * Check for service worker updates
 */
export async function checkForUpdates(): Promise<boolean> {
  if (!isServiceWorkerSupported()) {
    return false;
  }

  const registration = await navigator.serviceWorker.getRegistration();

  if (!registration) {
    return false;
  }

  await registration.update();

  return !!(registration.waiting ?? registration.installing);
}

/**
 * Skip waiting and activate new service worker
 */
export async function skipWaitingAndActivate(): Promise<void> {
  if (!isServiceWorkerSupported()) {
    return;
  }

  const registration = await navigator.serviceWorker.getRegistration();

  if (registration?.waiting) {
    // Send skip waiting message
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });

    // Wait for controller change
    return new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        resolve();
      });
    });
  }
}

/**
 * Get all service worker cache names
 */
export async function getCacheNames(): Promise<string[]> {
  if (!('caches' in window)) {
    return [];
  }

  try {
    return await caches.keys();
  } catch (error) {
    console.error('Failed to get cache names:', error);
    return [];
  }
}

/**
 * Delete a service worker cache
 */
export async function deleteCache(cacheName: string): Promise<boolean> {
  if (!('caches' in window)) {
    return false;
  }

  try {
    return await caches.delete(cacheName);
  } catch (error) {
    console.error(`Failed to delete cache: ${cacheName}`, error);
    return false;
  }
}

/**
 * Clear all service worker caches
 */
export async function clearAllCaches(): Promise<number> {
  const cacheNames = await getCacheNames();
  let deletedCount = 0;

  for (const cacheName of cacheNames) {
    const deleted = await deleteCache(cacheName);
    if (deleted) {
      deletedCount++;
    }
  }

  return deletedCount;
}
