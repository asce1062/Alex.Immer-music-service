/**
 * Type definitions for Music Service API
 */

export interface ClientCredentials {
  client_id: string;
  client_secret: string;
  allowed_origins: string[];
  description: string;
  cookie_duration_hours: number;
  created_at: string;
}

export interface CloudFrontSigningKey {
  private_key: string;
  key_pair_id: string;
}

export interface SignedCookiePolicy {
  Statement: {
    Resource: string;
    Condition: {
      DateLessThan: {
        'AWS:EpochTime': number;
      };
    };
  }[];
}

export interface SignedCookies {
  'CloudFront-Policy': string;
  'CloudFront-Signature': string;
  'CloudFront-Key-Pair-Id': string;
}

export interface CdnInfo {
  base_url: string;
  albums_path: string;
  covers_path: string;
  metadata_path: string;
  trackers_path: string;
}

export interface SessionInfo {
  expires_at: string;
  duration_seconds: number;
}

export interface SessionResponse {
  status: 'success' | 'error';
  session: SessionInfo;
  cdn: CdnInfo;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

export interface RequestHeaders {
  'x-client-id'?: string | undefined;
  'x-client-secret'?: string | undefined;
  origin?: string | undefined;
  'user-agent'?: string | undefined;
}

export interface Environment {
  SIGNING_KEY_SECRET_NAME: string;
  CLIENTS_SECRET_PREFIX: string;
  CDN_DOMAIN: string;
  ENVIRONMENT: string;
  NODE_ENV: string;
}
