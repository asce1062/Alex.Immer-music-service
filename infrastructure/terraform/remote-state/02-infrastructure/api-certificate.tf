# ============================================================================
# ACM Certificate for API Gateway Custom Domain
# ============================================================================
# This certificate is separate from the CloudFront certificate and is used
# exclusively for the API Gateway custom domain (music-api.alexmbugua.me).
#
# API Gateway requires certificates in the same region as the API (us-east-1),
# while CloudFront always uses us-east-1 certificates.
# ============================================================================

resource "aws_acm_certificate" "api" {
  provider = aws.us_east_1

  domain_name       = "music-api.alexmbugua.me"
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

# ============================================================================
# DNS Validation Pre-Check
# ============================================================================
# This null resource displays the validation records BEFORE validation starts
resource "null_resource" "api_certificate_validation_instructions" {
  triggers = {
    certificate_arn = aws_acm_certificate.api.arn
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo ""
      echo "╔══════════════════════════════════════════════════════════════════════════════╗"
      echo "║                  ACM Certificate DNS Validation Required                     ║"
      echo "╚══════════════════════════════════════════════════════════════════════════════╝"
      echo ""
      echo "Certificate ARN: ${aws_acm_certificate.api.arn}"
      echo ""
      echo "⚠️  ACTION REQUIRED: Add the following DNS records to Netlify or any other DNS manager"
      echo "   before validation can complete (timeout: 45 minutes)"
      echo ""
      echo "DNS Validation Records:"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      %{for dvo in aws_acm_certificate.api.domain_validation_options~}
      echo "Domain: ${dvo.domain_name}"
      echo "  Name:  ${trimsuffix(dvo.resource_record_name, ".")}"
      echo "  Type:  ${dvo.resource_record_type}"
      echo "  Value: ${trimsuffix(dvo.resource_record_value, ".")}"
      echo ""
      %{endfor~}
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo ""
      echo "📍 Steps to add DNS records in Netlify:"
      echo "   1. Go to https://app.netlify.com/teams/user/dns/domain"
      echo "   2. Click 'Add new record'"
      echo "   3. Select record type: CNAME"
      echo "   4. Copy the Name and Value from above"
      echo "   5. Save the record"
      echo ""
      echo "⏳ Terraform will now wait for DNS validation to complete..."
      echo "   This can take up to 45 minutes but usually completes in 5-10 minutes"
      echo "   once the DNS records are added."
      echo ""
      echo "╔══════════════════════════════════════════════════════════════════════════════╗"
      echo "║                       Starting validation check...                           ║"
      echo "╚══════════════════════════════════════════════════════════════════════════════╝"
      echo ""
    EOT
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

  # Ensure instructions are shown before validation starts
  depends_on = [null_resource.api_certificate_validation_instructions]
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
