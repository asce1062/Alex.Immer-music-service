/**
 * Base HTTP Client
 *
 * Provides a consistent HTTP client with:
 * - Request/response interceptors
 * - Automatic authentication
 * - Error mapping
 * - Request logging
 */

import type { MusicServiceConfig } from '../types';
import { NetworkError, AuthenticationError } from '../types/errors';
import type { SessionManager } from '../auth/SessionManager';
import { SDKLogger } from '../utils/logger';

const logger = SDKLogger.child('HTTPClient');

export type RequestInterceptor = (config: RequestConfig) => RequestConfig | Promise<RequestConfig>;

export interface ResponseInterceptor {
  onFulfilled?: (response: Response) => Response | Promise<Response>;
  onRejected?: (error: Error) => Error | Promise<Error>;
}

export interface RequestConfig extends RequestInit {
  url: string;
  params?: Record<string, string | number | boolean>;
  timeout?: number;
  skipAuth?: boolean;
}

export interface HTTPClientConfig {
  baseURL?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export class BaseClient {
  private sessionManager: SessionManager;
  private httpConfig: HTTPClientConfig;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  constructor(
    _config: Required<MusicServiceConfig>,
    sessionManager: SessionManager,
    httpConfig?: HTTPClientConfig
  ) {
    this.sessionManager = sessionManager;

    this.httpConfig = {
      baseURL: httpConfig?.baseURL ?? '',
      timeout: httpConfig?.timeout ?? 30000,
      headers: httpConfig?.headers ?? {},
    };
  }

  /**
   * Add request interceptor
   *
   * @param interceptor - Request interceptor function
   * @returns Index of the interceptor for removal
   */
  addRequestInterceptor(interceptor: RequestInterceptor): number {
    this.requestInterceptors.push(interceptor);
    return this.requestInterceptors.length - 1;
  }

  /**
   * Remove request interceptor
   *
   * @param index - Index of the interceptor to remove
   */
  removeRequestInterceptor(index: number): void {
    if (index >= 0 && index < this.requestInterceptors.length) {
      this.requestInterceptors.splice(index, 1);
    }
  }

  /**
   * Add response interceptor
   *
   * @param interceptor - Response interceptor object
   * @returns Index of the interceptor for removal
   */
  addResponseInterceptor(interceptor: ResponseInterceptor): number {
    this.responseInterceptors.push(interceptor);
    return this.responseInterceptors.length - 1;
  }

  /**
   * Remove response interceptor
   *
   * @param index - Index of the interceptor to remove
   */
  removeResponseInterceptor(index: number): void {
    if (index >= 0 && index < this.responseInterceptors.length) {
      this.responseInterceptors.splice(index, 1);
    }
  }

  /**
   * Perform HTTP GET request
   *
   * @param url - Request URL
   * @param config - Request configuration
   * @returns Response
   */
  async get<T = unknown>(url: string, config?: Omit<RequestConfig, 'url' | 'method'>): Promise<T> {
    return this.request<T>({
      url,
      method: 'GET',
      ...config,
    });
  }

  /**
   * Perform HTTP POST request
   *
   * @param url - Request URL
   * @param data - Request body
   * @param config - Request configuration
   * @returns Response
   */
  async post<T = unknown>(
    url: string,
    data?: unknown,
    config?: Omit<RequestConfig, 'url' | 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>({
      url,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      ...config,
    });
  }

  /**
   * Perform HTTP PUT request
   *
   * @param url - Request URL
   * @param data - Request body
   * @param config - Request configuration
   * @returns Response
   */
  async put<T = unknown>(
    url: string,
    data?: unknown,
    config?: Omit<RequestConfig, 'url' | 'method' | 'body'>
  ): Promise<T> {
    return this.request<T>({
      url,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
      ...config,
    });
  }

  /**
   * Perform HTTP DELETE request
   *
   * @param url - Request URL
   * @param config - Request configuration
   * @returns Response
   */
  async delete<T = unknown>(
    url: string,
    config?: Omit<RequestConfig, 'url' | 'method'>
  ): Promise<T> {
    return this.request<T>({
      url,
      method: 'DELETE',
      ...config,
    });
  }

  /**
   * Perform HTTP request with interceptors
   *
   * @param config - Request configuration
   * @returns Response data
   */
  async request<T = unknown>(config: RequestConfig): Promise<T> {
    try {
      // Apply request interceptors
      let requestConfig = { ...config };
      for (const interceptor of this.requestInterceptors) {
        requestConfig = await interceptor(requestConfig);
      }

      // Build URL with params
      const url = this.buildURL(requestConfig.url, requestConfig.params);

      // Build headers
      const headers = this.buildHeaders(requestConfig);

      // Log request in debug mode
      logger.debug(`${requestConfig.method ?? 'GET'} ${url}`);

      // Make request with timeout
      const response = await this.fetchWithTimeout(url, {
        ...requestConfig,
        headers,
        credentials: requestConfig.skipAuth ? 'omit' : 'include',
      });

      // Handle 401 and refresh session
      if (response.status === 401 && !requestConfig.skipAuth) {
        logger.warn('Got 401, refreshing session...');

        try {
          await this.sessionManager.refresh();

          // Retry request
          return this.request<T>({
            ...requestConfig,
            skipAuth: false, // Don't skip auth on retry
          });
        } catch (error) {
          throw new AuthenticationError('Session refresh failed after 401', 401, {
            originalError: error,
            url,
          });
        }
      }

      // Apply response interceptors (fulfilled)
      let finalResponse = response;
      for (const interceptor of this.responseInterceptors) {
        if (interceptor.onFulfilled) {
          finalResponse = await interceptor.onFulfilled(finalResponse);
        }
      }

      // Check response status
      if (!finalResponse.ok) {
        throw await this.handleErrorResponse(finalResponse, url);
      }

      // Parse response
      const contentType = finalResponse.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return (await finalResponse.json()) as T;
      } else {
        return (await finalResponse.text()) as T;
      }
    } catch (error) {
      // Apply response interceptors (rejected)
      let finalError = error instanceof Error ? error : new Error(String(error));
      for (const interceptor of this.responseInterceptors) {
        if (interceptor.onRejected) {
          finalError = await interceptor.onRejected(finalError);
        }
      }

      throw finalError;
    }
  }

  /**
   * Build full URL with query parameters
   */
  private buildURL(url: string, params?: Record<string, string | number | boolean>): string {
    // Use baseURL if URL is relative
    const fullURL = url.startsWith('http') ? url : `${this.httpConfig.baseURL}${url}`;

    // Add query parameters
    if (params && Object.keys(params).length > 0) {
      const urlObj = new URL(fullURL);
      Object.entries(params).forEach(([key, value]) => {
        urlObj.searchParams.append(key, String(value));
      });
      return urlObj.toString();
    }

    return fullURL;
  }

  /**
   * Build request headers
   */
  private buildHeaders(config: RequestConfig): HeadersInit {
    const headers: Record<string, string> = {
      ...this.httpConfig.headers,
      ...(config.headers as Record<string, string>),
    };

    // Add content-type for POST/PUT with body
    if (
      (config.method === 'POST' || config.method === 'PUT') &&
      config.body &&
      !headers['Content-Type']
    ) {
      headers['Content-Type'] = 'application/json';
    }

    return headers;
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string, options: RequestConfig): Promise<Response> {
    const timeout = options.timeout ?? this.httpConfig.timeout;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if ((error as Error).name === 'AbortError') {
        throw new NetworkError(`Request timeout after ${timeout}ms`, error, { url, timeout });
      }
      throw new NetworkError('Network request failed', error, { url });
    }
  }

  /**
   * Handle error response
   */
  private async handleErrorResponse(response: Response, url: string): Promise<Error> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    let errorBody: unknown;

    try {
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        errorBody = await response.json();
        const body = errorBody as { message?: string; error?: string };
        errorMessage = body.message ?? body.error ?? errorMessage;
      } else {
        errorBody = await response.text();
        if (errorBody) {
          errorMessage = errorBody as string;
        }
      }
    } catch {
      // Ignore parse errors
    }

    if (response.status === 401) {
      return new AuthenticationError(errorMessage, response.status, {
        url,
        body: errorBody,
      });
    }

    return new NetworkError(errorMessage, undefined, {
      statusCode: response.status,
      url,
      body: errorBody,
    });
  }

  /**
   * Get current HTTP configuration
   */
  getConfig(): HTTPClientConfig {
    return { ...this.httpConfig };
  }

  /**
   * Update HTTP configuration
   */
  updateConfig(config: Partial<HTTPClientConfig>): void {
    this.httpConfig = {
      ...this.httpConfig,
      ...config,
    };
  }
}
