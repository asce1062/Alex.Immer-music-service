# ============================================================================
# Terraform State Backend Infrastructure
# ============================================================================
# This configuration creates the S3 bucket and DynamoDB table required for
# Terraform remote state storage with state locking.
#
# IMPORTANT: Run this BEFORE the bootstrap configuration to ensure all
# subsequent Terraform operations use remote state from the start.
#
# USAGE:
#   1. Run this with terraform-admin credentials (admin user)
#   2. This creates S3 bucket + DynamoDB table
#   3. Then run bootstrap (which will use remote state)
#   4. Then run main infrastructure (which will also use remote state)
# ============================================================================

terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 5.72.1" # Pinned to exact version for stability
    }
  }

  # NOTE: This config itself uses LOCAL state (bootstrap problem)
  # After creating the backend resources, we'll migrate this to remote state
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
      Environment = "infrastructure"
      Purpose     = "terraform-state-backend"
    }
  }
}

# ============================================================================
# Data Sources
# ============================================================================
data "aws_caller_identity" "current" {}

# ============================================================================
# S3 Bucket for Terraform State
# ============================================================================
resource "aws_s3_bucket" "terraform_state" {
  bucket = var.state_bucket_name

  # Prevent accidental deletion of state bucket
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = var.state_bucket_name
    Description = "Terraform state storage for music-service infrastructure"
  }
}

# Enable versioning (critical for state recovery)
resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Enable server-side encryption
resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Block all public access (security requirement)
resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enable logging (optional but recommended for audit trail)
resource "aws_s3_bucket_logging" "terraform_state" {
  count = var.enable_logging ? 1 : 0

  bucket = aws_s3_bucket.terraform_state.id

  target_bucket = aws_s3_bucket.terraform_state.id
  target_prefix = "access-logs/"
}

# Lifecycle policy to clean up old versions
resource "aws_s3_bucket_lifecycle_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    # Add empty filter to apply to all objects
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.state_version_retention_days
    }
  }

  rule {
    id     = "clean-old-logs"
    status = "Enabled"

    filter {
      prefix = "access-logs/"
    }

    expiration {
      days = 90
    }
  }
}

# Bucket policy - restrict access to authorized IAM users only
resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Allow music-service user to read/write state
      {
        Sid    = "AllowMusicServiceAccess"
        Effect = "Allow"
        Principal = {
          AWS = [
            # music-service user (no path prefix, created via console)
            "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/music-service",
            # Optional: terraform-admin user (if exists)
            # "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/terraform-admin"
          ]
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:GetBucketVersioning"
        ]
        Resource = [
          aws_s3_bucket.terraform_state.arn,
          "${aws_s3_bucket.terraform_state.arn}/*"
        ]
      },
      # Deny unencrypted uploads
      {
        Sid       = "DenyUnencryptedObjectUploads"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.terraform_state.arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:x-amz-server-side-encryption" = "AES256"
          }
        }
      },
      # Deny insecure transport
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.terraform_state.arn,
          "${aws_s3_bucket.terraform_state.arn}/*"
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

# ============================================================================
# DynamoDB Table for State Locking
# ============================================================================
resource "aws_dynamodb_table" "terraform_locks" {
  name         = var.lock_table_name
  billing_mode = "PAY_PER_REQUEST" # On-demand pricing (cost-effective for small teams)
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  # Enable point-in-time recovery (backup)
  point_in_time_recovery {
    enabled = var.enable_point_in_time_recovery
  }

  # Server-side encryption
  server_side_encryption {
    enabled = true
  }

  # Prevent accidental deletion
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = var.lock_table_name
    Description = "Terraform state locking for music-service infrastructure"
  }
}

# ============================================================================
# Backend Configuration
# ============================================================================
# NOTE: Each Terraform module (bootstrap, infrastructure) should define its
# own backend configuration directly in its main.tf file with the appropriate
# state key for that module.
#
# Example backend configuration for other modules:
#
# terraform {
#   backend "s3" {
#     bucket         = "music-service-terraform-state"
#     key            = "MODULE_NAME/terraform.tfstate"  # e.g., "bootstrap/terraform.tfstate"
#     region         = "us-east-1"
#     dynamodb_table = "music-service-terraform-locks"
#     encrypt        = true
#   }
# }
# ============================================================================
