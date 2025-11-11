#!/usr/bin/env bash
# ============================================================================
# Verify Secrets Manager → Parameter Store Migration
# ============================================================================
# This script verifies that client credentials were successfully migrated
# from Secrets Manager to Parameter Store by comparing values.
#
# Usage:
#   ./verify-migration.sh [--region us-east-1] [--profile default]
# ============================================================================

set -euo pipefail

# Configuration
REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-default}"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Client credentials mapping
# Using array instead of associative array to avoid bash version issues
declare -a SECRETS=(
  "music-service/clients/alexmbugua-personal:/music-service/clients/alexmbugua-personal"
  "music-service/clients/music-app-web:/music-service/clients/music-app-web"
  "music-service/clients/alex-immer-mobile:/music-service/clients/alex-immer-mobile"
)

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --region)
      REGION="$2"
      shift 2
      ;;
    --profile)
      AWS_PROFILE="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--region us-east-1] [--profile default]"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

# Logging functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Verify single secret/parameter pair
verify_migration() {
  local secret_name=$1
  local parameter_name=$2

  log_info "Verifying: $secret_name ↔ $parameter_name"

  # Fetch secret value
  secret_value=$(aws secretsmanager get-secret-value \
    --secret-id "$secret_name" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query 'SecretString' \
    --output text 2>&1) || {
    log_error "  Failed to fetch secret: $secret_name"
    return 1
  }

  # Fetch parameter value
  param_value=$(aws ssm get-parameter \
    --name "$parameter_name" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text 2>&1) || {
    log_error "  Failed to fetch parameter: $parameter_name"
    return 1
  }

  # Normalize JSON (remove whitespace differences)
  secret_normalized=$(echo "$secret_value" | jq -c -S .)
  param_normalized=$(echo "$param_value" | jq -c -S .)

  # Compare values
  if [[ "$secret_normalized" == "$param_normalized" ]]; then
    log_success "  ✓ Values match"

    # Validate JSON structure
    client_id=$(echo "$param_value" | jq -r '.client_id')
    client_secret=$(echo "$param_value" | jq -r '.client_secret')
    allowed_origins=$(echo "$param_value" | jq -r '.allowed_origins | length')
    cookie_duration=$(echo "$param_value" | jq -r '.cookie_duration_hours')

    log_info "  Client ID: $client_id"
    log_info "  Client Secret: ${client_secret:0:8}... (${#client_secret} chars)"
    log_info "  Allowed Origins: $allowed_origins"
    log_info "  Cookie Duration: ${cookie_duration}h"

    return 0
  else
    log_error "  ✗ Values do NOT match"
    log_error "  Secret: $secret_normalized"
    log_error "  Parameter: $param_normalized"
    return 1
  fi
}

# Main execution
main() {
  log_info "=================================="
  log_info "Migration Verification"
  log_info "=================================="
  log_info "Region: $REGION"
  log_info "Profile: $AWS_PROFILE"
  log_info ""

  # Verify AWS credentials
  log_info "Verifying AWS credentials..."
  aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$REGION" >/dev/null 2>&1 || {
    log_error "Failed to verify AWS credentials"
    exit 1
  }
  log_success "AWS credentials verified"
  log_info ""

  # Verify jq is installed
  if ! command -v jq &> /dev/null; then
    log_error "jq is required but not installed"
    exit 1
  fi

  # Verify each migration
  verified_count=0
  error_count=0

  for secret_pair in "${SECRETS[@]}"; do
    # Split by colon to get secret_name and parameter_name
    secret_name="${secret_pair%%:*}"
    parameter_name="${secret_pair##*:}"

    if verify_migration "$secret_name" "$parameter_name"; then
      ((verified_count++))
    else
      ((error_count++))
    fi
    log_info ""
  done

  # Summary
  log_info "=================================="
  log_info "Verification Summary"
  log_info "=================================="
  log_success "Verified: $verified_count/${#SECRETS[@]}"

  if [[ $error_count -gt 0 ]]; then
    log_error "Failed: $error_count/${#SECRETS[@]}"
    log_error "Migration verification FAILED"
    exit 1
  fi

  log_success "✓ All migrations verified successfully!"
  log_info ""
  log_info "Migration is ready for deployment"
}

main "$@"
