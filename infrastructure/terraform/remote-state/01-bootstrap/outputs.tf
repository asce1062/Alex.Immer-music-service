# ============================================================================
# Bootstrap Terraform Outputs
# ============================================================================

output "deployer_user_name" {
  description = "Name of the created IAM user"
  value       = aws_iam_user.deployer.name
}

output "deployer_user_arn" {
  description = "ARN of the created IAM user"
  value       = aws_iam_user.deployer.arn
}

output "scoped_iam_policy_name" {
  description = "Name of the custom scoped IAM policy"
  value       = aws_iam_policy.scoped_iam.name
}

output "scoped_iam_policy_arn" {
  description = "ARN of the custom scoped IAM policy"
  value       = aws_iam_policy.scoped_iam.arn
}

output "aws_managed_policies" {
  description = "AWS managed policies attached to the user"
  value = [
    "AmazonS3FullAccess",
    "CloudFrontFullAccess",
    "AWSCertificateManagerFullAccess",
    "AmazonDynamoDBFullAccess",
    "SecretsManagerReadWrite"
  ]
}

output "aws_account_id" {
  description = "AWS Account ID"
  value       = data.aws_caller_identity.current.account_id
}

# ============================================================================
# Security Summary
# ============================================================================
output "security_summary" {
  description = "Summary of security approach"
  value = {
    status               = "✅ Hybrid approach: AWS managed + scoped IAM policy"
    security_posture     = "6/10 (Good for personal projects)"
    cost                 = "$0/month"
    aws_managed_policies = "S3, CloudFront, ACM, DynamoDB, SecretsManager (full access)"
    custom_iam_policy    = "Scoped to music-service-* resources only"
    approach             = "Easy operations + sensitive IAM protection"
  }
}

# ============================================================================
# Next Steps Instructions
# ============================================================================
output "next_steps" {
  description = "Post-deployment instructions"
  value = {
    status = "✅ Bootstrap complete - Hybrid IAM approach!"
    step_1 = "Verify attached policies:"
    step_2 = "  aws iam list-attached-user-policies --user-name ${var.deployer_user_name}"
    step_3 = "  Should show: 5 AWS managed + 1 custom scoped IAM policy"
    step_4 = "Test infrastructure deployment:"
    step_5 = "  cd ../infrastructure && terraform plan"
    step_6 = "No more AccessDenied errors for S3/CloudFront/ACM/DynamoDB/SecretsManager!"
    step_7 = "IAM operations scoped to music-service-* resources only (secure)"
  }
}

output "verification_commands" {
  description = "Commands to verify the setup"
  value = {
    check_policies  = "aws iam list-attached-user-policies --user-name ${var.deployer_user_name}"
    check_identity  = "aws sts get-caller-identity"
    test_s3_access  = "aws s3 ls s3://alexmbugua-music"
    test_cloudfront = "aws cloudfront list-distributions"
  }
}
