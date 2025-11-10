# ============================================================================
# API Gateway - Core Infrastructure
# ============================================================================
# This file provisions the core API Gateway infrastructure:
# - API Gateway HTTP API
# - Default stage with logging
# - Custom domain configuration
# - IAM roles and policies for Lambda execution
# - Global CloudWatch alarms
#
# API Endpoints are defined in separate files:
# - session.tf - POST /v1/session (authentication)
#
# Architecture:
# Client → API Gateway → Lambda Functions → Backend Services
# ============================================================================

# ============================================================================
# API Gateway Service-Linked Role
# ============================================================================
# Note: The AWSServiceRoleForAPIGateway service-linked role is required for
# API Gateway to manage custom domain names. This role exists at the account
# level and should be created once manually:
#
#   aws iam create-service-linked-role --aws-service-name ops.apigateway.amazonaws.com
#
# It's an account-wide resource and doesn't need to be managed by Terraform.
# ============================================================================

# ============================================================================
# Lambda Execution Role
# ============================================================================
resource "aws_iam_role" "lambda_execution" {
  name               = "music-service-lambda-execution-${var.environment}"
  description        = "IAM role for music service Lambda functions"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json

  tags = {
    Name        = "music-service-lambda-execution"
    Environment = var.environment
  }
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    sid    = "AllowLambdaAssumeRole"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

# ============================================================================
# Lambda IAM Policies
# ============================================================================

# CloudWatch Logs policy (managed by AWS)
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Secrets Manager access policy
resource "aws_iam_role_policy" "lambda_secrets_access" {
  name = "secrets-manager-access"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowReadCloudFrontSigningKey"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = aws_secretsmanager_secret.cloudfront_signing_key.arn
      },
      {
        Sid    = "AllowReadClientSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.client_alexmbugua_personal.arn,
          aws_secretsmanager_secret.client_music_app_web.arn,
          aws_secretsmanager_secret.client_music_app_mobile.arn
        ]
      }
    ]
  })
}

# ============================================================================
# Lambda Functions
# ============================================================================
# Lambda functions are defined in endpoint-specific files:
# - session.tf - auth_session Lambda function
# ============================================================================

# ============================================================================
# API Gateway HTTP API
# ============================================================================
resource "aws_apigatewayv2_api" "music_service" {
  name          = "music-service-api-${var.environment}"
  protocol_type = "HTTP"
  description   = "Music service authentication API"

  cors_configuration {
    allow_origins = [
      "https://alexmbugua.me",
      "https://www.alexmbugua.me",
      "https://asce1062.github.io",
      "https://music.alexmbugua.me",
      "http://localhost:4321",
      "http://localhost:4322",
      "http://localhost:3000",
      "http://localhost:8080",
      "http://localhost:8888",
      "http://127.0.0.1:4321",
      "http://127.0.0.1:4322",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:8080",
      "http://127.0.0.1:8888",
      "https://alexmbugua.netlify.app",
    ]
    allow_methods     = ["POST", "OPTIONS", "GET"]
    allow_headers     = ["content-type", "x-client-id", "x-client-secret", "authorization"]
    allow_credentials = true
    max_age           = 300
  }

  tags = {
    Name        = "music-service-api"
    Environment = var.environment
  }
}

# API Gateway Stage
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.music_service.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
    })
  }

  tags = {
    Name        = "music-service-api-default-stage"
    Environment = var.environment
  }
}

# CloudWatch Log Group for API Gateway
resource "aws_cloudwatch_log_group" "api_gateway_logs" {
  name              = "/aws/apigateway/music-service-${var.environment}"
  retention_in_days = 7

  tags = {
    Name        = "api-gateway-logs"
    Environment = var.environment
  }
}

# ============================================================================
# API Gateway Routes and Integrations
# ============================================================================
# Routes and integrations are defined in endpoint-specific files:
# - session.tf - POST /v1/session route and integration
# ============================================================================

# ============================================================================
# Custom Domain - music-api.alexmbugua.me
# ============================================================================
resource "aws_apigatewayv2_domain_name" "api" {
  domain_name = "music-api.alexmbugua.me"

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.api.arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }

  tags = {
    Name        = "music-service-api-domain"
    Environment = var.environment
  }

  # Wait for certificate validation to complete
  depends_on = [aws_acm_certificate_validation.api]
}

resource "aws_apigatewayv2_api_mapping" "api" {
  api_id      = aws_apigatewayv2_api.music_service.id
  domain_name = aws_apigatewayv2_domain_name.api.id
  stage       = aws_apigatewayv2_stage.default.id
}

# ============================================================================
# CloudWatch Alarms - Global API Gateway Monitoring
# ============================================================================
# Lambda-specific alarms are defined in endpoint-specific files:
# - session.tf - auth_session Lambda errors alarm
# ============================================================================

resource "aws_cloudwatch_metric_alarm" "api_gateway_5xx" {
  alarm_name          = "music-service-api-5xx-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "5XXError"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Alert when API Gateway 5xx errors exceed threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.music_service.id
  }

  tags = {
    Name        = "api-gateway-5xx-alarm"
    Environment = var.environment
  }
}

# ============================================================================
# Outputs
# ============================================================================
output "api_gateway_endpoint" {
  description = "API Gateway endpoint URL (default)"
  value       = aws_apigatewayv2_api.music_service.api_endpoint
}

output "api_gateway_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.music_service.id
}

output "api_custom_domain" {
  description = "Custom API domain URL"
  value       = "https://${aws_apigatewayv2_domain_name.api.domain_name}"
}

output "api_gateway_domain_target" {
  description = "API Gateway domain name target for DNS CNAME (use this in Netlify DNS)"
  value       = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
}

output "netlify_dns_setup_instructions" {
  description = "DNS records to add in Netlify for music-api.alexmbugua.me"
  value = {
    api_cname = {
      name  = "music-api.alexmbugua.me"
      type  = "CNAME"
      value = aws_apigatewayv2_domain_name.api.domain_name_configuration[0].target_domain_name
      ttl   = "3600"
      note  = "Points music-api.alexmbugua.me to API Gateway"
    }
    instructions = "Go to Netlify Dashboard → Domains → DNS Settings → Add DNS Record"
  }
}

# ============================================================================
# Lambda outputs are in endpoint-specific files:
# - session.tf - auth_session Lambda outputs
# ============================================================================
