# ============================================================================
# Backend Setup Variables
# ============================================================================

variable "region" {
  description = "AWS region for backend resources"
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "Name of the S3 bucket for Terraform state storage"
  type        = string
  default     = "music-service-terraform-state"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "Bucket name must be lowercase, alphanumeric, and 3-63 characters long."
  }
}

variable "lock_table_name" {
  description = "Name of the DynamoDB table for state locking"
  type        = string
  default     = "music-service-terraform-locks"
}

variable "state_version_retention_days" {
  description = "Number of days to retain old state file versions"
  type        = number
  default     = 90
}

variable "enable_point_in_time_recovery" {
  description = "Enable point-in-time recovery for DynamoDB table (backup)"
  type        = bool
  default     = true
}

variable "enable_logging" {
  description = "Enable S3 access logging for the state bucket"
  type        = bool
  default     = false
}
