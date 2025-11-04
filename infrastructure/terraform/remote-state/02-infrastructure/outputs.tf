# ============================================================================
# Music Service CDN - Terraform Outputs
# ============================================================================

# ============================================================================
# S3 Bucket Outputs
# ============================================================================
output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.music.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.music.arn
}

output "s3_bucket_domain_name" {
  description = "Regional domain name of the S3 bucket"
  value       = aws_s3_bucket.music.bucket_regional_domain_name
}

# ============================================================================
# CloudFront Outputs
# ============================================================================
output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.cdn.id
}

output "cloudfront_distribution_arn" {
  description = "ARN of the CloudFront distribution"
  value       = aws_cloudfront_distribution.cdn.arn
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.cdn.domain_name
}

output "cloudfront_hosted_zone_id" {
  description = "CloudFront hosted zone ID (for Route53 alias)"
  value       = aws_cloudfront_distribution.cdn.hosted_zone_id
}

# ============================================================================
# ACM Certificate Outputs
# ============================================================================
output "acm_certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = aws_acm_certificate.cert.arn
}

output "acm_certificate_status" {
  description = "Validation status of the ACM certificate"
  value       = aws_acm_certificate.cert.status
}

output "acm_validation_records" {
  description = "DNS validation records for ACM certificate (add these to Netlify)"
  value = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}

# ============================================================================
# IAM Outputs
# ============================================================================
# NOTE: The IAM user is created and managed by the bootstrap module.
# Permissions are handled via AWS managed policies attached in bootstrap.
output "iam_user_name" {
  description = "Name of the IAM user (created in bootstrap module)"
  value       = var.iam_user_name
}

output "iam_user_arn" {
  description = "ARN of the IAM user (created in bootstrap module)"
  value       = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/${var.iam_user_name}"
}

# ============================================================================
# CloudFront Function Outputs
# ============================================================================
output "cloudfront_function_arn" {
  description = "ARN of the CloudFront Function"
  value       = aws_cloudfront_function.referer_filter.arn
}

# ============================================================================
# Netlify DNS Records
# ============================================================================
output "netlify_dns_records_acm" {
  description = "ACM validation records to add to Netlify DNS"
  value = {
    for dvo in aws_acm_certificate.cert.domain_validation_options : dvo.domain_name => {
      instructions = "Add CNAME record to Netlify:"
      type         = "CNAME"
      name         = trimsuffix(dvo.resource_record_name, ".alexmbugua.me.")
      value        = trimsuffix(dvo.resource_record_value, ".")
      ttl          = "3600"
    }
  }
}

output "netlify_dns_records_cloudfront" {
  description = "CloudFront CNAME records to add to Netlify DNS"
  value = {
    primary = {
      instructions = "Add CNAME record to Netlify for primary domain:"
      type         = "CNAME"
      name         = "cdn"
      value        = aws_cloudfront_distribution.cdn.domain_name
      ttl          = "3600"
    }
    staging = {
      instructions = "Add CNAME record to Netlify for staging domain:"
      type         = "CNAME"
      name         = "cdn-staging"
      value        = aws_cloudfront_distribution.cdn.domain_name
      ttl          = "3600"
    }
  }
}

# ============================================================================
# Quick Reference
# ============================================================================
output "quick_reference" {
  description = "Quick reference for important values"
  value = {
    cdn_url                = "https://${var.cname_primary}"
    cdn_staging_url        = "https://${var.cname_staging}"
    cloudfront_domain      = aws_cloudfront_distribution.cdn.domain_name
    distribution_id        = aws_cloudfront_distribution.cdn.id
    s3_bucket              = aws_s3_bucket.music.id
    iam_user               = var.iam_user_name
    acm_validation_pending = aws_acm_certificate.cert.status != "ISSUED"
  }
}
