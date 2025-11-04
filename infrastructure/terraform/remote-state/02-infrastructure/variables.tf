# ============================================================================
# Music Service CDN - Terraform Variables
# ============================================================================

variable "region" {
  description = "AWS region for resources (except ACM which uses us-east-1)"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (production, staging, dev)"
  type        = string
  default     = "production"
}

variable "bucket_name" {
  description = "S3 bucket name for music storage"
  type        = string
  default     = "alexmbugua-music"
}

variable "enable_versioning" {
  description = "Enable S3 bucket versioning for music bucket (can be expensive with large files)"
  type        = bool
  default     = false # Disabled for cost savings (music files are large)
}

variable "enable_kms" {
  description = "Use KMS encryption instead of SSE-S3"
  type        = bool
  default     = false
}

variable "kms_key_id" {
  description = "KMS key ID for S3 encryption (if enable_kms = true)"
  type        = string
  default     = null
}

variable "cname_primary" {
  description = "Primary custom domain name for CloudFront"
  type        = string
  default     = "cdn.alexmbugua.me"
}

variable "cname_staging" {
  description = "Staging custom domain name for CloudFront"
  type        = string
  default     = "cdn-staging.alexmbugua.me"
}

variable "iam_user_name" {
  description = "IAM user name for music service"
  type        = string
  default     = "music-service"
}

variable "cloudfront_price_class" {
  description = "CloudFront price class (PriceClass_All, PriceClass_200, PriceClass_100)"
  type        = string
  default     = "PriceClass_All" # Global distribution - all edge locations
}

variable "cache_policy_id" {
  description = "CloudFront cache policy ID (default: Managed-CachingOptimized)"
  type        = string
  default     = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
}

variable "import_existing" {
  description = "Flag to indicate importing existing resources (for documentation)"
  type        = bool
  default     = true
}

# ============================================================================
# Referer Allowlist
# ============================================================================
variable "allowed_referers" {
  description = "List of allowed referer domains for CloudFront Function"
  type        = list(string)
  default = [
    # Production domains
    "https://alexmbugua.me",
    "https://www.alexmbugua.me",
    "https://asce1062.github.io",

    # Development (localhost)
    "http://localhost:4321", # Astro dev server
    "http://localhost:4322", # Astro additional dev server
    "http://localhost:3000", # Common dev port
    "http://localhost:8080", # Common dev port
    "http://localhost:8888", # Netlify local preview server
    "http://127.0.0.1:4321", # Astro dev (IPv4)
    "http://127.0.0.1:4322", # Astro additional dev server (IPv4)
    "http://127.0.0.1:3000", # Common dev (IPv4)
    "http://127.0.0.1:8080", # Common dev (IPv4)
    "http://127.0.0.1:8888", # Netlify local preview server

    # Netlify Deploy Previews (pattern: deploy-preview-{PR#}--{site-name}.netlify.app)
    # Note: CloudFront Functions don't support wildcards, so add specific preview URLs as needed
    "https://alexmbugua.netlify.app"
  ]
}
