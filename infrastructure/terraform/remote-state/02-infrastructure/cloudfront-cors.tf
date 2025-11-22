# ============================================================================
# CloudFront CORS Configuration
# ============================================================================
# This file configures CORS (Cross-Origin Resource Sharing) for the CloudFront
# distribution to enable browser access from allowed origins including localhost
# during development.
#
# Components:
# 1. Response Headers Policy - Adds CORS headers to CDN responses
# 2. Custom Cache Policy - Forwards Origin header for CORS validation
#
# Security Note:
# - Never use wildcard (*) with credentials=true
# - All allowed origins are explicitly whitelisted
# - Origin header forwarding enables origin-specific CORS responses
# ============================================================================

# ============================================================================
# CloudFront Response Headers Policy for CORS
# ============================================================================
resource "aws_cloudfront_response_headers_policy" "cors_policy" {
  name    = "music-service-cors-policy-${var.environment}"
  comment = "CORS policy for music service CDN - enables browser access from production and localhost"

  # CORS Configuration
  cors_config {
    # Allow credentials (required for CloudFront signed cookies)
    access_control_allow_credentials = true

    # Allow specific headers in requests
    # Note: Cannot use wildcard (*) when credentials are enabled
    access_control_allow_headers {
      items = [
        "Accept",
        "Accept-Language",
        "Content-Type",
        "Origin",
        "Access-Control-Request-Method",
        "Access-Control-Request-Headers",
        "Range",
        "If-Modified-Since",
        "If-None-Match",
      ]
    }

    # Allowed HTTP methods for CDN resources
    access_control_allow_methods {
      items = ["GET", "HEAD", "OPTIONS"]
    }

    # Explicitly allowed origins (production + development)
    # Must match the allowed origins in API Gateway and Lambda CORS utility
    access_control_allow_origins {
      items = [
        # Production domains
        "https://alexmbugua.me",
        "https://www.alexmbugua.me",
        "https://asce1062.github.io",
        "https://music.alexmbugua.me",
        "https://alexmbugua.netlify.app",

        # Development - localhost (various ports)
        "http://localhost:4321",
        "http://localhost:4322",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:8888",

        # Development - 127.0.0.1 (various ports)
        "http://127.0.0.1:4321",
        "http://127.0.0.1:4322",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:8888",
      ]
    }

    # Headers exposed to browser JavaScript
    access_control_expose_headers {
      items = [
        "Content-Length",
        "Content-Type",
        "ETag",
        "Last-Modified",
        "Date",
      ]
    }

    # Cache preflight responses for 5 minutes
    access_control_max_age_sec = 300

    # CloudFront adds headers even if S3 origin doesn't provide them
    origin_override = true
  }

  # ============================================================================
  # Security Headers (Best Practices)
  # ============================================================================

  # Strict Transport Security (HSTS)
  security_headers_config {
    # Force HTTPS for 1 year, including subdomains
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      override                   = true
    }

    # Prevent MIME type sniffing
    content_type_options {
      override = true
    }

    # Prevent clickjacking
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # XSS Protection
    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    # Referrer Policy
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
  }

  # Custom headers (optional - for debugging)
  custom_headers_config {
    items {
      header   = "X-Music-Service-CDN"
      value    = "v1"
      override = true
    }
  }
}

# ============================================================================
# Custom Cache Policy with Origin Header Forwarding
# ============================================================================
# This custom cache policy forwards the Origin header to enable CORS
# while maintaining good cache performance.
#
# Note: Including Origin in cache key may reduce cache hit rate slightly,
# but is necessary for proper CORS handling across multiple origins.
# ============================================================================
resource "aws_cloudfront_cache_policy" "cors_cache_policy" {
  name        = "music-service-cors-cache-${var.environment}"
  comment     = "Cache policy with Origin header forwarding for CORS"
  default_ttl = 86400    # 1 day
  max_ttl     = 31536000 # 1 year
  min_ttl     = 1        # 1 second

  parameters_in_cache_key_and_forwarded_to_origin {
    # Do NOT forward cookies to S3 origin
    # Cookies are only for CloudFront signed cookie validation
    cookies_config {
      cookie_behavior = "none"
    }

    # Forward Origin header for CORS validation
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = [
          "Origin",
          "Access-Control-Request-Method",
          "Access-Control-Request-Headers",
        ]
      }
    }

    # Do not forward query strings (not needed for static assets)
    query_strings_config {
      query_string_behavior = "none"
    }

    # Enable compression for faster transfers
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

# ============================================================================
# Outputs
# ============================================================================
output "cloudfront_cors_response_headers_policy_id" {
  description = "ID of the CloudFront CORS response headers policy"
  value       = aws_cloudfront_response_headers_policy.cors_policy.id
}

output "cloudfront_cors_cache_policy_id" {
  description = "ID of the CloudFront CORS cache policy"
  value       = aws_cloudfront_cache_policy.cors_cache_policy.id
}
