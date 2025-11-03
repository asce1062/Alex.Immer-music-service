#!/usr/bin/env bash
# ==============================================================================
# Setup AWS Secrets Manager - Store music-service Credentials
# ==============================================================================
# This script securely stores AWS IAM user credentials in Secrets Manager.
#
# SECURITY NOTES:
# - This script should be run ONCE during initial setup
# - Requires admin/bootstrap AWS credentials
# - Never commit actual credentials to git
# - Credentials are encrypted at rest in Secrets Manager
#
# USAGE:
#   ./setup_secrets.sh
#
# PREREQUISITES:
#   1. Terraform infrastructure deployed (secrets.tf)
#   2. music-service IAM user created (bootstrap)
#   3. Access keys generated for music-service user
#   4. AWS CLI configured with admin credentials
# ==============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ==============================================================================
# Helper Functions
# ==============================================================================

print_header() {
    echo -e "${BLUE}==============================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}==============================================================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# ==============================================================================
# Check Prerequisites
# ==============================================================================

print_header "Checking Prerequisites"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI not installed!"
    echo "Install from: https://aws.amazon.com/cli/"
    exit 1
fi
print_success "AWS CLI installed"

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured!"
    echo "Run: aws configure"
    exit 1
fi

CALLER_IDENTITY=$(aws sts get-caller-identity --query Arn --output text)
print_success "AWS credentials configured: $CALLER_IDENTITY"

# Check jq installed
if ! command -v jq &> /dev/null; then
    print_error "jq not installed!"
    echo "Install: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi
print_success "jq installed"

# ==============================================================================
# Get Secret Name from Terraform Output
# ==============================================================================

print_header "Fetching Secrets Manager Secret Name"

cd "$(dirname "$0")/../infrastructure"

if [ ! -f "terraform.tfstate" ] && [ ! -f ".terraform/terraform.tfstate" ]; then
    print_error "Terraform state not found!"
    echo "Run 'terraform apply' in infrastructure/ directory first"
    exit 1
fi

SECRET_NAME=$(terraform output -raw secrets_manager_secret_name 2>/dev/null || echo "")

if [ -z "$SECRET_NAME" ]; then
    print_warning "Secret name not in Terraform output, using default"
    SECRET_NAME="music-service/aws-credentials"
fi

print_success "Secret name: $SECRET_NAME"

# ==============================================================================
# Check if Secret Exists
# ==============================================================================

print_header "Checking if Secret Already Exists"

if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" &> /dev/null; then
    print_warning "Secret already exists: $SECRET_NAME"
    echo ""
    read -p "Do you want to update the existing secret? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Aborted by user"
        exit 0
    fi
    UPDATE_MODE=true
else
    print_info "Secret does not exist yet (will be created by Terraform)"
    UPDATE_MODE=false
fi

# ==============================================================================
# Prompt for Credentials (MANUAL SECURITY GATE)
# ==============================================================================

print_header "Enter music-service IAM User Credentials"

print_warning "SECURITY: These credentials will be encrypted and stored in Secrets Manager"
print_info "Never commit these credentials to git or share them"
echo ""

# Prompt for Access Key ID
read -p "Enter AWS_ACCESS_KEY_ID (starts with AKIA...): " ACCESS_KEY_ID

if [[ ! $ACCESS_KEY_ID =~ ^AKIA[A-Z0-9]{16}$ ]]; then
    print_error "Invalid access key format! Should start with AKIA and be 20 characters"
    exit 1
fi

# Prompt for Secret Access Key (hidden input)
read -s -p "Enter AWS_SECRET_ACCESS_KEY (will be hidden): " SECRET_ACCESS_KEY
echo ""

if [ ${#SECRET_ACCESS_KEY} -lt 40 ]; then
    print_error "Secret access key seems too short!"
    exit 1
fi

print_success "Credentials captured"

# ==============================================================================
# Validate Credentials
# ==============================================================================

print_header "Validating Credentials"

print_info "Testing credentials with AWS STS..."

# Export credentials temporarily
export AWS_ACCESS_KEY_ID="$ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY"

if TEST_IDENTITY=$(aws sts get-caller-identity --query Arn --output text 2>&1); then
    print_success "Credentials are valid!"
    print_info "IAM User: $TEST_IDENTITY"

    # Check if it's the music-service user
    if [[ $TEST_IDENTITY != *"music-service"* ]]; then
        print_warning "Warning: This doesn't look like the music-service user"
        print_warning "Expected ARN to contain 'music-service'"
        echo ""
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    print_error "Credentials are INVALID!"
    print_error "$TEST_IDENTITY"
    exit 1
fi

# Clear exported credentials
unset AWS_ACCESS_KEY_ID
unset AWS_SECRET_ACCESS_KEY

# ==============================================================================
# Store in Secrets Manager
# ==============================================================================

print_header "Storing Credentials in Secrets Manager"

# Create JSON payload
SECRET_JSON=$(jq -n \
    --arg access_key "$ACCESS_KEY_ID" \
    --arg secret_key "$SECRET_ACCESS_KEY" \
    --arg created_at "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
    '{
        access_key_id: $access_key,
        secret_access_key: $secret_key,
        created_at: $created_at
    }')

# Store secret
if aws secretsmanager put-secret-value \
    --secret-id "$SECRET_NAME" \
    --secret-string "$SECRET_JSON" \
    --output json > /dev/null; then

    print_success "Credentials stored successfully!"
    print_info "Secret: $SECRET_NAME"
else
    print_error "Failed to store credentials!"
    exit 1
fi

# ==============================================================================
# Verify Storage
# ==============================================================================

print_header "Verifying Secret Storage"

STORED_SECRET=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query SecretString \
    --output text)

STORED_ACCESS_KEY=$(echo "$STORED_SECRET" | jq -r '.access_key_id')

if [ "$STORED_ACCESS_KEY" = "$ACCESS_KEY_ID" ]; then
    print_success "Secret verified successfully!"
else
    print_error "Verification failed! Stored key doesn't match"
    exit 1
fi

# ==============================================================================
# Summary
# ==============================================================================

print_header "Setup Complete!"

echo ""
print_success "AWS credentials securely stored in Secrets Manager"
echo ""
print_info "Secret Name: $SECRET_NAME"
print_info "Region: us-east-1"
print_info "Encryption: AES-256 (AWS managed)"
echo ""
print_warning "SECURITY REMINDERS:"
echo "  1. Delete any local copies of these credentials"
echo "  2. Remove credentials from .env files"
echo "  3. Update your Python scripts to use secrets_manager.py"
echo "  4. Set up credential rotation (see rotation_lambda.py)"
echo ""
print_info "Next Steps:"
echo "  1. Update scripts to use: from scripts.utils.secrets_manager import get_aws_credentials"
echo "  2. Remove AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from .env"
echo "  3. Test: python3 scripts/music_sync_cli.py --help"
echo ""

exit 0
