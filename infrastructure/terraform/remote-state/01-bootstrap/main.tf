# ============================================================================
# Bootstrap Terraform Configuration - IAM User Provisioning
# ============================================================================
# This configuration creates the IAM user that will be used to deploy the
# main infrastructure. This is a one-time setup that should be run with
# admin credentials, then the created user can be used for all subsequent
# deployments.
#
# USAGE:
#   1. Run this with your admin AWS credentials
#   2. Create access keys for the music-service-deployer user
#   3. Use those credentials to deploy the main infrastructure
# ============================================================================

terraform {
  required_version = ">= 1.0"

  # Remote state backend (S3 + DynamoDB)
  # NOTE: Run backend-setup FIRST to create these resources
  backend "s3" {
    bucket         = "music-service-terraform-state"
    key            = "bootstrap/terraform.tfstate"
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
      Environment = "bootstrap"
    }
  }
}

# ============================================================================
# Data Sources
# ============================================================================
# Get current AWS account ID
data "aws_caller_identity" "current" {}

# ============================================================================
# IAM User for Terraform Deployment
# ============================================================================
resource "aws_iam_user" "deployer" {
  name = var.deployer_user_name
  # NOTE: No path prefix to match AWS console default behavior
  # path = "/service-accounts/"

  tags = {
    Name        = var.deployer_user_name
    Description = "IAM user for music service Terraform infrastructure deployment"
    Purpose     = "Infrastructure as Code deployment"
  }
}

# ============================================================================
# AWS Managed Policies (Easy Operations)
# ============================================================================
# Using AWS managed policies for non-sensitive services (S3, CloudFront, etc.)
# This simplifies operations and reduces "AccessDenied" errors.

resource "aws_iam_user_policy_attachment" "s3_full_access" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonS3FullAccess"
}

resource "aws_iam_user_policy_attachment" "cloudfront_full_access" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/CloudFrontFullAccess"
}

resource "aws_iam_user_policy_attachment" "acm_full_access" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/AWSCertificateManagerFullAccess"
}

resource "aws_iam_user_policy_attachment" "dynamodb_full_access" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess"
}

resource "aws_iam_user_policy_attachment" "secrets_manager_readwrite" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/SecretsManagerReadWrite"
}

resource "aws_iam_user_policy_attachment" "lambda_full_access" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/AWSLambda_FullAccess"
}

resource "aws_iam_user_policy_attachment" "apigateway_admin" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonAPIGatewayAdministrator"
}

resource "aws_iam_user_policy_attachment" "cloudwatch_full_access" {
  user       = aws_iam_user.deployer.name
  policy_arn = "arn:aws:iam::aws:policy/CloudWatchFullAccess"
}

# ============================================================================
# Custom Scoped IAM Policy (Sensitive IAM Operations Only)
# ============================================================================
# Custom policy for IAM operations - scoped to music-service-* resources only.
# This prevents creating/modifying arbitrary IAM users/policies while still
# allowing Terraform to manage the infrastructure IAM policy.
#
# Security Features:
# - Can only manage music-service-* policies
# - Can only attach/detach policies to self
# - MFA required for destructive operations

data "aws_iam_policy_document" "scoped_iam_policy" {
  # IAM - Limited policy management (music-service prefix only)
  statement {
    sid    = "IAMPolicyManagement"
    effect = "Allow"

    actions = [
      "iam:CreatePolicy",
      "iam:DeletePolicy",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicyVersion",
      "iam:SetDefaultPolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
      "iam:ListPolicyTags",
    ]

    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/music-service-*",
    ]
  }

  # IAM - Role management (music-service prefix only)
  statement {
    sid    = "IAMRoleManagement"
    effect = "Allow"

    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:UpdateRole",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:ListRoleTags",
      "iam:PassRole",
    ]

    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/music-service-*",
    ]
  }

  # IAM - Service-linked role management (no tagging allowed)
  statement {
    sid    = "IAMServiceLinkedRoleManagement"
    effect = "Allow"

    actions = [
      "iam:CreateServiceLinkedRole",
      "iam:DeleteServiceLinkedRole",
      "iam:GetServiceLinkedRoleDeletionStatus",
      "iam:GetRole",
    ]

    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/aws-service-role/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:AWSServiceName"
      values   = ["ops.apigateway.amazonaws.com"]
    }
  }

  # IAM - Attach policies to self only
  statement {
    sid    = "IAMSelfPolicyAttachment"
    effect = "Allow"

    actions = [
      "iam:AttachUserPolicy",
      "iam:DetachUserPolicy",
      "iam:ListAttachedUserPolicies",
    ]

    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/${var.deployer_user_name}",
    ]

    condition {
      test     = "ArnLike"
      variable = "iam:PolicyARN"
      values = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/music-service-*",
      ]
    }
  }

  # IAM - Read own user information
  statement {
    sid    = "IAMReadSelfInfo"
    effect = "Allow"

    actions = [
      "iam:GetUser",
      "iam:ListUserPolicies",
      "iam:ListAttachedUserPolicies",
      "iam:GetUserPolicy",
    ]

    resources = [
      "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/${var.deployer_user_name}",
    ]
  }

  # STS - Required for Terraform provider authentication
  statement {
    sid    = "STSGetCallerIdentity"
    effect = "Allow"

    actions = [
      "sts:GetCallerIdentity",
    ]

    resources = ["*"]
  }

  # MFA requirement for destructive operations
  statement {
    sid    = "DenyDestructiveOpsWithoutMFA"
    effect = "Deny"

    actions = [
      "s3:DeleteBucket",
      "cloudfront:DeleteDistribution",
      "iam:DeleteUser",
      "iam:DeletePolicy",
      "dynamodb:DeleteTable",
    ]

    resources = ["*"]

    condition {
      test     = "BoolIfExists"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["false"]
    }
  }
}

resource "aws_iam_policy" "scoped_iam" {
  name        = "music-service-scoped-iam-policy"
  description = "Scoped IAM policy - allows managing only music-service-* IAM resources"
  policy      = data.aws_iam_policy_document.scoped_iam_policy.json

  tags = {
    Name          = "music-service-scoped-iam-policy"
    Description   = "Scoped IAM operations for infrastructure deployment"
    SecurityLevel = "scoped-to-prefix"
  }
}

resource "aws_iam_user_policy_attachment" "scoped_iam" {
  user       = aws_iam_user.deployer.name
  policy_arn = aws_iam_policy.scoped_iam.arn
}

# ============================================================================
# IAM Access Keys - Manual Creation Required
# ============================================================================
# SECURITY BEST PRACTICE: Access keys should be created manually via AWS
# Console or CLI to avoid storing them in Terraform state.
#
# After running this configuration, create access keys with:
#   aws iam create-access-key --user-name music-service
#
# Then save the credentials securely in:
#   - AWS Secrets Manager (recommended for production)
#   - Password manager (recommended for personal use)
#   - .env file (ensure it's in .gitignore)
#
# DO NOT commit access keys to version control!
# ============================================================================
