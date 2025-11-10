# ============================================================================
# Client Authentication Secrets
# ============================================================================
# This module manages client credentials for music service API authentication.
# Each client (web app, mobile app, etc.) has unique credentials stored in
# AWS Secrets Manager for secure access to the music CDN.
#
# Client Registration:
# 1. Define client secret resource below
# 2. Run terraform apply (creates secret with placeholder)
# 3. Generate random secret using scripts/generate_client_secrets.py
# 4. Update secret value in AWS Secrets Manager Console or CLI
#
# Client Credential Format:
# {
#   "client_id": "unique-client-identifier",
#   "client_secret": "cryptographically-secure-random-string",
#   "allowed_origins": ["https://example.com", "https://app.example.com"],
#   "description": "Human-readable client description",
#   "cookie_duration_hours": 2,
#   "created_at": "2025-01-07"
# }
# ============================================================================

# ============================================================================
# Client 1: Personal Portfolio/Blog (alexmbugua.me)
# ============================================================================
resource "aws_secretsmanager_secret" "client_alexmbugua_personal" {
  name        = "music-service/clients/alexmbugua-personal"
  description = "Client credentials for alexmbugua.me/music (personal portfolio)"

  tags = {
    Name        = "client-alexmbugua-personal"
    Environment = var.environment
    ClientType  = "web"
    Purpose     = "Personal portfolio music player authentication"
  }
}

resource "aws_secretsmanager_secret_version" "client_alexmbugua_personal" {
  secret_id = aws_secretsmanager_secret.client_alexmbugua_personal.id

  secret_string = jsonencode({
    client_id     = "alexmbugua-personal"
    client_secret = "PLACEHOLDER-GENERATE-WITH-SCRIPT"
    allow_origins = [
      "https://alexmbugua.me",
      "https://www.alexmbugua.me",
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
      "https://alexmbugua.netlify.app"
    ]
    description           = "Personal portfolio/blog music player"
    cookie_duration_hours = 2
    created_at            = timestamp()
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ============================================================================
# Client 2: Dedicated Web App (asce1062.github.io or music.alexmbugua.me)
# ============================================================================
resource "aws_secretsmanager_secret" "client_music_app_web" {
  name        = "music-service/clients/music-app-web"
  description = "Client credentials for dedicated music web application"

  tags = {
    Name        = "client-music-app-web"
    Environment = var.environment
    ClientType  = "web"
    Purpose     = "Dedicated music web app authentication"
  }
}

resource "aws_secretsmanager_secret_version" "client_music_app_web" {
  secret_id = aws_secretsmanager_secret.client_music_app_web.id

  secret_string = jsonencode({
    client_id     = "music-app-web"
    client_secret = "PLACEHOLDER-GENERATE-WITH-SCRIPT"
    allow_origins = [
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
      "https://alexmbugua.netlify.app"
    ]
    description           = "Dedicated music web application"
    cookie_duration_hours = 2
    created_at            = timestamp()
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ============================================================================
# Client 3: Mobile App (Alex.Immer - iOS & Android)
# ============================================================================
resource "aws_secretsmanager_secret" "client_music_app_mobile" {
  name        = "music-service/clients/alex-immer-mobile"
  description = "Client credentials for Alex.Immer mobile app"

  tags = {
    Name        = "client-alex-immer-mobile"
    Environment = var.environment
    ClientType  = "mobile"
    Purpose     = "Alex.Immer iOS and Android app authentication"
  }
}

resource "aws_secretsmanager_secret_version" "client_music_app_mobile" {
  secret_id = aws_secretsmanager_secret.client_music_app_mobile.id

  secret_string = jsonencode({
    client_id             = "alex-immer-mobile"
    client_secret         = "PLACEHOLDER-GENERATE-WITH-SCRIPT"
    allowed_origins       = ["app://alex.immer", "aleximmermobile://", "capacitor://localhost"]
    description           = "Alex.Immer iOS & Android app"
    cookie_duration_hours = 2
    created_at            = timestamp()
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ============================================================================
# IAM Policy for Lambda to Access Client Secrets
# ============================================================================
# The policy for Lambda to access client secrets is defined inline in
# api-gateway.tf (resource "aws_iam_role_policy" "lambda_secrets_access")
# This allows the Lambda function to read client credentials and the
# CloudFront signing key from Secrets Manager.

# ============================================================================
# Outputs
# ============================================================================
output "client_secret_arns" {
  description = "ARNs of all client secrets"
  value = {
    alexmbugua_personal = aws_secretsmanager_secret.client_alexmbugua_personal.arn
    music_app_web       = aws_secretsmanager_secret.client_music_app_web.arn
    alex_immer_mobile   = aws_secretsmanager_secret.client_music_app_mobile.arn
  }
}

output "client_secret_names" {
  description = "Names of all client secrets (for Lambda environment variables)"
  value = {
    alexmbugua_personal = aws_secretsmanager_secret.client_alexmbugua_personal.name
    music_app_web       = aws_secretsmanager_secret.client_music_app_web.name
    alex_immer_mobile   = aws_secretsmanager_secret.client_music_app_mobile.name
  }
}
