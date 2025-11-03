# ============================================================================
# Bootstrap Terraform Variables
# ============================================================================

variable "region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "deployer_user_name" {
  description = "Name of the IAM user for Terraform deployment"
  type        = string
  default     = "music-service"
}
