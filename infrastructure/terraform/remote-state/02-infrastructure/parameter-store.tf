# ===================================================================
# AWS Systems Manager Parameter Store - Client Credentials
# ===================================================================
# Manages client credential parameters for music streaming service
# authentication. These parameters are static credentials that don't
# require automatic rotation capabilities of Secrets Manager.
#
# Setup Workflow (Fresh Deployment):
# 1. Run terraform apply (creates parameters with placeholder values)
# 2. Run scripts/utils/generate_client_secrets.py to generate credentials
# 3. Use AWS CLI commands from script output to populate parameters
# 4. Deploy Lambda function (reads credentials from Parameter Store)
#
# Cost: Free (no charge for SecureString parameters)
# Security: KMS encrypted with default AWS managed key
# Migration Note: Migrated from Secrets Manager on 2025-11-11
# ===================================================================

# Parameter Store - Personal Client (alexmbugua-personal)
resource "aws_ssm_parameter" "client_alexmbugua_personal" {
  name        = "/music-service/clients/alexmbugua-personal"
  description = "Client credentials for alexmbugua-personal client"
  type        = "SecureString"
  value       = "{\"pending\":\"setup\"}"

  # Value will be populated via generate_client_secrets.py script
  # Lifecycle prevents Terraform from overwriting manually set values
  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name        = "music-service-client-alexmbugua-personal"
    Service     = local.service_name
    Environment = local.finops_environment
    ClientType  = "personal"
    Purpose     = "music-service-authentication"
    ManagedBy   = "terraform"
  }
}

# Parameter Store - Web Client (music-app-web)
resource "aws_ssm_parameter" "client_music_app_web" {
  name        = "/music-service/clients/music-app-web"
  description = "Client credentials for music-app-web client"
  type        = "SecureString"
  value       = "{\"pending\":\"setup\"}"

  # Value will be populated via generate_client_secrets.py script
  # Lifecycle prevents Terraform from overwriting manually set values
  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name        = "music-service-client-music-app-web"
    Service     = local.service_name
    Environment = local.finops_environment
    ClientType  = "web"
    Purpose     = "music-service-authentication"
    ManagedBy   = "terraform"
  }
}

# Parameter Store - Mobile Client (alex-immer-mobile)
resource "aws_ssm_parameter" "client_music_app_mobile" {
  name        = "/music-service/clients/alex-immer-mobile"
  description = "Client credentials for alex-immer-mobile client"
  type        = "SecureString"
  value       = "{\"pending\":\"setup\"}"

  # Value will be populated via generate_client_secrets.py script
  # Lifecycle prevents Terraform from overwriting manually set values
  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name        = "music-service-client-alex-immer-mobile"
    Service     = local.service_name
    Environment = local.finops_environment
    ClientType  = "mobile"
    Purpose     = "music-service-authentication"
    ManagedBy   = "terraform"
  }
}

# ===================================================================
# Outputs
# ===================================================================

output "parameter_store_client_names" {
  description = "Parameter Store parameter names for client credentials"
  value = {
    alexmbugua_personal = aws_ssm_parameter.client_alexmbugua_personal.name
    music_app_web       = aws_ssm_parameter.client_music_app_web.name
    music_app_mobile    = aws_ssm_parameter.client_music_app_mobile.name
  }
}

output "parameter_store_client_arns" {
  description = "Parameter Store ARNs for IAM policy attachment"
  value = {
    alexmbugua_personal = aws_ssm_parameter.client_alexmbugua_personal.arn
    music_app_web       = aws_ssm_parameter.client_music_app_web.arn
    music_app_mobile    = aws_ssm_parameter.client_music_app_mobile.arn
  }
}
