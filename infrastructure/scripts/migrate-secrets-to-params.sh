#!/usr/bin/env bash
# ============================================================================
# Migrate Client Secrets from Secrets Manager to Parameter Store
# ============================================================================
# This script copies client credential secrets from AWS Secrets Manager to
# AWS Systems Manager Parameter Store as part of the cost optimization
# migration.
#
# Prerequisites:
# - AWS CLI configured with appropriate credentials
# - Read access to source Secrets Manager secrets
# - Write access to target Parameter Store parameters
#
# Usage:
#   ./migrate-secrets-to-params.sh [--dry-run] [--region us-east-1]
#
# Options:
#   --dry-run    Show what would be migrated without making changes
#   --region     AWS region (default: us-east-1)
#   --profile    AWS profile to use (default: default)
# ============================================================================

set -euo pipefail

# Configuration
REGION="${AWS_REGION:-us-east-1}"
DRY_RUN=false
AWS_PROFILE="${AWS_PROFILE:-default}"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Client credentials mapping (Secrets Manager → Parameter Store)
# Using array instead of associative array to avoid bash version issues
declare -a SECRETS=(
  "music-service/clients/alexmbugua-personal:/music-service/clients/alexmbugua-personal"
  "music-service/clients/music-app-web:/music-service/clients/music-app-web"
  "music-service/clients/alex-immer-mobile:/music-service/clients/alex-immer-mobile"
)

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --profile)
      AWS_PROFILE="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--region us-east-1] [--profile default]"
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

# Main migration function
migrate_secret() {
  local secret_name=$1
  local parameter_name=$2

  log_info "Processing: $secret_name → $parameter_name"

  # Fetch secret value from Secrets Manager
  log_info "  Fetching secret from Secrets Manager..."
  secret_value=$(aws secretsmanager get-secret-value \
    --secret-id "$secret_name" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --query 'SecretString' \
    --output text 2>&1) || {
    log_error "  Failed to fetch secret: $secret_name"
    return 1
  }

  if [[ -z "$secret_value" ]]; then
    log_error "  Secret value is empty: $secret_name"
    return 1
  fi

  # Validate JSON format
  if ! echo "$secret_value" | jq . >/dev/null 2>&1; then
    log_error "  Secret value is not valid JSON: $secret_name"
    return 1
  fi

  log_success "  Successfully fetched secret"

  # Check if parameter already exists
  existing_param=$(aws ssm get-parameter \
    --name "$parameter_name" \
    --region "$REGION" \
    --profile "$AWS_PROFILE" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text 2>/dev/null) || existing_param=""

  if [[ -n "$existing_param" ]]; then
    log_warning "  Parameter already exists: $parameter_name"

    # Compare values
    if [[ "$existing_param" == "$secret_value" ]]; then
      log_success "  Parameter value matches secret (no update needed)"
      return 0
    else
      log_warning "  Parameter value differs from secret"
    fi
  fi

  # Put parameter in Parameter Store
  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "  [DRY RUN] Would create/update parameter: $parameter_name"
    log_info "  [DRY RUN] Value length: ${#secret_value} characters"
  else
    log_info "  Creating/updating parameter in Parameter Store..."

    # If parameter exists, update value only (tags already set by Terraform)
    if [[ -n "$existing_param" ]]; then
      aws ssm put-parameter \
        --name "$parameter_name" \
        --value "$secret_value" \
        --type "SecureString" \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --overwrite || {
        log_error "  Failed to update parameter: $parameter_name"
        return 1
      }
    else
      # If parameter doesn't exist, create with full options
      aws ssm put-parameter \
        --name "$parameter_name" \
        --value "$secret_value" \
        --type "SecureString" \
        --region "$REGION" \
        --profile "$AWS_PROFILE" \
        --description "Client credentials (migrated from Secrets Manager)" \
        --tier "Standard" \
        --tags "Key=MigratedFrom,Value=secrets-manager" "Key=Purpose,Value=music-service-authentication" || {
        log_error "  Failed to create parameter: $parameter_name"
        return 1
      }
    fi

    log_success "  Successfully created/updated parameter"
  fi

  return 0
}

# Main execution
main() {
  log_info "=================================="
  log_info "Secrets Manager → Parameter Store Migration"
  log_info "=================================="
  log_info "Region: $REGION"
  log_info "Profile: $AWS_PROFILE"
  log_info "Dry Run: $DRY_RUN"
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
    log_error "jq is required but not installed. Please install jq first."
    exit 1
  fi

  # Migrate each secret
  migration_count=0
  error_count=0

  for secret_pair in "${SECRETS[@]}"; do
    # Split by colon to get secret_name and parameter_name
    secret_name="${secret_pair%%:*}"
    parameter_name="${secret_pair##*:}"

    if migrate_secret "$secret_name" "$parameter_name"; then
      ((migration_count++))
    else
      ((error_count++))
    fi
    log_info ""
  done

  # Summary
  log_info "=================================="
  log_info "Migration Summary"
  log_info "=================================="
  log_success "Successfully migrated: $migration_count"
  if [[ $error_count -gt 0 ]]; then
    log_error "Failed migrations: $error_count"
    exit 1
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log_warning "DRY RUN MODE - No changes were made"
    log_info "Run without --dry-run to perform actual migration"
  else
    log_success "Migration completed successfully!"
    log_info ""
    log_info "Next steps:"
    log_info "  1. Verify parameters in AWS Console or run verify-migration.sh"
    log_info "  2. Deploy updated Lambda function with Parameter Store code"
    log_info "  3. Test authentication endpoint"
    log_info "  4. Monitor for 48 hours before cleanup"
  fi
}

main "$@"
