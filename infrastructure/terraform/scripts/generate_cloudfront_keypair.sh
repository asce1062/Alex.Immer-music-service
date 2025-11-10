#!/bin/bash
# ============================================================================
# Generate CloudFront Key Pair for Signed Cookies
# ============================================================================
# This script generates an RSA-2048 key pair for CloudFront signed cookies.
#
# Usage:
#   ./scripts/generate_cloudfront_keypair.sh
#
# Output:
#   - cloudfront_private_key.pem (keep secure, store in Secrets Manager)
#   - cloudfront_public_key.pem (upload to CloudFront via AWS Console)
#
# Steps after running this script:
#   1. Upload public key to AWS Console:
#      CloudFront → Public keys → Create public key
#   2. Copy the Key ID (e.g., K2JCJMDEHXQW5F)
#   3. Store private key in AWS Secrets Manager:
#      aws secretsmanager put-secret-value \
#        --secret-id music-service/cloudfront-signing-key \
#        --secret-string '{"private_key":"$(cat cloudfront_private_key.pem | tr '\n' '|' | sed 's/|/\\n/g')","key_pair_id":"YOUR-KEY-ID"}'
#   4. Copy public key to Terraform directory:
#      cp cloudfront_public_key.pem infrastructure/terraform/remote-state/02-infrastructure/
#   5. Run terraform apply
# ============================================================================

set -e

OUTPUT_DIR="$(pwd)/keys"
PRIVATE_KEY_FILE="$OUTPUT_DIR/cloudfront_private_key.pem"
PUBLIC_KEY_FILE="$OUTPUT_DIR/cloudfront_public_key.pem"

echo "🔐 Generating CloudFront Key Pair..."
echo ""

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Generate private key
echo "Generating private key..."
openssl genrsa -out "$PRIVATE_KEY_FILE" 2048

# Generate public key
echo "Generating public key..."
openssl rsa -pubout -in "$PRIVATE_KEY_FILE" -out "$PUBLIC_KEY_FILE"

# Set secure permissions
chmod 600 "$PRIVATE_KEY_FILE"
chmod 644 "$PUBLIC_KEY_FILE"

echo ""
echo "✅ Key pair generated successfully!"
echo ""
echo "📁 Files created:"
echo "  Private key: $PRIVATE_KEY_FILE"
echo "  Public key:  $PUBLIC_KEY_FILE"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Upload public key to AWS CloudFront:"
echo "   AWS Console → CloudFront → Public keys → Create public key"
echo "   Name: music-service-signing-key"
echo "   Public key: $(cat "$PUBLIC_KEY_FILE")"
echo ""
echo "2. Copy the Key Pair ID (e.g., K2JCJMDEHXQW5F)"
echo ""
echo "3. Store private key in AWS Secrets Manager:"
echo "   Run: python scripts/upload_cloudfront_key.py"
echo ""
echo "4. Copy public key to Terraform directory:"
echo "   cp $PUBLIC_KEY_FILE infrastructure/terraform/remote-state/02-infrastructure/"
echo ""
echo "5. Run terraform apply"
echo ""
echo "⚠️  IMPORTANT: Keep the private key secure!"
echo "   Do NOT commit it to version control."
echo "   Store it in AWS Secrets Manager only."
echo ""
