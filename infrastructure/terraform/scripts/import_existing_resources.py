#!/usr/bin/env python3
"""Import Existing AWS Resources into Terraform State

This script helps import existing AWS resources created via console into
Terraform state to avoid recreation and downtime.

USAGE:
    python3 scripts/import_existing_resources.py

PREREQUISITES:
    1. Backend setup completed (S3 + DynamoDB created)
    2. music-service IAM user credentials exported
    3. Terraform code written to match existing resources
"""

import os
import subprocess  # nosec B404 - subprocess is used safely with explicit command lists
import sys
from pathlib import Path

# ==============================================================================
# Configuration
# ==============================================================================

# IMPORTANT: Set these via environment variables for security
#
# HOW TO GET THESE VALUES:
#
# 1. AWS_ACCOUNT_ID:
#    - AWS Console > Click your account name (top right) > Account
#    - OR run: aws sts get-caller-identity --query Account --output text
#
# 2. S3_BUCKET_NAME:
#    - AWS Console > S3 > Your bucket name (e.g., "alexmbugua-music")
#
# 3. CLOUDFRONT_DISTRIBUTION_ID:
#    - AWS Console > CloudFront > Distributions > ID column (e.g., "E1N....")
#    - OR run: aws cloudfront list-distributions --query \
#      'DistributionList.Items[0].Id' --output text
#
# 4. ACM_CERTIFICATE_ID:
#    - AWS Console > Certificate Manager (us-east-1 region!) > Certificate ID
#    - OR run: aws acm list-certificates --region us-east-1 --query \
#      'CertificateSummaryList[0].CertificateArn' --output text
#    - Extract just the ID from the ARN:
#      arn:aws:acm:us-east-1:ACCOUNT_ID:certificate/CERTIFICATE_ID
#
# 5. IAM_USER_NAME:
#    - AWS Console > IAM > Users > Your service account username (default: "music-service")
#
# Then run: source .env  OR  export $(cat .env | xargs)

AWS_ACCOUNT_ID = os.getenv("AWS_ACCOUNT_ID")
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "alexmbugua-music")
CLOUDFRONT_DISTRIBUTION_ID = os.getenv("CLOUDFRONT_DISTRIBUTION_ID")
ACM_CERTIFICATE_ID = os.getenv("ACM_CERTIFICATE_ID")
ACM_CERTIFICATE_ARN = (
    f"arn:aws:acm:us-east-1:{AWS_ACCOUNT_ID}:certificate/{ACM_CERTIFICATE_ID}"
    if AWS_ACCOUNT_ID and ACM_CERTIFICATE_ID
    else None
)
IAM_USER_NAME = os.getenv("IAM_USER_NAME", "music-service")


# ==============================================================================
# Helper Functions
# ==============================================================================


class Colors:
    """ANSI color codes for terminal output."""

    RED = "\033[0;31m"
    GREEN = "\033[0;32m"
    YELLOW = "\033[1;33m"
    BLUE = "\033[0;34m"
    NC = "\033[0m"  # No Color


def print_header(message: str) -> None:
    """Print a formatted header."""
    print(f"\n{Colors.BLUE}{'=' * 67}{Colors.NC}")
    print(f"{Colors.BLUE}{message}{Colors.NC}")
    print(f"{Colors.BLUE}{'=' * 67}{Colors.NC}\n")


def print_success(message: str) -> None:
    """Print a success message."""
    print(f"{Colors.GREEN}✓ {message}{Colors.NC}")


def print_warning(message: str) -> None:
    """Print a warning message."""
    print(f"{Colors.YELLOW}⚠ {message}{Colors.NC}")


def print_error(message: str) -> None:
    """Print an error message."""
    print(f"{Colors.RED}✗ {message}{Colors.NC}")


def print_info(message: str) -> None:
    """Print an info message."""
    print(f"{Colors.BLUE}→ {message}{Colors.NC}")


def run_command(
    cmd: list[str], cwd: Path | None = None, check: bool = True, capture_output: bool = True
) -> tuple[bool, str]:
    """Run a shell command and return success status and output.

    Args:
        cmd: Command and arguments as list
        cwd: Working directory
        check: Raise exception on error
        capture_output: Capture stdout/stderr

    Returns:
        Tuple of (success, output)
    """
    try:
        result = subprocess.run(
            cmd, cwd=cwd, check=check, capture_output=capture_output, text=True
        )  # nosec B603 - cmd is always a list with explicit args, no shell
        return True, result.stdout if capture_output else ""
    except subprocess.CalledProcessError as e:
        if capture_output:
            return False, e.stderr or e.stdout or str(e)
        return False, str(e)


def check_prerequisites() -> bool:
    """Check if all prerequisites are met."""
    print_header("Checking Prerequisites")

    # Check required environment variables
    required_env_vars = {
        "AWS_ACCOUNT_ID": AWS_ACCOUNT_ID,
        "CLOUDFRONT_DISTRIBUTION_ID": CLOUDFRONT_DISTRIBUTION_ID,
        "ACM_CERTIFICATE_ID": ACM_CERTIFICATE_ID,
    }

    missing_vars = [var for var, value in required_env_vars.items() if not value]

    if missing_vars:
        print_error(f"Missing required environment variables: {', '.join(missing_vars)}")
        print_info("Please export the following variables:")
        for var in missing_vars:
            print_info(f'  export {var}="your-{var.lower().replace("_", "-")}"')
        return False

    # Type assertions for mypy (variables validated above)
    assert AWS_ACCOUNT_ID is not None
    assert CLOUDFRONT_DISTRIBUTION_ID is not None
    assert ACM_CERTIFICATE_ID is not None
    assert ACM_CERTIFICATE_ARN is not None

    # Check AWS credentials
    if not os.getenv("AWS_ACCESS_KEY_ID") or not os.getenv("AWS_SECRET_ACCESS_KEY"):
        print_error("AWS credentials not set!")
        print("Please export AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY")
        return False
    print_success("AWS credentials found")

    # Check Terraform installed
    success, output = run_command(["terraform", "version"], check=False)
    if not success:
        print_error("Terraform not installed!")
        print("Install from: https://www.terraform.io/downloads")
        return False
    version = output.split("\n")[0] if output else "unknown"
    print_success(f"Terraform installed: {version}")

    # Check AWS CLI installed
    success, output = run_command(["aws", "--version"], check=False)
    if not success:
        print_error("AWS CLI not installed!")
        print("Install from: https://aws.amazon.com/cli/")
        return False
    print_success(f"AWS CLI installed: {output.strip()}")

    # Verify AWS credentials work
    success, output = run_command(
        ["aws", "sts", "get-caller-identity", "--query", "Arn", "--output", "text"], check=False
    )
    if not success:
        print_error("AWS credentials invalid!")
        return False
    print_success(f"AWS identity verified: {output.strip()}")

    return True


def verify_resources_exist() -> bool:
    """Verify that all resources exist in AWS."""
    # Type assertions for mypy
    assert CLOUDFRONT_DISTRIBUTION_ID is not None
    assert ACM_CERTIFICATE_ARN is not None

    print_header("Verifying Existing Resources")

    all_exist = True

    # Check S3 bucket
    success, _ = run_command(["aws", "s3", "ls", f"s3://{S3_BUCKET_NAME}"], check=False)
    if success:
        print_success(f"S3 bucket exists: {S3_BUCKET_NAME}")
    else:
        print_error(f"S3 bucket not found: {S3_BUCKET_NAME}")
        all_exist = False

    # Check CloudFront distribution
    success, _ = run_command(
        ["aws", "cloudfront", "get-distribution", "--id", CLOUDFRONT_DISTRIBUTION_ID], check=False
    )
    if success:
        print_success(f"CloudFront distribution exists: {CLOUDFRONT_DISTRIBUTION_ID}")
    else:
        print_error(f"CloudFront distribution not found: {CLOUDFRONT_DISTRIBUTION_ID}")
        all_exist = False

    # Check ACM certificate
    success, _ = run_command(
        [
            "aws",
            "acm",
            "describe-certificate",
            "--certificate-arn",
            ACM_CERTIFICATE_ARN,
            "--region",
            "us-east-1",
        ],
        check=False,
    )
    if success:
        print_success(f"ACM certificate exists: {ACM_CERTIFICATE_ID}")
    else:
        print_error(f"ACM certificate not found: {ACM_CERTIFICATE_ID}")
        all_exist = False

    # Check IAM user
    success, _ = run_command(["aws", "iam", "get-user", "--user-name", IAM_USER_NAME], check=False)
    if success:
        print_success(f"IAM user exists: {IAM_USER_NAME}")
    else:
        print_warning(f"IAM user not found or no permission to check: {IAM_USER_NAME}")
        print_info("Will attempt import anyway (may need admin credentials later)")

    return all_exist


def terraform_import(resource_type: str, resource_name: str, resource_id: str, cwd: Path) -> bool:
    """Import a resource into Terraform state.

    Args:
        resource_type: Terraform resource type (e.g., "aws_s3_bucket")
        resource_name: Terraform resource name (e.g., "music")
        resource_id: AWS resource ID to import
        cwd: Working directory

    Returns:
        True if import succeeded
    """
    resource_address = f"{resource_type}.{resource_name}"
    print_info(f"Importing {resource_address}...")

    success, output = run_command(
        ["terraform", "import", resource_address, resource_id], cwd=cwd, check=False
    )

    if success or "Import successful" in output:
        print_success(f"{resource_address} imported")
        return True
    elif "already managed" in output.lower() or "already exists" in output.lower():
        print_warning(f"{resource_address} already imported")
        return True
    else:
        print_warning(f"{resource_address} import failed (may not exist or already imported)")
        return False


def import_infrastructure_resources(terraform_dir: Path) -> None:
    """Import infrastructure resources (S3, CloudFront, ACM)."""
    # Type assertions for mypy
    assert CLOUDFRONT_DISTRIBUTION_ID is not None
    assert ACM_CERTIFICATE_ARN is not None

    print_header("Importing Infrastructure Resources")

    infra_dir = terraform_dir / "infrastructure"

    # Initialize Terraform
    print_info("Initializing Terraform...")
    success, _ = run_command(["terraform", "init"], cwd=infra_dir)
    if not success:
        print_error("Terraform init failed!")
        return
    print_success("Terraform initialized")

    # Import S3 bucket
    terraform_import("aws_s3_bucket", "music", S3_BUCKET_NAME, infra_dir)

    # Import S3 bucket versioning
    terraform_import("aws_s3_bucket_versioning", "music", S3_BUCKET_NAME, infra_dir)

    # Import S3 bucket encryption
    terraform_import(
        "aws_s3_bucket_server_side_encryption_configuration", "music", S3_BUCKET_NAME, infra_dir
    )

    # Import S3 bucket public access block
    terraform_import("aws_s3_bucket_public_access_block", "music", S3_BUCKET_NAME, infra_dir)

    # Import S3 bucket policy
    terraform_import("aws_s3_bucket_policy", "music", S3_BUCKET_NAME, infra_dir)

    # Import CloudFront distribution
    print_warning("CloudFront import may take a few minutes...")
    terraform_import("aws_cloudfront_distribution", "cdn", CLOUDFRONT_DISTRIBUTION_ID, infra_dir)

    # Import ACM certificate
    terraform_import("aws_acm_certificate", "cert", ACM_CERTIFICATE_ARN, infra_dir)


def import_bootstrap_resources(terraform_dir: Path) -> None:
    """Import bootstrap resources (IAM)."""
    print_header("Importing Bootstrap Resources (IAM)")

    print_warning("IAM imports require terraform-admin credentials!")
    success, output = run_command(
        ["aws", "sts", "get-caller-identity", "--query", "Arn", "--output", "text"], check=False
    )
    if success:
        print_info(f"Current credentials: {output.strip()}")

    response = input("Do you have terraform-admin credentials active? (y/n) ")
    if response.lower() != "y":
        print_warning("Skipping IAM imports. Run this section manually with admin credentials.")
        return

    bootstrap_dir = terraform_dir / "bootstrap"

    # Initialize Terraform
    print_info("Initializing Terraform...")
    success, _ = run_command(["terraform", "init"], cwd=bootstrap_dir)
    if not success:
        print_error("Terraform init failed!")
        return
    print_success("Terraform initialized")

    # Import IAM user
    terraform_import("aws_iam_user", "deployer", IAM_USER_NAME, bootstrap_dir)

    # Import AWS managed policy attachments
    print_info("Importing AWS managed policy attachments...")

    # List of AWS managed policies to import
    aws_managed_policies = {
        "s3_full_access": "arn:aws:iam::aws:policy/AmazonS3FullAccess",
        "cloudfront_full_access": "arn:aws:iam::aws:policy/CloudFrontFullAccess",
        "acm_full_access": "arn:aws:iam::aws:policy/AWSCertificateManagerFullAccess",
        "dynamodb_full_access": "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
    }

    for resource_name, policy_arn in aws_managed_policies.items():
        # Import format: username/policy-arn
        attachment_id = f"{IAM_USER_NAME}/{policy_arn}"
        terraform_import(
            "aws_iam_user_policy_attachment", resource_name, attachment_id, bootstrap_dir
        )


def verify_import(terraform_dir: Path) -> None:
    """Verify imports by running terraform plan."""
    print_header("Verifying Imports")

    infra_dir = terraform_dir / "infrastructure"

    print_info("Running terraform plan to check for drift...")
    print()

    success, output = run_command(["terraform", "plan", "-no-color"], cwd=infra_dir, check=False)

    if success:
        if "No changes" in output:
            print_success("Perfect! Infrastructure matches Terraform configuration.")
        else:
            print_warning("Configuration drift detected!")
            print()
            print(output)
            print()
            print_info("Next steps:")
            print("  1. Review the plan output above")
            print("  2. Update main.tf to match AWS reality, OR")
            print("  3. Run 'terraform apply' to update AWS to match Terraform")
    else:
        print_error("Terraform plan failed!")
        print(output)


def main() -> int:
    """Main execution function."""
    print_header("Terraform Import Script")
    print("This script will import your existing AWS resources into Terraform state.")
    print()
    print_warning("IMPORTANT: Make sure you've written Terraform code matching your resources!")
    print()

    response = input("Continue? (y/n) ")
    if response.lower() != "y":
        print("Aborted.")
        return 0

    # Check prerequisites
    if not check_prerequisites():
        return 1

    # Verify resources exist
    if not verify_resources_exist():
        print_error("Some resources don't exist. Please verify resource IDs in the script.")
        return 1

    print_header("Starting Import Process")

    # Get terraform directory
    script_dir = Path(__file__).parent
    terraform_dir = script_dir.parent

    # Change to terraform directory
    os.chdir(terraform_dir)

    # Import resources
    import_infrastructure_resources(terraform_dir)
    import_bootstrap_resources(terraform_dir)
    verify_import(terraform_dir)

    print_header("Import Complete!")
    print_success("All resources have been imported into Terraform state")
    print()
    print_info("Next steps:")
    print("  1. Review terraform plan output above")
    print("  2. Fix any configuration drift in main.tf")
    print("  3. Run 'terraform plan' until it shows 'No changes'")
    print("  4. Commit Terraform code to git")
    print("  5. Set up CI/CD with GitHub Actions")

    return 0


if __name__ == "__main__":
    sys.exit(main())
