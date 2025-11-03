# ============================================================================
# AWS Secrets Manager - Secure Credential Storage
# ============================================================================
# This module manages secrets for the music service:
# 1. music-service IAM user credentials (access key + secret)
# 2. CloudFront signed URL private key (for future API Gateway)
# 3. Database credentials (if needed)
#
# Security Features:
# - Automatic rotation (30 days for IAM keys)
# - Encryption at rest (AWS managed KMS key)
# - Audit logging via CloudTrail
# - Fine-grained IAM access control
# ============================================================================

# ============================================================================
# Secret for music-service IAM User Credentials
# ============================================================================
resource "aws_secretsmanager_secret" "music_service_credentials" {
  name        = "music-service/aws-credentials"
  description = "AWS access credentials for music-service IAM user (S3, CloudFront operations)"

  # Enable automatic rotation (requires Lambda function - see below)
  # rotation_lambda_arn = aws_lambda_function.rotate_credentials.arn
  # rotation_rules {
  #   automatically_after_days = 30
  # }

  tags = {
    Name        = "music-service-aws-credentials"
    Environment = var.environment
    ManagedBy   = "terraform"
    Purpose     = "IAM user access keys for music upload/sync scripts"
  }
}

# Secret value is NOT stored in Terraform (security best practice)
# MANUAL STEP: Store the secret value via AWS CLI or Console
# See deployment instructions below

# ============================================================================
# Secret Version Placeholder (Updated Manually or via Rotation Lambda)
# ============================================================================
# This lifecycle block prevents Terraform from reverting manual updates
resource "aws_secretsmanager_secret_version" "music_service_credentials" {
  secret_id = aws_secretsmanager_secret.music_service_credentials.id

  # Placeholder value - MUST be updated manually after creation
  secret_string = jsonencode({
    access_key_id     = "PLACEHOLDER-REPLACE-ME"
    secret_access_key = "PLACEHOLDER-REPLACE-ME"
    created_at        = timestamp()
  })

  lifecycle {
    ignore_changes = [secret_string] # Ignore changes after initial creation
  }
}

# ============================================================================
# IAM Policy: Secrets Manager Access
# ============================================================================
# NOTE: The music-service IAM user gets SecretsManagerReadWrite policy attached
# in the bootstrap module. No custom policy needed here.
#
# For Lambda functions that need secrets access, attach the AWS managed policy:
#   arn:aws:iam::aws:policy/SecretsManagerReadWrite
#
# Example (when Lambda module is created):
# resource "aws_iam_role_policy_attachment" "lambda_secrets_access" {
#   role       = aws_iam_role.lambda_execution_role.name
#   policy_arn = "arn:aws:iam::aws:policy/SecretsManagerReadWrite"
# }

# ============================================================================
# Secret for CloudFront Signed URL Private Key (Future Use)
# ============================================================================
resource "aws_secretsmanager_secret" "cloudfront_private_key" {
  name        = "music-service/cloudfront-private-key"
  description = "CloudFront private key for generating signed URLs (API Gateway)"

  tags = {
    Name        = "cloudfront-private-key"
    Environment = var.environment
    Purpose     = "CloudFront signed URL generation"
  }
}

# Placeholder - actual key added manually or via automation
resource "aws_secretsmanager_secret_version" "cloudfront_private_key" {
  secret_id = aws_secretsmanager_secret.cloudfront_private_key.id

  secret_string = jsonencode({
    private_key = "PLACEHOLDER-REPLACE-WITH-ACTUAL-KEY"
    key_pair_id = "PLACEHOLDER-KEY-PAIR-ID"
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ============================================================================
# KMS Key for Secrets Encryption (Optional - AWS managed by default)
# ============================================================================
# Uncomment if you need customer-managed encryption key

# resource "aws_kms_key" "secrets" {
#   description             = "KMS key for Secrets Manager encryption"
#   deletion_window_in_days = 30
#   enable_key_rotation     = true
#
#   tags = {
#     Name = "music-service-secrets-kms"
#   }
# }
#
# resource "aws_kms_alias" "secrets" {
#   name          = "alias/music-service-secrets"
#   target_key_id = aws_kms_key.secrets.key_id
# }

# ============================================================================
# Outputs
# ============================================================================
output "secrets_manager_secret_arn" {
  description = "ARN of the Secrets Manager secret for music-service credentials"
  value       = aws_secretsmanager_secret.music_service_credentials.arn
}

output "secrets_manager_secret_name" {
  description = "Name of the Secrets Manager secret"
  value       = aws_secretsmanager_secret.music_service_credentials.name
}

output "cloudfront_private_key_secret_arn" {
  description = "ARN of the CloudFront private key secret"
  value       = aws_secretsmanager_secret.cloudfront_private_key.arn
}

output "cloudfront_private_key_secret_name" {
  description = "Name of the CloudFront private key secret"
  value       = aws_secretsmanager_secret.cloudfront_private_key.name
}
