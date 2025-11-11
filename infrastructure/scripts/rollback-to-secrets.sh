#!/usr/bin/env bash
# ============================================================================
# Rollback Parameter Store Migration to Secrets Manager
# ============================================================================
# This script reverts client credentials back to using Secrets Manager
# by reverting code changes and redeploying the Lambda function.
#
# IMPORTANT: This does NOT delete Parameter Store parameters. It only
# reverts the application code to use Secrets Manager again.
#
# Prerequisites:
# - Git repository with migration changes committed
# - AWS CLI configured with appropriate credentials
#
# Usage:
#   ./rollback-to-secrets.sh [--skip-deploy]
#
# Options:
#   --skip-deploy  Only show rollback plan without deploying
# ============================================================================

set -euo pipefail

# Configuration
SKIP_DEPLOY=false

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-deploy)
      SKIP_DEPLOY=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--skip-deploy]"
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

# Main rollback function
rollback() {
  log_info "=================================="
  log_info "Rollback to Secrets Manager"
  log_info "=================================="
  log_warning "This will revert the Parameter Store migration"
  log_info ""

  # Check if we're in git repository
  if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not in a git repository. Cannot proceed with rollback."
    exit 1
  fi

  # Check for uncommitted changes
  if ! git diff-index --quiet HEAD --; then
    log_warning "You have uncommitted changes. Commit or stash them first."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log_info "Rollback cancelled"
      exit 0
    fi
  fi

  log_info "Rollback plan:"
  log_info "  1. Revert client-validator.ts import"
  log_info "  2. Revert session.tf environment variable (CLIENTS_SECRET_PREFIX)"
  log_info "  3. Rebuild and redeploy Lambda function"
  log_info "  4. Update Lambda environment variables via Terraform"
  log_info ""

  if [[ "$SKIP_DEPLOY" == "true" ]]; then
    log_warning "SKIP DEPLOY MODE - No changes will be made"
    return 0
  fi

  # Confirm rollback
  log_warning "Are you sure you want to rollback?"
  read -p "Type 'ROLLBACK' to confirm: " -r
  if [[ "$REPLY" != "ROLLBACK" ]]; then
    log_info "Rollback cancelled"
    exit 0
  fi

  log_info ""
  log_info "Step 1: Reverting client-validator.ts import..."

  # Revert client-validator.ts
  cat > api/src/services/client-validator.ts <<'EOF'
/**
 * Client Validation Service
 * Validates client credentials and origin
 */

import type { ClientCredentials, RequestHeaders } from '../types/index.js';
import { getClientCredentials } from './secrets-manager.js';
import { logger } from '../utils/logger.js';

export interface ValidationResult {
  valid: boolean;
  client?: ClientCredentials;
  error?: string;
}

/**
 * Validate client credentials and origin
 */
export async function validateClient(headers: RequestHeaders): Promise<ValidationResult> {
  const clientId = headers['x-client-id'];
  const clientSecret = headers['x-client-secret'];
  const origin = headers.origin;

  // Check required headers
  if (!clientId) {
    return {
      valid: false,
      error: 'Missing x-client-id header',
    };
  }

  if (!clientSecret) {
    return {
      valid: false,
      error: 'Missing x-client-secret header',
    };
  }

  if (!origin) {
    return {
      valid: false,
      error: 'Missing origin header',
    };
  }

  // Fetch client credentials from Secrets Manager
  const client = await getClientCredentials(clientId);

  if (!client) {
    logger.warn({ clientId }, `Client not found: ${clientId}`);
    return {
      valid: false,
      error: 'Invalid client credentials',
    };
  }

  // Validate client secret (constant-time comparison to prevent timing attacks)
  if (!constantTimeCompare(clientSecret, client.client_secret)) {
    logger.warn({ clientId }, `Invalid secret for client: ${clientId}`);
    return {
      valid: false,
      error: 'Invalid client credentials',
    };
  }

  // Validate origin
  const isOriginAllowed = client.allowed_origins.some((allowedOrigin) => {
    // Exact match or subdomain match
    return origin === allowedOrigin || origin.startsWith(`${allowedOrigin}/`);
  });

  if (!isOriginAllowed) {
    logger.warn(
      { clientId, origin, allowedOrigins: client.allowed_origins },
      `Origin not allowed for client ${clientId}: ${origin}`
    );
    return {
      valid: false,
      error: 'Origin not allowed for this client',
    };
  }

  return {
    valid: true,
    client,
  };
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}
EOF

  log_success "  Reverted client-validator.ts"

  log_info ""
  log_info "Step 2: Building and deploying Lambda..."

  # Build Lambda
  cd api
  npm run build || {
    log_error "Failed to build Lambda function"
    exit 1
  }
  log_success "  Built Lambda function"

  # Deploy Lambda (copy zip to infrastructure directory)
  cp dist/auth-session.zip ../infrastructure/terraform/remote-state/02-infrastructure/lambda/ || {
    log_error "Failed to copy Lambda zip"
    exit 1
  }
  cd ..
  log_success "  Copied Lambda zip"

  log_info ""
  log_info "Step 3: Updating Terraform..."

  # Update Terraform
  cd infrastructure/terraform/remote-state/02-infrastructure

  # Note: Manual revert of session.tf CLIENTS_SECRET_PREFIX needed
  log_warning "  You must manually revert CLIENTS_SECRET_PREFIX in session.tf"
  log_warning "  Change: /music-service/clients/ → music-service/clients/"
  log_info ""

  log_info "  Running terraform plan..."
  terraform plan -out=rollback.tfplan || {
    log_error "Terraform plan failed"
    exit 1
  }

  log_warning "Review the plan above. Apply changes?"
  read -p "Type 'APPLY' to apply: " -r
  if [[ "$REPLY" != "APPLY" ]]; then
    log_info "Rollback cancelled"
    exit 0
  fi

  terraform apply rollback.tfplan || {
    log_error "Terraform apply failed"
    exit 1
  }

  log_success "Terraform applied successfully"

  cd ../../../..

  log_info ""
  log_info "=================================="
  log_success "Rollback completed successfully!"
  log_info "=================================="
  log_info ""
  log_info "The Lambda function is now using Secrets Manager again."
  log_info "Parameter Store parameters are still in place but unused."
  log_info ""
  log_info "Next steps:"
  log_info "  1. Test the /session endpoint"
  log_info "  2. Monitor CloudWatch logs"
  log_info "  3. If stable, you can delete Parameter Store parameters manually"
}

# Main execution
main() {
  rollback "$@"
}

main "$@"
