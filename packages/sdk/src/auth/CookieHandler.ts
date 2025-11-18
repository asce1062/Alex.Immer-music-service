/**
 * Browser cookie handler for CloudFront signed cookies
 *
 * Manages reading and writing cookies in the browser environment.
 * CloudFront uses three signed cookies:
 * - CloudFront-Policy
 * - CloudFront-Signature
 * - CloudFront-Key-Pair-Id
 */

import { ValidationError } from '../types';

export interface Cookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: Date;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CloudFrontCookies {
  policy: string;
  signature: string;
  keyPairId: string;
}

export class CookieHandler {
  /**
   * Get a cookie value by name
   *
   * @param name - Cookie name
   * @returns Cookie value or null if not found
   */
  getCookie(name: string): string | null {
    if (typeof document === 'undefined') {
      return null;
    }

    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [cookieName, cookieValue] = cookie.split('=').map((c) => c.trim());
      if (cookieName === name) {
        return decodeURIComponent(cookieValue);
      }
    }
    return null;
  }

  /**
   * Set a cookie
   *
   * @param cookie - Cookie to set
   */
  setCookie(cookie: Cookie): void {
    if (typeof document === 'undefined') {
      throw new ValidationError('Cannot set cookies in non-browser environment');
    }

    let cookieString = `${cookie.name}=${encodeURIComponent(cookie.value)}`;

    if (cookie.domain) {
      cookieString += `; domain=${cookie.domain}`;
    }

    if (cookie.path) {
      cookieString += `; path=${cookie.path}`;
    } else {
      cookieString += '; path=/';
    }

    if (cookie.expires) {
      cookieString += `; expires=${cookie.expires.toUTCString()}`;
    }

    if (cookie.secure) {
      cookieString += '; secure';
    }

    if (cookie.sameSite) {
      cookieString += `; samesite=${cookie.sameSite}`;
    }

    document.cookie = cookieString;
  }

  /**
   * Delete a cookie by name
   *
   * @param name - Cookie name
   * @param domain - Cookie domain (if specified during set)
   * @param path - Cookie path (default: '/')
   */
  deleteCookie(name: string, domain?: string, path = '/'): void {
    if (typeof document === 'undefined') {
      return;
    }

    let cookieString = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC`;

    if (domain) {
      cookieString += `; domain=${domain}`;
    }

    cookieString += `; path=${path}`;

    document.cookie = cookieString;
  }

  /**
   * Check if cookies are enabled in the browser
   *
   * @returns True if cookies are enabled
   */
  areCookiesEnabled(): boolean {
    if (typeof document === 'undefined') {
      return false;
    }

    try {
      // Try to set a test cookie
      const testCookie = '__cookie_test__';
      document.cookie = `${testCookie}=1; path=/`;
      const enabled = document.cookie.includes(testCookie);
      // Clean up
      document.cookie = `${testCookie}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
      return enabled;
    } catch {
      return false;
    }
  }

  /**
   * Get all CloudFront signed cookies
   *
   * @returns CloudFront cookies or null if not all present
   */
  getCloudFrontCookies(): CloudFrontCookies | null {
    const policy = this.getCookie('CloudFront-Policy');
    const signature = this.getCookie('CloudFront-Signature');
    const keyPairId = this.getCookie('CloudFront-Key-Pair-Id');

    if (!policy || !signature || !keyPairId) {
      return null;
    }

    return {
      policy,
      signature,
      keyPairId,
    };
  }

  /**
   * Set all CloudFront signed cookies
   *
   * @param cookies - CloudFront cookies to set
   * @param expires - Expiration date for all cookies
   * @param domain - Cookie domain
   */
  setCloudFrontCookies(cookies: CloudFrontCookies, expires: Date, domain?: string): void {
    const cookieOptions: Omit<Cookie, 'name' | 'value'> = {
      expires,
      path: '/',
      secure: true,
      sameSite: 'None',
      domain,
    };

    this.setCookie({
      name: 'CloudFront-Policy',
      value: cookies.policy,
      ...cookieOptions,
    });

    this.setCookie({
      name: 'CloudFront-Signature',
      value: cookies.signature,
      ...cookieOptions,
    });

    this.setCookie({
      name: 'CloudFront-Key-Pair-Id',
      value: cookies.keyPairId,
      ...cookieOptions,
    });
  }

  /**
   * Delete all CloudFront signed cookies
   *
   * @param domain - Cookie domain (if specified during set)
   */
  deleteCloudFrontCookies(domain?: string): void {
    this.deleteCookie('CloudFront-Policy', domain);
    this.deleteCookie('CloudFront-Signature', domain);
    this.deleteCookie('CloudFront-Key-Pair-Id', domain);
  }

  /**
   * Check if CloudFront cookies are present and valid
   *
   * @returns True if all required CloudFront cookies are present
   */
  hasValidCloudFrontCookies(): boolean {
    return this.getCloudFrontCookies() !== null;
  }

  /**
   * Get all cookies as an object
   *
   * @returns Object with cookie names as keys
   */
  getAllCookies(): Record<string, string> {
    if (typeof document === 'undefined') {
      return {};
    }

    const cookies: Record<string, string> = {};
    const cookieStrings = document.cookie.split(';');

    for (const cookie of cookieStrings) {
      const [name, value] = cookie.split('=').map((c) => c.trim());
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    }

    return cookies;
  }

  /**
   * Clear all cookies for the current domain
   *
   * WARNING: This will delete ALL cookies, not just CloudFront cookies
   */
  clearAllCookies(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const cookies = this.getAllCookies();
    for (const name in cookies) {
      this.deleteCookie(name);
    }
  }
}
