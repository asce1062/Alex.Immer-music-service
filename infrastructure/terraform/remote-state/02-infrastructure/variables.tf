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
  description = "CloudFront cache policy ID (Managed-CachingDisabled - prevents cookie-based cache collisions)"
  type        = string
  default     = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingDisabled - AWS managed caching
}

# ============================================================================
# Referer Allowlist - REMOVED
# ============================================================================
# Referer-based access control has been replaced with CloudFront signed cookies.
# Client authentication is now handled via API Gateway + Lambda.
