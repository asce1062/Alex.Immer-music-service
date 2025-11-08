# ============================================================================
# Music Service CDN Infrastructure
# ============================================================================
# This Terraform configuration manages:
# - S3 bucket for music storage (private, versioned, encrypted)
# - CloudFront distribution with OAC (Origin Access Control)
# - ACM certificate for custom domains (DNS validation)
# - IAM user with least-privilege policy
# - CloudFront Function for referer-based access control
# ============================================================================

terraform {
  required_version = ">= 1.0"

  # Remote state backend (S3 + DynamoDB)
  # NOTE: Run backend-setup FIRST to create those resources
  backend "s3" {
    bucket         = "music-service-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "music-service-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.72.1" # Pinned to exact version for stability
    }
  }
}

# ============================================================================
# Provider Configuration
# ============================================================================
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "music-service"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

# ACM certificates for CloudFront must be in us-east-1
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project     = "music-service"
      ManagedBy   = "terraform"
      Environment = var.environment
    }
  }
}

# ============================================================================
# Data Sources
# ============================================================================
data "aws_caller_identity" "current" {}

# ============================================================================
# S3 Bucket for Music Storage
# ============================================================================
resource "aws_s3_bucket" "music" {
  bucket = var.bucket_name

  # Prevent accidental deletion
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = var.bucket_name
    Description = "Static music files - MP3s covers metadata trackers"
  }
}

# Enable versioning
resource "aws_s3_bucket_versioning" "music" {
  bucket = aws_s3_bucket.music.id

  versioning_configuration {
    status = var.enable_versioning ? "Enabled" : "Suspended"
  }
}

# Server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "music" {
  bucket = aws_s3_bucket.music.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = var.enable_kms ? "aws:kms" : "AES256"
      kms_master_key_id = var.enable_kms ? var.kms_key_id : null
    }
    bucket_key_enabled = var.enable_kms
  }
}

# Block all public access
resource "aws_s3_bucket_public_access_block" "music" {
  bucket = aws_s3_bucket.music.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle rules (optional - commented out by default)
# resource "aws_s3_bucket_lifecycle_configuration" "music" {
#   bucket = aws_s3_bucket.music.id
#
#   rule {
#     id     = "expire-old-versions"
#     status = "Enabled"
#
#     noncurrent_version_expiration {
#       noncurrent_days = 90
#     }
#   }
# }

# S3 bucket policy - allows CloudFront OAC access only
resource "aws_s3_bucket_policy" "music" {
  bucket = aws_s3_bucket.music.id

  # Wait for CloudFront distribution to be created first
  depends_on = [aws_cloudfront_distribution.cdn]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowCloudFrontOAC"
        Effect = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "${aws_s3_bucket.music.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn
          }
        }
      }
    ]
  })
}

# ============================================================================
# CloudFront Origin Access Control (OAC)
# ============================================================================
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "${var.bucket_name}-oac"
  description                       = "OAC for ${var.bucket_name} S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ============================================================================
# ACM Certificate (us-east-1 for CloudFront)
# ============================================================================
resource "aws_acm_certificate" "cert" {
  provider = aws.us_east_1

  domain_name               = var.cname_primary
  subject_alternative_names = [var.cname_staging]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "music-cdn-certificate"
    Description = "Certificate for music CDN domains"
  }
}

# ============================================================================
# CloudFront Function - REMOVED
# ============================================================================
# Referer-based access control has been replaced with CloudFront signed cookies
# for more secure authentication. See cloudfront-keys.tf for the new implementation.

# ============================================================================
# CloudFront Distribution
# ============================================================================
resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "Music Service CDN - ${var.environment}"
  default_root_object = "index.json"
  price_class         = var.cloudfront_price_class

  # Custom domain names
  aliases = [var.cname_primary, var.cname_staging]

  # S3 origin with OAC
  origin {
    domain_name              = aws_s3_bucket.music.bucket_regional_domain_name
    origin_id                = "S3-${var.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  # Default cache behavior
  default_cache_behavior {
    target_origin_id       = "S3-${var.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    allowed_methods = ["GET", "HEAD", "OPTIONS"]
    cached_methods  = ["GET", "HEAD", "OPTIONS"]

    # Use AWS managed caching policy
    cache_policy_id = var.cache_policy_id

    # Require signed cookies for viewer authentication
    # NOTE: This works with OAC because we removed origin_request_policy_id
    # CloudFront validates cookies for viewers but doesn't forward them to S3
    trusted_key_groups = [aws_cloudfront_key_group.music_service.id]
  }

  # Custom error responses
  custom_error_response {
    error_code            = 403
    response_code         = 403
    response_page_path    = "/error.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/error.html"
    error_caching_min_ttl = 10
  }

  # SSL certificate configuration
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.cert.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # Geo restrictions (optional - none by default)
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Wait for ACM certificate validation
  depends_on = [aws_acm_certificate.cert]

  tags = {
    Name        = "music-cdn-distribution"
    Description = "CloudFront distribution for music service"
  }
}

# ============================================================================
# IAM User Reference
# ============================================================================
# NOTE: The IAM user 'music-service' is created by the bootstrap module.
# It already has the following AWS managed policies attached via bootstrap:
#   - AmazonS3FullAccess (for S3 operations)
#   - CloudFrontFullAccess (for CloudFront operations and invalidations)
#   - AWSCertificateManagerFullAccess (for ACM certificates)
#   - AmazonDynamoDBFullAccess (for Terraform state locking)
#   - SecretsManagerReadWrite (for Secrets Manager access)
#   - music-service-scoped-iam-policy (custom scoped IAM permissions)
#
# No additional IAM policies are needed in this infrastructure module.
# The bootstrap policies provide all necessary permissions for both:
#   1. Terraform infrastructure deployment
#   2. Application runtime operations (music uploads, cache invalidations)
#   3. Secrets Manager access (credential storage and retrieval)

# ============================================================================
# IAM Access Key (Managed separately for security)
# ============================================================================
# IMPORTANT: Access keys should be created manually or via a separate secure process
# Uncomment the following block ONLY if you need Terraform to create the access key
# WARNING: This will store the secret in state file - use with extreme caution!
#
# resource "aws_iam_access_key" "music_service" {
#   user = aws_iam_user.music_service.name
# }
#
# Store the secret securely (use AWS Secrets Manager or similar)
# resource "aws_secretsmanager_secret" "music_service_key" {
#   name = "${var.iam_user_name}-access-key"
# }
#
# resource "aws_secretsmanager_secret_version" "music_service_key" {
#   secret_id = aws_secretsmanager_secret.music_service_key.id
#   secret_string = jsonencode({
#     access_key_id     = aws_iam_access_key.music_service.id
#     secret_access_key = aws_iam_access_key.music_service.secret
#   })
# }
