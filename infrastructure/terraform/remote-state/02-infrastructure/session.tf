# ============================================================================
# API Endpoint: POST /v1/session - Authentication
# ============================================================================
# This file defines the session authentication endpoint:
# - Lambda function for client authentication and signed cookie generation
# - API Gateway integration and route
# - CloudWatch logs and alarms
#
# Endpoint: POST /v1/session
# Purpose: Authenticate client and issue CloudFront signed cookies
#
# Architecture:
# Client → API Gateway → Lambda → Secrets Manager → CloudFront Signed Cookies
# ============================================================================

# ============================================================================
# Lambda Function - Auth Session
# ============================================================================
resource "aws_lambda_function" "auth_session" {
  filename         = "${path.module}/lambda/auth-session.zip"
  function_name    = "music-service-auth-session-${var.environment}"
  role             = aws_iam_role.lambda_execution.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  architectures    = ["arm64"] # Use Graviton for cost optimization (~20% savings)
  timeout          = 10
  memory_size      = 256
  source_code_hash = fileexists("${path.module}/lambda/auth-session.zip") ? filebase64sha256("${path.module}/lambda/auth-session.zip") : null

  environment {
    variables = {
      SIGNING_KEY_SECRET_NAME = aws_secretsmanager_secret.cloudfront_signing_key.name
      CLIENTS_SECRET_PREFIX   = "music-service/clients/"
      CDN_DOMAIN              = var.cname_primary
      ENVIRONMENT             = var.environment
      NODE_ENV                = var.environment == "production" ? "production" : "development"
    }
  }

  tags = {
    Name     = "music-service-auth-session"
    Purpose  = "Client authentication and signed cookie generation"
    Endpoint = "POST /v1/session"
  }
}

# CloudWatch Log Group for Lambda
resource "aws_cloudwatch_log_group" "lambda_auth_session" {
  name              = "/aws/lambda/${aws_lambda_function.auth_session.function_name}"
  retention_in_days = 7

  tags = {
    Name        = "lambda-auth-session-logs"
    Environment = var.environment
  }
}

# ============================================================================
# API Gateway Integration
# ============================================================================
resource "aws_apigatewayv2_integration" "auth_session" {
  api_id                 = aws_apigatewayv2_api.music_service.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.auth_session.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

# API Gateway Route
resource "aws_apigatewayv2_route" "auth_session" {
  api_id    = aws_apigatewayv2_api.music_service.id
  route_key = "POST /v1/session"
  target    = "integrations/${aws_apigatewayv2_integration.auth_session.id}"
}

# Lambda Permission for API Gateway
resource "aws_lambda_permission" "api_gateway_invoke_auth_session" {
  statement_id  = "AllowAPIGatewayInvokeAuthSession"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth_session.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.music_service.execution_arn}/*/*/session"
}

# ============================================================================
# CloudWatch Alarms
# ============================================================================
resource "aws_cloudwatch_metric_alarm" "auth_session_lambda_errors" {
  alarm_name          = "music-service-auth-session-lambda-errors-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "Alert when auth session Lambda errors exceed threshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.auth_session.function_name
  }

  tags = {
    Name        = "auth-session-lambda-errors-alarm"
    Environment = var.environment
    Endpoint    = "POST /v1/session"
  }
}

# ============================================================================
# Outputs
# ============================================================================
output "auth_session_lambda_function_name" {
  description = "Lambda function name for auth session endpoint"
  value       = aws_lambda_function.auth_session.function_name
}

output "auth_session_lambda_function_arn" {
  description = "Lambda function ARN for auth session endpoint"
  value       = aws_lambda_function.auth_session.arn
}

output "auth_session_endpoint" {
  description = "Auth session endpoint URL"
  value       = "POST ${aws_apigatewayv2_api.music_service.api_endpoint}/v1/session"
}
