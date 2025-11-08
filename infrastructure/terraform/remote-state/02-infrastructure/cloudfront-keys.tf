# ============================================================================
# CloudFront Signed Cookies - Key Pair and Trusted Key Group
# ============================================================================
# This module manages CloudFront public keys and key groups for signed cookie
# authentication. Signed cookies provide secure, time-limited access to CDN
# resources without requiring per-file signed URLs.
#
# Setup Instructions:
# 1. Generate RSA key pair locally (see scripts/generate_cloudfront_keypair.sh)
# 2. Place public key in this directory as cloudfront_public_key.pem
# 3. Store private key in AWS Secrets Manager (music-service/cloudfront-signing-key)
# 4. Run terraform apply
#
# Security Features:
# - RSA-2048 encryption for signed cookies
# - Public key managed by Terraform
# - Private key stored in Secrets Manager (never in code/state)
# - Key rotation supported (add new key to group, deprecate old)
# ============================================================================

# ============================================================================
# CloudFront Public Key
# ============================================================================
resource "aws_cloudfront_public_key" "signing_key" {
  name        = "music-service-signing-key-${var.environment}"
  comment     = "Public key for CloudFront signed cookies - ${var.environment}"
  encoded_key = file("${path.module}/cloudfront_public_key.pem")

  lifecycle {
    create_before_destroy = true
  }
}

# ============================================================================
# CloudFront Key Group (Trusted Keys)
# ============================================================================
resource "aws_cloudfront_key_group" "music_service" {
  name    = "music-service-key-group-${var.environment}"
  comment = "Trusted key group for music service signed cookies"

  # List of trusted public key IDs
  # For key rotation: add new key here, update Lambda to use new key,
  # then remove old key after grace period
  items = [
    aws_cloudfront_public_key.signing_key.id
  ]
}

# ============================================================================
# Outputs
# ============================================================================
output "cloudfront_public_key_id" {
  description = "CloudFront public key ID"
  value       = aws_cloudfront_public_key.signing_key.id
}

output "cloudfront_key_group_id" {
  description = "CloudFront key group ID (used in distribution configuration)"
  value       = aws_cloudfront_key_group.music_service.id
}

output "cloudfront_key_group_name" {
  description = "CloudFront key group name"
  value       = aws_cloudfront_key_group.music_service.name
}
