# ============================================================================
# Backend Setup Outputs
# ============================================================================

output "state_bucket_name" {
  description = "Name of the S3 bucket for Terraform state"
  value       = aws_s3_bucket.terraform_state.id
}

output "state_bucket_arn" {
  description = "ARN of the S3 bucket for Terraform state"
  value       = aws_s3_bucket.terraform_state.arn
}

output "state_bucket_region" {
  description = "Region of the S3 bucket"
  value       = aws_s3_bucket.terraform_state.region
}

output "lock_table_name" {
  description = "Name of the DynamoDB table for state locking"
  value       = aws_dynamodb_table.terraform_locks.name
}

output "lock_table_arn" {
  description = "ARN of the DynamoDB table"
  value       = aws_dynamodb_table.terraform_locks.arn
}

output "backend_config" {
  description = "Backend configuration for other Terraform projects"
  value = {
    bucket         = aws_s3_bucket.terraform_state.id
    region         = var.region
    dynamodb_table = aws_dynamodb_table.terraform_locks.name
    encrypt        = true
  }
}

output "backend_config_example" {
  description = "Example backend configuration block"
  value       = <<-EOT
    Add this to your terraform {} block:

    backend "s3" {
      bucket         = "${aws_s3_bucket.terraform_state.id}"
      key            = "path/to/your/terraform.tfstate"  # Change this
      region         = "${var.region}"
      dynamodb_table = "${aws_dynamodb_table.terraform_locks.name}"
      encrypt        = true
    }
  EOT
}

output "migration_commands" {
  description = "Commands to migrate existing local state to remote backend"
  value = {
    step_1 = "Add backend configuration to your terraform block"
    step_2 = "Run: terraform init -migrate-state"
    step_3 = "Answer 'yes' when prompted to migrate state"
    step_4 = "Verify: terraform state list"
    step_5 = "Delete local state: rm -f terraform.tfstate terraform.tfstate.backup"
  }
}

output "next_steps" {
  description = "Next steps after creating backend"
  value = {
    step_1 = "✅ Backend infrastructure created successfully!"
    step_2 = "Configure bootstrap to use remote state:"
    step_3 = "  cd ../bootstrap"
    step_4 = "  # Add backend config to main.tf (see backend_config_example output)"
    step_5 = "  terraform init -migrate-state"
    step_6 = "Configure main infrastructure:"
    step_7 = "  cd ../"
    step_8 = "  # Add backend config to main.tf"
    step_9 = "  terraform init"
  }
}

output "cost_estimate" {
  description = "Estimated monthly cost for backend infrastructure"
  value = {
    s3_storage  = "$0.023/GB per month (typically <$1 for state files)"
    s3_requests = "$0.005/1000 PUT requests, $0.0004/1000 GET requests"
    dynamodb    = "Pay-per-request: ~$0.001-$0.01 per month (very low usage)"
    total       = "Estimated: $1-3 per month for typical usage"
  }
}
