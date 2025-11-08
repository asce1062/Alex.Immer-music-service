# ============================================================================
# ACM Certificate for API Gateway Custom Domain
# ============================================================================
# This certificate is separate from the CloudFront certificate and is used
# exclusively for the API Gateway custom domain (api.alexmbugua.me).
#
# API Gateway requires certificates in the same region as the API (us-east-1),
# while CloudFront always uses us-east-1 certificates.
# ============================================================================

resource "aws_acm_certificate" "api" {
  provider = aws.us_east_1

  domain_name       = "api.alexmbugua.me"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name        = "music-service-api-certificate"
    Description = "Certificate for API Gateway custom domain"
    Environment = var.environment
  }
}

# DNS validation records for the API certificate
# These will be different from the CloudFront certificate validation records
resource "aws_acm_certificate_validation" "api" {
  provider = aws.us_east_1

  certificate_arn = aws_acm_certificate.api.arn

  # Validation will be done via DNS records in your DNS provider (Netlify)
  # Terraform will wait for validation to complete before marking this as ready
  # Timeout: 45 minutes (default)
}

# ============================================================================
# Outputs
# ============================================================================
output "api_certificate_arn" {
  description = "ARN of the API Gateway certificate"
  value       = aws_acm_certificate.api.arn
}

output "api_certificate_validation_records" {
  description = "DNS validation records for API certificate (add these to Netlify DNS)"
  value = [
    for dvo in aws_acm_certificate.api.domain_validation_options : {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      value  = dvo.resource_record_value
      domain = dvo.domain_name
    }
  ]
}
